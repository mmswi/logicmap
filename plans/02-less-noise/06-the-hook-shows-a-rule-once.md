# Step 6: the hook shows a rule once per session

## Piece 1: a second read names the rule in one line (the failing test)
What: a test in `hook`: a session reads a mapped file and gets the rule in full; it reads it again and
gets only "these lines of src/room.ts are covered too by rules shown earlier this session:
sync.close-during-join@1"; another session gets it in full; after the rule is bumped to version 2 the
first session gets it in full again.
Why: these are the step's claims, the bump included: a rule whose meaning changed must be read again.
Where: `scripts/logicmap.test.ts` (the test 'a session sees a rule in full once')
```ts
    expect(contextOfRead(sessionId)).toContain(fullRuleText)
    const secondReadContext = contextOfRead(sessionId)
    expect(secondReadContext).not.toContain(fullRuleText)
    expect(secondReadContext).toContain('rules shown earlier this session: sync.close-during-join@1')
```
Run: red, 1 fail (`not.toContain(fullRuleText)`).

## Piece 2: the file view per rule
What: `listFileRuleSections` returns each rule of a file's view as a `RuleSection` (`id`, `version`,
`text`); `showFileRules` joins their texts, so `show <file>` prints what it did. `showRulesInLines`
becomes `listRuleSectionsInLines`, which answers the sections and an empty list when no rule covers the
lines.
Why: the hook needs to know which rule each block of the view is, by id and version; parsing the joined
text back would tie the hook to the view's layout.
Where: `scripts/logicmap.ts` (`RuleSection`, `listFileRuleSections`, `listRuleSectionsInLines`)
```ts
export type RuleSection = { id: string; version: number | null; text: string }
```

## Piece 3: the rules a session was shown
What: the hook keeps the rules shown in full per session in `<session>.shown-rules.txt`, beside the
edited-repos file (both now through `sessionFileOf`), one `<repo root> <id>@<version>` per line. A read
shows in full the rules not in it, records them, and names the others in one line. Without a session id
every read shows them in full, as before.
Why: once per version and not once ever: after a compaction the agent has lost the claims but still sees
which rules cover what it reads, and `show <id>` brings one back. Rejected: showing a rule once and never
again (lost at the first compaction).
Where: `scripts/hook.ts` (`sessionFileOf`, `shownRuleLineOf`, `readShownRuleLines`, `respondToRead`)
```ts
  const newRuleSections = ruleSections.filter((ruleSection) => !isShownBefore(ruleSection))
  const shownBeforeRuleNames = ruleSections
    .filter(isShownBefore)
    .map((ruleSection) => `${ruleSection.id}@${ruleSection.version ?? '?'}`)
```
Run: 31 pass; strict tsc and biome clean; on teamabled `show src/teams/merge-direct-groups.ts:436-480`
prints what the live one does, and two reads of lines 440-449 in one session print the three rules in
full, then one line naming them.
