# Step 3: the rules over the lines

## Piece 1: the rules first (the failing test)
What: a test: an edge anchored over an `if` block, its entry, acked and committed. `why` on a line of the
block shows, before the commits, the rule's line as `show <file>` prints it, then its `why:`, then its site;
`why` on the line after the block names no rule.
Why: what must hold now is the entry; the pieces say why the code was written as of their commits. An agent
that reads the rule first reads the pieces against it.
Where: `scripts/logicmap.test.ts` (`describe('why')`)
```ts
  test("an anchored line's why starts with the rules covering it, each with its claim and its why", () => {
    const repoRoot = createFixtureRepo({
      'src/room.ts': [
        'export const joinSocket = () => {',
        '  // §edge sync.close-during-join@1',
        '  if (closedEarly) {',
        '    joined.removeConnection(connection)',
        '  }',
        '  flushPending()',
        '}',
        '',
      ].join('\n'),
      'logicmap/sync.md': closeDuringJoinEntry(1),
    })
    ackIds(repoRoot, ['sync.close-during-join'])
    commitFixtureRepo(repoRoot, 'wip: the join')

    const removalWhy = whyLogicMap(repoRoot, 'src/room.ts:4')
    expect(removalWhy).toContain(
      [
        'sync.close-during-join@1  edge  recorded  The socket can close while the join is loading.',
        '  why: The join adds the connection before it resolves.',
        '  2-5  §edge  ok',
      ].join('\n'),
    )
    expect(removalWhy.indexOf('sync.close-during-join@1')).toBeLessThan(
      removalWhy.indexOf('wip: the join'),
    )
    expect(whyLogicMap(repoRoot, 'src/room.ts:6')).not.toContain('sync.close-during-join')
  })
```
Run: red (no rule line in the output).

## Piece 2: `LedgerEntry.why`; the rules above the history
What: the parsed entry keeps its `why:`. `listRulesWithTheirWhy` takes `show`'s sections for the lines and
puts each entry's why under its rule line. The body of `whyLogicMap` moves into `describeLinesHistory`,
which returns the summary line (with the uncommitted note) apart from the commits, so the rules sit between
them, and show even for lines not committed yet.
Why: piece 1. A rule over an uncommitted line still says what must hold while it's written.
Where: `scripts/logicmap.ts` (`LedgerEntry`, `parseEntry`, `listRulesWithTheirWhy`, `describeLinesHistory`,
`whyLogicMap`)
```ts
  const ruleLines = listRulesWithTheirWhy(repoRoot, file, lines)
  const rulesSection =
    ruleLines.length === 0 ? [] : ['', 'rules covering these lines (show <id>: one in full):', ...ruleLines]
  const { summaryLines, commitLines } = describeLinesHistory(repoRoot, file, lines)
  const commitSection = commitLines.length === 0 ? [] : ['', ...commitLines]
  return [...summaryLines, ...rulesSection, ...commitSection].join('\n')
```
Run: 36 pass; strict tsc and biome clean. Questions 9 and 10 on teamabled: `sync-provider.ts:243` shows
`sync.socket-delivers-arraybuffers` (inferred) with its why above the June commit; `doc-store.ts:38-48` shows
`sync.load-before-listening` above three commits, the newest TODO 95's Piece 2 (the snapshot and the log read
in one statement). Question 8's line, `doc-room.ts:126`, is covered only by `sync.open-document`'s step 4: the
load-before-listening anchor sits over `loadDoc` in `doc-store.ts`.
