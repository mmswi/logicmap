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

## Piece 3: the measure, renames and patterns
What, on the worktree (scratch commits, never pushed):
- every id acked at once: 0.21 s, the 762 code lock lines `v2:` to `v3:`; `check` 0.16 s, 0 errors.
- `personId` → `connectionId` across `src/documents/list.ts`: `renamed src/documents/list.ts:134`, "personId →
  connectionId", 0.19 s; `ack --renamed` acked `documents.person-filter-is-places-in-common` and `check` was 0.
- the file moved to `document-list.ts` and the name renamed back: `renamed`, "connectionId → personId", read from the
  old path in HEAD. `inArray` → `notInArray` beside it is listed too ("inArray → notInArray"): the case only a reader
  of the list catches. Wrapping the `where` in `and(…)` is `gone` and `unacked`; `ack --renamed` then acks nothing.
- `grep:` on the tag, rename and membership frames' rules: each finds its sender and readers, all already anchored by
  tasks 25, 29 and TODO 115, and the docs quoting them are left out by `logicmap/ignore`; `check` 0.19–0.22 s.
Why: the plan's measure. The frames with no rule are teamabled's task.
