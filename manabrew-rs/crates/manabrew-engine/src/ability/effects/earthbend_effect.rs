//! Earthbend — turn a land into a 0/0 creature with haste and +1/+1 counters.
//! Ported from Java's EarthbendEffect: adds creature type, haste, and counters
//! to target land, plus sets up a delayed trigger to return it when it dies.

use forge_foundation::{CoreType, ZoneType};

use super::EffectContext;
use crate::ids::CardId;
use crate::parsing::Params;
use crate::trigger::handler::DelayedTrigger;
use crate::trigger::{parse_trigger, TriggerType};

/// Configure the spell ability during construction.
/// Mirrors Java `EarthbendEffect.buildSpellAbility` — sets up targeting to
/// require "Land.YouCtrl" (a land you control).
pub fn build_spell_ability(sa: &mut crate::spellability::SpellAbility) {
    use crate::parsing::Params;
    use crate::spellability::TargetRestrictions;

    // Build target restrictions for "Land.YouCtrl"
    let params = Params::from_raw("ValidTgts$ Land.YouCtrl | TgtPrompt$ land you control");
    if let Some(tr) = TargetRestrictions::new(&params) {
        sa.target_restrictions = Some(tr);
    }
}

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `EarthbendEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(EarthbendEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let num = super::resolve_numeric_svar(ctx.game, sa, "Num", 1).max(0);

    let targets: Vec<CardId> = if let Some(target) = sa.target_chosen.target_card {
        vec![target]
    } else {
        return;
    };

    for card_id in targets {
        if ctx.game.card(card_id).zone != ZoneType::Battlefield {
            continue;
        }

        ctx.game
            .card_mut(card_id)
            .capture_changed_characteristics_baseline_if_needed();

        // Set base P/T to 0/0
        ctx.game.card_mut(card_id).set_base_pt(Some(0), Some(0));

        // Add Creature core type
        ctx.game
            .card_mut(card_id)
            .add_type(CoreType::Creature.name());

        // Add Haste keyword
        if !ctx
            .game
            .card(card_id)
            .keywords
            .contains_string_ignore_case("Haste")
        {
            ctx.game.card_mut(card_id).add_intrinsic_keyword("Haste");
        }

        // Add +1/+1 counters
        let counter_type = super::parse_counter_type("P1P1");
        ctx.game.card_mut(card_id).add_counter(&counter_type, num);

        register_return_trigger(ctx, sa, card_id, ZoneType::Graveyard);
        register_return_trigger(ctx, sa, card_id, ZoneType::Exile);
    }
}

fn register_return_trigger(
    ctx: &mut EffectContext,
    sa: &crate::spellability::SpellAbility,
    card_id: CardId,
    zone: ZoneType,
) {
    let trigger_raw = match zone {
        ZoneType::Graveyard => {
            "Mode$ ChangesZone | ValidCard$ Card.IsTriggerRemembered | Origin$ Battlefield | Destination$ Graveyard | TriggerDescription$ When it dies or is exiled, return it to the battlefield tapped."
        }
        ZoneType::Exile => {
            "Mode$ Exiled | Origin$ Battlefield | ValidCard$ Card.IsTriggerRemembered | TriggerZones$ Battlefield | TriggerDescription$ When it dies or is exiled, return it to the battlefield tapped."
        }
        _ => return,
    };

    let mut next_id = 0;
    let Some(trigger) = parse_trigger(trigger_raw, &mut next_id) else {
        return;
    };
    let source_card = sa.source.unwrap_or(card_id);
    let origin = match zone {
        ZoneType::Graveyard => "Graveyard",
        ZoneType::Exile => "Exile",
        _ => return,
    };
    let execute_svar = format!(
        "DB$ ChangeZone | Defined$ DelayTriggerRemembered | Origin$ {origin} | Destination$ Battlefield | Tapped$ True | GainControl$ You"
    );

    ctx.trigger_handler
        .register_delayed_trigger(DelayedTrigger {
            mode: match zone {
                ZoneType::Graveyard => TriggerType::ChangesZone,
                ZoneType::Exile => TriggerType::Exiled,
                _ => unreachable!(),
            },
            trigger_mode: trigger.mode,
            params: Params::from_raw(trigger_raw),
            execute_svar,
            controller: sa.activating_player,
            source_card,
            created_turn: ctx.game.turn.turn_number,
            created_phase: ctx.game.turn.phase,
            target_card: Some(card_id),
            remembered_amount: 0,
            remembered_cards: vec![card_id],
            remembered_players: Vec::new(),
            remembered_lki_cards: Vec::new(),
            sort_after_active: false,
            trigger_order: None,
        });
}
