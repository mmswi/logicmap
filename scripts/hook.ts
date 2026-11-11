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
// else), and the rules it was shown in full.
const SESSION_FILES_DIRECTORY = join(tmpdir(), 'logicmap-hook')
const sessionFileOf = (sessionId: string, fileSuffix: string): string =>
  join(SESSION_FILES_DIRECTORY, `${sessionId.replace(/[^\w-]/g, '_')}${fileSuffix}`)
const editedReposFileOf = (sessionId: string): string => sessionFileOf(sessionId, '.txt')
const shownRulesFileOf = (sessionId: string): string => sessionFileOf(sessionId, '.shown-rules.txt')
const namedChangesFileOf = (sessionId: string): string =>
  sessionFileOf(sessionId, '.named-changes.txt')
const reliedOnRulesFileOf = (sessionId: string): string =>
  sessionFileOf(sessionId, '.relied-on-rules.txt')
const inspectedEditsFileOf = (sessionId: string): string =>
  sessionFileOf(sessionId, '.inspected-edits.txt')

const appendToSessionFile = (sessionFile: string, lines: string[]): void => {
  mkdirSync(SESSION_FILES_DIRECTORY, { recursive: true })
  appendFileSync(sessionFile, lines.map((line) => `${line}\n`).join(''))
}

// git prints the repo root with symlinks resolved (macOS: /var → /private/var), so the path is too.
const recordEditedRepo = (sessionId: string, repoRoot: string): void =>
  appendToSessionFile(editedReposFileOf(sessionId), [repoRoot])

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

const readSessionFileLines = (sessionFile: string): Set<string> =>
  existsSync(sessionFile)
    ? new Set(readFileSync(sessionFile, 'utf8').split('\n').filter(Boolean))
    : new Set()

// What a session was shown once is gone from its context after a compaction, so it is shown again.
const forgetWhatSessionWasShown = (sessionId: string): void => {
  const shownOnceFiles = [
    shownRulesFileOf(sessionId),
    namedChangesFileOf(sessionId),
    reliedOnRulesFileOf(sessionId),
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
  sessionId: string | null,
): string[] => {
  const isCodeFile = !file.endsWith('.md') && !file.startsWith(`${LEDGER_DIRECTORY}/`)
  const namedChangeLine = `${repoRoot} ${file}`
  const namedChangesFile = sessionId === null ? null : namedChangesFileOf(sessionId)
  const isNamedBefore =
    namedChangesFile !== null && readSessionFileLines(namedChangesFile).has(namedChangeLine)
  if (!isCodeFile || isNamedBefore) {
    return []
  }
  try {
    const newestChange = findNewestLinesChange(repoRoot, file, readLines)
    if (newestChange === null) {
      return []
    }
    if (namedChangesFile !== null) {
      appendToSessionFile(namedChangesFile, [namedChangeLine])
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
  sessionId: string | null,
): string[] => {
  const ruleSections = mapReader.listRuleSectionsInLines(file, readLines)
  const newestChangeLines = listNewestChangeLines(repoRoot, file, readLines, sessionId)
  const shownRuleLines =
    sessionId === null ? new Set<string>() : readSessionFileLines(shownRulesFileOf(sessionId))
  const isShownBefore = (ruleSection: RuleSection): boolean =>
    shownRuleLines.has(shownRuleLineOf(repoRoot, ruleSection))
  const newRuleSections = ruleSections.filter((ruleSection) => !isShownBefore(ruleSection))
  const shownBeforeRuleNames = ruleSections
    .filter(isShownBefore)
    .map((ruleSection) => `${ruleSection.id}@${ruleSection.version ?? '?'}`)
  if (sessionId !== null) {
    const newShownRuleLines = newRuleSections.map((ruleSection) =>
      shownRuleLineOf(repoRoot, ruleSection),
    )
    appendToSessionFile(shownRulesFileOf(sessionId), newShownRuleLines)
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
  sessionId: string | null,
): HookOutput | null => {
  const repoRoot = findMappedRepoRoot(dirname(filePath))
  if (repoRoot === null) {
    return null
  }
  const file = toRepoPath(repoRoot, filePath)
  const readLines = toReadLines(offset, limit)
  return addContext(
    HOOK_EVENTS.postToolUse,
    describeRead(createMapReader(repoRoot), repoRoot, file, readLines, sessionId),
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

// The files that differ from HEAD or that git doesn't track yet, each with when it was last written. A deleted
// file has no such time and is left out. None when git fails.
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
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
      .split('\0')
      .filter(Boolean)
      .flatMap((statusEntry) => {
        const file = statusEntry.slice(STATUS_ENTRY_PATH_START)
        const modifiedAtMs = statSync(join(repoRoot, file), { throwIfNoEntry: false })?.mtimeMs
        return modifiedAtMs === undefined ? [] : [{ file, modifiedAtMs }]
      })
  } catch {
    return []
  }
}

const inspectedEditLineOf = (repoRoot: string, { file, modifiedAtMs }: ChangedFile): string =>
  `${repoRoot} ${file} ${modifiedAtMs}`

// The files a command changed: written during its run, and not answered for yet as they are now. An input with
// no duration (an older Claude Code) gives no run to compare with, so every changed file counts.
const listFilesChangedByCommand = (
  repoRoot: string,
  durationMs: number | undefined,
  sessionId: string | null,
): ChangedFile[] => {
  const runStartMs = durationMs === undefined ? 0 : Date.now() - durationMs - COMMAND_RUN_SLACK_MS
  const inspectedEditLines =
    sessionId === null ? new Set<string>() : readSessionFileLines(inspectedEditsFileOf(sessionId))
  return listFilesChangedSinceHead(repoRoot).filter(
    (changedFile) =>
      changedFile.modifiedAtMs >= runStartMs &&
      !inspectedEditLines.has(inspectedEditLineOf(repoRoot, changedFile)),
  )
}

const recordInspectedEdits = (
  sessionId: string,
  repoRoot: string,
  changedFiles: ChangedFile[],
): void =>
  appendToSessionFile(
    inspectedEditsFileOf(sessionId),
    changedFiles.map((changedFile) => inspectedEditLineOf(repoRoot, changedFile)),
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
  sessionId: string | null,
): string[] => {
  const reliedOnRulesFile = sessionId === null ? null : reliedOnRulesFileOf(sessionId)
  const namedRuleLines =
    reliedOnRulesFile === null ? new Set<string>() : readSessionFileLines(reliedOnRulesFile)
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
    appendToSessionFile(
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
  sessionId: string | null,
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
    sessionId,
  )
  const errorLines =
    fileErrors.length === 0
      ? []
      : [
          `logicmap: the edit to ${file} left the map out of step with the code. Re-read each entry (logicmap show <id>), then ack it if it still holds, or bump its version if its meaning changed:`,
          ...fileErrors.map(formatProblem),
        ]
  return [...errorLines, ...reliedOnRuleLines]
}

const respondToEdit = (filePath: string, sessionId: string | null): HookOutput | null => {
  const repoRoot = findMappedRepoRoot(dirname(filePath))
  if (repoRoot === null) {
    return null
  }
  const file = toRepoPath(repoRoot, filePath)
  if (sessionId !== null) {
    recordEditedRepo(sessionId, repoRoot)
    recordInspectedEdits(sessionId, repoRoot, [{ file, modifiedAtMs: statSync(filePath).mtimeMs }])
  }
  return addContext(
    HOOK_EVENTS.postToolUse,
    describeEdit(createMapReader(repoRoot), repoRoot, file, sessionId),
  )
}

// A command that changes many files is told this many lines at most; check lists the rest.
const BASH_CONTEXT_MAX_LINES = 40

const COMMAND_SEPARATOR_PATTERN = /&&|\|\||[;|\n]/
const QUOTED_WORD_PATTERN = /^(['"])(.*)\1$/
// The lines sed -n prints: `40,60p`, or `40p` for one line.
const SED_PRINTED_LINES_PATTERN = /^(\d+)(?:,(\d+))?p$/
const HOME_PATH_START = '~/'
// `2>/dev/null`, `2>&1`: where a command's errors go changes nothing of what it prints.
const ERRORS_REDIRECT_PATTERN = /^2>/
const REDIRECT_PATTERN = /[<>]/

type CommandRead = { filePath: string; readLines: LineRange | null }

const toAbsolutePath = (directory: string, typedPath: string): string =>
  typedPath.startsWith(HOME_PATH_START)
    ? join(homedir(), typedPath.slice(HOME_PATH_START.length))
    : resolve(directory, typedPath)

// The directories a command stands in, the session's first and then each `cd` target, and the files it prints with
// `sed -n` or `cat`, each from the directory it stands in at that point.
const walkCommand = (
  command: string,
  cwd: string,
): { directories: string[]; reads: CommandRead[] } => {
  const directories = [cwd]
  const reads: CommandRead[] = []
  for (const segment of command.split(COMMAND_SEPARATOR_PATTERN)) {
    const [program, ...typedArguments] = segment
      .trim()
      .split(/\s+/)
      .map((shellWord) => shellWord.replace(QUOTED_WORD_PATTERN, '$2'))
    const programArguments = typedArguments.filter(
      (typedArgument) => !ERRORS_REDIRECT_PATTERN.test(typedArgument),
    )
    const currentDirectory = directories.at(-1) ?? cwd
    const [firstArgument = '', secondArgument = '', thirdArgument = ''] = programArguments
    const [, firstLineText, lastLineText = firstLineText] =
      SED_PRINTED_LINES_PATTERN.exec(secondArgument) ?? []
    const isDirectoryChange = program === 'cd' && programArguments.length === 1
    const isSedOfLines =
      program === 'sed' &&
      firstArgument === '-n' &&
      firstLineText !== undefined &&
      programArguments.length === 3
    const isCatOfFiles =
      program === 'cat' &&
      programArguments.length > 0 &&
      programArguments.every(
        (programArgument) =>
          !programArgument.startsWith('-') && !REDIRECT_PATTERN.test(programArgument),
      )
    if (isDirectoryChange) {
      directories.push(toAbsolutePath(currentDirectory, firstArgument))
    }
    if (isSedOfLines) {
      reads.push({
        filePath: toAbsolutePath(currentDirectory, thirdArgument),
        readLines: { firstLine: Number(firstLineText), lastLine: Number(lastLineText) },
      })
    }
    if (isCatOfFiles) {
      reads.push(
        ...programArguments.map((typedPath) => ({
          filePath: toAbsolutePath(currentDirectory, typedPath),
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

const isExistingFile = (filePath: string): boolean =>
  statSync(filePath, { throwIfNoEntry: false })?.isFile() === true

const respondToBash = (
  hookEventName: ToolHookEventName,
  command: string,
  cwd: string,
  durationMs: number | undefined,
  sessionId: string | null,
): HookOutput | null => {
  const { directories, reads } = walkCommand(command, cwd)
  const mapReaderOf = createMapReaderCache()
  const readContextLines = reads
    .filter(({ filePath }) => isExistingFile(filePath))
    .flatMap(({ filePath, readLines }) => {
      const repoRoot = findMappedRepoRoot(dirname(filePath))
      return repoRoot === null
        ? []
        : describeRead(
            mapReaderOf(repoRoot),
            repoRoot,
            toRepoPath(repoRoot, filePath),
            readLines,
            sessionId,
          )
    })
  const mappedRepoRoots = new Set(
    [...new Set(directories)].flatMap((directory) => findMappedRepoRoot(directory) ?? []),
  )
  const editContextLines = [...mappedRepoRoots].flatMap((repoRoot) => {
    const changedFiles = listFilesChangedByCommand(repoRoot, durationMs, sessionId)
    if (changedFiles.length === 0) {
      return []
    }
    if (sessionId !== null) {
      recordEditedRepo(sessionId, repoRoot)
      recordInspectedEdits(sessionId, repoRoot, changedFiles)
    }
    return changedFiles.flatMap(({ file }) =>
      describeEdit(mapReaderOf(repoRoot), repoRoot, file, sessionId),
    )
  })
  const contextLines = [...readContextLines, ...editContextLines].flatMap((contextText) =>
    contextText.split('\n'),
  )
  const isOverMaxLines = contextLines.length > BASH_CONTEXT_MAX_LINES
  return addContext(
    hookEventName,
    isOverMaxLines
      ? [
          ...contextLines.slice(0, BASH_CONTEXT_MAX_LINES),
          `logicmap: ... and ${contextLines.length - BASH_CONTEXT_MAX_LINES} more lines: logicmap check lists every error, logicmap show <file> a file's rules.`,
        ]
      : contextLines,
  )
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
  const hookEventName = input.hook_event_name
  if (isToolHookEventName(hookEventName) && input.tool_name === BASH_TOOL_NAME) {
    const command = input.tool_input?.command
    return respondToBash(
      hookEventName,
      typeof command === 'string' ? command : '',
      input.cwd ?? process.cwd(),
      input.duration_ms,
      sessionId,
    )
  }
  const filePath = input.tool_input?.file_path
  const isPostToolUse = hookEventName === HOOK_EVENTS.postToolUse
  if (isPostToolUse && typeof filePath === 'string') {
    if (input.tool_name === READ_TOOL_NAME) {
      return respondToRead(filePath, input.tool_input?.offset, input.tool_input?.limit, sessionId)
    }
    if (EDITING_TOOL_NAMES.includes(input.tool_name ?? '')) {
      return respondToEdit(filePath, sessionId)
    }
    return null
  }
  if (hookEventName === HOOK_EVENTS.postCompact) {
    if (sessionId !== null) {
      forgetWhatSessionWasShown(sessionId)
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
  const { hook_event_name, session_id, cwd, tool_name, tool_input, duration_ms, stop_hook_active } =
    parsedInput as Record<string, unknown>
  if (typeof hook_event_name !== 'string') {
    return null
  }
  const isToolInputObject = typeof tool_input === 'object' && tool_input !== null
  return {
    hook_event_name,
    session_id: typeof session_id === 'string' ? session_id : undefined,
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
