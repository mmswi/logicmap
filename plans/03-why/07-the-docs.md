# Step 7: the docs

## Piece 1: USAGE names `why <id>`
What: the usage line reads `why <file>:<line>[-<line>] | <file>:<name> | <id>`, and its text says a rule's history.
Why: step 5 added the id target after step 4 wrote the line.
Where: `scripts/logicmap.ts` (`USAGE`)

## Piece 2: SKILL.md
What:
- the description: "ask it why a line is as it is" beside reading the map before editing;
- the command block gains `why`, and a list after `show`'s says what each target prints, with when to run it:
  before changing code this session didn't write, and first when debugging a line;
- "Reading anchored code", the no-anchor case: `why` in place of the hand-made `git log -L` walk;
- "Working a task", step 5: the piece committed with its code is what lets `why` lead from a line to it;
- the paragraph "Why a line was written": `why` does the walk; by hand, the three git calls; `git blame -w -C -C`
  for code moved between files (which `-L` doesn't follow); a squash merge keeps one commit holding all its pieces,
  and `why` picks the one holding the line's code;
- the hook's Read bullet: the newest change of a committed code file, once per session;
- the AGENTS.md snippet: a `why` bullet; "so `logicmap why` leads from a line".
Why: an agent reads SKILL.md's steps and the snippet, not USAGE; each place that sent it to `git log -L` by hand now
sends it to the one call. The debugging line is Mihai's "sa poti face debugging usor".
Where: `SKILL.md`

## Piece 3: README
What: the Use block gains `why`; the hook line names the newest change.
Why: the README lists every command.
Where: `README.md`
