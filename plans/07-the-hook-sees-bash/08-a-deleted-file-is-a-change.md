# Step 8: a deleted file is a change

## Piece 1: red, `rm` of an anchored file
What: a test in `describe('hook')`: a command deletes the committed, acked `src/room.ts`; its answer holds the `gone` error and the session's Stop blocks.
Why: a deleted file has no modification time, so the hook left it out: `check` had `gone` and `orphan-entry` errors, the hook answered nothing and Stop asked nothing (timing and data reviewers). Bash is the only tool that deletes a file, so no deletion was ever answered.
Where: scripts/logicmap.test.ts, after the test "a Bash command leaves out a version another session's hook answered…"
```ts
  test('a Bash command that deletes an anchored file is answered with its gone error, and the stop check armed', () => {
    const repoRoot = createMappedRepo()
    commitFixtureRepo(repoRoot, 'wip: the join')
    const sessionId = `deleting-${crypto.randomUUID()}`
    rmSync(join(repoRoot, 'src/room.ts'))
    const deleteOutput = respondToHook({
      hook_event_name: 'PostToolUse',
      session_id: sessionId,
      cwd: repoRoot,
      tool_name: 'Bash',
      tool_input: { command: 'rm src/room.ts' },
      duration_ms: 20,
    })
    expect(JSON.stringify(deleteOutput)).toContain('error gone')
    expect(
      respondToHook({ hook_event_name: 'Stop', session_id: sessionId, cwd: repoRoot }),
    ).toMatchObject({ decision: 'block' })
  })
```
Run, red: `Expected to contain: "error gone"`, `Received: "null"`.

## Piece 2: green, a deleted file takes its directory's time
What: `listFilesChangedSinceHead` gives every file git lists a time: its own, or for a file the disk lacks, the time of its nearest directory still there (`lastWrittenAtMsOf`, up the path to the repo root).
Why: removing a file writes its directory, so the directory's time falls inside the run of the command that removed it, and the time window, the answered record and the Stop arming all work as for any other change. Rejected: answering every deleted file once per session (one deleted long before is pinned on the first command after it); a time recorded per file when the hook last saw it (one more file to keep, for the same answer).
Where: scripts/hook.ts:327-349
```diff
-// The files that differ from HEAD or that git doesn't track yet, each with when it was last written. A deleted
-// file has no such time and is left out. None when git fails.
+// When a file was last written; a deleted one takes its nearest directory still there, whose time the removal set.
+const lastWrittenAtMsOf = (repoRoot: string, file: string): number =>
+  statSync(join(repoRoot, file), { throwIfNoEntry: false })?.mtimeMs ??
+  lastWrittenAtMsOf(repoRoot, dirname(file))
+
+// The files that differ from HEAD or that git doesn't track yet, each with when it was last written. None when git
+// fails.
 const listFilesChangedSinceHead = (repoRoot: string): ChangedFile[] => {
 // ...unchanged...
       .split('\0')
       .filter(Boolean)
-      .flatMap((statusEntry) => {
-        const file = statusEntry.slice(STATUS_ENTRY_PATH_START)
-        const modifiedAtMs = statSync(join(repoRoot, file), { throwIfNoEntry: false })?.mtimeMs
-        return modifiedAtMs === undefined ? [] : [{ file, modifiedAtMs }]
-      })
+      .map((statusEntry) => {
+        const file = statusEntry.slice(STATUS_ENTRY_PATH_START)
+        return { file, modifiedAtMs: lastWrittenAtMsOf(repoRoot, file) }
+      })
```
The walk ends: `dirname` of a top-level path is `.`, and the repo root is there.
Run, green: `bun test -t hook`, `13 pass, 0 fail`.
