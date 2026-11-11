# The hook sees Bash, and a compaction

## Goal
Mihai, 2026-11-11, after the token analysis of teamabled's sessions: "toate propunerile care te ajuta pe tine. inclusiv
6 cu skill mai scurt si gramatica in alte fisiere (cu toate ca nu stiu daca o sa-mi ignore regulile)". This task is
the first two of the six (rows 16 and 17 of the board, gbrain `notes/logicmap-methodology-tasks`).

The evidence, from teamabled's main sessions since 2026-11-03: the agent read code 2,765 times through Bash
(`sed -n A,Bp <file>`, `cat <file>`) and 80 times through Read; it wrote code 1,159 times through Bash (Python
scripts) and 93 times through Edit or Write. The hook listens to Read, Edit, MultiEdit and Write, so it showed the
rules for about 3% of the reads, inspected about 7% of the writes, and armed the Stop check only for those. And a
session was compacted 347 times in a month: after each one the hook still held every rule as "shown", while the
claim it had printed was gone from the context.

## Decisions
All by the agent, under Mihai's "tu esti seful pe logicmap" (2026-11-03).

- 2026-11-11: the files a Bash command changed are the files git reports as differing from HEAD or untracked, whose
  modification time falls inside the command's run, and which this session has not inspected at that modification
  time. The run is `duration_ms` of the hook input back from now, plus 5 s for the hook's own start; without
  `duration_ms` (an older Claude Code) every such file counts. Rejected: reading the command for what it writes (72%
  of the Bash text is a Python heredoc, and a script writes any file); a state taken by a second hook before each
  command (one more process per command, for the first command of a session only).
- 2026-11-11: the hook answers `PostToolUse` and `PostToolUseFailure` for Bash. Seen in a session: a command that
  exits non-zero fires only `PostToolUseFailure`, and its `additionalContext` reaches the model. A red test run after a
  script's edit, and a `grep` that finds nothing after a `sed`, both exit non-zero.
- 2026-11-11: a Bash read is a `sed -n <first>,<last>p <file>`, a `sed -n <line>p <file>` or a `cat <file>...`
  between the command's separators, its file resolved from the directory the command stands in: the input's `cwd`,
  moved by each `cd <directory>` before it. Of 13,586 Bash reads, 12,261 are the first form. Rejected: `grep -n`
  (a search: it prints the hits, the region is then read with `sed`); a range written with shell variables (917
  reads; the lines are unknown, and the whole file's rules would be the wrong answer).
- 2026-11-11: one analysis of the repo per hook run. `listRuleSectionsInLines` and `inspectEdit` each ran the whole
  check (0.41 s in teamabled); a command reading three files and changing two would run it five times.
- 2026-11-11: `PostCompact` forgets what the session was shown (the rules in full, a file's newest change, the rules
  relied on), never which repos it edited. Seen in a headless session: a compaction fires `PreCompact`, `PostCompact`
  and `SessionStart` with `source: compact`, all with the session's id unchanged. One event is enough; `PostCompact`
  is the one that says the compaction happened.

Known limits, left as they are: a file a command deleted has no modification time and is not inspected (the Stop
check sees it when the command changed any other file); a command that edits and commits in one go leaves no
difference from HEAD to inspect (`check` before a commit stays the protocol); a command left running in the
background is seen when it starts.

## Steps
### 1. One analysis for every file of a hook run
- [x] `createMapReader(repoRoot)` in `logicmap.ts`: the problems, the rule sections of a file's lines, the rules
  relied on over changed lines, whether a file is anchored. It replaces `listRuleSectionsInLines` and `inspectEdit`.
- [x] `hook.ts`: reading and editing each become a function from (reader, file) to the lines of context; the
  existing tests stay green.
Files: `scripts/logicmap.ts`, `scripts/hook.ts`
Seam: `respondToHook`, the six existing hook tests.

### 2. A Bash command's edits are inspected
- [x] Red: after a Bash command, succeeded or failed, that changed an anchored file: that file's errors, and the
  Stop check armed; a file changed before the command ran is not the command's; a file the Edit hook inspected is
  not inspected again; outside a mapped repo, nothing.
- [x] Green: `respondToBash`, the changed files from `git status` and their modification times.
Files: `scripts/hook.ts`, `scripts/logicmap.test.ts`
Seam: `respondToHook` with `tool_name: 'Bash'`, `tool_input.command`, `cwd`, `duration_ms`.

### 3. A Bash command's reads show their rules
- [x] Red: `sed -n 2,5p src/room.ts`, a single line, `cat`, a pipe after it, a `cd` before it; a rule shown once is
  named by id the second time; lines no rule covers, a file that isn't there and a range with a variable say nothing.
- [x] Green: the command's reads, each answered as a Read is.
Files: `scripts/hook.ts`, `scripts/logicmap.test.ts`
Seam: the same.

### 4. After a compaction, the rules are shown in full again
- [x] Red: a rule read, then `PostCompact`, then read again is in full; the Stop check stays armed.
- [x] Green: `PostCompact` removes the session's three shown-once files.
Files: `scripts/hook.ts`, `scripts/logicmap.test.ts`
Seam: `respondToHook` with `hook_event_name: 'PostCompact'`.

### 5. Installed and measured
- [x] SKILL.md "The hook" and README: Bash, the failure event, the compaction; the settings to install.
- [x] `~/.claude/settings.json`: `PostToolUse` and `PostToolUseFailure` for Bash, `PostCompact`.
- [x] Measured in teamabled: the time one Bash hook run adds; a read and an edit through Bash seen in a session.
Files: `SKILL.md`, `README.md`

## Revisions
