# Views sized to the map, a check that shows the change, and bump

## Goal
Mihai, 2026-11-11, after the token analysis of teamabled's sessions: "toate propunerile care te ajuta pe tine". This
task is rows 18, 19 and 20 of the board (gbrain `notes/logicmap-methodology-tasks`).

The evidence, from teamabled (735 active rules in 20 domains) and its main sessions since 2026-11-03:
- `show` prints 46,474 characters and `show documents` 62,249 (274 rules), against SKILL.md's "each a few thousand
  tokens at most"; nothing finds a rule by what it is about, so the agent reads a domain or greps the ledger.
- 48 of 71 acks ran with no `diff` and no `show` in the four calls before them: the rule's claim and the change were
  not in front of the agent when it said the entry still holds.
- a bump is four hand edits (the version, a `history:` line, the definition's pin, then every `stale-pin`), and
  `stale-pin` came up 41 times in `check`.

## Decisions
All by the agent, under Mihai's "tu esti seful pe logicmap" (2026-11-03).

- 2026-11-11: `find <words>` lists the active rules whose id or entry holds every word, case ignored, as
  `show <domain>` prints a rule; a rule whose id holds a word comes before one whose claim does, before one whose
  other fields do. At most 30; the rest are counted. Rejected: a pattern (the agent already has `grep` for that; what
  it lacks is the claim and the status beside the hit).
- 2026-11-11: `show` and `show <domain>` print as today while the view is at most 20,000 characters (about 5,000
  tokens). Over it, `show` leaves the rule ids out and `show <domain>` the claims, and each says so in its first
  lines, with the size it left out and the three ways to the rest: a narrower view, `find`, `--all`. Nothing is
  unreachable: `--all` prints the view as today. Rejected: cutting a view after N rules (the rules past the cut would
  look like they don't exist).
- 2026-11-11: `check` prints, under each `changed` line, the rule's claim and the hunks `diff <id>` prints for that
  site, at most 20 lines of them, for the first 10 changed sites; the rest are pointed at `diff <id>`. The hook's
  answer to an edit stays as it is (it names `show <id>`); `check` is what runs before an ack. Rejected: the same
  under `unacked` (no acked code to compare with) and `renamed` (it lists the words already).
- 2026-11-11: `bump <id> <what changed>` writes the mechanical half of a bump: the entry's `version` + 1, a
  `history:` line `- @N+1: <what changed>`, the pin of the defining anchor of a decision, an invariant or an edge;
  then it lists every other site, which `check` reports as `stale-pin` until each is re-verified. A flow has no single
  definition: none of its pins moves, every step is listed. The `what` and the `why` stay for the agent to rewrite,
  and nothing is acked. Rejected: moving every pin (it would mark sites verified that nobody read).

## Steps
### 1. `find <words>`
- [x] Red: a word in an id, in a claim, in a why; every word must hold; case ignored; a retired entry is not
  listed; over 30, the rest counted; none says so.
- [x] Green: `findInLogicMap`, the `find` command, the usage.
Files: `scripts/logicmap.ts`, `scripts/logicmap.test.ts`
Seam: `findInLogicMap(repoRoot, words)`.

### 2. The widest views bounded
- [x] Red: over 20,000 characters `show` has no rule ids and `show <domain>` no claims, each says what it left out
  and how to get it; `--all` prints them; a small map prints as before.
- [x] Green: `showLogicMap(repoRoot, target, { isInFull })`, `show ... --all`.
Files: `scripts/logicmap.ts`, `scripts/logicmap.test.ts`
Seam: `showLogicMap`.

### 3. `check` shows the claim and the change under a changed site
- [x] Red: under a `changed` problem, the claim and the hunk; nothing under another problem; a long hunk cut at 20
  lines; after 10 sites, none.
- [x] Green: `createChangeDescriber(repoRoot)`, printed by `check`; `diff <id>` shares the site's section.
Files: `scripts/logicmap.ts`, `scripts/logicmap.test.ts`
Seam: `createChangeDescriber(repoRoot)(problem)`.

### 4. `bump <id> <what changed>`
- [x] Red: the entry's version and history, the defining pin moved, the other sites listed and `stale-pin` in
  `check`; an entry with no `history:` gains one; a flow moves no pin; an unknown or retired id is refused.
- [x] Green: `bumpId`, the `bump` command.
Files: `scripts/logicmap.ts`, `scripts/logicmap.test.ts`
Seam: `bumpId(repoRoot, id, whatChanged)`.

### 5. Documented and measured
- [x] SKILL.md (the commands, "Changing anchored code") and README: `find`, `--all`, what `check` prints, `bump`.
- [x] Measured on teamabled: the sizes of `show`, `show documents`, a `find`; `check` and `bump` on a scratch copy.
Files: `SKILL.md`, `README.md`

### 6. `check` in a repo with no commit
- [x] Red: a site changed before the repo's first commit: `check` lists its `changed` error, with the claim and
  no hunk.
- [x] Green: the site's diff through `runGitOrEmpty`.
Files: `scripts/logicmap.ts`, `scripts/logicmap.test.ts`
Seam: `checkRepoWithChanges(repoRoot)`.

### 7. `bump` writes one history line, into its own entry
- [x] Red: a reason holding a newline is written on one line, and the version stays N+1; an empty reason is
  refused and nothing is written.
- [x] Green: the reason's whitespace collapsed; an empty one refused.
Files: `scripts/logicmap.ts`, `scripts/logicmap.test.ts`
Seam: `bumpId(repoRoot, id, whatChanged)`.

### 8. A site bumped since its ack says so
- [x] Red: right after `bump`, the entry's and the definition's `changed` errors say the rule was bumped and
  what is left (re-verify the `stale-pin` sites, ack), not "bump its version".
- [x] Green: a site whose version is past its lock line's gets that message.
Files: `scripts/logicmap.ts`, `scripts/logicmap.test.ts`
Seam: `checkRepo(repoRoot)` after `bumpId`.

### 9. `find` with no word
- [x] Red: `findInLogicMap(repoRoot, [])` asks for a word.
- [x] Green: `findRules` with no word says so.
Files: `scripts/logicmap.ts`, `scripts/logicmap.test.ts`
Seam: `findInLogicMap`.

## Revisions
- 2026-11-11, the review of 674a341..b1bb974 (mihai-code-review, each finding reproduced):
  - CRITICAL, blast-radius and data, a third reviewer failed to refute it: `check` crashed in a repo with no
    commit, where it listed the problems before step 3 (`git diff HEAD` through `runGit`). Step 6 added.
  - data: a `bump` reason holding a newline wrote fields into the entry (`version: 9` overrode the bump); an
    empty reason wrote `- @2: `. Step 7 added. Left (timing): a check that the entry's heading is still at its line
    before the write (the ledger edited between the analysis and the write, a window of the analysis's 0.4 s, which
    no test can stop at; a wrong write shows in `check` and `git diff`), and writing the ledger after the pins
    (either order leaves a state `check` reports and a rerun repairs).
  - The trial of the shorter skill: right after `bump`, `check` said "bump its version" for the rule just
    bumped. Step 8 added.
  - data, a suggestion: `find ""` listed the first 30 rules. Step 9 added.
