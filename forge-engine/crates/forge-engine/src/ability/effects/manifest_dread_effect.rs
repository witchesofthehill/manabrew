//! ManifestDread effect — look at top 2 cards, manifest one, other goes to graveyard.
//!
//! Ported from Java's `ManifestDreadEffect.java`.
//! Manifest Dread N: For each, look at top 2, choose one to manifest, rest to graveyard.

use forge_foundation::ZoneType;

use super::manifest_base_effect::parse_manifest_params;
use super::{emit_zone_trigger, EffectContext};
use crate::ids::{CardId, PlayerId};
use crate::spellability::SpellAbility;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ManifestDreadEffect` class extending `SpellAbilityEffect`.
#[forge_engine_macros::spell_effect(ManifestDreadEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let manifest_params = parse_manifest_params(ctx, sa);
    let amount = manifest_params.amount;
    let controller = sa.activating_player;

    let players = if let Some(def) = sa.defined_player() {
        super::resolve_defined_players(def, controller, ctx.game)
    } else {
        vec![controller]
    };

    for pid in players {
        for _ in 0..amount {
            manifest_dread_once(ctx, sa, pid);
        }
    }
}

/// One iteration of manifest dread: look at top 2, pick one to manifest, rest to graveyard.
fn manifest_dread_once(ctx: &mut EffectContext, _sa: &SpellAbility, player: PlayerId) {
    let lib = ctx.game.cards_in_zone(ZoneType::Library, player).to_vec();
    // Top 2 cards (last 2 in the vec since top = end)
    let top2: Vec<CardId> = lib.into_iter().rev().take(2).collect();
    if top2.is_empty() {
        return;
    }

    // Player chooses one to manifest
    ctx.agents[player.index()].snapshot_state(ctx.game, ctx.mana_pools);
    let chosen = if top2.len() == 1 {
        top2[0]
    } else {
        ctx.agents[player.index()]
            .choose_single_card_for_zone_change(
                ctx.game,
                player,
                &top2,
                "Choose a card to manifest",
                false,
            )
            .unwrap_or(top2[0])
    };

    // Manifest the chosen card
    let old_zone = ctx.game.card(chosen).zone;
    ctx.game.card_mut(chosen).set_face_down(true);
    ctx.game.card_mut(chosen).set_manifested(true);
    ctx.game.card_mut(chosen).set_base_pt(Some(2), Some(2));
    ctx.game.card_mut(chosen).set_controller(player);
    ctx.move_card(chosen, ZoneType::Battlefield, player);
    ctx.trigger_handler
        .register_active_trigger(ctx.game, chosen);
    emit_zone_trigger(ctx.trigger_handler, chosen, old_zone, ZoneType::Battlefield);

    // Put the rest into graveyard
    for &card_id in &top2 {
        if card_id != chosen {
            let gz = ctx.game.card(card_id).zone;
            ctx.move_card(card_id, ZoneType::Graveyard, player);
            emit_zone_trigger(ctx.trigger_handler, card_id, gz, ZoneType::Graveyard);
        }
    }
}
