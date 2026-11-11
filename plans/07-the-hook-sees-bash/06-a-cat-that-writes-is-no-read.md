# Step 6: A `cat` that writes a file is no read of it

Before: `bun test` 61 pass. The finding is the plan's revision of 2026-11-11.

## Piece 1: the failing test
What: one test in `describe('hook')`. `cat > src/room.ts <<'CODE'` and `cat <<'CODE' > src/room.ts` say nothing;
`cat src/room.ts 2>/dev/null` and `sed -n 2,5p src/room.ts 2>/dev/null` are the reads they were.
Why: writing a file with `cat` and a heredoc is how a shell writes a file. The walk read `>` , the path and the
heredoc's marker as three files to print, found the second, and answered with its rules and its newest change: a
write reported as a read, and the lines shown once spent on it.
Where: `scripts/logicmap.test.ts`, at the end of `describe('hook')`
```ts
  test('a cat that writes a file is no read of it; a read whose errors go elsewhere still is', () => {
    const repoRoot = createMappedRepo()
    const sessionId = `redirected-${crypto.randomUUID()}`
    const contextOfCommand = (command: string): string | null => {
      const hookOutput = respondToHook({
        hook_event_name: 'PostToolUse',
        session_id: sessionId,
        cwd: repoRoot,
        tool_name: 'Bash',
        tool_input: { command },
        duration_ms: 12,
      })
      return hookOutput !== null && 'hookSpecificOutput' in hookOutput
        ? hookOutput.hookSpecificOutput.additionalContext
        : null
    }

    expect(contextOfCommand("cat > src/room.ts <<'CODE'")).toBeNull()
    expect(contextOfCommand("cat <<'CODE' > src/room.ts")).toBeNull()
    expect(contextOfCommand('cat src/room.ts >> src/copy.ts')).toBeNull()
    expect(contextOfCommand('cat src/room.ts 2>/dev/null')).toContain(
      'sync.close-during-join@1  edge  recorded  The socket can close while the join is loading.',
    )
    expect(contextOfCommand('sed -n 2,5p src/room.ts 2>/dev/null')).toBe(
      'logicmap: these lines of src/room.ts are covered too by rules shown earlier this session: sync.close-during-join@1',
    )
  })
```
Run (red): `bun test -t "a cat that writes a file"`: 0 pass, 1 fail; `cat > src/room.ts <<'CODE'` expected `null`
and received the rules covering `src/room.ts`.

## Piece 2: a redirected `cat` reads nothing; a redirect of the errors is no argument
What: in `walkCommand`, a word sending the errors elsewhere (`2>/dev/null`, `2>&1`) is dropped from a segment's
arguments, so a `sed` or a `cat` followed by one keeps its shape; a `cat` with a `<` or a `>` among its arguments
takes its input from, or sends its output to, somewhere that is not the agent, and is no read.
Why: the reads are what the agent sees printed. A `sed -n` followed by `> file` already had four arguments and
matched nothing.
Where: `scripts/hook.ts`: before `walkCommand`, and its segment loop
```diff
+// `2>/dev/null`, `2>&1`: where a command's errors go changes nothing of what it prints.
+const ERRORS_REDIRECT_PATTERN = /^2>/
+const REDIRECT_PATTERN = /[<>]/
...
-    const [program, ...programArguments] = segment
+    const [program, ...typedArguments] = segment
       .trim()
       .split(/\s+/)
       .map((shellWord) => shellWord.replace(QUOTED_WORD_PATTERN, '$2'))
+    const programArguments = typedArguments.filter(
+      (typedArgument) => !ERRORS_REDIRECT_PATTERN.test(typedArgument),
+    )
...
     const isCatOfFiles =
       program === 'cat' &&
       programArguments.length > 0 &&
-      programArguments.every((programArgument) => !programArgument.startsWith('-'))
+      programArguments.every(
+        (programArgument) =>
+          !programArgument.startsWith('-') && !REDIRECT_PATTERN.test(programArgument),
+      )
```
Run (green): `bun test`: 62 pass, 0 fail; the strict `tsc` and `biome check` clean.
