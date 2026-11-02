# Step 4: a declaration as the target

## Piece 1: `<file>:<name>` (the failing test)
What: a test: two exported functions, the second with a comment line above it; a second commit changes the
second; then a line is added at the top without a commit. `why src/room.ts:leaveRoom` names its lines in the
file as it is now and as HEAD numbers them, and both commits; `joinRoom` ends before the comment of
`leaveRoom`, so only the first commit changed it; a name no top-level line holds says so.
Why: an agent asks about a function more often than about a line number. `git log -L :<name>:<file>` takes the
range from HEAD (measure 3 of the plan) and ends it at the next top-level line, comment lines included; found in
the working tree, the range goes through the same mapping as typed lines and the rules over it are the
function's own.
Where: `scripts/logicmap.test.ts` (`describe('why')`)
```ts
  test("a declaration's why: its lines in the file as it is now, up to the next declaration's comment", () => {
    const roomLines = [
      'export const joinRoom = () => {',
      '  return rooms.size',
      '}',
      '',
      '// Leaving empties the room.',
      'export const leaveRoom = () => {',
      '  rooms.clear()',
      '}',
      '',
    ]
    const repoRoot = createFixtureRepo({ 'src/room.ts': roomLines.join('\n') })
    const writeRoom = (): void => writeFixtureFiles(repoRoot, { 'src/room.ts': roomLines.join('\n') })
    commitFixtureRepo(repoRoot, 'wip: the rooms')
    roomLines[6] = '  rooms.delete(roomId)'
    writeRoom()
    commitFixtureRepo(repoRoot, 'wip: a leave deletes its room')
    roomLines.unshift('// the rooms of the open documents')
    writeRoom()

    const leaveWhy = whyLogicMap(repoRoot, 'src/room.ts:leaveRoom')
    expect(leaveWhy).toStartWith('src/room.ts:leaveRoom (7-9) (6-8 in HEAD): 2 commits')
    expect(leaveWhy).toContain('wip: a leave deletes its room')
    expect(whyLogicMap(repoRoot, 'src/room.ts:joinRoom')).toStartWith(
      'src/room.ts:joinRoom (2-4) (1-3 in HEAD): 1 commit',
    )
    expect(whyLogicMap(repoRoot, 'src/room.ts:enterRoom')).toBe(
      'no line at the top level of src/room.ts names enterRoom',
    )
  })
```
Run: red (`why takes <file>:<line> or <file>:<line>-<line>, not "src/room.ts:leaveRoom"`).

## Piece 2: the declaration's lines found in the file as it is now
What: `FILE_NAME_TARGET_PATTERN` reads `<file>:<name>`. `findDeclarationLines` takes the first line at the top
level (starting with a letter, `_` or `$`, as git's default funcname does) that holds the name as a whole word,
and runs to the line before the next top-level line, less the blank and comment lines at its end (the next
declaration's comment and anchors; `COMMENT_LINE_PATTERN`, the scanner's own). The body of `whyLogicMap` moves
into `explainLines`, which the lines target and the name target both call; the header names the declaration and
its lines. `toShowTarget` keeps a `:<name>` suffix whole, so the path before it is still made repo-relative.
Why: revision 2. Found in the working tree, the lines go through `toHeadLines` like typed lines, and the rules
printed are those over the declaration's own lines. Rejected: `git log -L :<name>:<file>` (HEAD's lines only,
measure 3; and its range takes the next declaration's comment and anchors, so the rules of the next function
would print as this one's).
Where: `scripts/logicmap.ts` (`FILE_NAME_TARGET_PATTERN`, `TOP_LEVEL_LINE_PATTERN`, `findDeclarationLines`,
`describeLinesHistory` takes the label, `explainLines`, `whyLogicMap`, `USAGE`, `toShowTarget`)
```ts
const findDeclarationLines = (repoRoot: string, file: string, name: string): LineRange | null => {
  // ...the file read; null when it is gone
  const declarationIndex = fileLines.findIndex(
    (line) => TOP_LEVEL_LINE_PATTERN.test(line) && namePattern.test(line),
  )
  // ...null when no line names it
  const nextTopLevelIndex = fileLines.findIndex(
    (line, lineIndex) => lineIndex > declarationIndex && TOP_LEVEL_LINE_PATTERN.test(line),
  )
  const endIndex = nextTopLevelIndex === -1 ? fileLines.length : nextTopLevelIndex
  const lastCodeIndex = fileLines
    .slice(0, endIndex)
    .findLastIndex((line) => line.trim() !== '' && !COMMENT_LINE_PATTERN.test(line))
  return { firstLine: declarationIndex + 1, lastLine: Math.max(lastCodeIndex, declarationIndex) + 1 }
}
```
Deviation: the first draft declared its own comment pattern; tsc refused the second `COMMENT_LINE_PATTERN`, and
the scanner's covers the same lines and more (`--`, `<!--`, `{/*`).
Run: 37 pass; strict tsc and biome clean. On teamabled `why src/teams/merge-direct-groups.ts:finishMergesAfterCommit`
names 444-481, its five rules (the edge `teams.merge-cleanup-survives-a-failed-announcement` among them) and 8
commits, the newest TODO 109's Piece 2, in 0.7 s.
