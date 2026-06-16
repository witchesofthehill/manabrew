//! Shared "cast from effect" pipeline.
//!
//! Provides infrastructure for effects that cast cards without paying mana cost
//! (Discover, Cascade, Suspend, etc.) or with alternate costs.
//!
//! Mirrors Java's:
//! - `AbilityUtils.getBasicSpellsFromPlayEffect()`
//! - `SpellAbility.copyWithNoManaCost()`
//! - `PlayerControllerHuman.playSaFromPlayEffect()`

use forge_foundation::ZoneType;

use super::EffectContext;
use crate::agent::GameLogEvent;
use crate::event::RunParams;
use crate::ids::{CardId, PlayerId};
use crate::spellability::{build_spell_ability, SpellAbility, StackEntry};
use crate::trigger::TriggerType;

/// Cast a card from a play effect, optionally without paying its mana cost.
///
/// This is the main entry point for effects like Discover, Cascade, Suspend,
/// Rebound, etc. that need to cast a spell from a non-standard zone.
///
/// # Arguments
/// * `card_id` — the card to cast
/// * `controller` — the player casting it
/// * `without_mana_cost` — if true, strip mana from the cost (Discover, Cascade)
/// * `label` — display label for log ("Discover", "Cascade", etc.)
///
/// # Returns
/// `true` if the spell was successfully cast (pushed to stack).
pub fn cast_card_from_effect(
    ctx: &mut EffectContext,
    card_id: CardId,
    controller: PlayerId,
    without_mana_cost: bool,
    label: &str,
) -> bool {
    // Build spell ability from the card's first ability
    let abilities = ctx.game.card(card_id).abilities.clone();
    let ability_text = match abilities.first() {
        Some(text) => text.clone(),
        None => return false,
    };

    let mut spell_sa = build_spell_ability(ctx.game, card_id, &ability_text, controller);
    spell_sa.is_spell = true;

    // Remove zone restriction — allow casting from exile/library/etc.
    // Java: newSA.getRestrictions().setZone(null)
    // In Rust, the zone check happens at a higher level; we bypass by
    // marking the spell as cast-from-effect.
    spell_sa.ir.cast_from_play_effect = true;

    // Strip mana cost if requested (Discover, Cascade, etc.)
    // Java: copyWithNoManaCost() — removes Mana cost parts, keeps non-mana costs
    if without_mana_cost {
        if let Some(ref mut cost) = spell_sa.pay_costs {
            cost.parts
                .retain(|part| !matches!(part, crate::cost::CostPart::Mana { .. }));
        }
        spell_sa.ir.without_mana_cost = true;
    }

    // Make costs mandatory (Java: setMandatory(true) for 118.8c)
    if let Some(ref mut cost) = spell_sa.pay_costs {
        cost.mandatory = true;
    }

    // Setup targets
    spell_sa.setup_targets(ctx.game, ctx.agents, ctx.mana_pools);

    // Push to stack
    push_spell_to_stack(ctx, card_id, spell_sa, label);
    true
}

/// Get the list of basic spell abilities from a card that can be cast via a play effect.
///
/// Mirrors Java's `AbilityUtils.getBasicSpellsFromPlayEffect()`.
/// Returns the ability texts that can be cast (non-land spells).
pub fn get_basic_spells(ctx: &EffectContext, card_id: CardId) -> Vec<String> {
    let card = ctx.game.card(card_id);
    let mut spells = Vec::new();

    for ability_text in &card.abilities {
        // Skip non-spell abilities (activated, triggered)
        if ability_text.contains("AB$") || ability_text.contains("T$") {
            continue;
        }
        // Skip land abilities
        if ability_text.contains("LandAbility") {
            continue;
        }
        spells.push(ability_text.clone());
    }

    // If no spell abilities found but card is a permanent, it can be cast as-is
    if spells.is_empty() && card.is_permanent() {
        if let Some(first) = card.abilities.first() {
            spells.push(first.clone());
        }
    }

    spells
}

/// Offer the player a choice: cast a card or put it somewhere else.
///
/// Returns `true` if the player chose to cast, `false` for the alternative.
pub fn offer_cast_or_alternative(
    ctx: &mut EffectContext,
    card_id: CardId,
    controller: PlayerId,
    cast_label: &str,
    alt_label: &str,
) -> bool {
    let card_name = ctx.game.card(card_id).card_name.clone();
    ctx.agents[controller.index()].snapshot_state(ctx.game, ctx.mana_pools);
    ctx.agents[controller.index()].confirm_action(
        controller,
        Some("CastFromEffect"),
        &format!("{}: {} or {}?", card_name, cast_label, alt_label),
        &[cast_label.to_string(), alt_label.to_string()],
        Some(card_id),
        None,
    )
}

// ─── Internal ────────────────────────────────────────────────────────────────

/// Push a spell to the stack, move card to Stack zone, fire triggers.
/// Shared implementation extracted from play_effect.rs.
fn push_spell_to_stack(
    ctx: &mut EffectContext,
    card_id: CardId,
    spell_sa: SpellAbility,
    label: &str,
) {
    let controller = spell_sa.activating_player;
    let is_creature = ctx.game.card(card_id).is_creature();
    let is_permanent = ctx.game.card(card_id).is_permanent();
    let cast_zone = Some(ctx.game.card(card_id).zone);
    let card_name = ctx.game.card(card_id).card_name.clone();
    let chosen_target = spell_sa.target_chosen.target_card;

    let entry = StackEntry {
        id: 0,
        spell_ability: spell_sa,
        is_pending_cast: false,
        is_creature_spell: is_creature,
        is_permanent_spell: is_permanent,
        cast_from_zone: cast_zone,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    };
    let trigger_sa = entry.spell_ability.clone();

    ctx.game.stack.push(entry);
    ctx.move_card(card_id, ZoneType::Stack, controller);
    ctx.game.player_record_spell_cast(controller, card_id);

    ctx.trigger_handler.run_trigger(
        TriggerType::SpellCast,
        RunParams {
            spell_card: Some(card_id),
            spell_controller: Some(controller),
            source_sa: Some(trigger_sa.clone()),
            ..Default::default()
        },
        false,
    );
    super::emit_targeting_triggers(ctx, card_id, &trigger_sa);

    let mut event = GameLogEvent::stack(format!("{}: cast {}", label, card_name))
        .with_player(controller)
        .with_source_card(card_id);
    if let Some(target_id) = chosen_target {
        event = event.with_target_card(target_id);
    }
    crate::agent::notify_all_agents(ctx.agents, event);
}
