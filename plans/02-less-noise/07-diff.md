# Step 7: `logicmap diff <id>`

## Piece 1: the hunk under a changed site, not one beside it (the failing test)
What: a test in `diff`: an edge is acked and committed; `diff` says nothing changed. Then a line under
the anchor and a line ten lines below it are edited: `diff` names the ack's commit and prints the hunk
with the edited line under the anchor, not the other one. After a second ack, not committed, and another
edit, `diff` says the ack isn't committed yet and diffs from HEAD.
Why: the lock holds no commit, only a fingerprint; the commit has to be found from git, and both cases
(an ack committed, an ack since HEAD) happen in every task.
Where: `scripts/logicmap.test.ts` (the test in `describe('diff')`)
```ts
    const committedAckDiff = diffLogicMap(repoRoot, 'sync.close-during-join')
    expect(committedAckDiff).toContain('since the ack in')
    expect(committedAckDiff).toContain('+  joined.dropConnection(connection)')
    expect(committedAckDiff).not.toContain('unrelated8 = 80')
```
Run: red (`Export named 'diffLogicMap' not found`).

## Piece 2: the commit of the ack, and the hunks that meet the site
What: `diffLogicMap` takes each site of the id in the lock whose code or entry differs from its lock line;
`findAckCommit` finds the commit that wrote that line (`git log -1 -S '<lock line>' -- <lock file>`) when
HEAD's lock holds it, else null; the site's file is diffed from that commit, or from HEAD, and
`hunksMeetingLines` keeps the hunks whose lines in the file as it is now meet the site's. `diff <id>` on
the command line prints it.
Why: re-reading a `changed` site meant finding by hand what moved under it; the lock line is the one fact
that ties a site to its ack, and `-S` finds the commit that added it. A hunk that only removes lines sits
after its line, so it counts as one line long. Under 60 lines, so it stays (the plan's limit).
Where: `scripts/logicmap.ts` (`runGit`, `findAckCommit`, `hunksMeetingLines`, `diffLogicMap`,
`runCommandLine`)
```ts
      const ackCommit = findAckCommit(repoRoot, lockedSite.file, lockLine)
      const sinceNote =
        ackCommit === null
          ? 'the ack is not committed yet, so from HEAD'
          : `since the ack in ${ackCommit}`
      const diffText = runGit(repoRoot, ['diff', '-U2', ackCommit ?? 'HEAD', '--', lockSite.file])
```
Run: 32 pass; strict tsc and biome clean. On a throwaway worktree of teamabled with one comment-free
edit in `finishMergesAfterCommit` (a log message), the live checker reports 5 errors, this one 2 (the
edge whose line it is, and the flow step over the function), and `diff
teams.merge-cleanup-survives-a-failed-announcement` prints the one-line hunk since `62cbc747`.
