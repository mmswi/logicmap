# Step 1: from lines to their commits

## Piece 1: a line's commits, newest first, from the file as it is now (the failing test)
What: `commitFixtureRepo(repoRoot, message)` commits every file of a fixture repo; the diff test's own
`commitAll` becomes a call to it. A test in `describe('why')`: `src/room.ts` is committed, then its line 3
is changed in a second commit. `why src/room.ts:3` lists both subjects, the newer first, each after a date
and a short hash; line 1 lists only the first. Then a comment line is added above line 1 without a commit:
`why src/room.ts:4` (HEAD's line 3) still lists both, and `why src/room.ts:1` says it is not committed yet,
as does a line of a file git doesn't track.
Why: measure 2 of the plan: `git log -L` reads HEAD's line numbers, so with one uncommitted line above it,
the typed line 4 is HEAD's `}`, written only by the first commit. A test that passes the typed number
through would list one commit and look right; this one fails unless the lines are mapped.
Where: `scripts/logicmap.test.ts` (`commitFixtureRepo` after `readFixtureFile`; the diff test;
`describe('why')` after it)
```ts
const commitFixtureRepo = (repoRoot: string, message: string): void => {
  execFileSync('git', ['add', '-A'], { cwd: repoRoot })
  execFileSync(
    'git',
    ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '--quiet', '-m', message],
    { cwd: repoRoot },
  )
}
```
```ts
describe('why', () => {
  test("a line's commits, newest first; one added since HEAD is not committed yet; lines added above it are followed", () => {
    const roomLines = ['const room = new Map()', 'export const joinRoom = () => {', '  return room.size', '}', '']
    const repoRoot = createFixtureRepo({ 'src/room.ts': roomLines.join('\n') })
    const writeRoom = (): void => writeFixtureFiles(repoRoot, { 'src/room.ts': roomLines.join('\n') })
    commitFixtureRepo(repoRoot, 'wip: the room')
    roomLines[2] = '  return room.size + 1'
    writeRoom()
    commitFixtureRepo(repoRoot, 'wip: the joiner counted')

    const returnLineWhy = whyLogicMap(repoRoot, 'src/room.ts:3')
    expect(returnLineWhy).toMatch(/\d{4}-\d{2}-\d{2} [0-9a-f]{7,} wip: the joiner counted/)
    expect(returnLineWhy.indexOf('wip: the joiner counted')).toBeLessThan(
      returnLineWhy.indexOf('wip: the room'),
    )
    expect(whyLogicMap(repoRoot, 'src/room.ts:1')).not.toContain('wip: the joiner counted')

    roomLines.unshift('// the rooms of the open documents')
    writeRoom()
    const movedLineWhy = whyLogicMap(repoRoot, 'src/room.ts:4')
    expect(movedLineWhy).toContain('wip: the joiner counted')
    expect(movedLineWhy).toContain('wip: the room')
    expect(whyLogicMap(repoRoot, 'src/room.ts:1')).toContain('not committed yet')
    writeFixtureFiles(repoRoot, { 'src/fresh.ts': 'export const fresh = 1\n' })
    expect(whyLogicMap(repoRoot, 'src/fresh.ts:1')).toContain('not committed yet')
  })
})
```
Run: red (`Export named 'whyLogicMap' not found`).

## Piece 2: `whyLogicMap`, the working tree's lines traced in HEAD
What: `why <file>:<line>[-<line>]` on the command line calls `whyLogicMap`. A file HEAD doesn't hold is
"not committed yet". Otherwise `toHeadLines` reads `git diff -U0 HEAD -- <file>`: a line inside a hunk was
changed since HEAD and stands for the lines that hunk replaced (none for an addition); any other line moves
by what every hunk above it removed less what it added. With no HEAD line left, the lines are "not committed
yet". `listLineCommitsOrNull` runs one `git log -L<a>,<b>:<file>` on HEAD's lines, each commit opened by an
ASCII record separator, and keeps each commit's hash, date, subject and the diff git shows for those lines
(step 2 reads it). The output names HEAD's lines when they differ, the uncommitted lines, then 10 commits at
most and the count of the rest with the command that lists them. The hunk header is parsed once,
`parseDiffHunk`, for `diff` and for `why`.
Why: measure 2; a range that crosses an edit keeps the lines it replaced, so a changed line still leads to
the reason the old one was written. Rejected: refusing a dirty file (an agent asks why mid-task, with edits
open); `git blame` per line (one commit per line, not the line's history; -L gives every commit in one call).
Where: `scripts/logicmap.ts` (`HUNK_HEADER_PATTERN`, `DiffHunk`, `parseDiffHunk`, `lastNewLineOf`,
`hunksMeetingLines`, the section "Why", `USAGE`, `runCommandLine`)
```ts
const toHeadLines = (repoRoot: string, file: string, lines: LineRange): HeadLinesOfWorkingLines => {
  const hunksSinceHead = runGit(repoRoot, ['diff', '-U0', 'HEAD', '--', file])
    .split(HUNK_START_PATTERN)
    .flatMap((hunkText) => parseDiffHunk(hunkText) ?? [])
  const findHunkHoldingLine = (line: number): DiffHunk | undefined =>
    hunksSinceHead.find(
      (hunk) => hunk.newLineCount > 0 && hunk.newFirstLine <= line && line <= lastNewLineOf(hunk),
    )
  const workingLines = listLineNumbers(lines)
  const headLineNumbers = workingLines.flatMap((line) => {
    const hunkHoldingLine = findHunkHoldingLine(line)
    if (hunkHoldingLine !== undefined) {
      return listLineNumbers({
        firstLine: hunkHoldingLine.oldFirstLine,
        lastLine: hunkHoldingLine.oldFirstLine + hunkHoldingLine.oldLineCount - 1,
      })
    }
    // Every hunk above the line moves it by the lines it removed less the lines it added.
    const lineShift = hunksSinceHead
      .filter((hunk) => lastNewLineOf(hunk) < line)
      .reduce((shift, hunk) => shift + hunk.oldLineCount - hunk.newLineCount, 0)
    return [line + lineShift]
  })
  // ...the range of HEAD's lines, and the working lines held by a hunk
}
```
Deviation: biome refused a spread on the accumulator of `describeLineNumbers` (`noAccumulatingSpread`);
it pushes instead.
Run: 33 pass; strict tsc and biome clean. On teamabled: `why src/teams/merge-direct-groups.ts:459-460`
lists `62cbc747` (TODO 109) and `7fc7004d` (TODO 108); `why web/src/pages/DocumentEditorPage.tsx:958-966`
lists 10 commits, from `63277cea` (TODO 89) back to `af8da098` (editor M3, June).
