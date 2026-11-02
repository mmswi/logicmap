# Step 4: a long block says so when it asks for an ack

## Piece 1: a changed site over 60 lines names its size (the failing test)
What: a test in `lock`: an edge anchored above a 63-line function and a one-line edge are acked, then a
line in each is edited. The long one's `changed` message says "covers 63 lines"; the short one's says
nothing of the kind.
Why: the hint is the step's whole claim, and its absence below the limit is what keeps it from being
noise.
Where: `scripts/logicmap.test.ts` (the test 'a changed site over 60 lines says how many it covers')
```ts
    expect(changedMessages).toHaveLength(2)
    expect(changedMessages[0]).toContain('covers 63 lines')
    expect(changedMessages[1]).not.toContain('covers')
```
Run: red, 1 fail (`toContain('covers 63 lines')`).

## Piece 2: the hint in `changed` and `unacked`
What: `longBlockHintOf` adds "It covers N lines: if the edit is beside the rule, move the anchor to the
smaller block that holds it." to the `changed` and `unacked` message of an anchor (never an entry) that
covers more than 60 lines. `roleOfLockKey` reads a key's role, for this and for `isRelyingSiteKey`; the
entry's role in a key is `ENTRY_LOCK_ROLE`.
Why: 73 of teamabled's 725 defining sites cover more than 60 lines; a warning would print 73 lines on
every check, while the hint shows only to the agent already re-reading that site, which is when narrowing
the anchor costs least. 60 rather than 30 (181 sites) or 100 (30 sites): past 60 lines a block is a whole
function more often than a rule.
Where: `scripts/logicmap.ts` (`LONG_BLOCK_LINE_COUNT`, `longBlockHintOf`, `roleOfLockKey`)
```ts
const LONG_BLOCK_LINE_COUNT = 60
const longBlockHintOf = (lockSite: LockSite): string => {
  const coveredLineCount = lockSite.lastLine - lockSite.line + 1
  const isLongAnchoredBlock =
    roleOfLockKey(lockSite.key) !== ENTRY_LOCK_ROLE && coveredLineCount > LONG_BLOCK_LINE_COUNT
  return isLongAnchoredBlock
    ? ` It covers ${coveredLineCount} lines: if the edit is beside the rule, move the anchor to the smaller block that holds it.`
    : ''
}
```
Run: 29 pass; on teamabled the worktree's `check` prints what the live one does; strict tsc and biome
clean.
