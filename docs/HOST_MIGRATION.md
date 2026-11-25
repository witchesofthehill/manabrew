# Warm journal replicas for Forge host migration

## Status and shipping dependency

Ship host migration after deterministic Forge bots. This draft implements the warm engine and journal replication core, plus the independent dead-host matchmaking guards and human-departure regression. The next steps below cover relay orchestration and production enablement.

Automatic room migration is not enabled yet. The recovery design uses a live standby engine on another node, continuously applying the authoritative decision journal. Promotion must not start a fresh JVM or replay the entire game after the host dies. Do not use Forge `GameState` text, turn-start rollback, or the lossy sidecar from #902.

#902 was superseded by #1026, which also explored durable journals. The existing verified journal machinery on main is the foundation. `docs/DECISION_REPLAY.md` describes its current boundaries: rewind constructs a fresh isolated engine on demand; it does not maintain an idle replica. Reuse its canonical inputs, verification and process isolation, and add continuous follower execution.

## Implemented engine core

`java_backend::warm_replica` provides `JournalHost`, `WarmReplica`, journal batches, receipts and boundary witnesses. A source must use acknowledged journal delivery with the commit barrier and without interactive rewind. The follower starts from the exact sequence-zero manifest before gameplay, checks the packaged harness/assets/preferences identity, and keeps that isolated engine alive while applying subsequent entries.

Each input is appended to a private log and synced before execution. The follower verifies the canonical prompt and state/RNG witness, then verifies that its own engine consumed the same journal entry. Exact retries are idempotent; gaps, epoch mismatches and conflicting duplicates are rejected. Storage or execution failures invalidate the replica and prevent acknowledgement and promotion. The limits are 8 MiB per batch, 50,000 decisions and 256 MiB per retained replica log. Reaching a limit stops protection rather than silently dropping history.

`verify` compares the source's current pending boundary with the running follower. `promote` requires that exact applied and verified sequence plus a newer epoch, and moves the existing process handle into the active-host API. It does not start a process or reconstruct the game. The promoted engine keeps journal delivery enabled for the next replica. Epoch checks here validate local message consistency; they do not replace relay authorization, old-host fencing or a durable promotion decision.

The JVM integration tests run separate source and follower processes, replicate a four-seat Commander game and a concession, kill the source, assert the promoted PID is unchanged, then compare continued play against another warm follower. They also cover stale epochs, gaps, conflicting duplicate input, an unverified tail and failed durable storage.

This core is not connected to the room host loop or deployed automatically. The currently tested identity implementation requires the packaged JVM harness. Native artifact identity and a packaged-native drill remain required before using this on the fleet. Promotion currently requires a source-published verified pending boundary; automatic recovery of an unverified committed tail and terminal-game boundaries are next steps. The log is durable but no restart loader, compaction or replacement-replica bootstrap is implemented yet. Keep protected games disabled until relay orchestration handles these contracts.

## Existing journal surface

`DecisionJournal` version 2 carries the exact start request followed by ordered entries containing sequence, deciding player, canonical prompt, action and verification. `readDecisionJournal` and cumulative `acknowledgeDecisionJournal` support retryable delivery. Do not mix them with drained delivery. The commit barrier holds startup and inputs until acknowledgement. The delivery buffer is bounded and is not a durable full-game log.

Current verification covers prompts, seats, views, ordered card identities and RNG position. Define exactly which before-input or after-input boundary each witness proves. Do not treat receipt of an entry, or its existing verification field, as proof that its resulting state has been applied. Add an explicit verified boundary for the current pending prompt and terminal game state.

Interactive rewind currently owns journal delivery and rejects `decisionJournalCommitBarrier`. Resolve that ownership before enabling replicated games. A rewind is a coordinated journal branch change: both engines must switch to the same accepted prefix and generation. Otherwise disable rewind for protected games until this is implemented. Do not silently combine the two existing consumers.

## Active host and warm standby

1. At game start, allocate an active engine and a standby on different node processes and failure domains. Reserve the standby against real engine capacity. Keep both alive for the game. A loaded JVM alone is insufficient: the standby must hold this game's execution state at a verified boundary.
2. Pin identical harness, assets, runtime, effective preferences, start request and seed. Current cross-runtime and cross-artifact replay is unsupported. Native desktop, JVM pod and Web Image are not interchangeable until compatibility is demonstrated. Begin with compatible node-to-node Commander games.
3. Send the start request and sequenced journal stream through a private authenticated replication path. Retain a durable ordered log outside the active process. Acknowledge the source only after the required durable replication receipt. Record received, committed, applied and verified positions separately.
4. Run a persistent follower in its own isolated worker or process. Incrementally feed canonical journal entries, verify every boundary, and wait for the next entry. Never publish its state, issue player prompts, send bot actions, or report outcomes while it is a follower. Do not independently choose external Manabot actions; replay their consumed inputs. Internal Forge bot replay depends on the deterministic bot implementation and matching RNG behavior.
5. Replicate all gameplay-affecting inputs, including concessions, timeout decisions and relevant directives. Preserve ordering and deduplicate retried player commands. Do not use relay arrival order as a substitute for the engine's consumed journal order.
6. A divergent, incompatible or lagging standby is ineligible for promotion. Surface the protection state and replace the standby while the active host still serves the game. Initial synchronization and replacement can replay history in the background; the normal failure path promotes an already running follower.

## Commit boundary and promotion

The relay assigns a monotonically increasing host epoch and validates it for host output, outcomes, replication acknowledgements and client routing. A disconnected socket is not a fencing mechanism. Old hosts must lose authority even if their process remains alive or reconnects later.

On host loss, freeze new game inputs, fence the old epoch, and determine the durable committed journal prefix. Let the warm standby finish any committed tail and verify the exact pending boundary. Promote only that verified engine under the new epoch. Preserve game ID, stable seats and match identity. Publish fresh full views and the pending prompt before accepting responses. Invalidate old transport routes and stale prompt responses; journal reconstruction alone does not establish wire authority.

Define player acknowledgement around the committed prefix. An acknowledged action must be durably replicated before its result becomes authoritative. In-flight uncommitted actions can be retried using command IDs; they must not be silently applied twice. If the standby or durable tail is unavailable, pause recovery and report the limitation. Do not claim seamless failover or fall back silently to lossy turn checkpoints. A cold rebuild would be a separate, explicitly slower disaster-recovery path, not this handoff contract.

Normal handoff copy should say that the table is reconnecting to its standby, then that play has resumed. There is no turn-start rollback notice or warning about discarded emblems. Exactness must be established by continued-play verification, including stack and pending choices.

After promotion, provision another standby without exceeding pool capacity. Stop both replicas when the game ends or all humans leave. Shutdown, node drain, room cleanup and repeated failover must preserve a single authoritative engine and release both reservations.

## Matchmaking and browser follow-up

Larger matchmade pods currently prefer free hosted rooms. Two-player pods prefer a `can_host` browser. Open-table calls can also seat players at a native desktop table. `hosted=true` and the non-playing-host log do not distinguish desktop engines from fleet pods.

The existing human-departure path concedes that seat and lets the remaining humans or existing Manabot seats continue. It needs no replacement identity or new game. Protection must include these concessions in the replicated journal.

Browser protection needs journal delivery through the Web Image, worker and `seat.js`, plus a compatible warm follower runtime. It does not need a `GameState` export API. Persistently stream journal entries while the browser is alive, including when gameplay uses WebRTC; never depend on a closing tab sending its final state. Verify cross-runtime replay before enabling browser-to-native standby. Otherwise use a matching runtime or leave that pairing unsupported.

Retain #898's host ranking at game start: native desktop, desktop-class wasm browser, then pod. A pod wins when not every seat explicitly opts into hidden-information hosting. Phones and PWAs never host. A standby receives all hidden information too, so peer-hosted replicas need the same unanimous consent. Feature support and `can_host` are not consent. Official node standbys keep that data away from other players.

## Measurement

Add relay `host_handoff` events when the implementation lands. Include a non-secret attempt ID, game ID, old and new epoch, source and target host types, outcome, turn, committed and verified journal sequence, input lag, catch-up time and total interruption. `seconds_lost` measures rolled-back authoritative gameplay, not downtime. It should be zero for a successful fully committed warm promotion; report it as unknown when evidence cannot establish that. Use a separate interruption-duration field.

Outcomes must distinguish promotion success, no ready standby, incompatible artifacts, journal divergence, missing durable tail, promotion timeout and fencing rejection. Never log journal contents, hidden cards, credentials or transfer tokens. Measure standby readiness, replication lag, memory and reserved capacity separately.

Keep the same `game_id` through promotion. Successful handoff must not emit `game_ended`; the eventual game keeps its actual `games.end_reason`. Recovery exhaustion ends through the explicit lifecycle path, normally `host_lost`, without masking an independently reported engine failure. Join handoff attempts to games by game ID and count confirmed promotions only.

## Next steps and acceptance tests

- Extend the relay host-loss test to promote an already running follower. Prove fencing rejects the old host's states, outcomes and delayed messages, including after it reconnects.
- Replace the GameState round-trip test with an active/follower journal test in separate compatible processes. Compare every seat, spectator state, prompts, RNG witnesses and continued play. Cover four-seat Commander, eliminated seats, commander damage and tax, monarch, initiative, day/night, stack, pending decisions, emblems and persistent effects.
- Kill the active process after committed input, before acknowledgement, and during a pending choice. No acknowledged action is lost and retries are applied at most once. Assert the promoted engine existed before the kill and no fresh engine startup occurs during handoff.
- Leave a human seat mid-game, fail over, and continue with the remaining humans and Manabot. Repeat with deterministic internal Forge bots after that dependency ships.
- Exercise standby lag, loss and replacement, duplicate and reordered batches, journal limits, divergence, relay reconnect, coordinated rewind and a second promotion. Verify capacity and cleanup on every path.
- Assert analytics outcomes and unchanged game identity, and verify the real packaged runtime on two nodes before production enablement.
