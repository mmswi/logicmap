# Step 1: One analysis for every file of a hook run

Before: `bun test` 53 pass.

## Piece 1: the map reader
What: `createMapReader(repoRoot)` in place of `listRuleSectionsInLines` and `inspectEdit`: one `createShowViews`,
then the problems, the rule sections of a file's lines, the rules relied on over changed lines, and whether a file
has anchors.
Why: each of the two functions analysed the whole repo (0.41 s in teamabled). A Bash command that reads three files
and changes two would pay it five times; with a reader it pays once, and a command that reads and changes nothing
never creates one (plan, decision 4). `isAnchoredFile` lets the hook skip `git diff` for a file with no anchors: no
`uses` or `test` site can cover its changed lines.
Where: `scripts/logicmap.ts:1488-1511`
```ts
// What the hook asks of the map, from one analysis: every problem check reports; the rules covering some lines of a
// file (all of it when lines is null), each as show <file> prints it; the rules whose uses or test sites in a file
// cover some changed lines.
export const createMapReader = (repoRoot: string) => {
  const views = createShowViews(repoRoot)
  return {
    problems: views.problems,
    isAnchoredFile: views.isAnchoredFile,
    listRuleSectionsInLines: (file: string, lines: LineRange | null): RuleSection[] =>
      views.isAnchoredFile(file) ? views.listFileRuleSections(file, lines) : [],
    listReferringRuleSections: views.listReferringRuleSections,
  }
}

export type MapReader = ReturnType<typeof createMapReader>
```

## Piece 2: a read and an edit described from a reader
What: in `hook.ts`, `respondToRead` becomes `describeRead(mapReader, repoRoot, file, readLines, sessionId)` and
`respondToEdit` becomes `describeEdit(mapReader, repoRoot, file, sessionId)`, both returning the lines of context;
the two callers in `respondToHook`'s path find the repo, create the reader and wrap the lines. `addContext` takes
the event's name, since the next step answers a second event.
Why: a Bash command's reads and edits are answered with the same words as a Read's and an Edit's, several per
command, from one reader (plan, steps 2 and 3).
Where: `scripts/hook.ts:113-115` (`addContext`), `:190-238` (`respondToRead`), `:306-341` (`respondToEdit`)
```diff
-const addContext = (additionalContext: string): HookOutput => ({
-  hookSpecificOutput: { hookEventName: HOOK_EVENTS.postToolUse, additionalContext },
-})
+const addContext = (hookEventName: ToolHookEventName, contextLines: string[]): HookOutput | null =>
+  contextLines.length === 0
+    ? null
+    : { hookSpecificOutput: { hookEventName, additionalContext: contextLines.join('\n') } }
```
```diff
-const respondToRead = (filePath, offset, limit, sessionId): HookOutput | null => {
-  const repoRoot = findMappedRepoRoot(dirname(filePath))
-  if (repoRoot === null) { return null }
-  const file = toRepoPath(repoRoot, filePath)
-  const readLines = toReadLines(offset, limit)
-  const ruleSections = listRuleSectionsInLines(repoRoot, file, readLines)
+const describeRead = (mapReader, repoRoot, file, readLines, sessionId): string[] => {
+  const ruleSections = mapReader.listRuleSectionsInLines(file, readLines)
   const newestChangeLines = listNewestChangeLines(repoRoot, file, readLines, sessionId)
-  if (ruleSections.length === 0 && newestChangeLines.length === 0) { return null }
   // ...unchanged: shown before, shown now...
-  return addContext([...newRulesLines, ...shownBeforeLines, ...newestChangeLines].join('\n'))
+  return [...newRulesLines, ...shownBeforeLines, ...newestChangeLines]
 }
```
```diff
-const respondToEdit = (filePath, sessionId): HookOutput | null => {
-  const repoRoot = findMappedRepoRoot(dirname(filePath))
-  if (repoRoot === null) { return null }
-  if (sessionId !== null) { recordEditedRepo(sessionId, repoRoot) }
-  const file = toRepoPath(repoRoot, filePath)
-  const { problems, referringRuleSections } = inspectEdit(repoRoot, file, listChangedLineRanges(repoRoot, file))
-  const fileErrors = problems.filter(...)
+const describeEdit = (mapReader, repoRoot, file, sessionId): string[] => {
+  const fileErrors = mapReader.problems.filter(...)
+  const changedLineRanges = mapReader.isAnchoredFile(file) ? listChangedLineRanges(repoRoot, file) : []
+  const referringRuleSections = mapReader.listReferringRuleSections(file, changedLineRanges)
   // ...unchanged: the relied-on lines, the error lines...
-  return addContext([...errorLines, ...reliedOnRuleLines].join('\n'))
+  return [...errorLines, ...reliedOnRuleLines]
 }
+
+const respondToRead = (filePath, offset, limit, sessionId): HookOutput | null => {
+  const repoRoot = findMappedRepoRoot(dirname(filePath))
+  if (repoRoot === null) { return null }
+  const file = toRepoPath(repoRoot, filePath)
+  return addContext(HOOK_EVENTS.postToolUse,
+    describeRead(createMapReader(repoRoot), repoRoot, file, toReadLines(offset, limit), sessionId))
+}
+
+const respondToEdit = (filePath, sessionId): HookOutput | null => {
+  const repoRoot = findMappedRepoRoot(dirname(filePath))
+  if (repoRoot === null) { return null }
+  if (sessionId !== null) { recordEditedRepo(sessionId, repoRoot) }
+  return addContext(HOOK_EVENTS.postToolUse,
+    describeEdit(createMapReader(repoRoot), repoRoot, toRepoPath(repoRoot, filePath), sessionId))
+}
```
