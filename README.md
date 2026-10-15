# logicmap

A map of the why, for coding agents.

Code says what it does. It does not say which other file relies on it, which alternative was already
rejected, or why a line that looks redundant is there. A logicmap records that, next to the code:

- **anchors**: one-line comments, `§<role> <id>@<version>`, at every site that defines or relies on a
  rule;
- **ledger**: `logicmap/<domain>.md`, one entry per rule: what holds, why, what was rejected, what
  breaks, and where the claim comes from;
- **lock**: `logicmap/<domain>.lock`, a fingerprint of the code under every anchor, so the checker
  knows when code changed under a rule nobody re-read.

`SKILL.md` is the full method. `mapping-an-existing-repo.md` is the procedure for a codebase where
nobody wrote the reasons down.

## Install

Requires `git` and [bun](https://bun.sh).

Claude Code:

```
git clone https://github.com/mmswi/logicmap ~/.claude/skills/logicmap
```

Agents that read skills from `~/.agents/skills/` (Codex):

```
git clone https://github.com/mmswi/logicmap ~/.agents/skills/logicmap
```

An agent without skills can still read a repo's map: the anchors, the ledger and the section the
method adds to `AGENTS.md` / `CLAUDE.md` are plain text.

## Use

Run from anywhere inside a repo:

```
bun ~/.claude/skills/logicmap/scripts/logicmap.ts show               every rule, one line each
bun ~/.claude/skills/logicmap/scripts/logicmap.ts show <file|id>     a file's anchors, or one rule and all its sites
bun ~/.claude/skills/logicmap/scripts/logicmap.ts check              every disagreement; exits 1 on any error
bun ~/.claude/skills/logicmap/scripts/logicmap.ts ack <id>...        record that you re-read these rules against their code
```

To set it up in a repo, follow "Setting it up in a repo" in `SKILL.md`.

## Tests

```
bun test
```

## License

MIT
