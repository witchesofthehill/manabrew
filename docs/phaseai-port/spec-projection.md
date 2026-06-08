# Port spec — `phase-ai/src/projection.rs` → `forge-ai/src/projection.rs`

Source fetched verbatim from
`https://raw.githubusercontent.com/phase-rs/phase/main/crates/phase-ai/src/projection.rs`
(684 lines, incl. ~180 lines of `#[cfg(test)]`). This spec maps it onto manabrew's
Forge-DSL engine (`forge-engine/crates/forge-engine/src`).

---

## 1. What the module does (the AI logic)

A **horizon-parameterized forward projection** primitive. Given the current
`GameState`, it clones it and advances it through the *real engine* until a
requested point ("horizon") on a specified opponent's **next** turn, then returns
the projected state so the combat-AI / eval layers can read creature
power/toughness **as it will be at attack time**, not as it is now. Phase-based
growth (Ouroboroid), attack-declaration triggers (Battle Cry, Mentor, Hellrider),
and combat-damage riders all fire "for free" because the engine itself does the
work — the AI layer reimplements no trigger effects.

Pieces:

- **`ProjectionHorizon`** — `OpponentBeginCombat` (phase growth only),
  `OpponentAttackersDeclared` (adds Battle-Cry/Mentor-style declare triggers),
  `OpponentCombatDamage` (adds first combat-damage step; v0 = no-blocks baseline).
- **`project_to(base, ai_player, target_opponent, horizon)`** — the driver. Clones
  `base`; loops up to `STEP_CAP = 256` dispatches under a `TIME_CAP = 15 ms`
  wall-clock guard; on each iteration: snapshot earlier horizons → test
  `reached_horizon` → `resolve_choice` to pick the waiting player's action →
  `apply` it. Fails *closed* (returns `BailReason`) on game-over, mulligan/sideboard,
  no-legal-action, cap exceeded, or engine rejection — caller falls back to
  pre-projection behavior.
- **`resolve_choice`** — deterministic projection **policy**: pass priority when
  possible; the *target opponent* declares the **maximum** attackers against the
  AI (pessimistic worst-case), everyone else declares none; nobody blocks (v0);
  pay first legal cost; pick **maximum** legal X (`#710`: X=0 collapsed value);
  decline optional effects (pick first). Each non-`PassPriority` decision bumps a
  `choice_count`, surfaced as `Confidence::Approximated { choice_count }`.
- **`reached_horizon`** — conjunctive predicate: phase match + active player ==
  target + empty stack + target holds priority (+ turn-advance / extra-turn guard).
- **`threat_velocity(base, projection, opponent)`** — pure read over two states:
  per opponent creature emits `Changed{delta}` (survived, power Δ),
  `Removed` (gone), or `Appeared{projected_power}` (new token). Uses the
  `OpponentBeginCombat` snapshot to isolate growth from attack-feasibility
  prohibitions (Moat).
- **`ProjectionKey`** — cache key; `turn_number` is baked in so stale entries from
  prior turns never serve a current lookup (implicit eviction).

---

## 2. Phase engine types/APIs read → manabrew equivalent

Manabrew paths relative to `forge-engine/crates/forge-engine/src` unless noted.

| Phase API (import / use) | manabrew equivalent | cite |
|---|---|---|
| `engine::types::PlayerId` | `PlayerId(u32)` | `ids.rs:9` |
| `engine::types::ObjectId` | `CardId(u32)` | `ids.rs:5` |
| `engine::types::Phase` (`BeginCombat`,`CombatDamage`,`EndCombat`) | `PhaseType` — `CombatBegin`,`CombatFirstStrikeDamage`/`CombatDamage`,`CombatEnd` | `forge-foundation/src/phase.rs:5` |
| `engine::types::CoreType::Creature` | `Card::is_creature()` (or `type_line.core_types: BTreeSet<CoreType>`) | `card/mod.rs:1022` / `forge-foundation/src/card_type.rs:153` |
| `engine::game::combat::AttackTarget` (`Player(p)`) | `DefenderId { Player(PlayerId), Permanent(CardId) }` | `combat/mod.rs:24` |
| `state.turn_number: u32` | `game.turn.turn_number` | `phase/mod.rs:146` |
| `state.active_player: PlayerId` | `game.active_player()` / `game.turn.active_player` | `game.rs:458` / `phase/mod.rs:147` |
| `state.phase: Phase` | `game.turn.phase: PhaseType` | `phase/mod.rs:148` |
| `state.stack` + `.is_empty()` | `game.stack: MagicStack`; `MagicStack::is_empty()` | `game.rs:102` / `zone/magic_stack.rs:235` |
| `state.battlefield: Vec<ObjectId>` (global) | **no global Vec** — per player: `game.cards_in_zone(ZoneType::Battlefield, pid)`, loop `game.player_order` | `game.rs:520`, `game.rs:117` |
| `state.objects.get(&id) -> Object` | `game.card(CardId) -> &Card` (arena indexed by `.index()`) | `game.rs:263` |
| `obj.controller: PlayerId` | `Card::controller` | `card/mod.rs:209` |
| `obj.power: Option<i32>` (`.unwrap_or(0)`) | `Card::power() -> i32` (layered; already non-optional) | `card/mod.rs:988` |
| `obj.card_types.core_types.contains(Creature)` | `Card::is_creature()` | `card/mod.rs:1022` |
| `GameState::clone()` | `GameState: Clone` — **but full sim unit also needs** `mana_pools`/`combat`/`trigger_handler` → mirror `GameSnapshot::capture` | `game.rs:91`; `game_snapshot.rs:16` |
| `web_time::{Duration, Instant}` | same crate (wasm-safe); already a workspace dep pattern | n/a |
| **`engine::game::engine::apply(&mut state, actor, action) -> Result<(),EngineError>`** | **NO EQUIVALENT** — no single-step reducer | — |
| **`engine::ai_support::legal_actions(state) -> Vec<GameAction>`** | **NO unified equivalent** — closest is `GameLoop::action_space(game, player, is_main_phase) -> PriorityActionSpace` (priority window only) | `game_loop/action_space.rs:125` |
| **`engine::types::GameAction`** (`PassPriority`,`DeclareAttackers{attacks}`,`DeclareBlockers{assignments}`,…) | **split & not unified** — priority via `PlayerAction` enum; combat via `PlayerAgent::choose_attackers`/`choose_blockers` return values | `player/actions/player_action.rs:11`; `agent/mod.rs:131,156` |
| **`engine::types::WaitingFor`** (`Priority{player}`,`DeclareAttackers`,`DeclareBlockers`,`PayCost`,`ManaPayment`,`ChooseXValue`,`OptionalEffectChoice`,`MulliganDecision`,`GameOver`,…) + `.acting_player()` | **NO EQUIVALENT** — engine is **push-based**: no reified "what is the engine blocked on" state. Pieces only: priority holder `game.turn.priority_player`; game-over `game.game_over`/`game.winner`; decision *kind* is implicit in **which `PlayerAgent` callback** fires | `phase/mod.rs:149`; `game.rs:120,121` |
| `engine::types::PayCostKind` | `cost::CostPart` enum (no `WaitingFor` reification) | `cost/mod.rs:234` |
| `state.creatures_attacked_this_turn` | **no global set on GameState** — use `game.turn.combat_attackers_declared: bool`, or scan `Card::attacked_this_turn` | `phase/mod.rs:153`; `card/mod.rs:383` |
| `state.waiting_for == WaitingFor::GameOver` | `game.game_over: bool` | `game.rs:120` |

**Flagged (no/weak equivalent):** `apply`, `legal_actions`, `GameAction`,
`WaitingFor` (+`acting_player`), `PayCostKind` reification, global
`battlefield`/`objects` collections, global `creatures_attacked_this_turn`.
These are the load-bearing differences — see §5.

---

## 3. Faithful-port plan + Rust skeleton

**Architecture decision.** Phase-rs is a *pull-based reducer*: inspect
`waiting_for`, enumerate `legal_actions`, pick one, `apply`, repeat. Manabrew is a
*push-based driver*: `GameLoop::run_turn` runs a whole turn and **calls back** into
`Box<dyn PlayerAgent>` for every decision. There is no single-step `apply` and no
inspectable `WaitingFor`. Therefore `project_to`/`resolve_choice` **cannot be
ported line-for-line**; the faithful equivalent is:

1. **A scripted `ProjectionAgent: PlayerAgent`** installed on every seat that
   encodes `resolve_choice`'s policy, redistributed across the relevant callbacks,
   plus a shared `choice_count` and a shared `abort` flag.
2. **A thin `GameLoop::run_until(predicate)` driver** added to forge-engine — the
   honest minimal analogue of phase-rs's `apply`-loop. It runs the existing turn
   state machine but checks `predicate(game)` at each priority window (and after
   each `run_turn`) and stops via `abort_signal`, leaving the engine parked at the
   horizon so the projected state can be cloned out. (Capturing precisely at the
   priority window otherwise has no hook — `choose_action` is not handed `&GameState`;
   `snapshot_state(&GameState,…)` is the only state-observation callback and its
   cadence must be confirmed. `run_until` is cleaner and is the recommended path.)

The **data types, `reached_horizon`, `capture_snapshots`, and `threat_velocity`
port verbatim** (only accessor remapping). All caps/weights/formulas are carried
over unchanged.

```rust
// forge-ai/src/projection.rs
use std::collections::{HashMap, HashSet};
use web_time::{Duration, Instant};

use forge_engine::ids::{CardId, PlayerId};
use forge_engine::combat::DefenderId;            // == phase AttackTarget
use forge_engine::game::GameState;
use forge_engine::phase::PhaseType;              // forge-foundation
use forge_engine::zone::ZoneType;                // forge-foundation

// ---- Data types: VERBATIM (renamed ObjectId->CardId) ----------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ProjectionHorizon {
    OpponentBeginCombat,
    OpponentAttackersDeclared,
    OpponentCombatDamage,
}

#[derive(Debug, Clone)]
pub enum BailReason {
    StepCapExceeded { steps: u32 },
    TimeCapExceeded { elapsed: Duration },
    GameOverDuringProjection,
    MulliganOrSideboardEncountered,
    NoLegalAction { waiting_for: String },
    NoLegalManaPayment,
    EngineRejected(String),                       // phase EngineError -> String
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VelocitySample {
    Changed { delta: i32 },
    Removed,
    Appeared { projected_power: i32 },
}

#[derive(Debug, Clone, Copy)]
pub enum Confidence {
    Exact,
    Approximated { choice_count: u32 },
}

#[derive(Debug, Clone)]
pub struct Projection {
    pub horizon_reached: ProjectionHorizon,
    pub state: GameState,
    pub snapshots: Vec<(ProjectionHorizon, GameState)>,
    pub confidence: Confidence,
    pub target_opponent: PlayerId,
}

impl Projection {
    pub fn snapshot(&self, horizon: ProjectionHorizon) -> Option<&GameState> {
        self.snapshots.iter().find(|(h, _)| *h == horizon).map(|(_, s)| s)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ProjectionKey {
    pub state_hash: u64,
    pub turn_number: u32,
    pub active_player: PlayerId,
    pub ai_player: PlayerId,
    pub target_opponent: PlayerId,
    pub horizon: ProjectionHorizon,
}

// ---- Caps: carried over VERBATIM ------------------------------------------
const STEP_CAP: u32 = 256;
const TIME_CAP: Duration = Duration::from_millis(15);

// ---- reached_horizon: VERBATIM logic, accessors remapped ------------------
fn reached_horizon(
    game: &GameState,
    target_opponent: PlayerId,
    horizon: ProjectionHorizon,
    started_turn: u32,
) -> bool {
    if game.active_player() != target_opponent {        // state.active_player
        return false;
    }
    let started_on_this_opp = game.turn.turn_number == started_turn;
    // priority held by target == phase-rs `WaitingFor::Priority { player == target }`
    // (weakened: manabrew has no decision-kind on the priority holder)
    let priority_ok = game.turn.priority_player == target_opponent;
    match horizon {
        ProjectionHorizon::OpponentBeginCombat => {
            if game.turn.phase != PhaseType::CombatBegin { return false; }
            if !game.stack.is_empty() { return false; }
            priority_ok && (!started_on_this_opp || is_fresh_begin_combat(game))
        }
        ProjectionHorizon::OpponentAttackersDeclared => {
            // phase `creatures_attacked_this_turn.is_empty()` -> combat flag
            if !game.turn.combat_attackers_declared { return false; }
            if !game.stack.is_empty() { return false; }
            priority_ok
        }
        ProjectionHorizon::OpponentCombatDamage => {
            matches!(
                game.turn.phase,
                PhaseType::CombatDamage | PhaseType::CombatFirstStrikeDamage | PhaseType::CombatEnd
            ) && game.stack.is_empty() && priority_ok
        }
    }
}

fn is_fresh_begin_combat(_game: &GameState) -> bool { true }   // VERBATIM

// ---- capture_snapshots: VERBATIM ------------------------------------------
fn capture_snapshots(
    game: &GameState,
    target_opponent: PlayerId,
    started_turn: u32,
    snapshots: &mut Vec<(ProjectionHorizon, GameState)>,
) {
    if reached_horizon(game, target_opponent, ProjectionHorizon::OpponentBeginCombat, started_turn)
        && !snapshots.iter().any(|(h, _)| *h == ProjectionHorizon::OpponentBeginCombat)
    {
        snapshots.push((ProjectionHorizon::OpponentBeginCombat, game.clone()));
    }
    if reached_horizon(game, target_opponent, ProjectionHorizon::OpponentAttackersDeclared, started_turn)
        && !snapshots.iter().any(|(h, _)| *h == ProjectionHorizon::OpponentAttackersDeclared)
    {
        snapshots.push((ProjectionHorizon::OpponentAttackersDeclared, game.clone()));
    }
}

// ---- threat_velocity: VERBATIM logic; global battlefield -> per-player -----
pub fn threat_velocity(
    base: &GameState,
    projection: &Projection,
    opponent: PlayerId,
) -> HashMap<CardId, VelocitySample> {
    let projected = projection
        .snapshot(ProjectionHorizon::OpponentBeginCombat)
        .unwrap_or(&projection.state);

    let mut samples: HashMap<CardId, VelocitySample> = HashMap::new();
    let mut base_seen: HashSet<CardId> = HashSet::new();

    // Pass 1: creatures present in base -> Changed or Removed.
    for &pid in &base.player_order {
        for &id in base.cards_in_zone(ZoneType::Battlefield, pid) {
            let bc = base.card(id);
            if bc.controller != opponent || !bc.is_creature() { continue; }
            base_seen.insert(id);
            let base_power = bc.power();                 // .unwrap_or(0) -> power()
            let still_on_bf = projected
                .cards_in_zone(ZoneType::Battlefield, opponent)
                .contains(&id);
            if still_on_bf {
                let proj_power = projected.card(id).power();
                samples.insert(id, VelocitySample::Changed { delta: proj_power - base_power });
            } else {
                samples.insert(id, VelocitySample::Removed);
            }
        }
    }

    // Pass 2: new creatures in projection not in base -> Appeared.
    for &id in projected.cards_in_zone(ZoneType::Battlefield, opponent) {
        if base_seen.contains(&id) { continue; }
        let pc = projected.card(id);
        if pc.controller != opponent || !pc.is_creature() { continue; }
        samples.insert(id, VelocitySample::Appeared { projected_power: pc.power() });
    }

    samples
}

// ---- project_to: RE-ARCHITECTED (push-based) ------------------------------
// Faithful intent preserved; mechanism changed from apply-loop to run_until.
pub fn project_to(
    base_game: &GameState,
    base_loop: &GameLoopSideState,   // mana_pools+combat+trigger_handler clone unit
    ai_player: PlayerId,
    target_opponent: PlayerId,
    horizon: ProjectionHorizon,
) -> Result<Projection, BailReason> {
    let started_turn = base_game.turn.turn_number;
    let started_at = Instant::now();
    let mut game = base_game.clone();
    let mut snapshots: Vec<(ProjectionHorizon, GameState)> = Vec::new();

    if reached_horizon(&game, target_opponent, horizon, started_turn) {
        return Ok(Projection {
            horizon_reached: horizon,
            state: game.clone(),
            snapshots: vec![(horizon, game)],
            confidence: Confidence::Exact,
            target_opponent,
        });
    }

    // Build the sim unit (GameLoop + scripted agents) and run until horizon.
    let mut game_loop = base_loop.rebuild_loop();        // mirror GameSnapshot fields
    game_loop.set_provide_priority_action_space(false);
    install_deterministic_rng(&mut game_loop, /*seed=*/ fingerprint(base_game));
    let abort = Arc::new(AtomicBool::new(false));
    game_loop.set_abort_signal(abort.clone());

    let choice_count = Arc::new(AtomicU32::new(0));
    let bail = Arc::new(Mutex::new(None::<BailReason>));
    let mut agents: Vec<Box<dyn PlayerAgent>> = base_game.player_order.iter().map(|&pid| {
        Box::new(ProjectionAgent::new(
            pid, ai_player, target_opponent,
            choice_count.clone(), abort.clone(), bail.clone(),
        )) as Box<dyn PlayerAgent>
    }).collect();

    // run_until: thin driver added to forge-engine. Stops (sets abort) the
    // first time `predicate(game)` holds at a priority window, parking `game`
    // there. Captures earlier-horizon snapshots along the way.
    let mut rng = seeded_rng(fingerprint(base_game));
    let reached = game_loop.run_until(
        &mut game, &mut agents, &mut rng, started_at, TIME_CAP, STEP_CAP,
        &mut |g| capture_snapshots(g, target_opponent, started_turn, &mut snapshots),
        &mut |g| reached_horizon(g, target_opponent, horizon, started_turn),
    );

    if let Some(reason) = bail.lock().unwrap().take() { return Err(reason); }
    match reached {
        RunUntilOutcome::Reached => {
            capture_snapshots(&game, target_opponent, started_turn, &mut snapshots);
            let cc = choice_count.load(Ordering::SeqCst);
            let confidence = if cc == 0 { Confidence::Exact }
                             else { Confidence::Approximated { choice_count: cc } };
            Ok(Projection { horizon_reached: horizon, state: game, snapshots, confidence, target_opponent })
        }
        RunUntilOutcome::GameOver       => Err(BailReason::GameOverDuringProjection),
        RunUntilOutcome::TimeCap(d)     => Err(BailReason::TimeCapExceeded { elapsed: d }),
        RunUntilOutcome::StepCap        => Err(BailReason::StepCapExceeded { steps: STEP_CAP }),
    }
}
```

### `ProjectionAgent` — `resolve_choice` policy redistributed (weights VERBATIM)

```rust
struct ProjectionAgent {
    seat: PlayerId,
    ai_player: PlayerId,
    target_opponent: PlayerId,
    choice_count: Arc<AtomicU32>,
    abort: Arc<AtomicBool>,
    bail: Arc<Mutex<Option<BailReason>>>,
}

impl PlayerAgent for ProjectionAgent {
    // WaitingFor::MulliganDecision / *Sideboard / *ChoosePlayDraw -> bail closed.
    fn mulligan_decision(&mut self, _p: PlayerId, _hand: &[CardId], _n: u32) -> bool {
        *self.bail.lock().unwrap() = Some(BailReason::MulliganOrSideboardEncountered);
        self.abort.store(true, Ordering::SeqCst);
        false
    }

    // WaitingFor::Priority -> pick_pass_or_first : PASS. (PassPriority never
    // counts as a policy choice -> choice_count unchanged.)
    fn choose_action(
        &mut self, _p: PlayerId,
        _space: Option<&PriorityActionSpace>,
        _req: &mut dyn FnMut() -> PriorityActionSpace,
    ) -> PlayerAction {
        PlayerAction::PassPriority
    }

    // WaitingFor::DeclareAttackers:
    //   target_opponent -> pick_max_attackers_against(ai_player): attack with
    //     EVERY available creature, each at the AI (pessimistic worst-case).
    //   AI self / other opponent -> pick_empty_attackers: none.
    fn choose_attackers(
        &mut self, _p: PlayerId,
        available: &[CardId], possible_defenders: &[DefenderId],
    ) -> Vec<(CardId, DefenderId)> {
        if self.seat != self.target_opponent { return Vec::new(); }
        let ai_def = possible_defenders.iter()
            .find(|d| matches!(d, DefenderId::Player(p) if *p == self.ai_player))
            .copied();
        let Some(ai_def) = ai_def else { return Vec::new(); };
        if !available.is_empty() {
            self.choice_count.fetch_add(1, Ordering::SeqCst);   // non-pass policy choice
        }
        available.iter().map(|&c| (c, ai_def)).collect()
    }

    // WaitingFor::DeclareBlockers -> pick_empty_blockers: v0 no-blocks.
    fn choose_blockers(
        &mut self, _p: PlayerId,
        _attackers: &[CardId], _avail: &[CardId], _max: Option<usize>,
    ) -> Vec<(CardId, CardId)> { Vec::new() }

    // WaitingFor::ChooseXValue -> actions.last() == max legal X (#710).
    // Default impl already returns max_x -> faithful; override only to count it.
    fn choose_x_value(&mut self, _p: PlayerId, max_x: u32, _src: CardId) -> u32 {
        if max_x > 0 { self.choice_count.fetch_add(1, Ordering::SeqCst); }
        max_x
    }

    // ManaPayment / PayCost(ReturnToHand|Behold|TapCreatures) / ChooseManaColor
    // / Phyrexian / CombatTax / Unless / Alternative... -> "first legal payment".
    fn pay_mana_cost(&mut self, /* … */) -> ManaCostAction { ManaCostAction::Pay { auto: true } }
    fn decide_cost_part(
        &mut self, _p: PlayerId, _src: CardId, _part: &CostPart, _g: &GameState,
    ) -> Option<PaymentDecision> { /* first legal; None for mandatory-but-unpayable -> bail */ }

    // OptionalEffectChoice / OpponentMayChoice / OptionalCostChoice / Tribute /
    // CompanionReveal -> "pick first == usually decline".
    fn choose_optional_trigger(&mut self, /* … */) -> bool { false }
    fn confirm_action(&mut self, /* … */) -> bool { false }

    // All remaining choose_* default to "first legal action" (PlayerAgent
    // defaults already select the first/None option for most).
}
```

Helper functions `pick_pass_or_first`, `pick_empty_attackers`,
`pick_empty_blockers`, `pick_max_attackers_against` from phase-rs **do not survive
as standalone fns** (they filtered a `Vec<GameAction>` candidate set that manabrew
never materializes for combat). Their *intent* is inlined into the callbacks above.

---

## 4. Dependencies on other phase-ai modules

**None.** `projection.rs` imports only the `engine` crate + `std`/`web_time`/`HashMap`.
It is a **foundational leaf** of phase-ai: the doc-comment states it is *consumed
by* `combat_ai` and `eval` (via `project_to` / `threat_velocity` / `Projection`),
not the other way around. Port this module **first** — `combat_ai` and `eval`
specs will depend on its public surface (`Projection`, `ProjectionHorizon`,
`VelocitySample`, `threat_velocity`, `project_to`, `ProjectionKey`).

New manabrew-side dependency introduced by the port: a `GameLoop::run_until(...)`
driver (see §5) and the `GameSnapshot` clone unit (`game_snapshot.rs:8,16`) for the
full sim state.

---

## 5. Risks — adaptation vs infeasible

**Infeasible as written / requires re-architecture (the core risk):**

- **No single-step `apply` + no `WaitingFor` + no unified `legal_actions`/`GameAction`.**
  Phase-rs's whole `project_to` loop (inspect `waiting_for` → enumerate
  `legal_actions` → pick → `apply`) has no manabrew counterpart — manabrew is
  push-based (`GameLoop::run_turn` calls agent callbacks). **Mitigation:** the
  scripted-`ProjectionAgent` + `GameLoop::run_until(predicate)` design in §3. The
  *policy* (weights/thresholds/decisions) ports faithfully; the *control flow* is
  necessarily different. `run_until` is a **new ~40-line engine addition** (wraps
  the existing turn state machine + `abort_signal`); flag for engine-owner review
  per AGENTS "extend before creating".

- **State capture at the exact horizon.** `choose_action` is not given `&GameState`,
  so the agent can't clone the state at the priority window unaided. Options:
  (a) `run_until` checks the predicate engine-side and parks the loop (recommended);
  (b) capture in `snapshot_state(&GameState,…)` — only viable if its cadence brackets
  the BeginCombat priority window (must be verified against
  `game_loop.rs:624`/`phase_handler.rs`). Without one of these the projection
  cannot be read out faithfully.

**Adaptation needed (feasible, behavior-preserving):**

- **`creatures_attacked_this_turn`** has no global GameState set; mapped to
  `game.turn.combat_attackers_declared: bool` (`phase/mod.rs:153`). Semantics differ
  slightly (flag = "declaration happened" vs set membership) but the predicate
  ("attackers exist") is equivalent for the horizon test. Alternative: scan
  `Card::attacked_this_turn` (`card/mod.rs:383`).

- **`WaitingFor::Priority { player }` weakened** to `priority_player == target`.
  Manabrew can't statically distinguish "priority window" from "mid-declaration"
  by inspecting the holder; combined with `stack.is_empty()` + phase match this is
  a faithful approximation but is a known soft spot.

- **`pick_max_attackers_against`** changes shape: phase-rs filters a precomputed
  candidate enumeration; manabrew constructs the attack set in `choose_attackers`
  ("attack with all available at the AI"). Same intent (worst-case max attackers);
  legality of each attacker is enforced by the engine's later `validate`/constraints
  (`combat/attack_constraints.rs`), so over-declaring is safe.

- **Clone cost vs `TIME_CAP = 15 ms`.** Manabrew `GameState::clone()` is a heavy
  deep copy (`Vec<Card>`, ~116 fields each w/ IR sub-vectors — api-sim §1), **plus**
  `mana_pools`/`combat`/`trigger_handler` (`GameSnapshot`). A single clone on a
  large board may approach/exceed 15 ms, where phase-rs's clone is presumably
  cheaper. The 15 ms cap is carried over **verbatim** but should be revisited after
  measuring; failing closed (the cap's purpose) still holds.

- **Determinism.** `project_to` advertises determinism; manabrew's default
  `game_rng` is `ThreadRngAdapter` (non-deterministic) and `run_turn` takes
  `rng: &mut impl Rng`. The port must install a deterministic seeded RNG
  (`set game_rng` + seeded `StdRng`) keyed off the base-state fingerprint, else
  shuffles/coin-flips during projection diverge.

- **`EngineError` → `String`.** No structured engine error type crosses the
  callback boundary; `BailReason::EngineRejected` carries a `String`.

**Low risk / verbatim:** data types, `reached_horizon`, `capture_snapshots`,
`threat_velocity`, `STEP_CAP=256`, `TIME_CAP=15ms`, `ProjectionKey` (turn-in-key
invalidation). The phase-rs unit tests translate directly (manabrew has
`GameState::new`/zone helpers; `create_object` → token/card instantiation).
```
