# Step 5: `SKILL.md`, the README, the usage line

## Piece 1: the `show` levels

What: the command list shows `show [<domain> | <id> | <file>[:<line>[-<line>]]]`, followed by the five
levels (domains map, domain, id, file, file lines); "Reading anchored code" step 1 asks for
`show <file>` or `show <file>:<start>-<end>` and says what each line of it holds.
Why: the old line, "`show` with no argument lists every entry", described the 71.6 KB list that is gone.
Where: `SKILL.md`, under the command block and in "Reading anchored code".

## Piece 2: the claim and the domain intro

What: in "Ledger entry", `what` is no longer "one line"; its first sentence is the claim, at most 200
characters, what `show` prints, with the detail allowed after it and the rule for where a sentence
ends; a bullet on the `# <domain>` intro. `check enforces` names the `long-what` warning. "Setting it
up" step 1 asks for the intro.
Why: the spec said "one line" and 110 of teamabled's 180 claims were longer; the rule now matches what
the checker measures.
Where: `SKILL.md`, "Ledger entry", "Anchor grammar" (the enforces paragraph), "Setting it up".

## Piece 3: a line's piece through moves

What: "Why a line was written" starts from `git log -L <n>,<n>:<file>` (every commit of those lines)
and `git blame -w -C -C -L <n>,<n> <file>` (through whitespace and code moved between files); the "no
anchor" bullet of "Reading anchored code" says `git log -L`.
Why: a plain `git blame` names the last commit that touched the line, often a move or a reformat,
whose step doc does not explain the line.
Where: `SKILL.md`, "Working a task in a mapped repo" and "Reading anchored code" step 2.

## Piece 4: the hook

What: a section "The hook (Claude Code)": what it adds after a read, after an edit and at stop, the
JSON to merge into `~/.claude/settings.json`, and that it adds to the protocol without replacing it.
The `AGENTS.md` block starts with `logicmap show` on a cold start and allows `<file>:<start>-<end>`.
The README lists the new `show` forms and points at the hook section.
Where: `SKILL.md`, before "Setting it up in a repo", and step 3's block; `README.md`, "Use".

## Piece 5: the usage line

What: the checker's own usage text lists the new `show` forms.
Where: `scripts/logicmap.ts`, `USAGE`.

```diff
-  "       bun logicmap.ts show [<id> | <file>] every entry; one id with its sites; one file's anchors",
+  '       bun logicmap.ts show [<domain> | <id> | <file>[:<line>[-<line>]]]',
+  "                                           every domain; a domain's rules; one rule and its sites; a file's rules",
```

Checks: `bun test` 24 pass, 0 fail; strict `tsc` clean; `biome check` clean.
