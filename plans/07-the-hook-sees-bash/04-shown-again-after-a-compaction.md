# Step 4: After a compaction, the rules are shown in full again

Before: `bun test` 56 pass.

## Piece 1: the failing test
What: one test in `describe('hook')`: a session reads a rule (in full), reads it again (named by id), is compacted,
reads it again: in full. Its Stop check, armed by an edit before the compaction, still fires after it.
Why: plan, decision 5: the compaction removed the claim from the context, and the session id stays the same, so
the hook's "shown" outlived what was shown.
Where: `scripts/logicmap.test.ts`, at the end of `describe('hook')`
```ts
  test('after a compaction, a rule shown before is shown in full again; the stop check stays armed', () => {
    const repoRoot = createMappedRepo()
    const roomPath = join(repoRoot, 'src/room.ts')
    const sessionId = `compacted-${crypto.randomUUID()}`
    const contextOfRead = (): string =>
      JSON.stringify(
        respondToHook({
          hook_event_name: 'PostToolUse',
          session_id: sessionId,
          tool_name: 'Read',
          tool_input: { file_path: roomPath },
        }),
      )
    const fullRuleText = 'sync.close-during-join@1  edge  recorded  The socket can close'
    writeFixtureFiles(repoRoot, {
      'src/room.ts': readFixtureFile(repoRoot, 'src/room.ts').replace(
        'removeConnection(connection)',
        'removeConnection(connection, true)',
      ),
    })
    respondToHook({
      hook_event_name: 'PostToolUse',
      session_id: sessionId,
      tool_name: 'Edit',
      tool_input: { file_path: roomPath },
    })

    expect(contextOfRead()).toContain(fullRuleText)
    expect(contextOfRead()).not.toContain(fullRuleText)
    expect(
      respondToHook({ hook_event_name: 'PostCompact', session_id: sessionId, cwd: repoRoot }),
    ).toBeNull()
    expect(contextOfRead()).toContain(fullRuleText)
    expect(
      respondToHook({ hook_event_name: 'Stop', session_id: sessionId, cwd: repoRoot }),
    ).toMatchObject({ decision: 'block' })
  })
```
Run (red): `bun test -t "after a compaction"`: 0 pass, 1 fail; the read after `PostCompact` expected the rule in
full and received the one line naming it.

## Piece 2: a compaction forgets what the session was shown
What: `HOOK_EVENTS.postCompact`; on it, `forgetWhatSessionWasShown(sessionId)` removes the session's three
shown-once files (the rules in full, the files whose newest change was named, the rules relied on), and the hook
says nothing. The edited repos and the edits answered for stay.
Why: plan, decision 5. What those three files guard against is repeating a line the agent still has; after a
compaction it has none of them. The Stop check is about the repo's state, which a compaction doesn't change.
Where: `scripts/hook.ts`: `HOOK_EVENTS`, after `readSessionFileLines`, `respondToHook`
```ts
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
```
```diff
+  if (hookEventName === HOOK_EVENTS.postCompact) {
+    if (sessionId !== null) {
+      forgetWhatSessionWasShown(sessionId)
+    }
+    return null
+  }
   if (hookEventName === HOOK_EVENTS.stop) {
```
