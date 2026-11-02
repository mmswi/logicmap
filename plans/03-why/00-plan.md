# Why: one command from a line to the reason it was written

## Goal

Mihai, 2026-11-02: "ma intereseaza sa fie un skill care sa te ajute pe tine. tu ai facut skill-ul ala, dar e menit
sa si poti stii oricand, foarte usor, de ce codul e intr-un anumit fel, de ce s-a schimbat, sa poti urmarii
schimbarile si logica". Then: "da, incepe cu why. scopul e sa te ajute pe tine sa scrii cod bine, sa nu pierzi
context dar sa si poti face debugging usor. altfel nu as avea incredere in tine sa te las sa codezi aplicatia fara sa
poti naviga cu usurinta codul si regulile" (gbrain `decisions/logicmap-serves-the-agent`).

The reasons exist: a repo that works as SKILL.md's "Working a task in a mapped repo" says commits each `## Piece N`
(older docs: `## Bucata N`) with its code. Following one by hand takes `git log -L`, then the commit's files, then the
step doc, then the piece that names the code: four to six calls, so an agent rarely does it and guesses from the code.
`logicmap why <file>:<line>` follows it in one call; `logicmap why <id>` gives a rule's history the same way.

Measured on teamabled, 2026-11-02 (`e3405812`):

1. 30 code lines, two per file across 15 files and every era: the newest commit of the line reaches the piece that
   holds its code for 20, a piece whose `Where:` names the file for 5, and only its subject for 5 (4 lines written in
   June, before pieces; 1 from a task whose docs hold no piece for that file). Matched on the lines the commit added in
   the hunk around the line, at least 12 characters, trimmed.
2. `git log -L` traces HEAD's line numbers: with three lines added above `merge-direct-groups.ts:459`, the same command
   traced HEAD's lines 459-460, not the working tree's. An agent runs `why` mid-task, with uncommitted edits.
3. `git log -L :finishMergesAfterCommit:<file>` gives the function's range (444 to the line before the next function).
4. `git log -L` costs 0.01 to 0.06 s on the files with the most history (`DocumentEditorPage.tsx`, 178 commits).
5. Pieces write `What:` and `Why:` either with their text on the same line or on the lines below; a "green" piece
   (the code that passes a test) often leaves `Why:` empty, its reason in the "red" piece before it
   (`intuitive-review/12-…/03-someone-elses-unfreeze.md` Pieces 5 and 6).

## Decisions

- 2026-11-02, agent: the lines asked about are the working tree's. `why` maps them to HEAD's through the hunks of
  `git diff -U0 HEAD -- <file>`; a line added since HEAD, or a file git doesn't track, reads "not committed yet".
  Rejected: passing the typed numbers to `git log -L` (measure 2: a confident answer about other lines).
- 2026-11-02, agent: a commit's reason is, in this order, (a) the piece whose text holds the most of the lines the
  commit added in the hunk around the asked line (trimmed, 12 characters or more, so `}` and `)` never match), (b) a
  piece whose `Where:` names the file (its path, or the path past its first segment), (c) the goal of the task whose
  docs the commit holds (`## Goal` of the `00-plan.md` beside them), (d) the commit's subject alone. A piece is a
  `## Piece N` or `## Bucata N` section in any `.md` the commit holds outside `logicmap/`. Among the pieces holding
  the code, one whose Where names the file comes first; among those naming the file, the one whose Where lines are
  nearest the traced lines as the commit numbers them (revision 1). Rejected: matching `Where:`'s line numbers
  against HEAD's (they shift with every later edit); a setting naming the docs folder (each repo puts them
  elsewhere; the headings already mark them).
- 2026-11-02, agent: per commit, newest first, 10 at most and the rest counted: its date, hash and subject, the doc's
  path, the piece's heading, its `What:` and `Why:` (the text up to the next field or code fence, on the same line or
  below), the previous piece's `Why:` when this one's is under 40 characters, and the goal's first paragraph cut at
  400 characters. Above the commits, the rules covering the lines with their claim and `why:`.
- 2026-11-02, agent: `why` only reads; it writes no lock and no session file, so it can never turn `check` red.
- 2026-11-02, agent: targets `<file>:<line>`, `<file>:<start>-<end>`, `<file>:<name>` (the top-level declaration's
  lines in the working tree, revision 2) and `<id>`.

## Steps

### 1. From lines to their commits
- [x] A fixture helper that commits the fixture repo (lifted from the diff test's `commitAll`).
- [x] Failing test: a line changed by two commits lists both, newest first, each with its date, hash and subject; a
  line added since HEAD and a line of an untracked file read "not committed yet"; with lines added above it, the
  typed line is traced, not HEAD's line of that number.
- [x] `whyLogicMap(repoRoot, target)`: the working tree's lines mapped to HEAD's, one `git log -L` call parsed per
  commit, 10 at most.
Files: `scripts/logicmap.ts`, `scripts/logicmap.test.ts`

### 2. From a commit to its piece
- [x] Failing tests: the piece holding the commit's code is shown with its What and Why; with no such piece, one whose
  Where names the file; with neither, the task's goal; with no doc, the subject alone; a `## Bucata N` piece too; a
  green piece's empty Why followed by the red piece's.
- [x] The match, the fallbacks and the printing of decision 3.
- [x] Failing test (revision 1): of a mapping doc and a step doc both quoting the code, the piece naming the file;
  of pieces naming the file, the one whose Where lines are nearest.
- [x] The ranking.
- [x] A piece headed green brings the red piece's reason (question 7: its own Why was long, the recorded reason
  was the red piece's).
Files: `scripts/logicmap.ts`, `scripts/logicmap.test.ts`

### 3. The rules over the lines
- [x] Failing test: an anchored line's `why` starts with its rule's claim and `why:`.
- [x] `LedgerEntry` gains the parsed `why`; `why` prints the rules covering the lines above the commits.
Files: `scripts/logicmap.ts`, `scripts/logicmap.test.ts`

### 4. A function as the target
- [x] Failing test: `<file>:<function>` lists the commits of the function's lines.
- [x] The target parsed; the declaration's lines found in the working tree (revision 2).
Files: `scripts/logicmap.ts`, `scripts/logicmap.test.ts`

### 5. A rule's history
- [x] Failing test: `why <id>` lists the commits that changed its entry, newest first, each with the pieces that name
  the id, beside the entry's `history:` lines.
- [x] `-L` over the entry's lines in its ledger file.
- [x] Failing test (revision 3): a commit that only added or removed blank lines among the lines is left out, counted.
- [x] The filter.
Files: `scripts/logicmap.ts`, `scripts/logicmap.test.ts`

### 6. The Read hook names `why`
- [x] Measure on teamabled what one line would cost per read (the newest commit's task for the lines read).
- [x] Failing test, then the line: once per file per session, after the rules, either that task or only the hint
  `logicmap why <file>:<lines>`, whichever the measure allows (the newest change and its piece: +0.05–0.1 s).
- [x] Failing test (revision 4): a merge whose two sides changed the lines is not listed; its sides' commits are.
- [x] `--no-merges` on every `git log -L`.
Files: `scripts/hook.ts`, `scripts/logicmap.test.ts`

### 7. The docs
- [ ] `USAGE`; SKILL.md: the command list, "Reading anchored code" (no anchor → `why`), "Why a line was written" made
  `why` (a squash merge keeps one commit and its docs; teamabled merges keep each commit), the AGENTS.md snippet;
  README.
- [ ] Teamabled's `CLAUDE.md` and `AGENTS.md` name `why` (a teamabled commit of its own).
Files: `scripts/logicmap.ts`, `SKILL.md`, `README.md`

### 8. Acceptance
- [ ] `acceptance-questions.md` (written before step 1): two fresh agents, one with the skill as it was and one with
  `why`, answer the ten; per question, whether the answer reached the recorded reason and how many calls it took.
- [ ] The results in this plan; a finding that changes a step goes in Revisions first.
Files: `plans/03-why/acceptance.md`

Each step closes with `bun test`, strict `tsc` and `biome check` (the commands in `notes/logicmap-methodology-tasks`),
then a commit on `why`; the installed clone gets `main` by `merge --ff-only` once step 8 passes.

## Results

## Revisions

1. 2026-11-02, step 2, found by the agent on teamabled: `why web/src/pages/DocumentEditorPage.tsx:958-966` showed
   for 7 of its 10 commits the first piece naming the file, though each task's doc has several, and for the squash
   `9636d652` a piece of the mapping doc (`logicmap/02-map-the-codebase/05-…`) that quotes the code with its anchors
   and names no file in a Where. Decision 2 ranks them: a piece holding the code and naming the file first, then by
   the nearest Where lines as of the commit, which the commit itself numbered (a Where line number only drifts
   against later commits, the reason it was rejected). Step 2 gains a test and the ranking.
2. 2026-11-02, step 4, found by the agent writing its test: `git log -L :<name>:<file>` takes HEAD's range, so an
   edit above the function makes the rules and the uncommitted note read other lines, and its range runs to the next
   top-level line, taking the next declaration's comment and anchors. Decision 5 finds the declaration in the working
   tree and drops the blank and comment lines at its end; the lines then go through the same mapping as typed lines.
3. 2026-11-02, step 5, found by the agent on teamabled: `why documents.objection-holds-the-round` listed `8c48378f`,
   two days older than the rule, because the entry holds a blank line that `git log -L` traced to a blank line that
   commit added elsewhere. A commit whose change among the traced lines is only blank lines explains nothing; step 5
   leaves such commits out of the list, for lines and rules alike, and counts them on the first line.
4. 2026-11-02, step 6, found by the agent on teamabled: a whole-file Read of `DocumentEditorPage.tsx` named
   `29af14ce`, "Merge branch 'feat/e2e-approvals' into feat/backend-review-rest". `git log -L` lists a merge whose
   two sides both changed the range (probed: a line changed on each side of a merge lists the merge first), and a
   merge's subject names branches, not a reason; its sides' commits are listed on their own. Step 6 adds
   `--no-merges` to the `-L` call, for `why` and the hook alike.
