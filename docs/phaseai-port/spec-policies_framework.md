# Faithful-port spec — phase-ai `policies/{mod,registry,context}.rs`

Source: `phase-rs/phase` @ `main`, `crates/phase-ai/src/policies/`.
Target: a new `forge-ai` crate (or `forge-engine/src/agent/policies/`) over manabrew's
Forge-DSL engine. Engine paths below are relative to
`forge-engine/crates/forge-engine/src/` unless a crate is named.

This is the **policy framework scaffolding** — the three files contain *no* card
heuristics themselves. They define: the module tree (`mod.rs`), the policy trait +
registry + prior softmax (`registry.rs`), and the per-candidate `PolicyContext`
accessor bundle (`context.rs`). The ~50 individual policy impls are separate
modules (separate specs).

---

## 0. TL;DR for the implementer

Phase's AI is a **prior-scoring planner**: it enumerates `CandidateAction`s for a
decision, runs a registry of stateless `TacticalPolicy` objects over each
candidate, each policy returns `Reject` or `Score{delta}`, the registry sums them
into a scalar and **shifts+normalizes the scalars into a softmax-like prior
distribution** that seeds an MCTS/argmax planner.

manabrew's AI is the **opposite architecture**: a callback-based `PlayerAgent`
(`agent/mod.rs:23`) that mirrors Java forge-ai card-by-card heuristics
(`agent/creature_evaluator.rs`, `agent/attach_ai.rs`). There is **no candidate
enumeration framework, no `AiDecisionContext`, no `WaitingFor` reification, no
typed `Effect` enum, and no prior/planner layer**. Porting this framework is
feasible but requires building three missing substrates first (candidate
enumeration, a decision-context reification, and an effect classifier), most of
which are *other* phase-ai modules already on the port roadmap.

The good news: the framework code that is *load-bearing* — the trait shape, the
registry routing, the `delta * activation` scaling, the `score` reduction, and
the **prior shift/normalize formula** — is entirely engine-agnostic and ports
**verbatim**. The risk is concentrated in `context.rs`, whose accessors read
Phase's object/ability/targeting model directly.

---

## 1. What each module does

### `policies/mod.rs`
Pure module-tree + re-export root. Declares ~51 submodules (one per policy +
`activation`, `context`, `effect_classify`, `strategy_helpers`, `mulligan`,
`registry`, `tests`) with mixed `mod` / `pub(crate) mod` / `pub mod` visibility,
then:
```rust
pub use registry::{
    DecisionKind, PolicyId, PolicyReason, PolicyRegistry, PolicyVerdict, TacticalPolicy,
};
```
No logic. Visibility map (verbatim from source) — keep identical so sibling
modules resolve:
- `pub mod`: `mulligan`, `registry`
- `pub(crate) mod`: `activation`, `combo_line`, `context`, `copy_value`,
  `effect_classify`, `hand_disruption`, `stack_awareness`, `strategy_helpers`,
  `tutor`
- `mod` (private): everything else (`aggro_pressure`, `anthem_priority`,
  `anti_self_harm`, `blight_value`, `board_development`, `board_wipe_telegraph`,
  `card_advantage`, `combat_tax`, `condition_gated_activation`,
  `control_change_awareness`, `downside_awareness`, `effect_timing`,
  `equipment_priority`, `etb_value`, `evasion_removal_priority`,
  `free_outlet_activation`, `hold_mana_up`, `interaction_reservation`,
  `land_animation`, `land_sequencing`, `landfall_timing`, `lethality_awareness`,
  `life_total_resource`, `mana_efficiency`, `mill_targeting`,
  `planeswalker_loyalty`, `plus_one_counters`, `ramp_timing`,
  `reactive_self_protection`, `recursion_awareness`, `redundancy_avoidance`,
  `sacrifice_value`, `spellskite_priority`, `spellslinger_casting`,
  `sweeper_timing`, `synergy_casting`, `tempo_curve`, `tokens_wide`,
  `tribal_lord_priority`, `x_value`)
- `#[cfg(test)] pub mod tests;`

### `policies/registry.rs`
The framework heart. Defines:
- `enum PolicyId` — 57 variants, the stable identity for each policy impl. No
  string IDs, no `Legacy` catch-all.
- `enum DecisionKind` — 10 coarse routing kinds (`Mulligan, PlayLand, CastSpell,
  ActivateAbility, ActivateManaAbility, SelectTarget, DeclareAttackers,
  DeclareBlockers, ManaPayment, ChooseX`).
- `struct PolicyReason { kind: &'static str, facts: Vec<(&'static str, i64)> }`
  + builder `new`/`with_fact` — structured (non-freeform) observability.
- `enum PolicyVerdict { Reject{reason}, Score{delta: f64, reason} }`.
- `trait TacticalPolicy: Send + Sync` — 4 required methods, zero defaults:
  `id() -> PolicyId`, `decision_kinds() -> &'static [DecisionKind]`,
  `activation(&DeckFeatures, &GameState, PlayerId) -> Option<f32>`,
  `verdict(&PolicyContext) -> PolicyVerdict`. The "CR-equivalent invariant":
  `decision_kinds()` filters candidates, `activation()` is the single
  multiplicative knob (`None` = opt out), `verdict()` is the judgment; registry
  multiplies `delta * activation` exactly once.
- `struct PolicyRegistry { policies: Vec<Box<dyn TacticalPolicy>>, by_kind:
  HashMap<DecisionKind, Vec<usize>> }`.
  - `Default` builds the 45-element `policies` vec (note: 45 boxed impls map onto
    57 `PolicyId` variants — the surplus variants are mulligan/keepables policies
    living in `policies::mulligan`, registered elsewhere), then pre-indexes
    `by_kind` by walking each policy's `decision_kinds()`.
  - `shared() -> &'static Self` via `OnceLock` (stateless policies ⇒ one
    process-wide instance, no cross-game bleed).
  - `verdicts(ctx) -> Vec<(PolicyId, PolicyVerdict)>` — classify candidate →
    `by_kind` lookup → for each matching policy: borrow cached `DeckFeatures`,
    call `activation()` (skip if `None`), call `verdict()`, **scale the
    `Score.delta` by `activation as f64`** (Reject passes through unscaled).
  - `score(ctx) -> f64` — sum of scaled deltas; any `Reject` ⇒
    `f64::NEG_INFINITY`.
  - `has_policy(id) -> bool` — diagnostics.
  - `priors(state, decision, candidates, ai_player, config, context) ->
    Vec<PolicyPrior>` — the planner entry point: score every candidate, then the
    **shift+normalize prior formula** (verbatim in §3).

### `policies/context.rs`
`struct PolicyContext<'a>` — the read-only bundle every policy's `verdict()`
receives. Holds borrows of `state`, `decision`, `candidate`, `ai_player`,
`config`, `context` (AiContext), and an optional pre-computed `cast_facts`.
Convenience accessors:
- `strategic_intent()` → delegates to `crate::eval::strategic_intent`.
- `penalties()` → `&config.policy_penalties`.
- `deadline_expired()` / `can_afford_projection()` → wall-clock budget gating for
  expensive multi-turn projections (reads `context.deadline`,
  `config.search.projection_min_budget_ms`).
- `source_object()` → resolves the `&GameObject` behind the candidate action
  (cast card / ability source / pending-cast/ability/trigger source during target
  selection).
- `effects()` → `Vec<&Effect>`: walks the ability's `sub_ability` chain to collect
  every typed `Effect`. Three free helpers do the walk:
  `collect_ability_effects(&ResolvedAbility)` and
  `collect_definition_effects(&AbilityDefinition)`.
- `cast_facts()` / `effect_profile()` → lazily compute from `crate::cast_facts`.
- `has_legal_opponent_creature_target(filter, source_id, is_relevant)` → uses
  `find_legal_targets` to test for a relevant opponent creature target.

---

## 2. Engine type/API map (Phase → manabrew), cited

| Phase symbol (import) | Used in | manabrew equivalent (file:line) | Status |
|---|---|---|---|
| `engine::types::game_state::GameState` | all 3 | `game::GameState` — `game.rs:92` | OK (direct) |
| `engine::types::player::PlayerId` | all 3 | `ids::PlayerId` — `ids.rs:9` | OK |
| `engine::types::identifiers::ObjectId` | context | `ids::CardId` — `ids.rs:5` (instance id = arena index) | OK-ish: Phase separates `ObjectId` (instance) from `CardId` (printing); manabrew's `CardId` is the instance, card identity is `Card.card_name`/`full_name` (`card/mod.rs:201/205`). One-id model. |
| `engine::types::identifiers::CardId` (tests) | context tests | `Card.card_name` / oracle id | ADAPT (no separate printing-id type) |
| `engine::game::game_object::GameObject` | context | `card::Card` — `card/mod.rs:197` (arena: `GameState.cards: Vec<Card>`, accessor `game.card(CardId)` — `game.rs:263`). manabrew also has `game_object.rs` but the live object IS `Card`. | OK (different name) |
| `object.card_id` / `object.controller` / `object.card_types.core_types` / `object.abilities` | context | `Card.id` `:198`, `Card.controller` `:209`, `Card.type_line.core_types` (`forge-foundation card_type.rs:153`), `CardState::get_spell_abilities` (`card/card_state.rs:333`) / `Card.activated_abilities` (`card/mod.rs:350`) | ADAPT (abilities not a flat `Vec` on the object; fetched via accessor) |
| `engine::types::card_type::CoreType` | context | `CoreType` in `forge-foundation/src/card_type.rs`; or just `Card::is_creature()` — `card/mod.rs:1022` | OK |
| `engine::types::ability::Effect` (typed enum: `Pump/Draw/Destroy/...`) | context (`effects()`, helpers, tests) | **NO direct equivalent.** manabrew classifies via `ApiType` verb (`ability/api_type.rs:11`) + lowered operand bag `SpellAbilityIr` (`ability/ability_ir.rs:78`) + partial typed `EffectIr` (`ability_ir.rs:16`, only 8 numeric APIs lowered). | **FLAG — major.** Phase's strongly-typed `Effect` enum must be replaced by `(ApiType, &SpellAbilityIr)` pairs. `collect_*_effects` becomes "walk `sa.sub_ability` collecting `(api, ir)`". See §5 Risk R1. |
| `engine::types::ability::AbilityDefinition` / `ResolvedAbility` | context | `spellability::SpellAbility` — `spellability/mod.rs:99` (printed: `CardState::get_intrinsic_spell_abilities` — `card/card_state.rs:357`). `ActivatedAbility` (`ability/activated.rs`) for activated. | ADAPT (Phase splits definition vs resolved; manabrew has one `SpellAbility` + `ActivatedAbility`/`Trigger`) |
| `ability.effect` / `ability.sub_ability` (the chain) | context helpers | `sa.api` (`mod.rs:104`) + `sa.ir` (`mod.rs:125`); chain via `sa.sub_ability: Option<Box<SpellAbility>>` (`mod.rs:138`); walk helper `find_sub_ability_by_type` (`mod.rs:676`) | OK structurally (chain exists), ADAPT leaf type (`Effect` → `api/ir`) |
| `engine::types::ability::{TargetFilter, TargetRef}` | context | `TargetRestrictions` — `spellability/target_restrictions.rs`; `TargetEntity{Card|Player}` — `player/actions/player_action.rs:38`; `TargetChoice{Player,Card,None}` — `agent/types.rs:63` | ADAPT (Phase's `TargetRef::Object/Player` ↔ manabrew `TargetEntity::Card/Player`) |
| `engine::game::targeting::find_legal_targets(state, filter, player, source)` | context (`has_legal_opponent_creature_target`) | **No single free fn.** Closest: `spellability::choose_targets_by_kind` (`spellability/mod.rs:1851`) + `TargetRestrictions` candidate validation; engine resolves legal targets inside agent callbacks (`agent/mod.rs:279` `choose_targets_for`). | **FLAG — partial.** Must build/locate a `legal_targets(state, restrictions, source, player) -> Vec<TargetEntity>` helper (the validation logic exists in `target_restrictions.rs` but not exposed as a pure query). See R5. |
| `engine::types::actions::GameAction` (`CastSpell{card_id,object_id,targets}`, `ActivateAbility{source_id,ability_index}`, `ChooseTarget{target}`, `SelectTargets{..}`) | registry, context | `player::actions::PlayerAction` — `player_action.rs:11` (`CastSpell(PlayOption)`, `ActivateAbility(AbilityRef)`, `TargetEntity(TargetEntity)`, `SelectCard/SelectPlayer`); `PlayOption{card_id,mode,alt_cost_index}` (`agent/types.rs:16`); `MainPhaseAction` (`agent/types.rs:71`) | **FLAG — shape mismatch.** Phase's `GameAction` carries explicit `object_id`+`card_id`+`targets`; manabrew's `PlayOption` carries only `card_id`+mode, and targets flow through separate agent callbacks. `source_object()`/`effects()` pattern-matching on `GameAction` variants must be re-expressed over `PlayerAction`/`PlayOption`. See R3. |
| `engine::ai_support::AiDecisionContext` (`{waiting_for, candidates}`) | registry, context | **NO equivalent.** No decision-context reification — the engine calls typed `PlayerAgent` methods directly. | **FLAG — must build.** A `forge-ai` shim must capture the active decision (which callback fired + its args) into an `AiDecisionContext`-analog. See R2. |
| `engine::ai_support::CandidateAction` (`{action: GameAction, metadata: ActionMetadata{actor, tactical_class}}`) | registry, context | **NO equivalent.** Legal-action set exists as `PriorityActionSpace{playable, tappable_lands, untappable_lands, activatable}` (`agent/types.rs:86`, built by `GameLoop::action_space` — `game_loop/action_space.rs:125`) but carries no per-candidate metadata/`tactical_class`. | **FLAG — must build.** Wrap action-space entries into `CandidateAction`s; synthesize `tactical_class`. See R2. |
| `engine::types::game_state::WaitingFor` (`Priority`, `TargetSelection{pending_cast,..}`, `MultiTargetSelection{pending_ability}`, `TriggerTargetSelection{source_id}`) | context | **NO equivalent.** State is implicit in which agent callback is active (`choose_action`, `choose_targets_for`, `choose_target_card`, …). | **FLAG — must build.** Reify a `WaitingFor` enum at the `forge-ai` boundary. See R2. |
| `state.objects` (map `ObjectId -> GameObject`) — `.values()`, `.get(id)`, `.get_mut(id)` | context | `GameState.cards: Vec<Card>` (`game.rs:94`); access `game.card(id)` `:263` / `card_mut` `:267`; iterate `cards.iter()` or `game.cards_in_zone(zt, pid)` `:520` | ADAPT (Vec arena, not a HashMap; `.values()` → `cards.iter()`, `.get(id)` → `cards.get(id.index())`) |
| `state.pending_trigger` | context (`effects()`) | `TurnState`/trigger handling has no public `pending_trigger`; triggers flow through `TriggerHandler` (`game_loop.rs:41`) + agent callbacks (`choose_optional_trigger` `agent/mod.rs:501`). | **FLAG.** No public pending-trigger accessor; trigger-target effects must be sourced from the active callback's `&SpellAbility` instead. See R5. |
| `engine::util::Deadline` (`after`, `expired`, `remaining`) | context | **NO equivalent** in engine. Trivial to add to `forge-ai` (`std::time::Instant`). `abort_signal: Option<Arc<AtomicBool>>` (`game_loop.rs:79`) is the only cooperative-stop primitive. | ADAPT (implement `Deadline` in `forge-ai::util`) |

### phase-ai *internal* deps (not engine — sibling modules to port; see §4)
`crate::cast_facts` (`CastFacts`, `EffectProfile`, `cast_facts_for_action`,
`effect_profile_for_action`), `crate::config` (`AiConfig`, `PolicyPenalties`),
`crate::eval` (`strategic_intent`, `StrategicIntent`), `crate::context::AiContext`,
`crate::decision_kind::classify`, `crate::features::DeckFeatures`,
`crate::planner::PolicyPrior`, `crate::policies::activation`,
`crate::policies::effect_classify`, `crate::policies::strategy_helpers`.

---

## 3. Faithful-port plan + Rust skeleton

Target module path: `forge-ai/src/policies/` (sibling-resolve names preserved).
Substitute manabrew types: `GameState` (`forge_engine::game::GameState`),
`PlayerId`/`CardId` (`forge_engine::ids`). Keep **all numeric constants, the
scaling rule, and the prior formula verbatim** — they are engine-agnostic.

### 3a. `policies/mod.rs` — verbatim (only visibility/module list)
Reproduce the module list from §1 exactly; keep the `pub use registry::{…}`
re-export. The only edit: drop any submodule whose policy is infeasible (none at
the framework level — defer to per-policy specs).

### 3b. `policies/registry.rs` — engine-agnostic; ports near-verbatim

```rust
use std::collections::HashMap;

use super::context::PolicyContext;
// ... `use super::<policy>::<Policy>;` for each registered impl (unchanged list)
use crate::cast_facts::cast_facts_for_action;
use crate::config::AiConfig;
use crate::decision_kind::classify as classify_decision;
use crate::features::DeckFeatures;
use crate::planner::PolicyPrior;
use forge_ai::ai_support::{AiDecisionContext, CandidateAction}; // NEW shim (R2)
use forge_engine::game::GameState;
use forge_engine::ids::PlayerId;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PolicyId { /* 57 variants — copy verbatim from §1 source */ }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DecisionKind {
    Mulligan, PlayLand, CastSpell, ActivateAbility, ActivateManaAbility,
    SelectTarget, DeclareAttackers, DeclareBlockers, ManaPayment, ChooseX,
}

#[derive(Debug, Clone)]
pub struct PolicyReason { pub kind: &'static str, pub facts: Vec<(&'static str, i64)> }
impl PolicyReason {
    pub fn new(kind: &'static str) -> Self { Self { kind, facts: Vec::new() } }
    pub fn with_fact(mut self, key: &'static str, value: i64) -> Self {
        self.facts.push((key, value)); self
    }
}

#[derive(Debug, Clone)]
pub enum PolicyVerdict {
    Reject { reason: PolicyReason },
    Score { delta: f64, reason: PolicyReason },
}

pub trait TacticalPolicy: Send + Sync {
    fn id(&self) -> PolicyId;
    fn decision_kinds(&self) -> &'static [DecisionKind];
    fn activation(&self, features: &DeckFeatures, state: &GameState, player: PlayerId) -> Option<f32>;
    fn verdict(&self, ctx: &PolicyContext<'_>) -> PolicyVerdict;
}

pub struct PolicyRegistry {
    policies: Vec<Box<dyn TacticalPolicy>>,
    by_kind: HashMap<DecisionKind, Vec<usize>>,
}

impl Default for PolicyRegistry {
    fn default() -> Self {
        let policies: Vec<Box<dyn TacticalPolicy>> = vec![ /* same 45 Box::new(...) — verbatim */ ];
        let mut by_kind: HashMap<DecisionKind, Vec<usize>> = HashMap::new();
        for (idx, policy) in policies.iter().enumerate() {
            for kind in policy.decision_kinds() {
                by_kind.entry(*kind).or_default().push(idx);
            }
        }
        Self { policies, by_kind }
    }
}

impl PolicyRegistry {
    pub fn shared() -> &'static Self {
        static REGISTRY: std::sync::OnceLock<PolicyRegistry> = std::sync::OnceLock::new();
        REGISTRY.get_or_init(PolicyRegistry::default)
    }

    pub fn verdicts(&self, ctx: &PolicyContext<'_>) -> Vec<(PolicyId, PolicyVerdict)> {
        let kind = classify_decision(&ctx.decision.waiting_for, &ctx.candidate.action);
        let Some(indices) = self.by_kind.get(&kind) else { return Vec::new(); };
        let default_features;
        let session_features: &DeckFeatures = match ctx.context.session.features.get(&ctx.ai_player) {
            Some(f) => f,
            None => { default_features = DeckFeatures::default(); &default_features }
        };
        let mut out = Vec::with_capacity(indices.len());
        for &idx in indices {
            let policy = &self.policies[idx];
            let Some(activation) = policy.activation(session_features, ctx.state, ctx.ai_player) else { continue; };
            let verdict = policy.verdict(ctx);
            let scaled = match verdict {
                PolicyVerdict::Reject { reason } => PolicyVerdict::Reject { reason },
                PolicyVerdict::Score { delta, reason } =>
                    PolicyVerdict::Score { delta: delta * activation as f64, reason },
            };
            out.push((policy.id(), scaled));
        }
        out
    }

    pub fn score(&self, ctx: &PolicyContext<'_>) -> f64 {
        let verdicts = self.verdicts(ctx);
        let mut total = 0.0;
        for (_id, verdict) in verdicts {
            match verdict {
                PolicyVerdict::Reject { .. } => return f64::NEG_INFINITY,
                PolicyVerdict::Score { delta, .. } => total += delta,
            }
        }
        total
    }

    pub fn has_policy(&self, id: PolicyId) -> bool { self.policies.iter().any(|p| p.id() == id) }

    pub fn priors(
        &self,
        state: &GameState,
        decision: &AiDecisionContext,
        candidates: &[CandidateAction],
        ai_player: PlayerId,
        config: &AiConfig,
        context: &crate::context::AiContext,
    ) -> Vec<PolicyPrior> {
        if candidates.is_empty() { return Vec::new(); }
        let raw_scores: Vec<f64> = candidates.iter().map(|candidate| {
            let cast_facts = cast_facts_for_action(state, &candidate.action, ai_player);
            self.score(&PolicyContext { state, decision, candidate, ai_player, config, context, cast_facts })
        }).collect();
        // ── PRIOR SHIFT + NORMALIZE — CARRY VERBATIM ──────────────────────
        let min_score = raw_scores.iter().copied()
            .filter(|s| s.is_finite())
            .fold(f64::INFINITY, f64::min);
        let shifted: Vec<f64> = raw_scores.iter().map(|score| {
            if score.is_finite() { ((score - min_score) + 0.01).max(0.01) } else { 0.01 }
        }).collect();
        let total = shifted.iter().sum::<f64>().max(0.01);
        candidates.iter().cloned().zip(shifted)
            .map(|(candidate, prior)| PolicyPrior { candidate, prior: prior / total })
            .collect()
    }
}
```
**Load-bearing constants (do not alter):** prior floor `0.01`, shift `(score -
min_score) + 0.01`, `.max(0.01)` on both per-candidate shifted weight and on
`total`; non-finite (Reject ⇒ `NEG_INFINITY`) maps to weight `0.01`; `Reject` in
`score()` short-circuits to `f64::NEG_INFINITY`; `delta * activation as f64`
applied exactly once in `verdicts()`. These define the AI's action distribution.

### 3c. `policies/context.rs` — engine-coupled; needs adaptation

```rust
use forge_ai::ai_support::{AiDecisionContext, CandidateAction};   // R2 shim
use forge_ai::ai_support::WaitingFor;                              // R2 shim
use forge_engine::card::Card as GameObject;                       // object = Card
use forge_engine::ids::{CardId as ObjectId, PlayerId};
use forge_engine::player::actions::player_action::{PlayerAction, TargetEntity}; // ~GameAction
use forge_foundation::card_type::CoreType;
// Effect/AbilityDefinition/ResolvedAbility/TargetFilter/TargetRef have NO direct
// engine type — replace with (ApiType, &SpellAbilityIr) and TargetRestrictions.
use forge_engine::ability::api_type::ApiType;
use forge_engine::spellability::SpellAbility;
use forge_engine::spellability::target_restrictions::TargetRestrictions;

use crate::cast_facts::{cast_facts_for_action, effect_profile_for_action, CastFacts, EffectProfile};
use crate::config::{AiConfig, PolicyPenalties};
use crate::eval::{strategic_intent, StrategicIntent};

pub struct PolicyContext<'a> {
    pub state: &'a GameState,
    pub decision: &'a AiDecisionContext,
    pub candidate: &'a CandidateAction,
    pub ai_player: PlayerId,
    pub config: &'a AiConfig,
    pub context: &'a crate::context::AiContext,
    pub cast_facts: Option<CastFacts<'a>>,
}

impl<'a> PolicyContext<'a> {
    // Engine-AGNOSTIC — port verbatim:
    pub fn strategic_intent(&self) -> StrategicIntent { strategic_intent(self.state, self.ai_player) }
    pub fn penalties(&self) -> &PolicyPenalties { &self.config.policy_penalties }
    pub fn deadline_expired(&self) -> bool { self.context.deadline.expired() }
    pub fn can_afford_projection(&self) -> bool {
        if self.context.deadline.expired() { return false; }
        let floor = self.config.search.projection_min_budget_ms;
        if floor == 0 { return true; }
        self.context.deadline.remaining().is_none_or(|r| r.as_millis() >= floor)
    }

    // Engine-COUPLED — re-express over PlayerAction + Card arena + SpellAbility chain:
    pub fn source_object(&self) -> Option<&'a Card> {
        // map_match candidate.action:
        //   CastSpell(PlayOption{card_id,..})      -> self.state.cards.get(card_id.index())
        //   ActivateAbility(AbilityRef{card_id,..})-> self.state.card_opt(card_id)
        //   TargetEntity / Select* during targeting -> source from decision.waiting_for
        //       (PendingCast.object_id / PendingAbility.source_id / trigger source)
        todo!("R3")
    }

    // Returns (ApiType, &SpellAbilityIr) pairs instead of &Effect (R1):
    pub fn effects(&self) -> Vec<(ApiType, &'a forge_engine::ability::ability_ir::SpellAbilityIr)> {
        // CastSpell      -> source_object().get_intrinsic_spell_abilities(), walk each sub_ability
        // ActivateAbility-> card.activated_abilities[ability_index] -> walk sub_ability
        // target-selection states -> decision.waiting_for's pending SpellAbility, walk chain
        todo!("R1+R3")
    }

    pub fn cast_facts(&self) -> Option<CastFacts<'a>> {
        self.cast_facts.clone().or_else(|| match &self.candidate.action {
            PlayerAction::CastSpell(_) =>
                cast_facts_for_action(self.state, &self.candidate.action, self.ai_player),
            _ => None,
        })
    }
    pub fn effect_profile(&self) -> Option<EffectProfile> {
        if let Some(facts) = &self.cast_facts { return Some(facts.profile.clone()); }
        effect_profile_for_action(self.state, &self.candidate.action, self.ai_player)
    }

    pub(crate) fn has_legal_opponent_creature_target(
        &self, restrictions: &TargetRestrictions, source_id: ObjectId,
        mut is_relevant: impl FnMut(ObjectId) -> bool,
    ) -> bool {
        // legal_targets(state, restrictions, ai_player, source_id) -> Vec<TargetEntity>  (R5)
        //   .any(|t| matches!(t, TargetEntity::Card(id))
        //        && { let c = state.card(id);
        //             c.controller != ai_player && c.is_creature() && is_relevant(id) })
        todo!("R5")
    }
}

// Chain walkers — structurally verbatim, leaf type changes Effect -> &SpellAbility:
pub(crate) fn collect_ability_effects(ability: &SpellAbility) -> Vec<&SpellAbility> {
    let mut out = vec![ability];
    let mut cur = ability.sub_ability.as_deref();
    while let Some(sub) = cur { out.push(sub); cur = sub.sub_ability.as_deref(); }
    out
}
```
The two free helpers (`collect_ability_effects` /
`collect_definition_effects`) collapse to **one** in manabrew because there is no
definition/resolved split — both walk `SpellAbility.sub_ability` (`mod.rs:138`).
The `#[cfg(test)] mod tests` block (6 tests) must be rewritten against manabrew
constructors (`GameState::new`, `CardState::get_intrinsic_spell_abilities`, real
`SpellAbility` builders) — but per AGENTS.md "No unit tests unless explicitly
asked," port them only if requested.

---

## 4. Dependencies on other phase-ai modules

The framework does **not** compile standalone. Hard build-order prerequisites
(each its own port spec):
1. `crate::config` — `AiConfig`, `PolicyPenalties`, `config.search.projection_min_budget_ms`, `config.weights`, `config.policy_penalties`. **Port first** (pure data).
2. `crate::context::AiContext` — holds `deadline`, `session` (with `features:
   HashMap<PlayerId, DeckFeatures>`), `weights`; `AiContext::empty(&weights)`.
3. `crate::features::DeckFeatures` — `Default`, per-player cached; consumed by every `activation()`.
4. `crate::decision_kind::classify(&WaitingFor, &GameAction) -> DecisionKind` — routing; **depends on the R2 `WaitingFor`/`GameAction` shims**.
5. `crate::cast_facts` — `CastFacts`, `EffectProfile`, `cast_facts_for_action`, `effect_profile_for_action`. **Depends on R1 effect classification.**
6. `crate::eval::{strategic_intent, StrategicIntent}`.
7. `crate::planner::PolicyPrior { candidate: CandidateAction, prior: f64 }`.
8. `forge-ai::ai_support` (NEW): `AiDecisionContext`, `CandidateAction`, `ActionMetadata`/`TacticalClass`, `WaitingFor` — the R2 shim layer.
9. Sibling policy modules: all 45 registered impls + `policies::mulligan` (the
   12 keepables/mulligan `PolicyId`s) + `policies::activation`,
   `policies::effect_classify`, `policies::strategy_helpers`,
   `policies::combo_line` (stateful `::new()`). The registry will not compile
   until every `Box::new(...)` target exists — stub them returning
   `activation()->None` to bring the framework up incrementally.

Within the three files: `mod.rs` → re-exports `registry`; `registry.rs` →
`context::PolicyContext` + all policies + `decision_kind`/`cast_facts`/`features`/
`planner`/`config`; `context.rs` → `cast_facts`/`config`/`eval` + engine.

---

## 5. Risks — adaptation vs infeasible

**R1 — Typed `Effect` enum has no manabrew equivalent (HIGH, pervasive).**
Phase's `engine::types::ability::Effect` is a closed strongly-typed enum
(`Pump{power,toughness,target}`, `Draw{count,target}`, `Destroy{...}`, …). manabrew
has no such type: behavior is `ApiType` (open ~210-variant verb, `api_type.rs:11`)
+ `SpellAbilityIr` operand bag (`ability_ir.rs:78`), with only 8 numeric APIs
lowered to a typed `EffectIr` (`ability_ir.rs:16`). **Adaptation, not infeasible:**
`context.effects()` returns `(ApiType, &SpellAbilityIr)` and downstream policies
match on `ApiType` + `ir.*` fields (the `api-ir.md` classifier pattern). Every
policy that pattern-matches `Effect::X` must be re-expressed; this is the single
largest porting cost and ripples into `cast_facts`/`effect_classify`.

**R2 — No decision-context / candidate / WaitingFor reification (HIGH).**
Phase scores enumerated `CandidateAction`s inside an `AiDecisionContext{waiting_for,
candidates}`. manabrew's engine never enumerates+scores; it calls typed
`PlayerAgent` callbacks (`agent/mod.rs:23`) and the chosen action is returned, not
ranked. **Must build a `forge-ai::ai_support` shim** that, inside each callback,
(a) reifies a `WaitingFor` value, (b) enumerates candidates — for priority from
`PriorityActionSpace` (`agent/types.rs:86`, via `GameLoop::action_space`
`game_loop/action_space.rs:125`); for combat from `choose_attackers`/
`choose_blockers` args; for targeting from the legal-target set — and (c) wraps
each in `CandidateAction{action, metadata{actor, tactical_class}}`. Feasible
(the legal-action data all exists) but it is **net-new infrastructure**, the
gating dependency for the whole framework.

**R3 — `GameAction` vs `PlayerAction`/`PlayOption` shape mismatch (MEDIUM).**
`source_object()`/`effects()`/`cast_facts()` pattern-match `GameAction` variants
that carry `object_id`+`card_id`+inline `targets`. manabrew `PlayerAction`
(`player_action.rs:11`) / `PlayOption` (`agent/types.rs:16`) carry only `card_id`
(+mode); targets arrive through separate callbacks. The R2 shim's
`CandidateAction.action` should be a `forge-ai`-owned action enum that re-bundles
these so the context matches cleanly; mechanical once R2 lands.

**R4 — `Deadline` not in engine (LOW).** Implement `forge-ai::util::Deadline`
(`after(ms)`, `expired()`, `remaining()->Option<Duration>`) over
`std::time::Instant`. Pure-Rust, no engine coupling. `can_afford_projection`'s
`is_none_or` needs Rust ≥1.82 (or expand to `map_or(true, …)`).

**R5 — `find_legal_targets` / `pending_trigger` not exposed as pure queries
(MEDIUM).** `has_legal_opponent_creature_target` needs a pure
`legal_targets(state, restrictions, source, player) -> Vec<TargetEntity>`. The
validation logic lives in `spellability/target_restrictions.rs` and
`choose_targets_by_kind` (`spellability/mod.rs:1851`) but is wired into agent
callbacks, not a free query — extract a non-mutating helper. Likewise
`state.pending_trigger` has no public accessor (triggers run through
`TriggerHandler`, `game_loop.rs:41`); during trigger-target selection, source the
`SpellAbility` from the active callback args instead.

**R6 — `DeckFeatures` borrow-vs-clone hot-path note (LOW).** The verbatim
`verdicts()` borrows `ctx.context.session.features.get(&ai_player)` to avoid a
per-candidate `DeckFeatures::clone()`. Preserve the `cached-per-decision`
contract in the `AiContext`/`features` ports or the borrow lifetime breaks.

**Nothing here is strictly infeasible on the Forge-DSL engine** — but the
framework is a thin shell over substrates manabrew lacks (R1 effect typing, R2
candidate/decision reification). Budget the bulk of the work there, not in these
three files: the framework logic itself (registry routing, scaling, prior
softmax) ports essentially verbatim.
