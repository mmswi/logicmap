# Step 7: `bump` writes one history line, into its own entry

## Piece 1: red, a reason with a newline, and an empty one
What: a test in `describe('bump')`: an empty reason is refused and the ledger stays as it was; a reason holding a newline and `version: 9` is written as one history line, and the version is 2.
Why: `bump` wrote the reason as typed. The ledger parser reads a line at column 0 as a field, and a later field overrides an earlier one, so `version: 9` in a reason became the entry's version, and a `why:` line its why. An empty reason wrote `- @2: `, a history line that says nothing.
Where: scripts/logicmap.test.ts, after the bump test
```ts
  test('a bump reason is written on one history line; an empty reason is refused', () => {
    const repoRoot = createFixtureRepo({
      'src/room.ts': ['// §edge sync.close-during-join@1', 'if (closedEarly) {', '}', ''].join(
        '\n',
      ),
      'logicmap/sync.md': closeDuringJoinEntry(1),
    })
    ackIds(repoRoot, ['sync.close-during-join'])

    const ledgerTextBeforeRefusal = readFixtureFile(repoRoot, 'logicmap/sync.md')
    expect(bumpId(repoRoot, 'sync.close-during-join', ' \n ')).toEqual({
      isBumped: false,
      report: 'a bump says what changed: logicmap bump <id> <what changed>',
    })
    expect(readFixtureFile(repoRoot, 'logicmap/sync.md')).toBe(ledgerTextBeforeRefusal)

    bumpId(repoRoot, 'sync.close-during-join', 'the join is undone\nversion: 9')
    expect(readFixtureFile(repoRoot, 'logicmap/sync.md')).toBe(
      [
        '## sync.close-during-join',
        'kind: edge',
        'version: 2',
        'what: The socket can close while the join is loading.',
        'why: The join adds the connection before it resolves.',
        'source: fixture',
        'history:',
        '- @2: the join is undone version: 9',
        '',
      ].join('\n'),
    )
  })
```
Run, red: `bumpId(repoRoot, 'sync.close-during-join', ' \n ')` returned `isBumped: true` and wrote the version; `(fail) bump > a bump reason is written on one history line…`.

## Piece 2: green, the reason collapsed to one line, an empty one refused
What: `bumpId` collapses the reason's whitespace with the existing `collapseWhitespace` and refuses an empty result before it reads anything else.
Why: a history line is one line by the ledger's grammar, and a line break is the only way a reason can reach column 0. Refused first, so a refusal writes nothing.
Where: scripts/logicmap.ts:1592
```diff
 export const bumpId = (repoRoot: string, id: string, whatChanged: string): BumpOutcome => {
+  const historyReason = collapseWhitespace(whatChanged)
+  if (historyReason === '') {
+    return { isBumped: false, report: 'a bump says what changed: logicmap bump <id> <what changed>' }
+  }
   const { anchors, entriesById } = analyzeRepo(repoRoot)
 // ...unchanged...
-  const newHistoryLine = `- @${nextVersion}: ${whatChanged}`
+  const newHistoryLine = `- @${nextVersion}: ${historyReason}`
```
Run, green: `bun test -t bump`, `3 pass, 0 fail`.
biome wrapped the refusal's object over four lines; the code is the same.
