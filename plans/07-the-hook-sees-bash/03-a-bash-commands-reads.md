# Step 3: A Bash command's reads show their rules

Before: `bun test` 55 pass.

## Piece 1: the failing test
What: one test in `describe('hook')`: `sed -n 2,5p src/room.ts` is answered as a Read of lines 2 to 5 is; the rule,
shown once, is named by id for a single line, a pipe after the `sed`, a `cat` after another command, a `cd` before
the `sed`, a session standing in `src/`; a command that moves into the repo from elsewhere is answered for what it
reads and for what it changed there; lines no rule covers, a range written with a variable, a file that isn't there
and a `grep` say nothing.
Why: plan, decision 3: 12,261 of 13,586 Bash reads have the first form, and the file is written from where the
command stands.
Where: `scripts/logicmap.test.ts`, at the end of `describe('hook')`
```ts
  test('after a Bash command that prints lines with sed or cat, the rules covering them, from where the command stands', () => {
    const repoRoot = createMappedRepo()
    const plainRepoRoot = createFixtureRepo({ 'src/plain.ts': 'export const plain = 1\n' })
    const sessionId = `reading-${crypto.randomUUID()}`
    const contextOfCommand = (command: string, cwd = repoRoot, commandSessionId = sessionId) => {
      const hookOutput = respondToHook({
        hook_event_name: 'PostToolUse',
        session_id: commandSessionId,
        cwd,
        tool_name: 'Bash',
        tool_input: { command },
        duration_ms: 12,
      })
      return hookOutput !== null && 'hookSpecificOutput' in hookOutput
        ? hookOutput.hookSpecificOutput.additionalContext
        : null
    }
    const fullRuleText = [
      'logicmap: the rules covering src/room.ts (logicmap show <id> for the full entry):',
      'sync.close-during-join@1  edge  recorded  The socket can close while the join is loading.',
      '  2-5  §edge  ok',
    ].join('\n')
    const namedRuleText =
      'logicmap: these lines of src/room.ts are covered too by rules shown earlier this session: sync.close-during-join@1'

    expect(contextOfCommand('sed -n 2,5p src/room.ts')).toBe(fullRuleText)
    expect(contextOfCommand("sed -n '4p' src/room.ts | cut -c1-80")).toBe(namedRuleText)
    expect(contextOfCommand('git status --short && cat src/room.ts')).toBe(namedRuleText)
    expect(contextOfCommand('cd src && sed -n "1,3p" room.ts; echo done')).toBe(namedRuleText)
    expect(contextOfCommand('sed -n 1,3p room.ts', join(repoRoot, 'src'))).toBe(namedRuleText)

    expect(contextOfCommand('sed -n 6,7p src/room.ts')).toBeNull()
    expect(contextOfCommand('sed -n "$first,$((first + 3))p" src/room.ts')).toBeNull()
    expect(contextOfCommand('sed -n 1,3p src/gone.ts')).toBeNull()
    expect(contextOfCommand('grep -n closedEarly src/room.ts')).toBeNull()

    const elsewhereSessionId = `elsewhere-${crypto.randomUUID()}`
    expect(
      contextOfCommand(`cd ${repoRoot} && sed -n 2,5p src/room.ts`, plainRepoRoot, elsewhereSessionId),
    ).toBe(fullRuleText)
    writeFixtureFiles(repoRoot, {
      'src/room.ts': readFixtureFile(repoRoot, 'src/room.ts').replace(
        'removeConnection(connection)',
        'removeConnection(connection, true)',
      ),
    })
    expect(
      contextOfCommand(`cd ${repoRoot} && python3 rewrite-room.py`, plainRepoRoot, elsewhereSessionId),
    ).toContain('src/room.ts:2: error changed')
  })
```
Run (red): `bun test -t "prints lines with sed or cat"`: 0 pass, 1 fail; the first `sed` expected the rule's three
lines, received `null`.

## Piece 2: where a command stands and what it prints
What: `walkCommand(command, cwd)`: the command cut at `&&`, `||`, `;`, `|` and new lines; a `cd <directory>` moves
the directory the next segments stand in; a `sed -n <first>,<last>p <file>` or `sed -n <line>p <file>` is a read
of those lines and a `cat <file>...` a read of each whole file. It returns the directories stood in, in order, and
the reads with their paths made absolute.
Why: plan, decision 3. The cut is naive on purpose: a separator inside quotes (`grep -n "a\|b"`) only yields
segments that are no `cd`, `sed` or `cat`, and a heredoc's lines are read as segments, where a line that is exactly
a `cat <file>` of a real file would name that file's rules, which costs a few lines. A path with a variable does
not exist as written and is dropped by the caller. `~/` is where the skill itself is reached from.
Where: `scripts/hook.ts`, before `respondToBash`
```ts
const COMMAND_SEPARATOR_PATTERN = /&&|\|\||[;|\n]/
const QUOTED_WORD_PATTERN = /^(['"])(.*)\1$/
// The lines sed -n prints: `40,60p`, or `40p` for one line.
const SED_PRINTED_LINES_PATTERN = /^(\d+)(?:,(\d+))?p$/
const HOME_PATH_START = '~/'

type CommandRead = { filePath: string; readLines: LineRange | null }

const toAbsolutePath = (directory: string, typedPath: string): string =>
  typedPath.startsWith(HOME_PATH_START)
    ? join(homedir(), typedPath.slice(HOME_PATH_START.length))
    : resolve(directory, typedPath)

// The directories a command stands in, the session's first and then each `cd` target, and the files it prints with
// `sed -n` or `cat`, each from the directory it stands in at that point.
const walkCommand = (
  command: string,
  cwd: string,
): { directories: string[]; reads: CommandRead[] } => {
  const directories = [cwd]
  const reads: CommandRead[] = []
  for (const segment of command.split(COMMAND_SEPARATOR_PATTERN)) {
    const [program, ...programArguments] = segment
      .trim()
      .split(/\s+/)
      .map((shellWord) => shellWord.replace(QUOTED_WORD_PATTERN, '$2'))
    const currentDirectory = directories.at(-1) ?? cwd
    const [firstArgument = '', secondArgument = '', thirdArgument = ''] = programArguments
    const [, firstLineText, lastLineText = firstLineText] =
      SED_PRINTED_LINES_PATTERN.exec(secondArgument) ?? []
    const isDirectoryChange = program === 'cd' && programArguments.length === 1
    const isSedOfLines =
      program === 'sed' &&
      firstArgument === '-n' &&
      firstLineText !== undefined &&
      programArguments.length === 3
    const isCatOfFiles =
      program === 'cat' &&
      programArguments.length > 0 &&
      programArguments.every((programArgument) => !programArgument.startsWith('-'))
    if (isDirectoryChange) {
      directories.push(toAbsolutePath(currentDirectory, firstArgument))
    }
    if (isSedOfLines) {
      reads.push({
        filePath: toAbsolutePath(currentDirectory, thirdArgument),
        readLines: { firstLine: Number(firstLineText), lastLine: Number(lastLineText) },
      })
    }
    if (isCatOfFiles) {
      reads.push(
        ...programArguments.map((typedPath) => ({
          filePath: toAbsolutePath(currentDirectory, typedPath),
          readLines: null,
        })),
      )
    }
  }
  return { directories, reads }
}
```

## Piece 3: the reads answered, and the edits of every repo the command stood in
What: `respondToBash` takes the command. Each read of a file that exists inside a mapped repo is described as a Read
is; the changed files are looked for in each mapped repo the command stood in, not only the session's. One map
reader per repo, created the first time something in it is described. The answer is the reads' lines, then the
edits', under the same cap.
Why: plan, decisions 3 and 4. A command that starts with `cd <a worktree>` reads and changes files there; a
command that reads nothing and changes nothing still analyses nothing.
Where: `scripts/hook.ts`, `respondToBash` and its call in `respondToHook`
```ts
// Each repo is analysed once per hook run, and only when something in it was read or changed.
const createMapReaderCache = (): ((repoRoot: string) => MapReader) => {
  const mapReaderByRepoRoot = new Map<string, MapReader>()
  return (repoRoot) => {
    const mapReader = mapReaderByRepoRoot.get(repoRoot) ?? createMapReader(repoRoot)
    mapReaderByRepoRoot.set(repoRoot, mapReader)
    return mapReader
  }
}

const isExistingFile = (filePath: string): boolean =>
  statSync(filePath, { throwIfNoEntry: false })?.isFile() === true

const respondToBash = (
  hookEventName: ToolHookEventName,
  command: string,
  cwd: string,
  durationMs: number | undefined,
  sessionId: string | null,
): HookOutput | null => {
  const { directories, reads } = walkCommand(command, cwd)
  const mapReaderOf = createMapReaderCache()
  const readContextLines = reads
    .filter(({ filePath }) => isExistingFile(filePath))
    .flatMap(({ filePath, readLines }) => {
      const repoRoot = findMappedRepoRoot(dirname(filePath))
      return repoRoot === null
        ? []
        : describeRead(
            mapReaderOf(repoRoot),
            repoRoot,
            toRepoPath(repoRoot, filePath),
            readLines,
            sessionId,
          )
    })
  const mappedRepoRoots = new Set(
    [...new Set(directories)].flatMap((directory) => findMappedRepoRoot(directory) ?? []),
  )
  const editContextLines = [...mappedRepoRoots].flatMap((repoRoot) => {
    const changedFiles = listFilesChangedByCommand(repoRoot, durationMs, sessionId)
    if (changedFiles.length === 0) {
      return []
    }
    if (sessionId !== null) {
      recordEditedRepo(sessionId, repoRoot)
      recordInspectedEdits(sessionId, repoRoot, changedFiles)
    }
    return changedFiles.flatMap(({ file }) =>
      describeEdit(mapReaderOf(repoRoot), repoRoot, file, sessionId),
    )
  })
  const contextLines = [...readContextLines, ...editContextLines].flatMap((contextText) =>
    contextText.split('\n'),
  )
  const isOverMaxLines = contextLines.length > BASH_CONTEXT_MAX_LINES
  return addContext(
    hookEventName,
    isOverMaxLines
      ? [
          ...contextLines.slice(0, BASH_CONTEXT_MAX_LINES),
          `logicmap: ... and ${contextLines.length - BASH_CONTEXT_MAX_LINES} more lines: logicmap check lists every error, logicmap show <file> a file's rules.`,
        ]
      : contextLines,
  )
}
```
Run (green): `bun test`: 56 pass, 0 fail. Beyond the code shown: `homedir` and `resolve` join the imports;
`respondToHook` passes `tool_input.command` when it is a string, else an empty command.
