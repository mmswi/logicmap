# Step 1: `find <words>`

Before: `bun test` 57 pass.

## Piece 1: the failing test
What: `describe('find')`: three active rules and a retired one. A word of an id finds it; a word only a `why`
holds finds its rule; two words must both hold; the case is ignored; the rule whose id holds the word comes before
the one whose `why` does, against the alphabet; the retired rule is never listed; 32 rules holding a word print 30
and count 2.
Why: plan, decision 1.
Where: `scripts/logicmap.test.ts`, after `describe('show')`
```ts
describe('find', () => {
  test("the rules whose id or entry hold every word, an id's hit first; a retired rule never; over thirty, the rest counted", () => {
    const repoRoot = createFixtureRepo({
      'src/room.ts': [
        '// §edge sync.close-during-join@1',
        'if (closedEarly) {',
        '}',
        '// §edge sync.pooled-buffer-slice@1',
        'const messageBytes = slice',
        '// §decision sync.a-copy-before-reuse@1',
        'const copiedBytes = copy(messageBytes)',
        '',
      ].join('\n'),
      'logicmap/sync.md': [
        closeDuringJoinEntry(1),
        pooledBufferSliceEntry,
        '## sync.a-copy-before-reuse',
        'kind: decision',
        'version: 1',
        'what: The bytes are copied before the next message is read.',
        'why: ws reuses the pooled memory.',
        'source: inferred — fixture',
        '',
        '## sync.old-pooled-rule',
        'kind: decision',
        'version: 1',
        'status: retired',
        'what: An old pooled rule.',
        'why: fixture.',
        'source: fixture',
        '',
      ].join('\n'),
    })
    ackIds(repoRoot, [
      'sync.close-during-join',
      'sync.pooled-buffer-slice',
      'sync.a-copy-before-reuse',
      'sync.old-pooled-rule',
    ])
    const closeDuringJoinLine =
      'sync.close-during-join@1  edge  untested  recorded  The socket can close while the join is loading.  (sites: 1)'
    const pooledBufferSliceLine =
      'sync.pooled-buffer-slice@1  edge  untested  recorded  ws may hand a message over as a slice of a pooled buffer.  (sites: 1)'
    const copyBeforeReuseLine =
      'sync.a-copy-before-reuse@1  decision  ok  inferred  The bytes are copied before the next message is read.  (sites: 1)'

    expect(findInLogicMap(repoRoot, ['during'])).toBe(closeDuringJoinLine)
    expect(findInLogicMap(repoRoot, ['decoder'])).toBe(pooledBufferSliceLine)
    expect(findInLogicMap(repoRoot, ['SOCKET', 'Loading'])).toBe(closeDuringJoinLine)
    expect(findInLogicMap(repoRoot, ['pooled'])).toBe(
      [pooledBufferSliceLine, copyBeforeReuseLine].join('\n'),
    )
    expect(findInLogicMap(repoRoot, ['socket', 'decoder'])).toBe(
      'no rule holds every word of: socket decoder',
    )

    writeFixtureFiles(repoRoot, {
      'logicmap/queue.md': Array.from({ length: 32 }, (_, ruleIndex) =>
        [
          `## queue.zebra-rule-${String(ruleIndex + 1).padStart(2, '0')}`,
          'kind: decision',
          'version: 1',
          'what: A rule.',
          'why: fixture.',
          'source: fixture',
          '',
        ].join('\n'),
      ).join('\n'),
    })
    const zebraLines = findInLogicMap(repoRoot, ['zebra']).split('\n')
    expect(zebraLines).toHaveLength(31)
    expect(zebraLines[0]).toStartWith('queue.zebra-rule-01@1  decision')
    expect(zebraLines[30]).toBe('... and 2 more rules: add a word to narrow them')
  })
})
```
Run (red): `bun test -t "the rules whose id or entry hold every word"`: 0 pass, 1 fail, `Export named
'findInLogicMap' not found`.

## Piece 2: the rules holding every word
What: in `createShowViews`, `describeRuleWithClaim(entry)` is the line `show <domain>` prints for a rule, taken out
of `showOneDomain` so `find` prints the same; `findRules(words)` keeps the active entries whose text (the heading
with the id, and every field) holds every word, orders them by where the words were found, prints 30 and counts the
rest. `findInLogicMap` exports it; the command line gains `find <word>...`, its words split on spaces so
`find "close join"` and `find close join` are one search.
Why: plan, decision 1. A word in the id outweighs any number in the claim: the id is the rule's name.
Where: `scripts/logicmap.ts`: `createShowViews` (after `showOneDomain`), after `showLogicMap`, `USAGE`,
`runCommandLine`
```ts
  const describeRuleWithClaim = (entry: LedgerEntry): string => {
    const siteCount = analysis.anchors.filter((anchor) => anchor.id === entry.id).length
    return `${entry.id}@${entry.version ?? '?'}  ${entry.kind ?? '?'}  ${entryStatusOf(entry)}  ${entry.provenance}  ${entry.claim}  (sites: ${siteCount})`
  }

  // The active rules whose id or entry hold every word, case ignored: a word in the id first, then in the claim.
  const findRules = (words: string[]): string => {
    const searchedWords = words.map((word) => word.toLowerCase())
    const countWordsHeldBy = (text: string): number => {
      const lowerCaseText = text.toLowerCase()
      return searchedWords.filter((searchedWord) => lowerCaseText.includes(searchedWord)).length
    }
    const foundEntries = [...analysis.entriesById.values()]
      .filter(
        (entry) =>
          entry.status === ENTRY_STATUSES.active &&
          countWordsHeldBy(entry.text) === searchedWords.length,
      )
      .map((entry) => ({
        entry,
        relevance:
          countWordsHeldBy(entry.id) * (searchedWords.length + 1) + countWordsHeldBy(entry.claim),
      }))
      .sort(
        (first, second) =>
          second.relevance - first.relevance || first.entry.id.localeCompare(second.entry.id),
      )
    if (foundEntries.length === 0) {
      return `no rule holds every word of: ${words.join(' ')}`
    }
    const ruleLines = foundEntries
      .slice(0, FIND_MAX_RULES)
      .map(({ entry }) => describeRuleWithClaim(entry))
    const leftOutCount = foundEntries.length - ruleLines.length
    const leftOutLines =
      leftOutCount === 0
        ? []
        : [`... and ${countOf(leftOutCount, 'more rule')}: add a word to narrow them`]
    return [...ruleLines, ...leftOutLines].join('\n')
  }
```
```ts
export const findInLogicMap = (repoRoot: string, words: string[]): string =>
  createShowViews(repoRoot).findRules(words)
```
```diff
+  if (command === 'find' && commandArguments.length > 0) {
+    const words = commandArguments.flatMap((typedWords) => typedWords.split(/\s+/)).filter(Boolean)
+    console.log(findInLogicMap(repoRoot, words))
+    return 0
+  }
```
Run: the first green run failed on the test's own lines: an `edge` no test proves has the status `untested`, not
`ok`; the two expected lines say so now. `bun test`: 58 pass, 0 fail.
