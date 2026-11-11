import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import {
  LEDGER_DIRECTORY,
  type LineRange,
  type MapReader,
  type NewestLinesChange,
  PROBLEM_SEVERITIES,
  type Problem,
  type RuleSection,
  checkRepo,
  createMapReader,
  findNewestLinesChange,
  formatProblem,
} from './logicmap.ts'

/*
 * Claude Code hook: puts the map in front of the agent while it reads and edits mapped code.
 *
 *   PostToolUse Read                      → the rules covering the lines just read, in full the first
 *                                           time a session reads them, then by id; and, the first time
 *                                           it reads a committed code file, the newest change of the
 *                                           lines read and the logicmap why command
 *   PostToolUse Edit / MultiEdit / Write  → what check reports for the edited file's rules; and the rules
 *                                           whose uses or test sites cover lines changed since HEAD, which
 *                                           no lock fingerprints, once per file and session
 *   PostToolUse / PostToolUseFailure Bash → both of the above for a shell command: each `sed -n A,Bp <file>`
 *                                           or `cat <file>` in it is a read of those lines, and each file it
 *                                           changed (written during its run, differing from HEAD) is an edit
 *   PostCompact                           → what the session was shown once is forgotten, so it is shown again
 *   Stop                                  → check's errors, once, so the agent resolves them or says
 *                                           why they stay; only for a session that edited the repo
 *                                           since its last stop
 *
 * It answers only inside a git repo that has a logicmap/ folder; anywhere else it prints nothing.
 */

export const HOOK_EVENTS = {
  postToolUse: 'PostToolUse',
  postToolUseFailure: 'PostToolUseFailure',
  postCompact: 'PostCompact',
  stop: 'Stop',
} as const

const READ_TOOL_NAME = 'Read'
const BASH_TOOL_NAME = 'Bash'
const EDITING_TOOL_NAMES: readonly string[] = ['Edit', 'MultiEdit', 'Write']

// The fields of Claude Code's hook input this hook reads.
export type HookInput = {
  hook_event_name: string
  session_id?: string
  agent_id?: string
  cwd?: string
  tool_name?: string
  tool_input?: { file_path?: unknown; offset?: unknown; limit?: unknown; command?: unknown }
  duration_ms?: number
  stop_hook_active?: boolean
}

// The events of a tool call, whose answer is context added for the agent. A Bash command that exits non-zero
// fires the failure event only.
type ToolHookEventName = typeof HOOK_EVENTS.postToolUse | typeof HOOK_EVENTS.postToolUseFailure

const isToolHookEventName = (hookEventName: string): hookEventName is ToolHookEventName =>
  hookEventName === HOOK_EVENTS.postToolUse || hookEventName === HOOK_EVENTS.postToolUseFailure

export type HookOutput =
  | { hookSpecificOutput: { hookEventName: ToolHookEventName; additionalContext: string } }
  | { decision: 'block'; reason: string }

// A stop reason lists this many errors at most; the rest are counted.
const STOP_REASON_MAX_ERRORS = 20

// The root of the git repo holding this directory, when that repo has a map.
const findMappedRepoRoot = (directory: string): string | null => {
  try {
    const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return existsSync(join(repoRoot, LEDGER_DIRECTORY)) ? repoRoot : null
  } catch {
    return null
  }
}

// What the hook keeps per session, one file each: the mapped repos it edited since its last stop, so a
// stop asks only the sessions that changed something (another session's work in progress stops nobody
// else). And per conversation, the session's or each of its subagents', what it was shown once: the rules in
// full, a file's newest change, the rules relied on.
const HOOK_STATE_DIRECTORY = join(tmpdir(), 'logicmap-hook')
const stateFileOf = (ownerId: string, fileSuffix: string): string =>
  join(HOOK_STATE_DIRECTORY, `${ownerId.replace(/[^\w-]/g, '_')}${fileSuffix}`)
const editedReposFileOf = (sessionId: string): string => stateFileOf(sessionId, '.txt')
const shownRulesFileOf = (conversationId: string): string =>
  stateFileOf(conversationId, '.shown-rules.txt')
const namedChangesFileOf = (conversationId: string): string =>
  stateFileOf(conversationId, '.named-changes.txt')
const reliedOnRulesFileOf = (conversationId: string): string =>
  stateFileOf(conversationId, '.relied-on-rules.txt')
// And for every session at once, the file versions a hook already answered: a command is answered only for the
// versions no hook answered, so another session's edit is never its own.
const ANSWERED_EDITS_FILE = join(HOOK_STATE_DIRECTORY, 'answered-edits.txt')

const appendToStateFile = (stateFile: string, lines: string[]): void => {
  mkdirSync(HOOK_STATE_DIRECTORY, { recursive: true })
  appendFileSync(stateFile, lines.map((line) => `${line}\n`).join(''))
}

// git prints the repo root with symlinks resolved (macOS: /var → /private/var), so the path is too.
const recordEditedRepo = (sessionId: string, repoRoot: string): void =>
  appendToStateFile(editedReposFileOf(sessionId), [repoRoot])

// Read once: the next stop asks again only after another edit.
const takeEditedRepos = (sessionId: string): Set<string> => {
  const editedReposFile = editedReposFileOf(sessionId)
  if (!existsSync(editedReposFile)) {
    return new Set()
  }
  const editedRepos = readFileSync(editedReposFile, 'utf8').split('\n').filter(Boolean)
  rmSync(editedReposFile)
  return new Set(editedRepos)
}

const toRepoPath = (repoRoot: string, absolutePath: string): string =>
  relative(repoRoot, realpathSync(absolutePath)).split(sep).join('/')

const addContext = (hookEventName: ToolHookEventName, contextLines: string[]): HookOutput | null =>
  contextLines.length === 0
    ? null
    : { hookSpecificOutput: { hookEventName, additionalContext: contextLines.join('\n') } }

// Read's offset is the first line read and limit the number of lines; neither means the whole file.
const toReadLines = (offset: unknown, limit: unknown): LineRange | null => {
  const hasOffset = typeof offset === 'number'
  const hasLimit = typeof limit === 'number'
  if (!hasOffset && !hasLimit) {
    return null
  }
  const firstLine = hasOffset ? Math.max(offset, 1) : 1
  const lastLine = hasLimit ? firstLine + limit - 1 : Number.MAX_SAFE_INTEGER
  return { firstLine, lastLine }
}

// A rule is shown once per version: bumped, its new claim is shown again.
const shownRuleLineOf = (repoRoot: string, ruleSection: RuleSection): string =>
  `${repoRoot} ${ruleSection.id}@${ruleSection.version ?? '?'}`

const readStateFileLines = (stateFile: string): Set<string> =>
  existsSync(stateFile)
    ? new Set(readFileSync(stateFile, 'utf8').split('\n').filter(Boolean))
    : new Set()

// What a conversation was shown once is gone from its context after a compaction, so it is shown again.
const forgetWhatConversationWasShown = (conversationId: string): void => {
  const shownOnceFiles = [
    shownRulesFileOf(conversationId),
    namedChangesFileOf(conversationId),
    reliedOnRulesFileOf(conversationId),
  ]
  for (const shownOnceFile of shownOnceFiles) {
    rmSync(shownOnceFile, { force: true })
  }
}

// A commit subject is cut here: teamabled's run to 300 characters.
const NAMED_SUBJECT_MAX_LENGTH = 100

const describeNewestChange = (
  file: string,
  { lines, date, hash, subject }: NewestLinesChange,
  pieceText: string,
  isWholeFileRead: boolean,
): string => {
  const shownSubject =
    subject.length > NAMED_SUBJECT_MAX_LENGTH
      ? `${subject.slice(0, NAMED_SUBJECT_MAX_LENGTH)}…`
      : subject
  const whyCommand = isWholeFileRead
    ? `logicmap why ${file}:<line> or ${file}:<name> gives every commit of a line or a declaration with its reason.`
    : `logicmap why ${file}:${lines.firstLine}-${lines.lastLine} gives every commit of these lines with its reason.`
  return `logicmap: last changed by ${hash} on ${date}, "${shownSubject}"${pieceText}. ${whyCommand}`
}

// The newest change of the lines read, once per file and session, for a code file git holds: a Markdown file
// is where reasons are written, and logicmap/ has why <id>. A failing git call costs this line only, never
// the rules.
const listNewestChangeLines = (
  repoRoot: string,
  file: string,
  readLines: LineRange | null,
  conversationId: string | null,
): string[] => {
  const isCodeFile = !file.endsWith('.md') && !file.startsWith(`${LEDGER_DIRECTORY}/`)
  const namedChangeLine = `${repoRoot} ${file}`
  const namedChangesFile = conversationId === null ? null : namedChangesFileOf(conversationId)
  const isNamedBefore =
    namedChangesFile !== null && readStateFileLines(namedChangesFile).has(namedChangeLine)
  if (!isCodeFile || isNamedBefore) {
    return []
  }
  try {
    const newestChange = findNewestLinesChange(repoRoot, file, readLines)
    if (newestChange === null) {
      return []
    }
    if (namedChangesFile !== null) {
      appendToStateFile(namedChangesFile, [namedChangeLine])
    }
    const { piece } = newestChange
    const pieceText = piece === null ? '' : `, recorded as ${piece.label} in ${piece.docPath}`
    return [describeNewestChange(file, newestChange, pieceText, readLines === null)]
  } catch {
    return []
  }
}

// Each rule in full the first time this session reads its lines, then by id in one line, so the agent
// still sees which rules cover what it reads after its context was compacted. Without a session id (an
// older Claude Code), every read shows them in full.
const describeRead = (
  mapReader: MapReader,
  repoRoot: string,
  file: string,
  readLines: LineRange | null,
  conversationId: string | null,
): string[] => {
  const ruleSections = mapReader.listRuleSectionsInLines(file, readLines)
  const newestChangeLines = listNewestChangeLines(repoRoot, file, readLines, conversationId)
  const shownRuleLines =
    conversationId === null
      ? new Set<string>()
      : readStateFileLines(shownRulesFileOf(conversationId))
  const isShownBefore = (ruleSection: RuleSection): boolean =>
    shownRuleLines.has(shownRuleLineOf(repoRoot, ruleSection))
  const newRuleSections = ruleSections.filter((ruleSection) => !isShownBefore(ruleSection))
  const shownBeforeRuleNames = ruleSections
    .filter(isShownBefore)
    .map((ruleSection) => `${ruleSection.id}@${ruleSection.version ?? '?'}`)
  if (conversationId !== null) {
    const newShownRuleLines = newRuleSections.map((ruleSection) =>
      shownRuleLineOf(repoRoot, ruleSection),
    )
    appendToStateFile(shownRulesFileOf(conversationId), newShownRuleLines)
  }
  const shownBeforeLines =
    shownBeforeRuleNames.length === 0
      ? []
      : [
          `logicmap: these lines of ${file} are covered too by rules shown earlier this session: ${shownBeforeRuleNames.join(', ')}`,
        ]
  const newRulesLines =
    newRuleSections.length === 0
      ? []
      : [
          `logicmap: the rules covering ${file} (logicmap show <id> for the full entry):`,
          ...newRuleSections.map((ruleSection) => ruleSection.text),
        ]
  return [...newRulesLines, ...shownBeforeLines, ...newestChangeLines]
}

const respondToRead = (
  filePath: string,
  offset: unknown,
  limit: unknown,
  conversationId: string | null,
): HookOutput | null => {
  const repoRoot = findMappedRepoRoot(dirname(filePath))
  if (repoRoot === null) {
    return null
  }
  const file = toRepoPath(repoRoot, filePath)
  const readLines = toReadLines(offset, limit)
  return addContext(
    HOOK_EVENTS.postToolUse,
    describeRead(createMapReader(repoRoot), repoRoot, file, readLines, conversationId),
  )
}

// A problem belongs to the edited file when it sits there, or when a lock line of that file is gone.
const isProblemOfFile = (problem: Problem, file: string): boolean =>
  problem.file === file || problem.message.includes(` ${file}#`)

// A hunk header of git diff -U0: where its lines start in the file as it is now, and how many (1 when unsaid).
const DIFF_HUNK_HEADER_PATTERN = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/

// The lines of the file that differ from HEAD; a removal is the line before it. None for a file HEAD lacks, or
// when git fails: that costs the note on them only.
const listChangedLineRanges = (repoRoot: string, file: string): LineRange[] => {
  try {
    return execFileSync('git', ['diff', '-U0', '--no-color', '--no-ext-diff', 'HEAD', '--', file], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .flatMap((diffLine) => {
        const [, firstLineText, lineCountText = '1'] = DIFF_HUNK_HEADER_PATTERN.exec(diffLine) ?? []
        if (firstLineText === undefined) {
          return []
        }
        const firstLine = Math.max(Number(firstLineText), 1)
        return [{ firstLine, lastLine: firstLine + Math.max(Number(lineCountText), 1) - 1 }]
      })
  } catch {
    return []
  }
}

// A status entry of git status --porcelain is two status letters, a space, then the path.
const STATUS_ENTRY_PATH_START = 3

// The hook starts after the command ended, so the run is taken this much longer back: a file written in the
// command's first moments still falls inside it.
const COMMAND_RUN_SLACK_MS = 5000

type ChangedFile = { file: string; modifiedAtMs: number }

// When a file was last written; a deleted one takes its nearest directory still there, whose time the removal set.
const lastWrittenAtMsOf = (repoRoot: string, file: string): number =>
  statSync(join(repoRoot, file), { throwIfNoEntry: false })?.mtimeMs ??
  lastWrittenAtMsOf(repoRoot, dirname(file))

// The files that differ from HEAD or that git doesn't track yet, each with when it was last written. None when git
// fails.
const listFilesChangedSinceHead = (repoRoot: string): ChangedFile[] => {
  try {
    return execFileSync(
      'git',
      [
        '--no-optional-locks',
        'status',
        '--porcelain',
        '-z',
        '--no-renames',
        '--untracked-files=all',
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    )
      .split('\0')
      .filter(Boolean)
      .map((statusEntry) => {
        const file = statusEntry.slice(STATUS_ENTRY_PATH_START)
        return { file, modifiedAtMs: lastWrittenAtMsOf(repoRoot, file) }
      })
  } catch {
    return []
  }
}

const answeredEditLineOf = (repoRoot: string, { file, modifiedAtMs }: ChangedFile): string =>
  `${repoRoot} ${file} ${modifiedAtMs}`

// The files a command changed: written during its run, and answered by no hook yet as they are now. An input with
// no duration (an older Claude Code) gives no run to compare with, so every changed file counts.
const listFilesChangedByCommand = (
  repoRoot: string,
  durationMs: number | undefined,
): ChangedFile[] => {
  const runStartMs = durationMs === undefined ? 0 : Date.now() - durationMs - COMMAND_RUN_SLACK_MS
  const answeredEditLines = readStateFileLines(ANSWERED_EDITS_FILE)
  return listFilesChangedSinceHead(repoRoot).filter(
    (changedFile) =>
      changedFile.modifiedAtMs >= runStartMs &&
      !answeredEditLines.has(answeredEditLineOf(repoRoot, changedFile)),
  )
}

const recordAnsweredEdits = (repoRoot: string, changedFiles: ChangedFile[]): void =>
  appendToStateFile(
    ANSWERED_EDITS_FILE,
    changedFiles.map((changedFile) => answeredEditLineOf(repoRoot, changedFile)),
  )

const reliedOnRuleLineOf = (repoRoot: string, file: string, ruleSection: RuleSection): string =>
  `${repoRoot} ${file} ${ruleSection.id}@${ruleSection.version ?? '?'}`

// The rules whose uses or test sites cover lines changed since HEAD, which no lock fingerprints: each once per
// file and session, and none the file's errors already name.
const listReliedOnRuleLines = (
  repoRoot: string,
  file: string,
  referringRuleSections: RuleSection[],
  fileErrors: Problem[],
  conversationId: string | null,
): string[] => {
  const reliedOnRulesFile = conversationId === null ? null : reliedOnRulesFileOf(conversationId)
  const namedRuleLines =
    reliedOnRulesFile === null ? new Set<string>() : readStateFileLines(reliedOnRulesFile)
  const erroredIds = new Set(fileErrors.map((problem) => problem.id))
  const newRuleSections = referringRuleSections.filter(
    (ruleSection) =>
      !erroredIds.has(ruleSection.id) &&
      !namedRuleLines.has(reliedOnRuleLineOf(repoRoot, file, ruleSection)),
  )
  if (newRuleSections.length === 0) {
    return []
  }
  if (reliedOnRulesFile !== null) {
    appendToStateFile(
      reliedOnRulesFile,
      newRuleSections.map((ruleSection) => reliedOnRuleLineOf(repoRoot, file, ruleSection)),
    )
  }
  return [
    `logicmap: the edit to ${file} changed lines under these rules' uses or test sites, which check doesn't fingerprint. Read each rule against the new code (logicmap show <id>): the code under a §uses site must still rely on what the rule says, and a §test must still fail when the rule breaks.`,
    ...newRuleSections.map((ruleSection) => ruleSection.text),
  ]
}

// What an edit left to do in its file: the errors check reports there, and the rules relied on over its changed
// lines. A file with no anchors has no such rule, so git is not asked for its changed lines.
const describeEdit = (
  mapReader: MapReader,
  repoRoot: string,
  file: string,
  conversationId: string | null,
): string[] => {
  const fileErrors = mapReader.problems.filter(
    (problem) => problem.severity === PROBLEM_SEVERITIES.error && isProblemOfFile(problem, file),
  )
  const changedLineRanges = mapReader.isAnchoredFile(file)
    ? listChangedLineRanges(repoRoot, file)
    : []
  const referringRuleSections = mapReader.listReferringRuleSections(file, changedLineRanges)
  const reliedOnRuleLines = listReliedOnRuleLines(
    repoRoot,
    file,
    referringRuleSections,
    fileErrors,
    conversationId,
  )
  const errorLines =
    fileErrors.length === 0
      ? []
      : [
          `logicmap: the edit to ${file} left the map out of step with the code; each error says how to resolve it:`,
          ...fileErrors.map(formatProblem),
        ]
  return [...errorLines, ...reliedOnRuleLines]
}

const respondToEdit = (
  filePath: string,
  sessionId: string | null,
  conversationId: string | null,
): HookOutput | null => {
  const repoRoot = findMappedRepoRoot(dirname(filePath))
  if (repoRoot === null) {
    return null
  }
  const file = toRepoPath(repoRoot, filePath)
  if (sessionId !== null) {
    recordEditedRepo(sessionId, repoRoot)
  }
  const editContextLines = describeEdit(createMapReader(repoRoot), repoRoot, file, conversationId)
  recordAnsweredEdits(repoRoot, [{ file, modifiedAtMs: statSync(filePath).mtimeMs }])
  return addContext(HOOK_EVENTS.postToolUse, editContextLines)
}

// Past this many lines, a command's answer describes no more of the files it changed or read, and names them.
const BASH_CONTEXT_MAX_LINES = 40

// A heredoc's opening line, kept, and its body through the line holding its word, dropped: its text runs nothing.
const HEREDOC_BODY_PATTERN = /(<<-?[ \t]*(['"]?)(\w+)\2[^\n]*)\n[\s\S]*?\n[ \t]*\3[ \t]*(?=\n|$)/g
// One command between the shell's separators (`;`, `&`, `|`, a line break), quoted text never cut.
const COMMAND_SEGMENT_PATTERN = /(?:'[^']*'|"(?:\\.|[^"\\])*"|[^;&|\n'"])+/g
const QUOTED_WORD_PATTERN = /^(['"])(.*)\1$/
// The lines sed -n prints: `40,60p`, `40p` for one line, `40,$p` to the last.
const SED_PRINTED_LINES_PATTERN = /^(\d+)(?:,(\d+|\$))?p$/
const SED_LAST_LINE = '$'
const HOME_PATH_START = '~/'
// `2>/dev/null`, `2>&1`: where a command's errors go changes nothing of what it prints.
const ERRORS_REDIRECT_PATTERN = /^2>/
const REDIRECT_PATTERN = /[<>]/

type CommandRead = { filePath: string; readLines: LineRange | null }

const toAbsolutePath = (directory: string, typedPath: string): string =>
  typedPath.startsWith(HOME_PATH_START)
    ? join(homedir(), typedPath.slice(HOME_PATH_START.length))
    : resolve(directory, typedPath)

const isExistingFile = (filePath: string): boolean =>
  statSync(filePath, { throwIfNoEntry: false })?.isFile() === true

// The directories a command stands in, the input's cwd and then each `cd` target, and the files it prints with
// `sed -n` or `cat`. Claude Code gives the cwd the command ended in, so a file is looked for from the directory
// replayed up to its read, then from that cwd: `cd src && sed -n 1,3p room.ts` ended in src.
const walkCommand = (
  command: string,
  cwd: string,
): { directories: string[]; reads: CommandRead[] } => {
  const directories = [cwd]
  const reads: CommandRead[] = []
  const toReadPath = (currentDirectory: string, typedPath: string): string => {
    const replayedPath = toAbsolutePath(currentDirectory, typedPath)
    return isExistingFile(replayedPath) ? replayedPath : toAbsolutePath(cwd, typedPath)
  }
  const segments = command.replace(HEREDOC_BODY_PATTERN, '$1').match(COMMAND_SEGMENT_PATTERN) ?? []
  for (const segment of segments) {
    const [program, ...typedArguments] = segment
      .trim()
      .split(/\s+/)
      .map((shellWord) => shellWord.replace(QUOTED_WORD_PATTERN, '$2'))
    const programArguments = typedArguments.filter(
      (typedArgument) => !ERRORS_REDIRECT_PATTERN.test(typedArgument),
    )
    const currentDirectory = directories.at(-1) ?? cwd
    const [directoryChangeTarget = ''] = programArguments
    const [sedQuietFlag, sedPrintedLinesText = '', sedPrintedFile = ''] = programArguments
    const [, firstLineText, lastLineText = firstLineText] =
      SED_PRINTED_LINES_PATTERN.exec(sedPrintedLinesText) ?? []
    const catPrintedFiles = programArguments.filter(
      (programArgument) => !programArgument.startsWith('-'),
    )
    const isDirectoryChange = program === 'cd' && programArguments.length === 1
    const isSedOfLines =
      program === 'sed' &&
      sedQuietFlag === '-n' &&
      firstLineText !== undefined &&
      programArguments.length === 3
    const isCatOfFiles =
      program === 'cat' &&
      catPrintedFiles.length > 0 &&
      !programArguments.some((programArgument) => REDIRECT_PATTERN.test(programArgument))
    if (isDirectoryChange) {
      directories.push(toAbsolutePath(currentDirectory, directoryChangeTarget))
    }
    if (isSedOfLines) {
      const lastLine =
        lastLineText === SED_LAST_LINE ? Number.MAX_SAFE_INTEGER : Number(lastLineText)
      reads.push({
        filePath: toReadPath(currentDirectory, sedPrintedFile),
        readLines: { firstLine: Number(firstLineText), lastLine },
      })
    }
    if (isCatOfFiles) {
      reads.push(
        ...catPrintedFiles.map((typedPath) => ({
          filePath: toReadPath(currentDirectory, typedPath),
          readLines: null,
        })),
      )
    }
  }
  return { directories, reads }
}

// Each repo is analysed once per hook run, and only when something in it was read or changed.
const createMapReaderCache = (): ((repoRoot: string) => MapReader) => {
  const mapReaderByRepoRoot = new Map<string, MapReader>()
  return (repoRoot) => {
    const mapReader = mapReaderByRepoRoot.get(repoRoot) ?? createMapReader(repoRoot)
    mapReaderByRepoRoot.set(repoRoot, mapReader)
    return mapReader
  }
}

// What a command did to one file, described only while its answer has room.
type CommandFileEffect = { label: string; describe: () => string[] }

const respondToBash = (
  hookEventName: ToolHookEventName,
  command: string,
  cwd: string,
  durationMs: number | undefined,
  sessionId: string | null,
  conversationId: string | null,
): HookOutput | null => {
  const { directories, reads } = walkCommand(command, cwd)
  const mapReaderOf = createMapReaderCache()
  const mappedRepoRoots = new Set(
    [...new Set(directories)].flatMap((directory) => findMappedRepoRoot(directory) ?? []),
  )
  // The stop check is armed before anything is analysed, so a failing analysis still leaves it armed.
  const changeEffects = [...mappedRepoRoots].flatMap((repoRoot): CommandFileEffect[] => {
    const changedFiles = listFilesChangedByCommand(repoRoot, durationMs)
    if (sessionId !== null && changedFiles.length > 0) {
      recordEditedRepo(sessionId, repoRoot)
    }
    return changedFiles.map((changedFile) => ({
      label: `${changedFile.file} (changed)`,
      describe: () => {
        const editContextLines = describeEdit(
          mapReaderOf(repoRoot),
          repoRoot,
          changedFile.file,
          conversationId,
        )
        recordAnsweredEdits(repoRoot, [changedFile])
        return editContextLines
      },
    }))
  })
  const readEffects = reads
    .filter(({ filePath }) => isExistingFile(filePath))
    .flatMap(({ filePath, readLines }): CommandFileEffect[] => {
      const repoRoot = findMappedRepoRoot(dirname(filePath))
      if (repoRoot === null) {
        return []
      }
      const file = toRepoPath(repoRoot, filePath)
      return [
        {
          label: `${file} (read)`,
          describe: () =>
            describeRead(mapReaderOf(repoRoot), repoRoot, file, readLines, conversationId),
        },
      ]
    })
  const contextLines: string[] = []
  const leftOutLabels: string[] = []
  for (const fileEffect of [...changeEffects, ...readEffects]) {
    const hasRoom = contextLines.length < BASH_CONTEXT_MAX_LINES
    if (hasRoom) {
      contextLines.push(...fileEffect.describe().flatMap((contextText) => contextText.split('\n')))
    } else {
      leftOutLabels.push(fileEffect.label)
    }
  }
  const leftOutLines =
    leftOutLabels.length === 0
      ? []
      : [
          `logicmap: past ${BASH_CONTEXT_MAX_LINES} lines, these were not looked at: ${leftOutLabels.join(', ')}. logicmap check lists every error, logicmap show <file> a file's rules.`,
        ]
  return addContext(hookEventName, [...contextLines, ...leftOutLines])
}

// Without a session id (an older Claude Code), every stop in a mapped repo is asked.
const respondToStop = (
  cwd: string,
  sessionId: string | null,
  isStopHookActive: boolean,
): HookOutput | null => {
  if (isStopHookActive) {
    return null
  }
  const repoRoot = findMappedRepoRoot(cwd)
  if (repoRoot === null) {
    return null
  }
  const didSessionEditRepo = sessionId === null || takeEditedRepos(sessionId).has(repoRoot)
  if (!didSessionEditRepo) {
    return null
  }
  const errors = checkRepo(repoRoot).filter(
    (problem) => problem.severity === PROBLEM_SEVERITIES.error,
  )
  if (errors.length === 0) {
    return null
  }
  const listedErrors = errors.slice(0, STOP_REASON_MAX_ERRORS).map(formatProblem)
  const unlistedCount = errors.length - listedErrors.length
  const unlistedNote = unlistedCount === 0 ? [] : [`... and ${unlistedCount} more (logicmap check)`]
  return {
    decision: 'block',
    reason: [
      `logicmap check has ${errors.length} errors. Resolve them (ack an entry that still holds, bump one whose meaning changed, fix an anchor), or tell the user why they stay, such as another session's work in progress:`,
      ...listedErrors,
      ...unlistedNote,
    ].join('\n'),
  }
}

export const respondToHook = (input: HookInput): HookOutput | null => {
  const sessionId = input.session_id ?? null
  // A subagent's input holds its session's id and its own agent id: what it was shown is its own.
  const conversationId =
    sessionId === null || input.agent_id === undefined
      ? sessionId
      : `${sessionId}.${input.agent_id}`
  const hookEventName = input.hook_event_name
  if (isToolHookEventName(hookEventName) && input.tool_name === BASH_TOOL_NAME) {
    const command = input.tool_input?.command
    return respondToBash(
      hookEventName,
      typeof command === 'string' ? command : '',
      input.cwd ?? process.cwd(),
      input.duration_ms,
      sessionId,
      conversationId,
    )
  }
  const filePath = input.tool_input?.file_path
  const isPostToolUse = hookEventName === HOOK_EVENTS.postToolUse
  if (isPostToolUse && typeof filePath === 'string') {
    if (input.tool_name === READ_TOOL_NAME) {
      return respondToRead(
        filePath,
        input.tool_input?.offset,
        input.tool_input?.limit,
        conversationId,
      )
    }
    if (EDITING_TOOL_NAMES.includes(input.tool_name ?? '')) {
      return respondToEdit(filePath, sessionId, conversationId)
    }
    return null
  }
  if (hookEventName === HOOK_EVENTS.postCompact) {
    if (conversationId !== null) {
      forgetWhatConversationWasShown(conversationId)
    }
    return null
  }
  if (hookEventName === HOOK_EVENTS.stop) {
    return respondToStop(input.cwd ?? process.cwd(), sessionId, input.stop_hook_active === true)
  }
  return null
}

// Claude Code's input arrives as JSON on stdin; a field of the wrong type is treated as absent.
const parseHookInput = (inputText: string): HookInput | null => {
  const parsedInput: unknown = JSON.parse(inputText)
  const isObject = typeof parsedInput === 'object' && parsedInput !== null
  if (!isObject || !('hook_event_name' in parsedInput)) {
    return null
  }
  const {
    hook_event_name,
    session_id,
    agent_id,
    cwd,
    tool_name,
    tool_input,
    duration_ms,
    stop_hook_active,
  } = parsedInput as Record<string, unknown>
  if (typeof hook_event_name !== 'string') {
    return null
  }
  const isToolInputObject = typeof tool_input === 'object' && tool_input !== null
  return {
    hook_event_name,
    session_id: typeof session_id === 'string' ? session_id : undefined,
    agent_id: typeof agent_id === 'string' ? agent_id : undefined,
    cwd: typeof cwd === 'string' ? cwd : undefined,
    tool_name: typeof tool_name === 'string' ? tool_name : undefined,
    tool_input: isToolInputObject ? (tool_input as HookInput['tool_input']) : undefined,
    duration_ms: typeof duration_ms === 'number' ? duration_ms : undefined,
    stop_hook_active: stop_hook_active === true,
  }
}

if (import.meta.main) {
  const hookInput = parseHookInput(await Bun.stdin.text())
  const hookOutput = hookInput === null ? null : respondToHook(hookInput)
  if (hookOutput !== null) {
    console.log(JSON.stringify(hookOutput))
  }
}
