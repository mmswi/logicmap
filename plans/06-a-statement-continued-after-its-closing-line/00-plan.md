# A statement continued after its closing line stays under its anchor

## Goal
Found by teamabled's logicmap task 08 (2026-11-03, `explanatory-docs/logicmap/08-renamed-sites-and-frame-readers/`),
under Mihai's "de acord cu imbunatatirile. tu esti seful pe logicmap. fa-le": the first `grep:` put on a live frame's
rule reported its own sender as `unanchored-match`. The anchor sat above

```ts
export const signalTeamDeletedToFormerMembers = (input: {
  teamId: string
  formerMemberIds: string[]
}): void =>
  pushToUsers(input.formerMemberIds, { type: LIVE_EVENT_TYPES.teamDeleted, teamId: input.teamId })
```

and covered lines 1–4: the span stops at a closing line that opens no block, so the arrow's body, the line that does
the work, was never fingerprinted, under this anchor or the flow anchor above it since it was written.

## Decisions
- 2026-11-03, the agent: a closing line at the head's indentation keeps the span going when the next code line is
  deeper than the head: that line continues the same statement (an arrow's body after `}): T =>`, a call chained after
  `})`), which is how a formatter lays it out. A closing line followed by a line at the head's indentation or less
  still ends the span. Rejected: reading the closing line's end (`=>`, `=`, `.`) for a continuation (the chained call
  puts its dot on the next line, and each operator would be one more case).

## Steps
### 1. The span continues past a closing line
- [x] Red: an edit in an arrow's body after `}): void =>`, and in a call chained after `})`, is `changed`; the line
  after a closing `}` at the head's indentation stays outside.
- [x] Green: `findAnchoredLineRange` keeps going after a closing line; the loop's next line decides.
- [x] Measured on teamabled: the sites whose span grows, `check` before and after.
Files: `scripts/logicmap.ts`, `scripts/logicmap.test.ts`

## Revisions
