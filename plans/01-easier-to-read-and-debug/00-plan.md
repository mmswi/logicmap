# Easier to read and to debug with

## Goal

Mihai, 2026-10-15: "da, fa-le pe toate, inclusiv hook-ul. vreau sa faci skill-ul in asa fel incat sa
te ajute pe tine sa intelegi mai usor codul si sa faci si debugging mai usor".

Measured on teamabled (180 active rules, 918 sites), the six gaps this plan closes:

1. A cold start costs about 18k tokens: `show` prints 71.6 KB, one line per rule with its whole `what`
   (median 326 characters, longest 1260). The first sentence of `what` is over 200 characters in 110
   of 180 rules, and nothing checks it. `show access` answers "nothing named".
2. `show <file>` repeats each rule's whole `what` at every site: 15 KB for `src/documents/routes.ts`.
3. Nobody sees which lines an anchor covers, so an edit at line 410 may or may not be under the
   anchor at 395.
4. `git blame` stops at the last commit that touched a line (a move, a reformat), not the one that
   wrote it, so it can miss the piece that explains the line.
5. Nothing makes an agent read the map before it edits, or `check` after.
6. Nothing says what a domain covers or where its code starts.

## Decisions

- 2026-10-15, Claude (recommended option): `show` with no argument prints a map of the domains (each
  domain's intro and its rule ids), not every rule; `show <domain>` lists a domain's rules with the
  first sentence of each `what`; `show <id>` stays the full entry. Each level costs a few thousand
  tokens at most, and the ids already name the rules.
- 2026-10-15, Claude: the claim is the first sentence of `what`, at most 200 characters; the detail
  may follow it in the same field. A warning (`long-what`) flags a longer one. Rejected: a new field
  for the short claim (two texts to keep in agreement), and cutting `what` at a fixed width in `show`
  (a cut mid-sentence can say the opposite of the rule).
- 2026-10-15, Claude: a domain's intro is the text between the `# <domain>` title and its first entry
  in `<domain>.md`, which the parser already skips. No new file.
- 2026-10-15, Claude: the hook works on `Read`, not before `Edit`: an agent understands code while it
  reads it, and an edit always follows a read. After a read it adds the rules that cover the lines
  read; after an edit, what `check` reports for the rules in that file; at `Stop`, `check`'s errors,
  once.

## Steps

### 1. The claim first: `long-what`

- [x] test: a `what` whose first sentence is over 200 characters warns `long-what` at its `what:` line;
      a short first sentence followed by detail does not; a retired entry does not
- [x] code: the warning in `parseEntry`

Files: `scripts/logicmap.ts`, `scripts/logicmap.test.ts`. Seam: `checkRepo`.

### 2. `show`: domains, then a domain, then a rule

- [x] test: `show` lists each domain with its intro and its active rule ids; `show <domain>` lists the
      domain's rules with the first sentence of each `what`
- [x] code: the intro read in `readLedger`; the two views in `showLogicMap`

Files: `scripts/logicmap.ts`, `scripts/logicmap.test.ts`. Seam: `showLogicMap`.

### 3. Covered ranges

- [x] test: `show <id>` and `show <file>` print each site as `start-end`, the anchor's line through the
      last line it covers; `show <file>` lists each rule once, its sites under it
- [x] test: `show <file>:<line>` and `show <file>:<start>-<end>` list only the rules whose covered
      lines meet that range; a file with no anchors says so
- [x] code: the range kept with each site in `collectLockSites`; the views in `showLogicMap`; the
      `:<line>` suffix in `toShowTarget`

Files: `scripts/logicmap.ts`, `scripts/logicmap.test.ts`. Seam: `showLogicMap`.

### 3b. An ack writes only its own domains' lock files

- [x] test: a note another session added to `access.lock` survives an ack of a `sync` id
- [x] code: `ackIds` writes the lock files of the acked ids' domains (all of them only while splitting
      the old single lock)

Files: `scripts/logicmap.ts`, `scripts/logicmap.test.ts`. Seam: `ackIds` and the files it leaves.

### 4. The hook

- [x] test: after a read, the rules covering the lines read; after an edit, the problems of the rules in
      that file; at stop, the errors, and nothing when the stop hook already ran; nothing outside a
      mapped repo
- [x] code: `scripts/hook.ts`, a thin reader of stdin around a function the tests call
- [x] installed in `~/.claude/settings.json`; checked by piping a real hook input into it

Files: `scripts/hook.ts`, `scripts/hook.test.ts`, `~/.claude/settings.json`. Seam: the exported
function that turns a hook input into its output.

### 5. `SKILL.md` and the README

- [x] the first sentence of `what` is the claim (≤ 200 characters); a domain's intro
- [x] the `show` levels and `show <file>:<line>`; the covered range
- [x] finding a line's piece through moves: `git log -L <n>,<n>:<file>`, `git blame -w -C -C`
- [x] the hook: what it does and how to install it

Files: `SKILL.md`, `README.md`.

### 6. Close

- [x] `bun test`, strict `tsc`, `biome check`; commit (push waits for Mihai)

teamabled's side (domain intros, short claims for its 110 long `what`s) is its own task:
teamabled `explanatory-docs/logicmap/05-short-claims-and-domain-intros/`.

## Revisions
- 2026-10-15: step 3b added. Four subagents were about to shorten teamabled's claims in parallel, and
  every ack rewrote every domain's lock file, so two acks running at once (two sessions, or two
  agents) could overwrite each other's lines. Found by Claude while planning that work.
