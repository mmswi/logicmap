# Step 2: The widest views bounded

Before: `bun test` 58 pass.

## Piece 1: the failing test
What: in `describe('show')`, a domain of 250 rules with long ids and claims. `show` has the domain's heading and no
rule id; `show sync` has each id and no claim; each names `--all`, and with `{ isInFull: true }` prints what it left
out. The existing test of the two views on a small map keeps its expected text, with `find` added to the header.
Why: plan, decision 2.
Where: `scripts/logicmap.test.ts`, at the end of `describe('show')`; the header at its line 1315
```ts
  test('a wide view over its size leaves the ids, or the claims, out and says how to reach them; in full on request', () => {
    const longName = 'a-rule-with-a-long-name-so-that-two-hundred-and-fifty-of-them-fill-the-widest-view'
    const ruleIdOf = (ruleNumber: number): string =>
      `sync.rule-${String(ruleNumber).padStart(3, '0')}-${longName}`
    const repoRoot = createFixtureRepo({
      'logicmap/sync.md': [
        '# sync',
        'The live document sync.',
        '',
        ...Array.from({ length: 250 }, (_, ruleIndex) =>
          [
            `## ${ruleIdOf(ruleIndex + 1)}`,
            'kind: decision',
            'version: 1',
            'what: Every word of this claim is here to make the view of the domain long. The detail.',
            'why: fixture.',
            'source: fixture',
            '',
          ].join('\n'),
        ),
      ].join('\n'),
    })

    const mapView = showLogicMap(repoRoot, undefined)
    expect(mapView).toContain('sync  250 rules  logicmap/sync.md')
    expect(mapView).toContain('The live document sync.')
    expect(mapView).not.toContain(ruleIdOf(1))
    expect(mapView).toContain('The rule ids are left out')
    expect(mapView).toContain('show --all')
    expect(showLogicMap(repoRoot, undefined, { isInFull: true })).toContain(ruleIdOf(250))

    const domainView = showLogicMap(repoRoot, 'sync')
    expect(domainView).toContain(`${ruleIdOf(1)}  decision`)
    expect(domainView).toContain(`${ruleIdOf(250)}  decision`)
    expect(domainView).not.toContain('Every word of this claim')
    expect(domainView).toContain('The claims are left out')
    expect(domainView).toContain('show sync --all')
    const domainViewInFull = showLogicMap(repoRoot, 'sync', { isInFull: true })
    expect(domainViewInFull).toContain(`${ruleIdOf(250)}@1  decision`)
    expect(domainViewInFull).toContain(
      'recorded  Every word of this claim is here to make the view of the domain long.  (sites: 0)',
    )
  })
```
Run (red): `bun test -t "show"`: 2 fail. The small map's header lacks `find`; the wide map's `show` holds
`sync.rule-001-...`.

## Piece 2: a wide view over its size prints its short form
What: `WIDE_VIEW_MAX_CHARACTERS = 20_000`. `showDomainsMap(isInFull)` and `showOneDomain(domain, isInFull)` build the
view as today; in full or within the size, that is the answer. Over it, the domains map keeps each domain's heading
and intro, and the domain view prints each rule as the domains map prints it (`describeRuleById`: the id, the kind,
and a status or a provenance only when it is not the usual one); the second line says what was left out, how long
the view is with it, and the three ways to it. `showLogicMap` takes `{ isInFull }`; the command line reads `--all`.
`SHOW_LEVELS_HINT` names `find`.
Why: plan, decision 2. The size is measured on the text itself, so a map that grows crosses into the short form with
no setting to move.
Where: `scripts/logicmap.ts`: before `SHOW_LEVELS_HINT`; `createShowViews` (`showDomainsMap`, `showOneDomain`);
`showLogicMap`; `USAGE`; `runCommandLine`
```ts
  // A rule by its id, plus what differs from the usual: a problem, or a why nobody recorded.
  const describeRuleById = (entry: LedgerEntry): string => {
    const status = entryStatusOf(entry)
    const statusNote = status === 'ok' ? '' : `  ${status}`
    const provenanceNote =
      entry.provenance === ENTRY_PROVENANCES.recorded ? '' : `  ${entry.provenance}`
    return `${entry.id}  ${entry.kind ?? '?'}${statusNote}${provenanceNote}`
  }

  const showDomainsMap = (isInFull: boolean): string => {
    const domains = [...analysis.domainsByName.values()]
    const ruleCount = domains.reduce((count, domain) => count + activeEntriesOf(domain).length, 0)
    if (ruleCount === 0) {
      return `no entries in ${LEDGER_DIRECTORY}/ yet`
    }
    const headerLine = `logicmap: ${countOf(ruleCount, 'rule')} in ${countOf(domains.length, 'domain')}. ${SHOW_LEVELS_HINT}`
    const viewWithRuleIds = [
      headerLine,
      ...domains.map((domain) => {
        const ruleLines = activeEntriesOf(domain).map((entry) => `  ${describeRuleById(entry)}`)
        return ['', ...describeDomain(domain), ...ruleLines].join('\n')
      }),
    ].join('\n')
    if (isInFull || viewWithRuleIds.length <= WIDE_VIEW_MAX_CHARACTERS) {
      return viewWithRuleIds
    }
    const leftOutLine = `The rule ids are left out: with them this view is ${describeCharacterCount(viewWithRuleIds)}. show <domain> lists a domain's rules, find <word>... the rules about something, show ${SHOW_IN_FULL_FLAG} every id.`
    const domainSections = domains.map((domain) => ['', ...describeDomain(domain)].join('\n'))
    return [headerLine, leftOutLine, ...domainSections].join('\n')
  }
```
```ts
  const showOneDomain = (domain: LedgerDomain, isInFull: boolean): string => {
    const domainRules = activeEntriesOf(domain)
    const viewWithClaims = [
      ...describeDomain(domain),
      ...domainRules.map(describeRuleWithClaim),
    ].join('\n')
    if (isInFull || viewWithClaims.length <= WIDE_VIEW_MAX_CHARACTERS) {
      return viewWithClaims
    }
    const leftOutLine = `The claims are left out: with them this view is ${describeCharacterCount(viewWithClaims)}. find <word>... gives the rules about something with their claims, show <id> one rule, show ${domain.name} ${SHOW_IN_FULL_FLAG} every claim.`
    return [...describeDomain(domain), leftOutLine, ...domainRules.map(describeRuleById)].join('\n')
  }
```
```ts
// A wide view (every domain, or one domain's rules) prints in full up to this size, about 5,000 tokens.
const WIDE_VIEW_MAX_CHARACTERS = 20_000
const SHOW_IN_FULL_FLAG = '--all'

const describeCharacterCount = (text: string): string =>
  `${text.length.toLocaleString('en-US')} characters`
```
```diff
-export const showLogicMap = (repoRoot: string, target: string | undefined): string => {
+export const showLogicMap = (
+  repoRoot: string,
+  target: string | undefined,
+  { isInFull = false }: { isInFull?: boolean } = {},
+): string => {
   const views = createShowViews(repoRoot)
   if (target === undefined) {
-    return views.showDomainsMap()
+    return views.showDomainsMap(isInFull)
...
-    return views.showOneDomain(domain)
+    return views.showOneDomain(domain, isInFull)
```
```diff
   if (command === 'show') {
-    const [typedTarget] = commandArguments
+    const isInFull = commandArguments.includes(SHOW_IN_FULL_FLAG)
+    const [typedTarget] = commandArguments.filter(
+      (commandArgument) => commandArgument !== SHOW_IN_FULL_FLAG,
+    )
     const target = typedTarget === undefined ? undefined : toShowTarget(repoRoot, typedTarget)
-    console.log(showLogicMap(repoRoot, target))
+    console.log(showLogicMap(repoRoot, target, { isInFull }))
```
Run: the first green run failed on the test's own line: an entry with no anchor is `orphan-entry,unacked`, so the
test no longer spells the status. `bun test`: 59 pass, 0 fail.
