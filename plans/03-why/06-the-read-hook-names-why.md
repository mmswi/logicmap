# Step 6: the Read hook names `why`

## Measure
The Read hook today, on teamabled, a Read of `src/teams/merge-direct-groups.ts` from line 440, 50 lines (three
runs): 0.22 s, 0.26 s, 0.17 s. The newest commit of some lines, `git log -1 -L<a>,<b>:<file>`: 0.02–0.03 s for a
whole file (`DocumentEditorPage.tsx`, 2,638 lines, 178 commits), 0.02–0.09 s for 80 lines; without `-1` the same
file's 9 lines took 1.3 s and printed 14 KB. Finding the piece adds `git show --name-only`, one `git grep -l` and a
`git show` per doc holding pieces: about 0.1 s. So the line names the newest change and its piece, not only the hint.

## Piece 1: the line (the failing test)
What: a test: the hook's mapped fixture committed with a step doc whose piece names `src/room.ts:3-5`, and an
unanchored file; a file left uncommitted. A Read of lines 3-5 shows the rules, then one line: the newest commit's
hash, date and subject, its piece and the `why` command for those lines. The same Read in the same session shows no
such line; another session's whole-file Read names `why <file>:<line> or <file>:<name>`; the unanchored committed
file gets the line alone; the uncommitted one gets nothing.
Why: SKILL.md sends an agent reading code with no anchor to the commit's piece, and the hook is what an agent sees
without asking. Once per file and session keeps it one line per file; a file git doesn't hold has no history to
name.
Where: `scripts/logicmap.test.ts` (`describe('hook')`)
```ts
  test('after a read of committed code, once per file and session, the newest change of the lines and the why command', () => {
    const repoRoot = createMappedRepo()
    const roomPath = join(repoRoot, 'src/room.ts')
    writeFixtureFiles(repoRoot, {
      'src/other.ts': 'export const other = 1\n',
      'plans/01-the-join/01-the-edge.md': [
        '## Piece 1: the join drops a closed socket',
        'What: the branch.',
        'Where: `src/room.ts:3-5`',
        '',
      ].join('\n'),
    })
    commitFixtureRepo(repoRoot, 'wip: the join drops a socket closed meanwhile')
    writeFixtureFiles(repoRoot, { 'src/plain.ts': 'export const plain = 1\n' })
    const sessionId = `reading-${crypto.randomUUID()}`
    const contextOfRead = (readingSessionId: string, toolInput: Record<string, unknown>) => {
      const hookOutput = respondToHook({
        hook_event_name: 'PostToolUse',
        session_id: readingSessionId,
        tool_name: 'Read',
        tool_input: toolInput,
      })
      return hookOutput !== null && 'hookSpecificOutput' in hookOutput
        ? hookOutput.hookSpecificOutput.additionalContext
        : null
    }

    const firstRead = contextOfRead(sessionId, { file_path: roomPath, offset: 3, limit: 3 })
    expect(firstRead).toStartWith('logicmap: the rules covering src/room.ts')
    expect(firstRead).toMatch(
      /\nlogicmap: last changed by [0-9a-f]{7,} on \d{4}-\d{2}-\d{2}, "wip: the join drops a socket closed meanwhile", recorded as Piece 1 in plans\/01-the-join\/01-the-edge\.md\. logicmap why src\/room\.ts:3-5 gives every commit of these lines with its reason\.$/,
    )
    expect(contextOfRead(sessionId, { file_path: roomPath, offset: 3, limit: 3 })).not.toContain(
      'last changed by',
    )
    expect(contextOfRead(`another-${crypto.randomUUID()}`, { file_path: roomPath })).toContain(
      'logicmap why src/room.ts:<line> or src/room.ts:<name> gives every commit of a line or a declaration with its reason.',
    )
    expect(contextOfRead(sessionId, { file_path: join(repoRoot, 'src/other.ts') })).toStartWith(
      'logicmap: last changed by',
    )
    expect(contextOfRead(sessionId, { file_path: join(repoRoot, 'src/plain.ts') })).toBeNull()
  })
```
Run: red (the Read printed the rules only).

## Piece 2: `findNewestLinesChange`; the hook's line
What: `logicmap.ts` exports `findNewestLinesChange(repoRoot, file, lines | null)`: for a file HEAD holds, the lines
read clamped to the working file (the whole file when null), mapped to HEAD by `toHeadLines`, one `git log -L`
stopped at 5 commits (`listLineCommitsOrNull` takes `maxCount`), the first commit that isn't blank lines only, and
`findRecordedPiece` over the docs it wrote (`listCommitDocPaths`, lifted from `describeCommitReason`). The hook's
`listNewestChangeLines` prints it once per file and session (a `.named-changes.txt` session file), for a file
outside `logicmap/` and not Markdown, with the subject cut at 100 characters, after the rules; `respondToRead` no
longer stops at a file with no rule. Any throw costs this line only.
Why: piece 1; the measure. The cap keeps a whole-file Read at one commit's cost; five, not one, because the newest
can be a blank-line commit (revision 3). Markdown files are where reasons are written, and the ledger has
`why <id>`.
Where: `scripts/logicmap.ts` (`listLineCommitsOrNull`, `listCommitDocPaths`, `NEWEST_CHANGE_MAX_COMMITS`,
`NewestLinesChange`, `findNewestLinesChange`), `scripts/hook.ts` (the header comment, `namedChangesFileOf`,
`describeNewestChange`, `listNewestChangeLines`, `respondToRead`)
```ts
  const readLines = toReadLines(offset, limit)
  const ruleSections = listRuleSectionsInLines(repoRoot, file, readLines)
  const newestChangeLines = listNewestChangeLines(repoRoot, file, readLines, sessionId)
  if (ruleSections.length === 0 && newestChangeLines.length === 0) {
    return null
  }
```
Run: 40 pass; strict tsc and biome clean. On teamabled, fresh sessions: `merge-direct-groups.ts` from 440, 50 lines,
0.27 s (0.17–0.26 s before), its line TODO 109's Piece 2; `doc-store.ts` 60-74, 0.34 s, F43 task 03's Piece 4;
`web/src/lib/api.ts` whole, 0.26 s, Q4 task 35's Piece 2. `DocumentEditorPage.tsx` whole, 0.23 s, named
`29af14ce` "Merge branch 'feat/e2e-approvals' into feat/backend-review-rest" (revision 4).

## Piece 3: a merge left out (the failing test, revision 4)
What: a test: a file committed, a branch changes its line 2, the trunk its line 4, then a merge without a fast
forward. `why src/room.ts:1-4` lists the three commits and not the merge.
Why: revision 4.
Where: `scripts/logicmap.test.ts` (`describe('why')`)
```ts
  test("a merge whose two sides changed the lines is left out; its sides' commits are listed", () => {
    const roomLines = ['const a = 1', 'const b = 2', 'const c = 3', 'const d = 4', '']
    const repoRoot = createFixtureRepo({ 'src/room.ts': roomLines.join('\n') })
    const writeRoom = (): void => writeFixtureFiles(repoRoot, { 'src/room.ts': roomLines.join('\n') })
    const runFixtureGit = (gitArguments: string[]): void => {
      execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', ...gitArguments], {
        cwd: repoRoot,
        stdio: 'ignore',
      })
    }
    commitFixtureRepo(repoRoot, 'wip: the room')
    runFixtureGit(['checkout', '--quiet', '-b', 'side'])
    roomLines[1] = 'const b = 20'
    writeRoom()
    commitFixtureRepo(repoRoot, 'wip: b on the side')
    runFixtureGit(['checkout', '--quiet', '-'])
    roomLines[1] = 'const b = 2'
    roomLines[3] = 'const d = 40'
    writeRoom()
    commitFixtureRepo(repoRoot, 'wip: d on the trunk')
    runFixtureGit(['merge', '--quiet', '--no-ff', 'side', '-m', 'Merge branch side'])

    const roomWhy = whyLogicMap(repoRoot, 'src/room.ts:1-4')
    expect(roomWhy).toStartWith('src/room.ts:1-4: 3 commits, newest first')
    expect(roomWhy).not.toContain('Merge branch side')
  })
```
Run: red (`4 commits`, `Merge branch side` first).

## Piece 4: `--no-merges`
What: `listLineCommitsOrNull` passes `--no-merges` to `git log -L`.
Why: piece 3. Ceiling: a conflict resolved by hand in a merge, lines no side wrote, goes unlisted; `git log -L`
without the flag still shows it.
Where: `scripts/logicmap.ts` (`listLineCommitsOrNull`)
```ts
      '--no-merges',
```
Run: 41 pass; strict tsc and biome clean. On teamabled the whole-file Read of `DocumentEditorPage.tsx` (0.27 s)
now names `8781fe40`, Q4 task 35's Piece 5; `why src/documents/approvals.ts:621` keeps its 6 commits.
