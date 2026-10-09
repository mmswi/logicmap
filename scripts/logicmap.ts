import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
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
  steps: FlowStep[]
  text: string
}

const LEDGER_DIRECTORY = 'logicmap'
const LOCK_FILE = `${LEDGER_DIRECTORY}/lock`
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
      steps,
      text,
    },
    problems,
  }
}

const readLedger = (
  repoRoot: string,
): { entriesById: Map<string, LedgerEntry>; problems: Problem[] } => {
  const entriesById = new Map<string, LedgerEntry>()
  const problems: Problem[] = []
  const ledgerPath = join(repoRoot, LEDGER_DIRECTORY)
  if (!existsSync(ledgerPath)) {
    return { entriesById, problems }
  }
  const ledgerFileNames = readdirSync(ledgerPath)
    .filter((fileName) => fileName.endsWith('.md'))
    .sort()
  for (const ledgerFileName of ledgerFileNames) {
    const file = `${LEDGER_DIRECTORY}/${ledgerFileName}`
    const fileText = readFileSync(join(ledgerPath, ledgerFileName), 'utf8')
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
  return { entriesById, problems }
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
  if (isProvableKind && !hasTestAnchor) {
    const message = `${entry.id} is an ${entry.kind} no test proves: put §test ${entry.id}@${entry.version} above the test that does, or write one`
    problems.push(warningAt(PROBLEM_CODES.untested, entry, entry.id, message))
  }
  return problems
}

// ---------- Lock: each site's fingerprint as it was at its last ack ----------

// A place an agent verifies: the code under an anchor, or an entry's text. The key names the place,
// the version and fingerprint record what was verified there.
type LockSite = {
  key: string
  id: string
  version: number
  fingerprint: string
  file: string
  line: number
  label: string
}

type LockedSite = { version: number; fingerprint: string; line: number }

const ANCHOR_PATTERN_GLOBAL = new RegExp(ANCHOR_SOURCE, 'g')

// Whitespace and anchors are left out, so reformatting a block or moving another pin changes nothing.
const fingerprintLines = (lines: string[]): string => {
  const normalizedText = lines
    .map((line) => line.replace(ANCHOR_PATTERN_GLOBAL, '').replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n')
  return createHash('sha256').update(normalizedText).digest('hex').slice(0, 12)
}

const COMMENT_LINE_PATTERN = /^\s*(\/\/|\/\*|\*|#|--|<!--)/
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
const findAnchoredLines = (fileLines: string[], anchorLineIndex: number): string[] => {
  const anchorLine = fileLines[anchorLineIndex] ?? ''
  const isCommentOnlyAnchorLine = COMMENT_LINE_PATTERN.test(anchorLine)
  const headLineIndex = isCommentOnlyAnchorLine
    ? fileLines.findIndex(
        (line, lineIndex) =>
          lineIndex > anchorLineIndex && !isBlankLine(line) && !COMMENT_LINE_PATTERN.test(line),
      )
    : anchorLineIndex
  if (headLineIndex === -1) {
    return []
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
  return fileLines.slice(headLineIndex, lastLineIndex + 1)
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
    lockSites.push({
      key: `${place}#${occurrence}`,
      id: anchor.id,
      version: anchor.version,
      fingerprint: fingerprintLines(findAnchoredLines(fileLines, anchor.line - 1)),
      file: anchor.file,
      line: anchor.line,
      label: `the code under ${describeAnchor(anchor)}`,
    })
  }
  for (const entry of entriesById.values()) {
    lockSites.push({
      key: `${entry.id} entry ${entry.file}#1`,
      id: entry.id,
      version: entry.version ?? 0,
      fingerprint: fingerprintLines(entry.text.split('\n')),
      file: entry.file,
      line: entry.line,
      label: `the entry ${entry.id}`,
    })
  }
  return lockSites
}

const idOfLockKey = (key: string): string => key.split(' ')[0] ?? key

// A lock line is "<key> <version> <fingerprint>"; the key may hold spaces (a path), so parse from the end.
const readLock = (repoRoot: string): Map<string, LockedSite> => {
  const lockedSitesByKey = new Map<string, LockedSite>()
  const lockPath = join(repoRoot, LOCK_FILE)
  if (!existsSync(lockPath)) {
    return lockedSitesByKey
  }
  for (const [lineIndex, lockLine] of readFileSync(lockPath, 'utf8').split('\n').entries()) {
    const isRecordLine = lockLine !== '' && !lockLine.startsWith('#')
    if (!isRecordLine) {
      continue
    }
    const lockLineParts = lockLine.split(' ')
    const fingerprint = lockLineParts.pop() ?? ''
    const version = Number(lockLineParts.pop())
    lockedSitesByKey.set(lockLineParts.join(' '), { version, fingerprint, line: lineIndex + 1 })
  }
  return lockedSitesByKey
}

const checkLock = (lockSites: LockSite[], lockedSitesByKey: Map<string, LockedSite>): Problem[] => {
  const problems: Problem[] = []
  for (const lockSite of lockSites) {
    const lockedSite = lockedSitesByKey.get(lockSite.key)
    if (lockedSite === undefined) {
      const message = `${lockSite.label} is not in the lock (new, or moved): verify it, then ack ${lockSite.id}`
      problems.push(errorAt(PROBLEM_CODES.unacked, lockSite, lockSite.id, message))
      continue
    }
    const isChanged =
      lockedSite.version !== lockSite.version || lockedSite.fingerprint !== lockSite.fingerprint
    if (isChanged) {
      const message = `${lockSite.label} changed since the last ack: re-read the entry ${lockSite.id}; it still holds → ack ${lockSite.id}; its meaning changed → bump its version`
      problems.push(errorAt(PROBLEM_CODES.changed, lockSite, lockSite.id, message))
    }
  }
  const currentKeys = new Set(lockSites.map((lockSite) => lockSite.key))
  for (const [key, lockedSite] of lockedSitesByKey) {
    if (!currentKeys.has(key)) {
      const id = idOfLockKey(key)
      const message = `${key} is gone since the last ack: ack ${id} to drop it`
      problems.push(
        errorAt(PROBLEM_CODES.gone, { file: LOCK_FILE, line: lockedSite.line }, id, message),
      )
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
  lockSites: LockSite[]
  problems: Problem[]
}

const analyzeRepo = (repoRoot: string): RepoAnalysis => {
  const { anchors, problems } = scanAnchors(repoRoot)
  const { entriesById, problems: ledgerProblems } = readLedger(repoRoot)
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
  return { anchors, entriesById, lockSites, problems }
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
        errorAt(PROBLEM_CODES.unknownId, { file: LOCK_FILE, line: 0 }, id, message),
      )
    }
  }
  if (blockingProblems.length > 0) {
    return { ackedIds: [], blockingProblems: blockingProblems.sort(byFileThenLine) }
  }

  const keptLockLines = [...lockedSitesByKey]
    .filter(([key]) => !requestedIds.has(idOfLockKey(key)))
    .map(([key, lockedSite]) => `${key} ${lockedSite.version} ${lockedSite.fingerprint}`)
  const ackedLockLines = lockSites
    .filter((lockSite) => requestedIds.has(lockSite.id))
    .map((lockSite) => `${lockSite.key} ${lockSite.version} ${lockSite.fingerprint}`)
  const lockLines = [...keptLockLines, ...ackedLockLines].sort()
  writeFileSync(join(repoRoot, LOCK_FILE), `${[LOCK_HEADER, ...lockLines].join('\n')}\n`)
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

// The text an agent reads: no target → every entry; an id → its entry and sites; a file → its anchors.
export const showLogicMap = (repoRoot: string, target: string | undefined): string => {
  const analysis = analyzeRepo(repoRoot)
  const problems = findAllProblems(repoRoot, analysis)

  const describeSite = (anchor: Anchor): string => {
    const siteProblems = problems.filter(
      (problem) =>
        problem.id === anchor.id && problem.file === anchor.file && problem.line === anchor.line,
    )
    return `${anchor.file}:${anchor.line}  ${describeAnchor(anchor)}  ${statusOf(siteProblems)}`
  }

  const showEveryEntry = (): string => {
    const entries = [...analysis.entriesById.values()].sort((first, second) =>
      first.id.localeCompare(second.id),
    )
    if (entries.length === 0) {
      return `no entries in ${LEDGER_DIRECTORY}/ yet`
    }
    const entryLines = entries.map((entry) => {
      const siteCount = analysis.anchors.filter((anchor) => anchor.id === entry.id).length
      const entryProblems = problems.filter((problem) => problem.id === entry.id)
      const status =
        entry.status === ENTRY_STATUSES.retired ? ENTRY_STATUSES.retired : statusOf(entryProblems)
      return `${entry.id}@${entry.version ?? '?'}  ${entry.kind ?? '?'}  ${status}  ${entry.provenance}  ${entry.what}  (sites: ${siteCount})`
    })
    return entryLines.join('\n')
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

  const showOneFile = (file: string): string => {
    const anchorLines = analysis.anchors
      .filter((anchor) => anchor.file === file)
      .map((anchor) => {
        const entry = analysis.entriesById.get(anchor.id)
        const entryDescription =
          entry === undefined ? '(no entry)' : `${entry.provenance}  ${entry.what}`
        return `${describeSite(anchor)}  ${entryDescription}`
      })
    return anchorLines.join('\n')
  }

  if (target === undefined) {
    return showEveryEntry()
  }
  const isAnchoredFile = analysis.anchors.some((anchor) => anchor.file === target)
  if (isAnchoredFile) {
    return showOneFile(target)
  }
  const isKnownId =
    analysis.entriesById.has(target) || analysis.anchors.some((anchor) => anchor.id === target)
  if (isKnownId) {
    return showOneId(target)
  }
  return `nothing named "${target}": not an id in ${LEDGER_DIRECTORY}/, not a file with anchors`
}

// ---------- Command line ----------

const USAGE = [
  'usage: bun logicmap.ts check              every problem, one per line; exit 1 on any error',
  "       bun logicmap.ts ack <id>...         record these ids' code and entries as verified",
  "       bun logicmap.ts show [<id> | <file>] every entry; one id with its sites; one file's anchors",
].join('\n')

const findRepoRoot = (): string =>
  execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()

// A path typed from any directory becomes the repo-relative path anchors are recorded under.
const toShowTarget = (repoRoot: string, typedTarget: string): string => {
  const typedPath = resolve(process.cwd(), typedTarget)
  return existsSync(typedPath) ? relative(repoRoot, typedPath).split(sep).join('/') : typedTarget
}

const printProblem = (problem: Problem): void => {
  console.log(
    `${problem.file}:${problem.line}: ${problem.severity} ${problem.code}: ${problem.message}`,
  )
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
