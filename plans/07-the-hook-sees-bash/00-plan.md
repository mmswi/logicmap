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

Known limits, left as they are: a command that edits and commits in one go leaves no difference from HEAD to
inspect (`check` before a commit stays the protocol); a command left running in the background is seen when it
starts; a file copied with its old modification time (`cp -p`) is not seen; a file the user's editor, or another
session's command, writes while the command runs is answered as the command's, unless a hook answered it first.

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

### 6. A `cat` that writes a file is no read of it
- [x] Red: `cat > <file> <<'CODE'` and `cat <<'CODE' > <file>` say nothing; a read followed by `2>/dev/null` is
  still a read.
- [x] Green: a redirect of the errors is dropped from a segment's arguments; a `cat` with `<` or `>` among them
  is no read.
Files: `scripts/hook.ts`, `scripts/logicmap.test.ts`
Seam: `respondToHook` with `tool_name: 'Bash'`.

### 7. An edit another session answered is not this command's
- [x] Red: session B's Edit hook answered `src/room.ts`; session A then runs `git log`: nothing, and A's Stop
  asks nothing.
- [x] Green: the answered edits are one file for every session, `repoRoot file modifiedAtMs` per line.
Files: `scripts/hook.ts`, `scripts/logicmap.test.ts`
Seam: `respondToHook`, two session ids.

### 8. A deleted file is a change
- [x] Red: `rm src/room.ts` in a command: its `gone` error, and the Stop check armed.
- [x] Green: a file git lists and the disk lacks takes the time of its nearest directory still there, which its
  removal wrote.
Files: `scripts/hook.ts`, `scripts/logicmap.test.ts`
Seam: `respondToHook` with `tool_name: 'Bash'`.

### 9. The answer holds what it records
- [x] Red: a command reading a file with 25 rules and changing another: the change's errors come first, the read's
  rules follow while the answer is under 40 lines, the rest is named as not looked at; a Read of the file after it
  shows the rules left out in full.
- [x] Green: the changes, then the reads, each described only while the answer is under 40 lines, so only what is
  printed is recorded as shown; the Stop check armed before any is described; a change recorded as answered after
  its description; `git status` given a 64 MiB buffer.
Files: `scripts/hook.ts`, `scripts/logicmap.test.ts`
Seam: `respondToHook` with `tool_name: 'Bash'`, then `tool_name: 'Read'`.

### 10. The command read as the shell reads it
- [x] Red: a `cat <file>` inside a heredoc's body or a quoted commit message is no read; a `cd` in a heredoc moves
  nothing; `cat -n <file>` and `sed -n '2,$p' <file>` are reads; the input's `cwd` is where the command ended, so
  `cd src && sed -n 1,3p room.ts` with `cwd` at `src` is a read of `src/room.ts`.
- [x] Green: heredoc bodies dropped before the command is cut; quoted text never cuts it; `cat` takes flags; `$`
  as sed's last line; a read's file looked for from where the command stood, then from the input's `cwd`.
Files: `scripts/hook.ts`, `scripts/logicmap.test.ts`
Seam: `respondToHook` with `tool_name: 'Bash'`.

### 11. A subagent is shown its rules
- [x] Red: the session read a rule; a subagent of it (same `session_id`, an `agent_id`) reading the same lines is
  shown the rule in full, then by id.
- [x] Green: what was shown once is kept per conversation: the session id, plus the agent id inside a subagent.
  The edited repos stay per session.
Files: `scripts/hook.ts`, `scripts/logicmap.test.ts`
Seam: `respondToHook` with `agent_id`.

### 12. The edit's lead-in fits its errors
- [x] Red: an edit leaving an `undocumented` anchor is not told to ack or bump.
- [x] Green: the lead-in says each error names its fix.
Files: `scripts/hook.ts`, `scripts/logicmap.test.ts`
Seam: `respondToHook` with `tool_name: 'Edit'`.

## Revisions
- 2026-11-11, the agent (seen in the session that wrote the hook, building a scratch repo with
  `cat > src/session.ts <<'CODE'`): the hook answered each written file as a read of it, with its rules and its
  newest change. Decision 3 counted a heredoc's lines as the cost of the naive cut and missed that the `cat` holding
  the heredoc names a real file. Step 6 added.
- 2026-11-11, the review of 674a341..b1bb974 (mihai-code-review: timing, data and blast-radius reviewers, each
  finding reproduced):
  - The 40-line cap cut lines after `describeRead` and `describeEdit` had recorded them as shown, so a rule cut from
    a `cat` was later named as "shown earlier" (all three reviewers). Step 9 added.
  - Any file written during the run was the command's: session A's `git log` was answered with session B's
    error and A's Stop blocked on it (all three). Decision 1 keeps the window; step 7 skips what any session's
    hook answered. The user's editor and another session's concurrent command stay a known limit.
  - `rm` left `gone` errors with no answer and no Stop (timing, data). Step 8 added; the known limit is removed.
  - A failure in the analysis left the Stop check unarmed, and an edit recorded as answered before its answer
    (timing); `git status` past 1 MiB of output answered nothing (data). Both into step 9.
  - Heredoc bodies and quoted text were cut into commands (data); `cat -n` was no read (the trial of the
    shorter skill). Step 10 added.
  - Seen in this session: the input's `cwd` is where the command ended, so `cd src/sync && sed -n 302,303p
    ws-routes.ts` was missed (a command writing a file after the same `cd` was answered, so the hook runs).
    Decision 3 assumed the session's directory before the command. Into step 10.
  - A subagent shares its session's id, so it was told "shown earlier" for rules only its parent saw (the
    trial). Step 11 added.
  - An `undocumented` error came under a lead-in telling to ack or bump (the trial). Step 12 added.
  - Left as they are: a `sed -n` read before the same command edits that file describes the lines after the
    edit (timing; the read and the edit then disagree only by the lines the edit moved); a command in the
    background and a commit inside the command stay known limits.
