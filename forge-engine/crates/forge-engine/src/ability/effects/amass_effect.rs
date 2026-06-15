//! Amass effect — create or grow an Army token.
//!
//! Ported from Java's `AmassEffect.java`.
//!
//! Amass N {Type}: Put N +1/+1 counters on an Army you control.
//! If you don't control one, create a 0/0 black {Type} Army creature token first.
//! If the Army isn't a {Type}, it becomes a {Type} in addition to its other types.

use crate::parsing::keys;
use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};

use super::token_effect_base::{TokenEffectBase, TOKEN_EFFECT_BASE};
use super::{parse_counter_type, EffectContext};
use crate::card::card_zone_table::CardZoneTable;
use crate::card::Card;
use crate::ids::CardId;
use crate::spellability::SpellAbility;
use crate::staticability::parse_static_ability;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `AmassEffect` class extending `SpellAbilityEffect`.
#[forge_engine_macros::spell_effect(AmassEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;
    let amount = super::resolve_numeric_svar(ctx.game, sa, "Num", 1).max(0);
    let amass_type = sa.ir.type_filter.as_deref().unwrap_or("Zombie");

    // Step 1: If no Army on battlefield, create one
    let has_army = ctx.game.cards.iter().any(|c| {
        c.zone == ZoneType::Battlefield
            && c.controller == controller
            && c.type_line
                .subtypes
                .iter()
                .any(|s| s.eq_ignore_ascii_case("Army"))
    });

    if !has_army {
        create_army_token(ctx, sa, controller, amass_type);
    }

    // Step 2: Find all Armies
    let armies: Vec<CardId> = ctx
        .game
        .cards
        .iter()
        .filter(|c| {
            c.zone == ZoneType::Battlefield
                && c.controller == controller
                && c.type_line
                    .subtypes
                    .iter()
                    .any(|s| s.eq_ignore_ascii_case("Army"))
        })
        .map(|c| c.id)
        .collect();

    if armies.is_empty() {
        return;
    }

    // Step 3: Choose an Army (auto-select if only one)
    let target = if armies.len() == 1 {
        armies[0]
    } else {
        ctx.agents[controller.index()].snapshot_state(ctx.game, ctx.mana_pools);
        ctx.agents[controller.index()]
            .choose_single_card_for_zone_change(
                ctx.game,
                controller,
                &armies,
                "Choose an Army",
                false,
            )
            .unwrap_or(armies[0])
    };

    // RememberAmass$
    if sa.param_is_true(keys::REMEMBER_AMASS) {
        if let Some(source_id) = sa.source {
            ctx.game.card_mut(source_id).add_remembered_card(target);
        }
    }

    // Step 4: Add +1/+1 counters
    let counter_type = parse_counter_type("P1P1");
    ctx.game.card_mut(target).add_counter(&counter_type, amount);

    // Step 5: If Army doesn't have the amass type, add it via effect
    let has_type = ctx
        .game
        .card(target)
        .type_line
        .subtypes
        .iter()
        .any(|s| s.eq_ignore_ascii_case(amass_type));

    if !has_type {
        add_type_effect(ctx, sa, controller, target, amass_type);
    }
}

/// Create a 0/0 black {Type} Army creature token.
fn create_army_token(
    ctx: &mut EffectContext,
    _sa: &SpellAbility,
    controller: crate::ids::PlayerId,
    amass_type: &str,
) {
    let army_script = format!("b_0_0_{}_army", amass_type.to_lowercase());
    let mut token = TOKEN_EFFECT_BASE.require_token_template(ctx.token_templates, &army_script);
    token.set_owner(controller);
    token.set_controller(controller);
    token.set_is_token(true);
    token.set_s_var("TokenScript", army_script);
    token.set_s_var("TokenSpawningAbility", _sa.ability_text.clone());
    token.card_name = format!("{} Army Token", amass_type);
    token.type_line = CardTypeLine::parse(&format!("Creature - {} Army", amass_type));

    let token_table = TOKEN_EFFECT_BASE.make_token_table_internal(controller, token, 1);
    let mut trigger_list = CardZoneTable::default();
    let result =
        TOKEN_EFFECT_BASE.make_token_table(ctx, token_table, false, &mut trigger_list, _sa);
    if !result.created.is_empty() {
        trigger_list.trigger_changes_zone_all(ctx.trigger_handler, ctx.game, Some(_sa));
    }
}

/// Add a creature type to the Army via a command-zone continuous effect.
/// Mirrors Java's createEffect + AddType$ static ability (lines 101-110).
fn add_type_effect(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    controller: crate::ids::PlayerId,
    target: CardId,
    amass_type: &str,
) {
    let mut effect = Card::new(
        CardId(0),
        "Amass Effect".to_string(),
        controller,
        CardTypeLine::parse("Effect"),
        ManaCost::parse("0"),
        ColorSet::COLORLESS,
        None,
        None,
        vec![],
        vec![],
    );
    effect.set_controller(controller);
    effect.set_effect_source(sa.source);
    effect.add_remembered_card(target);
    effect.set_temp_effect_host(Some(target)); // Removed when target leaves play

    let static_text = format!(
        "Mode$ Continuous | Affected$ Card.IsRemembered | EffectZone$ Command | AddType$ {}",
        amass_type
    );
    if let Some(parsed) = parse_static_ability(&format!("S$ {}", static_text)) {
        effect.add_static_ability(parsed);
    }

    let effect_id = ctx.game.create_card(effect);
    ctx.move_card(effect_id, ZoneType::Command, controller);
}
