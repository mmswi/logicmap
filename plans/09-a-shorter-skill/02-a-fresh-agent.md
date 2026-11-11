# Step 2: a fresh agent works from the short skill

The trial: a scratch repo (`skill-trial/`, branch `trial/map-upload-limit-and-signed-out`, commits 8fbbe2a,
2b3933f, 4f4df53) with an upload limit enforced by the server and mirrored by the client, and a later change of
its meaning. The agent's brief named the skill and the task, not the answers.

What it did, checked by hand:
- read SKILL.md, then `working-a-task.md`, `anchors-and-entries.md` and `mapping-an-existing-repo.md`, each at the
  moment SKILL.md names; it never needed `the-hook.md` or `setting-up-a-repo.md`;
- mapped the limit as an `invariant` at the server's check, `uses` at the client's mirror and `test` on the test
  that fails when the limit moves; `source: inferred` with the commits and tests it read;
- changed the meaning with `bump` (@1 → @2), rewrote what and why, and re-verified the `stale-pin` sites, which
  caught a route still holding the old limit;
- `check` exits 0; the repo's 5 tests pass.

Where the short skill left it unsure, each folded in below: (a) whether mapping with no code change is a task;
(b) the mirrored constant is fingerprinted on one side only; (c) the `grep:` bullet overlapped the mirrored
constant's; (d) the `untested` warning, and that warnings leave the exit at 0, were in the side file only; (e)
whether a comment stating the why counts as recorded; (f) the claim said more than the rule's sites held; (g) a
user decision changing a rule mapped as another kind; (h) piece diffs quote anchor lines in plan files; (i) when
to `bump` once the plan knows the meaning changes; (j) how to commit in a repo with no rules for it. Its notes on
the hook (k: `cat -n`, a subagent told "shown earlier", the lead-in under an `undocumented` error) and on `check`
(l: "bump its version" right after a bump) are fixed in plans/07 steps 10-12 and plans/08 step 8. Left: (m) `why
<id>` shows the entry's first piece rather than the bump's (the bump is in the history line above it).

## Piece 1: SKILL.md, the forms and the anchors
What: SKILL.md's "Adding anchors" says a mirrored constant also gets a test comparing both sides (b), and the
`grep:` bullet is for a message named the same way at every site (c). The short forms say the claim is the rule
as its sites hold it (f), that a comment stating the why is a recorded source (e), and how the `untested` warning
works and that warnings leave the exit at 0 (d). The pointer to `working-a-task.md` counts mapping an area as a
task (a), and the short hook section says a subagent has its own shown-once record.
Why: each is a judgment taken while adding an anchor or an entry, the moment SKILL.md covers without a side file.
Where: SKILL.md, "Adding anchors", "The forms, in short", "The hook (Claude Code)", "The rest of the method"
```diff
-  `invariant` at the enforcing site, `uses` at each relying site;
+  `invariant` at the enforcing site, `uses` at each relying site. `check` fingerprints the enforcing side only,
+  so a mirrored constant also gets a test comparing both sides wherever a test can import both;
-- a message crosses processes and every sender and reader must agree on it (a live frame, a job, a key
-  mirrored across a boundary) → its rule gets a `grep:` that matches the message's name, and every line
-  naming it is a site: `check` reports the ones under no anchor of the rule.
+- a message crosses processes and every sender and reader must agree on it (a live frame, a job), named the
+  same way at every site → its rule gets a `grep:` that matches that name, and every line naming it is a site:
+  `check` reports the ones under no anchor of the rule.
-  line; a flow adds `steps:`. The first sentence of `what` is the claim: the rule itself, in at most 200
-  characters. `source:` opens with `inferred` and the evidence when you worked the why out from the code;
-  otherwise it names where a person recorded it.
+  line; a flow adds `steps:`. The first sentence of `what` is the claim: the rule itself, as its sites hold it,
+  in at most 200 characters. `source:` opens with `inferred` and the evidence when you worked the why out from
+  the code; otherwise it names where a person recorded it (a doc, a commit message, a comment stating the why).
+- An `edge` or `invariant` with no `test` anchor warns until it has one, or an `untested:` field saying why no
+  test can prove it. Warnings leave `check`'s exit at 0; errors do not.
-  rules covering those lines, in full the first time in a session and by id after that, and the newest commit of
-  the lines;
+  rules covering those lines, in full the first time in a session (a subagent has its own) and by id after that,
+  and the newest commit of the lines;
-- `working-a-task.md`: before the plan of a task (a feature step, a bug fix, a refactor) in a mapped repo whose
+- `working-a-task.md`: before the plan of a task (a feature step, a bug fix, a refactor, mapping an area) in a
```

## Piece 2: working-a-task.md, the plan's folder, the bump, the decision, the commit
What: mapping an area that changes no code is a task (a); the folder of the plans goes in `logicmap/ignore`, since
piece diffs quote anchor lines and `why` still reads the step docs (h); a step that knows the meaning changes runs
`bump` before its first test (i); a decision that changes a rule already mapped is a bump of that entry (g); with
no commit rules, one commit per step (j).
Why: each is a step of a task's work, the moment `working-a-task.md` is read for.
Where: working-a-task.md, the intro and steps 1, 2, 3 and 7
```diff
-A task (a feature step, a bug fix, a refactor) can outlive the session that starts it: …
+A task (a feature step, a bug fix, a refactor, mapping an area that changes no code) can outlive the …
+   `logicmap/*.md` is read as a ledger file. List the folder of the plans in `logicmap/ignore`: a piece's
+   diff quotes anchor lines, and `why` still reads the step docs there. The plan holds the goal (what the user
-     sites `show <id>` prints: the step re-verifies each one;
+     sites `show <id>` prints: the step runs `bump` before its first test, whose anchor pins `@N+1`, and
+     re-verifies each of those sites;
+   (`orphan-entry`). A decision that changes a rule already mapped, of any kind, is a bump of that entry:
+   its `why` and `rejected` take the decision, and no second entry is written.
-   repo's rules.
+   repo's rules, or one commit per step when it has none.
```

## Piece 3: the-hook.md follows the hook's fixes
What: the hook's page says what plans/07 steps 7-12 changed: a subagent's own shown-once record, errors that each
say how to resolve them, `$` in sed, heredocs and quotes read as text, deletions answered, versions another
session's hook answered left out, changes before reads under 40 lines with the rest named; and a paragraph on what
the times of files cannot tell (the user's editor and another session's command during the run; a commit inside
the command, `cp -p`, a command in the background), with `check` before a commit as the answer.
Why: `the-hook.md` is read when a line the hook prints is unclear, so it must describe the hook as it is.
Where: the-hook.md, the Bash bullet and a paragraph after the install note.
