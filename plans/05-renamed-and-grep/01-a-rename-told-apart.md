# Step 1: a rename is told apart from a change

## Piece 1: the failing lock tests
What: in `describe('lock')`, a site whose identifiers are renamed one for one (`closedEarly` → `closedBeforeJoin`,
`joined` → `joinedRoom`) reports `renamed`; renamed so that one identifier now stands for two (`closedBeforeJoin &&
closedBeforeJoin`), with a keyword changed (`return` → `continue`) or a string changed (`'closed'` → `'gone'`), it
reports `changed`. A `v2:` lock line reports `changed` for the same rename; an ack of another id of its domain renews
it to `v3:<code>.<shape>`, and the rename then reports `renamed`. The test of the `v2:` renewal from before expects
the `v3:` token an ack writes now. `renamed` joins the test file's lock problem codes.
Why: the decisions' reading of a rename, each way it could be confused with one.
Where: `scripts/logicmap.test.ts`, the lock tests
Run: red, the three fail as they should: an ack writes `v2:`, the rename reports `changed`, the `v2:` line is never
renewed to `v3:`.

## Piece 2: the shape fingerprint and `renamed`
What: `normalizeLines` (anchors, whitespace and their residue out, as `fingerprintLines` did) is shared by
`fingerprintLines` and the new `shapeOfLines`: each line's tokens (a string, a number, a word, one other character),
each word that isn't a keyword replaced by its order of first appearance, lines kept apart. A code site's lock token
is `v3:<code>.<shape>`. `isAsLocked` reads a `v3:` line by its code part, a `v2:` line by the code alone, a line
without a prefix with comments; `isRenamedSinceLocked` is a `v3:` line of the same version whose shape part matches.
`checkLock` reports `renamed` where it reported `changed` for such a site.
Why: the decisions'. Lines kept apart so a shape that matches means the same line structure: when the code
fingerprint differs, at least one word differs, and the list of renames is never empty.
Where: `scripts/logicmap.ts:46-69` (the code), `:580-625` (the fingerprints), `:794-860` (`isAsLocked`, `checkLock`)
```ts
const shapeOfLines = (lines: string[]): string => {
  const orderByWord = new Map<string, number>()
  const orderOf = (word: string): number => { … }
  const shapeLines = normalizeLines(lines).map((line) =>
    (line.match(CODE_TOKEN_PATTERN) ?? [])
      .map((token) => (isRenamableWord(token) ? `$${orderOf(token)}` : token))
      .join(' '),
  )
  return shortHashOf(shapeLines.join('\n'))
}
```
Run: the three new tests pass; five older ones failed because they edited code by renaming a call
(`removeConnection` → `dropConnection`, `step3()` → `stepThree()`, `raw.` → `bytes.`, `--retries` → `--attempts`), each
now `renamed`, as it should be. Four of them test a change, so they now edit by one (`removeConnection(connection,
true)`, `step3(true)`, `raw?.`); the comment-lines test keeps `--attempts` and expects `renamed`, which still proves
the line is read as code. 45 pass.

## Piece 3: the failing test of the renames listed
What: the `renamed` message lists each word renamed, `closedEarly → closedBeforeJoin, joined → joinedRoom`, when the
acked code is in the ack's commit; when the ack isn't committed and HEAD holds the acked code, from HEAD; when neither
holds it (the code was acked, then edited, before any commit), it says `logicmap diff <id>` shows the change.
Why: the list is what lets one look tell a rename from a call pointed at another thing.
Where: `scripts/logicmap.test.ts`, the lock tests
The rename committed without an ack is read from the ack's commit, HEAD holding the renamed code by then.
Run: red, the message names no rename.

## Piece 4: the acked code read back from git
What: `createRenamesReader(repoRoot)` gives `checkLock` the renames of a renamed site: the site's anchor found in
the file as HEAD holds it (the nth anchor of its id and role, as its lock key counts), its lines checked against the
locked fingerprint's code part; when HEAD doesn't hold that code, the same from the commit that wrote its lock line
(`findAckCommit`); then the words paired by position with the current lines. One `git show` per commit and file in a
run. `anchoredLinesAt` is shared with `collectLockSites`.
Why: HEAD first, since a site acked and committed with no change since is the common case and costs no history
search; the ack's commit covers a rename committed without an ack. The fingerprint check means a list is never read
from code other than the acked one.
Where: `scripts/logicmap.ts`, beside `findAckCommit`; `checkLock` takes the reader; `findAllProblems` makes it
```ts
const pairRenamedWords = (ackedLines: string[], currentLines: string[]): string[] => {
  const ackedTokens = listCodeTokensByLine(dropCommentLines(ackedLines)).flat()
  const currentTokens = listCodeTokensByLine(dropCommentLines(currentLines)).flat()
  const renames = ackedTokens.flatMap((ackedToken, tokenIndex) => {
    const currentToken = currentTokens[tokenIndex] ?? ackedToken
    return ackedToken === currentToken ? [] : [`${ackedToken} → ${currentToken}`]
  })
  return [...new Set(renames)]
}
```
Run: 46 pass.

## Piece 5: the failing test of `ack --renamed`
What: two ids renamed, one of them with its entry edited too: `ackRenamedIds` acks the first only and names the
second as left, whose rename and entry change `check` still reports.
Why: one command for a batch of renames, which never acks an id carrying a change beside its rename.
Where: `scripts/logicmap.test.ts`, the lock tests
Run: red, `ackRenamedIds` isn't exported.

## Piece 6: `ackRenamedIds` and `ack --renamed`
What: `ackRenamedIds` reads `checkRepo`'s errors, takes the ids with a `renamed` one, acks those whose every error is
`renamed` and names the rest as left. `ack --renamed` prints both lists; it exits 1 when nothing was acked and an id
is left, so a script sees the work isn't done.
Why: an id with a change beside its rename needs the reading a change needs; acking it with its renames would hide
that change.
Where: `scripts/logicmap.ts`, after `ackIds`; the command line's `ack` branch
```ts
export const ackRenamedIds = (repoRoot: string): { ackedIds: string[]; leftIds: string[] } => {
  const errors = checkRepo(repoRoot).filter((problem) => problem.severity === PROBLEM_SEVERITIES.error)
  const renamedIds = new Set(errors.flatMap((problem) => (problem.code === PROBLEM_CODES.renamed && problem.id !== null ? [problem.id] : [])))
  const isOnlyRenamed = (id: string) => errors.every((problem) => problem.id !== id || problem.code === PROBLEM_CODES.renamed)
  …
}
```
Run: 47 pass, after the test's expected line of the edited entry moved from 9 to 8, its heading's line.

## Piece 7: the failing test of a file renamed with its words
What: the moved-site test renames `src/room.ts` to `src/join-room.ts` and `removeConnection` to `dropConnection` in
it: `renamed src/join-room.ts:1`, its message listing `removeConnection → dropConnection`; a real change in the moved
file (`removeConnection(connection, true)`) stays `gone` and `unacked`.
Why: TODO 115 renamed its store's file with its words; that is the rename this step is for.
Where: `scripts/logicmap.test.ts`, the moved-site test
Run: red, `gone` and `unacked`.

## Piece 8: a moved site takes a lock line of its shape
What: in `checkLock`, a site with no lock line of its own looks for an unclaimed line of its id and role whose shape
it has, and reports `renamed` on it. The renames reader takes the lock key it reads: the acked code is the nth anchor
of the key's file, the old one when the file moved.
Why: the moved pass already finds a site whose code is unchanged under another key; this finds one whose words alone
changed. Its own line is tried first, so a site that stayed in its file is read as before.
Where: `scripts/logicmap.ts`, `checkLock` and `createRenamesReader`
Run: `renamed` reported, but with no list: the test commits the ack together with the move, so no commit holds the old
path. The reader then tries the site's own file too, in HEAD and in the ack's commit, the fingerprint still deciding;
the test gains a second repo where the ack is committed before the move, read from the old path in HEAD. 47 pass.
