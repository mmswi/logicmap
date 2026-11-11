# Step 10: the command read as the shell reads it

## Piece 1: red, what only looks like a read, and what is one
What: a test in `describe('hook')`, each command in a session of its own: a `cat <file>` inside a heredoc's body and one inside a quoted commit message are no read; a `cd` inside a heredoc's body moves nothing, so the `sed` after it reads `src/room.ts`; `cat -n <file>` and `sed -n '2,$p' <file>` are reads; with `cwd` at `src`, `cd src && sed -n 1,3p room.ts` reads `src/room.ts`.
Why: the command was cut at every `;`, `|`, `&&`, `||` and line break, inside quotes and heredocs too, so text that only names a file counted as printing it, and a `cd` in a heredoc moved the reads after it (data reviewer). `cat -n` was refused for its flag (the trial of the shorter skill), though no flag of `cat` limits the lines it prints. And seen in this session: the input's `cwd` is the directory where the command ended. From the repo root, `cd src/sync && sed -n 302,303p ws-routes.ts` got no answer, the same read after an absolute `cd` did, and a file the same relative `cd` wrote was recorded, so the hook ran and replayed `cd src/sync` from `src/sync`.
Where: scripts/logicmap.test.ts, before the compaction test
```ts
  test('a Bash command is read as the shell reads it: heredocs and quotes, cat flags, sed to the last line, the cwd where it ended', () => {
    const repoRoot = createMappedRepo()
    const contextOfCommand = (command: string, cwd = repoRoot): string | null => {
      const hookOutput = respondToHook({
        hook_event_name: 'PostToolUse',
        session_id: `shell-${crypto.randomUUID()}`,
        cwd,
        tool_name: 'Bash',
        tool_input: { command },
        duration_ms: 12,
      })
      return hookOutput !== null && 'hookSpecificOutput' in hookOutput
        ? hookOutput.hookSpecificOutput.additionalContext
        : null
    }
    const ruleText = 'sync.close-during-join@1  edge  recorded  The socket can close'

    expect(contextOfCommand("cat > notes.md <<'EOF'\nsee:\ncat src/room.ts\nEOF")).toBeNull()
    expect(contextOfCommand('git commit -m "wip: drop the extra; cat src/room.ts && more"')).toBeNull()
    expect(contextOfCommand("cat > notes.md <<'EOF'\ncd src\nEOF\nsed -n 2,5p src/room.ts")).toContain(
      ruleText,
    )
    expect(contextOfCommand('cat -n src/room.ts')).toContain(ruleText)
    expect(contextOfCommand("sed -n '2,$p' src/room.ts")).toContain(ruleText)
    expect(contextOfCommand('cd src && sed -n 1,3p room.ts', join(repoRoot, 'src'))).toContain(
      ruleText,
    )
  })
```
Run, red: the first assertion, a `cat src/room.ts` inside a heredoc's body, was answered with the rule of `src/room.ts`.

## Piece 2: green, heredocs dropped, quotes kept whole, cat's flags, `$`, the cwd where the command ended
What: `walkCommand` drops each heredoc's body before it cuts the command, and cuts it with a pattern that keeps quoted text whole. `cat` takes flags, its files being the arguments that are not flags. `$` as sed's last line reads to the end of the file. A read's file is looked for from the directory replayed up to it, then from the input's `cwd`. The positional names of the arguments (`firstArgument`, `secondArgument`, `thirdArgument`, blast-radius reviewer) become the names of what each program holds there: `directoryChangeTarget`, `sedQuietFlag`, `sedPrintedLinesText`, `sedPrintedFile`, `catPrintedFiles`. `isExistingFile` moves above `walkCommand`, which now uses it.
Why: a heredoc's body and a quoted string are text the shell hands to a program, never commands, so a `cat` or a `cd` there runs nothing. The heredoc pattern keeps the opening line, so `cat > notes.md <<'EOF'` is still seen as a `cat` that writes. A single `&` (a command left in the background) is a separator too. The `cwd` fallback answers the reads after the command's last relative `cd`, the form seen in this session; a read before such a `cd`, of a path that exists only from where the command started, is still missed, since that directory is not in the input. Rejected: a shell parser dependency (one more install for the hook, for the three forms that occur).
Where: scripts/hook.ts, from `HEREDOC_BODY_PATTERN` to the end of `walkCommand`, in place of `COMMAND_SEPARATOR_PATTERN` through the old `walkCommand`
```ts
// A heredoc's opening line, kept, and its body through the line holding its word, dropped: its text runs nothing.
const HEREDOC_BODY_PATTERN = /(<<-?[ \t]*(['"]?)(\w+)\2[^\n]*)\n[\s\S]*?\n[ \t]*\3[ \t]*(?=\n|$)/g
// One command between the shell's separators (`;`, `&`, `|`, a line break), quoted text never cut.
const COMMAND_SEGMENT_PATTERN = /(?:'[^']*'|"(?:\\.|[^"\\])*"|[^;&|\n'"])+/g
const QUOTED_WORD_PATTERN = /^(['"])(.*)\1$/
// The lines sed -n prints: `40,60p`, `40p` for one line, `40,$p` to the last.
const SED_PRINTED_LINES_PATTERN = /^(\d+)(?:,(\d+|\$))?p$/
const SED_LAST_LINE = '$'
const HOME_PATH_START = '~/'
// `2>/dev/null`, `2>&1`: where a command's errors go changes nothing of what it prints.
const ERRORS_REDIRECT_PATTERN = /^2>/
const REDIRECT_PATTERN = /[<>]/

type CommandRead = { filePath: string; readLines: LineRange | null }

const toAbsolutePath = (directory: string, typedPath: string): string =>
  typedPath.startsWith(HOME_PATH_START)
    ? join(homedir(), typedPath.slice(HOME_PATH_START.length))
    : resolve(directory, typedPath)

const isExistingFile = (filePath: string): boolean =>
  statSync(filePath, { throwIfNoEntry: false })?.isFile() === true

// The directories a command stands in, the input's cwd and then each `cd` target, and the files it prints with
// `sed -n` or `cat`. Claude Code gives the cwd the command ended in, so a file is looked for from the directory
// replayed up to its read, then from that cwd: `cd src && sed -n 1,3p room.ts` ended in src.
const walkCommand = (
  command: string,
  cwd: string,
): { directories: string[]; reads: CommandRead[] } => {
  const directories = [cwd]
  const reads: CommandRead[] = []
  const toReadPath = (currentDirectory: string, typedPath: string): string => {
    const replayedPath = toAbsolutePath(currentDirectory, typedPath)
    return isExistingFile(replayedPath) ? replayedPath : toAbsolutePath(cwd, typedPath)
  }
  const segments = command.replace(HEREDOC_BODY_PATTERN, '$1').match(COMMAND_SEGMENT_PATTERN) ?? []
  for (const segment of segments) {
    const [program, ...typedArguments] = segment
      .trim()
      .split(/\s+/)
      .map((shellWord) => shellWord.replace(QUOTED_WORD_PATTERN, '$2'))
    const programArguments = typedArguments.filter(
      (typedArgument) => !ERRORS_REDIRECT_PATTERN.test(typedArgument),
    )
    const currentDirectory = directories.at(-1) ?? cwd
    const [directoryChangeTarget = ''] = programArguments
    const [sedQuietFlag, sedPrintedLinesText = '', sedPrintedFile = ''] = programArguments
    const [, firstLineText, lastLineText = firstLineText] =
      SED_PRINTED_LINES_PATTERN.exec(sedPrintedLinesText) ?? []
    const catPrintedFiles = programArguments.filter(
      (programArgument) => !programArgument.startsWith('-'),
    )
    const isDirectoryChange = program === 'cd' && programArguments.length === 1
    const isSedOfLines =
      program === 'sed' &&
      sedQuietFlag === '-n' &&
      firstLineText !== undefined &&
      programArguments.length === 3
    const isCatOfFiles =
      program === 'cat' &&
      catPrintedFiles.length > 0 &&
      !programArguments.some((programArgument) => REDIRECT_PATTERN.test(programArgument))
    if (isDirectoryChange) {
      directories.push(toAbsolutePath(currentDirectory, directoryChangeTarget))
    }
    if (isSedOfLines) {
      const lastLine =
        lastLineText === SED_LAST_LINE ? Number.MAX_SAFE_INTEGER : Number(lastLineText)
      reads.push({
        filePath: toReadPath(currentDirectory, sedPrintedFile),
        readLines: { firstLine: Number(firstLineText), lastLine },
      })
    }
    if (isCatOfFiles) {
      reads.push(
        ...catPrintedFiles.map((typedPath) => ({
          filePath: toReadPath(currentDirectory, typedPath),
          readLines: null,
        })),
      )
    }
  }
  return { directories, reads }
}
```
Run, green: `bun test -t hook`, `15 pass, 0 fail`.
