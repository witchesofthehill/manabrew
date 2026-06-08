# Port spec — `phase-ai::tactical_gate`

Source: `phase-rs/phase` → `crates/phase-ai/src/tactical_gate.rs`
Target: `manabrew` → `forge-ai` (new crate, layered on `forge-engine`)
Status: full source recovered verbatim (all fns + numeric constants). Test module not ported (no-op for behavior).

---

## 1. What it does (the AI logic)

`tactical_gate` is a **hard/soft pre-scoring filter** sitting in front of the AI's action scorer. It receives a list of `CandidateAction`s (legal actions the engine offered) and, per candidate, returns one of:

- `GateDecision::Reject` — drop the action entirely (never scored),
- `GateDecision::Allow` — keep, no score change,
- `GateDecision::AllowWithPenalty(f64)` — keep but add a (negative) penalty to its later score.

`gate_candidates(...)` maps each `CandidateAction` through `assess_candidate` and collects survivors as `GatedCandidate { candidate, penalty }`.

The gating encodes **tempo/sequencing heuristics** that are cheap to evaluate but expensive for a scorer to learn:

1. **Cast/activate gating (`assess_pre_cast`)**
   - Reject activated abilities whose source-type condition is statically known false (Figure-of-Fable "if this is a Scout" carve-out).
   - When a **lethal attack** is available and it's the AI's pre-combat main, reject pre-combat main spells (don't tap mana dorks/convoke fodder before swinging for lethal). Carve-out: spells that can deal damage to a player are allowed with a mild penalty (`-5.0`).
   - Reject **counterspells** when the stack is empty or holds only the AI's own spells.
   - Reject **redundant creature-only removal** (no live legal opponent creature target, or the only target is already dying to the stack).
   - For **pure fixed pump** instants/sorceries: reject the cast in the wrong window (post-combat main, opponent main, end step, "other"), or in a pre-combat/before-blocks window where passing preserves a stronger window; in combat windows, reject unless the pump actually changes a combat outcome; on a hostile stack, allow if the pump's toughness can save a creature from a damage spell. When passing preserves a stronger window (own pre-combat / begin-combat / declare-attackers, empty stack), allow with penalty `-1.0`.

2. **Target gating (`reject_futile_target` / `target_choice_penalty`)**
   - Hard-reject `Destroy` aimed at an `Indestructible` object.
   - Penalty `-8.0` for pumping a tapped creature that is **not** in combat.
   - Penalty `-10.0` for a harmful effect targeting an object that already has pending removal on the stack **and** will die from it.

3. **`CancelCast` is always rejected** from the strategic pool (CR 601.2 — announcing commits the caster; cancel is a mechanical escape handled elsewhere by a fallback path, not a strategic option).

### Combat sub-analyses (engine-agnostic math, carry verbatim)

- `pump_changes_combat_outcome(state, ai, +P, +T)` — true if the pump turns a non-lethal unblocked swing lethal, or saves/enables a 1-on-1 trade (for AI's attacker, or AI's blocker against opp attacker).
- `combat_trade_improves(state, mine, opposing, +P, +T)` — `(dies_without_pump && survives_with_pump) || (fails_to_kill_without_pump && kills_with_pump)`.
- `unblocked_attack_becomes_lethal(state, attacker, total_unblocked, +P)` — `total < life && total + P >= life`.
- `pump_can_save_from_hostile_stack(state, ai, +T)` — scans the stack for a fixed-`DealDamage` aimed at the AI's creature where `(toughness - damage_marked) + T > value`; bails to "can't save" on Destroy/Counter/Bounce/ChangeZone.

---

## 2. Phase engine API → manabrew equivalent

`ObjectId` ≡ manabrew `CardId`; Phase "objects" ≡ manabrew "cards"; Phase `state.objects.get(&id)` ≡ `game.card(id)`/`game.cards.get(id.index())`.
All manabrew paths are under `forge-engine/crates/forge-engine/src/` unless noted.

| Phase type / API | manabrew equivalent | cite | notes |
|---|---|---|---|
| `engine::types::game_state::GameState` | `GameState` | game.rs:92 | direct |
| `engine::types::player::PlayerId`, `pid.0 as usize` | `PlayerId(u32)`, `pid.index()` | ids.rs:9,18 | `.0`→`.index()` |
| `engine::types::identifiers::ObjectId` | `CardId(u32)`, `.index()` | ids.rs:5,12 | |
| `state.objects.get(&id) -> Option<&Object>` | `game.card(id) -> &Card` (infallible) **or** `game.cards.get(id.index())` | game.rs:263 / 94 | Phase is fallible; use `game.cards.get(...)` to keep the `Option` pattern (handles stale ids identically) |
| `state.stack` | `game.stack: MagicStack` | game.rs:102 | |
| `state.stack.is_empty()` | `MagicStack::is_empty()` | zone/magic_stack.rs:235 | direct |
| `state.stack.iter()` → entries | `MagicStack::iter() -> impl Iterator<&StackEntry>` | zone/magic_stack.rs:243 | direct |
| stack `entry.controller` | `StackEntry.spell_ability.activating_player` | magic_stack.rs:20; spellability/mod.rs:112 | no `controller` field; use `activating_player` |
| stack `entry.ability() -> Option<&Ability>` | `&StackEntry.spell_ability` (`SpellAbility`, always present) | magic_stack.rs:20 | non-optional; drop the `let Some(ability) = ...` guard |
| `ability.targets: Vec<TargetRef>` | `SpellAbility::get_targets() -> &TargetChoices`; `.all_target_cards()` for `CardId`s | spellability/mod.rs:474; spellability/target_choices.rs | shape differs (see §5) |
| `state.phase: Phase` | `game.turn.phase: PhaseType` | phase/mod.rs:148; forge-foundation/src/phase.rs:5 | variant remap below |
| `Phase::PreCombatMain` | `PhaseType::Main1` | phase.rs:5 | |
| `Phase::PostCombatMain` | `PhaseType::Main2` | | |
| `Phase::BeginCombat` | `PhaseType::CombatBegin` | | |
| `Phase::DeclareAttackers` | `PhaseType::CombatDeclareAttackers` | | |
| `Phase::DeclareBlockers` | `PhaseType::CombatDeclareBlockers` | | |
| `Phase::CombatDamage` | `PhaseType::CombatDamage` **and** `CombatFirstStrikeDamage` | | match BOTH first-strike + normal |
| `Phase::EndCombat` | `PhaseType::CombatEnd` | | |
| `Phase::End` | `PhaseType::EndOfTurn` | | |
| `Phase::Cleanup` | `PhaseType::Cleanup` | | |
| `engine::game::turn_control::turn_decision_maker(state) -> PlayerId` | `game.turn.priority_player` (priority holder) **or** `game.active_player()` (whose turn) | phase/mod.rs:149; game.rs:458 | Phase's fn = "who decides now". For the `own_turn` checks use `game.turn.active_player` (phase/mod.rs:147). **FLAG**: confirm Phase semantics — used as "is it my turn", so `active_player` is the faithful map |
| `state.players[pid.0].life: i32` | `game.player(pid).life` | player/state.rs:16 | |
| `object.power: Option<i32>` | `Card::power() -> i32` (layered) | card/mod.rs:988 | Phase uses raw `Option`+`unwrap_or(0)`; `power()` returns i32. To match exactly: `card.base_power.unwrap_or(0)` (card/mod.rs:231) — **but layered `power()` is more correct**; pick one and note divergence |
| `object.toughness: Option<i32>` | `Card::toughness() -> i32` / `card.base_toughness` | card/mod.rs:1000 / 232 | same caveat |
| `object.damage_marked: u32` | `card.damage: i32` | card/mod.rs:292 | already i32, drop the `as i32` cast |
| `object.tapped: bool` | `card.tapped: bool` | card/mod.rs:257 | direct |
| `object.controller: PlayerId` | `card.controller: PlayerId` | card/mod.rs:209 | direct |
| `object.id` (source) | `card.id: CardId` | card/mod.rs:198 | direct |
| `object.has_keyword(&Keyword::Indestructible)` | `card.has_keyword_enum(Kw::Indestructible)` | card/mod.rs:1269; keyword/keyword_instance.rs:285 | enum is `Keyword`; convenience bool not provided for Indestructible, use enum form |
| `object.card_types.core_types.contains(&CoreType::Creature)` | `card.type_line.core_types.contains(&CoreType::Creature)` / `card.is_creature()` | card/mod.rs:215, 1022; forge-foundation/src/card_type.rs:11 | `CoreType::{Creature,Instant,Sorcery}` all exist |
| `object.abilities.get(ability_index)` | `card.activated_abilities: Vec<ActivatedAbility>`, index | card/mod.rs:350 | Phase's `abilities` is one flat list; manabrew splits intrinsic/activated. ability_index semantics must match the candidate's `AbilityRef.ability_index` (player_action.rs:27) |
| `ability_def.condition: Option<AbilityCondition>` / `AbilityCondition::SourceMatchesFilter{filter}` | **NO direct equivalent** | — | **FLAG (infeasible-as-is).** manabrew has no `AbilityCondition` enum on activated abilities; conditions are Forge-DSL params resolved at activation. See §6 |
| `engine::game::filter::matches_target_filter(state, id, filter, ctx)` | manabrew selector/filter eval (`CompiledSelector`, `matches_valid_*`) | spellability/valid_sa.rs; ability/ability_ir.rs `*_selector` | no single-named twin; adapt to manabrew's selector matcher |
| `engine::game::filter::FilterContext::from_source(state, id)` | manabrew `ManaPaymentContext`/selector context (no exact twin) | mana/mod.rs:273 (analogue) | **FLAG** filter-context constructor differs |
| `state.combat: Option<CombatState>` (on GameState) | `CombatState` lives on **`GameLoop.combat`**, NOT GameState | game_loop.rs:40; combat/mod.rs:65 | **FLAG (architectural).** gate fns must take `&CombatState` (or `Option<&CombatState>`) as an extra arg — it is not reachable from `&GameState` |
| `engine::game::combat::AttackerInfo{object_id, blocked, attack_target}` | `CombatState.attackers: Vec<(CardId, DefenderId)>` + `is_blocked(CardId)` | combat/mod.rs:71,144 | no struct; `.blocked` → `combat.is_blocked(cid)` |
| `engine::game::combat::AttackTarget::Player(PlayerId)` | `DefenderId::Player(PlayerId)` | combat/mod.rs:24 | `AttackTarget`→`DefenderId`; `.as_player()` (combat/mod.rs:40) |
| `combat.blocker_assignments: HashMap<ObjectId,Vec<ObjectId>>` (attacker→blockers) | `CombatState::get_blockers_for(attacker) -> Vec<CardId>` | combat/mod.rs:153 | also `damage_order` (combat/mod.rs:88) |
| `combat.blocker_to_attacker: HashMap<ObjectId,Vec<ObjectId>>` (blocker→attackers) | `CombatState::get_attackers_for(blocker) -> Vec<CardId>` | combat/mod.rs:161 | iterate AI blockers via `get_all_blockers()` (combat/mod.rs:1163) |
| `combat.attackers[].blocked` | `CombatState::is_blocked(attacker)` | combat/mod.rs:144 | |
| **Effect model** `engine::types::ability::Effect` (typed enum: `DealDamage{target,amount}`, `Counter`, `Destroy`, `Pump{power,toughness}`, `Bounce`, `ChangeZone`) | **NO typed Effect enum.** Classify via `SpellAbility.api: Option<ApiType>` + walk `sub_ability` + `SpellAbilityIr` | api-ir.md; ability/api_type.rs:11; spellability/mod.rs:104,138 | **FLAG (largest adaptation).** Build a `forge_ai::effect_classify` shim. Mapping: `DealDamage`→`ApiType::DealDamage`(+`EffectIr::DealDamage`/`DealDamageIr` ability_ir.rs:1227); `Counter`→`ApiType::Counter`; `Destroy`→`ApiType::Destroy`; `Pump`→`ApiType::Pump`; `Bounce`/`ChangeZone`→`ApiType::ChangeZone` (direction via `ir.origin_zone`/`destination_zone`) |
| `Effect::Pump{ power: PtValue::Fixed(i32), toughness: PtValue::Fixed(i32) }` | `ApiType::Pump` with `SpellAbilityIr.num_att`/`num_def: Option<String>` (e.g. `"+2"`) | ability/ability_ir.rs:314,315 | **FLAG.** P/T are raw strings; "pure fixed" = both parse to a literal int (no SVar/`*`). Parse via `parsing/amount.rs` / int parse |
| `Effect::DealDamage{ amount: QuantityExpr::Fixed{value} }` | `EffectIr::DealDamage(DealDamageIr{amount: Option<AmountExpr>})`, `AmountExpr::Literal(i32)` | ability_ir.rs:1227,102; parsing/amount.rs:2 | `QuantityExpr::Fixed`→`AmountExpr::Literal` |
| `TargetFilter::{Any, Player}` (DealDamage target kind) | `ir.valid_tgts_text`/`valid_tgts_selector` (`ValidTgts$`) | ability_ir.rs:88-141 | parse "can target a player / any" from the selector/text |
| `TargetRef::Object(ObjectId)` | `TargetEntity::Card(CardId)` / `TargetChoice::Card` | player/actions/player_action.rs:38; agent/types.rs:63 | |
| `GameAction::{CastSpell, ActivateAbility{source_id,ability_index}, ChooseTarget, SelectTargets, CancelCast}` | `PlayerAction::{CastSpell(PlayOption), ActivateAbility(AbilityRef), TargetEntity, FinishTargeting, ...}` — no `ChooseTarget`/`SelectTargets`/`CancelCast` twins | player/actions/player_action.rs:11 | **FLAG.** forge-ai defines its own `CandidateAction`/`GameAction` analog over manabrew's action model (see §5) |
| `engine::ai_support::{AiDecisionContext, CandidateAction}` | **NO equivalent** — Phase's AI-support layer | — | forge-ai owns these; build over `PriorityActionSpace` (agent/types.rs:86) |

---

## 3. Faithful-port plan + Rust skeleton

Engine-agnostic logic (window classification, all numeric thresholds, combat math) carries **verbatim**. The only rewrites are: (a) thread `&CombatState` as an argument, (b) replace the typed `Effect` enum with a `forge_ai::effect_classify` shim returning a local `Effect` mirror, (c) remap `Phase`/keyword/field names per §2.

```rust
// forge-ai/src/tactical_gate.rs
use std::collections::HashMap;

use forge_engine::combat::{CombatState, DefenderId};
use forge_engine::game::GameState;
use forge_engine::ids::{CardId, PlayerId};
use forge_engine::keyword::Keyword;
use forge_foundation::card_type::CoreType;
use forge_foundation::phase::PhaseType;

use crate::combat_ai::is_lethal_attack_available;
use crate::config::AiConfig;
use crate::context::AiContext;
use crate::policies::context::{collect_ability_effects, PolicyContext};
use crate::policies::effect_classify::{
    effect_polarity, extract_target_filter, targets_creatures_only, Effect, EffectPolarity,
    PtValue, QuantityExpr, TargetFilter,
};
use crate::policies::stack_awareness::{has_pending_removal, will_target_die_from_stack};
use crate::action::{CandidateAction, GameAction, TargetRef}; // forge-ai-local action model

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum GateDecision { Reject, Allow, AllowWithPenalty(f64) }

#[derive(Debug, Clone)]
pub struct GatedCandidate { pub candidate: CandidateAction, pub penalty: f64 }

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TacticalWindow {
    OwnPreCombatMain, OwnPostCombatMain, OpponentMain,
    CombatBeforeBlocks, CombatAfterBlocks, CombatDamage,
    StackResponse, EndStep, Other,
}

#[derive(Debug, Clone, Copy)]
struct TacticalFacts {
    window: TacticalWindow,
    live_stack_response: bool,
    pass_preserves_stronger_window: bool,
}

impl TacticalFacts {
    fn derive(state: &GameState, ai_player: PlayerId) -> Self {
        let live_stack_response = !state.stack.is_empty();
        // Phase turn_decision_maker -> active_player (own-turn test)
        let own_turn = state.turn.active_player == ai_player;
        let window = if live_stack_response {
            TacticalWindow::StackResponse
        } else {
            match state.turn.phase {
                PhaseType::Main1 if own_turn => TacticalWindow::OwnPreCombatMain,
                PhaseType::Main2 if own_turn => TacticalWindow::OwnPostCombatMain,
                PhaseType::Main1 | PhaseType::Main2 => TacticalWindow::OpponentMain,
                PhaseType::CombatBegin | PhaseType::CombatDeclareAttackers => {
                    TacticalWindow::CombatBeforeBlocks
                }
                PhaseType::CombatDeclareBlockers | PhaseType::CombatEnd => {
                    TacticalWindow::CombatAfterBlocks
                }
                PhaseType::CombatFirstStrikeDamage | PhaseType::CombatDamage => {
                    TacticalWindow::CombatDamage
                }
                PhaseType::EndOfTurn | PhaseType::Cleanup => TacticalWindow::EndStep,
                _ => TacticalWindow::Other,
            }
        };
        let pass_preserves_stronger_window = own_turn
            && state.stack.is_empty()
            && matches!(
                state.turn.phase,
                PhaseType::Main1 | PhaseType::CombatBegin | PhaseType::CombatDeclareAttackers
            );
        Self { window, live_stack_response, pass_preserves_stronger_window }
    }
}

pub fn gate_candidates(
    state: &GameState,
    decision: &AiDecisionContext, // forge-ai-local
    candidates: Vec<CandidateAction>,
    ai_player: PlayerId,
    config: &AiConfig,
    context: &AiContext,
) -> Vec<GatedCandidate> {
    candidates.into_iter().filter_map(|candidate| {
        let decision_result = {
            let policy_ctx = PolicyContext {
                state, decision, candidate: &candidate, ai_player, config, context,
                cast_facts: None,
            };
            assess_candidate(&policy_ctx)
        };
        match decision_result {
            GateDecision::Reject => None,
            GateDecision::Allow => Some(GatedCandidate { candidate, penalty: 0.0 }),
            GateDecision::AllowWithPenalty(penalty) => Some(GatedCandidate { candidate, penalty }),
        }
    }).collect()
}

fn assess_candidate(ctx: &PolicyContext<'_>) -> GateDecision {
    match &ctx.candidate.action {
        GameAction::CastSpell { .. } | GameAction::ActivateAbility { .. } => assess_pre_cast(ctx),
        GameAction::ChooseTarget { target: Some(target) } => {
            if let Some(rejection) = reject_futile_target(ctx, target) { return rejection; }
            let penalty = target_choice_penalty(ctx, target);
            if penalty < 0.0 { GateDecision::AllowWithPenalty(penalty) } else { GateDecision::Allow }
        }
        GameAction::ChooseTarget { target: None } => GateDecision::Allow,
        GameAction::SelectTargets { targets } => {
            for target in targets {
                if let Some(rejection) = reject_futile_target(ctx, target) { return rejection; }
            }
            let penalty = targets.iter().map(|t| target_choice_penalty(ctx, t)).sum::<f64>();
            if penalty < 0.0 { GateDecision::AllowWithPenalty(penalty) } else { GateDecision::Allow }
        }
        GameAction::CancelCast => GateDecision::Reject, // CR 601.2 — see §1
        _ => GateDecision::Allow,
    }
}

fn assess_pre_cast(ctx: &PolicyContext<'_>) -> GateDecision {
    // (A) CR 608.2c source-type condition gate — SEE §6 RISK (no manabrew twin).
    if let GameAction::ActivateAbility { source_id, ability_index } = &ctx.candidate.action {
        if let Some(object) = ctx.state.cards.get(source_id.index()) {
            if let Some(ability_def) = object.activated_abilities.get(*ability_index) {
                // ADAPT: manabrew has no AbilityCondition::SourceMatchesFilter.
                // Port target: inspect ability_def's intrinsic condition param and
                // run manabrew's selector matcher on the source. If unrepresentable,
                // omit this block (fail-open) — it only saves wasted mana.
                if let Some(filter) = ability_def.source_match_filter() /* TODO shim */ {
                    if !crate::filter::matches(ctx.state, *source_id, &filter) {
                        return GateDecision::Reject;
                    }
                }
            }
        }
    }

    // (B) lethal-attack pre-combat main gate — VERBATIM thresholds.
    if matches!(
        TacticalFacts::derive(ctx.state, ctx.ai_player).window,
        TacticalWindow::OwnPreCombatMain
    ) && is_lethal_attack_available(ctx.state, ctx.ai_player)
    {
        let effects = ctx.effects();
        let is_direct_damage = effects.iter().any(|e| matches!(
            e, Effect::DealDamage { target: TargetFilter::Any | TargetFilter::Player, .. }
        ));
        if is_direct_damage { return GateDecision::AllowWithPenalty(-5.0); }
        return GateDecision::Reject;
    }

    let effects = ctx.effects();
    if effects.is_empty() { return GateDecision::Allow; }

    // (C) counterspell on empty / own-only stack.
    if effects.iter().any(|e| matches!(e, Effect::Counter { .. }))
        && (ctx.state.stack.is_empty()
            || ctx.state.stack.iter().all(|entry|
                entry.spell_ability.activating_player == ctx.ai_player))
    {
        return GateDecision::Reject;
    }

    // (D) redundant creature-only removal.
    if is_redundant_creature_only_removal(ctx, &effects) { return GateDecision::Reject; }

    // (E) pure fixed pump windowing.
    if let Some((power_bonus, toughness_bonus)) = pure_fixed_pump_bonus(&effects) {
        let source_is_spell = ctx.source_object().is_some_and(|s| {
            s.type_line.core_types.contains(&CoreType::Instant)
                || s.type_line.core_types.contains(&CoreType::Sorcery)
        });
        if source_is_spell {
            let facts = TacticalFacts::derive(ctx.state, ctx.ai_player);
            if should_reject_pump_window(ctx, &facts, power_bonus, toughness_bonus) {
                return GateDecision::Reject;
            }
            if facts.pass_preserves_stronger_window && !facts.live_stack_response {
                return GateDecision::AllowWithPenalty(-1.0);
            }
        }
    }

    GateDecision::Allow
}

fn reject_futile_target(ctx: &PolicyContext<'_>, target: &TargetRef) -> Option<GateDecision> {
    let TargetRef::Object(object_id) = target else { return None; };
    let effects = ctx.effects();
    let is_destroy = effects.iter().any(|e| matches!(e, Effect::Destroy { .. }));
    if is_destroy {
        if let Some(object) = ctx.state.cards.get(object_id.index()) {
            if object.has_keyword_enum(Keyword::Indestructible) {
                return Some(GateDecision::Reject);
            }
        }
    }
    None
}

fn target_choice_penalty(ctx: &PolicyContext<'_>, target: &TargetRef) -> f64 {
    let TargetRef::Object(object_id) = target else { return 0.0; };
    let effects = ctx.effects();

    let is_pump = effects.iter().any(|e| matches!(e, Effect::Pump { .. }));
    if is_pump {
        if let Some(object) = ctx.state.cards.get(object_id.index()) {
            if object.tapped {
                // CombatState threaded in (NOT on GameState — §2 FLAG).
                let in_combat = ctx.combat().is_some_and(|c|
                    c.is_attacking(*object_id) || c.is_blocking(*object_id));
                if !in_combat { return -8.0; }
            }
        }
    }

    let harmful = effects.iter()
        .any(|e| matches!(effect_polarity(e), EffectPolarity::Harmful));
    if harmful
        && has_pending_removal(ctx.state, *object_id)
        && will_target_die_from_stack(ctx.state, *object_id)
    { -10.0 } else { 0.0 }
}

fn is_redundant_creature_only_removal(ctx: &PolicyContext<'_>, effects: &[&Effect]) -> bool {
    let Some(source) = ctx.source_object() else { return false; };
    let mut saw_creature_only_harm = false;
    for effect in effects {
        if !(matches!(effect_polarity(effect), EffectPolarity::Harmful)
            && targets_creatures_only(effect)) { continue; }
        saw_creature_only_harm = true;
        let Some(filter) = extract_target_filter(effect) else { return false; };
        let has_live_opponent_target =
            ctx.has_legal_opponent_creature_target(filter, source.id, |id| {
                !will_target_die_from_stack(ctx.state, id)
            });
        if has_live_opponent_target { return false; }
    }
    saw_creature_only_harm
}

fn pure_fixed_pump_bonus(effects: &[&Effect]) -> Option<(i32, i32)> {
    if effects.is_empty() || !effects.iter().all(|e| matches!(e, Effect::Pump { .. })) {
        return None;
    }
    let (mut power_bonus, mut toughness_bonus) = (0, 0);
    for effect in effects {
        let Effect::Pump { power, toughness, .. } = effect else { return None; };
        let PtValue::Fixed(power) = power else { return None; };
        let PtValue::Fixed(toughness) = toughness else { return None; };
        power_bonus += *power;
        toughness_bonus += *toughness;
    }
    Some((power_bonus, toughness_bonus))
}

fn should_reject_pump_window(
    ctx: &PolicyContext<'_>, facts: &TacticalFacts, power_bonus: i32, toughness_bonus: i32,
) -> bool {
    if facts.live_stack_response
        && pump_can_save_from_hostile_stack(ctx.state, ctx.ai_player, toughness_bonus)
    { return false; }
    match facts.window {
        TacticalWindow::OwnPostCombatMain
        | TacticalWindow::OpponentMain
        | TacticalWindow::EndStep => return true,
        TacticalWindow::OwnPreCombatMain | TacticalWindow::CombatBeforeBlocks => {
            return facts.pass_preserves_stronger_window;
        }
        TacticalWindow::Other => return true,
        TacticalWindow::CombatAfterBlocks
        | TacticalWindow::CombatDamage
        | TacticalWindow::StackResponse => {}
    }
    !pump_changes_combat_outcome(
        ctx.state, ctx.combat(), ctx.ai_player, power_bonus, toughness_bonus)
}

fn pump_can_save_from_hostile_stack(
    state: &GameState, ai_player: PlayerId, toughness_bonus: i32,
) -> bool {
    state.stack.iter().any(|entry| {
        let ability = &entry.spell_ability; // always present (vs Phase Option)
        ability.get_targets().all_target_cards().iter().any(|object_id| {
            let Some(object) = state.cards.get(object_id.index()) else { return false; };
            if object.controller != ai_player || !object.is_creature() { return false; }
            let effects = collect_ability_effects(ability);
            for effect in &effects {
                match effect {
                    Effect::Destroy { .. } | Effect::Counter { .. } | Effect::Bounce { .. }
                    | Effect::ChangeZone { .. } => return false,
                    Effect::DealDamage { amount: QuantityExpr::Fixed { value }, .. } => {
                        let toughness = object.toughness(); // or base_toughness.unwrap_or(0)
                        let remaining = toughness - object.damage; // damage is i32
                        if remaining + toughness_bonus > *value { return true; }
                    }
                    _ => {}
                }
            }
            false
        })
    })
}

fn pump_changes_combat_outcome(
    state: &GameState, combat: Option<&CombatState>,
    ai_player: PlayerId, power_bonus: i32, toughness_bonus: i32,
) -> bool {
    let Some(combat) = combat else { return false; };
    let mut unblocked_per_defender: HashMap<PlayerId, i32> = HashMap::new();
    for (attacker_id, target) in &combat.attackers {
        let Some(attacker_obj) = state.cards.get(attacker_id.index()) else { continue; };
        if attacker_obj.controller != ai_player { continue; }
        let blocked = combat.is_blocked(*attacker_id);
        if !blocked {
            if let DefenderId::Player(defending) = target {
                *unblocked_per_defender.entry(*defending).or_insert(0) += attacker_obj.power();
            }
        }
    }
    for (attacker_id, target) in &combat.attackers {
        let Some(attacker_obj) = state.cards.get(attacker_id.index()) else { continue; };
        let blockers = combat.get_blockers_for(*attacker_id);
        if attacker_obj.controller == ai_player {
            if blockers.is_empty() {
                let total_for_defender = match target {
                    DefenderId::Player(pid) =>
                        unblocked_per_defender.get(pid).copied().unwrap_or(0),
                    _ => 0,
                };
                if unblocked_attack_becomes_lethal(
                    state, *target, total_for_defender, power_bonus) { return true; }
                continue;
            }
            if blockers.len() == 1
                && combat_trade_improves(
                    state, *attacker_id, blockers[0], power_bonus, toughness_bonus)
            { return true; }
        } else {
            for blocker_id in combat.get_blockers_for(*attacker_id) {
                let Some(blocker_obj) = state.cards.get(blocker_id.index()) else { continue; };
                if blocker_obj.controller == ai_player
                    && combat_trade_improves(
                        state, blocker_id, *attacker_id, power_bonus, toughness_bonus)
                { return true; }
            }
        }
    }
    false
}

fn combat_trade_improves(
    state: &GameState, my_creature_id: CardId, opposing_creature_id: CardId,
    power_bonus: i32, toughness_bonus: i32,
) -> bool {
    let Some(my_creature) = state.cards.get(my_creature_id.index()) else { return false; };
    let Some(opposing_creature) = state.cards.get(opposing_creature_id.index()) else { return false; };
    let my_power = my_creature.power();
    let my_toughness = my_creature.toughness() - my_creature.damage;
    let opposing_power = opposing_creature.power();
    let opposing_toughness = opposing_creature.toughness() - opposing_creature.damage;
    let dies_without_pump = my_toughness <= opposing_power;
    let survives_with_pump = my_toughness + toughness_bonus > opposing_power;
    if dies_without_pump && survives_with_pump { return true; }
    let fails_to_kill_without_pump = my_power < opposing_toughness;
    let kills_with_pump = my_power + power_bonus >= opposing_toughness;
    fails_to_kill_without_pump && kills_with_pump
}

fn unblocked_attack_becomes_lethal(
    state: &GameState, attack_target: DefenderId, total_unblocked_damage: i32, power_bonus: i32,
) -> bool {
    let DefenderId::Player(defending_player) = attack_target else { return false; };
    let life = state.player(defending_player).life;
    total_unblocked_damage < life && total_unblocked_damage + power_bonus >= life
}
```

> **Note on the original NB difference:** the Phase `pump_changes_combat_outcome` reads opponent blocks via `combat.blocker_to_attacker` filtered by attacker; manabrew exposes the same relation as `get_blockers_for(attacker)` directly, so the inner opponent-branch loop simplifies to iterating `get_blockers_for(attacker_id)` (shown above). Behaviorally identical; verify against `combat/mod.rs:153,161`.

### Verbatim constants (must not drift)
`-5.0` (direct-damage carve-out), `-8.0` (tapped non-combat pump target), `-10.0` (target dying to stack), `-1.0` (pass-preserves-window pump). Combat comparators are all `<=`, `>`, `>=`, `<` exactly as written above.

---

## 4. Dependencies on other phase-ai modules

These must exist (ported or stubbed) before `tactical_gate` compiles:

| phase-ai path | role here | manabrew port note |
|---|---|---|
| `crate::combat_ai::is_lethal_attack_available(state, ai)` | gate (B) | needs porting; reads attackers/blockers/life — depends on `CombatState` access |
| `crate::config::AiConfig` | passthrough field | trivial config struct |
| `crate::context::AiContext` | passthrough field | trivial |
| `crate::policies::context::PolicyContext` | the ctx wrapper. Methods used: `effects() -> Vec<&Effect>`, `source_object() -> Option<&Card>`, `has_legal_opponent_creature_target(filter, source_id, pred) -> bool`, `combat() -> Option<&CombatState>` (NEW, must add — see §2 combat FLAG); field `cast_facts` | **core dependency.** Must hold `&CombatState` so gate fns can reach combat |
| `crate::policies::context::collect_ability_effects(ability) -> Vec<Effect>` | hostile-stack scan | builds local `Effect`s from a manabrew `SpellAbility` (walks `api`+`sub_ability`+`ir`) |
| `crate::policies::effect_classify::{Effect, EffectPolarity, PtValue, QuantityExpr, TargetFilter, effect_polarity, extract_target_filter, targets_creatures_only}` | the typed-effect shim | **largest dependency** — manabrew has no typed `Effect`; this module synthesizes it from `ApiType`/`SpellAbilityIr` (api-ir.md) |
| `crate::policies::stack_awareness::{has_pending_removal, will_target_die_from_stack}` | target penalties + redundancy | port over manabrew stack (`MagicStack::iter`, target lookup, fixed-damage vs toughness) |
| `crate::action::{CandidateAction, GameAction, TargetRef, AiDecisionContext}` | forge-ai action model | new; wraps `PlayerAction`/`PriorityActionSpace` |

`tactical_gate` itself contains **no** further intra-module call graph beyond the private fns shown; it is a leaf consumer of the above.

---

## 5. Risks — adapt vs infeasible

**Infeasible / hardest (needs design before coding):**
1. **Typed `Effect` enum does not exist in manabrew.** The whole gate is written against `engine::types::ability::Effect`. manabrew classifies via `ApiType` + `SpellAbilityIr` (no `Effect`, api-ir.md). This is a prerequisite shim (`effect_classify` + `collect_ability_effects`), not part of this file, but **nothing here works without it.** Highest-effort dependency.
2. **`AbilityCondition::SourceMatchesFilter`** (Figure-of-Fable gate, block A) has **no manabrew twin** — activated-ability conditions are Forge-DSL params resolved lazily, not a typed enum field. Options: (a) build a narrow shim that reads the ability's intrinsic condition param and runs the selector matcher; (b) omit the block (fail-open — it only avoids wasted mana, never correctness). Recommend (b) for v1, file a follow-up.
3. **`CombatState` is on `GameLoop`, not `GameState`.** Phase reads `state.combat`; manabrew keeps combat outside `GameState` (game_loop.rs:40). Every combat-reading fn must take `Option<&CombatState>` as a parameter, and `PolicyContext` must carry it. Structural change to the signatures (already reflected in skeleton).

**Adaptation (mechanical, low risk):**
4. **`Phase` → `PhaseType` remap** — clean 1:1 except `CombatDamage` must match BOTH `CombatFirstStrikeDamage` and `CombatDamage` (manabrew splits the step).
5. **`power`/`toughness` Option vs layered accessor.** Phase reads raw `Option<i32>` + `unwrap_or(0)`; manabrew's faithful choice is layered `power()`/`toughness()` (card/mod.rs:988,1000), which is *more* correct but can diverge from raw base in pumped boards. Pick layered accessors and document; tests must be re-baselined.
6. **Pump P/T are raw strings (`num_att`/`num_def`)** in manabrew (ability_ir.rs:314), not `PtValue::Fixed(i32)`. "pure fixed pump" = both parse to a bare integer (reject SVar/`*`/`+X`). Parsing lives in the `effect_classify` shim.
7. **Action model** (`CandidateAction`/`GameAction`/`ChooseTarget`/`SelectTargets`/`CancelCast`) is phase-ai-private; manabrew's `PlayerAction` has different variants. forge-ai must define its own and map to/from `PriorityActionSpace`.
8. **Stack entry shape**: manabrew `StackEntry.spell_ability` is always present (no `entry.ability()` Option) and uses `activating_player` for controller; the `let Some(ability) = entry.ability()` guard drops out. Targets come from `SpellAbility::get_targets().all_target_cards()` (spellability/mod.rs:474), which returns `CardId`s only — Phase's `TargetRef` could also be a player; if any stack effect targets a player the redundancy/save scans silently skip it (matches Phase, which guards `TargetRef::Object`).

**No-equivalent flags (summary):** `AbilityCondition::SourceMatchesFilter` (#2), typed `Effect` (#1), `state.combat` on GameState (#3), `engine::game::filter::FilterContext::from_source` (no named twin), `engine::ai_support::*` and the `CandidateAction`/`GameAction` model (forge-ai-owned).

---

## 6. Implementer checklist
1. Build `forge-ai::policies::effect_classify` (typed `Effect` over `ApiType`/`SpellAbilityIr`) + `collect_ability_effects` FIRST — everything depends on it.
2. Add `combat: Option<&CombatState>` to `PolicyContext` and a `combat()` accessor.
3. Port `stack_awareness` (`has_pending_removal`, `will_target_die_from_stack`) and `combat_ai::is_lethal_attack_available`.
4. Define forge-ai action model (`CandidateAction`/`GameAction`/`TargetRef`/`AiDecisionContext`).
5. Drop in this file with the §3 skeleton; keep all numeric constants and comparators verbatim.
6. v1: omit block (A) (fail-open) unless the condition shim is ready.
