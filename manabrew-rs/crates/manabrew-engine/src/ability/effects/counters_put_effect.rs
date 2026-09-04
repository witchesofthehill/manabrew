use forge_foundation::ZoneType;

use super::{parse_counter_type, resolve_defined_player, resolve_numeric_svar, EffectContext};
use crate::ability::ability_ir::DefinedRef;
use crate::agent::GameEntity;
use crate::event::RunParams;
use crate::game_entity_counter_table::GameEntityCounterTable;
use crate::parsing::keys;
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

pub fn build_spell_ability(sa: &mut crate::spellability::SpellAbility) {
    let Some(n) = sa.ir.adapt.clone().or_else(|| sa.ir.monstrosity.clone()) else {
        return;
    };
    sa.ir.counter_type_text = Some("P1P1".to_string());
    sa.ir.counter_type = Some(crate::card::CounterType::P1P1);
    sa.ir.semantic_numeric_params.insert(
        keys::COUNTER_NUM.to_string(),
        crate::ability::ability_ir::NumericParamIr::Raw(n),
    );
}

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `CountersPutEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(CountersPutEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let source_controller = sa
        .source
        .map(|id| ctx.game.card(id).controller)
        .unwrap_or_else(|| ctx.game.player_order[0]);
    let placer = if sa.ir.placer_text.as_deref() == Some("TriggeredSource") {
        sa.get_triggering_player(crate::ability::AbilityKey::Source)
    } else {
        sa.ir.placer_text.as_deref().and_then(|defined| {
            crate::ability::ability_utils::resolve_defined_players_with_sa(
                defined,
                sa,
                source_controller,
                ctx.game,
            )
            .first()
            .copied()
        })
    }
    .unwrap_or(sa.activating_player);
    if sa.ir.triggered_counter_map {
        let Some(crate::event::AbilityValue::CounterMap(counter_map)) = sa
            .trigger_objects
            .get(&crate::ability::AbilityKey::CounterMap)
        else {
            return;
        };
        let Some(card) = resolve_card_target(ctx.game, sa) else {
            return;
        };
        let mut table = GameEntityCounterTable::default();
        for (counter_type, amount) in counter_map {
            table.put(
                Some(placer),
                GameEntity::Card(card),
                parse_counter_type(counter_type),
                sa.ir.counter_map_values.unwrap_or(*amount),
            );
        }
        table.replace_counter_effect(
            ctx.game,
            Some(ctx.trigger_handler),
            Some(ctx.agents),
            Some(sa),
            true,
            RunParams::default(),
        );
        return;
    }
    let counter_type_str = sa.ir.counter_type_text.as_deref().unwrap_or("P1P1");
    // Mirror Java CountersPutEffect.java:625-636 — when none of the multi-type
    // dispatch params are present, route the type through the player controller's
    // chooseCounterType prompt (Java's chooseTypeFromList → pc.chooseCounterType).
    // pickOne consumes RNG even for a single option, so calling the agent here
    // keeps deterministic-parity entropy aligned with Java for fixed-type cards
    // like Rottenmouth Viper (CounterType$ BLIGHT).
    let counter_type = if matches_choose_from_list_path(sa) {
        let options: Vec<crate::card::CounterType> = counter_type_str
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(parse_counter_type)
            .collect();
        if options.is_empty() {
            return;
        }
        ctx.agents[placer.index()].snapshot_state(ctx.game, ctx.mana_pools);
        match ctx.agents[placer.index()].choose_counter_type(
            placer,
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
    // Check for Defined$ — if targeting a player (e.g. Defined$ You for energy),
    // handle player-level counters like ENERGY instead of card counters.
    if let Some(defined) = sa.defined() {
        if let Some(target_player) = resolve_defined_player(defined, source_controller, ctx.game) {
            ctx.add_player_counter(
                target_player,
                &counter_type,
                count,
                sa,
                RunParams {
                    source_player: Some(placer),
                    ..Default::default()
                },
            );
            return;
        }
    }

    // Resolve target card: mirror Java's getDefinedEntitiesOrTargeted().
    // When the SA uses targeting (ValidTgts$), use the chosen target.
    // Otherwise fall back to the Defined$ parameter (default "Self").
    let Some(card_id) = resolve_card_target(ctx.game, sa) else {
        return;
    };

    let is_adapt = sa.ir.adapt.is_some();
    if is_adapt {
        let current = ctx
            .game
            .card(card_id)
            .counter_count(&crate::card::CounterType::P1P1);
        if current > 0
            && !crate::staticability::static_ability_adapt::any_with_adapt(
                &ctx.game.cards,
                sa,
                ctx.game.card(card_id),
            )
        {
            return;
        }
    }

    let is_monstrosity = sa.ir.monstrosity.is_some();
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
    let count = ctx.add_counter(
        card_id,
        &counter_type,
        count,
        sa,
        RunParams {
            source_player: Some(placer),
            ..Default::default()
        },
    );

    if sa.ir.renown && count > 0 {
        ctx.game.card_mut(card_id).set_renowned(true);
    }

    if is_adapt {
        ctx.trigger_handler.run_trigger(
            TriggerType::Adapt,
            RunParams {
                card: Some(card_id),
                ..Default::default()
            },
            false,
        );
    }

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

fn resolve_card_target(
    game: &crate::game::GameState,
    sa: &crate::spellability::SpellAbility,
) -> Option<crate::ids::CardId> {
    let card = if sa.target_restrictions.is_some() && sa.ir.defined.is_none() {
        sa.target_chosen.target_card
    } else {
        match sa.defined_ref() {
            Some(
                DefinedRef::TriggeredTarget
                | DefinedRef::TriggeredTargetLkiCopy
                | DefinedRef::Targeted,
            ) => sa.target_chosen.target_card,
            _ => sa.source,
        }
    }?;
    if matches!(sa.defined_ref(), None | Some(DefinedRef::SelfCard))
        && sa.source == Some(card)
        && sa
            .source_zone_timestamp
            .is_some_and(|created_at| game.card(card).zone_timestamp != created_at)
    {
        return None;
    }
    (game.card(card).zone == ZoneType::Battlefield).then_some(card)
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
