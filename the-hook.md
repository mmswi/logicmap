# The hook (Claude Code)

`scripts/hook.ts` puts the map in front of the agent without being asked, in every repo with a
`logicmap/` folder (anywhere else it prints nothing):

- after a `Read`, the rules covering the lines read, with their claims and covered lines: in full the
  first time a session reads a rule at its version, then named by id in one line. The first time a
  session reads a committed code file, one more line: the newest commit of the lines read, the piece
  recorded with it, and the `why` command for them. A subagent is a session of its own here: it is
  shown in full what its parent saw;
- after an `Edit`, `MultiEdit` or `Write`, the errors `check` reports in that file, each saying how to
  resolve it, and the rules whose `uses` or `test` sites cover the lines changed since HEAD, once per file
  and session;
- after a Bash command, whether it succeeded or failed, both of the above. Each `sed -n <first>,<last>p
  <file>` (`$` for the last line) or `cat <file>` in it is answered as a `Read` of those lines, from the
  directory the command stands in (its `cd`s followed); text in a heredoc or in quotes runs nothing and
  reads nothing. Each file it changed or deleted, written during its run and differing from HEAD, is
  answered as an edit, unless a hook, of this session or another, already answered that version of it.
  The files it changed come first, then the ones it read, each described while the answer is under 40
  lines; the rest are named in a last line. Reading with `sed` and writing with a script keep the map in
  front of the agent as `Read` and `Edit` do; a `grep`, or a range written with shell variables, is not
  a read;
- after a compaction, what the session was shown once (a rule in full, a file's newest change, a rule relied
  on) is shown again;
- at `Stop`, `check`'s errors, once, for a session that changed a file in the repo since its last stop:
  the agent resolves them, or tells the user why they stay. A session that only read is not asked, so one
  session's work in progress does not stop the others.

Install it once, in `~/.claude/settings.json` (merge into the `hooks` already there):

```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "Read", "hooks": [{ "type": "command", "command": "bun ~/.claude/skills/logicmap/scripts/hook.ts", "timeout": 30 }] },
      { "matcher": "Edit|MultiEdit|Write", "hooks": [{ "type": "command", "command": "bun ~/.claude/skills/logicmap/scripts/hook.ts", "timeout": 30 }] },
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "bun ~/.claude/skills/logicmap/scripts/hook.ts", "timeout": 30 }] }
    ],
    "PostToolUseFailure": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "bun ~/.claude/skills/logicmap/scripts/hook.ts", "timeout": 30 }] }
    ],
    "PostCompact": [
      { "hooks": [{ "type": "command", "command": "bun ~/.claude/skills/logicmap/scripts/hook.ts", "timeout": 30 }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "bun ~/.claude/skills/logicmap/scripts/hook.ts", "timeout": 30 }] }
    ]
  }
}
```

A Bash command that exits non-zero fires `PostToolUseFailure` only, which is why the hook is installed on both.
A command that reads and changes nothing costs one `git status`; the repo is analysed only when a file was read or
changed.

What a Bash command changed is read from the files' times, so some changes are not its own and some are not seen:
a file your editor, or another session's command, writes while it runs is answered as its change; an edit
committed by the same command, a file copied with its old time (`cp -p`) and the work of a command left running
in the background are not answered. `check` before a commit sees them all.

The hook adds to what the protocol asks; it does not replace it. Run `show <id>` before relying on a rule
the hook names, and `check` before a commit.
