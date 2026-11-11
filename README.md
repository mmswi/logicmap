# logicmap

A map of the why, for coding agents.

Code says what it does. It does not say which other file relies on it, which alternative was already
rejected, or why a line that looks redundant is there. A logicmap records that, next to the code:

- **anchors**: one-line comments, `§<role> <id>@<version>`, at every site that defines or relies on a
  rule;
- **ledger**: `logicmap/<domain>.md`, one entry per rule: what holds, why, what was rejected, what
  breaks, and where the claim comes from;
- **lock**: `logicmap/<domain>.lock`, a fingerprint of the code under every defining anchor (comments
  left out) and of its shape, and of every entry, so the checker knows when code changed under a rule
  nobody re-read, and tells a rename from a change.

An entry can name, with `grep:`, the message its rule governs (a live frame, a job): every line that
sends or reads it must then sit under an anchor of the rule.

`SKILL.md` is what an agent follows on every read and edit of mapped code. Beside it, each read at its moment:
`anchors-and-entries.md` (the formats), `working-a-task.md`, `the-hook.md`, `setting-up-a-repo.md`, and
`mapping-an-existing-repo.md`, the procedure for a codebase where nobody wrote the reasons down.

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
logicmap.ts show [<domain>] --all        the first two views in full: over 20,000 characters they leave the
                                         rule ids, or the claims, out
logicmap.ts find <word>...               the rules whose id or entry hold every word, with their claims
logicmap.ts check                        every disagreement, a changed site with its rule's claim and the
                                         change under it; exits 1 on any error
logicmap.ts ack <id>...                  record that you re-read these rules against their code
logicmap.ts ack --renamed                ack every rule whose code only had words renamed, once you read them
logicmap.ts bump <id> <what changed>     a rule whose meaning changed: its version + 1, a history line, the
                                         definition's pin moved, the other sites listed to re-verify
logicmap.ts diff <id>                    what changed under the id's sites since their last ack
logicmap.ts why <file>:<line>[-<line>]   the rules over the lines, then every commit that changed them,
                                         newest first, with the piece and the goal recorded with each
logicmap.ts why <file>:<name>            the same for a top-level declaration
logicmap.ts why <id>                     a rule, its history, and the commits of its entry with their pieces
```

`logicmap.ts` is `bun ~/.claude/skills/logicmap/scripts/logicmap.ts`.

In Claude Code, `scripts/hook.ts` adds the rules covering the lines an agent reads with the newest
change of those lines, the problems an edit leaves and the rules its `uses` and `test` sites rely on, and
`check`'s errors at the end of a turn. It answers the Read and Edit tools and shell commands alike: a
`sed -n 40,60p <file>` is a read of those lines, and a file a command changed is an edit. To install it, see
`the-hook.md`.

To set it up in a repo, follow `setting-up-a-repo.md`. To work a task in a mapped
repo (a plan whose steps name the rules they touch, decisions recorded when the user makes them, each
piece of code recorded with the reason it was written), follow `working-a-task.md`.

## Tests

```
bun test
```

## License

MIT
