# Working a task in a mapped repo

A task (a feature step, a bug fix, a refactor, mapping an area that changes no code) can outlive the
session that starts it: the session ends or its context is compacted, and the next agent starts with
nothing. So the task's state lives in a plan file in the repo, and the plan names the rules each step
touches.

1. **Plan before code.** Read the code the task touches, then write the plan. A task is a folder, where
   the repo's agent instructions say; when they name no place, `plans/<NN>-<task-slug>/` at the repo
   root, holding `00-plan.md` and one doc per step (step 5). Never in `logicmap/`: every
   `logicmap/*.md` is read as a ledger file. List the folder of the plans in `logicmap/ignore`: a piece's
   diff quotes anchor lines, and `why` still reads the step docs there. The plan holds the goal (what the user
   asked, in their words, with the date), numbered steps, and empty `Decisions` and `Revisions`
   sections. Under each step: checkbox sub-steps, one change you can name each; the files it touches;
   its rules (next point).
   Done when every change the task needs has a sub-step and every rule it touches is named in a step.
2. **Map each step to its rules.** For each file a step touches, run `show <file>`, then `show <id>`
   for each id in the region the step edits. List them under the step by what the step does to them:
   - `relies on`: the step must keep the rule true;
   - `touches`: code under its anchors changes, and `check` will ask whether the rule still holds.
     When the plan already knows the meaning changes, write `changes <id>@N → @N+1` and list the other
     sites `show <id>` prints: the step runs `bump` before its first test, whose anchor pins `@N+1`, and
     re-verifies each of those sites;
   - `creates`: a new rule; pick its id and kind now;
   - `retires`: logic the step deletes.

   A step that holds another process's data (a store, a cache, a list read once) names the messages
   that change that data and `show`s their rules: a rule with a `grep:` lists every sender and reader,
   and the step's code becomes one more reader, anchored. A message with no such rule gets one.

   A rule the step relies on that has no entry yet gets a sub-step that maps it. A plan writes ids,
   never anchors (`access.not-found-not-forbidden@1`, not the `§<role>` form): outside `logicmap/`, a
   `§` followed by a lowercase letter is scanned as an anchor unless its file is in `logicmap/ignore`.
3. **Record a decision when the user makes it.** When the user chooses between alternatives, in chat
   or by answering a question, add it to the plan's `Decisions` at once: the choice, the alternative
   rejected and why, in their words, with who and when. Its `decision` entry is written in the same
   change as the code that implements it, with `why` and `rejected` from the plan and `source:
   confirmed by <name> <date>`. It cannot land earlier: an entry with no anchor fails `check`
   (`orphan-entry`). A decision that changes a rule already mapped, of any kind, is a bump of that entry:
   its `why` and `rejected` take the decision, and no second entry is written.
4. **Work one step at a time.** The change that creates or changes a rule writes or updates its entry
   and anchors in that same change. Run `check`, resolve every line, tick the sub-step. Keep where the
   step stands in the plan as it changes (done; half-done and what is left; blocked and on what), not
   only at the end.
5. **Record each piece as you write it.** A piece is one function, or one piece of logic inside a
   function: a query, a changed return value, a rename across its call sites. Before writing it,
   append its entry to the step's doc (`<NN>-<step-slug>.md` beside the plan), then write exactly that
   code:

   ````markdown
   ## Piece 2: the rename route asks canRenameDocument
   What: PATCH /documents/:id checks canRenameDocument instead of canEditDocument.
   Why: viewers may rename but not edit. The socket's write flag keeps canEditDocument, so loosening
     canEditDocument (rejected) would let viewers edit the content over the socket.
   Where: src/documents/routes.ts:233
   ```diff
   -    if (!canEditDocument(resolved.access)) {
   +    if (!canRenameDocument(resolved.access)) {
   ```
   ````

   `Why` says what the piece solves, and names the alternative not taken when there was one. Add to
   the entry what happened while writing it: a deviation from the code shown, the output of the run
   that confirmed it. Commit the entry in the same commit as its code: that is what lets `why` on
   any line lead to the reason it was written (below).
6. **Revise the plan when a finding changes it.** A finding that changes a step (yours, a review's, a
   failing test's) changes the plan before more code: edit the steps and their rules, and add a
   `Revisions` line with the date, what changed, the finding and who found it.
7. **Close.** `check` exits 0 and every sub-step is ticked or moved by a revision; then commit by the
   repo's rules, or one commit per step when it has none.

Resuming a task: read its plan, then `show <id>` for each id it names, then `check`. The first step
with an unticked sub-step is where the work stands.

Why a line was written, and what it was meant to solve: `why <file>:<line>` follows each commit that
changed the line to the step doc written with it and the piece in it that holds the line's code or names
the file: the reason, as the agent that wrote the line recorded it. By hand it is `git log -L <n>,<n>:<file>`,
`git show --name-only <hash>`, then the doc. `-L` stays inside one file: for code moved from another,
`git blame -w -C -C -L <n>,<n> <file>` finds the commit that wrote it. A repo that squash-merges keeps one
commit per branch, holding every piece of the branch; `why` picks the piece holding the line's code. A piece
describes the code as of its commit: compare it with the code today before repeating it. What must hold now
is the logicmap entry, which `why` prints first.

The plan of the task that piece 2 above belongs to, `plans/03-viewers-may-rename/00-plan.md`:

```markdown
# Viewers may rename a document

## Goal
<name>, 2026-10-14: "viewers should be able to rename a document, not edit it"

## Steps
### 1. A rename right separate from the edit right
- [ ] canRenameDocument, true for every access that can read
- [ ] PATCH /documents/:id asks canRenameDocument; the socket keeps canEditDocument
Files: src/documents/access.ts, src/documents/routes.ts
Rules:
- changes access.rest-and-ws-share-resolver@1 → @2 (rename stops sharing the socket's rule);
  re-verify src/sync/ws-routes.ts:45, src/sync/ws-routes.ts:67, src/sync/sync.test.ts:343
- relies on access.not-found-not-forbidden@1
- creates access.rename-open-to-readers (decision)

## Decisions
- 2026-10-14, <name>: rename gets its own rule; loosening canEditDocument was rejected because
  viewers would also edit the content over the socket

## Revisions
```
