import { afterAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { respondToHook } from './hook.ts'
import {
  PROBLEM_CODES,
  PROBLEM_SEVERITIES,
  type Problem,
  ackIds,
  checkRepo,
  diffLogicMap,
  showLogicMap,
  whyLogicMap,
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

const readFixtureFile = (repoRoot: string, relativePath: string): string =>
  readFileSync(join(repoRoot, relativePath), 'utf8')

const commitFixtureRepo = (repoRoot: string, message: string): void => {
  execFileSync('git', ['add', '-A'], { cwd: repoRoot })
  execFileSync(
    'git',
    [
      '-c',
      'user.name=fixture',
      '-c',
      'user.email=fixture@example.com',
      'commit',
      '--quiet',
      '-m',
      message,
    ],
    { cwd: repoRoot },
  )
}

// The lock files in the fixture's logicmap/: each <domain>.lock, and the old single `lock`.
const listFixtureLockFileNames = (repoRoot: string): string[] =>
  readdirSync(join(repoRoot, 'logicmap'))
    .filter((fileName) => fileName === 'lock' || fileName.endsWith('.lock'))
    .sort()

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

const pooledBufferSliceEntry = [
  '## sync.pooled-buffer-slice',
  'kind: edge',
  'version: 1',
  'what: ws may hand a message over as a slice of a pooled buffer.',
  'why: The decoder must read exactly this message.',
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

  test('a step marked (external) on its wrapped second line needs no site', () => {
    const repoRoot = createFixtureRepo({
      'src/room.ts': ['// §flow sync.open-document@1 #1', 'const openSocket = () => {}', ''].join(
        '\n',
      ),
      'logicmap/sync.md': [
        '## sync.open-document',
        'kind: flow',
        'version: 1',
        'what: Opening a document over the socket.',
        'why: The steps cross the browser and the server.',
        'source: fixture',
        'steps:',
        '  1. The browser opens the socket.',
        '  2. A teammate follows the emailed link and opens the same document in their own',
        '     browser. (external)',
        '',
      ].join('\n'),
    })

    expect(describeErrors(repoRoot)).toEqual([])
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
    expect(describeLockProblems(repoRoot)).toEqual(['gone logicmap/sync.lock:2'])
  })

  test('adding an anchor inside an anchored block does not change that block', () => {
    const roomLines = [
      '// §edge sync.close-during-join@1',
      'if (closedEarly) {',
      '  joined.removeConnection(connection)',
      '}',
      '// §edge sync.pooled-buffer-slice@1',
      'const data = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)',
      '',
    ]
    const repoRoot = createFixtureRepo({
      'src/room.ts': roomLines.join('\n'),
      'logicmap/sync.md': [
        closeDuringJoinEntry(1),
        '## sync.pooled-buffer-slice',
        'kind: edge',
        'version: 1',
        'what: ws may hand a message over as a slice of a pooled buffer.',
        'why: The decoder must read exactly this message.',
        'source: fixture',
        '',
      ].join('\n'),
    })
    ackIds(repoRoot, ['sync.close-during-join', 'sync.pooled-buffer-slice'])

    roomLines.splice(2, 0, '  // §uses sync.pooled-buffer-slice@1')
    writeFixtureFiles(repoRoot, { 'src/room.ts': roomLines.join('\n') })
    expect(describeLockProblems(repoRoot)).toEqual([])
  })

  test('a uses or test site is not in the lock: adding or editing one asks no ack, its pin still follows the entry', () => {
    const repoRoot = createFixtureRepo({
      'src/room.ts': ['// §edge sync.close-during-join@1', 'const undoJoin = () => {}', ''].join(
        '\n',
      ),
      'logicmap/sync.md': closeDuringJoinEntry(1),
    })
    ackIds(repoRoot, ['sync.close-during-join'])
    const writeRelyingSites = (callerLine: string, version: number): void =>
      writeFixtureFiles(repoRoot, {
        'src/caller.ts': [`// §uses sync.close-during-join@${version}`, callerLine, ''].join('\n'),
        'src/room.test.ts': [
          `// §test sync.close-during-join@${version}`,
          "test('undoes the join', () => {})",
          '',
        ].join('\n'),
      })

    writeRelyingSites('joinSocket()', 1)
    expect(describeLockProblems(repoRoot)).toEqual([])

    writeRelyingSites('joinSocketAgain()', 1)
    expect(describeLockProblems(repoRoot)).toEqual([])

    const lockText = readFixtureFile(repoRoot, 'logicmap/sync.lock')
    writeFixtureFiles(repoRoot, {
      'logicmap/sync.lock': `${lockText}sync.close-during-join uses src/old.ts#1 1 0123456789ab\n`,
    })
    expect(describeLockProblems(repoRoot)).toEqual([])

    writeFixtureFiles(repoRoot, { 'logicmap/sync.md': closeDuringJoinEntry(2) })
    expect(describeErrors(repoRoot)).toEqual([
      'stale-pin src/caller.ts:1',
      'stale-pin src/room.test.ts:1',
      'stale-pin src/room.ts:1',
    ])
  })

  test('the code fingerprint leaves out comment lines, not a #private or --count line', () => {
    const roomLines = [
      'export class Room {',
      '  // §edge sync.close-during-join@1',
      '  closeEarly() {',
      '    // The room still holds a socket that closed while it loaded.',
      '    /*',
      '      join → close → load',
      '    */',
      '    #closedCount = 0',
      '    --retries',
      '  }',
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

    expect(readFixtureFile(repoRoot, 'logicmap/sync.lock')).toMatch(
      /^sync\.close-during-join edge src\/room\.ts#1 1 v2:[0-9a-f]{12}$/m,
    )
    replaceRoomLine(3, '    // A socket that closed while the room loaded is still in it.')
    replaceRoomLine(5, '      join → close → load → remove')
    expect(describeLockProblems(repoRoot)).toEqual([])

    replaceRoomLine(7, '    #closedCount = 1')
    expect(describeLockProblems(repoRoot)).toEqual(['changed src/room.ts:2'])

    ackIds(repoRoot, ['sync.close-during-join'])
    replaceRoomLine(8, '    --attempts')
    expect(describeLockProblems(repoRoot)).toEqual(['changed src/room.ts:2'])
  })

  test('a lock line written before comments left the fingerprint still holds, and an ack of its domain renews it', () => {
    const roomLines = [
      '// §edge sync.close-during-join@1',
      'if (closedEarly) {',
      '  // A socket that closed while the room loaded is still in it.',
      '  joined.removeConnection(connection)',
      '}',
      '// §edge sync.pooled-buffer-slice@1',
      'const data = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)',
      '',
    ]
    // As the checker of before wrote it for this code: the fingerprints carry no v2: prefix.
    const lockLinesOfBefore = [
      'sync.close-during-join edge src/room.ts#1 1 4f767cc9f37f',
      'sync.close-during-join entry logicmap/sync.md#1 1 a27e01982a37',
      'sync.pooled-buffer-slice edge src/room.ts#1 1 b2d60a134c0c',
      'sync.pooled-buffer-slice entry logicmap/sync.md#1 1 1e304c5d6b94',
    ]
    const repoRoot = createFixtureRepo({
      'src/room.ts': roomLines.join('\n'),
      'logicmap/sync.md': [closeDuringJoinEntry(1), pooledBufferSliceEntry].join('\n'),
      'logicmap/sync.lock': `${lockLinesOfBefore.join('\n')}\n`,
    })
    const lockLineOf = (key: string): string | undefined =>
      readFixtureFile(repoRoot, 'logicmap/sync.lock')
        .split('\n')
        .find((lockLine) => lockLine.startsWith(key))

    expect(describeLockProblems(repoRoot)).toEqual([])

    roomLines[3] = '  joined.dropConnection(connection)'
    writeFixtureFiles(repoRoot, { 'src/room.ts': roomLines.join('\n') })
    ackIds(repoRoot, ['sync.pooled-buffer-slice'])
    expect(lockLineOf('sync.close-during-join edge')).toBe(lockLinesOfBefore[0])
    expect(lockLineOf('sync.pooled-buffer-slice edge')).toMatch(/ 1 v2:[0-9a-f]{12}$/)
    expect(describeLockProblems(repoRoot)).toEqual(['changed src/room.ts:1'])

    roomLines[3] = '  joined.removeConnection(connection)'
    writeFixtureFiles(repoRoot, { 'src/room.ts': roomLines.join('\n') })
    ackIds(repoRoot, ['sync.pooled-buffer-slice'])
    expect(lockLineOf('sync.close-during-join edge')).toMatch(/ 1 v2:[0-9a-f]{12}$/)
    expect(lockLineOf('sync.close-during-join entry')).toBe(lockLinesOfBefore[1])
    expect(describeLockProblems(repoRoot)).toEqual([])
  })

  test('a site that moved is not reported: a renamed file, a flow anchor renumbered by one added above it', () => {
    const roomText = [
      '// §edge sync.close-during-join@1',
      'if (closedEarly) {',
      '  joined.removeConnection(connection)',
      '}',
      '',
    ].join('\n')
    const repoRoot = createFixtureRepo({
      'src/room.ts': roomText,
      'logicmap/sync.md': closeDuringJoinEntry(1),
    })
    ackIds(repoRoot, ['sync.close-during-join'])

    renameSync(join(repoRoot, 'src/room.ts'), join(repoRoot, 'src/join-room.ts'))
    expect(describeLockProblems(repoRoot)).toEqual([])

    writeFixtureFiles(repoRoot, {
      'src/join-room.ts': roomText.replace('removeConnection', 'dropConnection'),
    })
    expect(describeLockProblems(repoRoot)).toEqual([
      'gone logicmap/sync.lock:2',
      'unacked src/join-room.ts:1',
    ])

    const flowEntry = [
      '## sync.open-document',
      'kind: flow',
      'version: 1',
      'what: Opening a document over the socket.',
      'why: The steps cross the browser, the upgrade and the room.',
      'source: fixture',
      'steps:',
      '  1. The browser opens the socket.',
      '  2. The upgrade resolves access.',
      '',
    ].join('\n')
    const stepOneLines = ['// §flow sync.open-document@1 #1', 'const openSocket = () => {}']
    const stepTwoLines = ['// §flow sync.open-document@1 #2', 'const resolveAccess = () => {}']
    const flowRepoRoot = createFixtureRepo({
      'src/open.ts': [...stepOneLines, ...stepTwoLines, ''].join('\n'),
      'logicmap/sync.md': flowEntry,
    })
    ackIds(flowRepoRoot, ['sync.open-document'])
    const addedStepLines = ['// §flow sync.open-document@1 #1', 'const openSocketAgain = () => {}']
    writeFixtureFiles(flowRepoRoot, {
      'src/open.ts': [...addedStepLines, ...stepOneLines, ...stepTwoLines, ''].join('\n'),
    })
    expect(describeLockProblems(flowRepoRoot)).toEqual(['unacked src/open.ts:1'])
  })

  test('a changed site over 60 lines says how many it covers; a shorter one does not', () => {
    const longBlockLines = Array.from({ length: 60 }, (_, lineIndex) => `  step${lineIndex}()`)
    const roomLines = [
      '// §edge sync.close-during-join@1',
      'export const joinSocket = () => {',
      ...longBlockLines,
      '}',
      '// §edge sync.pooled-buffer-slice@1',
      'const data = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)',
      '',
    ]
    const repoRoot = createFixtureRepo({
      'src/room.ts': roomLines.join('\n'),
      'logicmap/sync.md': [closeDuringJoinEntry(1), pooledBufferSliceEntry].join('\n'),
    })
    ackIds(repoRoot, ['sync.close-during-join', 'sync.pooled-buffer-slice'])
    writeFixtureFiles(repoRoot, {
      'src/room.ts': roomLines
        .join('\n')
        .replace('step3()', 'stepThree()')
        .replace('raw.', 'bytes.'),
    })
    const changedMessages = checkRepo(repoRoot)
      .filter((problem) => problem.code === PROBLEM_CODES.changed)
      .map((problem) => problem.message)

    expect(changedMessages).toHaveLength(2)
    expect(changedMessages[0]).toContain('covers 63 lines')
    expect(changedMessages[1]).not.toContain('covers')
  })

  test('an anchor written as a JSX comment covers the element below it', () => {
    const appLines = [
      'export const App = () => (',
      '  <Routes>',
      '    {/* §edge sync.close-during-join@1 */}',
      '    <Route path="/invite" element={<InviteAcceptPage />} />',
      '  </Routes>',
      ')',
      '',
    ]
    const repoRoot = createFixtureRepo({
      'web/App.tsx': appLines.join('\n'),
      'logicmap/sync.md': closeDuringJoinEntry(1),
    })
    ackIds(repoRoot, ['sync.close-during-join'])

    appLines[3] = '    <Route path="/invitation" element={<InviteAcceptPage />} />'
    writeFixtureFiles(repoRoot, { 'web/App.tsx': appLines.join('\n') })
    expect(describeLockProblems(repoRoot)).toEqual(['changed web/App.tsx:3'])
  })

  test("each domain has its own lock: an ack leaves another domain's lock file as it was", () => {
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
    ackIds(repoRoot, ['sync.close-during-join', 'access.not-found-not-forbidden'])
    const accessLockAfterFirstAck = readFixtureFile(repoRoot, 'logicmap/access.lock')

    const editedEntry = closeDuringJoinEntry(1).replace('before it resolves', 'before it loads')
    writeFixtureFiles(repoRoot, { 'logicmap/sync.md': editedEntry })
    ackIds(repoRoot, ['sync.close-during-join'])

    expect(readFixtureFile(repoRoot, 'logicmap/access.lock')).toBe(accessLockAfterFirstAck)
    expect(describeLockProblems(repoRoot)).toEqual([])
  })

  test("an ack writes only its own domains' lock files: another session's edit to another lock stays", () => {
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
    ackIds(repoRoot, ['sync.close-during-join', 'access.not-found-not-forbidden'])
    // What another session's ack, landing in between, leaves in access.lock.
    const accessLockWithNote = `${readFixtureFile(repoRoot, 'logicmap/access.lock')}# acked by another session\n`
    writeFixtureFiles(repoRoot, { 'logicmap/access.lock': accessLockWithNote })

    ackIds(repoRoot, ['sync.close-during-join'])

    expect(readFixtureFile(repoRoot, 'logicmap/access.lock')).toBe(accessLockWithNote)
  })

  test('ack deletes a lock file no line belongs to: the old single lock, a domain with nothing left', () => {
    const repoRoot = createFixtureRepo({
      'src/room.ts': ['// §edge sync.close-during-join@1', 'const undoJoin = () => {}', ''].join(
        '\n',
      ),
      'logicmap/sync.md': closeDuringJoinEntry(1),
    })
    ackIds(repoRoot, ['sync.close-during-join'])
    // A repo mapped before the split: the same lines, in the one file the old checker wrote.
    renameSync(join(repoRoot, 'logicmap/sync.lock'), join(repoRoot, 'logicmap/lock'))
    expect(describeLockProblems(repoRoot)).toEqual([])

    ackIds(repoRoot, ['sync.close-during-join'])
    expect(listFixtureLockFileNames(repoRoot)).toEqual(['sync.lock'])

    writeFixtureFiles(repoRoot, {
      'src/room.ts': 'const undoJoin = () => {}\n',
      'logicmap/sync.md': '',
    })
    ackIds(repoRoot, ['sync.close-during-join'])
    expect(listFixtureLockFileNames(repoRoot)).toEqual([])
    expect(describeLockProblems(repoRoot)).toEqual([])
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

  test('an entry that says why no test proves it, in untested:, is no warning', () => {
    const repoRoot = createFixtureRepo({
      'src/room.ts': ['// §edge sync.close-during-join@1', 'const undoJoin = () => {}', ''].join(
        '\n',
      ),
      'logicmap/sync.md': closeDuringJoinEntry(1).replace(
        'source: fixture',
        'untested: the close lands between two awaits no test can stop at\nsource: fixture',
      ),
    })

    expect(describeWarnings(repoRoot)).toEqual([])
    expect(showLogicMap(repoRoot, 'sync.close-during-join')).toContain(
      'untested: the close lands between two awaits no test can stop at',
    )
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
    expect(idView).toContain('web/sync-provider.ts:1-2  §flow sync.open-document@1 #1  ok')
    expect(idView).toContain('src/ws-routes.ts:1-2  §flow sync.open-document@1 #2  ok')
    expect(idView.indexOf('web/sync-provider.ts:1')).toBeLessThan(
      idView.indexOf('src/ws-routes.ts:1'),
    )

    expect(showLogicMap(repoRoot, 'src/ws-routes.ts')).toEqual(
      [
        'sync.open-document@1  flow  recorded  Opening a document over the socket.',
        '  1-2  §flow #2  ok',
      ].join('\n'),
    )
  })

  test('with no target, show maps the domains: each intro and its rule ids; a domain lists its rules with their claims', () => {
    const repoRoot = createFixtureRepo({
      'src/room.ts': [
        '// §decision sync.rooms-per-document@1',
        'const roomsByDocumentId = new Map()',
        '// §decision access.not-found-not-forbidden@1',
        'const notFoundStatus = 404',
        '',
      ].join('\n'),
      'logicmap/sync.md': [
        '# sync',
        '',
        'The live document sync: the socket, the rooms and the snapshots.',
        'Code: src/sync/.',
        '',
        '## sync.rooms-per-document',
        'kind: decision',
        'version: 1',
        'what: One room per open document. The room holds the live Y.Doc and every socket on it.',
        'why: fixture.',
        'source: fixture',
        '',
        '## sync.old-rule',
        'kind: decision',
        'version: 1',
        'status: retired',
        'what: An old rule.',
        'why: fixture.',
        'source: inferred — fixture',
        '',
      ].join('\n'),
      'logicmap/access.md': [
        '## access.not-found-not-forbidden',
        'kind: decision',
        'version: 1',
        'what: No path to a resource answers 404.',
        'why: fixture.',
        'source: inferred — fixture',
        '',
      ].join('\n'),
    })
    ackIds(repoRoot, ['sync.rooms-per-document', 'access.not-found-not-forbidden', 'sync.old-rule'])

    expect(showLogicMap(repoRoot, undefined)).toEqual(
      [
        'logicmap: 2 rules in 2 domains. show <domain>: its rules and their claims; show <id>: one rule and its sites; show <file>[:<line>[-<line>]]: the rules in a file.',
        '',
        'access  1 rule  logicmap/access.md',
        '  access.not-found-not-forbidden  decision  inferred',
        '',
        'sync  1 rule (+1 retired)  logicmap/sync.md',
        '  The live document sync: the socket, the rooms and the snapshots. Code: src/sync/.',
        '  sync.rooms-per-document  decision',
      ].join('\n'),
    )
    expect(showLogicMap(repoRoot, 'sync')).toEqual(
      [
        'sync  1 rule (+1 retired)  logicmap/sync.md',
        '  The live document sync: the socket, the rooms and the snapshots. Code: src/sync/.',
        'sync.rooms-per-document@1  decision  ok  recorded  One room per open document.  (sites: 1)',
      ].join('\n'),
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
    expect(showLogicMap(repoRoot, 'src/billing.ts')).toEqual(
      [
        'billing.retry-skips-weekends@1  edge  inferred  A retry that falls on a weekend moves to Monday.',
        '  1-4  §edge  unacked',
        'billing.charge-in-cents@1  decision  unsourced  Amounts are integers in cents.',
        '  5-6  §decision  unacked',
      ].join('\n'),
    )
  })
})

describe('covered ranges', () => {
  test('a file lists each rule once with the lines each site covers; file:line keeps the rules covering it', () => {
    const repoRoot = createFixtureRepo({
      'src/room.ts': [
        'export const joinSocket = () => {',
        '  // §edge sync.close-during-join@1',
        '  if (closedEarly) {',
        '    joined.removeConnection(connection)',
        '    return',
        '  }',
        '  // §uses sync.close-during-join@1',
        '  flushPending()',
        '}',
        '',
      ].join('\n'),
      'src/plain.ts': 'export const plain = 1\n',
      'logicmap/sync.md': closeDuringJoinEntry(1),
    })
    ackIds(repoRoot, ['sync.close-during-join'])
    const ruleLine =
      'sync.close-during-join@1  edge  recorded  The socket can close while the join is loading.'

    expect(showLogicMap(repoRoot, 'src/room.ts')).toEqual(
      [ruleLine, '  2-6  §edge  ok', '  7-8  §uses  ok'].join('\n'),
    )
    expect(showLogicMap(repoRoot, 'src/room.ts:4')).toEqual(
      [ruleLine, '  2-6  §edge  ok'].join('\n'),
    )
    expect(showLogicMap(repoRoot, 'src/room.ts:6-7')).toEqual(
      [ruleLine, '  2-6  §edge  ok', '  7-8  §uses  ok'].join('\n'),
    )
    expect(showLogicMap(repoRoot, 'src/room.ts:9')).toEqual(
      'src/room.ts:9: no rule covers these lines',
    )
    expect(showLogicMap(repoRoot, 'src/plain.ts')).toEqual(
      'src/plain.ts has no anchors: no rule in the map is defined or used in it',
    )
  })
})

describe('claims', () => {
  test('a what that opens with a sentence over 200 characters warns long-what; detail after a short claim does not', () => {
    const longFirstSentence = `The socket can close while the join is loading${', and the room keeps it'.repeat(8)}.`
    const shortClaimThenDetail = `The socket can close while the join is loading. ${longFirstSentence}`
    const decisionEntry = (id: string, what: string, statusLines: string[]): string =>
      [
        `## ${id}`,
        'kind: decision',
        'version: 1',
        ...statusLines,
        `what: ${what}`,
        'why: fixture.',
        'source: fixture',
        '',
      ].join('\n')
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

describe('diff', () => {
  test("a changed site's hunks since the commit of its ack; from HEAD while the ack isn't committed", () => {
    const roomLines = [
      '// §edge sync.close-during-join@1',
      'if (closedEarly) {',
      '  joined.removeConnection(connection)',
      '}',
      ...Array.from({ length: 10 }, (_, lineIndex) => `const unrelated${lineIndex} = ${lineIndex}`),
      '',
    ]
    const repoRoot = createFixtureRepo({
      'src/room.ts': roomLines.join('\n'),
      'logicmap/sync.md': closeDuringJoinEntry(1),
    })
    ackIds(repoRoot, ['sync.close-during-join'])
    commitFixtureRepo(repoRoot, 'ack')
    const writeRoom = (): void =>
      writeFixtureFiles(repoRoot, { 'src/room.ts': roomLines.join('\n') })

    expect(diffLogicMap(repoRoot, 'sync.close-during-join')).toBe(
      'sync.close-during-join: no site in the lock changed since its last ack',
    )

    roomLines[2] = '  joined.dropConnection(connection)'
    roomLines[12] = 'const unrelated8 = 80'
    writeRoom()
    const committedAckDiff = diffLogicMap(repoRoot, 'sync.close-during-join')
    expect(committedAckDiff).toContain('since the ack in')
    expect(committedAckDiff).toContain('+  joined.dropConnection(connection)')
    expect(committedAckDiff).not.toContain('unrelated8 = 80')

    ackIds(repoRoot, ['sync.close-during-join'])
    roomLines[2] = '  joined.forgetConnection(connection)'
    writeRoom()
    const uncommittedAckDiff = diffLogicMap(repoRoot, 'sync.close-during-join')
    expect(uncommittedAckDiff).toContain('the ack is not committed yet, so from HEAD')
    expect(uncommittedAckDiff).toContain('+  joined.forgetConnection(connection)')
  })
})

describe('why', () => {
  test("a line's commits, newest first; one added since HEAD is not committed yet; lines added above it are followed", () => {
    const roomLines = [
      'const room = new Map()',
      'export const joinRoom = () => {',
      '  return room.size',
      '}',
      '',
    ]
    const repoRoot = createFixtureRepo({ 'src/room.ts': roomLines.join('\n') })
    const writeRoom = (): void =>
      writeFixtureFiles(repoRoot, { 'src/room.ts': roomLines.join('\n') })
    commitFixtureRepo(repoRoot, 'wip: the room')
    roomLines[2] = '  return room.size + 1'
    writeRoom()
    commitFixtureRepo(repoRoot, 'wip: the joiner counted')

    const returnLineWhy = whyLogicMap(repoRoot, 'src/room.ts:3')
    expect(returnLineWhy).toMatch(/\d{4}-\d{2}-\d{2} [0-9a-f]{7,} wip: the joiner counted/)
    expect(returnLineWhy.indexOf('wip: the joiner counted')).toBeLessThan(
      returnLineWhy.indexOf('wip: the room'),
    )
    expect(whyLogicMap(repoRoot, 'src/room.ts:1')).not.toContain('wip: the joiner counted')

    roomLines.unshift('// the rooms of the open documents')
    writeRoom()
    const movedLineWhy = whyLogicMap(repoRoot, 'src/room.ts:4')
    expect(movedLineWhy).toContain('wip: the joiner counted')
    expect(movedLineWhy).toContain('wip: the room')
    expect(whyLogicMap(repoRoot, 'src/room.ts:1')).toContain('not committed yet')
    writeFixtureFiles(repoRoot, { 'src/fresh.ts': 'export const fresh = 1\n' })
    expect(whyLogicMap(repoRoot, 'src/fresh.ts:1')).toContain('not committed yet')
  })

  test("each commit with its piece: by its code, else by its Where; a green piece with the red one's Why; the goal", () => {
    const roomLines = [
      'const room = new Map()',
      'export const joinRoom = () => {',
      '  return room.size',
      '}',
      '',
    ]
    const repoRoot = createFixtureRepo({ 'src/room.ts': roomLines.join('\n') })
    const writeRoom = (): void =>
      writeFixtureFiles(repoRoot, { 'src/room.ts': roomLines.join('\n') })
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
        'Why: the smallest change that passes; a counter kept beside the map was rejected.',
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
        '  Why: the smallest change that passes; a counter kept beside the map was rejected.',
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

  test('of the pieces holding the code, one naming the file; of those naming it, the nearest Where', () => {
    const roomLines = [
      ...Array.from(
        { length: 30 },
        (_, lineIndex) => `const line${lineIndex + 1} = ${lineIndex + 1}`,
      ),
      '',
    ]
    const repoRoot = createFixtureRepo({ 'src/room.ts': roomLines.join('\n') })
    const writeRoom = (): void =>
      writeFixtureFiles(repoRoot, { 'src/room.ts': roomLines.join('\n') })
    commitFixtureRepo(repoRoot, 'wip: the room')
    roomLines[19] = "const line20 = 'twenty'"
    writeRoom()
    writeFixtureFiles(repoRoot, {
      'notes/map.md': [
        '## Bucata 1: the anchors',
        '```ts',
        "const line20 = 'twenty'",
        '```',
        '',
      ].join('\n'),
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

  test("a rule's rejected alternatives are printed under its why, in a line's why and in the rule's", () => {
    const repoRoot = createFixtureRepo({
      'src/room.ts': [
        'export const joinSocket = () => {',
        '  // §edge sync.close-during-join@1',
        '  if (closedEarly) {',
        '    joined.removeConnection(connection)',
        '  }',
        '  // §edge sync.pooled-buffer-slice@1',
        '  decode(message)',
        '}',
        '',
      ].join('\n'),
      'logicmap/sync.md': [
        '# sync',
        '',
        closeDuringJoinEntry(1).replace(
          'source: fixture',
          'rejected: removing the connection in the close handler → the join adds it back after.\nsource: fixture',
        ),
        pooledBufferSliceEntry,
      ].join('\n'),
    })
    ackIds(repoRoot, ['sync.close-during-join', 'sync.pooled-buffer-slice'])
    commitFixtureRepo(repoRoot, 'wip: the join')
    const whyAndRejectedLines = [
      '  why: The join adds the connection before it resolves.',
      '  rejected: removing the connection in the close handler → the join adds it back after.',
    ].join('\n')

    expect(whyLogicMap(repoRoot, 'src/room.ts:4')).toContain(
      [
        'sync.close-during-join@1  edge  recorded  The socket can close while the join is loading.',
        whyAndRejectedLines,
        '  2-5  §edge  ok',
      ].join('\n'),
    )
    expect(whyLogicMap(repoRoot, 'sync.close-during-join')).toContain(
      `The socket can close while the join is loading.\n${whyAndRejectedLines}\n`,
    )
    expect(whyLogicMap(repoRoot, 'src/room.ts:7')).toContain(
      '  why: The decoder must read exactly this message.\n  6-7  §edge  ok',
    )
  })

  test("a declaration's why: its lines in the file as it is now, up to the next declaration's comment", () => {
    const roomLines = [
      'export const joinRoom = () => {',
      '  return rooms.size',
      '}',
      '',
      '// Leaving empties the room.',
      'export const leaveRoom = () => {',
      '  rooms.clear()',
      '}',
      '',
    ]
    const repoRoot = createFixtureRepo({ 'src/room.ts': roomLines.join('\n') })
    const writeRoom = (): void =>
      writeFixtureFiles(repoRoot, { 'src/room.ts': roomLines.join('\n') })
    commitFixtureRepo(repoRoot, 'wip: the rooms')
    roomLines[6] = '  rooms.delete(roomId)'
    writeRoom()
    commitFixtureRepo(repoRoot, 'wip: a leave deletes its room')
    roomLines.unshift('// the rooms of the open documents')
    writeRoom()

    const leaveWhy = whyLogicMap(repoRoot, 'src/room.ts:leaveRoom')
    expect(leaveWhy).toStartWith('src/room.ts:leaveRoom (7-9) (6-8 in HEAD): 2 commits')
    expect(leaveWhy).toContain('wip: a leave deletes its room')
    expect(whyLogicMap(repoRoot, 'src/room.ts:joinRoom')).toStartWith(
      'src/room.ts:joinRoom (2-4) (1-3 in HEAD): 1 commit',
    )
    expect(whyLogicMap(repoRoot, 'src/room.ts:enterRoom')).toBe(
      'no line at the top level of src/room.ts names enterRoom',
    )
  })

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
      'plans/02-other/01-other.md': [
        '## Piece 1: another change',
        'What: nothing about the join.',
        '',
      ].join('\n'),
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
      [
        'wip: the join mapped',
        '  plans/01-the-join/01-the-edge.md',
        '  ## Piece 1: the edge mapped',
      ].join('\n'),
    )
    expect(whyLogicMap(repoRoot, 'sync.nope')).toBe(
      'sync.nope is neither a rule of logicmap/ nor <file>:<line>[-<line>] or <file>:<name>',
    )
  })

  test("a merge whose two sides changed the lines is left out; its sides' commits are listed", () => {
    const roomLines = ['const a = 1', 'const b = 2', 'const c = 3', 'const d = 4', '']
    const repoRoot = createFixtureRepo({ 'src/room.ts': roomLines.join('\n') })
    const writeRoom = (): void =>
      writeFixtureFiles(repoRoot, { 'src/room.ts': roomLines.join('\n') })
    const runFixtureGit = (gitArguments: string[]): void => {
      execFileSync(
        'git',
        ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', ...gitArguments],
        {
          cwd: repoRoot,
          stdio: 'ignore',
        },
      )
    }
    commitFixtureRepo(repoRoot, 'wip: the room')
    runFixtureGit(['checkout', '--quiet', '-b', 'side'])
    roomLines[1] = 'const b = 20'
    writeRoom()
    commitFixtureRepo(repoRoot, 'wip: b on the side')
    runFixtureGit(['checkout', '--quiet', '-'])
    roomLines[1] = 'const b = 2'
    roomLines[3] = 'const d = 40'
    writeRoom()
    commitFixtureRepo(repoRoot, 'wip: d on the trunk')
    runFixtureGit(['merge', '--quiet', '--no-ff', 'side', '-m', 'Merge branch side'])

    const roomWhy = whyLogicMap(repoRoot, 'src/room.ts:1-4')
    expect(roomWhy).toStartWith('src/room.ts:1-4: 3 commits, newest first')
    expect(roomWhy).not.toContain('Merge branch side')
  })

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
})

describe('hook', () => {
  const createMappedRepo = (): string => {
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
    return repoRoot
  }

  test('after a read, the rules covering the lines read; none for lines no rule covers', () => {
    const repoRoot = createMappedRepo()
    const roomPath = join(repoRoot, 'src/room.ts')
    const readOf = (toolInput: Record<string, unknown>) =>
      respondToHook({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: toolInput })

    expect(readOf({ file_path: roomPath })).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: [
          'logicmap: the rules covering src/room.ts (logicmap show <id> for the full entry):',
          'sync.close-during-join@1  edge  recorded  The socket can close while the join is loading.',
          '  2-5  §edge  ok',
        ].join('\n'),
      },
    })
    expect(readOf({ file_path: roomPath, offset: 4, limit: 1 })).not.toBeNull()
    expect(readOf({ file_path: roomPath, offset: 6, limit: 2 })).toBeNull()
  })

  test('a session sees a rule in full once; read again, it is named in one line; bumped, it is in full again', () => {
    const repoRoot = createMappedRepo()
    const roomPath = join(repoRoot, 'src/room.ts')
    const sessionId = `reading-${crypto.randomUUID()}`
    const contextOfRead = (readingSessionId: string): string =>
      JSON.stringify(
        respondToHook({
          hook_event_name: 'PostToolUse',
          session_id: readingSessionId,
          tool_name: 'Read',
          tool_input: { file_path: roomPath },
        }),
      )
    const fullRuleText = 'sync.close-during-join@1  edge  recorded  The socket can close'

    expect(contextOfRead(sessionId)).toContain(fullRuleText)
    const secondReadContext = contextOfRead(sessionId)
    expect(secondReadContext).not.toContain(fullRuleText)
    expect(secondReadContext).toContain(
      'rules shown earlier this session: sync.close-during-join@1',
    )
    expect(contextOfRead(`another-${crypto.randomUUID()}`)).toContain(fullRuleText)

    const roomText = readFixtureFile(repoRoot, 'src/room.ts')
    writeFixtureFiles(repoRoot, {
      'src/room.ts': roomText.replace('close-during-join@1', 'close-during-join@2'),
      'logicmap/sync.md': closeDuringJoinEntry(2),
    })
    expect(contextOfRead(sessionId)).toContain('sync.close-during-join@2  edge  recorded')
  })

  test('after a read of committed code, once per file and session, the newest change of the lines and the why command', () => {
    const repoRoot = createMappedRepo()
    const roomPath = join(repoRoot, 'src/room.ts')
    writeFixtureFiles(repoRoot, {
      'src/other.ts': 'export const other = 1\n',
      'plans/01-the-join/01-the-edge.md': [
        '## Piece 1: the join drops a closed socket',
        'What: the branch.',
        'Where: `src/room.ts:3-5`',
        '',
      ].join('\n'),
    })
    commitFixtureRepo(repoRoot, 'wip: the join drops a socket closed meanwhile')
    writeFixtureFiles(repoRoot, { 'src/plain.ts': 'export const plain = 1\n' })
    const sessionId = `reading-${crypto.randomUUID()}`
    const contextOfRead = (readingSessionId: string, toolInput: Record<string, unknown>) => {
      const hookOutput = respondToHook({
        hook_event_name: 'PostToolUse',
        session_id: readingSessionId,
        tool_name: 'Read',
        tool_input: toolInput,
      })
      return hookOutput !== null && 'hookSpecificOutput' in hookOutput
        ? hookOutput.hookSpecificOutput.additionalContext
        : null
    }

    const firstRead = contextOfRead(sessionId, { file_path: roomPath, offset: 3, limit: 3 })
    expect(firstRead).toStartWith('logicmap: the rules covering src/room.ts')
    expect(firstRead).toMatch(
      /\nlogicmap: last changed by [0-9a-f]{7,} on \d{4}-\d{2}-\d{2}, "wip: the join drops a socket closed meanwhile", recorded as Piece 1 in plans\/01-the-join\/01-the-edge\.md\. logicmap why src\/room\.ts:3-5 gives every commit of these lines with its reason\.$/,
    )
    expect(contextOfRead(sessionId, { file_path: roomPath, offset: 3, limit: 3 })).not.toContain(
      'last changed by',
    )
    expect(contextOfRead(`another-${crypto.randomUUID()}`, { file_path: roomPath })).toContain(
      'logicmap why src/room.ts:<line> or src/room.ts:<name> gives every commit of a line or a declaration with its reason.',
    )
    expect(contextOfRead(sessionId, { file_path: join(repoRoot, 'src/other.ts') })).toStartWith(
      'logicmap: last changed by',
    )
    expect(contextOfRead(sessionId, { file_path: join(repoRoot, 'src/plain.ts') })).toBeNull()
  })

  test('after an edit, the problems of the rules in that file; nothing when they still match', () => {
    const repoRoot = createMappedRepo()
    const roomPath = join(repoRoot, 'src/room.ts')
    const editOf = () =>
      respondToHook({
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: roomPath },
      })

    expect(editOf()).toBeNull()

    const roomText = readFixtureFile(repoRoot, 'src/room.ts')
    writeFixtureFiles(repoRoot, {
      'src/room.ts': roomText.replace('removeConnection', 'dropConnection'),
    })
    const editOutput = editOf()
    expect(editOutput).not.toBeNull()
    expect(JSON.stringify(editOutput)).toContain('src/room.ts:2: error changed')
  })

  test('after an edit under a uses or test site, its rule, once per file and session; nothing where check speaks', () => {
    const repoRoot = createMappedRepo()
    writeFixtureFiles(repoRoot, {
      'src/caller.ts': [
        'export const leave = () => {',
        '  // §uses sync.close-during-join@1',
        '  closeSocket()',
        '  log()',
        '}',
        '',
      ].join('\n'),
      'src/room.test.ts': [
        '// §test sync.close-during-join@1',
        "test('a socket closed meanwhile is removed', () => {",
        '  expect(rooms.size).toBe(0)',
        '})',
        '',
      ].join('\n'),
    })
    commitFixtureRepo(repoRoot, 'wip: the join')
    const sessionId = `editing-${crypto.randomUUID()}`
    const contextOfEdit = (editingSessionId: string, file: string, from: string, to: string) => {
      writeFixtureFiles(repoRoot, { [file]: readFixtureFile(repoRoot, file).replace(from, to) })
      const hookOutput = respondToHook({
        hook_event_name: 'PostToolUse',
        session_id: editingSessionId,
        tool_name: 'Edit',
        tool_input: { file_path: join(repoRoot, file) },
      })
      return hookOutput !== null && 'hookSpecificOutput' in hookOutput
        ? hookOutput.hookSpecificOutput.additionalContext
        : null
    }
    const ruleLine =
      'sync.close-during-join@1  edge  recorded  The socket can close while the join is loading.'

    expect(
      contextOfEdit(`another-${crypto.randomUUID()}`, 'src/caller.ts', 'log()', 'log(1)'),
    ).toBeNull()
    const callerEdit = contextOfEdit(
      sessionId,
      'src/caller.ts',
      'closeSocket()',
      'closeSocket(true)',
    )
    expect(callerEdit).toStartWith(
      "logicmap: the edit to src/caller.ts changed lines under these rules' uses or test sites, which check doesn't fingerprint.",
    )
    expect(callerEdit).toEndWith(`\n${ruleLine}\n  2-3  §uses  ok`)
    expect(
      contextOfEdit(sessionId, 'src/caller.ts', 'closeSocket(true)', 'closeSocket(false)'),
    ).toBeNull()
    expect(contextOfEdit(sessionId, 'src/room.test.ts', 'toBe(0)', 'toBe(1)')).toEndWith(
      `\n${ruleLine}\n  1-4  §test  ok`,
    )

    const definingEdit = contextOfEdit(
      sessionId,
      'src/room.ts',
      'removeConnection',
      'dropConnection',
    )
    expect(definingEdit).toContain('src/room.ts:2: error changed')
    expect(definingEdit).not.toContain('uses or test sites')

    writeFixtureFiles(repoRoot, {
      'src/new.ts': '// §uses sync.close-during-join@1\nexport const fresh = () => close()\n',
    })
    expect(contextOfEdit(sessionId, 'src/new.ts', 'close()', 'close(true)')).toBeNull()
  })

  test('at stop, the errors of check, once, for a session that edited the repo; nothing outside one', () => {
    const repoRoot = createMappedRepo()
    const roomPath = join(repoRoot, 'src/room.ts')
    const roomText = readFixtureFile(repoRoot, 'src/room.ts')
    writeFixtureFiles(repoRoot, {
      'src/room.ts': roomText.replace('removeConnection', 'dropConnection'),
    })
    const editingSessionId = `editing-${crypto.randomUUID()}`
    const readingSessionId = `reading-${crypto.randomUUID()}`
    const stopOf = (sessionId: string, isStopHookActive: boolean) =>
      respondToHook({
        hook_event_name: 'Stop',
        session_id: sessionId,
        cwd: repoRoot,
        stop_hook_active: isStopHookActive,
      })
    respondToHook({
      hook_event_name: 'PostToolUse',
      session_id: editingSessionId,
      tool_name: 'Edit',
      tool_input: { file_path: roomPath },
    })

    expect(stopOf(readingSessionId, false)).toBeNull()
    expect(stopOf(editingSessionId, true)).toBeNull()
    const stopOutput = stopOf(editingSessionId, false)
    expect(stopOutput).toMatchObject({ decision: 'block' })
    expect(JSON.stringify(stopOutput)).toContain('src/room.ts:2: error changed')
    expect(stopOf(editingSessionId, false)).toBeNull()

    const plainRepoRoot = createFixtureRepo({ 'src/plain.ts': 'export const plain = 1\n' })
    expect(respondToHook({ hook_event_name: 'Stop', cwd: plainRepoRoot })).toBeNull()
    expect(
      respondToHook({
        hook_event_name: 'PostToolUse',
        tool_name: 'Read',
        tool_input: { file_path: join(plainRepoRoot, 'src/plain.ts') },
      }),
    ).toBeNull()
  })
})
