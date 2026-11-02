# Step 8: the docs

## Piece 1: SKILL.md and README
What: SKILL.md's lock part says the lock holds the defining anchors and the entries, not `uses` and
`test` sites; the commands list `diff <id>`; "Changing anchored code" points `changed` and `unacked` at
`diff <id>`, says what the long-block hint asks, and that moved code as acked is no problem; the anchor
grammar says comment-only lines are left out of the fingerprint and what `v2:` means; `check`'s list
names `untested:`; the entry format lists `untested`; the hook shows a rule in full once per session and
version; the snippet for a repo's agent instructions names `diff <id>`. README: the lock line and the
`diff` command.
Why: an agent with the skill reads SKILL.md, not the code; each change of steps 1–7 changes what it is
told to do with a `check` line.
Where: `SKILL.md`, `README.md`
Run: 32 pass; strict tsc and biome clean; on teamabled the worktree's `check` exits 0 with errors 0,
warnings 27, the same lines as the live checker's but the `untested` warning's new words.
