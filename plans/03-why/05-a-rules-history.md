# Step 5: a rule's history

## Piece 1: `why <id>` (the failing test)
What: a test: an entry committed with a step doc whose piece names its id; then the entry bumped to @2 with a
`history:` line, committed with two docs, the first a piece about something else. `why sync.close-during-join`
prints the rule's line as `show` does, its why and its history, then the entry's lines in its ledger file and
their two commits, each with the piece naming the id (the second commit's found though it holds none of the
entry's lines, its doc listed after the other one). An id the map lacks says what `why` takes.
Why: `history:` says what changed in a few words; the commits that changed the entry hold the pieces that say
why, written when the meaning changed. Matching a ledger commit's pieces by their Where would miss them: a piece
names the id far more often than `logicmap/<domain>.md`.
Where: `scripts/logicmap.test.ts` (`describe('why')`)
```ts
  test("a rule's why: its entry, its history, then each commit of its entry with the piece naming it", () => {
    const syncLedgerLines = [
      '# sync',
      'The rooms.',
      '',
      '## sync.close-during-join',
      'kind: edge',
      'version: 1',
      'what: The socket can close while the join is loading.',
      'why: The join adds the connection before it resolves.',
      'source: fixture',
      'history:',
      '- @1: introduced',
      '',
    ]
    const repoRoot = createFixtureRepo({
      'logicmap/sync.md': syncLedgerLines.join('\n'),
      'plans/01-the-join/01-the-edge.md': [
        '## Piece 1: the edge mapped',
        'What: `sync.close-during-join`, the entry and its anchor.',
        'Why: a socket closed during the join stayed in the room.',
        '',
      ].join('\n'),
    })
    commitFixtureRepo(repoRoot, 'wip: the join mapped')
    syncLedgerLines.splice(5, 1, 'version: 2')
    syncLedgerLines.splice(11, 0, '- @2: the join removes a socket closed meanwhile')
    writeFixtureFiles(repoRoot, {
      'logicmap/sync.md': syncLedgerLines.join('\n'),
      'plans/02-other/01-other.md': ['## Piece 1: another change', 'What: nothing about the join.', ''].join(
        '\n',
      ),
      'plans/03-the-removal/01-the-removal.md': [
        '## Piece 1: the join removes a socket closed meanwhile',
        'What: `sync.close-during-join` bumped to @2.',
        'Why: the room kept a socket the join had already lost.',
        '',
      ].join('\n'),
    })
    commitFixtureRepo(repoRoot, 'wip: the removal')

    const ruleWhy = whyLogicMap(repoRoot, 'sync.close-during-join')
    expect(ruleWhy).toStartWith(
      [
        'sync.close-during-join@2  edge  recorded  The socket can close while the join is loading.',
        '  why: The join adds the connection before it resolves.',
        '  history:',
        '  - @1: introduced',
        '  - @2: the join removes a socket closed meanwhile',
        '',
        'logicmap/sync.md:4-12 (the entry): 2 commits, newest first',
      ].join('\n'),
    )
    expect(ruleWhy).toContain(
      [
        'wip: the removal',
        '  plans/03-the-removal/01-the-removal.md',
        '  ## Piece 1: the join removes a socket closed meanwhile  (names the rule; holds none of these lines)',
      ].join('\n'),
    )
    expect(ruleWhy).toContain(
      ['wip: the join mapped', '  plans/01-the-join/01-the-edge.md', '  ## Piece 1: the edge mapped'].join(
        '\n',
      ),
    )
    expect(whyLogicMap(repoRoot, 'sync.nope')).toBe(
      'sync.nope is neither a rule of logicmap/ nor <file>:<line>[-<line>] or <file>:<name>',
    )
  })
```
Run: red (`sync.close-during-join is neither …` did not exist yet: the output was `why takes …`).

## Piece 2: `explainRule`; the piece naming the rule
What: `whyLogicMap` takes an id the map holds, after the two file targets. `explainRule` prints the rule's line
as `show` does, `why:`, and the `history:` field's lines up to the next field, then `describeLinesHistory` over
the entry's lines in its ledger file (the heading to the last line of its text). `ruleId` goes down to
`findRecordedPiece`, where a piece names the target when its text holds the id (for lines, when its Where holds
the file); the note under the heading says "names the rule".
Why: piece 1. One lookup for both targets keeps the ranking in one place: a piece quoting the entry's lines
still comes first, then one naming the id.
Where: `scripts/logicmap.ts` (`findRecordedPiece`, `describePiece`, `describeCommitReason`,
`describeLinesHistory`, `explainRule`, `whyLogicMap`)
```ts
        isNamingTheTarget:
          ruleId === null
            ? fileNames.some((fileName) => whereText.includes(fileName))
            : piece.text.includes(ruleId),
```
Run: 38 pass; strict tsc and biome clean. On teamabled `why documents.objection-holds-the-round` (0.6 s) shows
its two history lines and three commits: `9416d2c5` (F43 task 19's Piece 5, the map), `90752941` (task 09: the
goal only, since only its plan names the id) and `8c48378f`, from 10-29, before the rule existed: its only
change in the range is the blank line inside the entry's history (revision 3).

## Piece 3: a blank-line commit left out (the failing test, revision 3)
What: a test: a function committed, then a blank line added inside it. `why src/room.ts:joinRoom` lists the
first commit and counts the second on its first line.
Why: revision 3. The count keeps the history whole: `git log -L` still lists every commit.
Where: `scripts/logicmap.test.ts` (`describe('why')`)
```ts
  test('a commit that only added or removed blank lines among the lines is left out, and counted', () => {
    const roomLines = [
      'export const joinRoom = () => {',
      '  const size = room.size',
      '  return size',
      '}',
      '',
    ]
    const repoRoot = createFixtureRepo({ 'src/room.ts': roomLines.join('\n') })
    commitFixtureRepo(repoRoot, 'wip: the room')
    roomLines.splice(2, 0, '')
    writeFixtureFiles(repoRoot, { 'src/room.ts': roomLines.join('\n') })
    commitFixtureRepo(repoRoot, 'wip: a blank line')

    const joinWhy = whyLogicMap(repoRoot, 'src/room.ts:joinRoom')
    expect(joinWhy).toStartWith(
      'src/room.ts:joinRoom (1-5): 1 commit, newest first; 1 more only added or removed blank lines',
    )
    expect(joinWhy).toContain('wip: the room')
    expect(joinWhy).not.toContain('wip: a blank line')
  })
```
Run: red (`2 commits, newest first`, `wip: a blank line` listed).

## Piece 4: the filter
What: `isBlankLinesOnlyCommit` reads the lines past the first hunk header of the commit's traced diff; a commit
whose added and removed lines are all blank is left out of the list, and the first line counts it.
Why: piece 3.
Where: `scripts/logicmap.ts` (`isBlankLinesOnlyCommit`, `describeLinesHistory`)
```ts
  const explainingCommits = commits.filter((commit) => !isBlankLinesOnlyCommit(commit))
  const blankLinesOnlyCount = commits.length - explainingCommits.length
```
Run: 39 pass; strict tsc and biome clean. On teamabled: `why documents.objection-holds-the-round` now reads
"2 commits, newest first; 1 more only added or removed blank lines"; `DocumentEditorPage.tsx:958-966` keeps its 10.
