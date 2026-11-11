---
name: logicmap
description: "Logicmap: `§` anchors in code comments tied to a `logicmap/` ledger of decisions, invariants, edge cases and cross-file flows, plus a checker that flags anchors whose code changed. Use when a repo has a `logicmap/` folder or `§decision` / `§invariant` / `§edge` / `§flow` / `§uses` / `§test` comments (read the map before editing, deleting or explaining that code, ask it why a line is as it is, and plan each task against it); when asked to map complex logic, edge cases or flows so agents can follow them and explain why, including in an old codebase where nothing records the reasons; or when setting the method up in a repo."
---

# Logicmap

Code carries what it does. It does not carry why it is this way, which alternative was rejected, which
other file relies on it, or which step of a process comes next across a socket or a queue. A logicmap
records exactly that knowledge and ties it to the code with three parts:

- **anchors**: one-line comment markers, `§<role> <id>@<version>`, at every site that defines or relies
  on a piece of knowledge. One id, grepped, returns every anchored site;
- **ledger**: `logicmap/<domain>.md`, one entry per id: what holds, why, what was rejected, what breaks;
- **lock**: `logicmap/<domain>.lock` beside each ledger file, a fingerprint of the code under every
  defining anchor (`decision`, `invariant`, `edge`, `flow`) and of every entry, so the checker knows
  when code changed under a rationale nobody re-read. A `uses` or `test` site is not in it: its version
  pin is all it claims, and `stale-pin` checks that. Only `ack` writes the lock.

The checker, run from anywhere inside the repo:

```
bun ~/.claude/skills/logicmap/scripts/logicmap.ts check
bun ~/.claude/skills/logicmap/scripts/logicmap.ts ack <id>...
bun ~/.claude/skills/logicmap/scripts/logicmap.ts ack --renamed
bun ~/.claude/skills/logicmap/scripts/logicmap.ts bump <id> <what changed>
bun ~/.claude/skills/logicmap/scripts/logicmap.ts show [<domain> | <id> | <file>[:<line>[-<line>]]] [--all]
bun ~/.claude/skills/logicmap/scripts/logicmap.ts find <word>...
bun ~/.claude/skills/logicmap/scripts/logicmap.ts diff <id>
bun ~/.claude/skills/logicmap/scripts/logicmap.ts why <file>:<line>[-<line>] | <file>:<name> | <id>
```

`show` reads the map from the widest view to the narrowest:

- `show`: every domain with its intro and its rule ids. Start here on a cold start.
- `show <domain>`: the domain's rules, each with its claim (the first sentence of its `what`).
  These two views print in full up to 20,000 characters. A longer one leaves the rule ids (`show`) or the claims
  (`show <domain>`) out and says so in its second line; `--all` prints it in full.
- `show <id>`: one entry in full and every site, as `file:start-end`, flow steps in order.
- `show <file>`: each rule in the file once, with the lines each of its sites covers.
- `show <file>:<line>` or `<file>:<start>-<end>`: only the rules covering those lines.

`find <word>...` lists the rules whose id or entry hold every word, case ignored, each with its claim and status:
the way to the rules about something (`find viewer rename`) when no file is known yet. A word in an id comes first;
past 30 rules it counts the rest, and another word narrows them.

`why` says why code is as it is and how it got there, from git and the pieces recorded with each commit:

- `why <file>:<line>` or `<file>:<start>-<end>`: the rules covering the lines, each with its why and the
  alternatives it rejected; then every commit that changed them, newest first, each with the piece recorded
  with it (its What and Why) and its task's goal. The lines are the file as it is now, uncommitted edits
  included.
- `why <file>:<name>`: the same for the top-level declaration of that name.
- `why <id>`: the rule, its why, what it rejected and its history; then every commit that changed its entry,
  each with the piece naming the id.

Run it before changing code this session didn't write, and first when a line misbehaves: the newest commit of
the lines is where to look.

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
   - no anchor: `why <file>:<start>-<end>` (or `<file>:<name>`). The piece under a commit is the reason
     the code was written, as of that commit. Under a commit with only its subject or its task's goal,
     derive the reason from the code and the commit, and say it is inferred.

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

- `changed` or `unacked`: re-read the entry against the new code. Under a `changed` site `check` prints the rule's
  claim and the change since its last ack (20 lines of it, for the first 10 changed sites); `diff <id>` prints all
  of it, and `show <id>` the whole entry. An ack says the entry was read against that change. When the message says
  the anchor covers more than 60 lines and the edit was beside the rule, move the anchor to the smaller block that
  holds the rule.
  - The entry still holds → `ack <id>`.
  - The entry no longer holds → **bump**: `bump <id> <what changed>` sets the entry's `version: N+1`, adds the
    `history:` line and moves the definition anchor's pin to `@N+1` (a flow's pins all stay). Then rewrite the
    entry's `what` / `why` to what holds now. `check` reports every other site as `stale-pin`, and `bump` lists
    them: open each, re-verify it against the new entry, fix the code if needed, move its pin. Then `ack <id>`.
- `renamed`: the code changed only by words renamed one for one; the message lists them, `old → new`
  (`diff <id>` shows them when no commit holds the acked code). Read the list. Each new name for the same
  thing → `ack --renamed`, which acks every id whose only errors are renames. A new name that points at
  another thing (a call to another function, a field of another object) is a change: read the entry as
  for `changed`. Text in JSX, a regular expression's body, a comment after code and a template literal
  over several lines are read as words too, so a reworded message there is listed as a rename: the list
  is where it shows.
- Moved code: the anchors move with it. A site whose code is as it was acked, in another file or under
  another number, is no problem; `ack <id>` rewrites its key. Moved and renamed, it is `renamed`; moved
  and otherwise edited, `unacked`.
- `unanchored-match`: the line has what the entry's `grep:` looks for and lies under none of its
  anchors. When it sends or reads what the rule governs, read the rule against it and anchor it (`uses`,
  `test` in a test); when the pattern caught something else, narrow the pattern.
- Deleted logic: delete its anchors, set `status: retired` with a `history:` line saying why, `ack <id>`
  (which also drops the `gone` lock lines). A retired id is never reused.
- Any other error names its fix in the message (`orphan-entry`, `duplicate-definition`,
  `step-without-site`, `undocumented`, `malformed-anchor`, ...).

`check` fingerprints only the sites that define a rule. Code under a `uses` or `test` site is checked by
reading: after an edit there, read the rule (`show <id>`) against the new code. The code under a `uses` site
must still rely on what the rule says, and a `test` must still fail when the rule breaks. The hook names
those rules after the edit; there is nothing to ack.

Done when `check` exits 0. A version moves only when the meaning changes; reformatting and refactors
that keep the meaning end in `ack`.

## Adding anchors

An anchor earns its place when at least one holds:

- code relies on something enforced in another file and nothing in the names links them: a mirrored
  constant under a different name, a check made on the other side of a socket, queue or HTTP call →
  `invariant` at the enforcing site, `uses` at each relying site. `check` fingerprints the enforcing side only,
  so a mirrored constant also gets a test comparing both sides wherever a test can import both;
- code looks redundant or wrong but is right → `edge`;
- a reasonable alternative was rejected and an agent could bring it back → `decision`;
- a process crosses files or processes where no call graph follows it (HTTP, websocket, queue, event,
  cron) → `flow`, one anchor per step;
- a message crosses processes and every sender and reader must agree on it (a live frame, a job), named the
  same way at every site → its rule gets a `grep:` that matches that name, and every line naming it is a site:
  `check` reports the ones under no anchor of the rule.

Grep already finds the callers of a function by its name; anchors carry the links grep cannot see.
Most files need none; the few files where rules and flows meet carry several.

1. Pick the id: `<domain>.<claim-or-subject>`, kebab case, the domain names the ledger file. Name the
   rule: `sync.close-during-join`, `access.not-found-not-forbidden`.
2. Write the entry (its short form is below). When nothing records why the code is this way (an old or
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

The forms, in short. All of it, with what `check` enforces, is `anchors-and-entries.md` beside this file: read it
before the first anchor or entry you write in a session, and when `check` reports a format error its message does
not settle.

- Anchor: `§<role> <id>@<version>` in a comment, plus ` #<step>` on a flow's anchors. `decision`, `invariant`,
  `edge` and `flow` define a rule; `uses` and `test` refer to one. It covers its own line when code precedes it,
  otherwise the first code line below it and everything indented under that line.
- Entry: `## <id>` in `logicmap/<domain>.md`, then `kind:`, `version: 1`, `what:`, `why:`, `source:`, one field per
  line; a flow adds `steps:`. The first sentence of `what` is the claim: the rule itself, as its sites hold it,
  in at most 200 characters. `source:` opens with `inferred` and the evidence when you worked the why out from
  the code; otherwise it names where a person recorded it (a doc, a commit message, a comment stating the why).
- An `edge` or `invariant` with no `test` anchor warns until it has one, or an `untested:` field saying why no
  test can prove it. Warnings leave `check`'s exit at 0; errors do not.
- `§` followed by a lowercase letter always starts an anchor. Prose about the method writes `§<role>` or the bare
  id; a file that quotes anchors goes in `logicmap/ignore`.

## The hook (Claude Code)

With `scripts/hook.ts` installed, lines opening with `logicmap:` arrive after a tool call, in any repo with a
`logicmap/` folder:

- after code is read (the Read tool, or `sed -n <first>,<last>p <file>` or `cat <file>` in a Bash command): the
  rules covering those lines, in full the first time in a session (a subagent has its own) and by id after that,
  and the newest commit of the lines;
- after a file is changed (Edit, Write, or a Bash command): the errors `check` reports in it, and the rules its
  `uses` and `test` sites rely on;
- at the end of a turn: `check`'s errors, for a session that changed a file in the repo.

The hook adds to what this file asks and replaces none of it: run `show <id>` before relying on a rule it names,
and `check` before a commit. Installing it, and what each event answers: `the-hook.md`.

## The rest of the method

Each is a file beside this one, read at the moment named:

- `anchors-and-entries.md`: before the first anchor or entry you write in a session. The anchor grammar and what
  an anchor covers, the ledger entry's fields, what `check` enforces.
- `working-a-task.md`: before the plan of a task (a feature step, a bug fix, a refactor, mapping an area) in a
  mapped repo whose agent instructions give no task steps of their own, and when resuming one. The plan and the
  rules each step names, recording a decision, recording each piece so `why` leads to it.
- `mapping-an-existing-repo.md`: before an entry for code whose reasons nobody wrote down.
- `the-hook.md`: to install the hook, or when a line it prints is unclear.
- `setting-up-a-repo.md`: to start a `logicmap/` in a repo.
