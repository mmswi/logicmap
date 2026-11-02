# Step 1: `uses` and `test` sites leave the lock

## Piece 1: a relying site asks no ack (the failing tests)
What: a new test in `lock`: after the edge is acked, a `§uses` and a `§test` site of it are added, then
the `uses` site's code is edited, then a lock line written for a `uses` site before is put back in the
lock: none of these is a lock problem. A bump of the entry to version 2 still reports `stale-pin` at both
sites (and at the edge's anchor). The test "adding an anchor inside an anchored block" expected
`unacked` for its new `§uses`; it now expects nothing.
Why: these are the claims the step changes: a relying site is checked by its pin alone, and a lock
written by the checker of before keeps working.
Where: `scripts/logicmap.test.ts:419`
```ts
    writeRelyingSites('joinSocketAgain()', 1)
    expect(describeLockProblems(repoRoot)).toEqual([])
    // ...
    writeFixtureFiles(repoRoot, { 'logicmap/sync.md': closeDuringJoinEntry(2) })
    expect(describeErrors(repoRoot)).toEqual([
      'stale-pin src/caller.ts:1',
      'stale-pin src/room.test.ts:1',
      'stale-pin src/room.ts:1',
    ])
```
Run: red, 2 fail (`unacked src/caller.ts:1`, `unacked src/room.test.ts:1`, ...).

## Piece 2: only defining anchors and entries are in the lock
What: `LockSite.isInLock`, true for a defining anchor and an entry; `checkLock` compares and `ackIds`
writes only those; `readLock` skips a key whose role is `uses` or `test` (`isRelyingSiteKey`), so the
3,632 such lines in teamabled's lock are neither `gone` nor kept: the next ack of their domain leaves them
out. Every site is still collected, so `show` and the hook keep its covered lines.
Why: filtering the sites out of `collectLockSites` instead (rejected) would collapse a `uses` site's
covered lines to its own line, and the Read hook would stop showing a rule whose `uses` anchor covers
lines read in the middle of its block.
Where: `scripts/logicmap.ts:555`, `:677`, `:690`, `:706`, `:740`, `:751`, `:861`
```ts
// A key is "<id> <role> <file>#<n>", or "<id> entry <file>#1" for an entry.
const isRelyingSiteKey = (key: string): boolean => {
  const role = key.split(' ')[1] ?? ''
  return role === ANCHOR_ROLES.uses || role === ANCHOR_ROLES.test
}
// ...
const checkLock = (lockSites: LockSite[], lockedSitesByKey: Map<string, LockedSite>): Problem[] => {
  const problems: Problem[] = []
  const sitesInLock = lockSites.filter((lockSite) => lockSite.isInLock)
```
Run: 25 pass. On teamabled the worktree's `check` and `show src/teams/merge-direct-groups.ts` print what
the live checker does (errors 0, warnings 27; the `441-481 §uses` ranges kept).
