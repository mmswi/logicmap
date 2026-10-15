# Step 3: covered ranges, one rule per block in a file, `file:line`

## Piece 1: tests — ranges, a file's rules, the rules at a line

What: the existing views now expect ranges (`web/sync-provider.ts:1-2  §flow ...`) and the file view
one line per rule with its sites under it; a new test on a function with an `edge` anchor over the
`if` (lines 2-6) and a `uses` anchor over the next line (7-8): the whole file, line 4 (only the
`edge` site), lines 6-7 (both), line 9 (no rule) and a file with no anchors.
Why: with the range in front of it, an agent knows whether the line it will edit is under a rule; with
`file:line` it asks the map about the exact lines it is reading or debugging.
Where: `scripts/logicmap.test.ts`: `describe('show')`, `describe('provenance')`, a new
`describe('covered ranges')`.

```ts
    const ruleLine =
      'sync.close-during-join@1  edge  recorded  The socket can close while the join is loading.'

    expect(showLogicMap(repoRoot, 'src/room.ts')).toEqual(
      [ruleLine, '  2-6  §edge  ok', '  7-8  §uses  ok'].join('\n'),
    )
    expect(showLogicMap(repoRoot, 'src/room.ts:4')).toEqual([ruleLine, '  2-6  §edge  ok'].join('\n'))
    expect(showLogicMap(repoRoot, 'src/room.ts:6-7')).toEqual(
      [ruleLine, '  2-6  §edge  ok', '  7-8  §uses  ok'].join('\n'),
    )
    expect(showLogicMap(repoRoot, 'src/room.ts:9')).toEqual(
      'src/room.ts:9: no rule covers these lines',
    )
    expect(showLogicMap(repoRoot, 'src/plain.ts')).toEqual(
      'src/plain.ts has no anchors: no rule in the map is defined or used in it',
    )
```

Red: 17 pass, 3 fail (the two updated views and the new test).

## Piece 2: each site keeps the last line it covers

What: `findAnchoredLines` returns the range (`headLineIndex`, `lastLineIndex`) instead of the lines, as
`findAnchoredLineRange`; `collectLockSites` slices the lines for the fingerprint and stores
`lastLine` on each site (an entry's last line for an entry).
Why: the fingerprint and the range are the same span; computing it once keeps them identical.
Where: `scripts/logicmap.ts`, `LockSite`, `findAnchoredLineRange`, `collectLockSites`.

```diff
-const findAnchoredLines = (fileLines: string[], anchorLineIndex: number): string[] => {
+type AnchoredLineRange = { headLineIndex: number; lastLineIndex: number }
+
+const findAnchoredLineRange = (
+  fileLines: string[],
+  anchorLineIndex: number,
+): AnchoredLineRange | null => {
 // ...unchanged...
   if (headLineIndex === -1) {
-    return []
+    return null
   }
 // ...unchanged...
-  return fileLines.slice(headLineIndex, lastLineIndex + 1)
+  return { headLineIndex, lastLineIndex }
 }
 // ...in collectLockSites...
+    const anchoredLineRange = findAnchoredLineRange(fileLines, anchor.line - 1)
+    const anchoredLines =
+      anchoredLineRange === null
+        ? []
+        : fileLines.slice(anchoredLineRange.headLineIndex, anchoredLineRange.lastLineIndex + 1)
     lockSites.push({
 // ...
-      fingerprint: fingerprintLines(findAnchoredLines(fileLines, anchor.line - 1)),
+      fingerprint: fingerprintLines(anchoredLines),
       file: anchor.file,
       line: anchor.line,
+      lastLine: anchoredLineRange === null ? anchor.line : anchoredLineRange.lastLineIndex + 1,
```

## Piece 3: the views

What: a site prints `start-end` (the anchor's line through its block's last line); `show <file>` lists
each rule once (`id@version  kind  provenance  claim`) with its sites under it; `file:<line>` and
`file:<start>-<end>` keep only the sites whose lines meet the request; an existing file with no anchors
says so; the command line keeps a `:<line>` suffix when it turns a typed path into a repo path.
Why: the old file view printed every site's whole `what`, 15 KB for `src/documents/routes.ts`; it is
8 KB now and shrinks with the claims. `show src/documents/routes.ts:404` answers which rule covers the
template check: `access.one-predicate-per-action`, its site `395-415`.
Where: `scripts/logicmap.ts`: `LineRange`, `describeLineRange`, `doLineRangesMeet`,
`FILE_LINES_TARGET_PATTERN` above `showLogicMap`; `siteStatusOf`, `coveredLinesOf`, `describeSite`,
`showFileRules`, `isAnchoredFile`, `describeUnanchoredFile` and the dispatch in it; `toShowTarget`.

```ts
  // Each rule once, in the order its first site appears, with every site in the requested lines under it.
  const showFileRules = (file: string, requestedLines: LineRange | null): string => {
    const fileAnchors = analysis.anchors.filter((anchor) => anchor.file === file)
    const shownAnchors =
      requestedLines === null
        ? fileAnchors
        : fileAnchors.filter((anchor) => doLineRangesMeet(coveredLinesOf(anchor), requestedLines))
    if (requestedLines !== null && shownAnchors.length === 0) {
      return `${file}:${describeLineRange(requestedLines)}: no rule covers these lines`
    }
    const anchorsById = Map.groupBy(shownAnchors, (anchor) => anchor.id)
    const ruleSections = [...anchorsById].map(([id, ruleAnchors]) => {
      const entry = analysis.entriesById.get(id)
      const ruleLine =
        entry === undefined
          ? `${id}  (no entry)`
          : `${id}@${entry.version ?? '?'}  ${entry.kind ?? '?'}  ${entry.provenance}  ${entry.claim}`
      const siteLines = ruleAnchors.map((anchor) => {
        const stepNote = anchor.step === null ? '' : ` #${anchor.step}`
        return `  ${describeLineRange(coveredLinesOf(anchor))}  §${anchor.role}${stepNote}  ${siteStatusOf(anchor)}`
      })
      return [ruleLine, ...siteLines].join('\n')
    })
    return ruleSections.join('\n')
  }
```

```diff
-  const isAnchoredFile = analysis.anchors.some((anchor) => anchor.file === target)
-  if (isAnchoredFile) {
-    return showOneFile(target)
-  }
+  const [, fileOfLines, firstLineText, lastLineText] = FILE_LINES_TARGET_PATTERN.exec(target) ?? []
+  if (fileOfLines !== undefined && isAnchoredFile(fileOfLines)) {
+    const firstLine = Number(firstLineText)
+    const lastLine = lastLineText === undefined ? firstLine : Number(lastLineText)
+    return showFileRules(fileOfLines, { firstLine, lastLine })
+  }
+  if (isAnchoredFile(target)) {
+    return showFileRules(target, null)
+  }
 // ...id, domain...
+  const unanchoredFile = fileOfLines ?? target
+  if (existsSync(join(repoRoot, unanchoredFile))) {
+    return describeUnanchoredFile(unanchoredFile)
+  }
```

Green: 20 pass, 0 fail. On teamabled: `show` 10.6 KB (was 71.6 KB), `show documents` 19.8 KB,
`show src/documents/routes.ts` 8.2 KB (was 15 KB), and `show routes.ts:404` from `src/documents/`
prints the one rule at that line.

## Piece 4 (step 3b): test — another session's lock edit survives an ack elsewhere

What: two domains acked; a comment line is appended to `access.lock` (what another session's ack would
leave there); acking the `sync` id must leave `access.lock` byte for byte as it is.
Why: every ack rewrote every domain's lock file from what it had read, so an ack running at the same
time in another domain could lose its lines.
Where: `scripts/logicmap.test.ts`, `describe('lock')`, before the deletion test.

```ts
    ackIds(repoRoot, ['sync.close-during-join', 'access.not-found-not-forbidden'])
    // What another session's ack, landing in between, leaves in access.lock.
    const accessLockWithNote = `${readFixtureFile(repoRoot, 'logicmap/access.lock')}# acked by another session\n`
    writeFixtureFiles(repoRoot, { 'logicmap/access.lock': accessLockWithNote })

    ackIds(repoRoot, ['sync.close-during-join'])

    expect(readFixtureFile(repoRoot, 'logicmap/access.lock')).toBe(accessLockWithNote)
```

Red: the note is gone after the second ack (20 pass, 1 fail).

## Piece 5 (step 3b): only the acked domains' lock files are written

Where: `scripts/logicmap.ts`, `ackIds`.

```diff
   const lockLinesByFile = Map.groupBy(lockLines, (lockLine) => lockFileOf(idOfLockKey(lockLine)))
+  // Only the acked ids' lock files are written, so two sessions acking different domains never overwrite
+  // each other's lines; splitting the single lock from before the split writes every domain's file.
+  const ackedLockFiles = new Set([...requestedIds].map(lockFileOf))
+  const isSplittingSingleLock = existsSync(join(repoRoot, SINGLE_LOCK_FILE_BEFORE_SPLIT))
   for (const [lockFile, domainLockLines] of lockLinesByFile) {
-    writeFileSync(join(repoRoot, lockFile), `${[LOCK_HEADER, ...domainLockLines].join('\n')}\n`)
+    const shouldWriteLockFile = isSplittingSingleLock || ackedLockFiles.has(lockFile)
+    if (shouldWriteLockFile) {
+      writeFileSync(join(repoRoot, lockFile), `${[LOCK_HEADER, ...domainLockLines].join('\n')}\n`)
+    }
   }
```

A lock file left with no line can only belong to an acked domain (its lines went because its ids were
acked) or be the old single lock, so the deletion loop after it stays as it was.

Green: 21 pass, 0 fail.
