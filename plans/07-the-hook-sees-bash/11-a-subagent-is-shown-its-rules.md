# Step 11: a subagent is shown its rules

## Piece 1: red, a read by the session, then by its subagent
What: a test in `describe('hook')`: the session reads `src/room.ts` and is shown its rule in full; a subagent of it (the same `session_id`, an `agent_id`) reads the same file and is shown the rule in full too, then by id; the session reading again is told by id.
Why: a subagent's hook input carries its session's `session_id` and adds `agent_id` (the hook input schema of Claude Code 2.1.321: "Present only when the hook fires from within a subagent"). The hook keyed what was shown by session, so in the trial of the shorter skill a subagent was told "shown earlier this session" for rules only its parent had seen, in a context that never held them.
Where: scripts/logicmap.test.ts, before the compaction test
```ts
  test('a subagent is shown in full the rules its session saw, then by id; its session is not told twice', () => {
    const repoRoot = createMappedRepo()
    const sessionId = `parent-${crypto.randomUUID()}`
    const contextOfRead = (agentId: string | undefined): string =>
      JSON.stringify(
        respondToHook({
          hook_event_name: 'PostToolUse',
          session_id: sessionId,
          agent_id: agentId,
          tool_name: 'Read',
          tool_input: { file_path: join(repoRoot, 'src/room.ts') },
        }),
      )
    const fullRuleText = 'sync.close-during-join@1  edge  recorded  The socket can close'

    expect(contextOfRead(undefined)).toContain(fullRuleText)
    expect(contextOfRead('agent-1')).toContain(fullRuleText)
    expect(contextOfRead('agent-1')).not.toContain(fullRuleText)
    expect(contextOfRead(undefined)).not.toContain(fullRuleText)
  })
```
Run, red: the subagent's first read was told `covered too by rules shown earlier this session: sync.close-during-join@1`.

## Piece 2: green, what was shown once is kept per conversation
What: `respondToHook` keys what was shown once (the rules in full, a file's newest change, the rules relied on) by the conversation: the session id, plus `.<agent_id>` inside a subagent. The edited repos stay keyed by the session, so a subagent's edit still asks its session at its stop. A compaction forgets the shown-once files of the conversation it happened in. The functions that only touch shown-once state take `conversationId`; `respondToEdit` and `respondToBash` take both ids. `sessionFileOf` becomes `stateFileOf`, as its owner is now either; `HookInput` and `parseHookInput` read `agent_id`.
Why: a subagent starts with an empty context, so a rule its session saw is new to it, and its compaction does not empty its session's context. The stop is the session's: a subagent ends at SubagentStop, and the errors it leaves are its session's to resolve.
Where: scripts/hook.ts, the diff of the step (biome's layout included):
```diff
@@ -62,0 +63 @@ export type HookInput = {
+  agent_id?: string
@@ -100 +101,2 @@ const findMappedRepoRoot = (directory: string): string | null => {
-// else), and the rules it was shown in full.
+// else). And per conversation, the session's or each of its subagents', what it was shown once: the rules in
+// full, a file's newest change, the rules relied on.
@@ -102,8 +104,9 @@ const HOOK_STATE_DIRECTORY = join(tmpdir(), 'logicmap-hook')
-const sessionFileOf = (sessionId: string, fileSuffix: string): string =>
-  join(HOOK_STATE_DIRECTORY, `${sessionId.replace(/[^\w-]/g, '_')}${fileSuffix}`)
-const editedReposFileOf = (sessionId: string): string => sessionFileOf(sessionId, '.txt')
-const shownRulesFileOf = (sessionId: string): string => sessionFileOf(sessionId, '.shown-rules.txt')
-const namedChangesFileOf = (sessionId: string): string =>
-  sessionFileOf(sessionId, '.named-changes.txt')
-const reliedOnRulesFileOf = (sessionId: string): string =>
-  sessionFileOf(sessionId, '.relied-on-rules.txt')
+const stateFileOf = (ownerId: string, fileSuffix: string): string =>
+  join(HOOK_STATE_DIRECTORY, `${ownerId.replace(/[^\w-]/g, '_')}${fileSuffix}`)
+const editedReposFileOf = (sessionId: string): string => stateFileOf(sessionId, '.txt')
+const shownRulesFileOf = (conversationId: string): string =>
+  stateFileOf(conversationId, '.shown-rules.txt')
+const namedChangesFileOf = (conversationId: string): string =>
+  stateFileOf(conversationId, '.named-changes.txt')
+const reliedOnRulesFileOf = (conversationId: string): string =>
+  stateFileOf(conversationId, '.relied-on-rules.txt')
@@ -163,2 +166,2 @@ const readStateFileLines = (stateFile: string): Set<string> =>
-// What a session was shown once is gone from its context after a compaction, so it is shown again.
-const forgetWhatSessionWasShown = (sessionId: string): void => {
+// What a conversation was shown once is gone from its context after a compaction, so it is shown again.
+const forgetWhatConversationWasShown = (conversationId: string): void => {
@@ -166,3 +169,3 @@ const forgetWhatSessionWasShown = (sessionId: string): void => {
-    shownRulesFileOf(sessionId),
-    namedChangesFileOf(sessionId),
-    reliedOnRulesFileOf(sessionId),
+    shownRulesFileOf(conversationId),
+    namedChangesFileOf(conversationId),
+    reliedOnRulesFileOf(conversationId),
@@ -201 +204 @@ const listNewestChangeLines = (
-  sessionId: string | null,
+  conversationId: string | null,
@@ -205 +208 @@ const listNewestChangeLines = (
-  const namedChangesFile = sessionId === null ? null : namedChangesFileOf(sessionId)
+  const namedChangesFile = conversationId === null ? null : namedChangesFileOf(conversationId)
@@ -235 +238 @@ const describeRead = (
-  sessionId: string | null,
+  conversationId: string | null,
@@ -238 +241 @@ const describeRead = (
-  const newestChangeLines = listNewestChangeLines(repoRoot, file, readLines, sessionId)
+  const newestChangeLines = listNewestChangeLines(repoRoot, file, readLines, conversationId)
@@ -240 +243,3 @@ const describeRead = (
-    sessionId === null ? new Set<string>() : readStateFileLines(shownRulesFileOf(sessionId))
+    conversationId === null
+      ? new Set<string>()
+      : readStateFileLines(shownRulesFileOf(conversationId))
@@ -247 +252 @@ const describeRead = (
-  if (sessionId !== null) {
+  if (conversationId !== null) {
@@ -251 +256 @@ const describeRead = (
-    appendToStateFile(shownRulesFileOf(sessionId), newShownRuleLines)
+    appendToStateFile(shownRulesFileOf(conversationId), newShownRuleLines)
@@ -273 +278 @@ const respondToRead = (
-  sessionId: string | null,
+  conversationId: string | null,
@@ -283 +288 @@ const respondToRead = (
-    describeRead(createMapReader(repoRoot), repoRoot, file, readLines, sessionId),
+    describeRead(createMapReader(repoRoot), repoRoot, file, readLines, conversationId),
@@ -397 +402 @@ const listReliedOnRuleLines = (
-  sessionId: string | null,
+  conversationId: string | null,
@@ -399 +404 @@ const listReliedOnRuleLines = (
-  const reliedOnRulesFile = sessionId === null ? null : reliedOnRulesFileOf(sessionId)
+  const reliedOnRulesFile = conversationId === null ? null : reliedOnRulesFileOf(conversationId)
@@ -429 +434 @@ const describeEdit = (
-  sessionId: string | null,
+  conversationId: string | null,
@@ -443 +448 @@ const describeEdit = (
-    sessionId,
+    conversationId,
@@ -455 +460,5 @@ const describeEdit = (
-const respondToEdit = (filePath: string, sessionId: string | null): HookOutput | null => {
+const respondToEdit = (
+  filePath: string,
+  sessionId: string | null,
+  conversationId: string | null,
+): HookOutput | null => {
@@ -464 +473 @@ const respondToEdit = (filePath: string, sessionId: string | null): HookOutput |
-  const editContextLines = describeEdit(createMapReader(repoRoot), repoRoot, file, sessionId)
+  const editContextLines = describeEdit(createMapReader(repoRoot), repoRoot, file, conversationId)
@@ -576,0 +586 @@ const respondToBash = (
+  conversationId: string | null,
@@ -596 +606 @@ const respondToBash = (
-          sessionId,
+          conversationId,
@@ -614 +624,2 @@ const respondToBash = (
-          describe: () => describeRead(mapReaderOf(repoRoot), repoRoot, file, readLines, sessionId),
+          describe: () =>
+            describeRead(mapReaderOf(repoRoot), repoRoot, file, readLines, conversationId),
@@ -674,0 +686,5 @@ export const respondToHook = (input: HookInput): HookOutput | null => {
+  // A subagent's input holds its session's id and its own agent id: what it was shown is its own.
+  const conversationId =
+    sessionId === null || input.agent_id === undefined
+      ? sessionId
+      : `${sessionId}.${input.agent_id}`
@@ -683,0 +700 @@ export const respondToHook = (input: HookInput): HookOutput | null => {
+      conversationId,
@@ -690 +707,6 @@ export const respondToHook = (input: HookInput): HookOutput | null => {
-      return respondToRead(filePath, input.tool_input?.offset, input.tool_input?.limit, sessionId)
+      return respondToRead(
+        filePath,
+        input.tool_input?.offset,
+        input.tool_input?.limit,
+        conversationId,
+      )
@@ -693 +715 @@ export const respondToHook = (input: HookInput): HookOutput | null => {
-      return respondToEdit(filePath, sessionId)
+      return respondToEdit(filePath, sessionId, conversationId)
@@ -698,2 +720,2 @@ export const respondToHook = (input: HookInput): HookOutput | null => {
-    if (sessionId !== null) {
-      forgetWhatSessionWasShown(sessionId)
+    if (conversationId !== null) {
+      forgetWhatConversationWasShown(conversationId)
@@ -716,2 +738,10 @@ const parseHookInput = (inputText: string): HookInput | null => {
-  const { hook_event_name, session_id, cwd, tool_name, tool_input, duration_ms, stop_hook_active } =
-    parsedInput as Record<string, unknown>
+  const {
+    hook_event_name,
+    session_id,
+    agent_id,
+    cwd,
+    tool_name,
+    tool_input,
+    duration_ms,
+    stop_hook_active,
+  } = parsedInput as Record<string, unknown>
@@ -724,0 +755 @@ const parseHookInput = (inputText: string): HookInput | null => {
+    agent_id: typeof agent_id === 'string' ? agent_id : undefined,
```
Run, green: `bun test -t hook`, `16 pass, 0 fail`.
