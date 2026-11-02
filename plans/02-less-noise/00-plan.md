# Less noise: an ack only where a rule's code changed

## Goal

Mihai, 2026-11-02: "hai sa facem fix-ul pe logicmap [...] ai zis ca este mult zgomot - acum ca nu avem niciun
branch deschis, ar trebui sa il reparam". The list he means is the agent's of 2026-10-31 (session
`762aa12c`), six ideas from the one that cuts the most noise to the one that cuts the least, with their
places in the code checked the same day and the order 3, 1, 2, then 4, 5, 6.

Measured on teamabled, 2026-11-02:

1. The lock holds 5,010 lines; 2,001 are `test` sites and 1,631 `uses` sites (72%). A `uses` or `test`
   anchor claims only that its site relies on a rule, and its version pin already says when the rule
   changed (`stale-pin`), yet any edit under it asks for an ack. In the last check of teamabled's TODO 108,
   8 of its 10 errors were `uses` and `test` sites under edited code.
2. A comment line inside an anchored block is hashed, so rewording a comment asks for an ack. A rule moved
   to another file (a rename, a split) is `unacked` there and `gone` here, though its code is the same.
3. 181 of the 725 defining sites cover more than 30 lines, 73 more than 60, 30 more than 100
   (`approvals.ts:933-1108`, 176 lines): any edit in the block asks to re-read a rule it may not touch.
4. Re-reading a changed site means finding by hand what changed since its last ack.
5. `check` always prints the same 27 warnings (21 `untested`, 6 `long-what`), so a new one goes unseen.
6. The Read hook prints the rules covering the lines read on every read, the same ones again and again.

## Decisions

- 2026-11-02, agent (recommended option): `uses` and `test` sites leave the lock. Their pin is all they
  claim, and `stale-pin` checks it; the lock fingerprints the defining anchors and the entries. Their
  covered lines are still computed, for `show` and the hook. Lock lines of theirs already written are
  dropped on read and leave a domain's lock file at its next ack. Rejected: keeping them with a smaller
  span (still an ack per edit, for a claim the pin already carries).
- 2026-11-02, agent: the code fingerprint leaves out comment lines: `//` lines, `/* ... */` blocks across
  lines, `# ` and `-- ` lines, HTML comments. A comment at the end of a code line stays in (a `//` can sit
  inside a string), and so do `#private` and `--count` lines. An entry's fingerprint is unchanged
  (markdown lines start with `#`, `-`, `*`). Lock lines written from now on carry `v2:` before the hash; a
  line without it is compared with the fingerprint of before, so nothing turns `changed` when the skill
  updates. An ack rewrites the kept lines of its domain's lock file whose old fingerprint still matches
  the code with the new one, so the old one dies out without anything being acked unread. Rejected:
  re-acking every repo once (it would bury real `changed` lines, such as another session's work); one
  version for a whole lock file (an ack of one id would have to re-verify every line).
- 2026-11-02, agent: an `unacked` site and a `gone` lock line of the same id and role with the same
  fingerprint are one site that moved, to another file or by renumbering; neither is reported.
- 2026-11-02, agent: no warning for a long block: at 30, 60 or 100 lines it would add 181, 73 or 30
  warnings to every check, the noise this plan removes. The `changed` or `unacked` message of a defining
  site over 60 lines says how many lines it covers and to anchor the smaller block, when the agent is
  already re-reading it. Narrowing teamabled's long anchors is teamabled's work.
- 2026-11-02, agent: an entry may say why no test proves it, in an `untested:` field; such an entry
  raises no `untested` warning. Rejected: a list of exceptions apart from the ledger (a second file to
  keep in step with the entries).
- 2026-11-02, agent: the Read hook shows each rule in full once per session; a rule shown before (same id
  and version) is listed by id in one line, so after a compaction the agent still sees which rules cover
  what it reads. Rejected: showing it once and never again (lost at the first compaction).
- 2026-11-02, agent: `logicmap diff <id>` prints what changed under each changed site since its last ack:
  the git diff of the site's file from the commit that wrote its lock line, the hunks that meet the
  site's lines; when that line isn't committed yet, from HEAD, saying so.

## Steps

### 1. `uses` and `test` sites leave the lock
- [x] Failing test: a new `§uses` anchor and an edit under one are no lock problem; an old lock line of a
  `uses` site isn't `gone`; a `uses` anchor whose rule was bumped is still `stale-pin`.
- [x] `LockSite.isInLock` (defining anchors and entries); `checkLock` and `ackIds` read only those;
  `readLock` drops the keys of `uses` and `test` sites; the covered ranges stay for every anchor.
- [x] The test that expected `unacked` for an added `§uses` (`logicmap.test.ts:389`) expects nothing.
Files: `scripts/logicmap.ts`, `scripts/logicmap.test.ts`

### 2. The code fingerprint leaves out comments
- [x] Failing test: after an ack, rewording a `//` line or a line of a `/* */` block inside the anchored
  block is no change; editing a `#private` or `--count` line is; a lock line written before (no `v2:`)
  still matches the code it was taken from; an ack writes `v2:`; an ack rewrites another kept line of its
  domain whose old fingerprint matches with `v2:`, and leaves one that doesn't match as it was.
- [x] `fingerprintCode` (comments out) beside the text fingerprint; `v2:` on what an ack writes; the
  comparison by the line's form; the upgrade of matching kept lines.
Files: `scripts/logicmap.ts`, `scripts/logicmap.test.ts`

### 3. A site that moved is not reported
- [x] Failing test: a file renamed with its anchors is no lock problem; renamed and edited, it is
  `unacked` and its old line `gone`; a flow anchor renumbered by one added above it is no problem.
- [x] `checkLock` lets each site claim the line of its id and role that holds its code.
Files: `scripts/logicmap.ts`, `scripts/logicmap.test.ts`

### 4. A long block says so when it asks for an ack
- [x] Failing test: the `changed` message of a site over 60 lines names its line count; a short one's
  doesn't.
- [x] The hint in `checkLock`'s `changed` and `unacked` messages for defining sites.
Files: `scripts/logicmap.ts`, `scripts/logicmap.test.ts`

### 5. `untested:` names why no test proves an entry
- [x] Failing test: an edge with `untested: <reason>` raises no warning; one without still does.
- [x] The field in `ENTRY_FIELD_NAMES`; `checkEntryAgainstAnchors` reads it.
Files: `scripts/logicmap.ts`, `scripts/logicmap.test.ts`

### 6. The hook shows a rule once per session
- [x] Failing test: a second read in the same session lists a rule shown before by id in one line; a
  rule bumped since is shown in full; another session sees it in full.
- [x] The rules shown per session in the hook's per-session directory; the views split per rule.
Files: `scripts/hook.ts`, `scripts/logicmap.ts`, `scripts/logicmap.test.ts`

### 7. `logicmap diff <id>`
- [ ] Failing test: after a committed ack and an edit, `diff` prints the hunk under the changed site, not
  a hunk elsewhere in the file; with the ack uncommitted it diffs from HEAD and says so.
- [ ] The command; parked on the board instead if it runs past about 60 lines.
Files: `scripts/logicmap.ts`, `scripts/logicmap.test.ts`

### 8. The docs and the install
- [ ] SKILL.md: the lock section (what it fingerprints, `v2:`, moves), `untested:` in the entry format,
  the hook, `diff`; README's commands.
- [ ] Strict tsc and biome with teamabled's configs, `bun test`; on teamabled the worktree's `check`
  prints what the live one does, less the noise.
- [ ] `--ff-only` into `~/.claude/skills/logicmap`; the board `notes/logicmap-methodology-tasks`.

Teamabled's side (its lock files compacted, the 27 warnings, the long anchors) is the task
`explanatory-docs/logicmap/06-less-noise-in-teamabled/` in teamabled.

## Results

## Revisions

- 2026-11-02, step 3, agent: a site claims any unclaimed line of its id and role that holds its code, not
  only a `gone` one: a new anchor of the same id above others renumbers them, and their lines are not
  `gone`, only under other numbers (found writing the test).
