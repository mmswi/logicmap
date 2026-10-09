---
name: logicmap
description: "Logicmap: `§` anchors in code comments tied to a `logicmap/` ledger of decisions, invariants, edge cases and cross-file flows, plus a checker that flags anchors whose code changed. Use when a repo has a `logicmap/` folder or `§decision` / `§invariant` / `§edge` / `§flow` / `§uses` / `§test` comments (read the map before editing, deleting or explaining that code); when asked to map complex logic, edge cases or flows so agents can follow them and explain why, including in an old codebase where nothing records the reasons; or when setting the method up in a repo."
---

# Logicmap

Code carries what it does. It does not carry why it is this way, which alternative was rejected, which
other file relies on it, or which step of a process comes next across a socket or a queue. A logicmap
records exactly that knowledge and ties it to the code with three parts:

- **anchors**: one-line comment markers, `§<role> <id>@<version>`, at every site that defines or relies
  on a piece of knowledge. One id, grepped, returns every anchored site;
- **ledger**: `logicmap/<domain>.md`, one entry per id: what holds, why, what was rejected, what breaks;
- **lock**: `logicmap/lock`, a fingerprint of the code under every anchor and of every entry, so the
  checker knows when code changed under a rationale nobody re-read.

The checker, run from anywhere inside the repo:

```
bun ~/.claude/skills/logicmap/scripts/logicmap.ts check
bun ~/.claude/skills/logicmap/scripts/logicmap.ts ack <id>...
bun ~/.claude/skills/logicmap/scripts/logicmap.ts show [<id> | <file>]
```

`show` with no argument lists every entry: the fastest map of a repo's tricky parts on a cold start.

## Reading anchored code

1. Before editing, deleting, simplifying or explaining a file, run `show <file>`. It lists each anchor
   with its entry's `what` and its status. For every id in the region you will touch, run `show <id>`:
   the full entry and every anchored site, flow steps in order. Callers that reach the rule through a
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
   - no anchor: derive from the code and `git log`, and say the reason is inferred.

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
entry fingerprint matches the lock. It warns when an `edge` or `invariant` has no `test` anchor.

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

- Required: `kind` (`decision` | `invariant` | `edge` | `flow`), `version`, `what` (one line, the claim),
  `why`, `source`.
- `source` says where the claim comes from. `inferred — <evidence>` (commits, tests, traced paths)
  when an agent worked it out from the code; otherwise where a person recorded the intent: a doc, an
  ADR, a PR or issue, a commit message, `confirmed by <name> <date>`. `show` prints `inferred` or
  `recorded` beside every entry.
- Optional: `rejected` (alternative → why not), `breaks-if`, `revisit-if` (the condition that reopens
  it), `status` (`active` default, or `retired`), `history`.
- Flow entries add `steps:`, one `N. text` line per step; append `(external)` to a step with no code in
  this repo (a user clicking an email link).
- A line indented under a field continues it. The file is `logicmap/<domain>.md`; the heading is the id.

## Setting it up in a repo

1. Create `logicmap/` and map the 3 to 10 places agents most often get wrong: the cross-file rules,
   the fences, the flows nobody can trace. In a codebase whose reasons are not written down, follow
   `mapping-an-existing-repo.md`.
2. `ack` every id; `check` exits 0.
3. Add this to the repo's agent instructions (`AGENTS.md`, `CLAUDE.md`), so agents without this skill
   can read the map:

   ```markdown
   ## Logicmap
   Comments of the form `§<role> <id>@<version>` anchor code to entries in `logicmap/<domain>.md` (the
   rule, why, the rejected alternatives, what breaks). `logicmap` below means
   `bun ~/.claude/skills/logicmap/scripts/logicmap.ts`, run from anywhere in the repo.
   - Before editing or explaining anchored code: `logicmap show <file>`, then `logicmap show <id>` for
     each id you touch (its entry and every anchored site, flow steps in order).
   - After editing: `logicmap check`, and resolve each line it prints: `logicmap ack <id>` when the entry
     still holds; when its meaning changed, bump the entry's `version`, re-verify every site `check` then
     reports as `stale-pin`, move those pins, and ack.
   - Roles: `decision`, `invariant`, `edge`, `flow` define a rule; `uses`, `test` point at one. Files
     that only talk about anchors go in `logicmap/ignore`. The full method: the `logicmap` skill.
   - An entry whose `source:` starts with `inferred` is an agent's reading of the code, not a recorded
     decision: when you repeat its why, say it is inferred and cite the evidence.
   ```

4. For CI or a pre-commit hook, copy `scripts/logicmap.ts` to `logicmap/logicmap.ts` (the ledger
   folder is never scanned, so the script's own message templates are not read as anchors) and run
   `bun logicmap/logicmap.ts check` there.
