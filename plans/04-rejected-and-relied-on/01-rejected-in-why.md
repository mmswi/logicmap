# Step 1: `why` prints each rule's `rejected:`

## Piece 1: red, the rejected line under the why
What: a test with an entry that has `rejected:`. `why <file>:<line>` holds
`  why: …\n  rejected: …` under the rule's line, `why <id>` the same under its own; an entry without `rejected:`
prints no such line.
Why: the acceptance's agent without `why` named the rejected alternatives `why` left out (questions 1 and 3).
Where: `scripts/logicmap.test.ts`, describe `why`
Run: red, `expect(received).toContain(expected)`: the line's why holds `  why: The join adds the connection before it
resolves.` followed by `  2-5  §edge  ok`, with no `rejected:` line between them.

## Piece 2: green, the entry carries its rejected alternatives and why prints them
What: `LedgerEntry.rejected` is read from the `rejected:` field, like `why`. `listRulesWithTheirWhy` prints
`  rejected: …` under `  why: …` when it isn't empty, and so does `explainRule`, between the why and the history.
Why: what `show <id>` prints in full and `why` left out is the alternative an agent writing the code would bring
back. `breaks-if` and `revisit-if` stay one `show <id>` away: the acceptance measured only the rejected ones missing.
Where: `scripts/logicmap.ts` (`LedgerEntry`, `parseEntry`, `listRulesWithTheirWhy`, `explainRule`)
```diff
   why: string
+  rejected: string
   // Why no test proves it, when someone wrote so; such an entry raises no untested warning.
@@
       why: fieldByName.get('why')?.text ?? '',
+      rejected: fieldByName.get('rejected')?.text ?? '',
@@
+// A rule's why and the alternatives it rejected: what must hold now, and what not to bring back.
+const describeWhyAndRejected = (entry: LedgerEntry | undefined): string[] => [
+  ...(entry === undefined || entry.why === '' ? [] : [`  why: ${entry.why}`]),
+  ...(entry === undefined || entry.rejected === '' ? [] : [`  rejected: ${entry.rejected}`]),
+]
@@ listRulesWithTheirWhy
-    const why = views.analysis.entriesById.get(ruleSection.id)?.why ?? ''
-    return [ruleLine, ...(why === '' ? [] : [`  why: ${why}`]), ...siteLines]
+    const entry = views.analysis.entriesById.get(ruleSection.id)
+    return [ruleLine, ...describeWhyAndRejected(entry), ...siteLines]
@@ explainRule
     ruleLine,
-    `  why: ${entry.why}`,
+    ...describeWhyAndRejected(entry),
```
Run: green, 42 pass; strict tsc and biome clean. On teamabled, `why src/teams/merge-direct-groups.ts:459` prints
under `calls.out-of-the-conversation-out-of-the-call@1` its `rejected: relying on the token's lifetime (R1, B): the
person stays in for as long as they keep the call open.`
