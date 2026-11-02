import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import {
  LEDGER_DIRECTORY,
  type LineRange,
  type NewestLinesChange,
  PROBLEM_SEVERITIES,
  type Problem,
  type RuleSection,
  checkRepo,
  findNewestLinesChange,
  formatProblem,
  listRuleSectionsInLines,
} from './logicmap.ts'

/*
 * Claude Code hook: puts the map in front of the agent while it reads and edits mapped code.
 *
 *   PostToolUse Read                      → the rules covering the lines just read, in full the first
 *                                           time a session reads them, then by id; and, the first time
 *                                           it reads a committed code file, the newest change of the
 *                                           lines read and the logicmap why command
 *   PostToolUse Edit / MultiEdit / Write  → what check reports for the edited file's rules
 *   Stop                                  → check's errors, once, so the agent resolves them or says
 *                                           why they stay; only for a session that edited the repo
 *                                           since its last stop
 *
 * It answers only inside a git repo that has a logicmap/ folder; anywhere else it prints nothing.
 */

export const HOOK_EVENTS = { postToolUse: 'PostToolUse', stop: 'Stop' } as const

const READ_TOOL_NAME = 'Read'
const EDITING_TOOL_NAMES: readonly string[] = ['Edit', 'MultiEdit', 'Write']

// The fields of Claude Code's hook input this hook reads.
export type HookInput = {
  hook_event_name: string
  session_id?: string
  cwd?: string
  tool_name?: string
  tool_input?: { file_path?: unknown; offset?: unknown; limit?: unknown }
  stop_hook_active?: boolean
}

export type HookOutput =
  | {
      hookSpecificOutput: {
        hookEventName: typeof HOOK_EVENTS.postToolUse
        additionalContext: string
      }
    }
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

const addContext = (additionalContext: string): HookOutput => ({
  hookSpecificOutput: { hookEventName: HOOK_EVENTS.postToolUse, additionalContext },
})

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

const readShownRuleLines = (sessionId: string): Set<string> => {
  const shownRulesFile = shownRulesFileOf(sessionId)
  return existsSync(shownRulesFile)
    ? new Set(readFileSync(shownRulesFile, 'utf8').split('\n').filter(Boolean))
    : new Set()
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
    namedChangesFile !== null &&
    existsSync(namedChangesFile) &&
    readFileSync(namedChangesFile, 'utf8').split('\n').includes(namedChangeLine)
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
  const ruleSections = listRuleSectionsInLines(repoRoot, file, readLines)
  const newestChangeLines = listNewestChangeLines(repoRoot, file, readLines, sessionId)
  if (ruleSections.length === 0 && newestChangeLines.length === 0) {
    return null
  }
  const shownRuleLines = sessionId === null ? new Set<string>() : readShownRuleLines(sessionId)
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
  return addContext([...newRulesLines, ...shownBeforeLines, ...newestChangeLines].join('\n'))
}

// A problem belongs to the edited file when it sits there, or when a lock line of that file is gone.
const isProblemOfFile = (problem: Problem, file: string): boolean =>
  problem.file === file || problem.message.includes(` ${file}#`)

const respondToEdit = (filePath: string, sessionId: string | null): HookOutput | null => {
  const repoRoot = findMappedRepoRoot(dirname(filePath))
  if (repoRoot === null) {
    return null
  }
  if (sessionId !== null) {
    recordEditedRepo(sessionId, repoRoot)
  }
  const file = toRepoPath(repoRoot, filePath)
  const fileErrors = checkRepo(repoRoot).filter(
    (problem) => problem.severity === PROBLEM_SEVERITIES.error && isProblemOfFile(problem, file),
  )
  if (fileErrors.length === 0) {
    return null
  }
  return addContext(
    [
      `logicmap: the edit to ${file} left the map out of step with the code. Re-read each entry (logicmap show <id>), then ack it if it still holds, or bump its version if its meaning changed:`,
      ...fileErrors.map(formatProblem),
    ].join('\n'),
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
  const filePath = input.tool_input?.file_path
  const isPostToolUse = input.hook_event_name === HOOK_EVENTS.postToolUse
  if (isPostToolUse && typeof filePath === 'string') {
    if (input.tool_name === READ_TOOL_NAME) {
      return respondToRead(
        filePath,
        input.tool_input?.offset,
        input.tool_input?.limit,
        input.session_id ?? null,
      )
    }
    if (EDITING_TOOL_NAMES.includes(input.tool_name ?? '')) {
      return respondToEdit(filePath, input.session_id ?? null)
    }
    return null
  }
  if (input.hook_event_name === HOOK_EVENTS.stop) {
    return respondToStop(
      input.cwd ?? process.cwd(),
      input.session_id ?? null,
      input.stop_hook_active === true,
    )
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
  const { hook_event_name, session_id, cwd, tool_name, tool_input, stop_hook_active } =
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
