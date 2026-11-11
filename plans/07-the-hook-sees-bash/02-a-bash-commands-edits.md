# Step 2: A Bash command's edits are inspected

Before: `bun test` 53 pass (step 1 changed no behaviour).

## Piece 1: the failing tests
What: two tests in `describe('hook')`. The first: a Bash command that changed an anchored file is answered with
that file's errors, under the event that fired (`PostToolUse`, or `PostToolUseFailure` for a command that exited
non-zero); the same content is answered once; the Stop check is armed. The second: a file last written before the
command ran is not the command's (and arms nothing), unless the input has no `duration_ms`; a file an Edit was
answered for is not answered again by the Bash command after it; outside a mapped repo, nothing.
Why: the plan's decisions 1 and 2. The hook's input for Bash was read from a real session: `cwd`,
`tool_input.command`, `duration_ms`, on both events.
Where: `scripts/logicmap.test.ts`, at the end of `describe('hook')`; `utimesSync` joins the `node:fs` import.
```ts
  test('after a Bash command, succeeded or failed, the errors of each file it changed, once, and the stop check armed', () => {
    const repoRoot = createMappedRepo()
    commitFixtureRepo(repoRoot, 'wip: the join')
    const sessionId = `editing-${crypto.randomUUID()}`
    const outputOfBash = (hookEventName: string) => {
      const hookOutput = respondToHook({
        hook_event_name: hookEventName,
        session_id: sessionId,
        cwd: repoRoot,
        tool_name: 'Bash',
        tool_input: { command: 'python3 rewrite-room.py' },
        duration_ms: 40,
      })
      return hookOutput !== null && 'hookSpecificOutput' in hookOutput
        ? hookOutput.hookSpecificOutput
        : null
    }
    const rewriteRoom = (from: string, to: string): void =>
      writeFixtureFiles(repoRoot, {
        'src/room.ts': readFixtureFile(repoRoot, 'src/room.ts').replace(from, to),
      })

    expect(outputOfBash('PostToolUse')).toBeNull()

    rewriteRoom('removeConnection(connection)', 'removeConnection(connection, true)')
    const succeededOutput = outputOfBash('PostToolUse')
    expect(succeededOutput?.hookEventName).toBe('PostToolUse')
    expect(succeededOutput?.additionalContext).toContain('src/room.ts:2: error changed')
    expect(outputOfBash('PostToolUse')).toBeNull()

    rewriteRoom('connection, true', 'connection, false')
    const failedOutput = outputOfBash('PostToolUseFailure')
    expect(failedOutput?.hookEventName).toBe('PostToolUseFailure')
    expect(failedOutput?.additionalContext).toContain('src/room.ts:2: error changed')

    expect(
      respondToHook({ hook_event_name: 'Stop', session_id: sessionId, cwd: repoRoot }),
    ).toMatchObject({ decision: 'block' })
  })

  test('a Bash command answers for what it changed: not a file written before it ran, not one an Edit was answered for', () => {
    const repoRoot = createMappedRepo()
    commitFixtureRepo(repoRoot, 'wip: the join')
    const roomPath = join(repoRoot, 'src/room.ts')
    const rewriteRoom = (from: string, to: string): void =>
      writeFixtureFiles(repoRoot, {
        'src/room.ts': readFixtureFile(repoRoot, 'src/room.ts').replace(from, to),
      })
    const outputOfBash = (sessionId: string, cwd: string, durationMs: number | undefined) =>
      respondToHook({
        hook_event_name: 'PostToolUse',
        session_id: sessionId,
        cwd,
        tool_name: 'Bash',
        tool_input: { command: 'bun test' },
        duration_ms: durationMs,
      })

    rewriteRoom('removeConnection(connection)', 'removeConnection(connection, true)')
    const aMinuteAgo = new Date(Date.now() - 60_000)
    utimesSync(roomPath, aMinuteAgo, aMinuteAgo)
    const laterSessionId = `later-${crypto.randomUUID()}`
    expect(outputOfBash(laterSessionId, repoRoot, 40)).toBeNull()
    expect(
      respondToHook({ hook_event_name: 'Stop', session_id: laterSessionId, cwd: repoRoot }),
    ).toBeNull()
    expect(
      JSON.stringify(outputOfBash(`untimed-${crypto.randomUUID()}`, repoRoot, undefined)),
    ).toContain('src/room.ts:2: error changed')

    const editingSessionId = `editing-${crypto.randomUUID()}`
    rewriteRoom('connection, true', 'connection, false')
    const editOutput = respondToHook({
      hook_event_name: 'PostToolUse',
      session_id: editingSessionId,
      tool_name: 'Edit',
      tool_input: { file_path: roomPath },
    })
    expect(JSON.stringify(editOutput)).toContain('src/room.ts:2: error changed')
    expect(outputOfBash(editingSessionId, repoRoot, 40)).toBeNull()

    const plainRepoRoot = createFixtureRepo({ 'src/plain.ts': 'export const plain = 1\n' })
    expect(outputOfBash(`plain-${crypto.randomUUID()}`, plainRepoRoot, 40)).toBeNull()
  })
```
Run (red): `bun test -t "Bash command"`: 0 pass, 2 fail. The first: `Expected: "PostToolUse"`, `Received: undefined`
(the hook says nothing for Bash); the second: `Expected to contain: "src/room.ts:2: error changed"`, `Received: "null"`.

## Piece 2: the files a command changed
What: `listFilesChangedByCommand(repoRoot, durationMs, sessionId)`: what `git status` lists (differing from HEAD, or
untracked), kept when last written inside the command's run and not yet answered for at that writing. The session
keeps what it answered for in `<session>.inspected-edits.txt`, one line per file and modification time; the Edit
hook writes there too.
Why: plan, decision 1. `--no-renames` makes every status entry `XY <path>`, so no entry carries a second path;
`--no-optional-locks` keeps the hook from taking the index lock under a git command the agent runs next. The 5 s
before the run cover the hook's own start, which comes after the command's end: without them a file written in a
40 ms script would fall before `now - duration_ms`.
Where: `scripts/hook.ts`, after `listChangedLineRanges`
```ts
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
      ['--no-optional-locks', 'status', '--porcelain', '-z', '--no-renames', '--untracked-files=all'],
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
```

## Piece 3: the hook answers a Bash command
What: `respondToBash`: in the mapped repo of the command's directory, each changed file is described as an edit is,
from one map reader; the session's Stop check is armed and the files are recorded as answered for. `respondToHook`
sends it both tool events of a Bash call; `HOOK_EVENTS` gains `postToolUseFailure`, `HookInput` gains
`tool_input.command` and `duration_ms`, and `respondToEdit` records its file as answered for. At most
`BASH_CONTEXT_MAX_LINES` lines of context, then a pointer to `check`.
Why: plan, decisions 1 and 2. A command that changed nothing never analyses the repo: it costs one `git rev-parse`
and one `git status`. The cap is for a command that changes many files at once (a codemod, a stash popped): what it
left to do is `check`'s to list, not the context's.
Where: `scripts/hook.ts:36-49` (events, input), after `respondToEdit` (`respondToBash`), `respondToHook`,
`parseHookInput`
```ts
// A command that changes many files is told this many lines at most; check lists the rest.
const BASH_CONTEXT_MAX_LINES = 40

const respondToBash = (
  hookEventName: ToolHookEventName,
  cwd: string,
  durationMs: number | undefined,
  sessionId: string | null,
): HookOutput | null => {
  const repoRoot = findMappedRepoRoot(cwd)
  if (repoRoot === null) {
    return null
  }
  const changedFiles = listFilesChangedByCommand(repoRoot, durationMs, sessionId)
  if (changedFiles.length === 0) {
    return null
  }
  if (sessionId !== null) {
    recordEditedRepo(sessionId, repoRoot)
    recordInspectedEdits(sessionId, repoRoot, changedFiles)
  }
  const mapReader = createMapReader(repoRoot)
  const contextLines = changedFiles
    .flatMap(({ file }) => describeEdit(mapReader, repoRoot, file, sessionId))
    .flatMap((contextText) => contextText.split('\n'))
  const isOverMaxLines = contextLines.length > BASH_CONTEXT_MAX_LINES
  return addContext(
    hookEventName,
    isOverMaxLines
      ? [
          ...contextLines.slice(0, BASH_CONTEXT_MAX_LINES),
          `logicmap: ... and ${contextLines.length - BASH_CONTEXT_MAX_LINES} more lines: logicmap check lists every error.`,
        ]
      : contextLines,
  )
}
```
```diff
 export const respondToHook = (input: HookInput): HookOutput | null => {
+  const sessionId = input.session_id ?? null
+  const hookEventName = input.hook_event_name
+  if (isToolHookEventName(hookEventName) && input.tool_name === BASH_TOOL_NAME) {
+    return respondToBash(hookEventName, input.cwd ?? process.cwd(), input.duration_ms, sessionId)
+  }
   const filePath = input.tool_input?.file_path
-  const isPostToolUse = input.hook_event_name === HOOK_EVENTS.postToolUse
+  const isPostToolUse = hookEventName === HOOK_EVENTS.postToolUse
   // ...unchanged: Read, the editing tools, Stop, with sessionId in place of input.session_id ?? null...
```
Run (green): `bun test`: 55 pass, 0 fail. Beyond the code shown: `statSync` joins the `node:fs` import;
`isToolHookEventName` narrows the event's name; `recordInspectedEdits` appends the lines; `respondToEdit` records
`{ file, modifiedAtMs: statSync(filePath).mtimeMs }`; `parseHookInput` passes `duration_ms` when it is a number.
