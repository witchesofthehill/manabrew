# Decision journal and rewind

PvP and external Manabot games use `decisionJournal` and `journalRewind`.
The Journal tab shows redacted consumed decisions from `gameView.checkpoints`;
Forge AI games retain legacy snapshots in production. Journal mode rejects internal
Forge AI unless the private start request explicitly selects
`forgeAiPolicy: "deterministic-v1"`.

This opt-in pins a 20,000-unit work limit per Forge AI search, applied through
`GameRules.setAiWorkLimit` before match creation. It does not change the public
protocol or enable Forge AI journals in production launchers. An absent policy
preserves legacy AI behavior; any supplied value other than the exact string
`"deterministic-v1"` is rejected, including null and non-string values. There is no
separate numeric budget option. Changing the limit requires a new policy version.

The exact policy remains in the journal's original start request and applies to
both live play and reconstruction. Replay requires the same harness/Forge artifact,
assets and effective preferences, with the same seed and policy. This opt-in does
not support replay across artifacts, versions or runtimes, and does not relax
prompt, state or RNG verification or the single-game isolation requirement.

Legacy `GameSnapshot` rewind has a control-restoration limitation. After an
assimilated permanent returns to its owner through Saga chapter III, restoring
an earlier snapshot can place it in the saved controller's battlefield without
restoring `Card.controller`. This affects the Forge AI snapshot path; verify
Assimilate rewind through isolated journal reconstruction, not legacy copying.

## Reconstruction and promotion

An approved restore vote freezes the authoritative engine. A fresh worker/process
replays the selected prefix from the original start request and seed, checking
every prompt, deciding seat, state witness and RNG position. The candidate becomes
authoritative only after terminal verification and publication of its final views.
Then the source is terminated. Failure disposes of the candidate and resumes the
source. There is no idle spare or shadow engine.

- Browser/WebView: `forge-engine.worker.js` supervises the engine and buffers
  candidate SABs until `forge:replay_ready`. Directive lanes and queued directives
  survive promotion; prompt IDs advance so stale responses cannot be accepted.
  The supervisor cancels owned child-worker error events and forwards the failure,
  preventing a second propagated report at the page's worker boundary.
- JVM/native: `journal_engine.rs` owns subprocess reconstruction and promotion.
  Replay has a 120-second total deadline; subprocess RPCs have 60-second deadlines
  and poll cancellation every 20 ms. Failed transports are killed and reaped,
  because their uncorrelated late replies cannot safely be reused.
- Ending the game or losing the authoritative worker cancels reconstruction.
  A queued non-restore directive prevents native promotion.

Forge global IDs and caches require one journal game per worker/process. Never
reconstruct inside the authoritative engine. Rewind temporarily holds two engines
and their card databases; container memory must allow for concurrent candidates.

## History and verification

`DecisionHistory` retains at most 64 MiB or 50,000 consumed inputs. Reaching the cap
stops recording but preserves rewind within the retained prefix. Successful rewind
discards the abandoned suffix. Votes and rewind requests are orchestration, not
recorded gameplay inputs. Full journals and witnesses contain hidden information
and must remain private to the engine host.

Interactive rewind exposes the latest 200 checkpoints, independently of the
retained journal prefix. Select a checkpoint that is still published.

Verification covers canonical prompts, every seat's view, spectator state, ordered
card identities in all zones (including libraries), and the primitive RNG stream.
It is not a serialization of every Forge field: delayed triggers and stack locals
are reconstructed by execution. Tests must compare continued play, not only the
restored board. Cross-runtime, cross-artifact and cross-version replay are unsupported.

Threaded RPCs read immutable views published by the game thread before prompts,
revisions and game over; they must never traverse live Forge zones. During replay,
UI views and checkpoint rows are deferred until the destination. Per-input
verification and remembered-hand updates still run.

## Delivery API

`DecisionJournal` records inputs before dispatch. Version 2 batches contain the
exact `startRequest`, then ordered entries with `sequence`, `playerIndex`,
`prompt`, `action` and `verification`. Consumers choose either drained delivery or
`readDecisionJournal` plus cumulative `acknowledgeDecisionJournal`; never mix modes.
Acknowledgement cannot exceed the prefix already read. Retries and duplicate
acknowledgements are supported.

The delivery queue is limited to 4096 entries or 8 MiB. Overflow or legacy snapshot
restoration invalidates delivery explicitly. This queue is separate from retained
interactive history. `decisionJournalCommitBarrier` holds startup until sequence 0
is acknowledged and holds each decision until its own acknowledgement; acknowledge
only after durable receipt. Interactive rewind owns delivery and rejects this flag.

`exportReplaySnapshot` packages a pending boundary and prefix;
`restoreReplaySnapshot` reconstructs and verifies it in an isolated JVM. Export is
queued on the game thread, so acknowledge pending commit barriers first. Snapshots
pin the harness artifact, assets and effective preferences; these must remain
immutable during a session. Durable storage and host takeover are separate work.

## Regression check

`JournalRewindTest` (run by `yarn build:harness`) plays a seeded two-seat game with
dungeon venture and +1/+1 counters through turn 12 in one harness process,
rewinds to the first decision of turn 10, and reconstructs it in a second process.
Every later prompt and every seat's and the spectator's view must match the original
through the end of turn 12. A fixture that no longer adds counters or dungeon progress
after the target fails rather than passing with weaker coverage.
`ReplayOrderingTest` keeps Room choice order independent of JVM identity hashes.

The Forge AI case in `JournalRewindTest` uses two human seats and one built-in AI.
It requires bot attacks and paid, targeted casts on both sides of the rewind
target, compares continuation prompts, views and state/RNG witnesses, and checks
that a corrupt witness rejects the candidate without discarding the source.

Run the worker regressions against artifacts built from the same checkout:

```sh
yarn test:forge-rewind
yarn test:forge-rewind --forge-ai
yarn test:forge-rewind --forge-ai --native target/debug/self-hosted-node
yarn test:forge-webimage-rewind
```

`test:forge-rewind` defaults to the JVM harness jar. The native command needs
`libforgeharness` and a node binary built with `graal-forge`. Both check continued
play, corrupt replay rejection and concession during a pending rewind. For the
Web Image test, stage `forgeharness.js` and `forgeharness.js.wasm` in
`packages/forge-wasm/`, or pass `--launcher <path> --wasm <path>` to use build
outputs directly. It runs the Node package with real workers and SABs, checks bot
combat and targeting after the rewind target, then compares continued play after
the supervisor promotes the candidate.

Qualify each runtime before enabling its launcher. A macOS native build uses
Serial GC and does not qualify the Linux hosted build, which uses G1.

`journal_engine` unit tests cover node promotion, hung or crashed candidates and process
cleanup. `yarn test:forge-supervisor` covers browser worker promotion and teardown.
