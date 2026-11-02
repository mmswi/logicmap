# Step 2: an edit under a `uses` or `test` site names its rule

## Piece 1: red, the note after an edit
What: a hook test on a repo with `sync.close-during-join` defined in `src/room.ts`, used in `src/caller.ts` (a
`§uses` over `closeSocket()`) and proved in `src/room.test.ts` (a `§test` over a test), committed. In one session:
- first, in another session, an edit of the line after the `§uses` block → nothing (the diff against HEAD holds every
  uncommitted change of the file, so this case runs before the others);
- an edit of `closeSocket()` → the note, its header naming `src/caller.ts`, then the rule's line and `  2-3  §uses  ok`;
- a second edit there → no note;
- an edit of the test's assertion → the note with `  1-4  §test  ok` (written `1-3` first; the site covers the
  test's closing `})` too, as the grammar says);
- an edit inside the defining `§edge` block → `check`'s `changed` error, no note;
- a new file git doesn't hold, with a `§uses` anchor → nothing.
Why: since `uses` and `test` left the lock, nothing tells the agent that the lines it just edited rely on a rule, or
prove one. The cases are the plan's: once per file, rule and session; none under no site; none where `check`
already speaks; none without a HEAD version to compare with.
Where: `scripts/logicmap.test.ts`, describe `hook`
Run: red, `expect(received).toStartWith(expected)`: the edit of `closeSocket()` gets `null`.

## Piece 2: the rules of a file's uses and test sites in some lines
What: `listFileRuleSections` formats the anchors it picks through `describeRuleSections`, which the view's new
`listReferringRuleSections(file, changedLines)` shares: the file's anchors in a referring role (`uses`, `test`)
whose covered lines meet one of the ranges. `listReferringRuleSectionsInLines` exports it, beside
`listRuleSectionsInLines`.
Why: the note prints a rule as `show <file>` does, so one formatter serves both. Defining sites are left out:
`check` fingerprints them and reports their change itself.
Where: `scripts/logicmap.ts` (`createShowViews`, after `listRuleSectionsInLines`)
```diff
-  // Each rule once, in the order its first site appears, with every site in the requested lines under it.
-  const listFileRuleSections = (file: string, requestedLines: LineRange | null): RuleSection[] => {
-    const fileAnchors = analysis.anchors.filter((anchor) => anchor.file === file)
-    const shownAnchors =
-      requestedLines === null
-        ? fileAnchors
-        : fileAnchors.filter((anchor) => doLineRangesMeet(coveredLinesOf(anchor), requestedLines))
-    const anchorsById = Map.groupBy(shownAnchors, (anchor) => anchor.id)
+  // Each rule once, in the order its first site appears, with each of these sites under it.
+  const describeRuleSections = (shownAnchors: Anchor[]): RuleSection[] => {
+    const anchorsById = Map.groupBy(shownAnchors, (anchor) => anchor.id)
     return [...anchorsById].map(([id, ruleAnchors]) => {
       ...unchanged...
     })
   }
+  const listFileRuleSections = (file: string, requestedLines: LineRange | null): RuleSection[] => {
+    const fileAnchors = analysis.anchors.filter((anchor) => anchor.file === file)
+    return describeRuleSections(
+      requestedLines === null
+        ? fileAnchors
+        : fileAnchors.filter((anchor) => doLineRangesMeet(coveredLinesOf(anchor), requestedLines)),
+    )
+  }
+  // The rules whose uses or test sites in this file cover some of these lines: the sites no lock fingerprints.
+  const listReferringRuleSections = (file: string, changedLines: LineRange[]): RuleSection[] =>
+    describeRuleSections(
+      analysis.anchors.filter(
+        (anchor) =>
+          anchor.file === file &&
+          !isDefiningRole(anchor.role) &&
+          changedLines.some((lines) => doLineRangesMeet(coveredLinesOf(anchor), lines)),
+      ),
+    )
@@
+// The rules whose uses or test sites in a file cover some of these lines: what the hook adds after an edit.
+export const listReferringRuleSectionsInLines = (
+  repoRoot: string,
+  file: string,
+  changedLines: LineRange[],
+): RuleSection[] => createShowViews(repoRoot).listReferringRuleSections(file, changedLines)
```
Run: the 42 tests before stay green; the red one still fails the same way.

## Piece 3: the lines an edit changed
What: `listChangedLineRanges` reads `git diff -U0 --no-color --no-ext-diff HEAD -- <file>` and turns each hunk's new
side (`+c,d`) into the lines `c` to `c+d-1`; a hunk that only removes (`d` 0) is line `c`, the line before the
removal, which a site around the removal covers.
Why: the diff against HEAD finds the edited lines for Edit, MultiEdit and Write alike (plan, decision 2). It holds
every uncommitted change of the file, so a rule may be named for an earlier edit; once per file and session keeps
that to one line.
Where: `scripts/hook.ts`, before `respondToEdit`
```ts
// A hunk header of git diff -U0: where its lines start in the file as it is now, and how many (1 when unsaid).
const DIFF_HUNK_HEADER_PATTERN = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/

// The lines of the file that differ from HEAD; a removal is the line before it. Nothing for a file HEAD lacks.
const listChangedLineRanges = (repoRoot: string, file: string): LineRange[] =>
  execFileSync('git', ['diff', '-U0', '--no-color', '--no-ext-diff', 'HEAD', '--', file], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .split('\n')
    .flatMap((diffLine) => {
      const [, firstLineText, lineCountText = '1'] = DIFF_HUNK_HEADER_PATTERN.exec(diffLine) ?? []
      if (firstLineText === undefined) {
        return []
      }
      const firstLine = Math.max(Number(firstLineText), 1)
      return [{ firstLine, lastLine: firstLine + Math.max(Number(lineCountText), 1) - 1 }]
    })
```

## Piece 4: green, the note after the errors
What: `listReliedOnRuleLines` names the rules of the referring sites in the changed lines, less those the file's
errors already name and those named for this file earlier in the session (`.relied-on-rules.txt`, one line per repo,
file and rule version); a throw costs the note only. `respondToEdit` returns the errors, then the note, or null when
both are empty. `readShownRuleLines` becomes `readSessionFileLines`, read for the shown rules, the named changes and these.
Why: the note's header says what to do with it: read the rule against the new code, a `§uses` site still relying on
what it says, a `§test` still failing when it breaks. Information, not an error (plan, decision 1).
Where: `scripts/hook.ts` (`readShownRuleLines`, `respondToEdit`, the session files)
Run: green, 43 pass; strict tsc and biome clean. The first run failed on the test's own `1-3`: the `§test` site
covers 1-4 (piece 1's note).

## Piece 5: one analysis per edit
What: `listReferringRuleSectionsInLines` becomes `inspectEdit(repoRoot, file, changedLines)`, which returns
`check`'s problems and the referring rule sections from one `createShowViews` (its views now hand out `problems`).
`respondToEdit` reads the changed lines first (a failing git call: none), calls `inspectEdit` once, and
`listReliedOnRuleLines` takes the sections it found.
Why: step 4's measure on a teamabled worktree: an Edit took 0.29–0.31 s against the installed hook's 0.15–0.19 s,
the repo analysed twice (`checkRepo`, then the views). `checkRepo` is `findAllProblems` over `analyzeRepo`, which is
what the views compute.
Where: `scripts/logicmap.ts` (`createShowViews`'s return, after `listRuleSectionsInLines`), `scripts/hook.ts`
(`listReliedOnRuleLines`, `respondToEdit`)
Run: green, 43 pass; strict tsc and biome clean. On the teamabled worktree, best of three per Edit: 0.16 s for a file
with no anchors (installed hook 0.15), 0.18 for the test file (0.16), 0.16 for `merge-direct-groups.ts` (0.15).
