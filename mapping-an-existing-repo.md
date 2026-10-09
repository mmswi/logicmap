# Mapping a repo where nothing records the intent

Read this when you write entries for code whose reasons nobody wrote down: an old repo, a handed-over
codebase, a module whose authors are gone. Here you are the source of every entry, so each one has to
say what you saw and what you inferred.

## What an entry can claim, and how sure you can be

- **What the code does.** You read it, so you can be certain. This is `what`, and a flow's `steps`.
- **Why it does it.** Only as good as your evidence: a commit message, a PR or issue, a test name, a
  comment, a doc. Cite it in the `why`. With no evidence, write what the code prevents, as you traced
  it ("without this branch a closed socket stays in the room: traced joinRoom → removeConnection"), and
  write that the reason is not recorded.
- **Whether it is intended.** Unknown until a person says so. Code that looks like a bug is a finding
  for the user, never a rule to anchor.

Every entry written this way gets `source: inferred — <evidence>`: short commit shas with their
subjects, test `file:line`, issue numbers. Write `rejected:` only from evidence (a revert, a PR thread);
an alternative you imagined was never rejected by anyone.

## Steps

1. **Pick the scope**: what the current task touches, or the 3 to 10 places with the most fix history.
   Mapping a whole repo at once produces entries nobody checks.
   Done when you have the list of files.
2. **Find the candidates** in those files:
   - fix history of a path:
     `git log --format='%h %ad %s' --date=short -i -E --grep='fix|bug|revert|hotfix|regression|race|leak|workaround' -- <path>`;
     the files with the most of it:
     `git log --format= --name-only -i -E --grep='fix|bug|revert|hotfix' | sort | uniq -c | sort -rn | head -20`;
   - why a block exists: `git log -L <start>,<end>:<file> --format='%h %ad %s'`, then `git show <sha>`
     for the whole message and any linked PR or issue;
   - reverts, which are rejected alternatives with evidence: `git log --oneline -i --grep=revert -- <path>`;
   - code that looks redundant or defensive (guards, retries, sleeps, swallowed errors, early returns on
     odd conditions) and marker comments:
     `git grep -n -i -E 'hack|workaround|xxx|do not|don.t remove|because|fixme|todo' -- <path>`;
   - one literal in two places under different names (client and server, two services, SQL and code):
     `git grep -n '<literal>'`, then `git log -S '<literal>' --oneline` for when each copy appeared;
   - tests named after a scenario: each one is an edge case somebody hit;
   - places where the call graph stops: HTTP routes and their callers, queue producers and consumers,
     event emitters and listeners, cron jobs, database triggers.
   Done when every candidate has a `file:line` and the evidence found for it, or "none found".
3. **Write each entry** with the three claims kept apart: `what` from the code, `why` with its evidence
   or "not recorded", `source: inferred — ...`. Then place the anchors (SKILL.md, "Adding anchors").
   Done when `check` reports no error except `unacked`.
4. **Ack.** Here `ack` records that the entry matches the code as you read it. The intent stays
   unconfirmed, and `source: inferred` keeps saying so to every later reader.
5. **Ask the user**, in one batch: one question per inferred entry ("Is it intended that <what>? If
   so, why?"), plus the suspected bugs found on the way. `show` with no argument lists every entry with
   `inferred` beside it.
   - Confirmed: rewrite `why` in their words, set `source: confirmed by <name> <date>`, `ack`.
   - "That is a bug": fix it or file it; retire the entry with a `history:` line naming the fix or issue.
   - No answer: the entry stays `inferred`. The next agent still gets what you found and how sure it is.
   Done when every entry is confirmed, retired, or knowingly left inferred.
6. **Map as you go.** Every later task that makes an agent work out a rule nobody wrote down ends with
   that rule's entry, written while the reasoning is fresh.
