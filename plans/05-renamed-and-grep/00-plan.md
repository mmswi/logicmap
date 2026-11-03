# A rename told apart from a change; every reader of a message a site of its rule

## Goal
Mihai, 2026-11-03, after the agent's account of how logicmap served teamabled's TODO 115 ("cum a functionat logicmap
pana acum? te-a ajutat sau nu?"): "de acord cu imbunatatirile. tu esti seful pe logicmap. fa-le".

The two improvements the agent proposed, each from TODO 115's evidence:
- A rename made noise. Renaming a store's identifiers (`ownTags` → `seenTags`, `areOwnTagsRead` → `areSeenTagsRead`)
  changed the code under six rules that had nothing to do with tags, and each one asked for an ack like a change of
  meaning. Acking by the dozen trains the reader to ack without reading. `check` should say "only renamed" and name
  the renames, so one look settles them.
- A gap the map couldn't show. A copy that carries tags reaches its readers through a conversation's line about a
  document, and the shell's tags store didn't read again on that line; the walk found it, not the map. Nothing tied
  the frame to the code that listens to it, so no `show` could list who listens and who doesn't. Every sender and
  every listener of a message should be a site of the message's rule, enforced by `check`, and a plan should ask
  which messages change the data a step holds.

## Decisions
- 2026-11-03, the agent: a code site's lock line holds a second fingerprint, of the code's shape: its tokens with
  each identifier replaced by its order of first appearance (`$1`, `$2`, …), keywords, literals and punctuation
  kept. A site whose code fingerprint changed and whose shape didn't is `renamed`: the identifiers were renamed one
  for one, nothing else. Rejected: recovering the acked code from git on every check (an ack not committed yet has no
  commit; a git call per changed site on every check and every Edit hook).
- 2026-11-03, the agent: `renamed` stays an error, with the renames listed (`ownTags → seenTags`) when the acked code
  can be read back from git (the ack's commit, else HEAD, checked against the locked fingerprint), and `ack
  --renamed` acks every id whose only lock problems are renames. Rejected: acking a rename by itself, or making it a
  warning. A rename can point a call at another thing (`canEditDocument(access)` → `canTagDocument(access)` has the
  same shape), and only a reader of the list can tell; a warning would leave the lock stale and repeat on every check.
- 2026-11-03, the agent: the lock token becomes `v3:<code>.<shape>`. A `v2:` line has no shape: its site reports
  `changed` as before, and the next ack of its domain renews it to `v3:` when its code still matches, as `v2:` once
  renewed the lines from before it. The published checker reads a `v3:` line as changed: a second machine pulls the
  skill first, as with `v2:`.
- 2026-11-03, the agent: an entry's optional `grep:` field is a pattern for the code that sends or reads what the
  rule governs: a message type, a mirrored key. Every line it finds must lie under an anchor of the rule (any role),
  or `check` reports `unanchored-match` there. Comment lines, `logicmap/` and the ignored paths are left out. One `git
  grep -P` reads every entry's pattern at once; JavaScript's RegExp tells which entry a line belongs to, so a pattern
  is written in the syntax both read. Rejected: making each message's rule a `flow` with numbered steps (its readers
  are not steps in an order, and a step list can't say "every reader"); reading every tracked file in JavaScript (git
  grep is one call).
- 2026-11-03, the agent: a planning rule in SKILL.md: a step that holds another process's data (a store, a cache, a
  list read once) names the messages that change that data and `show`s their rules, whose sites are every sender and
  reader; the step's code becomes one more reader.

## Steps
### 1. A rename is told apart from a change
- [x] Red: a site whose identifiers are renamed one for one reports `renamed`; one whose identifier now repeats
  another (`a + b` → `a + a`), whose keyword, literal or punctuation changed, reports `changed`; a `v2:` line reports
  `changed` for a rename, and an ack of another id of its domain renews it to `v3:`.
- [x] Green: `shapeOf` (tokens, identifiers by order of first appearance); the lock token `v3:<code>.<shape>`;
  `isAsLocked` reads the three forms; `checkLock` reports `renamed`.
- [x] Red: the message lists the renames when the acked code is in the ack's commit or in HEAD, and says to run
  `diff` when it isn't.
- [x] Green: the acked lines read back from git, checked by their fingerprint; the identifiers paired by position.
- [x] Red: `ack --renamed` acks the ids whose lock problems are all `renamed`, and leaves an id that also has a
  `changed` site.
- [x] Green: `ackRenamedIds`; the command line's `ack --renamed`.
- [x] Red: a site whose file was renamed with its words reports `renamed`, its renames read from the old file; a
  moved site with a real change stays `gone` and `unacked`.
- [x] Green: a site with no lock line of its own takes an unclaimed line of its id and role whose shape it has.
Files: `scripts/logicmap.ts`, `scripts/logicmap.test.ts`

### 2. `grep:` makes every reader a site
- [x] Red: a line the pattern finds under no anchor of the rule is `unanchored-match`; under a `uses`, a `test` or a
  defining anchor it is fine; a comment line, a line in `logicmap/` or an ignored path is left out; a retired entry's
  pattern reads nothing; a pattern JavaScript can't read, or PCRE refuses, is `invalid-field` and the others are still checked; a line git finds that no pattern matches in JavaScript is the warning `grep-mismatch`.
- [x] Green: the `grep` field; one `git grep -P` for every pattern; each line given to the entries whose pattern
  matches it; the covered lines of each id's anchors.
- [x] Red: git without PCRE: one `grep-unavailable` warning, no error.
- [x] Green: the failed call's message read.
Files: `scripts/logicmap.ts`, `scripts/logicmap.test.ts`

### 3. The docs
- [ ] SKILL.md: `renamed` and `ack --renamed` in "Changing anchored code"; `grep:` in the entry's optional fields,
  in "Adding anchors" (a message type crossing a process) and in what `check` enforces; the planning rule in
  "Working a task in a mapped repo"; the USAGE line; README.
Files: `SKILL.md`, `README.md`, `scripts/logicmap.ts`

### 4. On teamabled
- [ ] Measured on a teamabled worktree: a rename across anchored sites, then a change of meaning; `check`'s output,
  `ack --renamed`, the time of `check` before and after `grep:`.
- [ ] Merged into the installed clone; its tests; the board's row.
- [ ] Teamabled's side is its own task, `explanatory-docs/logicmap/08-renamed-sites-and-frame-readers/`: every
  domain acked once to `v3:`, a `grep:` on the rule of each live frame, every sender and listener anchored.

## Revisions
- 2026-11-03, the agent (the advisor's question whether a moved site survives the v3 token): it does, the moved pass
  compares through `isAsLocked`. But a site whose file was renamed with its words, TODO 115's `own-tags.tsx` →
  `seen-tags.tsx`, reported `unacked`, not `renamed`: the shape was only compared on a site's own key. Step 1 gains two
  sub-steps.
