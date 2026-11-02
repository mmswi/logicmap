# Acceptance: the ten questions, with and without `why`

2026-11-02, teamabled `2b04ddc1` (the question files unchanged since `e3405812`). Two fresh general-purpose agents,
the same prompt (`acceptance-questions.md` without its "Recorded" answers, the repo's piece convention, read-only):
one with the skill's main (`show`, `check`, `diff`, git), one with branch `why`'s checker copied outside the
worktree, so it couldn't read the answers. Both sessions ran the installed Read hook, which is main's: neither saw
step 6's line, so this measures the command alone.

| # | Question | Without `why`: calls, reached | With `why`: calls, reached |
|---|---|---|---|
| 1 | a merge's failed announcement | 3, yes | 1, yes |
| 2 | the session cache through a Redis error | 3, yes | 1, yes |
| 3 | a writer's edit time | 4, yes | 1, yes |
| 4 | appendUpdate awaits its insert | 3, yes | 1, yes |
| 5 | a new thread's Inbox rows | 6, yes | 3, yes |
| 6 | an ended round's state, over time | 9, yes (3 of its 5 pieces) | 4, yes (5 of 5) |
| 7 | someone else's unfreeze | 4, yes | 1, yes |
| 8 | the room loads before it listens | 4, none recorded (right) | 3, none recorded (right) |
| 9 | the provider's binaryType | 3, none recorded (right) | 3, none recorded (right) |
| 10 | loadDoc's rebuild order | 2, yes | 3, yes |
| | total | 41 | 21 |

Both answered all ten right: eight reached the recorded reason, two said none is recorded and gave the inferred
entry as inferred. The difference is the cost, and the completeness of a history: on question 6 (how the line
changed) the agent without `why` listed the commits from `fc06c056` on and cited three of the five pieces; with
`why` it listed all five, back to F2 A2's `## Bucata 2`. Questions 1–4 and 7, one piece each, took one call with
`why`, 3–4 without. Questions 8–10, June code with no piece, cost about the same either way: the answer is in the
map or the old docs, which `why` prints only as rules (8, 9) or doesn't reach (10's `editor/01`, `editor/04` docs).
In all: with `why` 22 tool calls, 148k tokens, 273 s; without, 42 tool calls, 162k tokens, 469 s.

Findings:
- Question 5's line is mine, and wrong: `document-events.ts:189` is the share's call of the writer; the thread's is
  at 216. Both agents saw it and answered for the thread.
- The agent without `why` named more rejected alternatives on questions 1 and 3, read from the entry's `rejected:`;
  `why` prints a rule's claim and `why:`, and `show <id>` the rest. Not a step change: the rule line says so, and
  the agent with `why` reached each recorded reason. A follow-up on the board: `rejected:` under each rule.
