import { afterAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  PROBLEM_CODES,
  PROBLEM_SEVERITIES,
  type Problem,
  ackIds,
  checkRepo,
  showLogicMap,
} from './logicmap.ts'

const fixtureRepoRoots: string[] = []

// A throwaway git repo holding exactly these files, all untracked: check reads untracked files too.
const createFixtureRepo = (contentByPath: Record<string, string>): string => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'logicmap-'))
  fixtureRepoRoots.push(repoRoot)
  execFileSync('git', ['init', '--quiet'], { cwd: repoRoot })
  writeFixtureFiles(repoRoot, contentByPath)
  return repoRoot
}

const writeFixtureFiles = (repoRoot: string, contentByPath: Record<string, string>): void => {
  for (const [relativePath, content] of Object.entries(contentByPath)) {
    const absolutePath = join(repoRoot, relativePath)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, content)
  }
}

const LOCK_PROBLEM_CODES: readonly string[] = [
  PROBLEM_CODES.unacked,
  PROBLEM_CODES.changed,
  PROBLEM_CODES.gone,
]
const isLockProblem = (problem: Problem): boolean => LOCK_PROBLEM_CODES.includes(problem.code)

// "code file:line" for each problem; the message text is free to change without breaking a test.
const describeProblem = (problem: Problem): string =>
  `${problem.code} ${problem.file}:${problem.line}`

// Errors in the anchors and the ledger themselves; the lock is tested on its own.
const describeErrors = (repoRoot: string): string[] =>
  checkRepo(repoRoot)
    .filter((problem) => problem.severity === PROBLEM_SEVERITIES.error && !isLockProblem(problem))
    .map(describeProblem)

const describeLockProblems = (repoRoot: string): string[] =>
  checkRepo(repoRoot).filter(isLockProblem).map(describeProblem)

const describeWarnings = (repoRoot: string): string[] =>
  checkRepo(repoRoot)
    .filter((problem) => problem.severity === PROBLEM_SEVERITIES.warning)
    .map(describeProblem)

const closeDuringJoinEntry = (version: number): string =>
  [
    '## sync.close-during-join',
    'kind: edge',
    `version: ${version}`,
    'what: The socket can close while the join is loading.',
    'why: The join adds the connection before it resolves.',
    'source: fixture',
    '',
  ].join('\n')

afterAll(() => {
  for (const repoRoot of fixtureRepoRoots) {
    rmSync(repoRoot, { recursive: true, force: true })
  }
})

describe('anchors', () => {
  test('an anchor with no ledger entry is undocumented; one that does not parse is malformed', () => {
    const repoRoot = createFixtureRepo({
      'src/room.ts': [
        '// §edge sync.close-during-join@1',
        'const undoJoin = () => {}',
        '// §edge close-during-join@1',
        'const other = 1',
        '',
      ].join('\n'),
    })

    expect(describeErrors(repoRoot)).toEqual([
      'undocumented src/room.ts:1',
      'malformed-anchor src/room.ts:3',
    ])
  })

  test('paths listed in logicmap/ignore are not scanned: docs that quote anchors as examples', () => {
    const repoRoot = createFixtureRepo({
      'docs/how-anchors-work.md': [
        'An edge anchor looks like `§edge sync.close-during-join@1`.',
        'Typos such as `§edge close-during-join@1` are errors.',
        '',
      ].join('\n'),
      'logicmap/ignore': ['# files that talk about anchors', 'docs/', ''].join('\n'),
    })

    expect(describeErrors(repoRoot)).toEqual([])
  })
})

describe('ledger', () => {
  test('an entry needs kind, version, what and why, and one heading in its domain file', () => {
    const repoRoot = createFixtureRepo({
      'src/room.ts': [
        '// §edge sync.close-during-join@1',
        'const undoJoin = () => {}',
        '// §edge sync.pooled-buffer-slice@1',
        'const bytes = new Uint8Array(0)',
        '// §decision access.not-found-not-forbidden@1',
        'const notFoundStatus = 404',
        '',
      ].join('\n'),
      'logicmap/access.md': [
        '## access.not-found-not-forbidden',
        'kind: decision',
        'version: 1',
        'what: No path to a resource answers 404.',
        'why: A 403 would confirm the resource exists.',
        'source: fixture',
        '',
      ].join('\n'),
      'logicmap/sync.md': [
        '# sync',
        '',
        '## sync.close-during-join',
        'kind: edge',
        'version: 1',
        'what: The socket can close while the join is loading.',
        'source: fixture',
        '',
        '## sync.pooled-buffer-slice',
        'kind: fence',
        'version: one',
        'what: ws hands out slices of a pooled buffer.',
        'why: Reading the whole pool reads neighbouring bytes.',
        'source: fixture',
        '',
        '## access.not-found-not-forbidden',
        'kind: decision',
        'version: 1',
        'what: No path to a resource answers 404.',
        'why: A 403 would confirm the resource exists.',
        'source: fixture',
        '',
      ].join('\n'),
    })

    expect(describeErrors(repoRoot)).toEqual([
      'missing-field logicmap/sync.md:3',
      'invalid-field logicmap/sync.md:10',
      'invalid-field logicmap/sync.md:11',
      'misplaced-entry logicmap/sync.md:16',
      'duplicate-entry logicmap/sync.md:16',
    ])
  })
})

describe('anchors against their entries', () => {
  test('every anchor pins the entry version; a defining role matches the entry kind', () => {
    const repoRoot = createFixtureRepo({
      'src/room.ts': [
        '// §edge sync.close-during-join@2',
        'const undoJoin = () => {}',
        '',
        '// §invariant sync.close-during-join@2',
        'const removeConnection = () => {}',
        '// §uses sync.close-during-join@1',
        'const destroyEmptyRoom = () => {}',
        '',
      ].join('\n'),
      'logicmap/sync.md': closeDuringJoinEntry(2),
    })

    expect(describeErrors(repoRoot)).toEqual([
      'role-mismatch src/room.ts:4',
      'stale-pin src/room.ts:6',
    ])
  })
})

describe('entries against their anchors', () => {
  test('a decision, invariant or edge has one defining anchor; a retired id has none', () => {
    const repoRoot = createFixtureRepo({
      'src/room.ts': [
        '// §edge sync.close-during-join@1',
        'const undoJoin = () => {}',
        '// §edge sync.close-during-join@1',
        'const undoJoinAgain = () => {}',
        '// §uses sync.pooled-buffer-slice@1',
        'const bytes = new Uint8Array(0)',
        '',
      ].join('\n'),
      'logicmap/sync.md': [
        closeDuringJoinEntry(1),
        '## sync.pooled-buffer-slice',
        'kind: edge',
        'version: 1',
        'status: retired',
        'what: ws hands out slices of a pooled buffer.',
        'why: Reading the whole pool reads neighbouring bytes.',
        'source: fixture',
        '',
        '## sync.read-only-drops-edits',
        'kind: invariant',
        'version: 1',
        'what: A read-only connection may not change the document.',
        'why: The REST rename answers 403 for the same user.',
        'source: fixture',
        '',
      ].join('\n'),
    })

    expect(describeErrors(repoRoot)).toEqual([
      'orphan-entry logicmap/sync.md:16',
      'duplicate-definition src/room.ts:3',
      'retired-anchored src/room.ts:5',
    ])
  })

  test('a flow anchor names a listed step, every step has a site, only flow anchors carry a step', () => {
    const repoRoot = createFixtureRepo({
      'src/room.ts': [
        '// §flow sync.open-document@1 #1',
        'const openSocket = () => {}',
        '// §flow sync.open-document@1 #4',
        'const sendStepFour = () => {}',
        '// §flow sync.open-document@1',
        'const someStep = () => {}',
        '// §uses sync.open-document@1 #2',
        'const relyOnStepTwo = () => {}',
        '',
      ].join('\n'),
      'logicmap/sync.md': [
        '## sync.open-document',
        'kind: flow',
        'version: 1',
        'what: Opening a document over the socket.',
        'why: The steps cross the browser, the upgrade and the room.',
        'source: fixture',
        'steps:',
        '  1. The browser opens the socket.',
        '  2. The upgrade resolves access.',
        '  3. The user follows the invite link. (external)',
        '',
      ].join('\n'),
    })

    expect(describeErrors(repoRoot)).toEqual([
      'step-without-site logicmap/sync.md:9',
      'unknown-step src/room.ts:3',
      'missing-step src/room.ts:5',
      'misplaced-step src/room.ts:7',
    ])
  })
})

describe('lock', () => {
  test('anchors and entries are unacked until ack; ack refuses an id that has errors', () => {
    const repoRoot = createFixtureRepo({
      'src/room.ts': [
        '// §edge sync.close-during-join@1',
        'const undoJoin = () => {}',
        '// §uses sync.pooled-buffer-slice@1',
        'const bytes = new Uint8Array(0)',
        '',
      ].join('\n'),
      'logicmap/sync.md': closeDuringJoinEntry(1),
    })

    expect(describeLockProblems(repoRoot)).toEqual([
      'unacked logicmap/sync.md:1',
      'unacked src/room.ts:1',
    ])

    const refusedAck = ackIds(repoRoot, ['sync.pooled-buffer-slice'])
    expect(refusedAck.blockingProblems.map(describeProblem)).toEqual(['undocumented src/room.ts:3'])

    const acceptedAck = ackIds(repoRoot, ['sync.close-during-join'])
    expect(acceptedAck.blockingProblems).toEqual([])
    expect(describeLockProblems(repoRoot)).toEqual([])
  })

  test('the fingerprint covers the anchored block: an edit inside it is a change, past it is not', () => {
    const roomLines = [
      'export const joinSocket = () => {',
      '  // §edge sync.close-during-join@1',
      '  if (closedEarly) {',
      '    joined.removeConnection(connection)',
      '    return',
      '  } else {',
      '    room = joined',
      '  }',
      '  flushPending()',
      '}',
      '',
    ]
    const repoRoot = createFixtureRepo({
      'src/room.ts': roomLines.join('\n'),
      'logicmap/sync.md': closeDuringJoinEntry(1),
    })
    ackIds(repoRoot, ['sync.close-during-join'])
    const replaceRoomLine = (lineIndex: number, replacementLine: string): void => {
      roomLines[lineIndex] = replacementLine
      writeFixtureFiles(repoRoot, { 'src/room.ts': roomLines.join('\n') })
    }

    replaceRoomLine(8, '  flushPendingMessages()')
    expect(describeLockProblems(repoRoot)).toEqual([])

    replaceRoomLine(4, '      return  ')
    expect(describeLockProblems(repoRoot)).toEqual([])

    replaceRoomLine(6, '    room = null')
    expect(describeLockProblems(repoRoot)).toEqual(['changed src/room.ts:2'])
  })

  test('a trailing anchor covers its own line; an edited entry is changed; a deleted anchor is gone', () => {
    const anchoredLine =
      'const undoJoin = () => joined.removeConnection(connection) // §edge sync.close-during-join@1'
    const repoRoot = createFixtureRepo({
      'src/room.ts': [anchoredLine, 'const next = 1', ''].join('\n'),
      'logicmap/sync.md': closeDuringJoinEntry(1),
    })
    ackIds(repoRoot, ['sync.close-during-join'])

    writeFixtureFiles(repoRoot, { 'src/room.ts': [anchoredLine, 'const next = 2', ''].join('\n') })
    expect(describeLockProblems(repoRoot)).toEqual([])

    const editedEntry = closeDuringJoinEntry(1).replace(
      'before it resolves',
      'before the room loads',
    )
    writeFixtureFiles(repoRoot, { 'logicmap/sync.md': editedEntry })
    expect(describeLockProblems(repoRoot)).toEqual(['changed logicmap/sync.md:1'])

    ackIds(repoRoot, ['sync.close-during-join'])
    writeFixtureFiles(repoRoot, { 'src/room.ts': 'const next = 2\n' })
    expect(describeLockProblems(repoRoot)).toEqual(['gone logicmap/lock:2'])
  })
})

describe('coverage', () => {
  test('an edge or invariant with no test anchor is a warning; a decision needs none', () => {
    const repoRoot = createFixtureRepo({
      'src/room.ts': [
        '// §edge sync.close-during-join@1',
        'const undoJoin = () => {}',
        '// §decision access.not-found-not-forbidden@1',
        'const notFoundStatus = 404',
        '',
      ].join('\n'),
      'logicmap/sync.md': closeDuringJoinEntry(1),
      'logicmap/access.md': [
        '## access.not-found-not-forbidden',
        'kind: decision',
        'version: 1',
        'what: No path to a resource answers 404.',
        'why: A 403 would confirm the resource exists.',
        'source: fixture',
        '',
      ].join('\n'),
    })
    expect(describeWarnings(repoRoot)).toEqual(['untested logicmap/sync.md:1'])

    writeFixtureFiles(repoRoot, {
      'src/room.test.ts': [
        '// §test sync.close-during-join@1',
        "test('a socket closed mid-join leaves no connection behind', () => {})",
        '',
      ].join('\n'),
    })
    expect(describeWarnings(repoRoot)).toEqual([])
  })
})

describe('show', () => {
  test('an id shows its entry and its sites in step order; a file shows its anchors and their entries', () => {
    const repoRoot = createFixtureRepo({
      'src/ws-routes.ts': [
        '// §flow sync.open-document@1 #2',
        'const resolveAccess = () => {}',
        '',
      ].join('\n'),
      'web/sync-provider.ts': [
        '// §flow sync.open-document@1 #1',
        'const openSocket = () => {}',
        '',
      ].join('\n'),
      'logicmap/sync.md': [
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
      ].join('\n'),
    })
    ackIds(repoRoot, ['sync.open-document'])

    const idView = showLogicMap(repoRoot, 'sync.open-document')
    expect(idView).toContain('what: Opening a document over the socket.')
    expect(idView).toContain('web/sync-provider.ts:1  §flow sync.open-document@1 #1  ok')
    expect(idView).toContain('src/ws-routes.ts:1  §flow sync.open-document@1 #2  ok')
    expect(idView.indexOf('web/sync-provider.ts:1')).toBeLessThan(
      idView.indexOf('src/ws-routes.ts:1'),
    )

    const fileView = showLogicMap(repoRoot, 'src/ws-routes.ts')
    expect(fileView).toContain(
      'src/ws-routes.ts:1  §flow sync.open-document@1 #2  ok  recorded  Opening a document over the socket.',
    )

    expect(showLogicMap(repoRoot, undefined)).toContain(
      'sync.open-document@1  flow  ok  recorded  Opening a document over the socket.  (sites: 2)',
    )
  })
})

describe('provenance', () => {
  test('every entry names its source; show marks an entry whose source is an inference', () => {
    const repoRoot = createFixtureRepo({
      'src/billing.ts': [
        '// §edge billing.retry-skips-weekends@1',
        'if (isWeekend(retryAt)) {',
        '  retryAt = nextMonday(retryAt)',
        '}',
        '// §decision billing.charge-in-cents@1',
        'const amountInCents = 1999',
        '',
      ].join('\n'),
      'logicmap/billing.md': [
        '## billing.retry-skips-weekends',
        'kind: edge',
        'version: 1',
        'what: A retry that falls on a weekend moves to Monday.',
        'why: Not recorded; without it the retry and the Monday batch both charge the card.',
        'source: inferred — commit 4f2a91c "fix double charge on weekend retries"',
        '',
        '## billing.charge-in-cents',
        'kind: decision',
        'version: 1',
        'what: Amounts are integers in cents.',
        'why: Floats lose cents in sums.',
        '',
      ].join('\n'),
    })

    expect(describeErrors(repoRoot)).toEqual(['missing-field logicmap/billing.md:8'])
    const fileView = showLogicMap(repoRoot, 'src/billing.ts')
    expect(fileView).toContain(
      '§edge billing.retry-skips-weekends@1  unacked  inferred  A retry that falls on a weekend moves to Monday.',
    )
    expect(fileView).toContain('§decision billing.charge-in-cents@1  unacked  unsourced')
  })
})
