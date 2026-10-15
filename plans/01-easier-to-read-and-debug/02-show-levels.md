# Step 2: `show` in levels: domains, a domain, a rule

## Piece 1: test — the domains map and one domain

What: a fixture with two domains: `sync` with an intro, one rule and one retired rule; `access` with no
intro and one inferred rule. `show` with no target must equal the domains map exactly, and
`show sync` the domain view. The old test's expectation of the every-entry list goes.
Why: the cold start must cost little: the map names each domain, says what it covers, and lists its
rule ids; only what differs from the usual (a problem, an inferred why) is spelled out. A domain view
gives each rule's claim, the first sentence of its `what`.
Where: `scripts/logicmap.test.ts`, `describe('show')`, a second test.

```ts
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
```

Red: `(fail) show > with no target, show maps the domains ...`, 18 pass, 1 fail.

## Piece 2: each domain's intro

What: `readLedger` also returns `domainsByName`: each ledger file is a domain whose intro is the prose
between its `# <domain>` title and its first entry; `analyzeRepo` passes it on.
Why: the parser already skipped that text, so a domain's description needs no new file and no new
syntax.
Where: `scripts/logicmap.ts`, above `readLedger`, in it, and in `RepoAnalysis` / `analyzeRepo`.

```ts
// A domain is one ledger file. Its intro is the prose between the `# <domain>` title and the first
// entry: what the domain covers and where its code starts.
export type LedgerDomain = { name: string; file: string; intro: string }

const ENTRY_HEADING_START_PATTERN = /^## /m
const readDomainIntro = (fileText: string): string => {
  const [textAboveFirstEntry = ''] = fileText.split(ENTRY_HEADING_START_PATTERN)
  return textAboveFirstEntry
    .split('\n')
    .filter((line) => !line.startsWith('# '))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
```

```diff
   for (const file of listLedgerDirectoryFiles(repoRoot, LEDGER_FILE_EXTENSION)) {
     const fileText = readFileSync(join(repoRoot, file), 'utf8')
+    const domainName = basename(file, LEDGER_FILE_EXTENSION)
+    domainsByName.set(domainName, { name: domainName, file, intro: readDomainIntro(fileText) })
 // ...unchanged...
-  return { entriesById, problems }
+  return { entriesById, domainsByName, problems }
```

## Piece 3: the domains map and the domain view

What: `showEveryEntry` (every rule with its whole `what`) gives way to `showDomainsMap` (a header with
the counts and the levels, then each domain's heading, intro and rule ids) and `showOneDomain` (the
heading, the intro, each rule with its claim and site count). Retired rules are counted, not listed.
`show <domain>` is resolved after files and ids.
Why: measured on teamabled, the every-rule list was 71.6 KB. The map lists 180 ids in 10 domains, and
each domain view is one line per rule.
Where: `scripts/logicmap.ts`, `showLogicMap`.

```ts
  const showDomainsMap = (): string => {
    const domains = [...analysis.domainsByName.values()]
    const ruleCount = domains.reduce((count, domain) => count + activeEntriesOf(domain).length, 0)
    if (ruleCount === 0) {
      return `no entries in ${LEDGER_DIRECTORY}/ yet`
    }
    const headerLine = `logicmap: ${countOf(ruleCount, 'rule')} in ${countOf(domains.length, 'domain')}. ${SHOW_LEVELS_HINT}`
    const domainSections = domains.map((domain) => {
      const ruleLines = activeEntriesOf(domain).map((entry) => {
        const status = entryStatusOf(entry)
        const statusNote = status === 'ok' ? '' : `  ${status}`
        const provenanceNote =
          entry.provenance === ENTRY_PROVENANCES.recorded ? '' : `  ${entry.provenance}`
        return `  ${entry.id}  ${entry.kind ?? '?'}${statusNote}${provenanceNote}`
      })
      return ['', ...describeDomain(domain), ...ruleLines].join('\n')
    })
    return [headerLine, ...domainSections].join('\n')
  }

  const showOneDomain = (domain: LedgerDomain): string => {
    const ruleLines = activeEntriesOf(domain).map((entry) => {
      const siteCount = analysis.anchors.filter((anchor) => anchor.id === entry.id).length
      return `${entry.id}@${entry.version ?? '?'}  ${entry.kind ?? '?'}  ${entryStatusOf(entry)}  ${entry.provenance}  ${entry.claim}  (sites: ${siteCount})`
    })
    return [...describeDomain(domain), ...ruleLines].join('\n')
  }
```

with `countOf`, `SHOW_LEVELS_HINT`, `entryStatusOf`, `activeEntriesOf` and `describeDomain` (the
heading line `<name>  <n> rules (+<n> retired)  <file>` and the intro) beside them, and:

```diff
   if (target === undefined) {
-    return showEveryEntry()
+    return showDomainsMap()
   }
 // ...unchanged...
+  const domain = analysis.domainsByName.get(target)
+  if (domain !== undefined) {
+    return showOneDomain(domain)
+  }
-  return `nothing named "${target}": not an id in ${LEDGER_DIRECTORY}/, not a file with anchors`
+  return `nothing named "${target}": not a domain or an id in ${LEDGER_DIRECTORY}/, not a file with anchors`
```

Green: 19 pass, 0 fail.
