# Step 1: The span continues past a closing line

Before: `bun test` 51 pass.

## Piece 1: the failing test
What: a test in `describe('lock')`: an anchor above an arrow function whose parameters close on `}): void =>`, its
body on the next line, deeper; and one above a call whose chained `.then(...)` follows its `})`. An edit of the body,
then of the chained call, is `changed`; an edit of the statement after them is not.
Why: today both edits read as nothing, so the line that sends the frame changes with no ack asked (plan, goal).
Where: `scripts/logicmap.test.ts`, after 'the fingerprint covers the anchored block: an edit inside it is a change,
past it is not'
```ts
  test('a statement continued past its closing line stays covered: an arrow body after }): T =>, a chained call', () => {
    const liveLines = [
      '// §edge sync.close-during-join@1',
      'export const signalDeleted = (input: {',
      '  teamId: string',
      '}): void =>',
      '  pushToUsers(input.teamId)',
      '',
      '// §edge sync.pooled-buffer-slice@1',
      'loadRoom({',
      '  id,',
      '})',
      '  .then(joinRoom)',
      'flushPending()',
      '',
    ]
    const repoRoot = createFixtureRepo({
      'src/live.ts': liveLines.join('\n'),
      'logicmap/sync.md': `${closeDuringJoinEntry(1)}\n${pooledBufferSliceEntry}`,
    })
    ackIds(repoRoot, ['sync.close-during-join', 'sync.pooled-buffer-slice'])
    const replaceLiveLine = (lineIndex: number, replacementLine: string): void => {
      liveLines[lineIndex] = replacementLine
      writeFixtureFiles(repoRoot, { 'src/live.ts': liveLines.join('\n') })
    }

    replaceLiveLine(11, 'flushPendingMessages()')
    expect(describeLockProblems(repoRoot)).toEqual([])

    replaceLiveLine(4, '  pushToUsers(input.teamId, true)')
    expect(describeLockProblems(repoRoot)).toEqual(['changed src/live.ts:1'])

    replaceLiveLine(10, '  .then(leaveRoom, true)')
    expect(describeLockProblems(repoRoot)).toEqual(['changed src/live.ts:1', 'changed src/live.ts:7'])
  })
```
Run (red): `bun test -t "continued past its closing line"`: the arrow body's edit expected `['changed src/live.ts:1']`,
received `[]`.

## Piece 2: a closing line no longer ends the span by itself
What: in `findAnchoredLineRange`, a closing line at the head's indentation is taken and the loop goes on; the next code
line decides: deeper than the head, it continues the statement and is taken; at the head's indentation, it is taken
only if it is another closing line, else the span ends. `OPENS_BLOCK_PATTERN`, used only by the break, goes.
Why: `} else {` kept the block going because it opens one; an arrow's body after `}): void =>` and a call chained
after `})` continue the statement just the same, one line deeper (plan, decision 1). A closing `}` followed by a line
at the head's indentation still ends it, so the statement after a block stays outside.
Where: `scripts/logicmap.ts:722`, `:733-734`, `:778-786`
```diff
-const OPENS_BLOCK_PATTERN = /[{([]\s*$/
 ...
  *   block: every following line indented deeper than the head,
  *          plus closing-bracket lines at the head's indentation  `}`  `)`  `} else {`
- *          (a closing line that opens a new block keeps the block going)
+ *          (after a closing line, a deeper line continues the statement: `}): T =>` and its body)
 ...
     const isClosingLineOfBlock =
       indentOf(line) === headIndent && CLOSING_BRACKET_LINE_PATTERN.test(line)
     if (!isClosingLineOfBlock) {
       break
     }
     lastLineIndex = lineIndex
-    if (!OPENS_BLOCK_PATTERN.test(line)) {
-      break
-    }
   }
```
Run (green): `bun test` 52 pass; strict `tsc` clean; biome clean after `--write` (the new test's layout).

## Piece 3: measured on teamabled
What: this checker run on teamabled at `38154eb5` (every lock just renewed to `v3:`).
Run: `check` 0.21 s, errors 17, all `changed`, each a span that now reaches the end of its statement: 15 arrow
functions whose parameters close on `): T =>` or `}): T =>`, their bodies never fingerprinted
(`src/auth/webauthn.ts:283`, `auth.passkey-delete-counts-under-the-user-lock`, covered the signature of the delete
whose count and lock it is about: 5 lines of 33; `src/documents/suggested-changes.ts:269` and `:362`, 7 and 9 of 74
and 75; five pushes in `src/live/live.ts`; `src/sidebar/sidebar.ts:186`, Recent's query, 5 of 30), one `} satisfies
Record<` (`shared/billing/price-brackets.ts:15`) and one `useCallback` after `): RefCallback<HTMLElement> =>`
(`web/src/editor/document-bar-bottom.ts:10`). No span grew past its own statement. Teamabled re-reads the 14 rules
and acks them in its task 08, step 2.

## Piece 4: SKILL.md says where a span ends
What: the anchor-grammar paragraph adds that after a closing line a deeper line continuing the statement is covered.
Where: `SKILL.md:176-178`

## Piece 5: the failing test, a generic and a JSX tag closed on `>`
What: a test beside piece 1's: an anchor above a function whose return type closes on `> => {` and one above a JSX
element whose attributes close on a lone `>`; an edit in the function's body, then in the element's child, is
`changed`; the line after each stays outside.
Why: the plan's revision: `findBaselineVersion`'s body was outside its decision's anchor.
Where: `scripts/logicmap.test.ts`, after piece 1's test
```ts
  test('a generic return type or a JSX tag closed on a lone > keeps the body covered', () => {
    const viewLines = [
      '// §edge sync.close-during-join@1',
      'const findBaseline = async (',
      '  documentId: string,',
      '): Promise<',
      '  Version | undefined',
      '> => {',
      '  return loadBaseline(documentId)',
      '}',
      'flushPending()',
      '',
      'const view = (',
      '  <section>',
      '    {/* §edge sync.pooled-buffer-slice@1 */}',
      '    <Button',
      '      onClick={send}',
      '    >',
      '      Send',
      '    </Button>',
      '    <Footer />',
      '  </section>',
      ')',
      '',
    ]
    const repoRoot = createFixtureRepo({
      'src/view.tsx': viewLines.join('\n'),
      'logicmap/sync.md': `${closeDuringJoinEntry(1)}\n${pooledBufferSliceEntry}`,
    })
    ackIds(repoRoot, ['sync.close-during-join', 'sync.pooled-buffer-slice'])
    const replaceViewLine = (lineIndex: number, replacementLine: string): void => {
      viewLines[lineIndex] = replacementLine
      writeFixtureFiles(repoRoot, { 'src/view.tsx': viewLines.join('\n') })
    }

    replaceViewLine(8, 'flushPendingMessages()')
    replaceViewLine(18, '    <Footer compact />')
    expect(describeLockProblems(repoRoot)).toEqual([])

    replaceViewLine(6, '  return loadBaseline(documentId, true)')
    expect(describeLockProblems(repoRoot)).toEqual(['changed src/view.tsx:1'])

    replaceViewLine(16, '      Send it')
    expect(describeLockProblems(repoRoot)).toEqual(['changed src/view.tsx:1', 'changed src/view.tsx:13'])
  })
```
Run (red): the function's body edit expected `['changed src/view.tsx:1']`, received `[]`.

## Piece 6: a line opening with `>` closes too
What: `CLOSING_BRACKET_LINE_PATTERN` takes `>` beside `)`, `]` and `}`; the diagram's comment names it.
Why: `> => {` closes a generic return type and a lone `>` a JSX opening tag, as `}): T =>` closes a parameter list;
what follows them deeper is the same statement (the revision). `/>` and `</Button>` open with `/` and `<`, so a
self-closing tag and a closing tag at the head's indentation still end the span as before.
Where: `scripts/logicmap.ts:721`, `:733`
```diff
-const CLOSING_BRACKET_LINE_PATTERN = /^\s*[)\]}]/
+const CLOSING_BRACKET_LINE_PATTERN = /^\s*[)\]}>]/
 ...
- *          plus closing-bracket lines at the head's indentation  `}`  `)`  `} else {`
+ *          plus closing-bracket lines at the head's indentation  `}`  `)`  `} else {`  `> => {`
```
Run (green): `bun test` 53 pass; strict `tsc` clean; biome clean after `--write`.

## Piece 7: measured on teamabled again
Run: `check` at `38154eb5`: errors 24, all `changed`: the 17 of piece 3, `review.ts:66` now through its body
(66-93), and 7 more, each through its own statement: the two anchors over `DOCUMENT_PERMISSIONS_BY_ACCESS`
(`src/documents/access.ts:31-32`), whose type closes on `> = {`, covered the type's 18 lines and none of the table's
values (now 31-120); `DocumentSidePanel.tsx:22`'s tabs per view the same way; four JSX elements whose opening tag
closes on a lone `>` (`AppShell.tsx:1276`, `ComposerTextarea.tsx:561`, `DocumentList.tsx:464`,
`DocumentTitle.tsx:58`), now through their children.
