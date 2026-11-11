# Step 3: `check` shows the claim and the change under a changed site

Before: `bun test` 59 pass.

## Piece 1: the failing test
What: in `describe('diff')`: fourteen sites acked and committed, then every one edited. Under the changed site of
`src/room.ts`: the claim, "the change, since the ack in <commit>", the removed and the added line. Under the one of
`src/long.ts`, whose block has 30 lines: 20 lines of diff and a line counting the rest. The eleventh changed site
says where the others' changes are; the twelfth has nothing; no other problem (the `untested` warnings) has any.
Why: plan, decision 3.
Where: `scripts/logicmap.test.ts`, at the end of `describe('diff')`
```ts
  test('check gives, under a changed site, the claim and the change, cut at twenty lines; nothing under another problem or past the tenth site', () => {
    const ruleNumbers = Array.from({ length: 12 }, (_, ruleIndex) =>
      String(ruleIndex + 1).padStart(2, '0'),
    )
    const codeFilesHolding = (value: string): Record<string, string> => ({
      'src/long.ts': [
        '// §edge sync.pooled-buffer-slice@1',
        'if (pooled) {',
        ...Array.from({ length: 30 }, (_, lineIndex) => `  readByte(${lineIndex}, ${value})`),
        '}',
        '',
      ].join('\n'),
      'src/room.ts': [
        '// §edge sync.close-during-join@1',
        'if (closedEarly) {',
        `  joined.removeConnection(${value})`,
        '}',
        '',
      ].join('\n'),
      'src/rules.ts': ruleNumbers
        .flatMap((ruleNumber) => [
          `// §decision sync.rule-${ruleNumber}@1`,
          `const rule${ruleNumber} = ${value}`,
        ])
        .join('\n'),
    })
    const repoRoot = createFixtureRepo({
      ...codeFilesHolding('1'),
      'logicmap/sync.md': [
        closeDuringJoinEntry(1),
        pooledBufferSliceEntry,
        ...ruleNumbers.map((ruleNumber) =>
          [
            `## sync.rule-${ruleNumber}`,
            'kind: decision',
            'version: 1',
            'what: A rule.',
            'why: fixture.',
            'source: fixture',
            '',
          ].join('\n'),
        ),
      ].join('\n'),
    })
    ackIds(repoRoot, [
      'sync.close-during-join',
      'sync.pooled-buffer-slice',
      ...ruleNumbers.map((ruleNumber) => `sync.rule-${ruleNumber}`),
    ])
    commitFixtureRepo(repoRoot, 'ack')
    writeFixtureFiles(repoRoot, codeFilesHolding('2'))

    const { problems, changeLinesByProblem } = checkRepoWithChanges(repoRoot)
    const changedProblems = problems.filter((problem) => problem.code === PROBLEM_CODES.changed)
    const changeLinesByPlace = new Map(
      changedProblems.map((problem) => [
        `${problem.file}:${problem.line}`,
        changeLinesByProblem.get(problem) ?? [],
      ]),
    )
    expect(changedProblems).toHaveLength(14)

    const roomChangeLines = changeLinesByPlace.get('src/room.ts:1') ?? []
    expect(roomChangeLines[0]).toBe('    claim: The socket can close while the join is loading.')
    expect(roomChangeLines[1]).toMatch(/^ {4}the change, since the ack in [0-9a-f]+:$/)
    expect(roomChangeLines).toContain('    -  joined.removeConnection(1)')
    expect(roomChangeLines).toContain('    +  joined.removeConnection(2)')

    const longChangeLines = changeLinesByPlace.get('src/long.ts:1') ?? []
    expect(longChangeLines).toHaveLength(23)
    expect(longChangeLines[22]).toMatch(
      /^ {4}\.\.\. \d+ more lines: logicmap diff sync\.pooled-buffer-slice$/,
    )

    expect(changeLinesByPlace.get('src/rules.ts:15')?.[0]).toBe('    claim: A rule.')
    expect(changeLinesByPlace.get('src/rules.ts:17')).toEqual([
      '    the claim and the change are printed under the first 10 changed sites: logicmap diff <id> prints any other',
    ])
    expect(changeLinesByPlace.get('src/rules.ts:19')).toEqual([])
    const otherProblems = problems.filter((problem) => problem.code !== PROBLEM_CODES.changed)
    expect(otherProblems.length).toBeGreaterThan(0)
    expect(otherProblems.some((problem) => changeLinesByProblem.has(problem))).toBe(false)
  })
```
Run (red): `bun test -t "check gives, under a changed site"`: 0 pass, 1 fail, `Export named
'checkRepoWithChanges' not found`.

## Piece 2: a changed site described once, for `diff` and for `check`
What: `describeSiteChange(repoRoot, lockSite, lockedSite)` is taken out of `diffLogicMap`: the commit of the site's
ack, said in words, and the hunks of the file's diff from it that meet the site's lines. `diffLogicMap` prints it
as before. `checkRepoWithChanges(repoRoot)` returns `check`'s problems and, for the first ten `changed` ones, the
lines to print under each: the claim, "the change, <since when>:", at most twenty lines of the hunks, the count of
the rest; the eleventh gets one line naming `diff <id>`. One analysis serves the problems and the changes. The
command line's `check` prints the lines under their problem.
Why: plan, decision 3: the ack that follows a `changed` is given with the claim and the change in view, without a
second command.
Where: `scripts/logicmap.ts`: the Diff section (`describeSiteChange`, `diffLogicMap`, `checkRepoWithChanges`),
`runCommandLine`
```ts
const NO_HUNK_LINE = 'no hunk meets these lines (an untracked file has no diff)'

// Since when a changed site is compared, and the hunks of its file's diff from then that meet its lines.
const describeSiteChange = (
  repoRoot: string,
  lockSite: LockSite,
  lockedSite: LockedSite,
): { sinceNote: string; siteLines: LineRange; hunks: string[] } => {
  const lockLine = `${lockSite.key} ${lockedSite.version} ${lockedSite.fingerprint}`
  const ackCommit = findAckCommit(repoRoot, lockedSite.file, lockLine)
  const sinceNote =
    ackCommit === null
      ? 'the ack is not committed yet, so from HEAD'
      : `since the ack in ${ackCommit}`
  const diffText = runGit(repoRoot, ['diff', '-U2', ackCommit ?? 'HEAD', '--', lockSite.file])
  const siteLines = { firstLine: lockSite.line, lastLine: lockSite.lastLine }
  return { sinceNote, siteLines, hunks: hunksMeetingLines(diffText, siteLines) }
}
```
```ts
// check prints the claim and the change under this many changed sites, this many lines of diff each.
const CHANGES_MAX_DESCRIBED = 10
const CHANGE_MAX_DIFF_LINES = 20
const CHANGE_INDENT = '    '

// Every problem check reports and, for a changed site, what the ack after it is given against: the rule's claim
// and the diff under the site since its ack.
export const checkRepoWithChanges = (
  repoRoot: string,
): { problems: Problem[]; changeLinesByProblem: Map<Problem, string[]> } => {
  const analysis = analyzeRepo(repoRoot)
  const problems = findAllProblems(repoRoot, analysis)
  const lockedSitesByKey = readLock(repoRoot)
  const describeChange = (changedProblem: Problem): string[] => {
    const lockSite = analysis.lockSites.find(
      (candidateSite) =>
        candidateSite.id === changedProblem.id &&
        candidateSite.file === changedProblem.file &&
        candidateSite.line === changedProblem.line,
    )
    const lockedSite = lockSite === undefined ? undefined : lockedSitesByKey.get(lockSite.key)
    if (lockSite === undefined || lockedSite === undefined) {
      return []
    }
    const claim = analysis.entriesById.get(lockSite.id)?.claim ?? ''
    const { sinceNote, hunks } = describeSiteChange(repoRoot, lockSite, lockedSite)
    const diffLines = hunks.flatMap((hunkText) => hunkText.trimEnd().split('\n'))
    const leftOutCount = diffLines.length - CHANGE_MAX_DIFF_LINES
    const leftOutLines =
      leftOutCount > 0
        ? [`... ${countOf(leftOutCount, 'more line')}: logicmap diff ${lockSite.id}`]
        : []
    return [
      `claim: ${claim}`,
      `the change, ${sinceNote}:`,
      ...(diffLines.length === 0 ? [NO_HUNK_LINE] : diffLines.slice(0, CHANGE_MAX_DIFF_LINES)),
      ...leftOutLines,
    ].map((changeLine) => `${CHANGE_INDENT}${changeLine}`)
  }
  const restNoteLine = `${CHANGE_INDENT}the claim and the change are printed under the first ${CHANGES_MAX_DESCRIBED} changed sites: logicmap diff <id> prints any other`
  const changeLinesByProblem = new Map(
    problems
      .filter((problem) => problem.code === PROBLEM_CODES.changed)
      .slice(0, CHANGES_MAX_DESCRIBED + 1)
      .map((changedProblem, changedIndex): [Problem, string[]] => [
        changedProblem,
        changedIndex < CHANGES_MAX_DESCRIBED ? describeChange(changedProblem) : [restNoteLine],
      ]),
  )
  return { problems, changeLinesByProblem }
}
```
```diff
   if (command === 'check') {
-    const problems = checkRepo(repoRoot)
-    problems.forEach(printProblem)
+    const { problems, changeLinesByProblem } = checkRepoWithChanges(repoRoot)
+    for (const problem of problems) {
+      printProblem(problem)
+      for (const changeLine of changeLinesByProblem.get(problem) ?? []) {
+        console.log(changeLine)
+      }
+    }
```
Run (green): `bun test`: 60 pass, 0 fail.
