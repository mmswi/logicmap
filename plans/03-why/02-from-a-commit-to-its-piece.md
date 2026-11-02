# Step 2: from a commit to its piece

## Piece 1: the piece shown under its commit (the failing test)
What: a test in `describe('why')`: three commits on `src/room.ts`. The second changes line 3 and holds a
task folder, `plans/05-room-counts/`, whose step doc has a red piece (its Why on two lines) and a green
piece quoting the new line with an empty `Why:` and its `What:` text on the line below. The third changes
line 1 and holds `notes/typed-room.md`, an old `## Bucata 1` piece that names `src/room.ts` in its Where
but quotes other code, with no plan beside it. `why src/room.ts:3` shows under the second commit the doc,
the green piece's heading, its What, the red piece's Why and the plan's Goal (its first paragraph only), and
nothing under the first commit; `why src/room.ts:1` shows the Bucata piece marked as found by its Where,
with its paragraph and no Goal.
Why: decision 2 of the plan, each fallback in one fixture: the piece by its code (the case of 20 lines in
30), by its Where (5 in 30), an old piece without fields, a green piece's reason in the red one (measure 5),
no doc at all (the June code).
Where: `scripts/logicmap.test.ts` (`describe('why')`)
```ts
  test('each commit with its piece: by its code, else by its Where; a short Why with the one before; the goal', () => {
    const roomLines = ['const room = new Map()', 'export const joinRoom = () => {', '  return room.size', '}', '']
    const repoRoot = createFixtureRepo({ 'src/room.ts': roomLines.join('\n') })
    const writeRoom = (): void => writeFixtureFiles(repoRoot, { 'src/room.ts': roomLines.join('\n') })
    commitFixtureRepo(repoRoot, 'wip: the room')
    roomLines[2] = '  return room.size + 1'
    writeRoom()
    writeFixtureFiles(repoRoot, {
      'plans/05-room-counts/00-plan.md': [
        '# The room counts its joiner',
        '',
        '## Goal',
        '',
        'Mihai, 2026-11-02: "count the joiner too"',
        '',
        'Done when a room of one says 1.',
        '',
      ].join('\n'),
      'plans/05-room-counts/01-the-count.md': [
        '# Step 1: the count',
        '',
        '## Piece 1: red, a room of one says 1',
        'What: a test joins once and expects a size of 1.',
        'Why: the size is read before the joiner is added,',
        '  so a room of one says 0.',
        'Where: `src/room.test.ts`',
        '```ts',
        'expect(joinRoom()).toBe(1)',
        '```',
        '',
        '## Piece 2: green, joinRoom counts the joiner',
        'What:',
        'joinRoom returns the size plus the joiner.',
        'Why:',
        'Where: `src/room.ts:3`',
        '```ts',
        '  return room.size + 1',
        '```',
        '',
      ].join('\n'),
    })
    commitFixtureRepo(repoRoot, 'wip: the joiner counted')
    roomLines[0] = 'const room = new Map<string, number>()'
    writeRoom()
    writeFixtureFiles(repoRoot, {
      'notes/typed-room.md': [
        '## Bucata 1: the room is typed',
        'A wrong key fails to compile.',
        'Where: `src/room.ts`',
        '```ts',
        'type RoomKey = string',
        '```',
        '',
      ].join('\n'),
    })
    commitFixtureRepo(repoRoot, 'wip: the room typed')

    const countWhy = whyLogicMap(repoRoot, 'src/room.ts:3')
    expect(countWhy).toContain(
      [
        '  plans/05-room-counts/01-the-count.md',
        '  ## Piece 2: green, joinRoom counts the joiner',
        '  What: joinRoom returns the size plus the joiner.',
        '  Why (Piece 1): the size is read before the joiner is added, so a room of one says 0.',
        '  Goal (plans/05-room-counts/00-plan.md): Mihai, 2026-11-02: "count the joiner too"',
      ].join('\n'),
    )
    expect(countWhy).not.toContain('Done when')
    expect(countWhy.trimEnd().endsWith('wip: the room')).toBe(true)

    const typedWhy = whyLogicMap(repoRoot, 'src/room.ts:1')
    expect(typedWhy).toContain(
      [
        '  notes/typed-room.md',
        '  ## Bucata 1: the room is typed  (names the file; holds none of these lines)',
        '  A wrong key fails to compile.',
      ].join('\n'),
    )
    expect(typedWhy).not.toContain('Goal')
  })
```
Run: red (`(fail) why > each commit with its piece ...`: no line under any commit).

## Piece 2: the piece, its task's goal, under each commit
What: `describeCommitReason` lists the `.md` files the commit holds outside `logicmap/` (deletions left out).
`findRecordedPiece` keeps those with a `## Piece` or `## Bucata` heading (one `git grep -l` at the commit),
splits each into pieces and scores each by how many of the lines the commit added around the traced lines it
holds: the `+` lines `git log -L` shows and the commit's other hunks meeting them (`git show -U0`), trimmed,
12 characters or more. The best wins; with none, the first piece whose Where names the file. `findTaskGoal`
reads the `## Goal` of the `00-plan.md` beside the piece's doc (or beside any doc of the commit), its first
paragraph, cut at 400 characters. `describePiece` prints the doc, the heading (marked when found by its
Where), What, Why, the paragraph of an old piece with neither, and the reason of the piece before when this
one's is under 40 characters.
Why: decision 2 and 3. One field's text runs to a blank line, a code fence or the next field, so `Why:` with
its text below it (measure 5) reads the same as on one line.
Where: `scripts/logicmap.ts` (the section "Why": `listRecordedPieces`, `readPieceField`,
`readPieceParagraph`, `listAddedLinesAround`, `findRecordedPiece`, `findTaskGoal`, `describePiece`,
`describeCommitReason`; `whyLogicMap` prints them under each commit)
```ts
  const scoredPieces = pieceDocPaths.flatMap((docPath) => {
    const pieces = listRecordedPieces(runGitOrEmpty(repoRoot, ['show', `${commit.hash}:${docPath}`]))
    return pieces.map((piece, pieceIndex) => ({
      docPath,
      piece,
      previousPiece: pieces[pieceIndex - 1],
      matchedLineCount: addedLines.filter((addedLine) => piece.text.includes(addedLine)).length,
    }))
  })
```
Run: 34 pass; strict tsc and biome clean. On teamabled, `why src/teams/merge-direct-groups.ts:459` gives
question 1's recorded reason (TODO 109, Piece 2) and under TODO 108 its Piece 3, in 0.17 s;
`why web/src/pages/DocumentEditorPage.tsx:958-966`, 10 commits, 1.3 s, 14 KB. That run is revision 1: 7 of
its 10 commits fell back to the first piece naming the file, and the squash `9636d652` matched a mapping
doc's piece.

## Piece 3: the piece naming the file, the nearest Where (the failing test, revision 1)
What: a test: `src/room.ts` of 30 lines; a commit changes line 20 and holds `notes/map.md`, a Bucata quoting
the new line with no Where, and a step doc whose Piece 3 quotes it with `Where: src/room.ts:5`; another commit
changes line 25 and holds a step doc whose Piece 1 names `src/room.ts:2` and Piece 2 `src/room.ts:24-26, 40`,
neither quoting it. `why src/room.ts:20` shows Piece 3; `why src/room.ts:25` shows Piece 2, marked as found
by its Where.
Why: revision 1, the two cases the teamabled run showed: a doc that quotes code it didn't write, and several
pieces of one task naming the file.
Where: `scripts/logicmap.test.ts` (`describe('why')`)
```ts
  test('of the pieces holding the code, one naming the file; of those naming it, the nearest Where', () => {
    const roomLines = [...Array.from({ length: 30 }, (_, lineIndex) => `const line${lineIndex + 1} = ${lineIndex + 1}`), '']
    const repoRoot = createFixtureRepo({ 'src/room.ts': roomLines.join('\n') })
    const writeRoom = (): void => writeFixtureFiles(repoRoot, { 'src/room.ts': roomLines.join('\n') })
    commitFixtureRepo(repoRoot, 'wip: the room')
    roomLines[19] = "const line20 = 'twenty'"
    writeRoom()
    writeFixtureFiles(repoRoot, {
      'notes/map.md': ['## Bucata 1: the anchors', '```ts', "const line20 = 'twenty'", '```', ''].join('\n'),
      'plans/07-words/01-twenty.md': [
        '## Piece 3: line twenty says its word',
        'Why: a number reads as a count.',
        'Where: `src/room.ts:5`',
        '```ts',
        "const line20 = 'twenty'",
        '```',
        '',
      ].join('\n'),
    })
    commitFixtureRepo(repoRoot, 'wip: twenty')
    roomLines[24] = "const line25 = 'twenty-five'"
    writeRoom()
    writeFixtureFiles(repoRoot, {
      'plans/08-more-words/01-the-rest.md': [
        '## Piece 1: the top',
        'Where: `src/room.ts:2`',
        '',
        '## Piece 2: the lines around twenty-five',
        'Where: `src/room.ts:24-26, 40`',
        '',
      ].join('\n'),
    })
    commitFixtureRepo(repoRoot, 'wip: twenty-five')

    expect(whyLogicMap(repoRoot, 'src/room.ts:20')).toContain(
      '  plans/07-words/01-twenty.md\n  ## Piece 3: line twenty says its word\n',
    )
    expect(whyLogicMap(repoRoot, 'src/room.ts:25')).toContain(
      '  ## Piece 2: the lines around twenty-five  (names the file; holds none of these lines)',
    )
  })
```
Run: red (`why src/room.ts:20` showed `notes/map.md`'s Bucata, the first doc in git's order; `:25` showed
Piece 1).

## Piece 4: the ranking
What: each scored piece also records whether its Where names the file and the distance from its Where's line
ranges for the file (`file.ts:40-60, 90`, parsed by `listWhereLineRanges`) to the traced lines at the
commit. The pieces holding code or naming the file are sorted by: holding code, naming the file, the lines
held, the nearest Where; the first wins, marked found by its Where when it holds no code.
Why: revision 1. One sort keeps the order of preference in one place; a tie keeps the docs' order, as git
lists them.
Where: `scripts/logicmap.ts` (`WHERE_LINES_PATTERN`, `listWhereLineRanges`, `lineDistance`,
`listAddedLinesAround` takes the traced lines, `findRecordedPiece`)
```ts
  const [bestPiece] = scoredPieces
    .filter((scoredPiece) => scoredPiece.matchedLineCount > 0 || scoredPiece.isNamingTheFile)
    .sort(
      (first, second) =>
        Number(second.matchedLineCount > 0) - Number(first.matchedLineCount > 0) ||
        Number(second.isNamingTheFile) - Number(first.isNamingTheFile) ||
        second.matchedLineCount - first.matchedLineCount ||
        first.whereLineDistance - second.whereLineDistance,
    )
```
Run: 35 pass; strict tsc and biome clean. On teamabled the acceptance questions 2 to 6 show the recorded
piece; question 7 (`DocumentEditorPage.tsx:958-966`) shows under `ff197cb8` its Piece 6, green, whose own
Why is long, so the red Piece 5 that holds the recorded reason (D2) wasn't shown.

## Piece 5: a green piece shows the red one's Why (the failing test)
What: the fixture's green Piece 2 gets a Why of its own, over 40 characters; the expected output keeps the
red Piece 1's Why after it.
Why: teamabled's CLAUDE.md makes the failing test its own piece and the code that passes it the next one, so
the reason of a green piece is first of all the red one's; question 7.
Where: `scripts/logicmap.test.ts` (the second test of `describe('why')`)
```ts
        'Why: the smallest change that passes; a counter kept beside the map was rejected.',
```
Run: red (the output had no `Why (Piece 1)` line after the green piece's own Why).

## Piece 6: a piece headed green brings the reason of the piece before it
What: `describePiece` adds the previous piece's reason when the heading says `green`, as it does when the
piece's own reason is under 40 characters.
Why: piece 5.
Where: `scripts/logicmap.ts` (`describePiece`)
```ts
  const isGreenPiece = /\bgreen\b/.test(piece.heading)
  const isReasonShort = (why || paragraph).length < SHORT_REASON_LENGTH
  const previousReason =
    (isGreenPiece || isReasonShort) && previousPiece !== undefined
      ? readPieceReason(previousPiece)
      : ''
```
Run: 35 pass; strict tsc and biome clean. Question 7 on teamabled: under `ff197cb8`, Piece 6 then
`Why (Piece 5): D2, "open pages show a notice until dismissed and nobody is moved off the text they read"`.
