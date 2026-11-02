# Step 5: `untested:` names why no test proves an entry

## Piece 1: an edge with a reason is no warning (the failing test)
What: a test in `coverage`: an edge with `untested: the close lands between two awaits no test can stop
at` and no `§test` site raises no warning, and `show <id>` prints the field with the entry. The test
before it still shows the edge without the field warns `untested`.
Why: the claim is that a warning left in `check` always means something nobody has looked at; a reason
written down is someone having looked.
Where: `scripts/logicmap.test.ts` (the test 'an entry that says why no test proves it')
```ts
      'logicmap/sync.md': closeDuringJoinEntry(1).replace(
        'source: fixture',
        'untested: the close lands between two awaits no test can stop at\nsource: fixture',
      ),
    // ...
    expect(describeWarnings(repoRoot)).toEqual([])
```
Run: red, 1 fail (`untested logicmap/sync.md:1`).

## Piece 2: the field, read by the coverage check
What: `untested` joins `ENTRY_FIELD_NAMES` (so its text is not read as part of the field above it), a
parsed entry carries `untestedReason`, and `checkEntryAgainstAnchors` skips the `untested` warning when it
is written. The warning's message names the field as the third way out.
Why: in the ledger, beside the entry, the reason is read and changed with the rule. Rejected: a list of
exceptions in a file of its own (a second place to keep in step with the entries, and the reason far from
the rule it excuses).
Where: `scripts/logicmap.ts` (`ENTRY_FIELD_NAMES`, `LedgerEntry.untestedReason`, `checkEntryAgainstAnchors`)
```ts
  const isUntestedOnPurpose = entry.untestedReason !== ''
  if (isProvableKind && !hasTestAnchor && !isUntestedOnPurpose) {
```
Run: 30 pass; on teamabled the worktree's `check` prints what the live one does but the warning's new
words; strict tsc and biome clean.
