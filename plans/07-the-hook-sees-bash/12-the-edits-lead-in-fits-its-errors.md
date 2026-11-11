# Step 12: the edit's lead-in fits its errors

## Piece 1: red, an anchor with no entry
What: a test in `describe('hook')`: an edit adds an anchor whose id has no entry; the answer holds the `undocumented` error and not the lead-in telling to ack or bump.
Why: seen in the trial of the shorter skill: every edit's errors came under "Re-read each entry (logicmap show <id>), then ack it if it still holds, or bump its version if its meaning changed", which fits a lock error only. An `undocumented` anchor has no entry to re-read, ack or bump; its own message names the fix, as every error's does.
Where: scripts/logicmap.test.ts, before the stop test
```ts
  test('an edit that leaves an anchor with no entry is told its fix, not to ack or bump', () => {
    const repoRoot = createMappedRepo()
    const roomPath = join(repoRoot, 'src/room.ts')
    writeFixtureFiles(repoRoot, {
      'src/room.ts': readFixtureFile(repoRoot, 'src/room.ts').replace(
        '  flushPending()',
        '  // §edge sync.no-such-rule@1\n  flushPending()',
      ),
    })
    const editContext = JSON.stringify(
      respondToHook({
        hook_event_name: 'PostToolUse',
        session_id: `undocumented-${crypto.randomUUID()}`,
        tool_name: 'Edit',
        tool_input: { file_path: roomPath },
      }),
    )
    expect(editContext).toContain('error undocumented')
    expect(editContext).not.toContain('then ack it if it still holds')
  })
```
Run, red: `Expected to not contain: "then ack it if it still holds"`; the answer was the lead-in, then `src/room.ts:6: error undocumented: sync.no-such-rule has no entry: add "## sync.no-such-rule" to logicmap/sync.md`.

## Piece 2: green, a lead-in that sends to each error's own fix
What: the lead-in says the edit left the map out of step and that each error below says how to resolve it.
Why: each message of `check` names its fix (`changed`: re-read, ack or bump; `undocumented`: add the entry; `stale-pin`: re-verify, move the pin), so the lead-in only points at them. Rejected: one lead-in per kind of error (the messages already say it).
Where: scripts/hook.ts:454
```diff
-          `logicmap: the edit to ${file} left the map out of step with the code. Re-read each entry (logicmap show <id>), then ack it if it still holds, or bump its version if its meaning changed:`,
+          `logicmap: the edit to ${file} left the map out of step with the code; each error says how to resolve it:`,
```
Run, green: `bun test`, `72 pass, 0 fail`; tsc strict and biome clean.
