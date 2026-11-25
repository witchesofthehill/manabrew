# Forge host migration

## Scope and history

PR #902 was closed because its author superseded it with #1026. Neither PR has a rejection in its review discussion. #1026 combined checkpoint takeover with a durable decision journal and was also closed. This change ports the small checkpoint path onto current main. Main's local decision replay remains separate. `TurnCheckpoint` is the old #902 `GameCheckpoint`; the current `GameCheckpoint` name already belongs to verified journal rewind.

Start with native Forge hosts, including fleet pods and the native desktop host process. Browser Forge has no checkpoint export. Ironsmith already migrates its input sequencer and does not need this path.

Matchmade pods prefer a free hosted room. Two-player pods prefer a `can_host` member. Queue table calls can also seat people at an existing native desktop table. `hosted=true` and the relay's “non-playing host” log describe the separate engine connection, not proof that it is a fleet node. Disconnected hosts must be excluded from both pool selection and table calls, and cannot start games.

## Recovery contract

The harness exports once per turn at the first available MAIN1 priority window with an empty stack, no simultaneous entries and no combat. The immutable text and sidecar travel through the isolated engine command bridge. They include all hands and library order and never go to a player or spectator. Checkpoint receipt is authorized against the current room host and game, capped at 2 MiB and ordered per host session.

After 20 seconds, or the configured reconnect window plus margin when shorter, the relay offers recovery to an official idle Forge pod advertising `host_handoff`. Every retained human must advertise that feature so its client can clear old IDs. The selected idle room is reserved while the offer is pending. The node releases that idle room and uses its pool slot for the takeover.

A separate expiring token authorizes a new session's `ResumeRoom`. The original host can still reconnect before the claim. A claim invalidates the original credential and clears cached states, prompts, directives, queued inputs and transports. It preserves game ID, seats and elapsed game duration. Takeovers allocate a new prompt-ID range, so delayed old responses cannot answer restored prompts. The client clears prompts and card-dependent UI and waits for full state. A published full state confirms success. An unclaimed offer times out after 45 seconds. A claimed engine that never publishes state is also aborted.

Restore runs on the engine thread through a `GameState` subclass calling `applyGameOnThread`, never `applyToGame`. Previously eliminated seats are removed before applying the text. Seats that departed after the checkpoint are conceded after import. The sidecar restores commander cast counts and damage, monarch, initiative and day/night.

Player message: “The table moved to a new host. Play resumes from the start of turn N. Actions since then must be played again. Emblems and effects that last several turns may be missing.” The checkpoint is actually the first main-phase boundary. It does not preserve stack, pending prompts, turn history, layer timestamps or arbitrary persistent effects. It is a lossy recovery, not exact replay.

An ordinary human leaving a node table remains a concession. Surviving humans continue against each other or existing Manabot seats. No replacement human identity is fabricated.

## Measurement

`host_handoff` events carry `game_id`, `room_id`, a non-secret `attempt_id`, `outcome`, checkpoint `turn`, `seconds_lost`, source `host_type` and `target_host_type`. Outcomes distinguish offered, claimed, succeeded, host_resumed, no_checkpoint, no_candidate, unsupported_clients, timed_out and restore_failed. `seconds_lost` estimates rollback from relay checkpoint receipt to host disconnect, excluding the recovery wait. Missing checkpoints have null turn and loss. Transfer tokens and checkpoint contents are never analytics fields.

The ingester increments `games.host_changes` only for succeeded. Raw events retain every outcome. Join them to `games` on `game_id`; successful recovery does not emit a game end or mint another game. Subsequent completion keeps its actual `games.end_reason`. Exhausted recovery falls back to `host_lost`; an engine failure can retain `engine_fatal` under existing outcome precedence. Abandonment is still abandonment.

## Handoff to the next implementation

This draft is the checkpoint recovery foundation for fedpoi. The existing deterministic decision-journal work stays separate. Before enabling production takeover, run a two-pod staging drill against the packaged native runtime, including bot seats, a second host loss, reconnect races and failed restore. Browser export and exact deterministic recovery remain follow-ups.

## Browser follow-up

1. Add a host-only export channel to the Forge Web Image entry point, `SabTransport`, engine worker and `packages/forge-wasm/seat.js`. Publish only immutable turn-checkpoint strings captured on the game thread. Do not traverse live zones from a worker RPC or expose export on ordinary guest seats.
2. Add a worker-to-host checkpoint notification carrying game ID, sequence and turn. Send `ReportCheckpoint` through the relay even while gameplay uses WebRTC. Cache the newest checkpoint outside the worker and bound payload and polling cost. Browser closure must require no last-second message.
3. Support checkpoint startup in Web Image and preserve the same sidecar and direct game-thread import. Skip mulligans, invalidate every ID-based cache, restart seat readers and require fresh full views. Test four seats, eliminated players, Commander metadata and departures after checkpoint capture.
4. Enable browser-to-pod first. Browser-to-browser transfers expose hidden information and require every seat's explicit opt-in. Do not infer consent from `can_host`, platform or matchmaking participation.
5. Apply #898 ranking at game start: native desktop, desktop-class wasm browser, then pod. A pod wins when any seat has not opted in. Phones and PWAs never host. Measure checkpoint cost on desktop wasm before choosing a broader cadence.
6. Test abrupt tab death, stale inputs, restore failure, incompatible clients, takeover timeout, reconnect races and a second handoff. Rebuild and verify the real Web Image artifact before enabling the wire capability.
