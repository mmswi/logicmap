# A shorter SKILL.md

## Goal
Mihai, 2026-11-11, after the token analysis of teamabled's sessions: "toate propunerile care te ajuta pe tine.
inclusiv 6 cu skill mai scurt si gramatica in alte fisiere (cu toate ca nu stiu daca o sa-mi ignore regulile)". Row
21 of the board (gbrain `notes/logicmap-methodology-tasks`).

The evidence: SKILL.md is 29,634 characters, loaded whole by every session and subagent that works in a mapped
repo. Most of a session reads and changes anchored code; the anchor grammar's fine print, the ledger's optional
fields, the task procedure (teamabled's CLAUDE.md gives its own), the hook's install and the repo setup are needed
at one moment each, or never.

His doubt is the constraint: a rule moved out of SKILL.md must not become a rule the agent skips.

## Decisions
All by the agent, under Mihai's "tu esti seful pe logicmap" (2026-11-03).

- 2026-11-11: what stays in SKILL.md is what holds on every read and every edit (reading anchored code, changing
  it, the commands) and every judgment `check` cannot make for the agent: when an anchor earns its place, the
  smallest block that holds the rule, a `test` anchor only when the assertions prove the rule, the claim first in
  `what`, `inferred` against recorded. What moves is format `check` enforces (a malformed anchor, a missing field,
  a wrong role or step is an error with its fix in the message, and the hook prints it after the edit) and
  procedure used at one moment. So a skipped file costs a `check` error, never a wrong map.
- 2026-11-11: the short forms of an anchor and of an entry stay inline, three lines, beside the steps that write
  them: enough to write a valid plain rule without opening the file. Rejected: a pointer alone (his doubt).
- 2026-11-11: each moved file is named in SKILL.md with the moment to read it ("before the first anchor or entry
  you write in a session"), at the step where that moment comes. Rejected: a "see also" list (it names no moment).
- 2026-11-11: the files sit beside SKILL.md, as `mapping-an-existing-repo.md` does. Text moves as written; the
  only rewrites are SKILL.md's own joins and the commands added by tasks 07 and 08.
- 2026-11-11: checked by a fresh agent that reads only what the short skill sends it to, maps a rule in a scratch
  repo and then changes its meaning, until `check` exits 0. What it gets wrong goes back into the skill.

## Steps
### 1. The split
- [x] `anchors-and-entries.md`: "Anchor grammar" and "Ledger entry", as written, and the lock's formats.
- [x] `working-a-task.md`: "Working a task in a mapped repo", as written.
- [x] `the-hook.md`: "The hook (Claude Code)", as written.
- [x] `setting-up-a-repo.md`: "Setting it up in a repo", its AGENTS.md block naming `find` and `bump`.
- [x] SKILL.md: the intro, the commands, reading, changing, adding (with the short forms), what the hook's lines
  mean, and the five files each with its moment.
- [x] README.md and `mapping-an-existing-repo.md` point at the new files.
Files: `SKILL.md`, the four new files, `README.md`, `mapping-an-existing-repo.md`

### 2. A fresh agent works from the short skill
- [x] A scratch repo with one rule to map and one change of meaning; the agent's brief names the skill, not the
  answers.
- [x] Its map checked by hand: `check` exits 0, the anchor's block, the entry's claim and source, the bump's
  history and pins; which files it read.
- [x] What it got wrong, fixed in the skill.

## Revisions
- 2026-11-11, the agent, from the review of tasks 07 and 08 (plans/07 steps 7-12): the hook now answers a deletion,
  leaves out a version any session's hook answered, describes changes before reads while the answer is under 40
  lines, reads heredocs and quotes as text, and keeps what was shown per subagent. `the-hook.md` and the short
  hook section in SKILL.md say so, in step 2's last piece.
