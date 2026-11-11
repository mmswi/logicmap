# Step 7: an edit another session answered is not this command's

## Piece 1: red, session B's edit, then session A's `git log`
What: a test in `describe('hook')`: session B edits `src/room.ts` and its Edit hook answers the error; session A then runs `git log --oneline -1`, which writes nothing: A gets no answer and A's Stop asks nothing.
Why: a command is held to every file written during its run plus 5 s, and the record of answered versions was per session, so A was told B's error, recorded as having edited the repo, and A's Stop blocked on B's work in progress (all three reviewers). That breaks the rule the hook states: another session's work in progress stops nobody else.
Where: scripts/logicmap.test.ts, after the test "a Bash command answers for what it changed…"
```ts
  test("a Bash command leaves out a version another session's hook answered, and arms no stop for it", () => {
    const repoRoot = createMappedRepo()
    commitFixtureRepo(repoRoot, 'wip: the join')
    const roomPath = join(repoRoot, 'src/room.ts')
    writeFixtureFiles(repoRoot, {
      'src/room.ts': readFixtureFile(repoRoot, 'src/room.ts').replace(
        'removeConnection(connection)',
        'removeConnection(connection, true)',
      ),
    })
    const editOutput = respondToHook({
      hook_event_name: 'PostToolUse',
      session_id: `editing-${crypto.randomUUID()}`,
      tool_name: 'Edit',
      tool_input: { file_path: roomPath },
    })
    expect(JSON.stringify(editOutput)).toContain('src/room.ts:2: error changed')

    const loggingSessionId = `logging-${crypto.randomUUID()}`
    const logOutput = respondToHook({
      hook_event_name: 'PostToolUse',
      session_id: loggingSessionId,
      cwd: repoRoot,
      tool_name: 'Bash',
      tool_input: { command: 'git log --oneline -1' },
      duration_ms: 30,
    })
    expect(logOutput).toBeNull()
    expect(
      respondToHook({ hook_event_name: 'Stop', session_id: loggingSessionId, cwd: repoRoot }),
    ).toBeNull()
  })
```
Run, red: `(fail) hook > a Bash command leaves out a version another session's hook answered…`: A's `git log` was answered with B's error.

## Piece 2: green, one record of answered versions for every session
What: the versions a hook answered (`repoRoot file modifiedAtMs`) go to one file, `answered-edits.txt`, shared by every session, in place of a file per session; a command is answered only for versions no hook answered. The Edit hook records its version after it described it. The helpers that read and append lines take the name of what they hold now, any state file: `HOOK_STATE_DIRECTORY`, `readStateFileLines`, `appendToStateFile`.
Why: B's Edit hook has already told B; the same version is never A's. The record per session kept a session from being told twice and nothing more. Rejected: a snapshot of the repo taken by a PreToolUse hook before each command (both reviewers' first choice): one more process before every Bash command, and a file written by the user's editor or another session's command during the run still differs between the two snapshots, so it fixes no more of this finding than the shared record. Those two writers stay a known limit, written in the plan.
Where: scripts/hook.ts:98-120, 353-381, 452-462, 578-588
```diff
-// What the hook keeps per session, one file each: …
-const SESSION_FILES_DIRECTORY = join(tmpdir(), 'logicmap-hook')
+// What the hook keeps per session, one file each: …
+const HOOK_STATE_DIRECTORY = join(tmpdir(), 'logicmap-hook')
 const sessionFileOf = (sessionId: string, fileSuffix: string): string =>
-  join(SESSION_FILES_DIRECTORY, …)
+  join(HOOK_STATE_DIRECTORY, …)
 // ...unchanged...
-const inspectedEditsFileOf = (sessionId: string): string =>
-  sessionFileOf(sessionId, '.inspected-edits.txt')
+// And for every session at once, the file versions a hook already answered: a command is answered only for the
+// versions no hook answered, so another session's edit is never its own.
+const ANSWERED_EDITS_FILE = join(HOOK_STATE_DIRECTORY, 'answered-edits.txt')

-const appendToSessionFile = (sessionFile: string, lines: string[]): void => {
-  mkdirSync(SESSION_FILES_DIRECTORY, { recursive: true })
-  appendFileSync(sessionFile, …)
+const appendToStateFile = (stateFile: string, lines: string[]): void => {
+  mkdirSync(HOOK_STATE_DIRECTORY, { recursive: true })
+  appendFileSync(stateFile, …)
 // ...unchanged...
-const inspectedEditLineOf = (repoRoot: string, { file, modifiedAtMs }: ChangedFile): string =>
+const answeredEditLineOf = (repoRoot: string, { file, modifiedAtMs }: ChangedFile): string =>
   `${repoRoot} ${file} ${modifiedAtMs}`

-// The files a command changed: written during its run, and not answered for yet as they are now. …
-const listFilesChangedByCommand = (repoRoot, durationMs, sessionId) => {
+// The files a command changed: written during its run, and answered by no hook yet as they are now. …
+const listFilesChangedByCommand = (repoRoot: string, durationMs: number | undefined): ChangedFile[] => {
   const runStartMs = …
-  const inspectedEditLines = sessionId === null ? new Set<string>() : readSessionFileLines(inspectedEditsFileOf(sessionId))
+  const answeredEditLines = readStateFileLines(ANSWERED_EDITS_FILE)
   return listFilesChangedSinceHead(repoRoot).filter(
     (changedFile) =>
       changedFile.modifiedAtMs >= runStartMs &&
-      !inspectedEditLines.has(inspectedEditLineOf(repoRoot, changedFile)),
+      !answeredEditLines.has(answeredEditLineOf(repoRoot, changedFile)),
   )
 }

-const recordInspectedEdits = (sessionId, repoRoot, changedFiles) =>
-  appendToSessionFile(inspectedEditsFileOf(sessionId), …)
+const recordAnsweredEdits = (repoRoot: string, changedFiles: ChangedFile[]): void =>
+  appendToStateFile(ANSWERED_EDITS_FILE, changedFiles.map((changedFile) => answeredEditLineOf(repoRoot, changedFile)))
 // ...unchanged...
 const respondToEdit = (filePath: string, sessionId: string | null): HookOutput | null => {
 // ...unchanged...
   if (sessionId !== null) {
     recordEditedRepo(sessionId, repoRoot)
-    recordInspectedEdits(sessionId, repoRoot, [{ file, modifiedAtMs: statSync(filePath).mtimeMs }])
   }
-  return addContext(HOOK_EVENTS.postToolUse, describeEdit(createMapReader(repoRoot), repoRoot, file, sessionId))
+  const editContextLines = describeEdit(createMapReader(repoRoot), repoRoot, file, sessionId)
+  recordAnsweredEdits(repoRoot, [{ file, modifiedAtMs: statSync(filePath).mtimeMs }])
+  return addContext(HOOK_EVENTS.postToolUse, editContextLines)
 }
 // ...unchanged...
-    const changedFiles = listFilesChangedByCommand(repoRoot, durationMs, sessionId)
+    const changedFiles = listFilesChangedByCommand(repoRoot, durationMs)
 // ...unchanged...
-      recordInspectedEdits(sessionId, repoRoot, changedFiles)
+    recordAnsweredEdits(repoRoot, changedFiles)
```
The other `appendToSessionFile` and `readSessionFileLines` calls take the new names unchanged.
Run, green: `bun test -t hook`, `12 pass, 0 fail`.
