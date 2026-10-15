# Step 1: the claim first, `long-what`

## Piece 1: test — a long first sentence warns, detail after a short claim does not

What: three decision entries in one fixture: a `what` that is one sentence of about 240 characters, a
`what` that opens with a short claim and continues with that same long sentence, and a retired entry
with the long sentence. Only the first warns, at its `what:` line (line 4).
Why: the claim is what `show` lists for each rule, so it has to fit on a line; detail after it is
allowed; a retired rule is not read on a cold start, so nobody needs to rewrite it.
Where: `scripts/logicmap.test.ts`, a new `describe('claims')` at the end.

```ts
describe('claims', () => {
  test('a what that opens with a sentence over 200 characters warns long-what; detail after a short claim does not', () => {
    const longFirstSentence = `The socket can close while the join is loading${', and the room keeps it'.repeat(8)}.`
    const shortClaimThenDetail = `The socket can close while the join is loading. ${longFirstSentence}`
    const decisionEntry = (id: string, what: string, statusLines: string[]): string =>
      [`## ${id}`, 'kind: decision', 'version: 1', ...statusLines, `what: ${what}`, 'why: fixture.', 'source: fixture', ''].join('\n')
    const repoRoot = createFixtureRepo({
      'src/room.ts': [
        '// §decision sync.long-claim@1',
        'const first = 1',
        '// §decision sync.short-claim@1',
        'const second = 2',
        '',
      ].join('\n'),
      'logicmap/sync.md': [
        decisionEntry('sync.long-claim', longFirstSentence, []),
        decisionEntry('sync.short-claim', shortClaimThenDetail, []),
        decisionEntry('sync.retired-claim', longFirstSentence, ['status: retired']),
      ].join('\n'),
    })

    expect(describeWarnings(repoRoot)).toEqual(['long-what logicmap/sync.md:4'])
  })
})
```

Red:

```
- [
-   "long-what logicmap/sync.md:4",
- ]
+ []
(fail) claims > a what that opens with a sentence over 200 characters warns long-what; ...
 17 pass
 1 fail
```

## Piece 2: the warning, and each entry's claim

What: `claimOf` takes the first sentence of `what`; `parseEntry` warns `long-what` when an active
entry's claim is over 200 characters; `LedgerEntry` keeps the claim for the views of step 2.
Why: a sentence ends at `.`, `!` or `?` before a capital letter or the end of the text, so `e.g.`,
`req.ip` and `1.15` do not end it. 200 characters keep a `show <domain>` line readable.
Where: `scripts/logicmap.ts`: `PROBLEM_CODES`, `LedgerEntry`, above `isEntryFieldName`, the end of
`parseEntry`.

```diff
   untested: 'untested',
+  longWhat: 'long-what',
 } as const
 // ...unchanged...
   provenance: EntryProvenance
   what: string
+  claim: string
 // ...unchanged...
+// The claim is the first sentence of what; the detail of the rule may follow it.
+const CLAIM_MAX_LENGTH = 200
+// A sentence ends at . ! or ? before a capital letter or the end, so "e.g." and "1.15" do not end it.
+const FIRST_SENTENCE_PATTERN = /^.+?[.!?](?=\s+[A-Z]|\s*$)/
+const claimOf = (what: string): string => FIRST_SENTENCE_PATTERN.exec(what)?.[0] ?? what
+
 const isEntryFieldName = (fieldName: string | undefined): fieldName is EntryFieldName =>
 // ...unchanged, at the end of parseEntry...
   const what = fieldByName.get('what')?.text ?? ''
+  const claim = claimOf(what)
+  const isLongClaim = status === ENTRY_STATUSES.active && claim.length > CLAIM_MAX_LENGTH
+  if (isLongClaim) {
+    const whatLine = fieldByName.get('what')?.line ?? entryBlock.line
+    const message = `${id}'s what opens with a ${claim.length}-character sentence: put the claim first, in at most ${CLAIM_MAX_LENGTH} characters, and the detail after it`
+    problems.push(warningAt(PROBLEM_CODES.longWhat, { file, line: whatLine }, id, message))
+  }
   const text = entryBlock.lines.join('\n').trimEnd()
 // ...unchanged...
       what,
+      claim,
       steps,
```

Green: 18 pass, 0 fail.
