---
name: logicmap
description: "Logicmap: `§` anchors in code comments tied to a `logicmap/` ledger of decisions, invariants, edge cases and cross-file flows, plus a checker that flags anchors whose code changed. Use when a repo has a `logicmap/` folder or `§decision` / `§invariant` / `§edge` / `§flow` / `§uses` / `§test` comments (read the map before editing, deleting or explaining that code, and plan each task against it); when asked to map complex logic, edge cases or flows so agents can follow them and explain why, including in an old codebase where nothing records the reasons; or when setting the method up in a repo."
---

# Logicmap

Code carries what it does. It does not carry why it is this way, which alternative was rejected, which
other file relies on it, or which step of a process comes next across a socket or a queue. A logicmap
records exactly that knowledge and ties it to the code with three parts:

- **anchors**: one-line comment markers, `§<role> <id>@<version>`, at every site that defines or relies
  on a piece of knowledge. One id, grepped, returns every anchored site;
- **ledger**: `logicmap/<domain>.md`, one entry per id: what holds, why, what was rejected, what breaks;
- **lock**: `logicmap/<domain>.lock` beside each ledger file, a fingerprint of the code under every
  anchor and of every entry, so the checker knows when code changed under a rationale nobody re-read.
  Only `ack` writes it, and an ack rewrites only the lock of its own domain. A repo with the single
  `logicmap/lock` of earlier versions is read as is, and split by its next ack.

The checker, run from anywhere inside the repo:

```
bun ~/.claude/skills/logicmap/scripts/logicmap.ts check
bun ~/.claude/skills/logicmap/scripts/logicmap.ts ack <id>...
bun ~/.claude/skills/logicmap/scripts/logicmap.ts show [<domain> | <id> | <file>[:<line>[-<line>]]]
```

`show` reads the map from the widest view to the narrowest, each a few thousand tokens at most:

- `show`: every domain with its intro and its rule ids. Start here on a cold start.
- `show <domain>`: the domain's rules, each with its claim (the first sentence of its `what`).
- `show <id>`: one entry in full and every site, as `file:start-end`, flow steps in order.
- `show <file>`: each rule in the file once, with the lines each of its sites covers.
- `show <file>:<line>` or `<file>:<start>-<end>`: only the rules covering those lines.

## Reading anchored code

1. Before editing, deleting, simplifying or explaining a file, run `show <file>`, or
   `show <file>:<start>-<end>` for the lines you will touch. It lists each rule with its claim, and
   under it the lines each site covers and its status. For every id in the region you will touch, run
   `show <id>`: the full entry and every anchored site, flow steps in order. Callers that reach the rule through a
   function the entry names (`getDocumentAccessForUser`) are not anchored; grep that name too.
   Done when you know every id in that region, every anchored site of those ids, and the callers of
   the functions their entries name.
2. Match your confidence to the status:
   - `ok` and `recorded`: the fingerprint matches, the pin is current, and the intent is written down
     somewhere a person put it. State the entry's why as fact and cite it (`sync.close-during-join@1`,
     `logicmap/sync.md`).
   - `ok` and `inferred`: an agent worked the entry out from the code. State what the code does as
     fact; give the why as inferred, with the evidence its `source` cites.
   - `changed`, `unacked` or `stale-pin`: code moved since anyone re-read the entry. Present the why as
     the recorded rationale, re-derive the behaviour from the code, and repair the map (next section).
   - no anchor: look for the piece recorded with the line's commit (`git log -L`, then the step doc in
     that commit; see "Working a task in a mapped repo"). It gives the reason the code was written, as
     of that commit. Without one, derive from the code and `git log`, and say the reason is inferred.

   An entry is a claim even when `ok`: the fingerprint proves the code has not moved since the last
   ack, not that the entry was right. When the code contradicts the entry, describe what the code
   does, never what the entry says, and resolve the disagreement before you finish:
   - the entry is wrong about the intended behaviour → fix the entry, then `ack` (bump when its `what`
     changed, so the other sites get re-verified);
   - the code breaks a rule that is still wanted → that is a bug: fix the code or report it, and the
     entry stays as it is.
   When you cannot tell which side is wrong, ask the user.
3. An `edge` anchor is a Chesterton's fence: the code under it handles a case on purpose. Keep it
   unless the entry's `revisit-if` holds or the user decides to drop it.

## Changing anchored code

After every edit to anchored code, run `check` and resolve each line it prints:

- `changed` or `unacked`: re-read the entry against the new code.
  - The entry still holds → `ack <id>`.
  - The entry no longer holds → **bump**: in the entry set `version: N+1`, rewrite `what` / `why`, add a
    `history:` line; move the definition anchor's pin to `@N+1`. `check` now reports every other site as
    `stale-pin`: open each, re-verify it against the new entry, fix the code if needed, move its pin.
    Then `ack <id>`.
- Moved code: the anchors move with it; `ack <id>`.
- Deleted logic: delete its anchors, set `status: retired` with a `history:` line saying why, `ack <id>`
  (which also drops the `gone` lock lines). A retired id is never reused.
- Any other error names its fix in the message (`orphan-entry`, `duplicate-definition`,
  `step-without-site`, `undocumented`, `malformed-anchor`, ...).

Done when `check` exits 0. A version moves only when the meaning changes; reformatting and refactors
that keep the meaning end in `ack`.

## Adding anchors

An anchor earns its place when at least one holds:

- code relies on something enforced in another file and nothing in the names links them: a mirrored
  constant under a different name, a check made on the other side of a socket, queue or HTTP call →
  `invariant` at the enforcing site, `uses` at each relying site;
- code looks redundant or wrong but is right → `edge`;
- a reasonable alternative was rejected and an agent could bring it back → `decision`;
- a process crosses files or processes where no call graph follows it (HTTP, websocket, queue, event,
  cron) → `flow`, one anchor per step.

Grep already finds the callers of a function by its name; anchors carry the links grep cannot see.
Most files need none; the few files where rules and flows meet carry several.

1. Pick the id: `<domain>.<claim-or-subject>`, kebab case, the domain names the ledger file. Name the
   rule: `sync.close-during-join`, `access.not-found-not-forbidden`.
2. Write the entry (format below). When nothing records why the code is this way (an old or
   handed-over codebase), follow `mapping-an-existing-repo.md` in this skill's folder: it separates
   what you can see from what you infer, and ends with the user confirming the intent.
3. Put the definition anchor on the comment line above the smallest block that holds the whole rule, or
   at the end of a single line. An anchor covers one statement and what is indented under it, so a
   rule made of two statements (a peek, then the `if` that acts on it) is anchored on the block around
   both. Add `uses` at relying sites, and `test` above a test only if its assertions fail when the rule
   breaks: a test that asserts "refused" does not prove "refused with 404". The checker cannot read
   assertions, so this one is on you.
4. `ack <id>`, then `check`.

Done when `check` exits 0 and `show <id>` lists every site you meant.

## Anchor grammar

```
§<role> <id>@<version>[ #<step>][ free text]
```

- role: `decision`, `invariant`, `edge`, `flow` define; `uses`, `test` refer.
- id: two or more dot-separated lowercase segments, kebab case inside; the first segment is the domain.
- version: the entry's current version, starting at 1.
- `#<step>`: flow anchors only, the number of the step in the entry's `steps:`.
- Free text after the anchor is a local note about this site.
- Several anchors can stack above one block, one per comment line.
- Among JSX children a `//` line is text that renders into the page; write the anchor as a JSX
  comment there, `{/* §uses teams.invite-link-param-mirrored@1 */}`. Between JSX attributes and in
  plain code, `//` is fine.
- `§` followed by a lowercase letter always starts an anchor. Prose that mentions the syntax writes
  `§<role>`; a file that quotes real-looking anchors as examples (docs about the method, articles) is
  listed in `logicmap/ignore`, one git pathspec per line, and is not scanned.

An anchor covers its own line when code precedes it (`return null // §edge ...`), otherwise the first
code line below its comment, plus everything indented under that line and the closing bracket lines
(`}`, `} else {`, `)`) at its indentation. The fingerprint hashes that span, whitespace ignored.

`check` enforces: each `decision`, `invariant` and `edge` id has exactly one defining anchor; each flow
step has at least one site unless marked `(external)`; every anchor pins the entry's version; the role
matches the entry's kind; retired ids have no anchors; every active entry has a site; every anchor and
entry fingerprint matches the lock. It warns when an `edge` or `invariant` has no `test` anchor, and when
the first sentence of an active entry's `what` is over 200 characters (`long-what`).

## Ledger entry

```markdown
## sync.close-during-join
kind: edge
version: 1
what: The socket can close while joinRoom is still loading the document.
why: joinRoom adds the connection to the room before it resolves, so a socket that closed meanwhile
  must be removed when the join lands; otherwise the room keeps it and is never destroyed.
breaks-if: the closedEarly branch goes → one leaked room per document opened and abandoned mid-load.
source: the comments in src/sync/ws-routes.ts (commit aafde56)
history:
- @1: introduced
```

- Required: `kind` (`decision` | `invariant` | `edge` | `flow`), `version`, `what`, `why`, `source`.
- The first sentence of `what` is the claim: the rule itself, in at most 200 characters. It is what
  `show <domain>` and `show <file>` print for the rule. The detail of the rule may follow it in the same
  field. A sentence ends at `.`, `!` or `?` before a capital letter or the end of the field, so `e.g.`
  and `req.ip` do not end it.
- `source` says where the claim comes from. `inferred — <evidence>` (commits, tests, traced paths)
  when an agent worked it out from the code; otherwise where a person recorded the intent: a doc, an
  ADR, a PR or issue, a commit message, `confirmed by <name> <date>`. `show` prints `inferred` or
  `recorded` beside every entry.
- Optional: `rejected` (alternative → why not), `breaks-if`, `revisit-if` (the condition that reopens
  it), `status` (`active` default, or `retired`), `history`.
- Flow entries add `steps:`, one `N. text` line per step; append `(external)` to a step with no code in
  this repo (a user clicking an email link).
- A line indented under a field continues it. The file is `logicmap/<domain>.md`; the heading is the id.
- The file opens with `# <domain>` and a short intro, the prose above its first entry: what the domain's
  rules cover and where its code starts. `show` prints it beside the domain's rule ids.

## Working a task in a mapped repo

A task (a feature step, a bug fix, a refactor) can outlive the session that starts it: the session
ends or its context is compacted, and the next agent starts with nothing. So the task's state lives in
a plan file in the repo, and the plan names the rules each step touches.

1. **Plan before code.** Read the code the task touches, then write the plan. A task is a folder, where
   the repo's agent instructions say; when they name no place, `plans/<NN>-<task-slug>/` at the repo
   root, holding `00-plan.md` and one doc per step (step 5). Never in `logicmap/`: every
   `logicmap/*.md` is read as a ledger file. The plan holds the goal (what the user
   asked, in their words, with the date), numbered steps, and empty `Decisions` and `Revisions`
   sections. Under each step: checkbox sub-steps, one change you can name each; the files it touches;
   its rules (next point).
   Done when every change the task needs has a sub-step and every rule it touches is named in a step.
2. **Map each step to its rules.** For each file a step touches, run `show <file>`, then `show <id>`
   for each id in the region the step edits. List them under the step by what the step does to them:
   - `relies on`: the step must keep the rule true;
   - `touches`: code under its anchors changes, and `check` will ask whether the rule still holds.
     When the plan already knows the meaning changes, write `changes <id>@N → @N+1` and list the other
     sites `show <id>` prints: the step re-verifies each one;
   - `creates`: a new rule; pick its id and kind now;
   - `retires`: logic the step deletes.

   A rule the step relies on that has no entry yet gets a sub-step that maps it. A plan writes ids,
   never anchors (`access.not-found-not-forbidden@1`, not the `§<role>` form): outside `logicmap/`, a
   `§` followed by a lowercase letter is scanned as an anchor unless its file is in `logicmap/ignore`.
3. **Record a decision when the user makes it.** When the user chooses between alternatives, in chat
   or by answering a question, add it to the plan's `Decisions` at once: the choice, the alternative
   rejected and why, in their words, with who and when. Its `decision` entry is written in the same
   change as the code that implements it, with `why` and `rejected` from the plan and `source:
   confirmed by <name> <date>`. It cannot land earlier: an entry with no anchor fails `check`
   (`orphan-entry`).
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
   that confirmed it. Commit the entry in the same commit as its code: that is what lets `git blame`
   on any line lead to the reason it was written (below).
6. **Revise the plan when a finding changes it.** A finding that changes a step (yours, a review's, a
   failing test's) changes the plan before more code: edit the steps and their rules, and add a
   `Revisions` line with the date, what changed, the finding and who found it.
7. **Close.** `check` exits 0 and every sub-step is ticked or moved by a revision; then commit by the
   repo's rules.

Resuming a task: read its plan, then `show <id>` for each id it names, then `check`. The first step
with an unticked sub-step is where the work stands.

Why a line was written, and what it was meant to solve: `git log -L <n>,<n>:<file>` lists every commit
that changed those lines, newest first; `git blame -w -C -C -L <n>,<n> <file>` finds the commit that
wrote the line through whitespace changes and code moved between files, where a plain `git blame`
stops at the move or the reformat. The commit's files include the step doc written with it; the piece
in that doc that names the function or the file is the reason, as the agent that wrote the line
recorded it. A piece describes the
code as of its commit: compare it with the code today before repeating it. What must hold now is the
logicmap entry, when the line has one.

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

## The hook (Claude Code)

`scripts/hook.ts` puts the map in front of the agent without being asked, in every repo with a
`logicmap/` folder (anywhere else it prints nothing):

- after a `Read`, the rules covering the lines read, with their claims and covered lines;
- after an `Edit`, `MultiEdit` or `Write`, the errors `check` reports in that file, with what to do;
- at `Stop`, `check`'s errors, once: the agent resolves them, or tells the user why they stay (another
  session's work in progress).

Install it once, in `~/.claude/settings.json` (merge into the `hooks` already there):

```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "Read", "hooks": [{ "type": "command", "command": "bun ~/.claude/skills/logicmap/scripts/hook.ts", "timeout": 30 }] },
      { "matcher": "Edit|MultiEdit|Write", "hooks": [{ "type": "command", "command": "bun ~/.claude/skills/logicmap/scripts/hook.ts", "timeout": 30 }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "bun ~/.claude/skills/logicmap/scripts/hook.ts", "timeout": 30 }] }
    ]
  }
}
```

The hook adds to what the protocol asks; it does not replace it. Run `show <id>` before relying on a rule
the hook names, and `check` before a commit.

## Setting it up in a repo

1. Create `logicmap/` and map the 3 to 10 places agents most often get wrong: the cross-file rules,
   the fences, the flows nobody can trace. Open each `<domain>.md` with `# <domain>` and its intro. In a codebase whose reasons are not written down, follow
   `mapping-an-existing-repo.md`.
2. `ack` every id; `check` exits 0.
3. Add this to the repo's agent instructions (`AGENTS.md`, `CLAUDE.md`), so agents without this skill
   can read the map:

   ```markdown
   ## Logicmap
   Comments of the form `§<role> <id>@<version>` anchor code to entries in `logicmap/<domain>.md` (the
   rule, why, the rejected alternatives, what breaks). `logicmap` below means
   `bun ~/.claude/skills/logicmap/scripts/logicmap.ts`, run from anywhere in the repo.
   - On a cold start, `logicmap show`: every domain and its rule ids. Before editing or explaining
     anchored code: `logicmap show <file>` (or `<file>:<start>-<end>`), then `logicmap show <id>` for
     each id you touch (its entry and every anchored site, flow steps in order).
   - After editing: `logicmap check`, and resolve each line it prints: `logicmap ack <id>` when the entry
     still holds; when its meaning changed, bump the entry's `version`, re-verify every site `check` then
     reports as `stale-pin`, move those pins, and ack.
   - Roles: `decision`, `invariant`, `edge`, `flow` define a rule; `uses`, `test` point at one. Files
     that only talk about anchors go in `logicmap/ignore`. The full method: the `logicmap` skill.
   - A task starts with a plan (in `plans/<NN>-<task-slug>/` unless this file names another place):
     numbered steps, each listing the logicmap ids it relies on, changes, creates or retires. A
     decision the user makes goes into the plan at once, and into its entry with the code that
     implements it. Each piece of code is recorded in its step's doc (`## Piece N`: what, why, where,
     the code) and committed with it, so `git blame` leads from a line to why it was written.
   - An entry whose `source:` starts with `inferred` is an agent's reading of the code, not a recorded
     decision: when you repeat its why, say it is inferred and cite the evidence.
   ```

4. For CI or a pre-commit hook, copy `scripts/logicmap.ts` to `logicmap/logicmap.ts` (the ledger
   folder is never scanned, so the script's own message templates are not read as anchors) and run
   `bun logicmap/logicmap.ts check` there.
