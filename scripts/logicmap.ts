import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'

/*
 * Logicmap checker. An anchor is a comment marker `§<role> <id>@<version>[ #<step>]` at a code site;
 * its id names an entry in logicmap/<domain>.md (the domain is the id's first segment). This script
 * finds every anchor, matches it to its entry and reports each place where the two disagree.
 */

// ---------- Vocabulary ----------

export const ANCHOR_ROLES = {
  decision: 'decision',
  invariant: 'invariant',
  edge: 'edge',
  flow: 'flow',
  uses: 'uses',
  test: 'test',
} as const
export type AnchorRole = (typeof ANCHOR_ROLES)[keyof typeof ANCHOR_ROLES]

export const ENTRY_KINDS = {
  decision: 'decision',
  invariant: 'invariant',
  edge: 'edge',
  flow: 'flow',
} as const
export type EntryKind = (typeof ENTRY_KINDS)[keyof typeof ENTRY_KINDS]

export const ENTRY_STATUSES = { active: 'active', retired: 'retired' } as const
export type EntryStatus = (typeof ENTRY_STATUSES)[keyof typeof ENTRY_STATUSES]

// Where an entry's claim comes from: written down by a person, or worked out by an agent from code.
export const ENTRY_PROVENANCES = {
  recorded: 'recorded',
  inferred: 'inferred',
  unsourced: 'unsourced',
} as const
export type EntryProvenance = (typeof ENTRY_PROVENANCES)[keyof typeof ENTRY_PROVENANCES]

export const PROBLEM_SEVERITIES = { error: 'error', warning: 'warning' } as const
export type ProblemSeverity = (typeof PROBLEM_SEVERITIES)[keyof typeof PROBLEM_SEVERITIES]

export const PROBLEM_CODES = {
  malformedAnchor: 'malformed-anchor',
  undocumented: 'undocumented',
  missingField: 'missing-field',
  invalidField: 'invalid-field',
  misplacedEntry: 'misplaced-entry',
  duplicateEntry: 'duplicate-entry',
  roleMismatch: 'role-mismatch',
  stalePin: 'stale-pin',
  orphanEntry: 'orphan-entry',
  duplicateDefinition: 'duplicate-definition',
  retiredAnchored: 'retired-anchored',
  missingStep: 'missing-step',
  misplacedStep: 'misplaced-step',
  unknownStep: 'unknown-step',
  stepWithoutSite: 'step-without-site',
  unacked: 'unacked',
  changed: 'changed',
  gone: 'gone',
  unknownId: 'unknown-id',
  untested: 'untested',
  longWhat: 'long-what',
} as const
export type ProblemCode = (typeof PROBLEM_CODES)[keyof typeof PROBLEM_CODES]

export type Problem = {
  severity: ProblemSeverity
  code: ProblemCode
  file: string
  line: number
  id: string | null
  message: string
}

export type Anchor = {
  role: AnchorRole
  id: string
  version: number
  step: number | null
  file: string
  line: number
}

export type FlowStep = { number: number; text: string; isExternal: boolean; line: number }

// kind and version are null when the entry leaves them out or writes them wrong (already reported).
export type LedgerEntry = {
  id: string
  file: string
  line: number
  kind: EntryKind | null
  version: number | null
  status: EntryStatus
  provenance: EntryProvenance
  what: string
  claim: string
  why: string
  rejected: string
  // Why no test proves it, when someone wrote so; such an entry raises no untested warning.
  untestedReason: string
  steps: FlowStep[]
  text: string
}

export const LEDGER_DIRECTORY = 'logicmap'
const LEDGER_FILE_EXTENSION = '.md'
const LOCK_FILE_EXTENSION = '.lock'
const SINGLE_LOCK_FILE_BEFORE_SPLIT = `${LEDGER_DIRECTORY}/lock`
const IGNORE_FILE = `${LEDGER_DIRECTORY}/ignore`

const ANCHOR_ROLE_NAMES: readonly string[] = Object.values(ANCHOR_ROLES)
const isAnchorRole = (roleName: string): roleName is AnchorRole =>
  ANCHOR_ROLE_NAMES.includes(roleName)

const ENTRY_KIND_NAMES: readonly string[] = Object.values(ENTRY_KINDS)
const isEntryKind = (kindName: string): kindName is EntryKind => ENTRY_KIND_NAMES.includes(kindName)

const ENTRY_STATUS_NAMES: readonly string[] = Object.values(ENTRY_STATUSES)
const isEntryStatus = (statusName: string): statusName is EntryStatus =>
  ENTRY_STATUS_NAMES.includes(statusName)

const problemAt =
  (severity: ProblemSeverity) =>
  (
    code: ProblemCode,
    place: { file: string; line: number },
    id: string | null,
    message: string,
  ): Problem => ({ severity, code, file: place.file, line: place.line, id, message })
const errorAt = problemAt(PROBLEM_SEVERITIES.error)
const warningAt = problemAt(PROBLEM_SEVERITIES.warning)

// ---------- Anchors: every `§` site in the repo ----------

// `§` followed by a lowercase letter always starts an anchor, so a typo is reported instead of ignored.
const ANCHOR_START_PATTERN = /§[a-z]/g
const ID_SOURCE = '[a-z][a-z0-9-]*(?:\\.[a-z0-9][a-z0-9-]*)+'
const ANCHOR_SOURCE = `§(${ANCHOR_ROLE_NAMES.join('|')}) (${ID_SOURCE})@([1-9]\\d*)(?: #([1-9]\\d*))?`
const GREP_OUTPUT_LINE_PATTERN = /^(.+?):(\d+):(.*)$/

const domainOf = (id: string): string => id.split('.')[0] ?? id

// The pathspecs in logicmap/ignore: files that talk about anchors (docs, articles) rather than hold them.
const readIgnoredPathspecs = (repoRoot: string): string[] => {
  const ignorePath = join(repoRoot, IGNORE_FILE)
  if (!existsSync(ignorePath)) {
    return []
  }
  return readFileSync(ignorePath, 'utf8')
    .split('\n')
    .map((ignoreLine) => ignoreLine.trim())
    .filter((ignoreLine) => ignoreLine !== '' && !ignoreLine.startsWith('#'))
}

// Every line holding a `§`: tracked and untracked files, binary files skipped, the ledger and the
// ignored paths excluded.
const grepLinesWithSigil = (repoRoot: string): string[] => {
  const excludedPathspecs = [`${LEDGER_DIRECTORY}/`, ...readIgnoredPathspecs(repoRoot)].map(
    (pathspec) => `:(exclude)${pathspec}`,
  )
  try {
    const grepOutput = execFileSync(
      'git',
      ['grep', '-n', '-I', '--untracked', '-e', '§', '--', '.', ...excludedPathspecs],
      { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    )
    return grepOutput.split('\n').filter((grepLine) => grepLine !== '')
  } catch (error: unknown) {
    // git grep exits 1 when nothing matches: a repo with no anchors yet.
    const isNoMatchExit = error instanceof Error && 'status' in error && error.status === 1
    if (isNoMatchExit) {
      return []
    }
    throw error
  }
}

const scanAnchors = (repoRoot: string): { anchors: Anchor[]; problems: Problem[] } => {
  const anchors: Anchor[] = []
  const problems: Problem[] = []
  for (const grepLine of grepLinesWithSigil(repoRoot)) {
    const [, file = '', lineNumberText = '', lineText = ''] =
      GREP_OUTPUT_LINE_PATTERN.exec(grepLine) ?? []
    const line = Number(lineNumberText)
    for (const anchorStart of lineText.matchAll(ANCHOR_START_PATTERN)) {
      const anchorAtStart = new RegExp(ANCHOR_SOURCE, 'y')
      anchorAtStart.lastIndex = anchorStart.index
      const [, roleName = '', id = '', versionText = '', stepText] =
        anchorAtStart.exec(lineText) ?? []
      if (!isAnchorRole(roleName)) {
        const unparsedText = lineText.slice(anchorStart.index).trim().slice(0, 60)
        problems.push(
          errorAt(
            PROBLEM_CODES.malformedAnchor,
            { file, line },
            null,
            `"${unparsedText}" does not parse as §<role> <domain>.<name>@<version>[ #<step>]; a file that only talks about anchors belongs in ${IGNORE_FILE}`,
          ),
        )
        continue
      }
      const step = stepText === undefined ? null : Number(stepText)
      anchors.push({ role: roleName, id, version: Number(versionText), step, file, line })
    }
  }
  return { anchors, problems }
}

// ---------- Ledger: logicmap/<domain>.md ----------

const ENTRY_HEADING_PATTERN = /^## (\S+)\s*$/
const ENTRY_FIELD_NAMES = [
  'kind',
  'version',
  'status',
  'what',
  'why',
  'rejected',
  'breaks-if',
  'revisit-if',
  'untested',
  'source',
  'steps',
  'history',
] as const
type EntryFieldName = (typeof ENTRY_FIELD_NAMES)[number]
const REQUIRED_FIELD_NAMES: readonly EntryFieldName[] = ['kind', 'version', 'what', 'why', 'source']
// A source starting with this word is an agent's reading of the code, not a recorded intent.
const INFERRED_SOURCE_PATTERN = /^inferred\b/i
const ENTRY_FIELD_PATTERN = new RegExp(`^(${ENTRY_FIELD_NAMES.join('|')}):(.*)$`)
const FLOW_STEP_PATTERN = /^\s*(\d+)\.\s+(.*)$/
const EXTERNAL_STEP_MARKER = '(external)'
const ID_PATTERN = new RegExp(`^${ID_SOURCE}$`)
const VERSION_PATTERN = /^[1-9]\d*$/

// The claim is the first sentence of what; the detail of the rule may follow it.
const CLAIM_MAX_LENGTH = 200
// A sentence ends at . ! or ? before a capital letter or the end, so "e.g." and "1.15" do not end it.
const FIRST_SENTENCE_PATTERN = /^.+?[.!?](?=\s+[A-Z]|\s*$)/
const claimOf = (what: string): string => FIRST_SENTENCE_PATTERN.exec(what)?.[0] ?? what

const isEntryFieldName = (fieldName: string | undefined): fieldName is EntryFieldName =>
  ENTRY_FIELD_NAMES.some((knownFieldName) => knownFieldName === fieldName)

// One entry as written: its heading line and every line under it, up to the next heading.
type EntryBlock = { id: string; file: string; line: number; lines: string[] }

const splitIntoEntryBlocks = (file: string, fileText: string): EntryBlock[] => {
  const entryBlocks: EntryBlock[] = []
  for (const [lineIndex, fileLine] of fileText.split('\n').entries()) {
    const [, headingId] = ENTRY_HEADING_PATTERN.exec(fileLine) ?? []
    if (headingId === undefined) {
      entryBlocks.at(-1)?.lines.push(fileLine)
      continue
    }
    entryBlocks.push({ id: headingId, file, line: lineIndex + 1, lines: [fileLine] })
  }
  return entryBlocks
}

type EntryField = { text: string; line: number }

// A field runs from its `name:` line through the indented lines under it; steps are its `N. text` lines.
const readEntryFields = (
  entryBlock: EntryBlock,
): { fieldByName: Map<EntryFieldName, EntryField>; steps: FlowStep[] } => {
  const fieldByName = new Map<EntryFieldName, EntryField>()
  const steps: FlowStep[] = []
  let currentFieldName: EntryFieldName | null = null
  for (const [lineIndex, entryLine] of entryBlock.lines.entries()) {
    const line = entryBlock.line + lineIndex
    const [, fieldName, fieldText = ''] = ENTRY_FIELD_PATTERN.exec(entryLine) ?? []
    if (isEntryFieldName(fieldName)) {
      currentFieldName = fieldName
      fieldByName.set(fieldName, { text: fieldText.trim(), line })
      continue
    }
    const currentField = currentFieldName === null ? undefined : fieldByName.get(currentFieldName)
    const continuationText = entryLine.trim()
    if (currentField === undefined || continuationText === '') {
      continue
    }
    currentField.text = `${currentField.text} ${continuationText}`.trim()
    const [, stepNumberText, stepText = ''] =
      currentFieldName === 'steps' ? (FLOW_STEP_PATTERN.exec(entryLine) ?? []) : []
    if (stepNumberText !== undefined) {
      const isExternal = stepText.includes(EXTERNAL_STEP_MARKER)
      steps.push({ number: Number(stepNumberText), text: stepText, isExternal, line })
      continue
    }
    // A wrapped step line belongs to the step above it, so a marker on it counts.
    const lastStep = currentFieldName === 'steps' ? steps.at(-1) : undefined
    if (lastStep !== undefined) {
      lastStep.text = `${lastStep.text} ${continuationText}`
      lastStep.isExternal = lastStep.text.includes(EXTERNAL_STEP_MARKER)
    }
  }
  return { fieldByName, steps }
}

const parseEntry = (entryBlock: EntryBlock): { entry: LedgerEntry; problems: Problem[] } => {
  const { id, file } = entryBlock
  const { fieldByName, steps } = readEntryFields(entryBlock)
  const problems: Problem[] = []

  if (!ID_PATTERN.test(id)) {
    problems.push(
      errorAt(PROBLEM_CODES.invalidField, entryBlock, id, `"${id}" is not <domain>.<name>`),
    )
  }
  const ledgerFileDomain = basename(file, '.md')
  if (domainOf(id) !== ledgerFileDomain) {
    const message = `${id} belongs in ${LEDGER_DIRECTORY}/${domainOf(id)}.md, not ${file}`
    problems.push(errorAt(PROBLEM_CODES.misplacedEntry, entryBlock, id, message))
  }
  for (const requiredFieldName of REQUIRED_FIELD_NAMES) {
    const isFieldWritten = (fieldByName.get(requiredFieldName)?.text ?? '') !== ''
    if (!isFieldWritten) {
      const message = `${id} has no ${requiredFieldName}:`
      problems.push(errorAt(PROBLEM_CODES.missingField, entryBlock, id, message))
    }
  }

  const kindField = fieldByName.get('kind')
  const kind = kindField !== undefined && isEntryKind(kindField.text) ? kindField.text : null
  if (kindField !== undefined && kind === null && kindField.text !== '') {
    const message = `kind "${kindField.text}" is not one of ${ENTRY_KIND_NAMES.join(', ')}`
    problems.push(errorAt(PROBLEM_CODES.invalidField, { file, line: kindField.line }, id, message))
  }

  const versionField = fieldByName.get('version')
  const isVersionValid = versionField !== undefined && VERSION_PATTERN.test(versionField.text)
  const version = isVersionValid ? Number(versionField.text) : null
  if (versionField !== undefined && !isVersionValid && versionField.text !== '') {
    const message = `version "${versionField.text}" is not a whole number from 1 up`
    problems.push(
      errorAt(PROBLEM_CODES.invalidField, { file, line: versionField.line }, id, message),
    )
  }

  const statusField = fieldByName.get('status')
  const statusText = statusField?.text ?? ENTRY_STATUSES.active
  const status = isEntryStatus(statusText) ? statusText : ENTRY_STATUSES.active
  if (statusField !== undefined && !isEntryStatus(statusText)) {
    const message = `status "${statusText}" is not one of ${ENTRY_STATUS_NAMES.join(', ')}`
    problems.push(
      errorAt(PROBLEM_CODES.invalidField, { file, line: statusField.line }, id, message),
    )
  }

  const isFlowWithoutSteps = kind === ENTRY_KINDS.flow && steps.length === 0
  if (isFlowWithoutSteps) {
    const message = `${id} is a flow with no numbered steps under steps:`
    problems.push(errorAt(PROBLEM_CODES.missingField, entryBlock, id, message))
  }

  const sourceText = fieldByName.get('source')?.text ?? ''
  const provenance =
    sourceText === ''
      ? ENTRY_PROVENANCES.unsourced
      : INFERRED_SOURCE_PATTERN.test(sourceText)
        ? ENTRY_PROVENANCES.inferred
        : ENTRY_PROVENANCES.recorded

  const what = fieldByName.get('what')?.text ?? ''
  const claim = claimOf(what)
  const isLongClaim = status === ENTRY_STATUSES.active && claim.length > CLAIM_MAX_LENGTH
  if (isLongClaim) {
    const whatLine = fieldByName.get('what')?.line ?? entryBlock.line
    const message = `${id}'s what opens with a ${claim.length}-character sentence: put the claim first, in at most ${CLAIM_MAX_LENGTH} characters, and the detail after it`
    problems.push(warningAt(PROBLEM_CODES.longWhat, { file, line: whatLine }, id, message))
  }
  const text = entryBlock.lines.join('\n').trimEnd()
  return {
    entry: {
      id,
      file,
      line: entryBlock.line,
      kind,
      version,
      status,
      provenance,
      what,
      claim,
      why: fieldByName.get('why')?.text ?? '',
      rejected: fieldByName.get('rejected')?.text ?? '',
      untestedReason: fieldByName.get('untested')?.text ?? '',
      steps,
      text,
    },
    problems,
  }
}

// The files in logicmap/ with this extension, as repo-relative paths in name order.
const listLedgerDirectoryFiles = (repoRoot: string, extension: string): string[] => {
  const ledgerPath = join(repoRoot, LEDGER_DIRECTORY)
  if (!existsSync(ledgerPath)) {
    return []
  }
  return readdirSync(ledgerPath)
    .filter((fileName) => fileName.endsWith(extension))
    .sort()
    .map((fileName) => `${LEDGER_DIRECTORY}/${fileName}`)
}

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

const readLedger = (
  repoRoot: string,
): {
  entriesById: Map<string, LedgerEntry>
  domainsByName: Map<string, LedgerDomain>
  problems: Problem[]
} => {
  const entriesById = new Map<string, LedgerEntry>()
  const domainsByName = new Map<string, LedgerDomain>()
  const problems: Problem[] = []
  for (const file of listLedgerDirectoryFiles(repoRoot, LEDGER_FILE_EXTENSION)) {
    const fileText = readFileSync(join(repoRoot, file), 'utf8')
    const domainName = basename(file, LEDGER_FILE_EXTENSION)
    domainsByName.set(domainName, { name: domainName, file, intro: readDomainIntro(fileText) })
    for (const entryBlock of splitIntoEntryBlocks(file, fileText)) {
      const { entry, problems: entryProblems } = parseEntry(entryBlock)
      problems.push(...entryProblems)
      const firstEntry = entriesById.get(entry.id)
      if (firstEntry !== undefined) {
        const message = `${entry.id} already has an entry at ${firstEntry.file}:${firstEntry.line}`
        problems.push(errorAt(PROBLEM_CODES.duplicateEntry, entry, entry.id, message))
        continue
      }
      entriesById.set(entry.id, entry)
    }
  }
  return { entriesById, domainsByName, problems }
}

// ---------- Cross-check: each anchor against its entry, each entry against its anchors ----------

const describeAnchor = (anchor: Anchor): string => {
  const stepSuffix = anchor.step === null ? '' : ` #${anchor.step}`
  return `§${anchor.role} ${anchor.id}@${anchor.version}${stepSuffix}`
}

// decision, invariant, edge and flow anchors define their entry; uses and test anchors refer to it.
const isDefiningRole = (role: AnchorRole): boolean => ENTRY_KIND_NAMES.includes(role)

const checkAnchorAgainstEntry = (anchor: Anchor, entry: LedgerEntry): Problem[] => {
  const problems: Problem[] = []
  const anchorText = describeAnchor(anchor)
  const isRoleMismatch =
    entry.kind !== null && isDefiningRole(anchor.role) && anchor.role !== entry.kind
  if (isRoleMismatch) {
    const message = `${anchorText} is a ${anchor.role} anchor, but the entry ${entry.id} has kind ${entry.kind}: write §${entry.kind} here, or §uses if this site only relies on it`
    problems.push(errorAt(PROBLEM_CODES.roleMismatch, anchor, anchor.id, message))
  }
  const isFlowAnchor = anchor.role === ANCHOR_ROLES.flow
  if (isFlowAnchor && anchor.step === null) {
    const message = `${anchorText} needs the number of the step it implements: §flow ${anchor.id}@${anchor.version} #<step>`
    problems.push(errorAt(PROBLEM_CODES.missingStep, anchor, anchor.id, message))
  }
  if (!isFlowAnchor && anchor.step !== null) {
    const message = `${anchorText}: only §flow anchors carry a step; drop "#${anchor.step}"`
    problems.push(errorAt(PROBLEM_CODES.misplacedStep, anchor, anchor.id, message))
  }
  const isUnknownStep =
    isFlowAnchor &&
    anchor.step !== null &&
    entry.kind === ENTRY_KINDS.flow &&
    !entry.steps.some((flowStep) => flowStep.number === anchor.step)
  if (isUnknownStep) {
    const listedStepNumbers = entry.steps.map((flowStep) => flowStep.number).join(', ')
    const message = `${anchorText}: ${entry.id} lists steps ${listedStepNumbers} in ${entry.file}, not ${anchor.step}`
    problems.push(errorAt(PROBLEM_CODES.unknownStep, anchor, anchor.id, message))
  }
  const isStalePin = entry.version !== null && anchor.version !== entry.version
  if (isStalePin) {
    const message = `${anchorText} pins version ${anchor.version}, the entry is at ${entry.version}: re-verify this site against ${entry.file}, then move its pin to @${entry.version}`
    problems.push(errorAt(PROBLEM_CODES.stalePin, anchor, anchor.id, message))
  }
  return problems
}

const checkEntryAgainstAnchors = (entry: LedgerEntry, entryAnchors: Anchor[]): Problem[] => {
  const problems: Problem[] = []
  if (entry.status === ENTRY_STATUSES.retired) {
    for (const anchor of entryAnchors) {
      const message = `${describeAnchor(anchor)}: ${entry.id} is retired in ${entry.file}; delete this anchor, or give logic that came back a new id`
      problems.push(errorAt(PROBLEM_CODES.retiredAnchored, anchor, entry.id, message))
    }
    return problems
  }
  if (entry.kind === ENTRY_KINDS.flow) {
    for (const flowStep of entry.steps) {
      const hasSite = entryAnchors.some(
        (anchor) => anchor.role === ANCHOR_ROLES.flow && anchor.step === flowStep.number,
      )
      if (!flowStep.isExternal && !hasSite) {
        const message = `step ${flowStep.number} of ${entry.id} ("${flowStep.text}") has no §flow ${entry.id}@${entry.version} #${flowStep.number} anchor; mark it (external) if no code in this repo runs it`
        problems.push(
          errorAt(
            PROBLEM_CODES.stepWithoutSite,
            { file: entry.file, line: flowStep.line },
            entry.id,
            message,
          ),
        )
      }
    }
    return problems
  }
  if (entry.kind === null) {
    return problems
  }
  const [firstDefiningAnchor, ...extraDefiningAnchors] = entryAnchors.filter(
    (anchor) => anchor.role === entry.kind,
  )
  if (firstDefiningAnchor === undefined) {
    const message = `${entry.id} has no §${entry.kind} anchor: put one above the code that implements it, or retire the entry`
    problems.push(errorAt(PROBLEM_CODES.orphanEntry, entry, entry.id, message))
  }
  for (const extraDefiningAnchor of extraDefiningAnchors) {
    const message = `${entry.id} is already defined at ${firstDefiningAnchor?.file}:${firstDefiningAnchor?.line}: keep one §${entry.kind}, make the others §uses`
    problems.push(
      errorAt(PROBLEM_CODES.duplicateDefinition, extraDefiningAnchor, entry.id, message),
    )
  }
  const isProvableKind = entry.kind === ENTRY_KINDS.edge || entry.kind === ENTRY_KINDS.invariant
  const hasTestAnchor = entryAnchors.some((anchor) => anchor.role === ANCHOR_ROLES.test)
  const isUntestedOnPurpose = entry.untestedReason !== ''
  if (isProvableKind && !hasTestAnchor && !isUntestedOnPurpose) {
    const message = `${entry.id} is an ${entry.kind} no test proves: put §test ${entry.id}@${entry.version} above the test that does, write one, or say why none can in untested:`
    problems.push(warningAt(PROBLEM_CODES.untested, entry, entry.id, message))
  }
  return problems
}

// ---------- Lock: each site's fingerprint as it was at its last ack ----------

// The code under an anchor, or an entry's text. The key names the place, the version and fingerprint
// record what was verified there. Only a defining anchor's code and an entry are in the lock: a uses or
// test site claims only that it relies on the rule, and its pin says when the rule changed (stale-pin).
// Every site keeps its covered lines, which show and the hook print.
type LockSite = {
  key: string
  isInLock: boolean
  id: string
  version: number
  fingerprint: string
  // As lock lines written before comments left the code fingerprint hold it; an entry's is its fingerprint.
  fingerprintWithComments: string
  file: string
  line: number
  lastLine: number
  label: string
}

type LockedSite = { version: number; fingerprint: string; file: string; line: number }

const ENTRY_LOCK_ROLE = 'entry'

const ANCHOR_PATTERN_GLOBAL = new RegExp(ANCHOR_SOURCE, 'g')

// What is left of a line that held only an anchor: the comment markers it sat between.
const ANCHOR_RESIDUE_PATTERN = /^(\/\/|#|--|\*|\/\*|\*\/|\/\*\s*\*\/|\{\/\*\s*\*\/\}|<!--\s*-->)?$/

// Whitespace and anchors are left out, so reformatting a block, moving another pin, or adding an
// anchor inside the block changes nothing. An entry's text is fingerprinted this way.
const fingerprintLines = (lines: string[]): string => {
  const normalizedText = lines
    .map((line) => line.replace(ANCHOR_PATTERN_GLOBAL, '').replace(/\s+/g, ' ').trim())
    .filter((line) => !ANCHOR_RESIDUE_PATTERN.test(line))
    .join('\n')
  return createHash('sha256').update(normalizedText).digest('hex').slice(0, 12)
}

// Marks a code fingerprint taken without comments; a lock line without it holds one taken with them.
const CODE_FINGERPRINT_PREFIX = 'v2:'
// `# ` and `-- ` but not `#private` or `--count`; a comment at the end of a code line stays in, since
// a `//` can sit inside a string.
const COMMENT_ONLY_LINE_PATTERN = /^\s*(\/\/|#(\s|!|$)|--(\s|$)|<!--)/
const BLOCK_COMMENT_OPENING_LINE_PATTERN = /^\s*\{?\/\*/
const BLOCK_COMMENT_END = '*/'

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

// Rewording a comment in the block changes nothing either.
const fingerprintCode = (lines: string[]): string =>
  `${CODE_FINGERPRINT_PREFIX}${fingerprintLines(dropCommentLines(lines))}`

// A JSX comment (`{/* ... */}`) counts too: among JSX children it is the only comment that stays one.
const COMMENT_LINE_PATTERN = /^\s*(\/\/|\/\*|\*|#|--|<!--|\{\/\*)/
const DECORATOR_LINE_PATTERN = /^\s*@/
const CLOSING_BRACKET_LINE_PATTERN = /^\s*[)\]}]/
const OPENS_BLOCK_PATTERN = /[{([]\s*$/

const indentOf = (line: string): number => line.length - line.trimStart().length
const isBlankLine = (line: string): boolean => line.trim() === ''

/*
 * The lines an anchor covers, the ones its fingerprint hashes:
 *
 *   head:  the anchor's own line when code precedes the anchor   `return null // §edge ...`
 *          otherwise the first code line below the comment, through any decorators
 *   block: every following line indented deeper than the head,
 *          plus closing-bracket lines at the head's indentation  `}`  `)`  `} else {`
 *          (a closing line that opens a new block keeps the block going)
 */
type AnchoredLineRange = { headLineIndex: number; lastLineIndex: number }

const findAnchoredLineRange = (
  fileLines: string[],
  anchorLineIndex: number,
): AnchoredLineRange | null => {
  const anchorLine = fileLines[anchorLineIndex] ?? ''
  const isCommentOnlyAnchorLine = COMMENT_LINE_PATTERN.test(anchorLine)
  const headLineIndex = isCommentOnlyAnchorLine
    ? fileLines.findIndex(
        (line, lineIndex) =>
          lineIndex > anchorLineIndex && !isBlankLine(line) && !COMMENT_LINE_PATTERN.test(line),
      )
    : anchorLineIndex
  if (headLineIndex === -1) {
    return null
  }
  let decoratedLineIndex = headLineIndex
  while (
    DECORATOR_LINE_PATTERN.test(fileLines[decoratedLineIndex] ?? '') &&
    decoratedLineIndex + 1 < fileLines.length
  ) {
    decoratedLineIndex += 1
  }
  const headIndent = indentOf(fileLines[decoratedLineIndex] ?? '')
  let lastLineIndex = decoratedLineIndex
  for (let lineIndex = decoratedLineIndex + 1; lineIndex < fileLines.length; lineIndex += 1) {
    const line = fileLines[lineIndex] ?? ''
    if (isBlankLine(line)) {
      continue
    }
    if (indentOf(line) > headIndent) {
      lastLineIndex = lineIndex
      continue
    }
    const isClosingLineOfBlock =
      indentOf(line) === headIndent && CLOSING_BRACKET_LINE_PATTERN.test(line)
    if (!isClosingLineOfBlock) {
      break
    }
    lastLineIndex = lineIndex
    if (!OPENS_BLOCK_PATTERN.test(line)) {
      break
    }
  }
  return { headLineIndex, lastLineIndex }
}

// Anchors of retired entries are left out: they must be deleted, not acked.
const collectLockSites = (
  repoRoot: string,
  anchors: Anchor[],
  entriesById: Map<string, LedgerEntry>,
): LockSite[] => {
  const lockSites: LockSite[] = []
  const fileLinesByFile = new Map<string, string[]>()
  const occurrenceCountByPlace = new Map<string, number>()
  for (const anchor of anchors) {
    const isActiveEntryAnchor = entriesById.get(anchor.id)?.status === ENTRY_STATUSES.active
    if (!isActiveEntryAnchor) {
      continue
    }
    const fileLines =
      fileLinesByFile.get(anchor.file) ??
      readFileSync(join(repoRoot, anchor.file), 'utf8').split('\n')
    fileLinesByFile.set(anchor.file, fileLines)
    // The nth anchor of this id and role in this file: stable while the code around it is edited.
    const place = `${anchor.id} ${anchor.role} ${anchor.file}`
    const occurrence = (occurrenceCountByPlace.get(place) ?? 0) + 1
    occurrenceCountByPlace.set(place, occurrence)
    const anchoredLineRange = findAnchoredLineRange(fileLines, anchor.line - 1)
    const anchoredLines =
      anchoredLineRange === null
        ? []
        : fileLines.slice(anchoredLineRange.headLineIndex, anchoredLineRange.lastLineIndex + 1)
    lockSites.push({
      key: `${place}#${occurrence}`,
      isInLock: isDefiningRole(anchor.role),
      id: anchor.id,
      version: anchor.version,
      fingerprint: fingerprintCode(anchoredLines),
      fingerprintWithComments: fingerprintLines(anchoredLines),
      file: anchor.file,
      line: anchor.line,
      lastLine: anchoredLineRange === null ? anchor.line : anchoredLineRange.lastLineIndex + 1,
      label: `the code under ${describeAnchor(anchor)}`,
    })
  }
  for (const entry of entriesById.values()) {
    const entryFingerprint = fingerprintLines(entry.text.split('\n'))
    lockSites.push({
      key: `${entry.id} ${ENTRY_LOCK_ROLE} ${entry.file}#1`,
      isInLock: true,
      id: entry.id,
      version: entry.version ?? 0,
      fingerprint: entryFingerprint,
      fingerprintWithComments: entryFingerprint,
      file: entry.file,
      line: entry.line,
      lastLine: entry.line + entry.text.split('\n').length - 1,
      label: `the entry ${entry.id}`,
    })
  }
  return lockSites
}

const idOfLockKey = (key: string): string => key.split(' ')[0] ?? key

// A key is "<id> <role> <file>#<n>", or "<id> entry <file>#1" for an entry.
const roleOfLockKey = (key: string): string => key.split(' ')[1] ?? ''
const isRelyingSiteKey = (key: string): boolean => {
  const role = roleOfLockKey(key)
  return role === ANCHOR_ROLES.uses || role === ANCHOR_ROLES.test
}

// One lock per domain, beside its ledger file (logicmap/sync.lock next to logicmap/sync.md), so an
// ack rewrites only the lock of the domain it touched.
const lockFileOf = (id: string): string =>
  `${LEDGER_DIRECTORY}/${domainOf(id)}${LOCK_FILE_EXTENSION}`

// A repo mapped before the split keeps its single logicmap/lock until the next ack splits it. It is
// listed first, so for a key in both, the domain file read after it wins.
const listLockFiles = (repoRoot: string): string[] => {
  const domainLockFiles = listLedgerDirectoryFiles(repoRoot, LOCK_FILE_EXTENSION)
  const hasSingleLockFile = existsSync(join(repoRoot, SINGLE_LOCK_FILE_BEFORE_SPLIT))
  return hasSingleLockFile ? [SINGLE_LOCK_FILE_BEFORE_SPLIT, ...domainLockFiles] : domainLockFiles
}

// A lock line is "<key> <version> <fingerprint>"; the key may hold spaces (a path), so parse from the end.
const readLock = (repoRoot: string): Map<string, LockedSite> => {
  const lockedSitesByKey = new Map<string, LockedSite>()
  for (const lockFile of listLockFiles(repoRoot)) {
    const lockLines = readFileSync(join(repoRoot, lockFile), 'utf8').split('\n')
    for (const [lineIndex, lockLine] of lockLines.entries()) {
      const isRecordLine = lockLine !== '' && !lockLine.startsWith('#')
      if (!isRecordLine) {
        continue
      }
      const lockLineParts = lockLine.split(' ')
      const fingerprint = lockLineParts.pop() ?? ''
      const version = Number(lockLineParts.pop())
      const line = lineIndex + 1
      const key = lockLineParts.join(' ')
      // Written before uses and test sites left the lock; the next ack of its domain drops it.
      if (isRelyingSiteKey(key)) {
        continue
      }
      lockedSitesByKey.set(key, { version, fingerprint, file: lockFile, line })
    }
  }
  return lockedSitesByKey
}

// A lock line compares by the fingerprint it holds: taken without comments, or with them, before.
const isAsLocked = (lockSite: LockSite, lockedSite: LockedSite): boolean => {
  const isLockedWithoutComments = lockedSite.fingerprint.startsWith(CODE_FINGERPRINT_PREFIX)
  const currentFingerprint = isLockedWithoutComments
    ? lockSite.fingerprint
    : lockSite.fingerprintWithComments
  return lockedSite.version === lockSite.version && lockedSite.fingerprint === currentFingerprint
}

// "<id> <role>": a site moved to another file, or renumbered in its own, keeps them.
const idAndRoleOfLockKey = (key: string): string => key.split(' ').slice(0, 2).join(' ')

/*
 * Each site in the lock claims the lock line that holds its code, so a site that moved is no problem:
 *
 *   1. its own key, its code as locked                          → as locked
 *   2. another unclaimed key of its id and role, its code there  → moved (another file, or renumbered)
 *   3. its own key, unclaimed, other code                        → changed
 *   4. none                                                      → unacked
 *   a lock line no site claimed                                  → gone
 */
// Past this many lines an anchor likely covers more than its rule, so an edit beside the rule asks for an
// ack; said when it does, not as a warning on every check.
const LONG_BLOCK_LINE_COUNT = 60
const longBlockHintOf = (lockSite: LockSite): string => {
  const coveredLineCount = lockSite.lastLine - lockSite.line + 1
  const isLongAnchoredBlock =
    roleOfLockKey(lockSite.key) !== ENTRY_LOCK_ROLE && coveredLineCount > LONG_BLOCK_LINE_COUNT
  return isLongAnchoredBlock
    ? ` It covers ${coveredLineCount} lines: if the edit is beside the rule, move the anchor to the smaller block that holds it.`
    : ''
}

const checkLock = (lockSites: LockSite[], lockedSitesByKey: Map<string, LockedSite>): Problem[] => {
  const problems: Problem[] = []
  const claimedKeys = new Set<string>()
  const claimLockLineOf = (lockSite: LockSite, key: string): boolean => {
    const lockedSite = lockedSitesByKey.get(key)
    const isClaimable =
      lockedSite !== undefined && !claimedKeys.has(key) && isAsLocked(lockSite, lockedSite)
    if (isClaimable) {
      claimedKeys.add(key)
    }
    return isClaimable
  }
  const sitesNotAsLocked = lockSites
    .filter((lockSite) => lockSite.isInLock)
    .filter((lockSite) => !claimLockLineOf(lockSite, lockSite.key))
  const sitesNotMoved = sitesNotAsLocked.filter((lockSite) => {
    const keysOfItsIdAndRole = [...lockedSitesByKey.keys()].filter(
      (key) => idAndRoleOfLockKey(key) === idAndRoleOfLockKey(lockSite.key),
    )
    return !keysOfItsIdAndRole.some((key) => claimLockLineOf(lockSite, key))
  })
  for (const lockSite of sitesNotMoved) {
    const isOwnKeyFree = lockedSitesByKey.has(lockSite.key) && !claimedKeys.has(lockSite.key)
    if (isOwnKeyFree) {
      claimedKeys.add(lockSite.key)
      const message = `${lockSite.label} changed since the last ack: re-read the entry ${lockSite.id}; it still holds → ack ${lockSite.id}; its meaning changed → bump its version.${longBlockHintOf(lockSite)}`
      problems.push(errorAt(PROBLEM_CODES.changed, lockSite, lockSite.id, message))
      continue
    }
    const message = `${lockSite.label} is not in the lock (new, or moved and edited): verify it, then ack ${lockSite.id}.${longBlockHintOf(lockSite)}`
    problems.push(errorAt(PROBLEM_CODES.unacked, lockSite, lockSite.id, message))
  }
  for (const [key, lockedSite] of lockedSitesByKey) {
    if (!claimedKeys.has(key)) {
      const id = idOfLockKey(key)
      const message = `${key} is gone since the last ack: ack ${id} to drop it`
      problems.push(errorAt(PROBLEM_CODES.gone, lockedSite, id, message))
    }
  }
  return problems
}

// ---------- Analysis: what check, ack and show all start from ----------

const byFileThenLine = (first: Problem, second: Problem): number =>
  first.file.localeCompare(second.file) || first.line - second.line

// Problems here cover anchors and ledger; the lock is compared separately (ack rewrites it).
type RepoAnalysis = {
  anchors: Anchor[]
  entriesById: Map<string, LedgerEntry>
  domainsByName: Map<string, LedgerDomain>
  lockSites: LockSite[]
  problems: Problem[]
}

const analyzeRepo = (repoRoot: string): RepoAnalysis => {
  const { anchors, problems } = scanAnchors(repoRoot)
  const { entriesById, domainsByName, problems: ledgerProblems } = readLedger(repoRoot)
  problems.push(...ledgerProblems)
  const anchorsById = new Map<string, Anchor[]>()
  for (const anchor of anchors) {
    anchorsById.set(anchor.id, [...(anchorsById.get(anchor.id) ?? []), anchor])
    const entry = entriesById.get(anchor.id)
    if (entry === undefined) {
      const message = `${anchor.id} has no entry: add "## ${anchor.id}" to ${LEDGER_DIRECTORY}/${domainOf(anchor.id)}.md`
      problems.push(errorAt(PROBLEM_CODES.undocumented, anchor, anchor.id, message))
      continue
    }
    if (entry.status === ENTRY_STATUSES.active) {
      problems.push(...checkAnchorAgainstEntry(anchor, entry))
    }
  }
  for (const entry of entriesById.values()) {
    problems.push(...checkEntryAgainstAnchors(entry, anchorsById.get(entry.id) ?? []))
  }
  const lockSites = collectLockSites(repoRoot, anchors, entriesById)
  return { anchors, entriesById, domainsByName, lockSites, problems }
}

const findAllProblems = (repoRoot: string, analysis: RepoAnalysis): Problem[] =>
  [...analysis.problems, ...checkLock(analysis.lockSites, readLock(repoRoot))].sort(byFileThenLine)

// ---------- Entry points: check, ack, show ----------

export const checkRepo = (repoRoot: string): Problem[] =>
  findAllProblems(repoRoot, analyzeRepo(repoRoot))

const LOCK_HEADER =
  '# logicmap lock: the fingerprint of each anchored site and ledger entry at its last ack. Written by `logicmap ack <id>`.'

// Ack means "an agent re-read these entries against their code": an id with an error cannot be verified,
// so nothing is written while any requested id has one.
export const ackIds = (
  repoRoot: string,
  ids: string[],
): { ackedIds: string[]; blockingProblems: Problem[] } => {
  const { anchors, entriesById, lockSites, problems } = analyzeRepo(repoRoot)
  const lockedSitesByKey = readLock(repoRoot)
  const requestedIds = new Set(ids)
  const blockingProblems = problems.filter(
    (problem) =>
      problem.severity === PROBLEM_SEVERITIES.error &&
      problem.id !== null &&
      requestedIds.has(problem.id),
  )
  for (const id of requestedIds) {
    const isKnownId =
      entriesById.has(id) ||
      anchors.some((anchor) => anchor.id === id) ||
      [...lockedSitesByKey.keys()].some((key) => idOfLockKey(key) === id)
    if (!isKnownId) {
      const message = `${id} is not an anchor, an entry or a lock line`
      blockingProblems.push(
        errorAt(PROBLEM_CODES.unknownId, { file: lockFileOf(id), line: 0 }, id, message),
      )
    }
  }
  if (blockingProblems.length > 0) {
    return { ackedIds: [], blockingProblems: blockingProblems.sort(byFileThenLine) }
  }

  const sitesInLockByKey = new Map(
    lockSites.filter((lockSite) => lockSite.isInLock).map((lockSite) => [lockSite.key, lockSite]),
  )
  // A kept line whose code is as it was locked takes the fingerprint an ack writes now: the same code,
  // so nothing is acked unread, and lines taken with comments die out.
  const keptLockLines = [...lockedSitesByKey]
    .filter(([key]) => !requestedIds.has(idOfLockKey(key)))
    .map(([key, lockedSite]) => {
      const lockSite = sitesInLockByKey.get(key)
      const isUnchanged = lockSite !== undefined && isAsLocked(lockSite, lockedSite)
      const fingerprint = isUnchanged ? lockSite.fingerprint : lockedSite.fingerprint
      return `${key} ${lockedSite.version} ${fingerprint}`
    })
  const ackedLockLines = lockSites
    .filter((lockSite) => lockSite.isInLock && requestedIds.has(lockSite.id))
    .map((lockSite) => `${lockSite.key} ${lockSite.version} ${lockSite.fingerprint}`)
  const lockLines = [...keptLockLines, ...ackedLockLines].sort()
  // A lock line starts with its key, and a key with its id.
  const lockLinesByFile = Map.groupBy(lockLines, (lockLine) => lockFileOf(idOfLockKey(lockLine)))
  // Only the acked ids' lock files are written, so two sessions acking different domains never overwrite
  // each other's lines; splitting the single lock from before the split writes every domain's file.
  const ackedLockFiles = new Set([...requestedIds].map(lockFileOf))
  const isSplittingSingleLock = existsSync(join(repoRoot, SINGLE_LOCK_FILE_BEFORE_SPLIT))
  for (const [lockFile, domainLockLines] of lockLinesByFile) {
    const shouldWriteLockFile = isSplittingSingleLock || ackedLockFiles.has(lockFile)
    if (shouldWriteLockFile) {
      writeFileSync(join(repoRoot, lockFile), `${[LOCK_HEADER, ...domainLockLines].join('\n')}\n`)
    }
  }
  // The single lock from before the split, or a domain whose entries were all deleted: left on disk,
  // its old lines would be read back as `gone`.
  for (const lockFile of listLockFiles(repoRoot)) {
    const holdsNoLockLine = !lockLinesByFile.has(lockFile)
    if (holdsNoLockLine) {
      rmSync(join(repoRoot, lockFile))
    }
  }
  return { ackedIds: [...requestedIds], blockingProblems: [] }
}

const ANCHOR_ROLE_ORDER: readonly string[] = ANCHOR_ROLE_NAMES

// Flow steps first by step number; otherwise defining anchors, then uses, then tests.
const bySiteOrder = (first: Anchor, second: Anchor): number =>
  (first.step ?? 0) - (second.step ?? 0) ||
  ANCHOR_ROLE_ORDER.indexOf(first.role) - ANCHOR_ROLE_ORDER.indexOf(second.role) ||
  first.file.localeCompare(second.file) ||
  first.line - second.line

// The status column: "ok", or the codes of every problem found at that place.
const statusOf = (placeProblems: Problem[]): string =>
  placeProblems.length === 0
    ? 'ok'
    : [...new Set(placeProblems.map((problem) => problem.code))].join(',')

// Lines of one file, both ends included, numbered from 1.
export type LineRange = { firstLine: number; lastLine: number }

// One rule in a file's view: its claim and the lines each of its sites there covers.
export type RuleSection = { id: string; version: number | null; text: string }

const describeLineRange = ({ firstLine, lastLine }: LineRange): string =>
  firstLine === lastLine ? `${firstLine}` : `${firstLine}-${lastLine}`

const doLineRangesMeet = (first: LineRange, second: LineRange): boolean =>
  first.firstLine <= second.lastLine && second.firstLine <= first.lastLine

// `src/room.ts:40` or `src/room.ts:40-60`: the rules covering those lines of that file.
const FILE_LINES_TARGET_PATTERN = /^(.+):(\d+)(?:-(\d+))?$/

const countOf = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`

const SHOW_LEVELS_HINT =
  'show <domain>: its rules and their claims; show <id>: one rule and its sites; show <file>[:<line>[-<line>]]: the rules in a file.'

// The views an agent reads, from the widest to the narrowest: every domain with its intro and its rule
// ids; a domain's rules with their claims; one rule's entry and sites; the rules in a file or some of its lines.
const createShowViews = (repoRoot: string) => {
  const analysis = analyzeRepo(repoRoot)
  const problems = findAllProblems(repoRoot, analysis)

  const siteStatusOf = (anchor: Anchor): string =>
    statusOf(
      problems.filter(
        (problem) =>
          problem.id === anchor.id && problem.file === anchor.file && problem.line === anchor.line,
      ),
    )

  // The lines an anchor covers, from its own line to the last line of its block; an anchor of a retired
  // entry has no block, only its line.
  const lastCoveredLineByPlace = new Map(
    analysis.lockSites.map((lockSite) => [`${lockSite.file}:${lockSite.line}`, lockSite.lastLine]),
  )
  const coveredLinesOf = (anchor: Anchor): LineRange => ({
    firstLine: anchor.line,
    lastLine: lastCoveredLineByPlace.get(`${anchor.file}:${anchor.line}`) ?? anchor.line,
  })

  const describeSite = (anchor: Anchor): string =>
    `${anchor.file}:${describeLineRange(coveredLinesOf(anchor))}  ${describeAnchor(anchor)}  ${siteStatusOf(anchor)}`

  // Each rule once, in the order its first site appears, with every site in the requested lines under it.
  const listFileRuleSections = (file: string, requestedLines: LineRange | null): RuleSection[] => {
    const fileAnchors = analysis.anchors.filter((anchor) => anchor.file === file)
    const shownAnchors =
      requestedLines === null
        ? fileAnchors
        : fileAnchors.filter((anchor) => doLineRangesMeet(coveredLinesOf(anchor), requestedLines))
    const anchorsById = Map.groupBy(shownAnchors, (anchor) => anchor.id)
    return [...anchorsById].map(([id, ruleAnchors]) => {
      const entry = analysis.entriesById.get(id)
      const ruleLine =
        entry === undefined
          ? `${id}  (no entry)`
          : `${id}@${entry.version ?? '?'}  ${entry.kind ?? '?'}  ${entry.provenance}  ${entry.claim}`
      const siteLines = ruleAnchors.map((anchor) => {
        const stepNote = anchor.step === null ? '' : ` #${anchor.step}`
        return `  ${describeLineRange(coveredLinesOf(anchor))}  §${anchor.role}${stepNote}  ${siteStatusOf(anchor)}`
      })
      return { id, version: entry?.version ?? null, text: [ruleLine, ...siteLines].join('\n') }
    })
  }
  const showFileRules = (file: string, requestedLines: LineRange | null): string =>
    listFileRuleSections(file, requestedLines)
      .map((ruleSection) => ruleSection.text)
      .join('\n')

  const isAnchoredFile = (file: string): boolean =>
    analysis.anchors.some((anchor) => anchor.file === file)
  const describeUnanchoredFile = (file: string): string =>
    `${file} has no anchors: no rule in the map is defined or used in it`

  const entryStatusOf = (entry: LedgerEntry): string =>
    statusOf(problems.filter((problem) => problem.id === entry.id))

  // Retired entries are counted in their domain's heading, never listed: no code follows them.
  const activeEntriesOf = (domain: LedgerDomain): LedgerEntry[] =>
    [...analysis.entriesById.values()]
      .filter((entry) => entry.file === domain.file && entry.status === ENTRY_STATUSES.active)
      .sort((first, second) => first.id.localeCompare(second.id))

  const describeDomain = (domain: LedgerDomain): string[] => {
    const retiredCount = [...analysis.entriesById.values()].filter(
      (entry) => entry.file === domain.file && entry.status === ENTRY_STATUSES.retired,
    ).length
    const retiredNote = retiredCount === 0 ? '' : ` (+${retiredCount} retired)`
    const headingLine = `${domain.name}  ${countOf(activeEntriesOf(domain).length, 'rule')}${retiredNote}  ${domain.file}`
    return domain.intro === '' ? [headingLine] : [headingLine, `  ${domain.intro}`]
  }

  // Each rule by its id alone, plus what differs from the usual: a problem, or a why nobody recorded.
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

  const showOneId = (id: string): string => {
    const entry = analysis.entriesById.get(id)
    const entryLines =
      entry === undefined
        ? [`${id} has no entry in ${LEDGER_DIRECTORY}/${domainOf(id)}.md`]
        : [`${entry.file}:${entry.line}`, entry.text]
    const siteLines = analysis.anchors
      .filter((anchor) => anchor.id === id)
      .sort(bySiteOrder)
      .map((anchor) => `  ${describeSite(anchor)}`)
    const problemLines = problems
      .filter((problem) => problem.id === id)
      .map((problem) => `  ${problem.file}:${problem.line} ${problem.code}: ${problem.message}`)
    const problemSection = problemLines.length === 0 ? [] : ['', 'problems:', ...problemLines]
    return [...entryLines, '', 'sites:', ...siteLines, ...problemSection].join('\n')
  }

  const isKnownId = (id: string): boolean =>
    analysis.entriesById.has(id) || analysis.anchors.some((anchor) => anchor.id === id)

  return {
    analysis,
    showDomainsMap,
    showOneDomain,
    showOneId,
    showFileRules,
    listFileRuleSections,
    isAnchoredFile,
    isKnownId,
    describeUnanchoredFile,
  }
}

export const showLogicMap = (repoRoot: string, target: string | undefined): string => {
  const views = createShowViews(repoRoot)
  if (target === undefined) {
    return views.showDomainsMap()
  }
  const [, fileOfLines, firstLineText, lastLineText] = FILE_LINES_TARGET_PATTERN.exec(target) ?? []
  if (fileOfLines !== undefined && views.isAnchoredFile(fileOfLines)) {
    const firstLine = Number(firstLineText)
    const lastLine = lastLineText === undefined ? firstLine : Number(lastLineText)
    const requestedLines = { firstLine, lastLine }
    const rulesView = views.showFileRules(fileOfLines, requestedLines)
    return rulesView === ''
      ? `${fileOfLines}:${describeLineRange(requestedLines)}: no rule covers these lines`
      : rulesView
  }
  if (views.isAnchoredFile(target)) {
    return views.showFileRules(target, null)
  }
  if (views.isKnownId(target)) {
    return views.showOneId(target)
  }
  const domain = views.analysis.domainsByName.get(target)
  if (domain !== undefined) {
    return views.showOneDomain(domain)
  }
  const unanchoredFile = fileOfLines ?? target
  if (existsSync(join(repoRoot, unanchoredFile))) {
    return views.describeUnanchoredFile(unanchoredFile)
  }
  return `nothing named "${target}": not a domain or an id in ${LEDGER_DIRECTORY}/, not a file with anchors`
}

// The rules covering some lines of a file (all of it when lines is null), each as show <file> prints it:
// what the hook adds after a read.
export const listRuleSectionsInLines = (
  repoRoot: string,
  file: string,
  lines: LineRange | null,
): RuleSection[] => {
  const views = createShowViews(repoRoot)
  return views.isAnchoredFile(file) ? views.listFileRuleSections(file, lines) : []
}

// ---------- Diff: what changed under a rule's sites since their last ack ----------

const runGit = (repoRoot: string, gitArguments: string[]): string =>
  execFileSync('git', gitArguments, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  })

// The commit that wrote this lock line, or null while HEAD's lock doesn't hold it (an ack since HEAD).
const findAckCommit = (repoRoot: string, lockFile: string, lockLine: string): string | null => {
  try {
    const committedLockLines = runGit(repoRoot, ['show', `HEAD:${lockFile}`]).split('\n')
    if (!committedLockLines.includes(lockLine)) {
      return null
    }
    const ackCommit = runGit(repoRoot, ['log', '-1', '--format=%h', '-S', lockLine, '--', lockFile])
    return ackCommit.trim() === '' ? null : ackCommit.trim()
  } catch {
    return null
  }
}

const HUNK_START_PATTERN = /^(?=@@ )/m
const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

// Where a hunk sits: its first line and its line count in the old file and in the new one.
type DiffHunk = {
  oldFirstLine: number
  oldLineCount: number
  newFirstLine: number
  newLineCount: number
}

const parseDiffHunk = (hunkText: string): DiffHunk | null => {
  const [, oldFirstText, oldCountText = '1', newFirstText, newCountText = '1'] =
    HUNK_HEADER_PATTERN.exec(hunkText) ?? []
  if (oldFirstText === undefined || newFirstText === undefined) {
    return null
  }
  return {
    oldFirstLine: Number(oldFirstText),
    oldLineCount: Number(oldCountText),
    newFirstLine: Number(newFirstText),
    newLineCount: Number(newCountText),
  }
}

// The last line of the new file a hunk holds; a hunk that only removes lines (+N,0) sits after line N.
const lastNewLineOf = (hunk: DiffHunk): number =>
  hunk.newFirstLine + Math.max(hunk.newLineCount, 1) - 1

// The hunks of a file's diff whose lines in the file as it is now meet these lines.
const hunksMeetingLines = (diffText: string, lines: LineRange): string[] =>
  diffText.split(HUNK_START_PATTERN).filter((hunkText) => {
    const hunk = parseDiffHunk(hunkText)
    return (
      hunk !== null &&
      doLineRangesMeet({ firstLine: hunk.newFirstLine, lastLine: lastNewLineOf(hunk) }, lines)
    )
  })

// For each site of the id whose code or entry differs from its lock line, the git diff of its file from
// the commit of its ack, the hunks that meet its lines: what to re-read before acking it again.
export const diffLogicMap = (repoRoot: string, id: string): string => {
  const { lockSites } = analyzeRepo(repoRoot)
  const lockedSitesByKey = readLock(repoRoot)
  const changedSiteSections = lockSites
    .filter((lockSite) => lockSite.isInLock && lockSite.id === id)
    .flatMap((lockSite) => {
      const lockedSite = lockedSitesByKey.get(lockSite.key)
      if (lockedSite === undefined || isAsLocked(lockSite, lockedSite)) {
        return []
      }
      const lockLine = `${lockSite.key} ${lockedSite.version} ${lockedSite.fingerprint}`
      const ackCommit = findAckCommit(repoRoot, lockedSite.file, lockLine)
      const sinceNote =
        ackCommit === null
          ? 'the ack is not committed yet, so from HEAD'
          : `since the ack in ${ackCommit}`
      const diffText = runGit(repoRoot, ['diff', '-U2', ackCommit ?? 'HEAD', '--', lockSite.file])
      const siteLines = { firstLine: lockSite.line, lastLine: lockSite.lastLine }
      const hunks = hunksMeetingLines(diffText, siteLines)
      const hunkLines =
        hunks.length === 0 ? ['  no hunk meets these lines (an untracked file has no diff)'] : hunks
      const headingLine = `${lockSite.file}:${describeLineRange(siteLines)}  ${lockSite.label}, ${sinceNote}:`
      return [[headingLine, ...hunkLines].join('\n').trimEnd()]
    })
  return changedSiteSections.length === 0
    ? `${id}: no site in the lock changed since its last ack`
    : changedSiteSections.join('\n\n')
}

// ---------- Why: the commits that changed some lines, and the reasons recorded with them ----------

const MAX_COMMITS_SHOWN = 10
// Opens each commit in git log's output (format %x1e): no line of a diff starts with it.
const COMMIT_SEPARATOR = '\x1e'

type LineCommit = { hash: string; date: string; subject: string; diffText: string }

type HeadLinesOfWorkingLines = { headLines: LineRange | null; uncommittedLines: number[] }

const isFileInHead = (repoRoot: string, file: string): boolean => {
  try {
    runGit(repoRoot, ['cat-file', '-e', `HEAD:${file}`])
    return true
  } catch {
    return false
  }
}

const listLineNumbers = ({ firstLine, lastLine }: LineRange): number[] =>
  Array.from({ length: Math.max(lastLine - firstLine + 1, 0) }, (_, offset) => firstLine + offset)

// 3, 4, 5, 9 → "3-5, 9"
const describeLineNumbers = (lineNumbers: number[]): string =>
  lineNumbers
    .reduce<LineRange[]>((ranges, line) => {
      const lastRange = ranges.at(-1)
      if (lastRange !== undefined && lastRange.lastLine === line - 1) {
        lastRange.lastLine = line
      } else {
        ranges.push({ firstLine: line, lastLine: line })
      }
      return ranges
    }, [])
    .map(describeLineRange)
    .join(', ')

// The working tree's lines as HEAD numbers them: git log -L reads HEAD, an agent reads the file as it is now.
// A line changed since HEAD stands for the lines it replaced; a line added since HEAD for none.
const toHeadLines = (repoRoot: string, file: string, lines: LineRange): HeadLinesOfWorkingLines => {
  const hunksSinceHead = runGit(repoRoot, ['diff', '-U0', 'HEAD', '--', file])
    .split(HUNK_START_PATTERN)
    .flatMap((hunkText) => parseDiffHunk(hunkText) ?? [])
  const findHunkHoldingLine = (line: number): DiffHunk | undefined =>
    hunksSinceHead.find(
      (hunk) => hunk.newLineCount > 0 && hunk.newFirstLine <= line && line <= lastNewLineOf(hunk),
    )
  const workingLines = listLineNumbers(lines)
  const headLineNumbers = workingLines.flatMap((line) => {
    const hunkHoldingLine = findHunkHoldingLine(line)
    if (hunkHoldingLine !== undefined) {
      return listLineNumbers({
        firstLine: hunkHoldingLine.oldFirstLine,
        lastLine: hunkHoldingLine.oldFirstLine + hunkHoldingLine.oldLineCount - 1,
      })
    }
    // Every hunk above the line moves it by the lines it removed less the lines it added.
    const lineShift = hunksSinceHead
      .filter((hunk) => lastNewLineOf(hunk) < line)
      .reduce((shift, hunk) => shift + hunk.oldLineCount - hunk.newLineCount, 0)
    return [line + lineShift]
  })
  const headLines =
    headLineNumbers.length === 0
      ? null
      : { firstLine: Math.min(...headLineNumbers), lastLine: Math.max(...headLineNumbers) }
  const uncommittedLines = workingLines.filter((line) => findHunkHoldingLine(line) !== undefined)
  return { headLines, uncommittedLines }
}

// Every commit that changed these lines of HEAD, newest first, with the diff git log -L shows for them;
// null when git can't trace them (lines past the end of the file).
// maxCount stops git after that many commits: a whole file's history otherwise prints every diff. A merge is
// left out: git lists one whose two sides changed the lines, its subject names branches, and its sides' commits
// are listed on their own (a hand-made conflict resolution goes unlisted).
const listLineCommitsOrNull = (
  repoRoot: string,
  file: string,
  headLines: LineRange,
  maxCount: number | null,
): LineCommit[] | null => {
  try {
    return runGit(repoRoot, [
      'log',
      `-L${headLines.firstLine},${headLines.lastLine}:${file}`,
      '--no-merges',
      '--format=%x1e%h %ad %s',
      '--date=short',
      ...(maxCount === null ? [] : [`--max-count=${maxCount}`]),
    ])
      .split(COMMIT_SEPARATOR)
      .slice(1)
      .map((commitText) => {
        const [headerLine = '', ...diffLines] = commitText.split('\n')
        const [, hash = '', date = '', subject = ''] = /^(\S+) (\S+) (.*)$/.exec(headerLine) ?? []
        return { hash, date, subject, diffText: diffLines.join('\n') }
      })
  } catch {
    return null
  }
}

// A recorded piece: a `## Piece N` section of a task's step doc (`## Bucata N` in older docs).
const PIECE_HEADING_PATTERN = /^## ((?:Piece|Bucata) [^:\s]+)/
const SECTION_START_PATTERN = /^(?=## )/m
// A field line of a piece: `What:`, `Why:`, `Where:`, `Run (red):`, ...
const PIECE_FIELD_PATTERN = /^[A-Z][a-z]+(?: [a-z]+)?(?: \([a-z]+\))?:(?: |$)/
// A shorter added line (`}`, `return null`) is in many pieces, so it says nothing about which one.
const MIN_MATCHED_LINE_LENGTH = 12
const SHORT_REASON_LENGTH = 40
const MAX_GOAL_LENGTH = 400
const TASK_PLAN_FILE_NAME = '00-plan.md'

type RecordedPiece = { label: string; heading: string; bodyLines: string[]; text: string }

type FoundPiece = {
  docPath: string
  piece: RecordedPiece
  previousPiece: RecordedPiece | undefined
  isFoundByItsCode: boolean
}

const runGitOrEmpty = (repoRoot: string, gitArguments: string[]): string => {
  try {
    return runGit(repoRoot, gitArguments)
  } catch {
    return ''
  }
}

const collapseWhitespace = (text: string): string => text.replace(/\s+/g, ' ').trim()

const listRecordedPieces = (docText: string): RecordedPiece[] =>
  docText.split(SECTION_START_PATTERN).flatMap((sectionText) => {
    const [heading = '', ...bodyLines] = sectionText.trimEnd().split('\n')
    const [, label] = PIECE_HEADING_PATTERN.exec(heading) ?? []
    return label === undefined ? [] : [{ label, heading, bodyLines, text: sectionText }]
  })

const isPieceTextEnd = (line: string): boolean =>
  line.trim() === '' || line.startsWith('```') || PIECE_FIELD_PATTERN.test(line)

// A field's text: the rest of its line and the lines under it, up to a blank line, a code fence or a field.
const readPieceField = (piece: RecordedPiece, labelStart: string): string => {
  const labelIndex = piece.bodyLines.findIndex(
    (line) => PIECE_FIELD_PATTERN.test(line) && line.startsWith(labelStart),
  )
  if (labelIndex === -1) {
    return ''
  }
  const endIndex = piece.bodyLines.findIndex(
    (line, lineIndex) => lineIndex > labelIndex && isPieceTextEnd(line),
  )
  const fieldText = piece.bodyLines
    .slice(labelIndex, endIndex === -1 ? undefined : endIndex)
    .join(' ')
  return collapseWhitespace(fieldText.slice(fieldText.indexOf(':') + 1))
}

// The paragraph under an old piece's heading, written before pieces had fields.
const readPieceParagraph = (piece: RecordedPiece): string => {
  const firstTextIndex = piece.bodyLines.findIndex((line) => line.trim() !== '')
  const firstTextLine = piece.bodyLines[firstTextIndex]
  if (firstTextLine === undefined || isPieceTextEnd(firstTextLine)) {
    return ''
  }
  const endIndex = piece.bodyLines.findIndex(
    (line, lineIndex) => lineIndex > firstTextIndex && isPieceTextEnd(line),
  )
  return collapseWhitespace(
    piece.bodyLines.slice(firstTextIndex, endIndex === -1 ? undefined : endIndex).join(' '),
  )
}

const readPieceReason = (piece: RecordedPiece): string =>
  readPieceField(piece, 'Why') || readPieceParagraph(piece)

// A piece's Where gives line ranges after the file's name, as the commit numbered them: `room.ts:40-60, 90`.
const WHERE_LINES_PATTERN = /^:(\d+(?:-\d+)?(?:, \d+(?:-\d+)?)*)/
// The distance of a piece whose Where names the file with no line.
const UNKNOWN_LINE_DISTANCE = Number.MAX_SAFE_INTEGER

const listWhereLineRanges = (whereText: string, fileName: string): LineRange[] =>
  whereText
    .split(fileName)
    .slice(1)
    .flatMap((textAfterName) => {
      const [, rangesText = ''] = WHERE_LINES_PATTERN.exec(textAfterName) ?? []
      return rangesText === ''
        ? []
        : rangesText.split(', ').map((rangeText) => {
            const [firstLine = 0, lastLine = firstLine] = rangeText.split('-').map(Number)
            return { firstLine, lastLine }
          })
    })

const lineDistance = (first: LineRange, second: LineRange): number =>
  doLineRangesMeet(first, second)
    ? 0
    : Math.min(
        Math.abs(first.firstLine - second.lastLine),
        Math.abs(second.firstLine - first.lastLine),
      )

// The lines a commit added around the lines traced: those git log -L shows, and the rest of the commit's
// hunks that meet them, since a piece often quotes the lines around the one asked about.
const listAddedLinesAround = (
  repoRoot: string,
  commit: LineCommit,
  fileAtCommit: string,
  tracedLines: LineRange | null,
): string[] => {
  const commitHunks =
    tracedLines === null
      ? []
      : hunksMeetingLines(
          runGitOrEmpty(repoRoot, ['show', '-U0', '--format=', commit.hash, '--', fileAtCommit]),
          tracedLines,
        )
  const addedLines = [commit.diffText, ...commitHunks]
    .flatMap((diffText) => diffText.split('\n'))
    .filter((diffLine) => diffLine.startsWith('+') && !diffLine.startsWith('+++'))
    .map((diffLine) => diffLine.slice(1).trim())
    .filter((addedLine) => addedLine.length >= MIN_MATCHED_LINE_LENGTH)
  return [...new Set(addedLines)]
}

// The piece recorded with a commit for these lines, among the pieces of the docs the commit holds: of those
// holding lines it added around them, one whose Where names the file (a mapping doc quotes code it didn't
// write) and the most lines; else, of those naming the file, the one whose Where lines are nearest. For a
// rule's entry, a piece names the rule when its text holds the id: pieces name ids, not ledger files.
const findRecordedPiece = (
  repoRoot: string,
  commit: LineCommit,
  file: string,
  docPaths: string[],
  ruleId: string | null,
): FoundPiece | null => {
  const fileAtCommit = /^\+\+\+ b\/(.+)$/m.exec(commit.diffText)?.[1] ?? file
  // A doc may name the file from its folder down: `teams/invites.ts` for `src/teams/invites.ts`.
  const fileNames = [fileAtCommit, fileAtCommit.slice(fileAtCommit.indexOf('/') + 1)]
  const tracedHunk = commit.diffText
    .split(HUNK_START_PATTERN)
    .map(parseDiffHunk)
    .find((hunk) => hunk !== null)
  const tracedLines =
    tracedHunk === undefined
      ? null
      : { firstLine: tracedHunk.newFirstLine, lastLine: lastNewLineOf(tracedHunk) }
  const addedLines = listAddedLinesAround(repoRoot, commit, fileAtCommit, tracedLines)
  const pieceDocPaths = runGitOrEmpty(repoRoot, [
    'grep',
    '-l',
    '-E',
    '^## (Piece|Bucata) ',
    commit.hash,
    '--',
    ...docPaths,
  ])
    .split('\n')
    .filter((grepLine) => grepLine !== '')
    .map((grepLine) => grepLine.slice(commit.hash.length + 1))
  const scoredPieces = pieceDocPaths.flatMap((docPath) => {
    const pieces = listRecordedPieces(
      runGitOrEmpty(repoRoot, ['show', `${commit.hash}:${docPath}`]),
    )
    return pieces.map((piece, pieceIndex) => {
      const whereText = readPieceField(piece, 'Where')
      const whereLineDistances = fileNames
        .flatMap((fileName) => listWhereLineRanges(whereText, fileName))
        .map((whereLines) =>
          tracedLines === null ? UNKNOWN_LINE_DISTANCE : lineDistance(whereLines, tracedLines),
        )
      return {
        docPath,
        piece,
        previousPiece: pieces[pieceIndex - 1],
        matchedLineCount: addedLines.filter((addedLine) => piece.text.includes(addedLine)).length,
        isNamingTheTarget:
          ruleId === null
            ? fileNames.some((fileName) => whereText.includes(fileName))
            : piece.text.includes(ruleId),
        whereLineDistance: Math.min(UNKNOWN_LINE_DISTANCE, ...whereLineDistances),
      }
    })
  })
  // By: holding the code, naming the file, the lines held, the nearest Where; a tie keeps the docs' order.
  const [bestPiece] = scoredPieces
    .filter((scoredPiece) => scoredPiece.matchedLineCount > 0 || scoredPiece.isNamingTheTarget)
    .sort(
      (first, second) =>
        Number(second.matchedLineCount > 0) - Number(first.matchedLineCount > 0) ||
        Number(second.isNamingTheTarget) - Number(first.isNamingTheTarget) ||
        second.matchedLineCount - first.matchedLineCount ||
        first.whereLineDistance - second.whereLineDistance,
    )
  return bestPiece === undefined
    ? null
    : { ...bestPiece, isFoundByItsCode: bestPiece.matchedLineCount > 0 }
}

// The first paragraph of the Goal of the task plan beside the first of these docs that has one, as of the commit.
const findTaskGoal = (
  repoRoot: string,
  commitHash: string,
  docPaths: string[],
): { planPath: string; goal: string } | null => {
  const planPaths = new Set(
    docPaths.map(
      (docPath) => `${docPath.slice(0, docPath.lastIndexOf('/') + 1)}${TASK_PLAN_FILE_NAME}`,
    ),
  )
  for (const planPath of planPaths) {
    const goalSection = runGitOrEmpty(repoRoot, ['show', `${commitHash}:${planPath}`])
      .split(SECTION_START_PATTERN)
      .find((sectionText) => sectionText.startsWith('## Goal'))
    const [firstParagraph = ''] = (goalSection ?? '')
      .split('\n')
      .slice(1)
      .join('\n')
      .trim()
      .split(/\n\s*\n/)
    const goal = collapseWhitespace(firstParagraph)
    if (goal !== '') {
      const isTooLong = goal.length > MAX_GOAL_LENGTH
      return { planPath, goal: isTooLong ? `${goal.slice(0, MAX_GOAL_LENGTH)}…` : goal }
    }
  }
  return null
}

const describePiece = (
  { docPath, piece, previousPiece, isFoundByItsCode }: FoundPiece,
  namedTarget: string,
): string[] => {
  const what = readPieceField(piece, 'What')
  const why = readPieceField(piece, 'Why')
  const paragraph = what === '' && why === '' ? readPieceParagraph(piece) : ''
  // The code that passes a test is its own piece, after the test's: its reason is first the red piece's.
  const isGreenPiece = /\bgreen\b/.test(piece.heading)
  const isReasonShort = (why || paragraph).length < SHORT_REASON_LENGTH
  const previousReason =
    (isGreenPiece || isReasonShort) && previousPiece !== undefined
      ? readPieceReason(previousPiece)
      : ''
  const foundByNote = isFoundByItsCode ? '' : `  (names ${namedTarget}; holds none of these lines)`
  return [
    docPath,
    `${piece.heading}${foundByNote}`,
    ...(what === '' ? [] : [`What: ${what}`]),
    ...(why === '' ? [] : [`Why: ${why}`]),
    ...(paragraph === '' ? [] : [paragraph]),
    ...(previousReason === '' ? [] : [`Why (${previousPiece?.label}): ${previousReason}`]),
  ]
}

// Under a commit: the piece recorded with it for these lines, and the goal of its task.
// The Markdown files a commit wrote outside logicmap/: where its pieces and its plan are.
const listCommitDocPaths = (repoRoot: string, commit: LineCommit): string[] =>
  runGitOrEmpty(repoRoot, ['show', '--name-only', '--diff-filter=d', '--format=', commit.hash])
    .split('\n')
    .filter((path) => path.endsWith('.md') && !path.startsWith(`${LEDGER_DIRECTORY}/`))

const describeCommitReason = (
  repoRoot: string,
  commit: LineCommit,
  file: string,
  ruleId: string | null,
): string[] => {
  const docPaths = listCommitDocPaths(repoRoot, commit)
  if (docPaths.length === 0) {
    return []
  }
  const foundPiece = findRecordedPiece(repoRoot, commit, file, docPaths, ruleId)
  const taskGoal = findTaskGoal(
    repoRoot,
    commit.hash,
    foundPiece === null ? docPaths : [foundPiece.docPath],
  )
  const namedTarget = ruleId === null ? 'the file' : 'the rule'
  const pieceLines = foundPiece === null ? [] : describePiece(foundPiece, namedTarget)
  const goalLines = taskGoal === null ? [] : [`Goal (${taskGoal.planPath}): ${taskGoal.goal}`]
  return [...pieceLines, ...goalLines].map((reasonLine) => `  ${reasonLine}`)
}

// A rule's why and the alternatives it rejected: what must hold now, and what not to bring back.
const describeWhyAndRejected = (entry: LedgerEntry | undefined): string[] => [
  ...(entry === undefined || entry.why === '' ? [] : [`  why: ${entry.why}`]),
  ...(entry === undefined || entry.rejected === '' ? [] : [`  rejected: ${entry.rejected}`]),
]

// The rules covering these lines as show <file> prints them, each with its why: what must hold now.
const listRulesWithTheirWhy = (repoRoot: string, file: string, lines: LineRange): string[] => {
  const views = createShowViews(repoRoot)
  if (!views.isAnchoredFile(file)) {
    return []
  }
  return views.listFileRuleSections(file, lines).flatMap((ruleSection) => {
    const [ruleLine = '', ...siteLines] = ruleSection.text.split('\n')
    const entry = views.analysis.entriesById.get(ruleSection.id)
    return [ruleLine, ...describeWhyAndRejected(entry), ...siteLines]
  })
}

// `src/room.ts:joinRoom`: the lines of the declaration of that name.
const FILE_NAME_TARGET_PATTERN = /^(.+):([A-Za-z_$][\w$]*)$/
// A line at the top level of a file as git's default funcname sees one: it starts with a letter, _ or $.
const TOP_LEVEL_LINE_PATTERN = /^[A-Za-z_$]/

// The lines of the top-level declaration naming this, in the file as it is now: from its line to the line before
// the next top-level line, as git log -L :<name>:<file> takes them, less the blank and comment lines at its end
// (the next declaration's comment and anchors).
const findDeclarationLines = (repoRoot: string, file: string, name: string): LineRange | null => {
  const filePath = join(repoRoot, file)
  if (!existsSync(filePath)) {
    return null
  }
  const fileLines = readFileSync(filePath, 'utf8').split('\n')
  const namePattern = new RegExp(`(?<![\\w$])${name.replaceAll('$', '\\$')}(?![\\w$])`)
  const declarationIndex = fileLines.findIndex(
    (line) => TOP_LEVEL_LINE_PATTERN.test(line) && namePattern.test(line),
  )
  if (declarationIndex === -1) {
    return null
  }
  const nextTopLevelIndex = fileLines.findIndex(
    (line, lineIndex) => lineIndex > declarationIndex && TOP_LEVEL_LINE_PATTERN.test(line),
  )
  const endIndex = nextTopLevelIndex === -1 ? fileLines.length : nextTopLevelIndex
  const lastCodeIndex = fileLines
    .slice(0, endIndex)
    .findLastIndex((line) => line.trim() !== '' && !COMMENT_LINE_PATTERN.test(line))
  return {
    firstLine: declarationIndex + 1,
    lastLine: Math.max(lastCodeIndex, declarationIndex) + 1,
  }
}

// A commit whose change among the traced lines is only blank lines: git log -L matched a blank line of the range
// to one the commit added, so it explains nothing about them.
const isBlankLinesOnlyCommit = (commit: LineCommit): boolean => {
  const diffLines = commit.diffText.split('\n')
  const firstHunkIndex = diffLines.findIndex((diffLine) => diffLine.startsWith('@@'))
  // The lines past the first hunk's header: the file's headers (`--- a/`, `+++ b/`) come before it.
  const changedLines = diffLines
    .slice(firstHunkIndex + 1)
    .filter((diffLine) => diffLine.startsWith('+') || diffLine.startsWith('-'))
  return (
    firstHunkIndex !== -1 && changedLines.every((changedLine) => changedLine.slice(1).trim() === '')
  )
}

// A first line saying how many commits changed the lines, then each with its reason; a single line when
// they aren't committed yet.
const describeLinesHistory = (
  repoRoot: string,
  file: string,
  lines: LineRange,
  linesLabel: string,
  ruleId: string | null,
): { summaryLines: string[]; commitLines: string[] } => {
  if (!isFileInHead(repoRoot, file)) {
    return {
      summaryLines: [`${linesLabel}: not committed yet (HEAD has no ${file})`],
      commitLines: [],
    }
  }
  const { headLines, uncommittedLines } = toHeadLines(repoRoot, file, lines)
  if (headLines === null) {
    return {
      summaryLines: [`${linesLabel}: not committed yet (added since HEAD)`],
      commitLines: [],
    }
  }
  const headLinesLabel = describeLineRange(headLines)
  const commits = listLineCommitsOrNull(repoRoot, file, headLines, null)
  if (commits === null) {
    const untracedLine = `${linesLabel}: git log -L can't trace HEAD's lines ${headLinesLabel} of ${file}`
    return { summaryLines: [untracedLine], commitLines: [] }
  }
  const isRenumbered = headLinesLabel !== describeLineRange(lines)
  const headLinesNote = isRenumbered ? ` (${headLinesLabel} in HEAD)` : ''
  const uncommittedNote =
    uncommittedLines.length === 0
      ? []
      : [`changed since HEAD, not committed yet: ${describeLineNumbers(uncommittedLines)}`]
  const explainingCommits = commits.filter((commit) => !isBlankLinesOnlyCommit(commit))
  const blankLinesOnlyCount = commits.length - explainingCommits.length
  const blankLinesOnlyNote =
    blankLinesOnlyCount === 0
      ? ''
      : `; ${blankLinesOnlyCount} more only added or removed blank lines`
  const shownCommits = explainingCommits.slice(0, MAX_COMMITS_SHOWN)
  const olderCommitCount = explainingCommits.length - shownCommits.length
  const olderCommitsNote =
    olderCommitCount === 0
      ? []
      : [
          `and ${countOf(olderCommitCount, 'older commit')}: git log -L${headLines.firstLine},${headLines.lastLine}:${file}`,
        ]
  return {
    summaryLines: [
      `${linesLabel}${headLinesNote}: ${countOf(explainingCommits.length, 'commit')}, newest first${blankLinesOnlyNote}`,
      ...uncommittedNote,
    ],
    commitLines: [
      ...shownCommits.flatMap((commit, commitIndex) => [
        ...(commitIndex === 0 ? [] : ['']),
        `${commit.date} ${commit.hash} ${commit.subject}`,
        ...describeCommitReason(repoRoot, commit, file, ruleId),
      ]),
      ...olderCommitsNote,
    ],
  }
}

// The commits read for the newest change: the newest ones may only have added blank lines.
const NEWEST_CHANGE_MAX_COMMITS = 5

export type NewestLinesChange = {
  lines: LineRange
  date: string
  hash: string
  subject: string
  piece: { docPath: string; label: string } | null
}

// For the Read hook: the newest commit that changed these lines of the working tree (the whole file when
// null), past the commits that only added or removed blank lines, and the piece recorded with it. Null when
// git holds no history of them.
export const findNewestLinesChange = (
  repoRoot: string,
  file: string,
  requestedLines: LineRange | null,
): NewestLinesChange | null => {
  const isHistoryReadable = isFileInHead(repoRoot, file) && existsSync(join(repoRoot, file))
  if (!isHistoryReadable) {
    return null
  }
  const fileText = readFileSync(join(repoRoot, file), 'utf8')
  const fileLineCount = fileText.split('\n').length - (fileText.endsWith('\n') ? 1 : 0)
  const lines = {
    firstLine: requestedLines?.firstLine ?? 1,
    lastLine: Math.min(requestedLines?.lastLine ?? fileLineCount, fileLineCount),
  }
  if (lines.firstLine > lines.lastLine) {
    return null
  }
  const { headLines } = toHeadLines(repoRoot, file, lines)
  const commits =
    headLines === null
      ? null
      : listLineCommitsOrNull(repoRoot, file, headLines, NEWEST_CHANGE_MAX_COMMITS)
  const newestCommit = commits?.find((commit) => !isBlankLinesOnlyCommit(commit))
  if (newestCommit === undefined) {
    return null
  }
  const docPaths = listCommitDocPaths(repoRoot, newestCommit)
  const foundPiece =
    docPaths.length === 0 ? null : findRecordedPiece(repoRoot, newestCommit, file, docPaths, null)
  return {
    lines,
    date: newestCommit.date,
    hash: newestCommit.hash,
    subject: newestCommit.subject,
    piece:
      foundPiece === null ? null : { docPath: foundPiece.docPath, label: foundPiece.piece.label },
  }
}

// The rules covering the lines, then every commit that changed them, newest first, each with the piece
// recorded with it and its task's goal.
const explainLines = (
  repoRoot: string,
  file: string,
  lines: LineRange,
  linesLabel: string,
): string => {
  const ruleLines = listRulesWithTheirWhy(repoRoot, file, lines)
  const rulesSection =
    ruleLines.length === 0
      ? []
      : ['', 'rules covering these lines (show <id>: one in full):', ...ruleLines]
  const { summaryLines, commitLines } = describeLinesHistory(
    repoRoot,
    file,
    lines,
    linesLabel,
    null,
  )
  const commitSection = commitLines.length === 0 ? [] : ['', ...commitLines]
  return [...summaryLines, ...rulesSection, ...commitSection].join('\n')
}

// A rule's entry with its why and its history: lines, then every commit that changed the entry, each with the
// piece naming the rule.
const explainRule = (repoRoot: string, entry: LedgerEntry): string => {
  const entryLines = entry.text.split('\n')
  const historyIndex = entryLines.findIndex((entryLine) => entryLine.startsWith('history:'))
  // The history runs from its own line to the next field, as readEntryFields reads a field.
  const nextFieldOffset = entryLines
    .slice(historyIndex + 1)
    .findIndex((entryLine) => ENTRY_FIELD_PATTERN.test(entryLine))
  const historyEndIndex =
    nextFieldOffset === -1 ? entryLines.length : historyIndex + 1 + nextFieldOffset
  const historyLines =
    historyIndex === -1
      ? []
      : entryLines
          .slice(historyIndex, historyEndIndex)
          .filter((entryLine) => entryLine.trim() !== '')
  const ruleLine = `${entry.id}@${entry.version ?? '?'}  ${entry.kind ?? '?'}  ${entry.provenance}  ${entry.claim}`
  const lines = { firstLine: entry.line, lastLine: entry.line + entryLines.length - 1 }
  const linesLabel = `${entry.file}:${describeLineRange(lines)} (the entry)`
  const { summaryLines, commitLines } = describeLinesHistory(
    repoRoot,
    entry.file,
    lines,
    linesLabel,
    entry.id,
  )
  return [
    ruleLine,
    ...describeWhyAndRejected(entry),
    ...historyLines.map((historyLine) => `  ${historyLine}`),
    '',
    ...summaryLines,
    ...(commitLines.length === 0 ? [] : ['', ...commitLines]),
  ].join('\n')
}

// Why some lines, a declaration or a rule are as they are.
export const whyLogicMap = (repoRoot: string, target: string): string => {
  const [, fileOfLines, firstLineText, lastLineText] = FILE_LINES_TARGET_PATTERN.exec(target) ?? []
  if (fileOfLines !== undefined) {
    const firstLine = Number(firstLineText)
    const lines = {
      firstLine,
      lastLine: lastLineText === undefined ? firstLine : Number(lastLineText),
    }
    return explainLines(repoRoot, fileOfLines, lines, `${fileOfLines}:${describeLineRange(lines)}`)
  }
  const [, fileOfName, declarationName] = FILE_NAME_TARGET_PATTERN.exec(target) ?? []
  if (fileOfName !== undefined && declarationName !== undefined) {
    const declarationLines = findDeclarationLines(repoRoot, fileOfName, declarationName)
    if (declarationLines === null) {
      return `no line at the top level of ${fileOfName} names ${declarationName}`
    }
    const declarationLabel = `${fileOfName}:${declarationName} (${describeLineRange(declarationLines)})`
    return explainLines(repoRoot, fileOfName, declarationLines, declarationLabel)
  }
  const entry = createShowViews(repoRoot).analysis.entriesById.get(target)
  return entry === undefined
    ? `${target} is neither a rule of ${LEDGER_DIRECTORY}/ nor <file>:<line>[-<line>] or <file>:<name>`
    : explainRule(repoRoot, entry)
}

// ---------- Command line ----------

const USAGE = [
  'usage: bun logicmap.ts check              every problem, one per line; exit 1 on any error',
  "       bun logicmap.ts ack <id>...         record these ids' code and entries as verified",
  '       bun logicmap.ts show [<domain> | <id> | <file>[:<line>[-<line>]]]',
  "                                           every domain; a domain's rules; one rule and its sites; a file's rules",
  "       bun logicmap.ts diff <id>           what changed under the id's sites since their last ack",
  '       bun logicmap.ts why <file>:<line>[-<line>] | <file>:<name> | <id>',
  '                                           the rules over these lines, every commit that changed them, newest',
  "                                           first, and the piece and the goal recorded with each; a rule's history",
].join('\n')

const findRepoRoot = (): string =>
  execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()

// A path typed from any directory becomes the repo-relative path anchors are recorded under.
const toShowTarget = (repoRoot: string, typedTarget: string): string => {
  const [, typedFile = typedTarget, lineSuffix = ''] =
    /^(.+?)(:\d+(?:-\d+)?|:[A-Za-z_$][\w$]*)?$/.exec(typedTarget) ?? []
  const typedPath = resolve(process.cwd(), typedFile)
  return existsSync(typedPath)
    ? `${relative(repoRoot, typedPath).split(sep).join('/')}${lineSuffix}`
    : typedTarget
}

export const formatProblem = (problem: Problem): string =>
  `${problem.file}:${problem.line}: ${problem.severity} ${problem.code}: ${problem.message}`

const printProblem = (problem: Problem): void => {
  console.log(formatProblem(problem))
}

const runCommandLine = (commandLineArguments: string[]): number => {
  const [command, ...commandArguments] = commandLineArguments
  const repoRoot = findRepoRoot()
  if (command === 'check') {
    const problems = checkRepo(repoRoot)
    problems.forEach(printProblem)
    const errorCount = problems.filter(
      (problem) => problem.severity === PROBLEM_SEVERITIES.error,
    ).length
    console.log(`logicmap: errors ${errorCount}, warnings ${problems.length - errorCount}`)
    return errorCount > 0 ? 1 : 0
  }
  if (command === 'ack' && commandArguments.length > 0) {
    const { ackedIds, blockingProblems } = ackIds(repoRoot, commandArguments)
    blockingProblems.forEach(printProblem)
    if (blockingProblems.length > 0) {
      console.log('logicmap: nothing acked; fix the errors above first')
      return 1
    }
    console.log(`logicmap: acked ${ackedIds.join(', ')}`)
    return 0
  }
  if (command === 'diff' && commandArguments.length === 1) {
    console.log(diffLogicMap(repoRoot, commandArguments[0] ?? ''))
    return 0
  }
  if (command === 'why' && commandArguments.length === 1) {
    console.log(whyLogicMap(repoRoot, toShowTarget(repoRoot, commandArguments[0] ?? '')))
    return 0
  }
  if (command === 'show') {
    const [typedTarget] = commandArguments
    const target = typedTarget === undefined ? undefined : toShowTarget(repoRoot, typedTarget)
    console.log(showLogicMap(repoRoot, target))
    return 0
  }
  console.log(USAGE)
  return 1
}

if (import.meta.main) {
  process.exit(runCommandLine(process.argv.slice(2)))
}
