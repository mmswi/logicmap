# Rejected alternatives in why; an edit under a rule it relies on

## Goal
Mihai, 2026-11-02: "da, incepe cu why. scopul e sa te ajute pe tine sa scrii cod bine, sa nu pierzi context dar sa
si poti face debugging usor. altfel nu as avea incredere in tine sa te las sa codezi aplicatia fara sa poti naviga cu
usurinta codul si regulile". Before it: "inca ceva. cum era mai sigur codul, cu mai mult zgomot sau cum e acum?"

Two gaps the work on `why` left, each measured:
- `why`'s acceptance (`plans/03-why/acceptance.md`): the agent without `why` named more rejected alternatives on
  questions 1 and 3, read from the entries' `rejected:`. `why` prints a rule's claim and `why:` only. The rejected
  alternative is what an agent writing code brings back.
- Since `plans/02-less-noise` (a), `uses` and `test` sites are out of the lock: `check` says nothing when code under
  one changes. In teamabled they are 3,641 of 4,366 anchors (1,631 `uses`, 2,010 `test`). Before, TODO 108's check
  reported 8 such sites among its 10 errors, each asking an ack; now an edit that breaks what a `uses` site relies
  on, or weakens a `§test`, goes unsaid.

## Decisions
- 2026-11-02, the agent: the second gap is told as information after the edit, once per rule and session, not as a
  `check` error. Rejected: fingerprinting `uses`/`test` sites again (the noise `02-less-noise` removed: an ack per
  edited caller, whether or not the rule moved).
- 2026-11-02, the agent: the edited lines are the file's `git diff -U0 HEAD` hunks, not the tool's `old_string`/
  `new_string`. Rejected: the tool input, which Write doesn't have (it rewrites the whole file) and MultiEdit spreads
  over a list.

## Steps
### 1. `why` prints each rule's `rejected:`
- [x] Red: `why <file>:<line>` and `why <id>` print `  rejected: …` under `  why:` for an entry that has one, and no
  such line for one that hasn't.
- [x] Green: `LedgerEntry.rejected`; `listRulesWithTheirWhy` and `explainRule` print it.
Files: `scripts/logicmap.ts`, `scripts/logicmap.test.ts`

### 2. An edit under a `uses` or `test` site names its rule
- [x] Red: an edit inside a `§uses` site's lines gets one note naming the rule (its claim) and the site; inside a
  `§test` site, the note says the test must still fail when the rule breaks; an edit under no site, or only under a
  defining site (`check` reports that one), gets none; the same rule edited again in the session isn't named again;
  a file git doesn't hold gets none.
- [x] Green, `logicmap.ts`: the rule sections of a file's referring sites that meet some line ranges, built by the
  same code as `show <file>`'s.
- [x] Green, `hook.ts`: the changed lines from `git diff -U0 HEAD -- <file>`; `respondToEdit` adds the note after the
  file's errors, once per file, rule version and session, and not for a rule the errors already name; a failing
  git call costs the note only.
Files: `scripts/logicmap.ts`, `scripts/hook.ts`, `scripts/logicmap.test.ts`

### 3. The docs
- [ ] SKILL.md: `why`'s rejected line; the hook's Edit bullet; "Changing anchored code" says a `uses` or `test`
  site's code is checked by reading its rule, which the hook names.
- [ ] README's hook line; `hook.ts`'s header comment.
Files: `SKILL.md`, `README.md`, `scripts/hook.ts`

### 4. Measure on teamabled
- [ ] On a detached worktree of teamabled in the scratchpad: one edit under a `§uses` site, one under a `§test` site,
  one under nothing; the hook's output and time each.
- [ ] Results here; merge into the installed clone; its tests; the board's rows #14 and #12's safety gap.

## Results

## Revisions
