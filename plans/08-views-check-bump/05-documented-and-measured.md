# Step 5: Documented and measured

Before: `bun test` 61 pass; the strict `tsc` and `biome check` of the board's step 2 clean.

## Piece 1: the docs
What: SKILL.md's command list gains `bump`, `find` and `--all`; the paragraph on `show` drops "each a few thousand
tokens at most" (false for a map of 735 rules) and says when a wide view is shortened; a paragraph on `find`;
"Changing anchored code" says what `check` prints under a changed site and that `bump` writes the mechanical half.
README's command table gains the same four lines.
Why: the skill is what tells an agent the commands exist.
Where: `SKILL.md` (the commands, "Changing anchored code"), `README.md:45-63`

## Piece 2: measured on teamabled
What: the branch's checker run in teamabled (735 active rules, 20 domains) and in a scratch clone of it.

| Command | Before | After |
|---|---|---|
| `show` | 46,474 characters | 10,259 (each domain's heading and intro); `--all` 46,516 |
| `show documents` (274 rules) | 62,249 | 14,749 (each id and kind); `--all` 62,248 |
| `show teams`, `show auth` | 13,005, 16,584 | the same: under 20,000 they print in full |
| `find viewer rename` | none | 11 rules, 2,588 characters |
| `find share link` | none | 30 rules and "... and N more", 6,615 characters |

In the clone, one line added under `sync.read-only-drops-edits`' definition: `check` (0.44 s) printed, under the
`changed` line, the claim, "the change, since the ack in 1cd96184:" and the hunk with the added line.
`bump sync.read-only-drops-edits "..."` wrote `version: 3` and `- @3: ...` in `logicmap/sync.md`, moved the pin at
`src/sync/doc-room.ts:609`, and listed the 8 other sites; `check` then reported those 8 as `stale-pin`.
