# Step 8: a site bumped since its ack says so

## Piece 1: red, check right after a bump
What: a test in `describe('bump')`: after `bumpId`, the entry's and the definition's `changed` errors say the rule was bumped from @1 to @2 and what is left before the ack.
Why: seen in the trial of the shorter skill. After `bump`, the entry's text and the definition's pin differ from their lock lines, so `check` reported both as `changed` with "its meaning changed → bump its version", for the rule just bumped. An agent following it bumps twice.
Where: scripts/logicmap.test.ts, after the test "a bump reason is written on one history line…"
```ts
  test('right after a bump, check says the rule was bumped and what is left, not to bump it', () => {
    const repoRoot = createFixtureRepo({
      'src/room.ts': ['// §edge sync.close-during-join@1', 'if (closedEarly) {', '}', ''].join(
        '\n',
      ),
      'src/routes.ts': ['// §uses sync.close-during-join@1', 'joinRoom(socket)', ''].join('\n'),
      'logicmap/sync.md': closeDuringJoinEntry(1),
    })
    ackIds(repoRoot, ['sync.close-during-join'])
    bumpId(repoRoot, 'sync.close-during-join', 'a join that fails removes the socket too')

    const bumpedMessages = checkRepo(repoRoot)
      .filter((problem) => problem.code === PROBLEM_CODES.changed)
      .map((problem) => problem.message)
    const whatIsLeft =
      'since the last ack: once its what and why say what holds now and each stale-pin site is re-verified and pinned @2, ack sync.close-during-join.'
    expect(bumpedMessages).toEqual([
      `the entry sync.close-during-join was bumped from @1 to @2 ${whatIsLeft}`,
      `the code under §edge sync.close-during-join@2 was bumped from @1 to @2 ${whatIsLeft}`,
    ])
  })
```
Run, red: both messages were "changed since the last ack: … its meaning changed → bump its version."; `(fail) bump > right after a bump…`.

## Piece 2: green, a site whose version is past its lock line's
What: in the lock comparison, a changed site whose version is above the version its lock line holds gets the bumped message.
Why: the version on a lock line is the version the site was acked at, and only a bump (or a hand edit doing what bump does) raises a site's version, so a higher version is the bump itself. What is left is what the bump report listed: the what and why, the stale-pin sites, the ack.
Where: scripts/logicmap.ts:1006
```diff
     if (isOwnKeyFree) {
       claimedKeys.add(lockSite.key)
-      const message = `${lockSite.label} changed since the last ack: …`
+      const lockedVersion = lockedSitesByKey.get(lockSite.key)?.version ?? lockSite.version
+      const isBumpedSinceAck = lockSite.version > lockedVersion
+      const message = isBumpedSinceAck
+        ? `${lockSite.label} was bumped from @${lockedVersion} to @${lockSite.version} since the last ack: once its what and why say what holds now and each stale-pin site is re-verified and pinned @${lockSite.version}, ack ${lockSite.id}.`
+        : `${lockSite.label} changed since the last ack: …`
```
Run, green: `bun test`, `65 pass, 0 fail`.
