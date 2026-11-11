# Setting it up in a repo

1. Create `logicmap/` and map the 3 to 10 places agents most often get wrong: the cross-file rules,
   the fences, the flows nobody can trace. Open each `<domain>.md` with `# <domain>` and its intro. In a codebase whose reasons are not written down, follow
   `mapping-an-existing-repo.md`.
2. `ack` every id; `check` exits 0.
3. Add this to the repo's agent instructions (`AGENTS.md`, `CLAUDE.md`), so agents without this skill
   can read the map:

   ```markdown
   ## Logicmap
   Comments of the form `§<role> <id>@<version>` anchor code to entries in `logicmap/<domain>.md` (the
   rule, why, the rejected alternatives, what breaks). `logicmap` below means
   `bun ~/.claude/skills/logicmap/scripts/logicmap.ts`, run from anywhere in the repo.
   - On a cold start, `logicmap show`: every domain and its rule ids; `logicmap find <word>...`: the rules
     about something, with their claims. Before editing or explaining
     anchored code: `logicmap show <file>` (or `<file>:<start>-<end>`), then `logicmap show <id>` for
     each id you touch (its entry and every anchored site, flow steps in order).
   - After editing: `logicmap check`, and resolve each line it prints (under a changed site it prints the
     rule's claim and the change; `logicmap diff <id>` prints all of it): `logicmap ack <id>` when the entry
     still holds; when its meaning changed, `logicmap bump <id> <what changed>`, rewrite its `what` and `why`,
     re-verify every site `check` then reports as `stale-pin`, move those pins, and ack. `renamed` lists the words renamed: when none now
     points at another thing, `logicmap ack --renamed`. `unanchored-match` is a line naming what a rule's
     `grep:` looks for, under no anchor of the rule: anchor it.
   - Roles: `decision`, `invariant`, `edge`, `flow` define a rule; `uses`, `test` point at one. Files
     that only talk about anchors go in `logicmap/ignore`. The full method: the `logicmap` skill.
   - Why code is as it is: `logicmap why <file>:<line>` (or `<file>:<start>-<end>`, `<file>:<name>`, `<id>`):
     the rules over the lines, then every commit that changed them with the piece recorded with it. Run
     it before changing code you didn't write, and first when debugging.
   - A task starts with a plan (in `plans/<NN>-<task-slug>/` unless this file names another place):
     numbered steps, each listing the logicmap ids it relies on, changes, creates or retires. A
     decision the user makes goes into the plan at once, and into its entry with the code that
     implements it. Each piece of code is recorded in its step's doc (`## Piece N`: what, why, where,
     the code) and committed with it, so `logicmap why` leads from a line to why it was written.
   - An entry whose `source:` starts with `inferred` is an agent's reading of the code, not a recorded
     decision: when you repeat its why, say it is inferred and cite the evidence.
   ```

4. For CI or a pre-commit hook, copy `scripts/logicmap.ts` to `logicmap/logicmap.ts` (the ledger
   folder is never scanned, so the script's own message templates are not read as anchors) and run
   `bun logicmap/logicmap.ts check` there.
5. In Claude Code, install the hook: `the-hook.md`.
