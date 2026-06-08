# Faithful-Port Spec — phase-ai `config.rs`, `context.rs`, `session.rs`

Port target crate: **`forge-engine/crates/forge-ai/`** (already exists; in-process AI that
clones `GameState` to look ahead; already credits phase-ai Apache-2.0 in `lib.rs` /
`THIRD-PARTY-NOTICES.md`). It depends on `forge_engine_core` (= the `forge-engine`
package) and `forge_foundation`. New files: `forge-ai/src/config.rs`,
`forge-ai/src/context.rs`, `forge-ai/src/session.rs`, registered in `forge-ai/src/lib.rs`.

Source fetched verbatim from `https://raw.githubusercontent.com/phase-rs/phase/main/crates/phase-ai/src/{config,context,session}.rs` (main, 2026-06-08).

Throughout, "Phase engine" = `phase`'s `engine` crate; "manabrew" = `forge_engine_core`.

---

## A. `config.rs`

### A.1 What it does
Pure configuration/preset module — **no game logic, no engine reads at runtime**. It defines:
- The single global wall-clock search budget constant.
- The difficulty enum (`AiDifficulty`, 6 tiers) + label parser.
- Search/algorithm config structs (`SearchConfig`, `PlannerMode`, `OpponentModel`,
  `ThreatAwareness`, `Platform`).
- The behavioural `AiProfile` (risk/patience/stabilize) and its archetype modulation.
- The full tunable `PolicyPenalties` weight bag (40 `f64` knobs, CMA-ES trainable, serde).
- The six difficulty presets (`create_config`) + WASM budget reduction + multiplayer
  ("paranoid") budget scaling (`create_config_for_players`).

This module is the lowest-risk of the three: it is **engine-agnostic** apart from sibling
phase-ai modules. Every number must be carried over verbatim.

### A.2 Engine types it reads → manabrew equivalent
**None from the engine.** Its only non-std imports are sibling phase-ai modules:

| Phase import | manabrew status |
|---|---|
| `crate::deck_profile::ArchetypeMultipliers` | sibling phase-ai module — port separately (NOT yet in forge-ai) |
| `crate::eval::{EvalWeightSet, KeywordBonuses}` | sibling — forge-ai currently has a flat `EvalWeights` (eval.rs); `EvalWeightSet { early, mid, late }` + `KeywordBonuses` + `EvalWeightSet::learned()` do NOT exist yet → dependency, see §A.5 |
| `crate::strategy_profile::StrategyProfile` | sibling — port separately |
| `serde::{Deserialize, Serialize}` | available |

No `GameState`/`PlayerId`/`Card` reads at all. Safe to port byte-for-byte once the three
sibling types exist (they can start as the structs phase defines).

### A.3 Faithful-port skeleton (carry verbatim)

```rust
use serde::{Deserialize, Serialize};

use crate::deck_profile::ArchetypeMultipliers;
use crate::eval::{EvalWeightSet, KeywordBonuses};
use crate::strategy_profile::StrategyProfile;

/// Single source of truth for the wall-clock search budget.
pub const AI_SEARCH_TIME_BUDGET_MS: Option<u32> = Some(1500);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ThreatAwareness {
    #[default]
    None,           // VeryEasy, Easy
    ArchetypeOnly,  // Medium
    Full,           // Hard, VeryHard, CEDH
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum AiDifficulty { VeryEasy, Easy, Medium, Hard, VeryHard, CEDH }

impl AiDifficulty {
    pub fn from_label(label: &str) -> AiDifficulty {
        match label.trim().to_lowercase().as_str() {
            "veryeasy" => AiDifficulty::VeryEasy,
            "easy" => AiDifficulty::Easy,
            "medium" => AiDifficulty::Medium,
            "hard" => AiDifficulty::Hard,
            "veryhard" => AiDifficulty::VeryHard,
            "cedh" => AiDifficulty::CEDH,
            _ => AiDifficulty::Medium,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform { Native, Wasm }

#[derive(Debug, Clone)]
pub struct SearchConfig {
    pub enabled: bool,
    pub max_depth: u32,
    pub max_nodes: u32,
    pub max_branching: u32,
    pub planner_mode: PlannerMode,
    pub rollout_depth: u32,
    pub rollout_samples: u32,
    pub opponent_model: OpponentModel,
    pub time_budget_ms: Option<u32>,
    pub deterministic: bool,
    pub threat_awareness: ThreatAwareness,
    pub projection_min_budget_ms: u128,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlannerMode { BeamOnly, BeamPlusRollout }

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpponentModel { DeterministicBestReply, ThreatWeightedReply, SampledReply }

#[derive(Debug, Clone)]
pub struct AiProfile {
    pub risk_tolerance: f64,
    pub interaction_patience: f64,
    pub stabilize_bias: f64,
}

impl AiProfile {
    pub fn with_strategy(&self, strategy: &StrategyProfile) -> AiProfile {
        AiProfile {
            risk_tolerance: (self.risk_tolerance * strategy.risk_tolerance_mult).clamp(0.2, 1.0),
            interaction_patience: (self.interaction_patience * strategy.interaction_patience_mult)
                .clamp(0.1, 1.0),
            stabilize_bias: (self.stabilize_bias * strategy.stabilize_bias_mult).clamp(0.5, 2.0),
        }
    }
}

impl Default for AiProfile {
    fn default() -> Self {
        Self { risk_tolerance: 0.6, interaction_patience: 0.75, stabilize_bias: 1.0 }
    }
}

impl Default for SearchConfig {
    fn default() -> Self {
        SearchConfig {
            enabled: false, max_depth: 0, max_nodes: 0, max_branching: 5,
            planner_mode: PlannerMode::BeamOnly, rollout_depth: 0, rollout_samples: 0,
            opponent_model: OpponentModel::DeterministicBestReply,
            time_budget_ms: AI_SEARCH_TIME_BUDGET_MS, deterministic: false,
            threat_awareness: ThreatAwareness::None, projection_min_budget_ms: 2000,
        }
    }
}
```

**`PolicyPenalties`** — 40 `f64` fields, all `#[serde(default = "...")]` from
`gift_*`/`lethality_*` onward. Carry the struct, the `Default` impl, and **every**
`default_*()` fn verbatim. The exact default values (must match byte-for-byte):

```
redundant_removal_penalty: -6.0      redundant_damage_penalty: -4.0
gift_card_penalty: -3.0              gift_treasure_penalty: -1.5
gift_food_penalty: -1.0             gift_fish_penalty: -0.5
worthy_target_threshold: 3.0        overkill_base_penalty: -2.0
removal_quality_mismatch: -1.5      bounce_token_bonus: 3.0
bounce_cheap_discount: -2.0         bounce_expensive_bonus_per_mv: 0.3
indestructible_destroy_penalty: -8.0 ward_cost_penalty_base: -2.0
pump_response_bonus: 2.5            lethal_burn_bonus: 15.0
protect_spell_bonus_mult: 0.75
-- serde-defaulted (default_* fns) --
lethality_tapout_penalty: -2.5      sacrifice_land_penalty: 4.0
sacrifice_token_cost: 0.5           evasion_removal_bonus_mult: 0.4
recursion_destroy_penalty: -1.5     recursion_exile_bonus: 1.0
death_trigger_destroy_penalty: -0.5 wrath_overextend_penalty: -0.4
low_life_defensive_bonus: 0.3       low_life_aggro_penalty: -0.3
card_advantage_behind_extra: 0.15   counter_last_reservation_penalty: -1.5
tempo_curve_bonus: 0.3              synergy_casting_bonus: 0.25
threat_counter_tapout_penalty: -1.5 threat_wipe_overextend_penalty: -0.6
combo_progress_this_turn_bonus: 15.0 combo_progress_next_turn_bonus: 5.0
```
(Field order, doc comments, and the `Default` impl referencing the `default_*()` fns are
all part of the verbatim port.)

**`AiConfig`** struct + `Default` (= `create_config(Medium, Native)`).

**`create_config(difficulty, platform)`** — carry the full 6-arm `match` verbatim. Per-tier
table (temperature, profile {risk, patience, stabilize}, play_lookahead, combat_lookahead,
search {enabled, max_depth, max_nodes, max_branching, planner_mode, rollout_depth,
rollout_samples, opponent_model, threat_awareness, projection_min_budget_ms}):

| tier | temp | risk/pat/stab | play_la | combat_la | en | depth | nodes | branch | planner | r_depth | r_samp | opp_model | threat | proj_min |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| VeryEasy | 4.0 | 0.9/0.2/0.8 | F | F | F | 0 | 0 | 5 | BeamOnly | 0 | 0 | DetBestReply | None | 0 |
| Easy | 2.0 | 0.8/0.4/0.9 | T | F | F | 0 | 0 | 5 | BeamOnly | 0 | 0 | DetBestReply | None | 0 |
| Medium | 1.0 | 0.65/0.7/1.0 | T | F | T | 2 | 24 | 5 | BeamPlusRollout | 1 | 1 | DetBestReply | ArchetypeOnly | 2000 |
| Hard | 0.5 | 0.55/0.9/1.1 | T | F | T | 3 | 48 | 5 | BeamPlusRollout | 2 | 1 | ThreatWeighted | Full | 2000 |
| VeryHard | 0.3 | 0.45/1.0/1.2 | T | F | T | 3 | 64 | 5 | BeamPlusRollout | 2 | 2 | ThreatWeighted | Full | 2000 |
| CEDH | 0.2 | 0.4/1.0/1.2 | T | **T** | T | 3 | 96 | 5 | BeamPlusRollout | 2 | 2 | ThreatWeighted | Full | 1500 |

All arms set `time_budget_ms: AI_SEARCH_TIME_BUDGET_MS` and `deterministic: false`.
After the match, build `AiConfig` with `weights: EvalWeightSet::learned()`,
`keyword_bonuses: KeywordBonuses::default()`,
`archetype_multipliers: ArchetypeMultipliers::default()`,
`policy_penalties: PolicyPenalties::default()`, `player_count: 2`.

**WASM reduction** (verbatim, applied after build when `platform == Wasm`):
```rust
config.search.max_depth = config.search.max_depth.min(2);
config.search.max_nodes = config.search.max_nodes * 2 / 3;
config.search.rollout_depth = config.search.rollout_depth.min(2);
```

**`AiConfig::into_deterministic`** — sets `search.deterministic = true`.

**`create_config_for_players(difficulty, platform, player_count)`** — carry verbatim:
```rust
let mut config = create_config(difficulty, platform);
config.player_count = player_count;
match player_count {
    0..=2 => {}
    3..=4 => {
        if difficulty != AiDifficulty::CEDH {
            config.search.max_depth = config.search.max_depth.min(2);
            config.search.max_nodes = config.search.max_nodes * 2 / 3;
            config.search.max_branching = config.search.max_branching.min(4);
            config.search.rollout_depth = config.search.rollout_depth.min(1);
        }
    }
    _ => {
        if config.difficulty <= AiDifficulty::Medium {
            config.search.enabled = false;
        } else {
            config.search.max_depth = 1;
            config.search.max_nodes /= 3;
            config.search.max_branching = config.search.max_branching.min(3);
            config.search.rollout_depth = config.search.rollout_depth.min(1);
        }
    }
}
config
```
(Note the `<=` relies on the `PartialOrd, Ord` derive order of `AiDifficulty`; the variant
declaration order VeryEasy<Easy<Medium<Hard<VeryHard<CEDH is load-bearing — keep it.)

The `#[cfg(test)]` module (~20 tests) ports verbatim; it exercises only this module, so it
compiles as soon as the sibling stubs exist. Keep it — it locks every constant.

### A.4 Dependencies on other phase-ai modules
`deck_profile::ArchetypeMultipliers`, `eval::{EvalWeightSet, KeywordBonuses}`,
`strategy_profile::StrategyProfile`. config.rs needs only their **type shape + the methods
it calls**: `ArchetypeMultipliers::default()`, `EvalWeightSet { early, mid, late }` (three
`Keyword-adjustable` weight bundles) + `EvalWeightSet::learned()` + `EvalWeightSet: Clone`,
`KeywordBonuses::default()`, and `StrategyProfile` with public `risk_tolerance_mult`,
`interaction_patience_mult`, `stabilize_bias_mult: f64`.

### A.5 Risks
- **Low.** No engine coupling. The only blocker is that forge-ai's current `eval.rs` exposes
  a flat `EvalWeights` (life/aggression/board_*/hand/card_advantage), NOT phase's
  `EvalWeightSet { early, mid, late }` phase-of-game split with `learned()`. Porting config.rs
  faithfully requires bringing over phase-ai's `eval::EvalWeightSet` shape (and the
  `early/mid/late` weight bundles + `learned()` constructor). Treat as a prerequisite port,
  not an adaptation. `KeywordBonuses`, `ArchetypeMultipliers`, `StrategyProfile` likewise.
- Adapting `EvalWeightSet::learned()` constants will pull in phase's trained weight vectors —
  carry them verbatim from phase's `eval.rs` when that module is ported.

---

## B. `context.rs`

### B.1 What it does
`AiContext` — the per-game, per-perspective analysis bundle threaded into eval, policies, and
search. Built **once per game** (or per `choose_action`) from a deck list. Holds: the
`DeckProfile` (archetype analysis), the deck-adjusted `EvalWeightSet` (base weights modulated
by archetype multipliers per phase), the `StrategyProfile`, an optional opponent
`ThreatProfile`, an `Arc<AiSession>` (the shared per-game cache, see §C), the perspective
`player: PlayerId`, and a wall-clock `Deadline`. Provides constructors
(`analyze`/`analyze_with`/`analyze_for_player`/`empty`) and `synergy_graph()` accessor.

The core logic is `analyze_for_player`: analyze deck → derive per-phase adjusted weights via
`deck_profile.adjust_weights_with(multipliers, &base.{early,mid,late})` → derive strategy →
build single-deck session with bracket tier `Core`.

### B.2 Engine types it reads → manabrew equivalent
| Phase type/API (cite) | manabrew equivalent (file:line) | status |
|---|---|---|
| `engine::types::player::PlayerId`, `PlayerId(0)` | `forge_engine_core::ids::PlayerId(pub u32)` — `ids.rs:9`; tuple-construct `PlayerId(0)` works | **EXISTS** |
| `engine::game::DeckEntry` (the `deck: &[DeckEntry]` arg) | **NO EQUIVALENT.** manabrew has no `DeckEntry`. Decks are `Vec<String>` card names (`RegisteredPlayer.current_deck` — `player/registered_player.rs:40`) or the `Deck` DTO `Vec<DeckCard>` (`forge-agent-interface/src/deck_dto.rs:83`) | **MISSING → define forge-ai-local `DeckEntry`** |
| `engine::util::Deadline`, `Deadline::none()` | **NO EQUIVALENT** anywhere in workspace (grep: 0 hits) | **MISSING → define forge-ai-local `Deadline`** |
| `engine::game::bracket_estimate::CommanderBracketTier::Core` | **NO EQUIVALENT** (grep: 0 hits) | **MISSING → define forge-ai-local enum** |

Sibling phase-ai modules (deps, not engine): `deck_profile::{ArchetypeMultipliers,
DeckProfile}`, `eval::EvalWeightSet`, `session::AiSession`, `strategy_profile::StrategyProfile`,
`synergy::SynergyGraph`, `threat_profile::ThreatProfile`.

### B.3 Faithful-port skeleton

Carry the struct + impl verbatim, substituting the three missing engine types with
forge-ai-local definitions (see §B.5). The engine-agnostic bodies port unchanged:

```rust
use std::sync::Arc;

use forge_engine_core::ids::PlayerId;

use crate::deck::DeckEntry;                  // forge-ai-local (replaces engine::game::DeckEntry)
use crate::util::Deadline;                   // forge-ai-local (replaces engine::util::Deadline)
use crate::bracket::CommanderBracketTier;    // forge-ai-local (replaces engine::game::bracket_estimate)
use crate::deck_profile::{ArchetypeMultipliers, DeckProfile};
use crate::eval::EvalWeightSet;
use crate::session::AiSession;
use crate::strategy_profile::StrategyProfile;
use crate::synergy::SynergyGraph;
use crate::threat_profile::ThreatProfile;

#[derive(Debug, Clone)]
pub struct AiContext {
    pub deck_profile: DeckProfile,
    pub adjusted_weights: EvalWeightSet,
    pub strategy: StrategyProfile,
    pub opponent_threat: Option<ThreatProfile>,
    pub session: Arc<AiSession>,
    pub player: PlayerId,
    pub deadline: Deadline,
}

static EMPTY_SYNERGY_GRAPH: std::sync::OnceLock<SynergyGraph> = std::sync::OnceLock::new();

impl AiContext {
    pub fn analyze(deck: &[DeckEntry], base_weights: &EvalWeightSet) -> Self {
        Self::analyze_with(deck, base_weights, &ArchetypeMultipliers::default())
    }

    pub fn analyze_with(
        deck: &[DeckEntry],
        base_weights: &EvalWeightSet,
        multipliers: &ArchetypeMultipliers,
    ) -> Self {
        Self::analyze_for_player(deck, base_weights, multipliers, PlayerId(0))
    }

    pub fn analyze_for_player(
        deck: &[DeckEntry],
        base_weights: &EvalWeightSet,
        multipliers: &ArchetypeMultipliers,
        player: PlayerId,
    ) -> Self {
        let deck_profile = DeckProfile::analyze(deck);
        let adjusted_weights = EvalWeightSet {
            early: deck_profile.adjust_weights_with(multipliers, &base_weights.early),
            mid: deck_profile.adjust_weights_with(multipliers, &base_weights.mid),
            late: deck_profile.adjust_weights_with(multipliers, &base_weights.late),
        };
        let strategy = StrategyProfile::for_profile(&deck_profile);
        let session = Arc::new(AiSession::from_single_deck(
            player, deck, CommanderBracketTier::Core,
        ));
        Self {
            deck_profile, adjusted_weights, strategy,
            opponent_threat: None, session, player,
            deadline: Deadline::none(),
        }
    }

    pub fn empty(base_weights: &EvalWeightSet) -> Self {
        Self {
            deck_profile: DeckProfile::default(),
            adjusted_weights: base_weights.clone(),
            strategy: StrategyProfile::default(),
            opponent_threat: None,
            session: Arc::new(AiSession::empty()),
            player: PlayerId(0),
            deadline: Deadline::none(),
        }
    }

    pub fn synergy_graph(&self) -> &SynergyGraph {
        self.session
            .synergy
            .get(&self.player)
            .unwrap_or_else(|| EMPTY_SYNERGY_GRAPH.get_or_init(SynergyGraph::empty))
    }
}
```

No formulas/thresholds live in this file — all numeric work is delegated to
`DeckProfile::adjust_weights_with`. The port is mechanical; the only changes are the three
import substitutions.

### B.4 Dependencies on other phase-ai modules
`deck_profile` (DeckProfile, ArchetypeMultipliers — needs `analyze`, `default`,
`adjust_weights_with`), `eval::EvalWeightSet` (fields `early/mid/late`, `Clone`),
`strategy_profile::StrategyProfile` (`for_profile`, `default`), `synergy::SynergyGraph`
(`empty`), `threat_profile::ThreatProfile`, and **`session::AiSession`** (this spec, §C).

### B.5 Risks
- **`Deadline` — must build.** phase's `engine::util::Deadline` is a wall-clock gate
  (`none()` = no deadline; elsewhere `.remaining()` used by session/policies). Implement a
  small forge-ai-local type, e.g.
  `pub struct Deadline { until: Option<std::time::Instant> }` with `none()`,
  `after(Duration)`, `remaining() -> Option<Duration>`/`u128`, `is_expired()`. **WASM caveat:**
  `std::time::Instant` panics on wasm32 — under the manabrew WASM build the deadline must be a
  no-op (`Deadline::none()`-equivalent) or use a JS-clock shim. phase sidesteps this by
  disabling wall-clock caps on WASM (see config WASM comment); mirror that: on wasm32,
  `remaining()` returns `None` and search is bounded only by nodes/depth.
- **`DeckEntry` — must define.** Decide the shape: phase's `DeckEntry` is the analysis unit
  consumed by `DeckProfile::analyze`, `DeckFeatures::analyze`, `SynergyGraph::build`. It needs
  enough to classify a card (name + parsed rules / type / mana cost / quantity). manabrew's
  `Deck` DTO `DeckCard` (`deck_dto.rs:60`) carries `CardIdentity` + `CardRulesSummary` —
  closest existing analog. Recommend `DeckEntry { card: <resolved card data>, count: u32 }`
  resolved against the card DB at session build, OR port phase's `DeckEntry` verbatim if it is
  self-contained. This decision is shared with `features`/`deck_profile`/`synergy` ports.
- **`CommanderBracketTier` — must define.** Port phase's enum (`Core`, `Upgraded`,
  `Optimized`, `Cedh`, … — from phase's `engine::game::bracket_estimate`). Pure data; no
  engine coupling beyond being a `Copy + Eq` enum. manabrew has no bracket concept; this is new
  AI-side metadata, not an engine change.

---

## C. `session.rs`

### C.1 What it does
`AiSession` — the per-game cache shared (via `Arc`) across all decisions. Three-layer design:
- Layer 1 `features: HashMap<PlayerId, DeckFeatures>` — structural deck data, computed once.
- Layer 2 `plan: HashMap<PlayerId, PlanSnapshot>` — static schedule prior derived from features.
- `synergy: HashMap<PlayerId, SynergyGraph>` — per-player synergy graph.
- `memory: PolicyMemory` — typed cross-decision policy state.
- `projection_cache: Arc<RwLock<HashMap<ProjectionKey, Arc<Projection>>>>` — turn-scoped
  opponent-turn lookahead cache.

Constructors build these maps from deck data: `from_game(state)` iterates
`state.deck_pools`; `from_single_deck(player, deck, tier)` seeds one player;
`ensure_player_features` lazily populates; `invalidate_player_features` drops.
`get_or_project` is the read-through projection cache (lock-free read, write-lock on miss);
`cached_projection` is the cache-only variant (no simulation on miss). `archetype(player)`
is a typed accessor over `features`.

`PolicyMemory { by_policy: HashMap<PolicyId, PolicyState> }` + `enum PolicyState { None,
LandfallTiming { held_fetch_count: u8, last_held_turn: u32 } }` — typed, no `dyn Any`.

### C.2 Engine types it reads → manabrew equivalent
| Phase type/API (cite) | manabrew equivalent (file:line) | status |
|---|---|---|
| `engine::types::player::PlayerId` | `forge_engine_core::ids::PlayerId` — `ids.rs:9` | **EXISTS** |
| `engine::types::game_state::GameState` | `forge_engine_core::game::GameState` — `game.rs:92` | **EXISTS** (different field layout) |
| `engine::game::DeckEntry` | — | **MISSING** (see §B.5) |
| `state.deck_pools: Vec<PlayerDeckPool>` | **NO EQUIVALENT.** manabrew `GameState` retains **no deck list** after setup; decks are dealt into zones by `instantiate_registered_players` and discarded. No `deck_pools` field exists | **MISSING → architectural gap, see §C.5** |
| `PlayerDeckPool { player, current_main, bracket_tier }` | none | **MISSING** |
| `base.turn_number` | manabrew `game.turn.turn_number: u32` — `phase/mod.rs:146` (nested under `TurnState`, not flat on `GameState`) | **EXISTS (path differs)** |
| `base.active_player` | manabrew `game.active_player() -> PlayerId` — `game.rs:458`, or field `game.turn.active_player` — `phase/mod.rs:147` | **EXISTS (accessor)** |
| `engine::game::bracket_estimate::CommanderBracketTier` | — | **MISSING** (see §B.5) |
| `GameState::new_two_player(42)` (tests only) | `GameState::new(&names, life)` — `game.rs:198` | **partial (tests only)** |
| `deck_loading::load_deck_into_state`, `DeckPayload`, `PlayerDeckPayload` (tests only) | `prepare_players` + `instantiate_registered_players` — `forge-game-runtime/src/deck.rs:66,152` | **partial (tests only)** |

Sibling phase-ai modules (deps): `features::DeckFeatures`, `plan::{derive_snapshot,
PlanSnapshot}`, `planner::quick_state_hash`, `policies::registry::PolicyId`,
`projection::{project_to, BailReason, Projection, ProjectionHorizon, ProjectionKey}`,
`synergy::SynergyGraph`, `deck_profile::DeckArchetype`.

`crate::planner::quick_state_hash(base) -> u64` — **NO engine equivalent**; manabrew has no
state-hash fn (grep found only `Trigger`'s `Hash` impl). Must be implemented when `planner` is
ported (cheap structural hash of life totals / zone sizes / turn / active player).

### C.3 Faithful-port skeleton

```rust
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use forge_engine_core::game::GameState;
use forge_engine_core::ids::PlayerId;

use crate::bracket::CommanderBracketTier;
use crate::deck::DeckEntry;
use crate::features::DeckFeatures;
use crate::plan::{derive_snapshot, PlanSnapshot};
use crate::planner::quick_state_hash;
use crate::policies::registry::PolicyId;
use crate::projection::{project_to, BailReason, Projection, ProjectionHorizon, ProjectionKey};
use crate::synergy::SynergyGraph;

#[derive(Debug, Clone, Default)]
pub struct AiSession {
    pub features: HashMap<PlayerId, DeckFeatures>,
    pub plan: HashMap<PlayerId, PlanSnapshot>,
    pub synergy: HashMap<PlayerId, SynergyGraph>,
    pub memory: PolicyMemory,
    pub projection_cache: Arc<RwLock<HashMap<ProjectionKey, Arc<Projection>>>>,
}

impl AiSession {
    pub fn empty() -> Self { Self::default() }

    // ENGINE-COUPLED — adapt the deck-pool source (see §C.5).
    pub fn from_game(state: &GameState) -> Self {
        let mut features = HashMap::new();
        let mut plan = HashMap::new();
        let mut synergy = HashMap::new();
        for pool in &state.deck_pools /* ← MISSING on manabrew */ {
            let deck: &[DeckEntry] = &pool.current_main;
            let player_features = DeckFeatures::analyze(deck, pool.bracket_tier);
            let snapshot = derive_snapshot(&player_features);
            let graph = SynergyGraph::build(deck);
            features.insert(pool.player, player_features);
            plan.insert(pool.player, snapshot);
            synergy.insert(pool.player, graph);
        }
        Self { features, plan, synergy,
               memory: PolicyMemory::default(), projection_cache: Arc::default() }
    }

    // ENGINE-AGNOSTIC — ports verbatim.
    pub fn from_single_deck(
        player: PlayerId, deck: &[DeckEntry], tier: CommanderBracketTier,
    ) -> Self {
        let mut session = Self::default();
        let player_features = DeckFeatures::analyze(deck, tier);
        let snapshot = derive_snapshot(&player_features);
        let graph = SynergyGraph::build(deck);
        session.features.insert(player, player_features);
        session.plan.insert(player, snapshot);
        session.synergy.insert(player, graph);
        session
    }

    pub fn arc_from_game(state: &GameState) -> Arc<Self> { Arc::new(Self::from_game(state)) }

    pub fn ensure_player_features(
        &mut self, player: PlayerId, deck: &[DeckEntry], tier: CommanderBracketTier,
    ) {
        if self.features.contains_key(&player) || deck.is_empty() { return; }
        let features = DeckFeatures::analyze(deck, tier);
        let snapshot = derive_snapshot(&features);
        self.features.insert(player, features);
        self.plan.insert(player, snapshot);
        self.synergy.insert(player, SynergyGraph::build(deck));
    }

    pub fn invalidate_player_features(&mut self, player: PlayerId) {
        self.features.remove(&player);
        self.plan.remove(&player);
        self.synergy.remove(&player);
    }

    pub fn archetype(&self, player: PlayerId) -> Option<crate::deck_profile::DeckArchetype> {
        self.features.get(&player).map(|f| f.archetype)
    }

    // ENGINE-AGNOSTIC except quick_state_hash + turn_number/active_player field paths.
    pub fn get_or_project(
        &self, base: &GameState, ai_player: PlayerId, target_opponent: PlayerId,
        horizon: ProjectionHorizon,
    ) -> Result<Arc<Projection>, BailReason> {
        let key = ProjectionKey {
            state_hash: quick_state_hash(base),
            turn_number: base.turn.turn_number,        // ← was base.turn_number
            active_player: base.active_player(),        // ← was base.active_player
            ai_player, target_opponent, horizon,
        };
        if let Ok(cache) = self.projection_cache.read() {
            if let Some(hit) = cache.get(&key) { return Ok(Arc::clone(hit)); }
        }
        let projection = Arc::new(project_to(base, ai_player, target_opponent, horizon)?);
        if let Ok(mut cache) = self.projection_cache.write() {
            cache.insert(key, Arc::clone(&projection));
        }
        Ok(projection)
    }

    pub fn cached_projection(
        &self, base: &GameState, ai_player: PlayerId, target_opponent: PlayerId,
        horizon: ProjectionHorizon,
    ) -> Option<Arc<Projection>> {
        let key = ProjectionKey {
            state_hash: quick_state_hash(base),
            turn_number: base.turn.turn_number,
            active_player: base.active_player(),
            ai_player, target_opponent, horizon,
        };
        self.projection_cache.read().ok()
            .and_then(|cache| cache.get(&key).map(Arc::clone))
    }
}

#[derive(Debug, Clone, Default)]
pub struct PolicyMemory { pub by_policy: HashMap<PolicyId, PolicyState> }

#[derive(Debug, Clone)]
pub enum PolicyState {
    None,
    LandfallTiming { held_fetch_count: u8, last_held_turn: u32 },
}
```

The cache-key construction, read-through/write-lock discipline, and the `LandfallTiming`
memory shape are all engine-agnostic and port verbatim. Only two surgical edits:
`base.turn_number → base.turn.turn_number` and `base.active_player → base.active_player()`.

### C.4 Dependencies on other phase-ai modules
`features::DeckFeatures` (`analyze(deck, tier)`, fields `archetype`, `bracket_tier`),
`plan::{derive_snapshot, PlanSnapshot}`, `planner::quick_state_hash`,
`policies::registry::PolicyId` (must be `Eq + Hash`), `projection::*` (`ProjectionKey` must be
`Eq + Hash` and carry `{state_hash, turn_number, active_player, ai_player, target_opponent,
horizon}`; `project_to` is the multi-turn simulator; `BailReason`/`Projection`/
`ProjectionHorizon`), `synergy::SynergyGraph` (`build`), `deck_profile::DeckArchetype`. Plus
the forge-ai-local `DeckEntry`, `CommanderBracketTier`.

### C.5 Risks
- **`state.deck_pools` is the central infeasibility.** phase's `GameState` carries each
  seat's decklist + bracket tier for the whole game; manabrew's `GameState` does **not** — the
  decklist is consumed at setup and not retained (cf. `instantiate_registered_players`,
  `forge-game-runtime/src/deck.rs:152`). Three port options, in order of fidelity vs. cost:
  1. **Thread decks into the agent, not the engine (recommended).** Build `AiSession` from the
     `Deck`/`RegisteredPlayer` lists available at agent construction (the `agent_factory`
     closure in `host_runtime.rs:30` / `rust_backend.rs:69` has them), via
     `from_single_deck`/`ensure_player_features`, and **drop `from_game(state)`** (or make it a
     thin wrapper that reads an injected deck map). No engine change. Loses the convenience of
     re-deriving from `GameState` mid-game, which the AI does not need (decks are static).
  2. Add a lightweight `deck_pools: Vec<PlayerDeckPool>` (or `HashMap<PlayerId,
     Vec<DeckEntry>> + bracket tiers`) to manabrew `GameState`, populated at setup. Higher
     fidelity to phase but an **engine change** (clone cost, serde) — discouraged by the
     parity philosophy unless the AI genuinely needs in-state access.
  Recommend option 1; note it in the forge-ai AGENTS notes.
- **`quick_state_hash` missing.** Needed by both projection methods. Implement in the `planner`
  port: a fast structural hash over `turn.turn_number`, `active_player`, per-player life, and
  per-zone card counts. Must be deterministic and cheap (it runs on the read path). Until
  `projection`/`planner` exist, `get_or_project`/`cached_projection` cannot compile — they are
  the only parts of session.rs blocked on heavy sibling ports.
- **`project_to` (projection module) is the heavyweight dependency.** It clone-and-simulates
  opponent turns. On manabrew that means `GameState::clone()` + cloning
  `GameLoop.{mana_pools, combat, trigger_handler}` (mirror `GameSnapshot::capture`,
  `game_snapshot.rs:16`) and stepping `run_turn`. Expensive (deep `Vec<Card>` clone). Feasible
  but must be measured against the 1500ms budget; this is exactly why
  `projection_min_budget_ms` / `Deadline` gating exists. Out of scope for these 3 files but is
  the binding constraint on whether `get_or_project` is usable in production.
- **`bracket_tier` on `DeckFeatures`** (used by tests `cedh_tier_pool_records_cedh_bracket`)
  is AI-side metadata; supplied by whichever option above provides the decklist. The 3 unit
  tests reference `GameState::new_two_player`, `PlayerDeckPool`, and `load_deck_into_state`
  which do not exist on manabrew — **rewrite the tests** to the chosen deck-injection path
  (option 1), or drop them; they are not faithful-port-critical (config.rs tests are).
- **WASM `RwLock`/`Arc`** are fine on wasm32 (single-threaded but compile/run). No change.

---

## D. Port order (prerequisites first)
1. `config.rs` — only blocked on `eval::EvalWeightSet`/`KeywordBonuses`,
   `deck_profile::ArchetypeMultipliers`, `strategy_profile::StrategyProfile` type shapes.
   Self-contained tests verify all constants. **Do first.**
2. Forge-ai-local primitives: `util::Deadline`, `bracket::CommanderBracketTier`,
   `deck::DeckEntry`.
3. `context.rs` — mechanical once (1)+(2)+`deck_profile`/`session`/`synergy`/`threat_profile`
   exist.
4. `session.rs` — `from_single_deck`/`ensure_player_features`/`archetype`/`memory` portable
   immediately after `features`/`plan`/`synergy`; `from_game` needs the deck-injection
   decision (§C.5 option 1); `get_or_project`/`cached_projection` gated on
   `planner::quick_state_hash` + `projection`.
