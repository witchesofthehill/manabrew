# Faithful-Port Spec — phase-ai `search.rs` + `planner/mod.rs` → forge-ai

Source: `github.com/phase-rs/phase` @ `main`, `crates/phase-ai/src/{search.rs, planner/mod.rs}`.
Target engine: manabrew `forge-engine` (Forge-DSL rules engine). Paths below cite
manabrew unless prefixed `phase:`. Both Phase modules are covered here because
`search.rs` is the decision entry point and `planner/mod.rs` is the search/eval
engine it drives — they share types (`SearchBudget`, `RankedCandidate`,
`PlannerServices`, `apply_candidate`).

---

## 0. The one structural fact that dominates the whole port

Phase's AI is built on three abstractions manabrew **does not have**, and the
entire port hinges on reproducing them as an adapter layer:

1. **A reified decision point.** Phase's `GameState` carries
   `waiting_for: WaitingFor` — an enum naming exactly what choice the engine is
   blocked on (`Priority`, `DeclareAttackers`, `DeclareBlockers`,
   `MulliganDecision`, `SearchChoice`, `TributeChoice`, `OptionalCostChoice`,
   `ChooseTarget`, `GameOver`, …). manabrew has **no equivalent** — it is
   callback-driven: the engine calls `PlayerAgent::choose_action` /
   `choose_attackers` / `choose_blockers` / `choose_targets_for` / … and the
   agent must answer synchronously (agent map api-sim §3, `agent/mod.rs:23`).

2. **A single unified action enum.** Phase's `GameAction` covers casting,
   activating, land drops, attacks, blocks, targeting, mulligan, search — every
   decision. manabrew splits this across `PlayerAction`
   (`player/actions/player_action.rs:11`), `MainPhaseAction` (`agent/types.rs:71`),
   and the per-callback return types (`Vec<(CardId, DefenderId)>` for attackers,
   `Vec<(CardId, CardId)>` for blockers, `TargetChoice`, etc.).

3. **Pure-functional apply.** Phase exposes
   `engine::game::engine::apply_as_current(&mut GameState, GameAction) -> Result`
   — applies one action to a `GameState` that *owns everything*. manabrew's
   `GameState` (`game.rs:92`) does **not** own combat, mana pools, or the trigger
   handler — those live on `GameLoop` (`mana_pools`, `combat`, `trigger_handler`,
   api-sim §2, `game_loop.rs:39-41`). There is **no** `apply(state, action)`;
   actions flow only through `GameLoop`'s priority/turn state machine.

**Consequence:** the port needs a `forge-ai` adapter providing (a) a
`Decision` enum mirroring `WaitingFor`, (b) an `AiAction` enum mirroring
`GameAction`, and (c) an `apply_ai_action(unit, action)` that mutates a bundled
`SimUnit { game: GameState, mana_pools, combat, trigger_handler }` (the four
fields of `GameSnapshot`, `game_snapshot.rs:8`) by driving the relevant
`GameLoop` step. Everything in `planner/mod.rs` is engine-agnostic *once this
adapter exists* — the search math, weights, and thresholds carry over verbatim.

---

## 1. What these modules do (the AI logic)

### `search.rs` — the decision front-end
`choose_action(state, ai_player, config, rng) -> Option<GameAction>` is the agent
entry point invoked at every decision. Flow:
- Special-cases `TributeChoice` (→ `tribute_eval::decide`) and `SearchChoice`
  (→ `deterministic_choice`).
- Otherwise: `scored = score_candidates(...)`; empty → `fallback_action`; one →
  return it; many → `softmax_select_pairs(scored, config.temperature, rng)`.
- `score_candidates` enumerates legal candidates, applies hard per-turn safety
  caps, gates+scores each with `tactical_score`, and (in search mode) adds a
  continuation score from the planner; failed simulations get `-1000.0`.
- `deterministic_choice` is the heuristic/quiescence path used for mechanical
  choices (scry/surveil/search/combat) — no randomness, beam over selections.
- `deterministic_combat_choice` answers `DeclareAttackers`/`DeclareBlockers` by
  delegating to `combat_ai` with the difficulty/archetype `AiProfile`.
- `softmax_select_pairs` does temperature-controlled stochastic selection.

### `planner/mod.rs` — the search & evaluation engine
Provides `PlannerServices` (the per-decision evaluation context with eval +
candidate caches), `SearchBudget` (node + deadline budget), the
`ContinuationPlanner` trait with `BeamContinuationPlanner` (depth-limited
alpha-beta beam search + random rollout to a quiesced leaf), three
`UtilityReducer` strategies (duel / threat-weighted / sampled-reply) selected by
`config.search.opponent_model`, and the state/utility evaluation stack
(`evaluate_with_strategy`, `utility_vector`, `quiesce`).

---

## 2. Every Phase engine type/API → manabrew equivalent

| phase symbol (file:line approx) | manabrew equivalent (file:line) | notes |
|---|---|---|
| `engine::types::game_state::GameState` | `GameState` `game.rs:92` | manabrew GS does **not** own combat/mana/triggers |
| `engine::types::game_state::WaitingFor` | **NO EQUIVALENT** | reified decision point; manabrew is callback-driven (`agent/mod.rs:23`). Must build `Decision` enum |
| `engine::types::game_state::CastOfferKind` | **NO EQUIVALENT** | cast-offer modeling; closest: `PlayCardMode` `agent/types.rs:46` |
| `engine::types::game_state::CostResume` | **NO EQUIVALENT** | interactive cost resumption state; manabrew handles via `ManaCostAction`/`decide_cost_part` callbacks |
| `engine::types::game_state::DayNight` | `GameState.is_night: bool` `game.rs:110`; `is_day()` `game.rs:462` | bool, not 3-state enum (no "neither"); see risk R5 |
| `engine::types::actions::GameAction` | **NO single enum** | split: `PlayerAction` `player_action.rs:11` + `MainPhaseAction` `agent/types.rs:71` + per-callback returns |
| `engine::types::actions::MulliganChoice` | `PlayerAgent::mulligan_decision -> bool` `agent/mod.rs:64`; London via `choose_cards_to_bottom` `:93` | bool keep/mull + serum-powder handled separately |
| `engine::types::actions::AlternativeCastDecision` | `PlayCardMode::Alternative(AlternativeCost)` `agent/types.rs:46` / `choose_alternative_cost` `agent/mod.rs:648` | |
| `engine::types::identifiers::ObjectId` | `CardId(u32)` `ids.rs:5` (`.index()` `:12`) | Phase uses one ObjectId for cards; manabrew separates `CardId`/`PlayerId` |
| `engine::types::player::PlayerId` | `PlayerId(u32)` `ids.rs:9` (`.index()` `:18`) | `pid.0` → `pid.index()` |
| `engine::types::card_type::CoreType` | `CoreType` (forge-foundation `card_type.rs`), via `Card.type_line.core_types: BTreeSet<CoreType>` `card_type.rs:153` | `is_creature()`/`is_land()` accessors `card/mod.rs:1022/1026` |
| `engine::types::counter::has_positive_counters` | derive from `Card.counters: BTreeMap<CounterType,i32>` `card/mod.rs:301`; `counter_count` `:1505` | no named helper |
| `engine::types::counter::positive_counter_entries` | iterate `Card.counters` filter `>0` | sort by `CounterType` as in phase |
| `engine::ai_support::build_decision_context -> AiDecisionContext` | **NO EQUIVALENT** | build over `GameLoop::action_space(...) -> PriorityActionSpace` `action_space.rs:125` |
| `engine::ai_support::CandidateAction` (`action`, `metadata.tactical_class`) | **NO EQUIVALENT** | wrap each entry of `PriorityActionSpace.{playable,activatable,…}` |
| `engine::ai_support::TacticalClass` | **NO EQUIVALENT** | classify candidate (Pass/Mana/Land/Attack/Block/…) from manabrew action shape |
| `engine::ai_support::legal_actions(state)` | `GameLoop::action_space(game, player, is_main_phase)` `action_space.rs:125`; combat via `get_available_attackers`/`get_available_blockers` `combat/mod.rs:1509/1519` | |
| `engine::game::engine::apply_as_current(&mut GS, action)` | **NO EQUIVALENT** | must drive `GameLoop` step on a `SimUnit`; see R1 |
| `engine::game::combat::AttackTarget` | `DefenderId` `combat/mod.rs:24` (`Player(PlayerId)`/`Permanent(CardId)`) | |
| `engine::game::combat` attackers/blockers | `CombatState` `combat/mod.rs:65` (on **GameLoop**), `combat.attackers: Vec<(CardId,DefenderId)>` `:71`, `blockers: Vec<(CardId,CardId)>` `:75` | not on GameState — see R1 |
| `GameAction::DeclareAttackers{attacks,bands}` | `PlayerAgent::choose_attackers -> Vec<(CardId,DefenderId)>` `agent/mod.rs:131`; bands ≈ `choose_damage_assignment_order` | no `bands` field; banding handled via damage order |
| `GameAction::DeclareBlockers{assignments}` | `PlayerAgent::choose_blockers -> Vec<(CardId,CardId)>` `agent/mod.rs:156` | (blocker,attacker) pairs |
| `GameAction::PlayLand` | `MainPhaseAction::Play(PlayOption)` where card is a land `agent/types.rs:71`; `PlayOption::normal` `:28` | gate via `PlayerState.lands_played_this_turn` `state.rs:27` vs `max_land_plays_per_turn` `:29` |
| `GameAction::PassPriority` | `PlayerAction::PassPriority` `player_action.rs:11` / `MainPhaseAction::Pass` | |
| `GameAction::CancelCast` / pending casts | `state.cancelled_casts`/`pending_activations` have **NO direct field**; closest: cost-payment loop callbacks (`decide_cost_part` `agent/mod.rs:973`) | see R4 |
| `GameAction::CastSpell` | `MainPhaseAction::Play(PlayOption)` `agent/types.rs:71` | |
| `GameAction::ActivateAbility` | `MainPhaseAction::ActivateAbility(CardId,usize)` `agent/types.rs:71`; ref `AbilityRef{card_id,ability_index}` `player_action.rs:27` | |
| `GameAction::UseSerumPowder` | **NO EQUIVALENT** as action; mulligan flow only via `mulligan_decision`/`choose_cards_to_bottom` | hand-name match still works (`card.card_name` `card/mod.rs:201`) |
| `engine::game::players::opponents(state, p)` | derive: iterate `game.player_order` `game.rs:117`, exclude `p` (and same `team_number` `state.rs:80`) | no named helper |
| `state.players[p.0].life` | `game.player(pid).life` `state.rs:16` via accessor `game.rs:271` | |
| player energy | `PlayerState.energy_counters` `state.rs:62` | |
| player hand/library/graveyard/battlefield/exile/command | `game.cards_in_zone(ZoneType::_, pid)` `game.rs:520` | no per-zone helpers; `creatures_on_battlefield` `:525`, `lands_on_battlefield` `:578` exist |
| `state.stack` (source_id, controller) | `GameState.stack: MagicStack` `game.rs:102` | inspect stack items for source/controller |
| `state.monarch` | `GameState.monarch: Option<PlayerId>` `game.rs:133` | |
| `state.turn_number/active_player/phase/priority_player` | `TurnState` `phase/mod.rs:145` (`:146/:147/:148/:149`) | |
| `state.lands_played_this_turn` | `PlayerState.lands_played_this_turn` `state.rs:27` | per-player in manabrew |
| `state.spells_cast_this_turn` | `PlayerState.spells_cast_this_turn` `state.rs:30` | per-player |
| `state.priority_pass_count` | **NO EQUIVALENT** | priority tracked internally by GameLoop |
| `state.next_object_id` | **NO EQUIVALENT** | manabrew ids = arena length (`cards: Vec<Card>` `game.rs:94`) |
| `state.transient_continuous_effects` / `delayed_triggers` / `restrictions` / pending flags | partial: continuous/triggers live on `GameLoop.trigger_handler` + per-card `static_abilities`/`triggers`/`replacement_effects` `card/mod.rs:368/389/416` | not a flat GS list; hashing needs a manabrew-specific surrogate (R5) |
| `ManaCost` shards+generic | `ManaCost` (forge-foundation `mana.rs:386`); `cmc()` `:505`, `generic_cost()` `:522`; `Card.mana_cost` `card/mod.rs:218` | `evaluate_card_value` uses shard count + generic |
| `Card.power()/toughness()` | `Card::power()` `card/mod.rs:988`, `toughness()` `:1000` (layered) | use these, not base fields |
| `engine::util::Deadline` (`none/after/expired`) | **NO EQUIVALENT** | tiny util to add in forge-ai (wall-clock via `web_time`) |
| `state.deck_pools` / `bracket_tier` / `CommanderBracketTier` | **NO EQUIVALENT** | deck-pool/bracket metadata; needs a forge-ai-side deck registry (R6) |
| `state.waiting_for.acting_player()` | derive from `TurnState.priority_player` `phase/mod.rs:149` (or callback's `player` arg) | |
| `apply_as_current` for combat validation | `GameLoop::step_combat` path; `CombatState::declare_attacker` `combat/mod.rs:123`, `AttackConstraints` `attack_constraints.rs:16` for legality | dry-run = clone SimUnit + attempt |

---

## 3. Faithful-port plan + Rust skeleton

> All numeric literals below are carried **verbatim** from Phase. Engine-agnostic
> bodies are filled in; engine-touching bodies are marked `// ADAPTER`.

### 3.1 Adapter layer (new — the prerequisite)

```rust
// forge-ai/src/adapter.rs

/// Bundles the four pieces that make up a simulatable unit (mirror GameSnapshot,
/// game_snapshot.rs:8). Clone = full deep copy (expensive — see R2).
#[derive(Clone)]
pub struct SimUnit {
    pub game: GameState,
    pub mana_pools: Vec<ManaPool>,
    pub combat: CombatState,
    pub trigger_handler: TriggerHandler,
}

/// Mirror of phase WaitingFor — what decision the engine is blocked on.
pub enum Decision {
    Priority { player: PlayerId, is_main: bool },
    DeclareAttackers { player: PlayerId },
    DeclareBlockers { player: PlayerId },
    Mulligan { player: PlayerId },
    SearchChoice { player: PlayerId, /* count, up_to, pool */ },
    TributeChoice { /* … */ },
    OptionalCost { player: PlayerId },
    ChooseTarget { /* … */ },
    GameOver,
}

/// Mirror of phase GameAction — unifies manabrew's split action surface.
#[derive(Clone)]
pub enum AiAction {
    Pass,
    PlayLand(CardId),
    Cast(PlayOption),
    Activate { card: CardId, ability: usize },
    DeclareAttackers(Vec<(CardId, DefenderId)>),
    DeclareBlockers(Vec<(CardId, CardId)>),
    ChooseTarget(TargetChoice),
    Mulligan(bool),
    // … extend as decisions require
}

pub struct CandidateAction {
    pub action: AiAction,
    pub tactical_class: TacticalClass,
}

#[derive(Clone, Copy, PartialEq)]
pub enum TacticalClass { Pass, Mana, Land, Attack, Block, Cast, Activate, Other }

pub struct AiDecisionContext {
    pub candidates: Vec<CandidateAction>,
    pub acting_player: PlayerId,
    pub decision: Decision,
}

/// Build candidate set from manabrew's action_space (replaces phase
/// build_decision_context). // ADAPTER
pub fn build_decision_context(unit: &SimUnit /*, loop cfg */) -> AiDecisionContext { todo!() }

/// Apply one AiAction to a SimUnit by driving the relevant GameLoop step,
/// returning Ok on success (replaces apply_as_current). // ADAPTER
pub fn apply_as_current(unit: &mut SimUnit, action: AiAction) -> Result<(), ()> { todo!() }
```

### 3.2 `SearchBudget` (planner) — verbatim, engine-agnostic except `Deadline`

```rust
pub struct SearchBudget { pub max_nodes: u32, pub nodes_evaluated: u32, deadline: Deadline }

impl SearchBudget {
    pub fn new(max_nodes: u32) -> Self {
        Self { max_nodes, nodes_evaluated: 0, deadline: Deadline::none() }
    }
    pub fn with_time_limit(max_nodes: u32, d: web_time::Duration) -> Self {
        Self::with_deadline(max_nodes, Deadline::after(d.as_millis() as u32))
    }
    pub fn with_deadline(max_nodes: u32, deadline: Deadline) -> Self {
        Self { max_nodes, nodes_evaluated: 0, deadline }
    }
    pub fn exhausted(&self) -> bool {
        self.nodes_evaluated >= self.max_nodes || self.deadline.expired()
    }
    pub fn tick(&mut self) { self.nodes_evaluated += 1; }
}
```

### 3.3 `UtilityVector` + reducers — verbatim formulas (CARRY EXACTLY)

```rust
pub struct UtilityVector {
    pub self_value: f64,
    pub opponent_pressures: Vec<f64>,
    pub elimination_bonus: f64,
    pub crackback_risk: f64,
}

pub trait UtilityReducer: Send + Sync { fn reduce(&self, v: &UtilityVector) -> f64; }

pub struct DuelUtilityReducer;
impl UtilityReducer for DuelUtilityReducer {
    fn reduce(&self, v: &UtilityVector) -> f64 { v.self_value }   // ignores all else
}

pub struct ThreatWeightedUtilityReducer;
impl UtilityReducer for ThreatWeightedUtilityReducer {
    fn reduce(&self, v: &UtilityVector) -> f64 {
        let pressure_cost = v.opponent_pressures.iter().sum::<f64>() * 0.2;
        v.self_value + v.elimination_bonus - v.crackback_risk - pressure_cost
    }
}

pub struct SampledReplyUtilityReducer;
impl UtilityReducer for SampledReplyUtilityReducer {
    fn reduce(&self, v: &UtilityVector) -> f64 {
        let pressure_cost = v.opponent_pressures.iter().sum::<f64>() * 0.15;
        v.self_value + v.elimination_bonus - v.crackback_risk - pressure_cost
    }
}
```

`utility_vector` (verbatim constants `25.0`, `10.0`, floor `0.0`):
```rust
pub fn utility_vector(&self, state: &GameState, value: &ValueEstimate) -> UtilityVector {
    let opponents = opponents_of(state, self.ai_player);          // ADAPTER (players::opponents)
    let elimination_bonus = opponents.iter()
        .filter(|&&opp| state.player(opp).life <= 0).count() as f64 * 25.0;
    let opponent_pressures: Vec<f64> = opponents.iter()
        .map(|&opp| threat_level(state, self.ai_player, opp) * 10.0).collect();
    let crackback_risk = (opponent_pressures.iter().sum::<f64>()
        - state.player(self.ai_player).life.max(0) as f64).max(0.0);
    UtilityVector { self_value: value.value, opponent_pressures, elimination_bonus, crackback_risk }
}
pub fn reduce_utility(&self, state: &GameState, value: &ValueEstimate) -> f64 {
    self.utility_reducer.reduce(&self.utility_vector(state, value))
}
```

### 3.4 `evaluate_with_strategy` / `threat_adjustment` — verbatim weights

```rust
fn evaluate_with_strategy(&self, state: &GameState) -> f64 {
    let weights = self.context.adjusted_weights.for_turn(state.turn().turn_number);
    let tactical = evaluate_state(state, self.ai_player, weights);                       // crate::eval
    let synergy = self.context.synergy_graph().board_synergy_bonus(state, self.ai_player)
        * weights.synergy;
    let zones = crate::zone_eval::zone_bonus(state, self.ai_player,
        self.context.deck_profile.archetype) * weights.zone_quality;
    let card_adv = crate::card_advantage::differential(state, self.ai_player)
        * weights.card_advantage;
    tactical + synergy + zones + card_adv + self.threat_adjustment(state)
}

fn threat_adjustment(&self, state: &GameState) -> f64 {
    // thresholds verbatim: mana<=1, counterspell>0.3, creatures>=3, board_wipe>0.2
    let mut adjustment = 0.0;
    if ai_mana <= 1 && probs.counterspell > 0.3 {
        adjustment += penalties.threat_counter_tapout_penalty * probs.counterspell;
    }
    if ai_creatures >= 3 && probs.board_wipe > 0.2 {
        adjustment += penalties.threat_wipe_overextend_penalty * probs.board_wipe;
    }
    adjustment
}
```

### 3.5 Beam search — verbatim (`0.05` bonus, ±∞ window, prune `alpha>=beta`)

```rust
pub fn build_continuation_planner(config: &AiConfig) -> Box<dyn ContinuationPlanner> {
    match config.search.planner_mode {
        PlannerMode::BeamOnly => Box::new(BeamContinuationPlanner { depth: 0, rollout_depth: 0 }),
        PlannerMode::BeamPlusRollout => Box::new(BeamContinuationPlanner {
            depth: config.search.max_depth.saturating_sub(1),
            rollout_depth: config.search.rollout_depth,
        }),
    }
}

impl BeamContinuationPlanner {
    fn search_value(&self, state: &GameState, depth: u32, mut alpha: f64, mut beta: f64,
                    services: &mut PlannerServices<'_>, budget: &mut SearchBudget) -> f64 {
        budget.tick();
        if depth == 0 { return services.rollout_estimate(state, self.rollout_depth); }
        if budget.exhausted() || is_game_over(state) { return services.evaluate_state_quiesced(state); }
        let ctx = services.build_decision_context(state);
        if ctx.candidates.is_empty() { return services.evaluate_state_quiesced(state); }
        let node_player = acting_player(state);
        let is_maximizing = node_player.is_none_or(|p| p == services.ai_player);
        let ranked = rank_candidates(ctx.candidates.clone(),
            |c| services.tactical_score(state, &ctx, c, node_player.unwrap_or(services.ai_player)),
            services.config.search.max_branching as usize);
        let mut best = if is_maximizing { f64::NEG_INFINITY } else { f64::INFINITY };
        for ranked in ranked {
            if services.deadline.expired() { break; }
            let Some(sim) = services.apply_candidate(state, &ranked.candidate) else { continue; };
            let value = self.search_value(&sim, depth - 1, alpha, beta, services, budget)
                + (ranked.score * 0.05);                               // verbatim 0.05
            if is_maximizing { best = best.max(value); alpha = alpha.max(best); }
            else             { best = best.min(value); beta  = beta.min(best);  }
            if alpha >= beta { break; }                                // verbatim prune
        }
        if best.is_infinite() { services.evaluate_state_quiesced(state) } else { best }
    }
}

impl ContinuationPlanner for BeamContinuationPlanner {
    fn evaluate_after_action(&mut self, state: &GameState,
                             services: &mut PlannerServices<'_>, budget: &mut SearchBudget) -> f64 {
        if self.depth == 0 { services.evaluate_state_quiesced(state) }
        else { self.search_value(state, self.depth, f64::NEG_INFINITY, f64::INFINITY, services, budget) }
    }
}
```

### 3.6 Rollout + quiescence — verbatim (`0.05`, `MAX_QUIESCE_STEPS=20`, cache `256`)

```rust
pub fn rollout_estimate(&mut self, state: &GameState, depth: u32) -> f64 {
    if self.deadline.expired() { return self.quiesced_leaf_eval(state); }
    if depth == 0 || is_game_over(state) { return self.quiesced_leaf_eval(state); }
    let evaluation = self.planner_evaluation(state);
    if evaluation.priors.is_empty() { return self.quiesced_leaf_eval(state); }
    let rollout_player = acting_player(state).unwrap_or(self.ai_player);
    let sample_count = self.config.search.rollout_samples.max(1) as usize;
    let mut priors = evaluation.priors;
    priors.sort_by(|a, b| b.prior.partial_cmp(&a.prior).unwrap_or(Ordering::Equal));
    let is_maximizing = rollout_player == self.ai_player;
    priors.into_iter().take(sample_count)
        .filter_map(|prior| {
            let sim = self.apply_candidate(state, &prior.candidate)?;
            Some(self.rollout_estimate(&sim, depth - 1) + (prior.prior * 0.05))  // verbatim 0.05
        })
        .reduce(|best, v| if is_maximizing { best.max(v) } else { best.min(v) })
        .unwrap_or_else(|| self.quiesced_leaf_eval(state))
}

const MAX_QUIESCE_STEPS: u32 = 20;          // verbatim
fn quiesce(&self, state: &GameState) -> GameState {
    let mut sim = state.clone();
    for _ in 0..MAX_QUIESCE_STEPS {
        if is_game_over(&sim) { break; }
        let ctx = build_decision_context(&sim);                       // ADAPTER
        if ctx.candidates.iter().all(|c| c.action.is_pass()) {        // all PassPriority
            if apply_as_current(&mut sim, AiAction::Pass).is_err() { break; } continue;
        }
        if ctx.candidates.len() == 1 {
            if apply_as_current(&mut sim, ctx.candidates[0].action.clone()).is_err() { break; } continue;
        }
        let actions: Vec<_> = ctx.candidates.iter().map(|c| c.action.clone()).collect();
        let acting = acting_player(&sim).unwrap_or(self.ai_player);
        if let Some(a) = crate::search::deterministic_choice(&sim, acting, self.config, &actions, None) {
            if apply_as_current(&mut sim, a).is_err() { break; } continue;
        }
        break;                                                        // genuine decision
    }
    sim
}
pub fn evaluate_state_quiesced(&mut self, state: &GameState) -> f64 {
    if state.stack.is_empty() || self.deadline.expired() { return self.evaluate_state_cached(state); }
    let q = self.quiesce(state); self.evaluate_state_cached(&q)
}
pub fn quiesced_leaf_eval(&mut self, state: &GameState) -> f64 {
    if state.stack.is_empty() || self.deadline.expired() {
        let v = self.evaluate_for_planner(state); return self.reduce_utility(state, &v);
    }
    let q = self.quiesce(state); let v = self.evaluate_for_planner(&q); self.reduce_utility(&q, &v)
}
pub fn evaluate_state_cached(&mut self, state: &GameState) -> f64 {
    let h = quick_state_hash(state);
    if let Some(&c) = self.eval_cache.get(&h) { return c; }
    let v = self.evaluate_with_strategy(state);
    if self.eval_cache.len() < 256 { self.eval_cache.insert(h, v); }   // verbatim 256
    v
}
```

### 3.7 `tactical_score` — verbatim per-class deltas

```rust
pub fn tactical_score(&self, state: &GameState, ctx: &AiDecisionContext,
                      candidate: &CandidateAction, scoring_player: PlayerId) -> f64 {
    let cast_facts = cast_facts_for_action(state, &candidate.action, scoring_player);
    let mut score = should_play_now_with_facts(state, &candidate.action, scoring_player, cast_facts.as_ref());
    let intent = strategic_intent(state, scoring_player);
    score += self.policies.score(&policy_ctx);
    match candidate.tactical_class {
        TacticalClass::Pass => {
            score -= 0.1;
            if matches!(intent, StrategicIntent::Develop | StrategicIntent::PushLethal) { score -= 0.15; }
        }
        TacticalClass::Mana => score -= 0.05,
        TacticalClass::Land   if matches!(intent, StrategicIntent::Develop)    => score += 0.2,
        TacticalClass::Attack if matches!(intent, StrategicIntent::PushLethal) => score += 0.3,
        TacticalClass::Block  if matches!(intent, StrategicIntent::Stabilize)  => score += 0.25,
        _ => {}
    }
    score
}
```

### 3.8 `rank_candidates`, `apply_candidate`, hashes — verbatim

```rust
pub fn rank_candidates<F: FnMut(&CandidateAction) -> f64>(
    candidates: impl IntoIterator<Item = CandidateAction>, mut scorer: F, limit: usize)
    -> Vec<RankedCandidate> {
    let mut ranked: Vec<RankedCandidate> = candidates.into_iter()
        .map(|c| RankedCandidate { score: scorer(&c), candidate: c }).collect();
    ranked.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(Ordering::Equal)); // desc
    ranked.truncate(limit); ranked
}

pub fn apply_candidate(state: &GameState, candidate: &CandidateAction) -> Option<GameState> {
    let mut sim = state.clone();
    apply_as_current(&mut sim, candidate.action.clone()).ok()?;       // ADAPTER (SimUnit, R1/R2)
    Some(sim)
}

pub fn candidate_cache_key(state: &GameState) -> u64 {
    let mut h = DefaultHasher::new();
    quick_state_hash(state).hash(&mut h);
    format!("{:?}", current_decision(state)).hash(&mut h);            // phase: state.waiting_for
    h.finish()
}
// quick_state_hash: hash turn_number, active_player, phase, priority_player,
// lands_played_this_turn, spells_cast_this_turn, day/night, monarch, command zone,
// per-player life/energy/hand-ids/library-len/graveyard-ids/mana, battlefield,
// exile-len, stack (source_id, controller), combat (attacker/blocker counts),
// and per-battlefield-object: tapped, power(), toughness(), damage, controller,
// positive counters sorted by CounterType. (Drop priority_pass_count/next_object_id
// — no manabrew equivalent; substitute arena len + GameLoop priority surrogate — R5.)
```

### 3.9 `search.rs` front-end — verbatim numbers

```rust
const MAX_ACTIVATIONS_PER_SOURCE_PER_TURN: u32 = 4;     // verbatim
const MAX_CASTS_OF_SAME_CARD_PER_TURN: usize = 3;       // verbatim

pub fn choose_action(state: &GameState, ai: PlayerId, cfg: &AiConfig, rng: &mut impl Rng)
    -> Option<AiAction> {
    match current_decision(state) {
        Decision::TributeChoice { .. } => return crate::tribute_eval::decide(/* … */),
        Decision::SearchChoice { .. }  => return deterministic_choice(state, ai, cfg, &actions, None),
        _ => {}
    }
    let scored = score_candidates(state, ai, cfg);
    let action = match scored.len() {
        0 => fallback_action(state),
        1 => Some(scored[0].0.clone()),
        _ => softmax_select_pairs(&scored, cfg.temperature, rng),     // temperature from profile
    };
    if let Some(a) = &action { emit_decision_trace(state, ai, cfg, a); }
    action
}

pub fn softmax_select_pairs(scored: &[(AiAction, f64)], temperature: f64, rng: &mut impl Rng)
    -> Option<AiAction> {
    if scored.is_empty() { return None; }
    let max_score = scored.iter().map(|(_, s)| *s).fold(f64::NEG_INFINITY, f64::max);
    let weights: Vec<f64> = scored.iter().map(|(_, s)| ((s - max_score) / temperature).exp()).collect();
    let total: f64 = weights.iter().sum();
    if total <= 0.0 || !total.is_finite() {
        return scored.iter().max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(Ordering::Equal))
            .map(|(a, _)| a.clone());
    }
    let threshold = rng.gen_range(0.0..total);
    let mut cumulative = 0.0;
    for (i, w) in weights.iter().enumerate() {
        cumulative += *w;
        if cumulative >= threshold { return Some(scored[i].0.clone()); }
    }
    Some(scored.last().unwrap().0.clone())
}

fn evaluate_card_value(state: &GameState, id: CardId) -> f64 {       // verbatim weights
    let card = state.card(id);
    let mut value = 0.0;
    if card.type_line.core_types.contains(&CoreType::Creature) {
        value += card.power() as f64 * 1.5 + card.toughness() as f64; // 1.5, +toughness
    }
    if card.type_line.core_types.contains(&CoreType::Land) { value += 3.0; }  // 3.0
    let mc = &card.mana_cost;
    let total_mana = mc.shard_count() + mc.generic_cost();            // ManaCost mana.rs:522
    value += total_mana as f64 * 0.5;                                // 0.5
    value
}

fn pick_lowest_value_sacrifices(state: &GameState, cards: &[CardId], count: usize) -> Vec<CardId> {
    let mut scored: Vec<(CardId, f64)> = cards.iter()
        .map(|&id| (id, evaluate_card_value(state, id))).collect();
    scored.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(Ordering::Equal)); // ascending
    scored.into_iter().take(count).map(|(id, _)| id).collect()
}

fn first_serum_powder_in_hand(state: &GameState, player: PlayerId) -> Option<CardId> {
    state.cards_in_zone(ZoneType::Hand, player).iter().copied()
        .find(|&id| state.card(id).card_name.eq_ignore_ascii_case("Serum Powder"))
}
```

`score_candidates` (verbatim caps + `-1000.0` fail + tactical weights `0.7`/`0.35`/`0.1`):
```rust
pub fn score_candidates(state: &GameState, ai: PlayerId, cfg: &AiConfig) -> Vec<(AiAction, f64)> {
    // filter: skip cancelled casts; skip Cast if name cast_count >= 3 this turn;
    //         skip Activate if (source,ability) pending; skip Activate if
    //         activations_this_turn(source,ability) >= 4.
    // search mode: gate+rank via tactical, truncate to branching, then
    //   score = continuation_score + tactical * tactical_weight
    //   tactical_weight = 0.7 (target_selection) | 0.35 (stack_response) | 0.1 (otherwise)
    //   if apply_candidate fails: score = score - 1000.0
    // heuristic mode: score = tactical + penalty (no continuation)
    todo!()
}
```

`deterministic_choice` (verbatim `BEAM_K = 12`):
```rust
pub(crate) fn deterministic_choice(state: &GameState, ai: PlayerId, cfg: &AiConfig,
    actions: &[AiAction], context: Option<&AiContext>) -> Option<AiAction> {
    const BEAM_K: usize = 12;                                        // verbatim
    // SearchChoice count==1 → greedy top per-card via score_search_choice_cards
    // count>1 → if cards>BEAM_K sort by score_search_choice_cards, take 12;
    //   enumerate combos (0..=count if up_to else exactly count) via local_combinations,
    //   filter selection_satisfies_constraint, score via score_search_choice_selection,
    //   sort desc, return best.
    // scry/surveil/dig → sort by evaluate_card_value, keep top half (surveil), ordered (scry).
    // combat decisions → deterministic_combat_choice.
    todo!()
}

fn local_combinations(items: &[CardId], k: usize) -> Vec<Vec<CardId>> {  // verbatim
    if k == 0 { return vec![Vec::new()]; }
    if items.len() < k { return Vec::new(); }
    if items.len() == k { return vec![items.to_vec()]; }
    let mut result = Vec::new();
    for mut combo in local_combinations(&items[1..], k - 1) { combo.insert(0, items[0]); result.push(combo); }
    result.extend(local_combinations(&items[1..], k));
    result
}
```

`validated_declare_attackers` (dry-run clone, fallback to legal):
```rust
fn validated_declare_attackers(state: &GameState, attacks: Vec<(CardId, DefenderId)>) -> AiAction {
    let candidate = AiAction::DeclareAttackers(attacks);
    let mut sim = clone_unit(state);                                  // ADAPTER (SimUnit)
    if apply_as_current(&mut sim, candidate.clone()).is_ok() { return candidate; }
    legal_actions(state).into_iter()                                  // GameLoop::action_space
        .find(|a| matches!(a, AiAction::DeclareAttackers(_)))
        .unwrap_or(AiAction::DeclareAttackers(Vec::new()))
}
```

`fallback_action`: pending-cast → cancel (after `debug_assert!(false)`); `GameOver`
→ `None`; `Priority` → `Pass`; combat → first legal declaration via
`action_space`; mulligan → serum-powder-then-keep; else first minimal legal action.

---

## 4. Dependencies on other phase-ai modules

`search.rs` and `planner/mod.rs` depend on (must be ported/stubbed first or in
tandem):

- **`crate::config`** — `AiConfig` (`search.{planner_mode, max_depth, rollout_depth,
  rollout_samples, max_branching, threat_awareness, opponent_model}`, `temperature`,
  `weights`, `archetype_multipliers`), `PlannerMode` {`BeamOnly`,`BeamPlusRollout`},
  `OpponentModel`, `ThreatAwareness` {`None`,`ArchetypeOnly`,`Full`}, `AiProfile`.
- **`crate::eval`** — `evaluate_state`, `evaluate_for_planner`, `strategic_intent`,
  `threat_level`, `StrategicIntent` {`Develop`,`PushLethal`,`Stabilize`,…}. **Core
  dependency** — all numeric board evaluation lives here.
- **`crate::policies`** — `PolicyRegistry` (`.score`, `.priors`, `.verdicts`,
  `::shared`), `PolicyContext`, `PolicyVerdict` {`Reject{reason}`,`Score{delta,reason}`},
  `PolicyId`; sub-policies `copy_value::score_legend_rule_keep`,
  `tutor::{score_search_choice_cards, score_search_choice_selection}`.
- **`crate::context`** — `AiContext` (`adjusted_weights.for_turn`, `synergy_graph`,
  `deck_profile.archetype`, `session`, `opponent_threat`); `AiContext::analyze_for_player`,
  `::empty`.
- **`crate::cast_facts`** — `cast_facts_for_action`.
- **`crate::card_hints`** — `should_play_now_with_facts`.
- **`crate::combat_ai`** — `choose_attackers_with_targets_with_profile`,
  `choose_blockers_with_profile`.
- **`crate::threat_profile`** — `build_threat_profile_multiplayer`, `ThreatProfile`,
  `ArchetypeBaseProbabilities::for_archetype`.
- **`crate::tactical_gate`** — `gate_candidates`.
- **`crate::zone_eval`** (`zone_bonus`), **`crate::card_advantage`** (`differential`),
  **`crate::tribute_eval`** (`decide`).
- **`crate::ai_support`** glue (the adapter §3.1) — `build_decision_context`,
  `CandidateAction`, `TacticalClass`, `AiDecisionContext`, `legal_actions`.

Port order: `config` → adapter (`ai_support`) → `eval` → `policies`/`context` →
`planner` → `search` → `combat_ai`/`threat_profile`/auxiliaries.

---

## 5. Risks — adaptation vs infeasibility

- **R1 (HIGH, prerequisite) — no `apply_as_current`.** Phase simulates by mutating
  a self-contained `GameState`. manabrew has no pure apply; actions only flow
  through `GameLoop`'s callback-driven state machine, and combat/mana/triggers live
  on `GameLoop` not `GameState`. The whole search depends on `apply_candidate`
  (`apply_candidate` → `apply_as_current`), called per beam node and per rollout.
  **Must build** a `SimUnit { game, mana_pools, combat, trigger_handler }` (mirror
  `GameSnapshot`, `game_snapshot.rs:8`) plus an `apply_as_current(unit, AiAction)`
  that drives the appropriate `GameLoop` substep (priority window / `step_combat`
  `game_loop/combat_phase.rs:5` / targeting). This is the single largest piece of
  net-new work and the main feasibility gate. Without a clean one-action-at-a-time
  driver, faithful search is **infeasible**; with `SimUnit` it is feasible but
  invasive.
- **R2 (HIGH) — clone cost.** `apply_candidate` clones the full unit per node.
  manabrew `GameState::clone()` is a deep copy of `Vec<Card>` (~116 fields/card with
  nested IR vectors) plus mana pools/combat/triggers (api-sim §1). Beam width
  (`max_branching`) × depth × rollout fan-out makes this far more expensive than
  Phase's leaner GS. Mitigate: small `max_branching`/`max_depth`, the time
  `Deadline`, and `set_provide_priority_action_space(false)` (`game_loop.rs:181`).
- **R3 (MED) — no reified `WaitingFor`.** `candidate_cache_key` hashes
  `format!("{:?}", state.waiting_for)`; `choose_action`/`quiesce` branch on it.
  Must synthesize a `Decision` enum from manabrew's callback context (which callback
  fired + `TurnState`). Cache-key fidelity depends on this `Decision` having a stable
  `Debug`.
- **R4 (MED) — pending-cast / cancel model.** `score_candidates` filters on
  `state.cancelled_casts` / `pending_activations`; `fallback_action` emits
  `CancelCast`. manabrew has no such GS fields — casting/cost-payment is an
  interactive callback loop (`decide_cost_part` `agent/mod.rs:973`,
  `ManaCostAction`). The per-turn caps (`4` activations, `3` casts) can be tracked
  in forge-ai state instead; the cancel path needs a manabrew-shaped substitute.
- **R5 (MED) — `quick_state_hash` field mismatch.** `priority_pass_count` and
  `next_object_id` have no manabrew equivalent; `transient_continuous_effects` /
  `delayed_triggers` / `restrictions` are not flat GS lists (they live on
  `GameLoop.trigger_handler` + per-card vectors). `DayNight` is a `bool`
  (`is_night`) not a 3-state enum. The hash must be re-derived from manabrew fields;
  it only needs to be a fast, collision-resistant fingerprint (caps at `256`
  entries), so exact field parity is not required — but it must include combat
  (which lives off-GS) for correctness.
- **R6 (LOW–MED) — deck-pool / bracket metadata.** `build_ai_context` reads
  `state.deck_pools`, `bracket_tier`, `CommanderBracketTier`, archetype multipliers
  — none exist on manabrew GS. Needs a forge-ai-side deck registry keyed by
  `PlayerId`, populated at agent construction (decks are known at
  `prepare_players`, api-sim §5).
- **R7 (LOW) — combat `bands`, attack targets.** Phase `DeclareAttackers` carries
  `bands`; manabrew has no banding field (use `choose_damage_assignment_order`).
  `AttackTarget` → `DefenderId` is clean.
- **Engine-agnostic, zero risk:** all of §3.2–3.8 search/eval math, weights,
  thresholds, the softmax, `local_combinations`, `evaluate_card_value`,
  `rank_candidates`, the reducer formulas. These port verbatim once the adapter and
  `crate::eval`/`crate::policies` exist.
