# Step 2: the code fingerprint leaves out comments

## Piece 1: a reworded comment is no change; an old lock line still holds (the failing tests)
What: two tests in `lock`. The first acks a method whose block holds a `//` line, a `/* */` block over
three lines (its middle line without a leading `*`), a `#closedCount = 0` field and a `--retries` line:
the lock line carries `v2:`; rewording the `//` line and the block comment is no lock problem; editing the
field, or the decrement, is `changed`. The second starts from a lock as the checker of before wrote it
for the same code (its four fingerprints taken with the live checker of 2026-11-02, no prefix): `check`
finds nothing; with one site edited, an ack of the other id of the domain writes `v2:` for the acked one
and leaves the edited one's line as it was (`changed`); with the edit undone, the next ack renews that
line with `v2:` too, and an entry's line stays as it was.
Why: the literals come from the checker of before, not from this code, so the fallback is tested against
what is really on disk in teamabled today.
Where: `scripts/logicmap.test.ts:467`, `:507`
```ts
    replaceRoomLine(3, '    // A socket that closed while the room loaded is still in it.')
    replaceRoomLine(5, '      join → close → load → remove')
    expect(describeLockProblems(repoRoot)).toEqual([])

    replaceRoomLine(7, '    #closedCount = 1')
    expect(describeLockProblems(repoRoot)).toEqual(['changed src/room.ts:2'])
```
Run: red, 2 fail (`toMatch(... v2: ...)`).

## Piece 2: `fingerprintCode`, and the lock line compared by the form it holds
What: `dropCommentLines` leaves out `//`, `# `, `-- ` and `<!--` lines and every line of a `/* */` or
`{/* */}` block; `fingerprintCode` hashes what is left as `fingerprintLines` does and prefixes `v2:`. A
site keeps both fingerprints (`fingerprintWithComments` for an entry is its only one); `isAsLocked`
compares a lock line with `v2:` to the new one, a line without it to the old one, so nothing in a repo
turns `changed` when the skill updates. An ack rewrites a kept line of a domain it writes when its code is
as locked, with the new fingerprint: the same code, so nothing is acked unread, and the old form dies out.
Why: the old algorithm stays until no lock line holds it. Rejected: re-acking every repo once (it would
bury real `changed` lines, such as another session's work in progress); one version for a whole lock file
(an ack of one id would have to re-verify every line). `#` and `--` need the space after them: in
TypeScript `#closedCount` is a private field and `--retries` a decrement.
Where: `scripts/logicmap.ts:585`, `:592`, `:608`, `:782`, `:896`
```ts
const dropCommentLines = (lines: string[]): string[] => {
  const codeLines: string[] = []
  let isInsideBlockComment = false
  for (const line of lines) {
    if (isInsideBlockComment || BLOCK_COMMENT_OPENING_LINE_PATTERN.test(line)) {
      isInsideBlockComment = !line.includes(BLOCK_COMMENT_END)
      continue
    }
    if (!COMMENT_ONLY_LINE_PATTERN.test(line)) {
      codeLines.push(line)
    }
  }
  return codeLines
}
// ...
const isAsLocked = (lockSite: LockSite, lockedSite: LockedSite): boolean => {
  const isLockedWithoutComments = lockedSite.fingerprint.startsWith(CODE_FINGERPRINT_PREFIX)
  const currentFingerprint = isLockedWithoutComments
    ? lockSite.fingerprint
    : lockSite.fingerprintWithComments
  return lockedSite.version === lockSite.version && lockedSite.fingerprint === currentFingerprint
}
```
Run: 27 pass; on teamabled the worktree's `check` prints what the live one does; strict tsc and biome
clean.
