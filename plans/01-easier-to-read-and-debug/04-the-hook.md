# Step 4: the hook

## Piece 1: tests — read, edit, stop

What: three tests in `describe('hook')` of `scripts/logicmap.test.ts`, on a fixture with one `edge`
anchor over lines 2-5 of `src/room.ts`:
- a `Read` of the whole file adds the rule with its range; a read of lines 4 adds it; lines 6-7 add
  nothing;
- an `Edit` adds nothing while the code matches the lock, and the `changed` error once the code under
  the anchor changes;
- `Stop` blocks with the `changed` error, adds nothing when `stop_hook_active` is true, and nothing
  outside a mapped repo (a git repo with no `logicmap/`), for a stop or a read.
Why: the hook's whole value is putting the right rule in front of the agent at the right moment and
staying silent otherwise.
Where: `scripts/logicmap.test.ts`, imports `respondToHook` from `./hook.ts`.

Red: `Cannot find module './hook.ts'`.

## Piece 2: the views become shared, `showRulesInLines` exported

What: the closures of `showLogicMap` move into `createShowViews(repoRoot)`, which returns them;
`showLogicMap` dispatches on the target with them; `showRulesInLines(repoRoot, file, lines)` returns
the rules covering those lines, or `null` when the file has no anchors or no rule covers them;
`showFileRules` returns an empty text for no rule and `showLogicMap` words it. `LEDGER_DIRECTORY`,
`LineRange` and `formatProblem` (the line `check` prints) are exported.
Why: the hook needs "the rules here, or nothing" without parsing `show`'s messages.
Where: `scripts/logicmap.ts`, `createShowViews`, `showLogicMap`, `showRulesInLines`, `formatProblem`.

```ts
// The rules covering some lines of a file (all of it when lines is null), or null when none does: what
// the hook adds after a read.
export const showRulesInLines = (
  repoRoot: string,
  file: string,
  lines: LineRange | null,
): string | null => {
  const views = createShowViews(repoRoot)
  if (!views.isAnchoredFile(file)) {
    return null
  }
  const rulesView = views.showFileRules(file, lines)
  return rulesView === '' ? null : rulesView
}
```

## Piece 3: `scripts/hook.ts`

What: `respondToHook(input)` turns Claude Code's hook input into its output: after `Read`, the rules
covering the lines read (`offset`/`limit`, the whole file without them) as `additionalContext`; after
`Edit`, `MultiEdit` or `Write`, the errors `check` reports in that file (or a `gone` lock line of it);
at `Stop`, `check`'s errors as `{ decision: 'block', reason }`, once (`stop_hook_active`), at most 20
listed. It answers only in a git repo with a `logicmap/` folder. The command-line part reads stdin,
narrows each field it uses, and prints the JSON.
Why: Claude Code reads `additionalContext` from a PostToolUse hook's JSON on stdout (plain stdout does
not reach the model there), and a Stop hook's `decision: block` with its `reason` keeps the turn going
(hooks reference, checked by a claude-code-guide subagent).
Where: `scripts/hook.ts`, new.

```ts
export const respondToHook = (input: HookInput): HookOutput | null => {
  const filePath = input.tool_input?.file_path
  const isPostToolUse = input.hook_event_name === HOOK_EVENTS.postToolUse
  if (isPostToolUse && typeof filePath === 'string') {
    if (input.tool_name === READ_TOOL_NAME) {
      return respondToRead(filePath, input.tool_input?.offset, input.tool_input?.limit)
    }
    if (EDITING_TOOL_NAMES.includes(input.tool_name ?? '')) {
      return respondToEdit(filePath)
    }
    return null
  }
  if (input.hook_event_name === HOOK_EVENTS.stop) {
    return respondToStop(input.cwd ?? process.cwd(), input.stop_hook_active === true)
  }
  return null
}
```

First run: the read and edit tests failed with `null`. The fixture repos live under `/var/folders`,
which macOS links to `/private/var/folders`; `git rev-parse --show-toplevel` prints the resolved path,
so the file's path relative to it climbed out of the repo. Fix: `toRepoPath` resolves the file with
`realpathSync` first.

```diff
+// git prints the repo root with symlinks resolved (macOS: /var → /private/var), so the path is too.
 const toRepoPath = (repoRoot: string, absolutePath: string): string =>
-  relative(repoRoot, absolutePath).split(sep).join('/')
+  relative(repoRoot, realpathSync(absolutePath)).split(sep).join('/')
```

Green: 24 pass, 0 fail; strict `tsc` clean; `biome check --write` reformatted two files.

## Piece 4: installed for every session

What: three entries in `~/.claude/settings.json`, after the existing gstack `Stop` hook:
`PostToolUse` with matcher `Read`, `PostToolUse` with matcher `Edit|MultiEdit|Write`, and `Stop`, each
`bun /Users/mihaimarinescu/.claude/skills/logicmap/scripts/hook.ts`, timeout 30 seconds.
Why: user level, so every mapped repo gets it (teamabled, mental-math); outside one the hook prints
nothing.
Check: piping a `Read` of `src/documents/routes.ts` lines 400-409 printed
`access.one-predicate-per-action@5 ... 395-415 §uses ok`; an `Edit` with no problem, a `Stop` in
`/tmp` and a `Read` of a file outside any repo printed nothing; `jq -e` finds both matchers. Then a
real `Read` of `routes.ts` lines 400-405 in this session came back with that rule as hook context.
