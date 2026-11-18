# Pass-until lifetime and cleanup stops

Status: investigation and proposed fix. No runtime change is implemented here.
Related issue: [#1241](https://github.com/witchesofthehill/manabrew/issues/1241).
Investigation date: November 18, 2026.

## Confirmed behavior

On ManaBrew 3.84.1, commit
[`033caae811c9a18d691dc6cdf9b7fc588929eb61`](https://github.com/witchesofthehill/manabrew/commit/033caae811c9a18d691dc6cdf9b7fc588929eb61),
an ordinary cleanup stop can leave a held `PassUntil` instruction active
after its intended turn. Both Forge and the Rust ManaBrew engine retain the
target and suppress the local player's subsequent priority prompts.

The turn itself still executes. Headless Forge traces include untap, upkeep,
draw, both main phases, combat steps, and cleanup. The controller passes
priority without asking the local player.

The [official rules effective November 6, 2026](https://media.wizards.com/2026/downloads/MagicCompRules%2020261106.txt)
explain the distinction. Ordinary cleanup provides no priority under CR 514.3.
State-based actions or waiting triggers can create an exceptional priority
window and another cleanup under CR 514.3a.

### Reproduce from phase stops

1. Start a Forge game with two or four players.
2. Leave the local player's normal Main 1, attackers, and Main 2 stops enabled.
3. Enable an opponent's Cleanup stop. The default opponent End stop can remain enabled.
4. Reach a priority prompt during that opponent's End step with an empty stack.
5. Click Pass, or let Autopass answer a dead window.
6. Let the game advance without a cleanup trigger or another event that opens a new prompt.

The next target is that opponent's cleanup. The local player's following turn
advances without its normal priority prompts. Selecting the stop alone does
not send a held instruction; a subsequent pass does.

### Headless results

The pinned Forge revision was
[`62aec217f311b54bf93ef6d6cc455d7c85c29950`](https://github.com/witchesofthehill/forge/commit/62aec217f311b54bf93ef6d6cc455d7c85c29950).
The harness was rebuilt from those sources. The table counts local
`chooseAction` prompts during the following local turn.

| Target and condition                                | Two players | Four players | Hold afterward                |
| --------------------------------------------------- | ----------: | -----------: | ----------------------------- |
| Ordinary opponent cleanup                           |           0 |            0 | Retained                      |
| Cleanup discard triggers Megrim                     |           8 |            8 | Cleared                       |
| Opponent End step reached normally                  |           8 |            8 | Cleared                       |
| Ordinary cleanup with eligible Grizzly Bears        |           0 |            0 | Retained                      |
| Ordinary cleanup with Juggernaut required to attack |           6 |            6 | Cleared after combat response |
| Ordinary cleanup with `throughCombat: true`         |           0 |            0 | Retained                      |

For Megrim, the local player controls the enchantment and the active opponent
discards from eight Forests to seven during cleanup. The local player receives
two cleanup priority prompts, then the normal next-turn prompts.

Sixteen Forge cases covered these conditions, each opponent position in a
four-player game, self-cleanup, and a valid multi-turn control. Self-cleanup
also retained the target. The multi-turn control passed from player-1's End
step through player-2's turn and resumed correctly at player-3's Main 1.

Eight Rust cases covered two and four players, ordinary cleanup, cleanup with
a pending stack object, End-step controls, and both combat-policy values.
Ordinary cleanup retained the hold and suppressed the next Main 1 agent call.
The exceptional cleanup and End-step controls cleared it.

The Java fixture followed the existing
[interactive-controller test setup](../forge-harness/src/test/java/forge/harness/host/ManaBrewInteractiveControllerTest.java)
and used the real session, controller, prompt decoder, and
`PhaseHandler.mainLoopStep()`. The Rust fixture called the real
`priority_round` and `step_cleanup`, then explicitly set the next turn's
Main 1. Its exceptional case supplied a synthetic pending ability rather
than loading Megrim.

Frontend callback checks executed the current stop-selection and pass-output
functions for Autopass and Full Control in both seat counts. The emitted
`PassUntil` payload was identical; Full Control disabled the countdown.

These were temporary diagnostic fixtures, not committed regression tests.
The JVM run does not verify a particular cached browser Web Image.
No browser or visual end-to-end result is claimed.

## The target has no intended turn occurrence

The command records a player, a phase, and a combat policy. It does not identify
which occurrence of that player's turn should satisfy or expire it.

| Stage                   | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Consequence                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Select a stop           | [src/stores/usePhaseStopStore.ts:56](https://github.com/witchesofthehill/manabrew/blob/033caae811c9a18d691dc6cdf9b7fc588929eb61/src/stores/usePhaseStopStore.ts#L56-L99)                                                                                                                                                                                                                                                                                                                                                                                      | The ordered list excludes untap but includes cleanup as a future destination.                 |
| Send the pass           | [src/hooks/usePromptEffects.ts:22](https://github.com/witchesofthehill/manabrew/blob/033caae811c9a18d691dc6cdf9b7fc588929eb61/src/hooks/usePromptEffects.ts#L22-L58)                                                                                                                                                                                                                                                                                                                                                                                          | Ordinary Pass uses `throughCombat: false`; End Turn uses `true`.                              |
| Decode and retain it    | [forge-harness/src/main/java/forge/harness/host/ManaBrewInteractiveSession.java:580](https://github.com/witchesofthehill/manabrew/blob/033caae811c9a18d691dc6cdf9b7fc588929eb61/forge-harness/src/main/java/forge/harness/host/ManaBrewInteractiveSession.java#L580-L599) and [forge-harness/src/main/java/forge/harness/host/ManaBrewInteractiveController.java:213](https://github.com/witchesofthehill/manabrew/blob/033caae811c9a18d691dc6cdf9b7fc588929eb61/forge-harness/src/main/java/forge/harness/host/ManaBrewInteractiveController.java#L213-L219) | The engine keeps the destination across priority decisions.                                   |
| Recognize the target    | [forge-harness/src/main/java/forge/harness/host/PriorityFastForward.java:15](https://github.com/witchesofthehill/manabrew/blob/033caae811c9a18d691dc6cdf9b7fc588929eb61/forge-harness/src/main/java/forge/harness/host/PriorityFastForward.java#L15-L29)                                                                                                                                                                                                                                                                                                      | The target player must be active at or beyond the requested phase during priority evaluation. |
| Observe another turn    | [forge-harness/src/main/java/forge/harness/host/ManaBrewInteractiveController.java:168](https://github.com/witchesofthehill/manabrew/blob/033caae811c9a18d691dc6cdf9b7fc588929eb61/forge-harness/src/main/java/forge/harness/host/ManaBrewInteractiveController.java#L168-L188)                                                                                                                                                                                                                                                                               | The observed turn and maximum phase reset, but the target does not expire.                    |
| Suppress another prompt | [forge-harness/src/main/java/forge/harness/host/PriorityFastForward.java:96](https://github.com/witchesofthehill/manabrew/blob/033caae811c9a18d691dc6cdf9b7fc588929eb61/forge-harness/src/main/java/forge/harness/host/PriorityFastForward.java#L96-L104)                                                                                                                                                                                                                                                                                                     | An empty stack outside protected active combat permits passing without publishing a prompt.   |

The completion predicate is:

```java
activeSlot.equals(untilPlayer) && !current.isBefore(target)
```

The at-or-after comparison can recover from a missing earlier checkpoint
when a later priority window occurs on the same player's turn. Cleanup is
the last step. When its ordinary form provides no priority, the completion
check never runs there. On the next turn, both the active player and phase
no longer match the destination.

The phase order is correct as a list of real steps. Its use as a set of
guaranteed future priority opportunities is the problem.

Existing guards handle target-player loss, certain extra turns, and backward
phase movement within a turn. None handles a target turn that finishes
without the intended priority opportunity. Resetting the maximum phase on
ordinary turn rollover also prevents that rollover from looking like an
inserted extra phase.

Forge calls `autoPassCancel()` during cleanup, but the harness override is
empty. See
[Forge PhaseHandler.java:475](https://github.com/witchesofthehill/forge/blob/62aec217f311b54bf93ef6d6cc455d7c85c29950/forge-game/src/main/java/forge/game/phase/PhaseHandler.java#L475-L514)
and [forge-harness/src/main/java/forge/harness/host/ManaBrewInteractiveController.java:2625](https://github.com/witchesofthehill/manabrew/blob/033caae811c9a18d691dc6cdf9b7fc588929eb61/forge-harness/src/main/java/forge/harness/host/ManaBrewInteractiveController.java#L2625-L2630).
An unconditional clear in that override would also discard legitimate
multi-turn passes across other players' turns.

Rust has the same completion test in
[manabrew-rs/crates/manabrew-engine/src/game_loop/priority.rs:84](https://github.com/witchesofthehill/manabrew/blob/033caae811c9a18d691dc6cdf9b7fc588929eb61/manabrew-rs/crates/manabrew-engine/src/game_loop/priority.rs#L84-L110).
Its ordinary cleanup exits without that priority path in
[manabrew-rs/crates/manabrew-engine/src/game_loop/phase_handler.rs:546](https://github.com/witchesofthehill/manabrew/blob/033caae811c9a18d691dc6cdf9b7fc588929eb61/manabrew-rs/crates/manabrew-engine/src/game_loop/phase_handler.rs#L546-L613).

## Combat and Full Control do not guarantee recovery

Combat priority and attacker declaration are separate decisions.

`canSkip(false)` protects combat priority once attackers exist. Eligible
creatures alone do not satisfy that condition. In
[forge-harness/src/main/java/forge/harness/host/ManaBrewInteractiveController.java:385](https://github.com/witchesofthehill/manabrew/blob/033caae811c9a18d691dc6cdf9b7fc588929eb61/forge-harness/src/main/java/forge/harness/host/ManaBrewInteractiveController.java#L385-L405),
a held target suppresses attacker declaration if an empty attack is legal.

Grizzly Bears therefore received no attack prompt in the reproduction.
Juggernaut's attack requirement made an empty attack illegal and forced one
prompt. After declaration, the combat-priority guard allowed interaction.
Rust has the same must-attacker exception in
[manabrew-rs/crates/manabrew-engine/src/game_loop/combat_phase.rs:46](https://github.com/witchesofthehill/manabrew/blob/033caae811c9a18d691dc6cdf9b7fc588929eb61/manabrew-rs/crates/manabrew-engine/src/game_loop/combat_phase.rs#L46-L71).
The issue's broader claim that all eligible attackers remain interactive
was not reproduced.

Full Control is a frontend preference.
[src/pixi/prompts/PromptLayerBase.ts:340](https://github.com/witchesofthehill/manabrew/blob/033caae811c9a18d691dc6cdf9b7fc588929eb61/src/pixi/prompts/PromptLayerBase.ts#L340-L353) reads it to disable the
countdown. The toggle at
[src/pixi/prompts/PromptLayer.ts:2280](https://github.com/witchesofthehill/manabrew/blob/033caae811c9a18d691dc6cdf9b7fc588929eb61/src/pixi/prompts/PromptLayer.ts#L2280-L2293) sends no engine cancellation.
A manual Pass can still create the hold under Full Control, and changing
the preference cannot interrupt an existing engine-held instruction.

## History identifies an older lifetime regression

| Change                                                                                                                                                | Relationship to this defect                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#97](https://github.com/witchesofthehill/manabrew/pull/97), June 1, `d7c0a63ec`                                                                      | The original Java instruction was consumed before a subsequent decision. It did not have the present indefinite-held form.                                                                          |
| [#280](https://github.com/witchesofthehill/manabrew/pull/280), July 2, `17f8d2565`                                                                    | Earliest responsible change identified. Replaced client-managed passing with held player/phase targets. Removed the client `passUntilTurn` lifecycle without equivalent intended-occurrence expiry. |
| [#530](https://github.com/witchesofthehill/manabrew/pull/530), July 22, `e76d944d3`                                                                   | Added an extra-turn escape, not ordinary missed-target expiry.                                                                                                                                      |
| [#581](https://github.com/witchesofthehill/manabrew/pull/581), August 3, `d8b18231d`                                                                  | Added Autopass, Full Control, extra-phase protection, and held-pass attacker suppression. Did not fix cleanup expiry.                                                                               |
| [#790](https://github.com/witchesofthehill/manabrew/pull/790), August 31, `b6b526a5e`                                                                 | Added `throughCombat` policy without target-occurrence expiry.                                                                                                                                      |
| [#1023](https://github.com/witchesofthehill/manabrew/pull/1023), September 30, `82b7e1f5b`                                                            | Moved checkpoint work to actual prompted priority. Did not change the held-target predicate or lifetime.                                                                                            |
| [#1182](https://github.com/witchesofthehill/manabrew/pull/1182) and [#1176](https://github.com/witchesofthehill/manabrew/pull/1176), November 6 and 7 | Reorganized phase controls. The missing expiry predates these UI changes.                                                                                                                           |

Before #280,
[`usePromptEffects.ts:91`](https://github.com/witchesofthehill/manabrew/blob/0119df892b2119c26a6f96787dcea9c0f1664dc3/src/hooks/usePromptEffects.ts#L87-L96)
cleared client-managed passing when `turn > passUntilTurn`.
The introducing diff establishes a missing lifetime check in the refactor,
rather than a new defect in the recent phase-control placement.
This attribution comes from source history, not a historical binary bisect.

[Issue #1170](https://github.com/witchesofthehill/manabrew/issues/1170)
reports a Rust turn-progression symptom but supplies no cleanup target or
instruction trace. It may be related; this investigation does not establish
the same cause.
[Issue #569](https://github.com/witchesofthehill/manabrew/issues/569)
concerned beginning-of-combat access for Crew. Its #581 resolution concerns
frontend passing and Full Control, not cancellation of an existing engine hold.

## Proposed fix

Keep lifetime ownership in the engine. Define a held pass as a destination
within one intended turn occurrence, and observe its lifetime even when a step
does not give priority.

1. **Bind the intended occurrence when accepting the command.** A later phase
   of the currently active target player belongs to the current turn.
   A phase at or before the current phase, or another player's phase, belongs to a future
   occurrence. Retain that distinction instead of recomputing it at each
   priority callback.
2. **Use the actual turn scheduler.** A pending future destination may span
   several intermediate players' turns. Bind it when its intended target turn
   is selected. A scheduler hook must also handle a target occurrence consumed
   by a skipped turn, without waiting forever for a turn-start priority prompt.
   Do not estimate the destination from the number of players.
3. **Complete or expire independently of priority requests.** While the bound
   occurrence is active, preserve the first legal priority at or after the
   destination phase. If that occurrence ends without one, clear the hold at
   its boundary so the next legal priority can reach the player.
4. **Preserve exceptional cleanup.** When cleanup creates priority, stop there
   and allow the engine's repeated-cleanup behavior. Do not manufacture priority
   during ordinary cleanup or remove all cleanup stops.
5. **Retain existing interruption rules in both engines.** Keep target-loss,
   extra-turn, extra-phase, stack-response, and combat protections. A new
   occurrence must not silently reuse an expired destination.

For the current UI, the engines can derive this lifetime from the existing
player/phase request. A protocol extension would be needed if a future UI
must distinguish multiple future occurrences beyond that request's meaning.
A cleanup-specific conditional or a new shared framework is not required by
this proposal.

The separate Full Control expectation needs an explicit, per-seat engine
cancellation operation that works without a pending prompt. Sending an answer
for a nonexistent prompt risks applying it to a later decision. The frontend
preference alone cannot provide cancellation.

Implementation decisions still need review: where Forge and Rust publish
turn-selection and turn-completion events, how skipped turns consume a pending
destination, and whether an expired target should notify the client. These
questions do not justify retaining a hold after its bound occurrence ends.

### Regression cases for implementation

- Two and four players, every opponent position, and self-cleanup.
  The hold must expire after ordinary target cleanup and restore the next
  normal local stop.
- Real discard triggers, state-based-action-only cleanup exceptions, and
  repeated cleanup. Preserve legal cleanup interaction.
- Default opponent End plus newly selected Cleanup. Exercise Autopass and
  manual Pass under Full Control separately.
- Toggle Full Control while a hold exists. Check engine cancellation, not
  just the preference or countdown.
- Pass from player-1's End to player-3's Main 1 across player-2, and request
  the current player's next-turn checkpoint. Do not clear on every global
  turn change or confuse current and future occurrences.
- Skipped target steps, skipped target turns, end-turn effects, target loss,
  extra turns, and inserted phases.
- Optional attackers, must-attack creatures, blockers, first-strike steps,
  and both `throughCombat` values.
- New stack objects and restore/rewind. Existing interruption behavior must
  remain intact.

Extend
[the Forge WASM autopass E2E test](../tests/e2e-ui/forge-wasm-autopass.mjs)
for both engine selections. Its present held-pass case targets the local
player's End step and checks premature prompts, not recovery from an
unreachable opponent-cleanup target.

This investigation and proposal were prepared with AI assistance and checked
against the pinned Java and Rust source and the diagnostic runs described above.
The proposed runtime policy still requires maintainer review and implementation.
