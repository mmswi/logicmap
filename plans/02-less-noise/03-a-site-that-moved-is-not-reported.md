# Step 3: a site that moved is not reported

## Piece 1: a renamed file and a renumbered flow anchor (the failing test)
What: a test in `lock`: an acked edge's file is renamed: no lock problem; renamed and edited, it is
`unacked` at its new place and its old line `gone`. A flow with two step anchors in one file is acked,
then a third anchor of the same id and step 1 is added above them, which renumbers the other two (`#1`,
`#2` become `#2`, `#3`): only the added one is `unacked`.
Why: the key is `<id> <role> <file>#<n>`, so both a move to another file and a new anchor of the same id
above others change keys while the code stays as it was acked.
Where: `scripts/logicmap.test.ts:552`
```ts
    renameSync(join(repoRoot, 'src/room.ts'), join(repoRoot, 'src/join-room.ts'))
    expect(describeLockProblems(repoRoot)).toEqual([])
    // ...
    expect(describeLockProblems(flowRepoRoot)).toEqual(['unacked src/open.ts:1'])
```
Run: red, 1 fail (`gone logicmap/sync.lock:2`, `unacked src/join-room.ts:1` after the plain rename).

## Piece 2: each site claims the lock line that holds its code
What: `checkLock` lets each site claim one lock line: its own key with its code as locked; else another
unclaimed key of its id and role whose line holds its code (moved, or renumbered); else its own key,
unclaimed, as `changed`; else it is `unacked`. A line no site claimed is `gone`. The `unacked` message
says "new, or moved and edited", since a plain move is no longer one.
Why: matching by key alone (before) made a move or a renumbering two problems for code nobody changed.
Claiming in two passes keeps a renumbered site from being called `changed` when its line went to the site
whose code it holds; matching any key of the id and role, not only `gone` ones, is what covers the
renumbering. An ack of the id rewrites the keys; until then the old key stays in the lock, claimed.
Where: `scripts/logicmap.ts:791`, `:802`
```ts
  const sitesNotAsLocked = lockSites
    .filter((lockSite) => lockSite.isInLock)
    .filter((lockSite) => !claimLockLineOf(lockSite, lockSite.key))
  const sitesNotMoved = sitesNotAsLocked.filter((lockSite) => {
    const keysOfItsIdAndRole = [...lockedSitesByKey.keys()].filter(
      (key) => idAndRoleOfLockKey(key) === idAndRoleOfLockKey(lockSite.key),
    )
    return !keysOfItsIdAndRole.some((key) => claimLockLineOf(lockSite, key))
  })
```
Run: 28 pass; on teamabled the worktree's `check` prints what the live one does; strict tsc and biome
clean.
