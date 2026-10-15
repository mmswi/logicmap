import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import {
  LEDGER_DIRECTORY,
  type LineRange,
  PROBLEM_SEVERITIES,
  type Problem,
  checkRepo,
  formatProblem,
  showRulesInLines,
} from './logicmap.ts'

/*
 * Claude Code hook: puts the map in front of the agent while it reads and edits mapped code.
 *
 *   PostToolUse Read                      → the rules covering the lines just read
 *   PostToolUse Edit / MultiEdit / Write  → what check reports for the edited file's rules
 *   Stop                                  → check's errors, once, so the agent resolves them or says
 *                                           why they stay
 *
 * It answers only inside a git repo that has a logicmap/ folder; anywhere else it prints nothing.
 */

export const HOOK_EVENTS = { postToolUse: 'PostToolUse', stop: 'Stop' } as const

const READ_TOOL_NAME = 'Read'
const EDITING_TOOL_NAMES: readonly string[] = ['Edit', 'MultiEdit', 'Write']

// The fields of Claude Code's hook input this hook reads.
export type HookInput = {
  hook_event_name: string
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

// git prints the repo root with symlinks resolved (macOS: /var → /private/var), so the path is too.
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

const respondToRead = (filePath: string, offset: unknown, limit: unknown): HookOutput | null => {
  const repoRoot = findMappedRepoRoot(dirname(filePath))
  if (repoRoot === null) {
    return null
  }
  const file = toRepoPath(repoRoot, filePath)
  const rulesView = showRulesInLines(repoRoot, file, toReadLines(offset, limit))
  if (rulesView === null) {
    return null
  }
  return addContext(
    [
      `logicmap: the rules covering ${file} (logicmap show <id> for the full entry):`,
      rulesView,
    ].join('\n'),
  )
}

// A problem belongs to the edited file when it sits there, or when a lock line of that file is gone.
const isProblemOfFile = (problem: Problem, file: string): boolean =>
  problem.file === file || problem.message.includes(` ${file}#`)

const respondToEdit = (filePath: string): HookOutput | null => {
  const repoRoot = findMappedRepoRoot(dirname(filePath))
  if (repoRoot === null) {
    return null
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

const respondToStop = (cwd: string, isStopHookActive: boolean): HookOutput | null => {
  if (isStopHookActive) {
    return null
  }
  const repoRoot = findMappedRepoRoot(cwd)
  if (repoRoot === null) {
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
      return respondToRead(filePath, input.tool_input?.offset, input.tool_input?.limit)
    }
    if (EDITING_TOOL_NAMES.includes(input.tool_name ?? '')) {
      return respondToEdit(filePath)
    }
    return null
  }
  if (input.hook_event_name === HOOK_EVENTS.stop) {
    return respondToStop(input.cwd ?? process.cwd(), input.stop_hook_active === true)
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
  const { hook_event_name, cwd, tool_name, tool_input, stop_hook_active } = parsedInput as Record<
    string,
    unknown
  >
  if (typeof hook_event_name !== 'string') {
    return null
  }
  const isToolInputObject = typeof tool_input === 'object' && tool_input !== null
  return {
    hook_event_name,
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
