# Step 4: on teamabled

## Piece 1: the first measure
What: `check` on a worktree of teamabled's `feat/shared-tags` (1,445 lock lines, every one `v2:`), three runs each:
the installed checker 0.15–0.18 s, this branch 0.23–0.25 s, both 0 errors. With the shape's hash stubbed out, this
branch is back at 0.16–0.18 s: tokenizing every anchored site is the whole cost.
Why: the hook runs `check` on every Edit, so its time is paid all day.

## Piece 2: the shape read only when it is needed
What: a lock site keeps the code's fingerprint, and `readShape`, which tokenizes its code the first time it's asked
and keeps the result (null for an entry). The shape is asked for only by a site whose code differs from its lock
line, and by an ack writing lines, through `lockTokenOf`. `fingerprintCode` returns the code part alone; the token
`v3:<code>.<shape>` is written by `lockTokenOf`.
Why: a check where every site is as locked, the common case, tokenizes nothing. Rejected: a faster tokenizer (it
would still tokenize 1,445 sites a run for nothing).
Where: `scripts/logicmap.ts`: `LockSite`, `fingerprintCode`, `collectLockSites`, `isAsLocked`,
`isRenamedSinceLocked`, `ackIds`, `createRenamesReader`
Run: 51 pass; `check` on the worktree 0.16–0.18 s, 0 errors.
