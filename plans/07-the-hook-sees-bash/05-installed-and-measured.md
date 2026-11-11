# Step 5: Installed and measured

Before: `bun test` 57 pass; the strict `tsc` and `biome check` of the board's step 2 clean.

## Piece 1: the docs
What: SKILL.md "The hook": a Bash command's reads and edits, the compaction, "changed a file" for the Stop check,
the two Bash matchers and `PostCompact` in the settings to install, and why both tool events. README: the hook
answers shell commands as it answers the tools. `hook.ts`'s header lists the two new lines.
Why: the settings block is what a person copies; installed on `PostToolUse` alone, the hook would miss every command
that exits non-zero.
Where: `SKILL.md` "The hook (Claude Code)", `README.md:62-66`, `scripts/hook.ts:19-38`

## Piece 2: measured on teamabled
What: the worktree's hook run by hand in teamabled (765 entries), one input per line:

| Command | Time | Context |
|---|---|---|
| `git status --short` (reads nothing, changes nothing) | 63 ms | none |
| `bun test src/x.test.ts` | 80 ms | none |
| `sed -n 100,140p src/sync/doc-room.ts`, as a failed command | 559 ms | the lines' newest change, 369 characters |
| the same again, piped into `cut` | 387 ms | none (no rule over those lines, the change named already) |
| `cat src/sync/doc-room.ts` | 339 ms | the file's rules, 2,286 characters |

Why: the hook now runs after every Bash command. One that touches no file pays `bun`'s start, one `git rev-parse` and
one `git status`; the analysis (0.3 to 0.5 s) is paid only by a command that read or changed a file, as a Read or
an Edit pays it today.
