# Acceptance: ten questions about teamabled, written before `why` exists

Each question is asked as a person would ask it, with the place in the code; the expected answer is the reason a
person or an agent recorded when the code was written. An answer counts when it reaches that recorded reason (or, for
questions 8–10, says that no reason was recorded and what the code and the commit show instead), not when it gives a
plausible reason of its own. Paths are teamabled's, at `e3405812` (`feat/logicmap-less-noise`).

Two fresh agents answer all ten: one with the skill as it is before this task (`show`, `check`, `diff`, git), one
with `why`. Each reports, per question, its answer and how many tool calls it took.

## 1. A merge's announcement that fails
`src/teams/merge-direct-groups.ts:459`: why does `finishMergesAfterCommit` catch a failure of `announceCallEnded` and
only log it, instead of letting it throw?

Recorded: `explanatory-docs/backend-review/50-a-failed-announcement-stops-no-cleanup/01-the-announcements-failure-logged.md`,
Piece 2 (TODO 109, Greptile's fourth review of PR #33, P1): an announcement that fails after the commit must not stop
the rest of the function, which closes the people's sync sockets and takes the people the merge made viewers out of
the call; otherwise they keep editing or speaking.

## 2. The session cache through a Redis error
`src/auth/session.ts:80`: why does the cache write swallow a Redis error, and how did this line come to be?

Recorded: `explanatory-docs/production-launch/01-crash-and-2fa-fixes/06-sessions-through-a-redis-error.md`, Piece 2
(F13 L1): Redis only saves a round trip; the session's truth is the Postgres row; Redis commands time out at 500 ms so
a hung Redis costs half a second, then Postgres is read. Before it: `060d5927` (the session layer with a read-through
Redis cache, June) and `fb99b150` (the password routes).

## 3. A writer's edit time
`src/sync/doc-room.ts:241`: why does the room record the time of a writer's edit per connection?

Recorded: `explanatory-docs/ui-pass/45-recent-moves-on-your-edits/03-a-persons-change-recorded.md`, Piece 3 (F21 U13
task 45, Recent moves only on your edits): the room is the only place that knows which person sent an update; a
viewer's update is dropped before it is applied.

## 4. appendUpdate awaits its insert
`src/sync/doc-store.ts:69`: why does `appendUpdate` await the insert instead of returning the query?

Recorded: `explanatory-docs/suggestions/01-suggestion-engine/07-server-edits.md`, Piece 3 (F15 G1): the query is a
thenable that runs its write again on each `then`; the root cause is the function's return value (rejected:
`Promise.resolve(...)` around the room's call).

## 5. A new thread's Inbox rows
`src/notifications/document-events.ts:189`: why does a new thread write its Inbox rows through
`insertDocumentEventNotifications`, and whom does it leave out?

Recorded: `explanatory-docs/inbox-events/02-comments-and-suggestions/02-a-new-thread.md`, Piece 2 (F29 task 02): one
writer for every document event; the conversation's members who are people, but the actor; whom its comment names is
left out, since their mention row sits on the same comment and the unique index allows one row per person there.

## 6. An ended round's state
`src/documents/approvals.ts:621`: why does an ended round's state win over the open round's state, and how did this
line change over time?

Recorded, newest first: `explanatory-docs/review-flow/04-reject-on-the-server/03-the-round-reads-rejected.md` Piece 6
(a rejection read wherever a request for changes is); `explanatory-docs/draft-review/03-one-review-at-a-time/03-withdraw.md`
Piece 2 (a withdrawn round is ended in every way a requested-changes round is);
`explanatory-docs/draft-review/02-change-request-ends-the-round/02-the-round-ends.md` Piece 2 (cancelled requests would
otherwise read as nobodyLeft or approved; an ended round keeps its outcome);
`explanatory-docs/why-history/02-approval-responses/07-the-round-of-any-version.md` Piece 2 (one loader for the round
of any ready version); the first round in `explanatory-docs/agreements/09-waiting-banner/01-the-round.md` Bucata 2 (F2
A2).

## 7. Someone else's unfreeze
`web/src/pages/DocumentEditorPage.tsx:958-966`: why does the page stay on the frozen version when someone else
unfreezes it?

Recorded: `explanatory-docs/intuitive-review/12-unfreeze-tells-everyone-in-the-app/03-someone-elses-unfreeze.md`,
Piece 5 (F43 I6 task 12): D2, "open pages show a notice until dismissed and nobody is moved off the text they read";
the page used to swap to the draft.

## 8. The room loads before it listens
`src/sync/doc-room.ts:126`: why is the document loaded before the room starts listening for updates?

Recorded only in the map: `logicmap/sync.md` `sync.load-before-listening` (inferred): a handler attached during the
replay would append each replayed update again and relay it. The commit (`aafde564`, June) has no piece.

## 9. The provider's binaryType
`web/src/editor/sync-provider.ts:243`: why does the provider set `binaryType` to `'arraybuffer'`?

Recorded only in the map: `logicmap/sync.md` `sync.socket-delivers-arraybuffers` (inferred): a browser hands binary
frames over as Blobs by default and `new Uint8Array(blob)` is empty, so every frame would throw. The commit
(`af8da098`, June) has no piece.

## 10. loadDoc's rebuild order
`src/sync/doc-store.ts:38-48`: why does `loadDoc` rebuild from the snapshot and then the remaining updates in seq order?

Recorded in the code's comment and the map: the comment above the rebuild (Yjs updates commute, but seq order keeps
the rebuild deterministic and identical to what was edited live) and `sync.load-before-listening`, whose site covers
these lines. The commit (`aafde564`, June) has no piece.
