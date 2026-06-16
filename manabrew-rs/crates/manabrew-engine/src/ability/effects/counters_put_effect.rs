use forge_foundation::ZoneType;

use super::{parse_counter_type, resolve_defined_player, resolve_numeric_svar, EffectContext};
use crate::ability::ability_ir::DefinedRef;
use crate::card::CounterType;
use crate::event::RunParams;
use crate::parsing::keys;
use crate::replacement::replacement_handler::{apply_replacements_with_agents, ReplacementEvent};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `CountersPutEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(CountersPutEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let counter_type_str = sa.ir.counter_type_text.as_deref().unwrap_or("P1P1");
    // Mirror Java CountersPutEffect.java:625-636 — when none of the multi-type
    // dispatch params are present, route the type through the player controller's
    // chooseCounterType prompt (Java's chooseTypeFromList → pc.chooseCounterType).
    // pickOne consumes RNG even for a single option, so calling the agent here
    // keeps deterministic-parity entropy aligned with Java for fixed-type cards
    // like Rottenmouth Viper (CounterType$ BLIGHT).
    let counter_type = if matches_choose_from_list_path(sa) {
        let placer_controller = sa
            .source
            .map(|id| ctx.game.card(id).controller)
            .unwrap_or_else(|| ctx.game.player_order[0]);
        let options: Vec<crate::card::CounterType> = counter_type_str
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(parse_counter_type)
            .collect();
        if options.is_empty() {
            return;
        }
        ctx.agents[placer_controller.index()].snapshot_state(ctx.game, ctx.mana_pools);
        match ctx.agents[placer_controller.index()].choose_counter_type(
            placer_controller,
            &options,
            "Select counter type",
        ) {
            Some(chosen) => chosen,
            None => return,
        }
    } else {
        sa.ir
            .counter_type
            .clone()
            .unwrap_or_else(|| parse_counter_type(counter_type_str))
    };
    // Support SVar references for CounterNum (e.g. Count$Kicked.4.0 for kicker cards)
    let mut count = resolve_numeric_svar(ctx.game, sa, keys::COUNTER_NUM, 1);
    // Modular death triggers: override the static Modular N with the
    // actual LKI +1/+1 counter count from the dying creature (CR 702.43b).
    // trigger_remembered_amount is set by the death path's LKI capture.
    if sa.ir.modular && sa.trigger_remembered_amount > 0 {
        count = sa.trigger_remembered_amount;
    }

    // Resolve the controller of this ability (for Defined$ You etc.)
    let source_controller = sa
        .source
        .map(|id| ctx.game.card(id).controller)
        .unwrap_or_else(|| ctx.game.player_order[0]);
    // Check for Defined$ — if targeting a player (e.g. Defined$ You for energy),
    // handle player-level counters like ENERGY instead of card counters.
    if let Some(defined) = sa.defined() {
        if let Some(target_player) = resolve_defined_player(defined, source_controller, ctx.game) {
            match &counter_type {
                CounterType::Named(name) if name == "ENERGY" => {
                    ctx.game.player_add_energy(target_player, count);
                    return;
                }
                _ => {
                    // Other player-level counters (e.g. EXPERIENCE) can be
                    // added here in the future. For now, fall through to
                    // the card path if we somehow arrive here.
                }
            }
        }
    }

    // Resolve target card: mirror Java's getDefinedEntitiesOrTargeted().
    // When the SA uses targeting (ValidTgts$), use the chosen target.
    // Otherwise fall back to the Defined$ parameter (default "Self").
    let uses_targeting = sa.target_restrictions.is_some();
    let target_id = if uses_targeting && sa.ir.defined.is_none() {
        // Targeting mode — use the actual chosen target (Necropede death trigger, etc.)
        sa.target_chosen.target_card
    } else {
        match sa.defined_ref() {
            // Java AbilityUtils "TriggeredTarget*" / "Targeted" resolve from actual
            // target choices only; if no target was chosen (e.g. TargetMin$ 0), they
            // resolve to empty and do nothing.
            Some(
                DefinedRef::TriggeredTarget
                | DefinedRef::TriggeredTargetLkiCopy
                | DefinedRef::Targeted,
            ) => sa.target_chosen.target_card,
            _ => sa.source,
        }
    };
    let Some(card_id) = target_id else { return };
    if matches!(sa.defined_ref(), None | Some(DefinedRef::SelfCard)) && sa.source == Some(card_id) {
        // Java parity: self-referential card effects must apply to the same object instance.
        // If host card changed zones, this ability resolves with no effect on the new object.
        if let Some(created_at) = sa.source_zone_timestamp {
            if ctx.game.card(card_id).zone_timestamp != created_at {
                return;
            }
        }
    }
    if ctx.game.card(card_id).zone != ZoneType::Battlefield {
        return;
    }

    // Adapt gate: if Adapt$ True, only place counters if creature has no +1/+1 counters.
    // Mirrors Java CountersPutEffect lines 498-501.
    let is_adapt = sa.ir.adapt;
    if is_adapt {
        let current = ctx
            .game
            .card(card_id)
            .counter_count(&crate::card::CounterType::P1P1);
        if current > 0 {
            return;
        }
    }

    let is_monstrosity = sa.ir.monstrosity;
    if is_monstrosity && ctx.game.card(card_id).monstrous {
        return;
    }

    let is_bloodthirst = sa.ir.bloodthirst;
    if is_bloodthirst && !ctx.game.player_has_bloodthirst(source_controller) {
        return;
    }

    if crate::staticability::static_ability_cant_put_counter::any_cant_put_counter_on_card(
        &ctx.game.cards,
        ctx.game.card(card_id),
        &counter_type,
    ) {
        return;
    }
    if let Some(max) = crate::staticability::static_ability_max_counter::max_counter(
        &ctx.game.cards,
        ctx.game.card(card_id),
        &counter_type,
    ) {
        let current = ctx.game.card(card_id).counter_count(&counter_type);
        if current >= max {
            return;
        }
    }
    // Run AddCounter replacement effects (e.g. Hardened Scales adds extra).
    let mut event = ReplacementEvent::AddCounter {
        target: card_id,
        counter_type: counter_type.clone(),
        count,
        is_effect: true,
    };
    apply_replacements_with_agents(&mut *ctx.game, ctx.agents, &mut event);
    let count = if let ReplacementEvent::AddCounter {
        count: final_count, ..
    } = event
    {
        final_count
    } else {
        count
    };
    let cause_player = ctx.game.card(card_id).controller;
    ctx.game.card_mut(card_id).add_counter(&counter_type, count);

    // Mark creature as renowned after successfully placing counters.
    if sa.ir.renown {
        ctx.game.card_mut(card_id).set_renowned(true);
    }

    // Per-target `CounterAdded` firing.
    ctx.trigger_handler.run_trigger(
        TriggerType::CounterAdded,
        RunParams {
            card: Some(card_id),
            counter_type: Some(format!("{:?}", counter_type)),
            counter_amount: Some(count),
            cause_player: Some(cause_player),
            ..Default::default()
        },
        false,
    );
    // Java fires `CounterAddedOnce` once per effect regardless of target
    // count. Rust's counters_put_effect currently handles a single target per
    // resolve, so firing it once here matches Java semantics.
    ctx.trigger_handler.run_trigger(
        TriggerType::CounterAddedOnce,
        RunParams {
            card: Some(card_id),
            counter_type: Some(format!("{:?}", counter_type)),
            counter_amount: Some(count),
            cause_player: Some(cause_player),
            ..Default::default()
        },
        false,
    );

    if is_monstrosity {
        ctx.game.card_mut(card_id).set_monstrous(true);
        ctx.trigger_handler.run_trigger(
            TriggerType::BecomeMonstrous,
            RunParams {
                card: Some(card_id),
                counter_amount: Some(count),
                ..Default::default()
            },
            false,
        );
    }
}

/// True when CountersPutEffect.java:625-636 would route the CounterType
/// through `chooseTypeFromList` (i.e. `pc.chooseCounterType`). Any of these
/// params steers Java into a different dispatch branch above line 624 or
/// resolves the type without prompting (UniqueType / CounterTypePerDefined
/// also call chooseTypeFromList but inside resolvePerType, not here).
fn matches_choose_from_list_path(sa: &SpellAbility) -> bool {
    #[allow(dead_code)]
    const SKIP_PARAMS: &[&str] = &[
        "EachExistingCounter",
        "EachFromSource",
        "UniqueType",
        "CounterTypePerDefined",
        "CounterTypes",
        "ChooseDifferent",
        "PutOnEachOther",
        "PutOnDefined",
        "TriggeredCounterMap",
        "SharedKeywords",
    ];
    sa.ir.simple_counter_type_choice_path
}

#[cfg(test)]
mod tests {
    use crate::ability::spell_ability_effect::SpellAbilityEffect;
    use std::collections::HashMap;

    use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};

    use crate::ability::effects::EffectContext;
    use crate::agent::PassAgent;
    use crate::card::{Card, CounterType};
    use crate::game::GameState;
    use crate::ids::{CardId, PlayerId};
    use crate::mana::ManaPool;
    use crate::spellability::SpellAbility;
    use crate::trigger::handler::TriggerHandler;

    fn make_creature(game: &mut GameState, owner: PlayerId, name: &str) -> CardId {
        let card = Card::new(
            CardId(0),
            name.to_string(),
            owner,
            CardTypeLine::parse("Creature - Golem"),
            ManaCost::parse("5"),
            ColorSet::COLORLESS,
            Some(3),
            Some(3),
            vec![],
            vec![],
        );
        game.create_card(card)
    }

    fn make_ctx<'a>(
        game: &'a mut GameState,
        agents: &'a mut Vec<Box<dyn crate::agent::PlayerAgent>>,
        trigger_handler: &'a mut TriggerHandler,
        mana_pools: &'a mut Vec<ManaPool>,
        token_templates: &'a HashMap<String, Card>,
        token_art_variants: &'a HashMap<(String, String), usize>,
        token_fallback: &'a HashMap<String, String>,
        edition_dates: &'a HashMap<String, String>,
        rng: &'a mut dyn crate::game_rng::GameRng,
    ) -> EffectContext<'a> {
        EffectContext {
            game,
            combat: None,
            agents,
            trigger_handler,
            token_templates,
            token_art_variants,
            token_fallback,
            edition_dates,
            mana_pools,
            parent_target_card: None,
            rng,
        }
    }

    #[test]
    fn monstrosity_only_applies_once() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);
        let clay_golem = make_creature(&mut game, p0, "Clay Golem");
        game.move_card(clay_golem, ZoneType::Battlefield, p0);

        let sa = SpellAbility::new_simple(
            Some(clay_golem),
            p0,
            "AB$ PutCounter | Defined$ Self | Monstrosity$ True | CounterNum$ 4 | CounterType$ P1P1",
        );

        let mut trigger_handler = TriggerHandler::new();
        let mut agents: Vec<Box<dyn crate::agent::PlayerAgent>> =
            vec![Box::new(PassAgent), Box::new(PassAgent)];
        let mut mana_pools = vec![ManaPool::default(), ManaPool::default()];
        let token_templates = HashMap::new();
        let templates_variants: HashMap<(String, String), usize> = HashMap::new();
        let token_fallback: HashMap<String, String> = HashMap::new();
        let edition_dates: HashMap<String, String> = HashMap::new();
        let mut rng_adapter = crate::game_rng::ThreadRngAdapter;
        let mut ctx = make_ctx(
            &mut game,
            &mut agents,
            &mut trigger_handler,
            &mut mana_pools,
            &token_templates,
            &templates_variants,
            &token_fallback,
            &edition_dates,
            &mut rng_adapter,
        );

        super::CountersPutEffect::resolve(&mut ctx, &sa);
        assert_eq!(
            ctx.game.card(clay_golem).counter_count(&CounterType::P1P1),
            4
        );
        assert!(ctx.game.card(clay_golem).monstrous);

        super::CountersPutEffect::resolve(&mut ctx, &sa);
        assert_eq!(
            ctx.game.card(clay_golem).counter_count(&CounterType::P1P1),
            4
        );
        assert!(ctx.game.card(clay_golem).monstrous);
    }

    #[test]
    fn monstrous_resets_after_leaving_battlefield() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);
        let clay_golem = make_creature(&mut game, p0, "Clay Golem");
        game.move_card(clay_golem, ZoneType::Battlefield, p0);
        game.card_mut(clay_golem).set_monstrous(true);

        game.move_card(clay_golem, ZoneType::Hand, p0);

        assert!(!game.card(clay_golem).monstrous);
    }
}
