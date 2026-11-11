# Step 4: `bump <id> <what changed>`

Before: `bun test` 60 pass.

## Piece 1: the failing test
What: `describe('bump')`: an edge with its definition, a `uses` and a `test` site, and a `history:`; a flow of two
steps with no history; a retired rule. Bumping the edge writes `version: 2`, adds `- @2: <what changed>` under its
history, moves the pin in `src/room.ts`, leaves the two other pins, lists them, and `check` reports them as
`stale-pin`. Bumping the flow adds a `history:` field after its steps, moves no pin and lists both steps. A retired
and an unknown id are refused and nothing is written.
Why: plan, decision 4.
Where: `scripts/logicmap.test.ts`, after `describe('diff')`
```ts
describe('bump', () => {
  test("the entry's version and history, the defining pin moved, every other site left to re-verify; a flow moves no pin; a retired or unknown id is refused", () => {
    const repoRoot = createFixtureRepo({
      'src/room.ts': ['// §edge sync.close-during-join@1', 'if (closedEarly) {', '}', ''].join('\n'),
      'src/routes.ts': [
        '// §uses sync.close-during-join@1',
        'joinRoom(socket)',
        '// §flow sync.open-document@1 #2',
        'const resolveAccess = () => {}',
        '',
      ].join('\n'),
      'src/room.test.ts': [
        '// §test sync.close-during-join@1',
        "test('a socket closed mid-join is removed', () => {})",
        '',
      ].join('\n'),
      'web/provider.ts': ['// §flow sync.open-document@1 #1', 'const openSocket = () => {}', ''].join(
        '\n',
      ),
      'logicmap/sync.md': [
        '## sync.close-during-join',
        'kind: edge',
        'version: 1',
        'what: The socket can close while the join is loading.',
        'why: The join adds the connection before it resolves.',
        'source: fixture',
        'history:',
        '- @1: introduced',
        '',
        '## sync.open-document',
        'kind: flow',
        'version: 1',
        'what: Opening a document over the socket.',
        'why: The steps cross the browser and the server.',
        'source: fixture',
        'steps:',
        '  1. The browser opens the socket.',
        '  2. The upgrade resolves access.',
        '',
        '## sync.old-rule',
        'kind: decision',
        'version: 1',
        'status: retired',
        'what: An old rule.',
        'why: fixture.',
        'source: fixture',
        '',
      ].join('\n'),
    })
    ackIds(repoRoot, ['sync.close-during-join', 'sync.open-document', 'sync.old-rule'])

    expect(
      bumpId(repoRoot, 'sync.close-during-join', 'a join that fails removes the socket too'),
    ).toEqual({
      isBumped: true,
      report: [
        'sync.close-during-join: version 1 → 2 in logicmap/sync.md:1, its history line added, the pin moved at src/room.ts:1.',
        'Rewrite its what and why to what holds now, then re-verify each site below against it and move its pin to @2:',
        '  src/routes.ts:1  §uses sync.close-during-join@1',
        '  src/room.test.ts:1  §test sync.close-during-join@1',
        'Then: ack sync.close-during-join',
      ].join('\n'),
    })
    expect(readFixtureFile(repoRoot, 'logicmap/sync.md')).toContain(
      [
        '## sync.close-during-join',
        'kind: edge',
        'version: 2',
        'what: The socket can close while the join is loading.',
        'why: The join adds the connection before it resolves.',
        'source: fixture',
        'history:',
        '- @1: introduced',
        '- @2: a join that fails removes the socket too',
        '',
        '## sync.open-document',
      ].join('\n'),
    )
    expect(readFixtureFile(repoRoot, 'src/room.ts')).toStartWith(
      '// §edge sync.close-during-join@2\n',
    )
    expect(readFixtureFile(repoRoot, 'src/routes.ts')).toStartWith(
      '// §uses sync.close-during-join@1\n',
    )
    expect(describeErrors(repoRoot)).toEqual([
      'stale-pin src/room.test.ts:1',
      'stale-pin src/routes.ts:1',
    ])

    const flowBump = bumpId(repoRoot, 'sync.open-document', 'the upgrade reads the frozen state too')
    expect(flowBump.report.split('\n')).toEqual([
      'sync.open-document: version 1 → 2 in logicmap/sync.md:11, its history line added; a flow has no single definition, so no pin moved.',
      'Rewrite its what and why to what holds now, then re-verify each site below against it and move its pin to @2:',
      '  web/provider.ts:1  §flow sync.open-document@1 #1',
      '  src/routes.ts:3  §flow sync.open-document@1 #2',
      'Then: ack sync.open-document',
    ])
    expect(readFixtureFile(repoRoot, 'logicmap/sync.md')).toContain(
      [
        'version: 2',
        'what: Opening a document over the socket.',
        'why: The steps cross the browser and the server.',
        'source: fixture',
        'steps:',
        '  1. The browser opens the socket.',
        '  2. The upgrade resolves access.',
        'history:',
        '- @2: the upgrade reads the frozen state too',
        '',
        '## sync.old-rule',
      ].join('\n'),
    )
    expect(readFixtureFile(repoRoot, 'web/provider.ts')).toStartWith(
      '// §flow sync.open-document@1 #1\n',
    )

    const ledgerTextBeforeRefusals = readFixtureFile(repoRoot, 'logicmap/sync.md')
    expect(bumpId(repoRoot, 'sync.old-rule', 'anything')).toEqual({
      isBumped: false,
      report: 'sync.old-rule is retired: a retired rule is never bumped or reused',
    })
    expect(bumpId(repoRoot, 'sync.no-such-rule', 'anything')).toEqual({
      isBumped: false,
      report: 'sync.no-such-rule has no entry in logicmap/sync.md',
    })
    expect(readFixtureFile(repoRoot, 'logicmap/sync.md')).toBe(ledgerTextBeforeRefusals)
  })
})
```
Run (red): `bun test -t "the entry's version and history"`: 0 pass, 1 fail, `Export named 'bumpId' not found`.

## Piece 2: the mechanical half of a bump
What: `bumpId(repoRoot, id, whatChanged)` refuses an id with no entry, a retired one and one whose version did not
parse. Otherwise, in the ledger file it rewrites the entry's `version:` line and adds `- @N+1: <what changed>` at
the end of its `history:` field (the field runs to the next field's line or the entry's last line), or a new
`history:` field at the entry's end. In the code it moves the pin of each defining anchor that pins the old version,
unless the entry is a flow. Its report names what it wrote and lists every other site in the order `show <id>`
prints them. The command line's `bump <id> <what changed>` joins the words after the id and exits 1 on a refusal.
Why: plan, decision 4. The sites listed are left pinned to the old version on purpose: `check` keeps each as
`stale-pin` until someone reads it against the new entry.
Where: `scripts/logicmap.ts`: after `ackRenamedIds`; `USAGE`; `runCommandLine`
```ts
// ---------- Bump: the version, the history line and the definition's pin of a rule whose meaning changed ----------

const VERSION_FIELD_PATTERN = /^version:/
const HISTORY_FIELD_PATTERN = /^history:/

const isEntryFieldLine = (entryLine: string): boolean =>
  isEntryFieldName(ENTRY_FIELD_PATTERN.exec(entryLine)?.[1])

const pinOf = (role: AnchorRole, id: string, version: number): string => `§${role} ${id}@${version}`

export type BumpOutcome = { isBumped: boolean; report: string }

// What a bump writes by rote. The what and the why stay for whoever knows what holds now, and every other site
// stays pinned to the old version, so check reports it until it is re-verified.
export const bumpId = (repoRoot: string, id: string, whatChanged: string): BumpOutcome => {
  const { anchors, entriesById } = analyzeRepo(repoRoot)
  const entry = entriesById.get(id)
  if (entry === undefined) {
    return { isBumped: false, report: `${id} has no entry in ${LEDGER_DIRECTORY}/${domainOf(id)}.md` }
  }
  if (entry.status === ENTRY_STATUSES.retired) {
    return { isBumped: false, report: `${id} is retired: a retired rule is never bumped or reused` }
  }
  const currentVersion = entry.version
  if (currentVersion === null) {
    return { isBumped: false, report: `${id} has no version to bump: fix its version field first` }
  }
  const nextVersion = currentVersion + 1

  const ledgerPath = join(repoRoot, entry.file)
  const ledgerLines = readFileSync(ledgerPath, 'utf8').split('\n')
  const entryFirstIndex = entry.line - 1
  const entryLines = ledgerLines.slice(entryFirstIndex, entryFirstIndex + entry.text.split('\n').length)
  const historyOffset = entryLines.findIndex((entryLine) => HISTORY_FIELD_PATTERN.test(entryLine))
  const hasHistory = historyOffset !== -1
  const fieldAfterHistoryOffset = entryLines.findIndex(
    (entryLine, lineOffset) => hasHistory && lineOffset > historyOffset && isEntryFieldLine(entryLine),
  )
  const historyEndOffset = fieldAfterHistoryOffset === -1 ? entryLines.length : fieldAfterHistoryOffset
  const newHistoryLine = `- @${nextVersion}: ${whatChanged}`
  const bumpedEntryLines = entryLines
    .map((entryLine) => (VERSION_FIELD_PATTERN.test(entryLine) ? `version: ${nextVersion}` : entryLine))
    .toSpliced(historyEndOffset, 0, ...(hasHistory ? [newHistoryLine] : ['history:', newHistoryLine]))
  writeFileSync(
    ledgerPath,
    ledgerLines.toSpliced(entryFirstIndex, entryLines.length, ...bumpedEntryLines).join('\n'),
  )

  const ruleAnchors = anchors.filter((anchor) => anchor.id === id).sort(bySiteOrder)
  const isFlow = entry.kind === ENTRY_KINDS.flow
  const definingAnchors = isFlow
    ? []
    : ruleAnchors.filter(
        (anchor) => isDefiningRole(anchor.role) && anchor.version === currentVersion,
      )
  for (const definingAnchor of definingAnchors) {
    const codePath = join(repoRoot, definingAnchor.file)
    const repinnedLines = readFileSync(codePath, 'utf8')
      .split('\n')
      .map((codeLine, lineIndex) =>
        lineIndex === definingAnchor.line - 1
          ? codeLine.replace(
              pinOf(definingAnchor.role, id, currentVersion),
              pinOf(definingAnchor.role, id, nextVersion),
            )
          : codeLine,
      )
    writeFileSync(codePath, repinnedLines.join('\n'))
  }

  const describePlace = (anchor: Anchor): string => `${anchor.file}:${anchor.line}`
  const pinNote = isFlow
    ? '; a flow has no single definition, so no pin moved.'
    : definingAnchors.length === 0
      ? `; no defining anchor pins @${currentVersion}, so no pin moved.`
      : `, the pin moved at ${definingAnchors.map(describePlace).join(', ')}.`
  const sitesToReverify = ruleAnchors.filter((anchor) => !definingAnchors.includes(anchor))
  const rewriteLines =
    sitesToReverify.length === 0
      ? ['Rewrite its what and why to what holds now. No other site pins it.']
      : [
          `Rewrite its what and why to what holds now, then re-verify each site below against it and move its pin to @${nextVersion}:`,
          ...sitesToReverify.map((anchor) => `  ${describePlace(anchor)}  ${describeAnchor(anchor)}`),
        ]
  return {
    isBumped: true,
    report: [
      `${id}: version ${currentVersion} → ${nextVersion} in ${entry.file}:${entry.line}, its history line added${pinNote}`,
      ...rewriteLines,
      `Then: ack ${id}`,
    ].join('\n'),
  }
}
```
```diff
+  if (command === 'bump' && commandArguments.length > 1) {
+    const [id = '', ...whatChangedWords] = commandArguments
+    const { isBumped, report } = bumpId(repoRoot, id, whatChangedWords.join(' '))
+    console.log(report)
+    return isBumped ? 0 : 1
+  }
```
Run (green): `bun test`: 61 pass, 0 fail.
