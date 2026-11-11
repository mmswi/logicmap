# Step 9: the answer holds what it records

## Piece 1: red, a command that changes one file and reads two
What: a test in `describe('hook')`: a command changes `src/room.ts`, then prints `src/many.ts` (25 rules) and `src/extra.ts` (one rule). The answer opens with the change's error, holds every rule of `src/many.ts`, and its last line names `src/extra.ts` as not looked at; a Read of `src/extra.ts` afterwards shows its rule in full.
Why: the answer was cut at 40 lines after `describeRead` and `describeEdit` had recorded every rule as shown, every newest change as named and every relied-on rule as told, so what the cut dropped was later named as "shown earlier this session" and never shown (all three reviewers). Reads came first, so the cut took the edit's errors before a long read's rules.
Where: scripts/logicmap.test.ts, after the test "a Bash command that deletes an anchored file…"
```ts
  test('a Bash answer describes what the command changed, then read, while under forty lines, names the rest, and records only what it printed', () => {
    const ruleNumbers = Array.from({ length: 25 }, (_, ruleIndex) =>
      String(ruleIndex + 1).padStart(2, '0'),
    )
    const decisionEntryOf = (ruleId: string): string =>
      [`## ${ruleId}`, 'kind: decision', 'version: 1', 'what: A rule.', 'why: fixture.', 'source: fixture', ''].join('\n')
    const repoRoot = createFixtureRepo({
      'src/room.ts': [
        '// §edge sync.close-during-join@1',
        'if (closedEarly) {',
        '  joined.removeConnection(connection)',
        '}',
        '',
      ].join('\n'),
      'src/many.ts': ruleNumbers
        .flatMap((ruleNumber) => [`// §decision sync.rule-${ruleNumber}@1`, `const rule${ruleNumber} = 1`])
        .join('\n'),
      'src/extra.ts': ['// §decision sync.extra-rule@1', 'const extra = 1', ''].join('\n'),
      'logicmap/sync.md': [
        closeDuringJoinEntry(1),
        ...ruleNumbers.map((ruleNumber) => decisionEntryOf(`sync.rule-${ruleNumber}`)),
        decisionEntryOf('sync.extra-rule'),
      ].join('\n'),
    })
    ackIds(repoRoot, [
      'sync.close-during-join',
      'sync.extra-rule',
      ...ruleNumbers.map((ruleNumber) => `sync.rule-${ruleNumber}`),
    ])
    commitFixtureRepo(repoRoot, 'wip: the rules')
    writeFixtureFiles(repoRoot, {
      'src/room.ts': readFixtureFile(repoRoot, 'src/room.ts').replace(
        'removeConnection(connection)',
        'removeConnection(connection, true)',
      ),
    })
    const sessionId = `capped-${crypto.randomUUID()}`
    const bashOutput = respondToHook({
      hook_event_name: 'PostToolUse',
      session_id: sessionId,
      cwd: repoRoot,
      tool_name: 'Bash',
      tool_input: { command: 'python3 rewrite-room.py && cat src/many.ts && cat src/extra.ts' },
      duration_ms: 30,
    })
    const contextLines =
      bashOutput !== null && 'hookSpecificOutput' in bashOutput
        ? bashOutput.hookSpecificOutput.additionalContext.split('\n')
        : []

    expect(contextLines[0]).toStartWith('logicmap: the edit to src/room.ts')
    expect(contextLines).toContain('sync.rule-25@1  decision  recorded  A rule.')
    expect(contextLines.at(-1)).toBe(
      "logicmap: past 40 lines, these were not looked at: src/extra.ts (read). logicmap check lists every error, logicmap show <file> a file's rules.",
    )
    const readOutput = respondToHook({
      hook_event_name: 'PostToolUse',
      session_id: sessionId,
      tool_name: 'Read',
      tool_input: { file_path: join(repoRoot, 'src/extra.ts') },
    })
    expect(JSON.stringify(readOutput)).toContain('sync.extra-rule@1  decision  recorded  A rule.')
  })
```
Run, red: `Expected to start with: "logicmap: the edit to src/room.ts"`, `Received: "logicmap: the rules covering src/many.ts …"`.

## Piece 2: green, each file described only while the answer has room
What: `respondToBash` turns each file the command changed, then each file it read, into a `CommandFileEffect`: a label and a `describe` that analyses and records it. They are described in that order while the answer is under 40 lines; the first is always described in full, and the ones past the cap are named in one closing line and never described, so nothing is recorded for them. The stop check is armed for a repo before any analysis; a change is recorded as answered after its description. `git status` gets the 64 MiB buffer the checker's git calls have.
Why: a session record is written by the description that prints it, so a file never described records nothing, and its rules are shown in full when the agent reads it next. Changes go first: their errors are what the stop check would block on. A single file's rules are never cut, as a Read of it is not. Arming the stop first means a crash in the analysis leaves the session asked at its stop (timing reviewer); recording after the description means a crash leaves the version unanswered (timing reviewer). Past Bun's 1 MiB default, `git status` threw ENOBUFS and the `catch` read it as no change, with 25,000 untracked files (data reviewer). Rejected: a budget handed into `describeRead` and `describeEdit` to cut inside a file (each would have to count and cut its own sections, for a case a Read of the same file does not cut either).
Where: scripts/hook.ts:470-471 (the constant's comment), 339-345 (the buffer), 563-640 (respondToBash)
```ts
// What a command did to one file, described only while its answer has room.
type CommandFileEffect = { label: string; describe: () => string[] }

const respondToBash = (
  hookEventName: ToolHookEventName,
  command: string,
  cwd: string,
  durationMs: number | undefined,
  sessionId: string | null,
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
          sessionId,
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
          describe: () => describeRead(mapReaderOf(repoRoot), repoRoot, file, readLines, sessionId),
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
```
```diff
-// A command that changes many files is told this many lines at most; check lists the rest.
+// Past this many lines, a command's answer describes no more of the files it changed or read, and names them.
 const BASH_CONTEXT_MAX_LINES = 40
```
```diff
-      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
+      {
+        cwd: repoRoot,
+        encoding: 'utf8',
+        maxBuffer: 64 * 1024 * 1024,
+        stdio: ['ignore', 'pipe', 'ignore'],
+      },
```
The buffer has no test of its own: a fixture with 25,000 files would be slower than the rest of the suite. The data reviewer's probe is rerun on it below.
Written as shown, except that a read's label is its file alone: a range up to the last line (step 10's `sed -n '2,$p'`) has no number to print, and the closing line sends the agent to `logicmap show <file>`.
Run, green: `bun test -t hook`, `14 pass, 0 fail`. The data reviewer's `probe-unseen.ts`, case c (1,300,015 bytes of `git status`): the change is answered and the stop blocks; cases a (edit and commit in one command) and b (`cp -p`) still answer nothing, the known limits in the plan.
