# Step 9: `find` with no word

## Piece 1: red, an empty search
What: a test in `describe('find')`: `findInLogicMap(repoRoot, [])` asks for a word.
Why: `find ""` reaches `findRules` with no word, and every rule holds every one of no words, so it listed the first 30 rules and told the agent to add a word to narrow them (data reviewer, a suggestion).
Where: scripts/logicmap.test.ts, after the find test
```ts
  test('a find with no word asks for one', () => {
    const repoRoot = createFixtureRepo({
      'src/room.ts': ['// §edge sync.close-during-join@1', 'if (closedEarly) {', '}', ''].join(
        '\n',
      ),
      'logicmap/sync.md': closeDuringJoinEntry(1),
    })
    expect(findInLogicMap(repoRoot, [])).toBe('find needs a word: logicmap find <word>...')
  })
```
Run, red: `(fail) find > a find with no word asks for one`: it returned the rule list.

## Piece 2: green, findRules with no word
What: `findRules` answers an empty word list with the line asking for a word.
Why: the CLI already splits and filters the typed words, so `find ""` and `find " "` both arrive here with none.
Where: scripts/logicmap.ts:1456
```diff
   const findRules = (words: string[]): string => {
+    if (words.length === 0) {
+      return 'find needs a word: logicmap find <word>...'
+    }
     const searchedWords = words.map((word) => word.toLowerCase())
```
Run, green: `bun test -t find`, `3 pass, 0 fail`.
