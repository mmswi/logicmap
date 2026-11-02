# Step 3: the docs

## Piece 1: SKILL.md, README, the hook's header
What:
- SKILL.md, `why`'s targets: a line's rules each with its why and the alternatives it rejected; `why <id>` the same;
- "Changing anchored code": `check` fingerprints only where a rule is defined; code under a `uses` or `test` site is
  checked by re-reading its rule against the new code, and the hook names those rules after the edit;
- "The hook", the Edit bullet: the rules whose `uses` or `test` sites cover the lines changed since HEAD, once per
  file and session;
- README's hook line; `hook.ts`'s header comment.
Why: "Changing anchored code" is where an agent learns what to do after an edit; without the line it would read the
hook's note as a `check` error to ack, which a `uses` site can't take.
Where: `SKILL.md`, `README.md`, `scripts/hook.ts`
