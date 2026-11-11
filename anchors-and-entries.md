# Anchors and entries: the formats

The formats `check` enforces: an anchor and what it covers, a ledger entry, the lock. Read it before the first
anchor or entry you write in a session. When an anchor earns its place and where it goes: `SKILL.md`, "Adding
anchors".

## Anchor grammar

```
§<role> <id>@<version>[ #<step>][ free text]
```

- role: `decision`, `invariant`, `edge`, `flow` define; `uses`, `test` refer.
- id: two or more dot-separated lowercase segments, kebab case inside; the first segment is the domain.
- version: the entry's current version, starting at 1.
- `#<step>`: flow anchors only, the number of the step in the entry's `steps:`.
- Free text after the anchor is a local note about this site.
- Several anchors can stack above one block, one per comment line.
- Among JSX children a `//` line is text that renders into the page; write the anchor as a JSX
  comment there, `{/* §uses teams.invite-link-param-mirrored@1 */}`. Between JSX attributes and in
  plain code, `//` is fine.
- `§` followed by a lowercase letter always starts an anchor. Prose that mentions the syntax writes
  `§<role>`; a file that quotes real-looking anchors as examples (docs about the method, articles) is
  listed in `logicmap/ignore`, one git pathspec per line, and is not scanned.

An anchor covers its own line when code precedes it (`return null // §edge ...`), otherwise the first
code line below its comment, plus everything indented under that line and the closing bracket lines
(`}`, `} else {`, `)`, `> => {`) at its indentation, and after a closing line a deeper line that continues the
statement (an arrow's body after `}): T =>`, a call chained after `})`). The fingerprint hashes that span, whitespace and comment-only
lines left out (`//` lines, `/* */` blocks, `# ` and `-- ` lines, `<!--`), so rewording a comment asks no
ack; a comment after code on its line counts. A code lock line holds `v3:<code>.<shape>`: that
fingerprint, and the fingerprint of the code's shape, every word that isn't a keyword replaced by its
order of first appearance, so a rename one for one keeps the shape. A `v2:` line has no shape, and a line
with no prefix was taken with the comments; an ack renews such lines of its domain whose code is still as
locked, so nothing is acked unread.

`check` enforces: each `decision`, `invariant` and `edge` id has exactly one defining anchor; each flow
step has at least one site unless marked `(external)`; every anchor pins the entry's version; the role
matches the entry's kind; retired ids have no anchors; every active entry has a site; every defining
anchor's and entry's fingerprint matches the lock; every line an active entry's `grep:` finds, comment
lines left out, lies under an anchor of that entry. It warns when an `edge` or `invariant` has no `test`
anchor and no `untested:` field, when the first sentence of an active entry's `what` is over 200
characters (`long-what`), when git has no PCRE and the `grep:` fields go unchecked
(`grep-unavailable`), and when git finds a line no pattern matches in JavaScript (`grep-mismatch`).

## Ledger entry

```markdown
## sync.close-during-join
kind: edge
version: 1
what: The socket can close while joinRoom is still loading the document.
why: joinRoom adds the connection to the room before it resolves, so a socket that closed meanwhile
  must be removed when the join lands; otherwise the room keeps it and is never destroyed.
breaks-if: the closedEarly branch goes → one leaked room per document opened and abandoned mid-load.
source: the comments in src/sync/ws-routes.ts (commit aafde56)
history:
- @1: introduced
```

- Required: `kind` (`decision` | `invariant` | `edge` | `flow`), `version`, `what`, `why`, `source`.
- The first sentence of `what` is the claim: the rule itself, in at most 200 characters. It is what
  `show <domain>` and `show <file>` print for the rule. The detail of the rule may follow it in the same
  field. A sentence ends at `.`, `!` or `?` before a capital letter or the end of the field, so `e.g.`
  and `req.ip` do not end it.
- `source` says where the claim comes from. `inferred — <evidence>` (commits, tests, traced paths)
  when an agent worked it out from the code; otherwise where a person recorded the intent: a doc, an
  ADR, a PR or issue, a commit message, `confirmed by <name> <date>`. `show` prints `inferred` or
  `recorded` beside every entry.
- Optional: `rejected` (alternative → why not), `breaks-if`, `revisit-if` (the condition that reopens
  it), `untested` (why no test proves this `edge` or `invariant`: a timing no test can stop at, a check
  only a person in a browser can make), `grep` (a pattern for the lines that send or read what the rule
  governs, written in the syntax PCRE and JavaScript share, such as
  `\b(CLIENT_)?LIVE_EVENT_TYPES\.tagChanged\b`; it needs git built with PCRE), `status` (`active`
  default, or `retired`), `history`.
- Flow entries add `steps:`, one `N. text` line per step; append `(external)` to a step with no code in
  this repo (a user clicking an email link).
- A line indented under a field continues it. The file is `logicmap/<domain>.md`; the heading is the id.
- The file opens with `# <domain>` and a short intro, the prose above its first entry: what the domain's
  rules cover and where its code starts. `show` prints it beside the domain's rule ids.

## The lock

`logicmap/<domain>.lock` holds one line per defining site and per entry of its domain. Only `ack` writes it, and
an ack rewrites only the lock of its own domain. A repo with the single `logicmap/lock` of earlier versions is
read as is, and split by its next ack.
