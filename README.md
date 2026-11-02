# logicmap

A map of the why, for coding agents.

Code says what it does. It does not say which other file relies on it, which alternative was already
rejected, or why a line that looks redundant is there. A logicmap records that, next to the code:

- **anchors**: one-line comments, `§<role> <id>@<version>`, at every site that defines or relies on a
  rule;
- **ledger**: `logicmap/<domain>.md`, one entry per rule: what holds, why, what was rejected, what
  breaks, and where the claim comes from;
- **lock**: `logicmap/<domain>.lock`, a fingerprint of the code under every defining anchor (comments
  left out) and of every entry, so the checker knows when code changed under a rule nobody re-read.

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
logicmap.ts show                         every domain, its intro and its rule ids
logicmap.ts show <domain>                the domain's rules, each with its claim
logicmap.ts show <id>                    one rule in full and every site, with the lines it covers
logicmap.ts show <file>[:<line>[-<line>]]  the rules in a file, or covering those lines
logicmap.ts check                        every disagreement; exits 1 on any error
logicmap.ts ack <id>...                  record that you re-read these rules against their code
logicmap.ts diff <id>                    what changed under the id's sites since their last ack
logicmap.ts why <file>:<line>[-<line>]   the rules over the lines, then every commit that changed them,
                                         newest first, with the piece and the goal recorded with each
logicmap.ts why <file>:<name>            the same for a top-level declaration
logicmap.ts why <id>                     a rule, its history, and the commits of its entry with their pieces
```

`logicmap.ts` is `bun ~/.claude/skills/logicmap/scripts/logicmap.ts`.

In Claude Code, `scripts/hook.ts` adds the rules covering the lines an agent reads with the newest
change of those lines, the problems an edit leaves, and `check`'s errors at the end of a turn. To install it, see "The hook" in `SKILL.md`.

To set it up in a repo, follow "Setting it up in a repo" in `SKILL.md`. To work a task in a mapped
repo (a plan whose steps name the rules they touch, decisions recorded when the user makes them, each
piece of code recorded with the reason it was written), follow "Working a task in a mapped repo".

## Tests

```
bun test
```

## License

MIT
