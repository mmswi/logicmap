# Step 2: `grep:` makes every reader a site

## Piece 1: the failing tests of `grep:`
What: a `describe('patterns')` block. An entry `live.tag-changes-signalled` with `grep: \bFRAMES\.tagChanged\b`. The
sender under the defining anchor, a listener under a `uses` whose `if` tests two frames over two lines, and a test
under a `test` anchor pass; a listener under no anchor is `unanchored-match` at its line, naming the rule. A comment
line naming the frame, a file in `logicmap/ignore` and the ledger itself are left out, and a retired entry's pattern
finds nothing. A pattern JavaScript can't read (`(`) is `invalid-field` at its line, and the other entries are still
checked.
Why: the decisions' reading of `grep:`, each place a hit could be wrongly counted or missed.
Where: `scripts/logicmap.test.ts`, before `describe('coverage')`
Run: red, no `grep:` field, nothing reported.

## Piece 2: the `grep` field and `unanchored-match`
What: `grep` joins the entry's fields; `parseEntry` keeps its pattern when `new RegExp` reads it, and reports
`invalid-field` at its line otherwise. `checkGrepPatterns`, run by `findAllProblems`, sends every active entry's
pattern to one `git grep -P` over the files the anchor scan reads (`grepRepoLines`, shared with it), and gives each
line found to the entries whose pattern JavaScript matches on it. A line under none of the entry's anchors, of any
role, is `unanchored-match`. A comment line (`//`, `#`, `--`, `<!--`, a line of a block comment) is left out. A line
git found that no pattern then matches is the warning `grep-mismatch`: PCRE and JavaScript read a pattern apart.
Why: one git call per check, so the hook's Edit check pays once; JavaScript decides which rule a line belongs to,
since git can't say which `-e` matched. A ceiling: a line inside a block comment that doesn't start with `*` is read
as code.
Where: `scripts/logicmap.ts`: the problem codes, `ENTRY_FIELD_NAMES`, `LedgerEntry`, `parseEntry`, `grepRepoLines`
beside `grepLinesWithSigil`, `checkGrepPatterns` before `findAllProblems`
Run: 49 pass.

## Piece 3: the failing tests of a git that refuses
What: a pattern JavaScript reads and PCRE refuses (`FRAMES\c`, git: "\c at end of pattern", exit 128) is
`invalid-field` at its line, quoting git, and the other entry is still checked. A git without PCRE (a `git` on the
PATH that answers `grep -P` with git's own "cannot use Perl-compatible regexes when not compiled with USE_LIBPCRE"
and 128, and runs the real git otherwise) gives one `grep-unavailable` warning and no error.
Why: one bad pattern must not sink every entry's check; a machine without PCRE must say the fields go unchecked, not
pass them silently or crash `check`.
Where: `scripts/logicmap.test.ts`, `describe('patterns')`
Run: red, both throw from `grepRepoLines`.

## Piece 4: git's refusal read
What: `grepPatterns` runs the patterns and returns git's first line of complaint when it refuses. A refusal naming
`USE_LIBPCRE` is one `grep-unavailable` warning at the first patterned entry. Any other refusal reruns each pattern
alone: one refused is `invalid-field` at its `grep:` line, quoting git; the lines the rest find, each once, are read
as before. The `grep-mismatch` message becomes a plain string (biome).
Why: the decisions'; a rerun per pattern is paid only when one is bad.
Where: `scripts/logicmap.ts`, `checkGrepPatterns`
Run: 51 pass.
