# Step 1: The split

Before: SKILL.md 29,586 characters (29,634 bytes): intro and commands 4,229, "Reading anchored code" 2,392,
"Changing anchored code" 3,084, "Adding anchors" 2,182, "Anchor grammar" 2,819, "Ledger entry" 2,267, "Working a
task in a mapped repo" 6,539, "The hook (Claude Code)" 3,062, "Setting it up in a repo" 3,012.

## Piece 1: four files take the text read at one moment
What: each section below leaves SKILL.md as written and becomes a file beside it, its `##` heading the file's `#`:
- "Anchor grammar" and "Ledger entry" → `anchors-and-entries.md`, under a two-line head saying what the file is and
  when it is read, with "The lock" after them: the two sentences of the intro about which lock an ack rewrites and
  the single `logicmap/lock` of earlier versions.
- "Working a task in a mapped repo" → `working-a-task.md`.
- "The hook (Claude Code)" → `the-hook.md`.
- "Setting it up in a repo" → `setting-up-a-repo.md`. Its block for the repo's agent instructions names
  `logicmap find <word>...` on a cold start and `logicmap bump <id> <what changed>` for a changed meaning, and a
  step 5 points at `the-hook.md`.
Why: plan, decision 1: format `check` enforces and procedure used at one moment.
Where: the four new files

## Piece 2: SKILL.md keeps what holds on every read and edit
What: the intro (the lock's bullet ends at "Only `ack` writes the lock."), the commands, "Reading anchored code"
and "Changing anchored code" stay as written. "Adding anchors" stays, its step 2 pointing at the short forms, which
follow its "Done when" line. "The hook (Claude Code)" becomes one paragraph on what its lines mean. "The rest of the
method" names the five files, each with its moment.
Why: plan, decisions 2 and 3.
Where: `SKILL.md`: "Adding anchors", "The hook (Claude Code)", "The rest of the method"
```markdown
The forms, in short. All of it, with what `check` enforces, is `anchors-and-entries.md` beside this file: read it
before the first anchor or entry you write in a session, and when `check` reports a format error its message does
not settle.

- Anchor: `§<role> <id>@<version>` in a comment, plus ` #<step>` on a flow's anchors. `decision`, `invariant`,
  `edge` and `flow` define a rule; `uses` and `test` refer to one. It covers its own line when code precedes it,
  otherwise the first code line below it and everything indented under that line.
- Entry: `## <id>` in `logicmap/<domain>.md`, then `kind:`, `version: 1`, `what:`, `why:`, `source:`, one field per
  line; a flow adds `steps:`. The first sentence of `what` is the claim: the rule itself, in at most 200
  characters. `source:` opens with `inferred` and the evidence when you worked the why out from the code;
  otherwise it names where a person recorded it.
- `§` followed by a lowercase letter always starts an anchor. Prose about the method writes `§<role>` or the bare
  id; a file that quotes anchors goes in `logicmap/ignore`.
```
```markdown
## The hook (Claude Code)

With `scripts/hook.ts` installed, lines opening with `logicmap:` arrive after a tool call, in any repo with a
`logicmap/` folder:

- after code is read (the Read tool, or `sed -n <first>,<last>p <file>` or `cat <file>` in a Bash command): the
  rules covering those lines, in full the first time in a session and by id after that, and the newest commit of
  the lines;
- after a file is changed (Edit, Write, or a Bash command): the errors `check` reports in it, and the rules its
  `uses` and `test` sites rely on;
- at the end of a turn: `check`'s errors, for a session that changed a file in the repo.

The hook adds to what this file asks and replaces none of it: run `show <id>` before relying on a rule it names,
and `check` before a commit. Installing it, and what each event answers: `the-hook.md`.

## The rest of the method

Each is a file beside this one, read at the moment named:

- `anchors-and-entries.md`: before the first anchor or entry you write in a session. The anchor grammar and what
  an anchor covers, the ledger entry's fields, what `check` enforces.
- `working-a-task.md`: before the plan of a task (a feature step, a bug fix, a refactor) in a mapped repo whose
  agent instructions give no task steps of their own, and when resuming one. The plan and the rules each step
  names, recording a decision, recording each piece so `why` leads to it.
- `mapping-an-existing-repo.md`: before an entry for code whose reasons nobody wrote down.
- `the-hook.md`: to install the hook, or when a line it prints is unclear.
- `setting-up-a-repo.md`: to start a `logicmap/` in a repo.
```

## Piece 3: the pointers outside SKILL.md
What: README.md names the four files where it named SKILL.md's sections; `mapping-an-existing-repo.md:44` keeps
its pointer to SKILL.md's "Adding anchors" (the section stayed) and names `anchors-and-entries.md` for the format.
Where: `README.md:19-20`, `:72-76`; `mapping-an-existing-repo.md:44`
