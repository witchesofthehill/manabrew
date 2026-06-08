# Foundation sim hook — STOPPED (cannot cleanly resume mid-turn)

## Decision

**No code change made.** `run_turn_state_machine` does NOT resume from
`game.turn.phase` — it unconditionally restarts the turn from Untap and re-fires
turn-start effects. Wiring `advance_from_current` to call it directly (as the task
proposed) would silently re-run untap/upkeep/draw and re-fire turn-begin triggers,
corrupting the mid-turn state the AI is trying to simulate forward from. Per the
task's explicit instruction, I stopped instead of hacking it.

## What `run_turn_state_machine` actually does

`forge-engine/crates/forge-engine/src/game_loop/phase_handler.rs:4`
(`pub(crate) fn run_turn_state_machine(&mut self, game, agents)` — no entry-phase
parameter):

1. **Unconditional turn-start work (phase_handler.rs:11-34):**
   - Applies `ReplacementEvent::BeginTurn { player: active }`; early-returns if
     `Skipped`/`Replaced` (lines 14-21).
   - `handle_player_defined_del_triggers(active)` + fires `TriggerType::TurnBegin`
     (lines 23-34).
   These are turn-START events. On a mid-turn resume they must NOT fire again, but
   the function always runs them.

2. **Hardcoded start state (phase_handler.rs:36):**
   ```rust
   let mut state = TurnMachineState::Untap;
   ```
   There is no argument and no read of `game.turn.phase`. The loop
   (`while !game.game_over && state != Done`, line 37) therefore always walks
   Untap → Upkeep → Draw → Main1 → Combat → Main2 → EndOfTurn → Cleanup → Done from
   the top, re-running untap (untaps permanents, resets mana pool — step_untap,
   lines 339+), the draw step, and every phase's `EnterPhase`/priority window.

3. The Cleanup arm calls `TurnEvent::AdvanceTurn` (phase_handler.rs:244), which
   rotates to the next player's turn — so even a "resume" that started here would
   end by advancing the turn, not by returning control at the current phase.

## Why a phase→state resume is not a minimal change

- **No enum mapping exists.** `enum TurnMachineState` (game_loop.rs:127-138) is
  `private` (not even `pub(crate)`), used only inside phase_handler.rs, and has 9
  variants with a single `Combat`. `PhaseType` (forge-foundation `phase.rs:5-19`)
  has 13 variants including SIX combat sub-phases (`CombatBegin`,
  `CombatDeclareAttackers`, `CombatDeclareBlockers`, `CombatFirstStrikeDamage`,
  `CombatDamage`, `CombatEnd`). No `From`/mapping function exists
  (`grep` for any `PhaseType::Untap =>` / `TurnMachineState::from` → none).

- **Combat is not resumable at this granularity.** `TurnMachineState::Combat`
  dispatches a single `TurnEvent::CombatStep` → `step_combat` that runs the entire
  combat phase (begin → declare attackers → declare blockers → first-strike →
  damage → end) as one atomic unit. The six `PhaseType` combat sub-phases collapse
  into that one state, so a `game.turn.phase` anywhere inside combat cannot map to
  a "resume partway through combat" entry — it would re-run all of combat.

- **Each arm entangles enter + step + priority.** Every state arm does
  `EnterPhase` (which calls `BeginPhase` replacements, `copy_last_state`,
  `set_phase`, `emit_phase_trigger`, and for Upkeep `process_suspend_upkeep`) AND
  the step AND the `PriorityWindow` in one block. There is no entry point for
  "the active player already has priority in phase X, continue from there" — so
  even resuming at the matching state would re-enter the phase and re-emit its
  Phase trigger.

## What a correct resume entry would require (not done)

1. Add an explicit entry parameter, e.g.
   `run_turn_state_machine_from(&mut self, game, agents, start: TurnMachineState)`,
   or split the BeginTurn/TurnBegin preamble (phase_handler.rs:11-34) into a
   separate `begin_turn()` so `advance_from_current` can skip it.
2. Add a `PhaseType -> TurnMachineState` mapping (collapsing the 6 combat
   sub-phases). This forces a decision about combat: either disallow resuming
   inside combat, or refactor `step_combat` into its own resumable sub-state
   machine keyed on the combat `PhaseType` so it can re-enter at the correct
   combat step.
3. Decide per-phase whether the current phase's `EnterPhase`/`emit_phase_trigger`
   should re-run on resume or be skipped (it must be skipped if the engine already
   entered that phase before the snapshot — otherwise Phase/Always triggers and
   `BeginPhase` replacements double-fire). This likely needs a finer entry that
   starts at the `PriorityWindow` of the current phase rather than its `EnterPhase`.
4. `make TurnMachineState pub(crate)` (and likely add the mapping helper) so
   `advance_from_current` can name the entry state.

This is a real engine-design change to the turn state machine, not a one-line hook,
and it has parity implications (must mirror how Java `PhaseHandler` would resume).
It needs design sign-off before implementing, so I did not write it.

## Compile

No change made, so no `cargo check` run. (The intended verification command, for
the record, is:
`CARGO_TARGET_DIR=/tmp/mb-ai cargo check -p forge-engine-core` from the manabrew
root — never the poisoned `./target` symlink.)

## Note on api-sim.md

`tmp/phaseai-port/api-sim.md` has been written by the Map phase and was read. It
documents the option of "hold your own GameLoop + GameState and call `setup` then
`run_turn` in a loop" — but `run_turn` (game_loop.rs:624) calls
`new_turn_for_player(active)` (line 644) which resets to untap, which is exactly
what the requested `advance_from_current` must avoid. The api-sim doc does not
describe any existing mid-turn resume entry; it confirms one does not exist.
