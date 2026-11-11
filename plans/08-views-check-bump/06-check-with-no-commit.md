# Step 6: `check` in a repo with no commit

## Piece 1: red, a changed site before the first commit
What: a test in `describe('diff')`: a repo mapped and acked but never committed, its anchored code edited; `checkRepoWithChanges` lists the `changed` error, and under it the claim and the no-hunk line.
Why: step 3 asks git for the site's diff from the ack's commit, or from HEAD when the ack is not committed. A repo with no commit has no HEAD, `git diff HEAD` exits 128, and `runGit` throws, so `check` printed a stack trace where it printed the error before. The first mapping of a repo goes through exactly that state.
Where: scripts/logicmap.test.ts, after the test "check gives, under a changed site, the claim and the change…"
```ts
  test('check in a repo with no commit lists a changed site, with its claim and no hunk', () => {
    const roomCodeHolding = (value: string): string =>
      [
        '// §edge sync.close-during-join@1',
        'if (closedEarly) {',
        `  joined.removeConnection(${value})`,
        '}',
        '',
      ].join('\n')
    const repoRoot = createFixtureRepo({
      'src/room.ts': roomCodeHolding('1'),
      'logicmap/sync.md': closeDuringJoinEntry(1),
    })
    ackIds(repoRoot, ['sync.close-during-join'])
    writeFixtureFiles(repoRoot, { 'src/room.ts': roomCodeHolding('2') })

    const { problems, changeLinesByProblem } = checkRepoWithChanges(repoRoot)
    const changedProblem = problems.find((problem) => problem.code === PROBLEM_CODES.changed)
    const changeLines =
      changedProblem === undefined ? [] : (changeLinesByProblem.get(changedProblem) ?? [])
    expect(changedProblem?.file).toBe('src/room.ts')
    expect(changeLines[0]).toBe('    claim: The socket can close while the join is loading.')
    expect(changeLines.at(-1)).toBe('    no hunk meets these lines (an untracked file has no diff)')
  })
```
Run, red: `error: Command failed: git diff -U2 HEAD -- src/room.ts`, `(fail) diff > check in a repo with no commit…`.

## Piece 2: green, the site's diff through runGitOrEmpty
What: `describeSiteChange` asks git for the diff with `runGitOrEmpty`, so a diff git cannot give is no hunk.
Why: the site's error and claim are what `check` is for; the hunk is help on top. `NO_HUNK_LINE` already says an untracked file has no diff, and before a first commit every file is untracked. Rejected: a since-note of its own for a repo with no commit (one more git call per site for a state that lasts until the first commit).
Where: scripts/logicmap.ts:1842
```diff
-  const diffText = runGit(repoRoot, ['diff', '-U2', ackCommit ?? 'HEAD', '--', lockSite.file])
+  const diffText = runGitOrEmpty(repoRoot, ['diff', '-U2', ackCommit ?? 'HEAD', '--', lockSite.file])
```
Run, green: `1 pass, 0 fail`.
biome wrapped the call over one argument per line; the code is the same.
