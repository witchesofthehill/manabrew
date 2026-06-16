use forge_foundation::ZoneType;

use super::{resolve_defined_player, resolve_numeric_svar, EffectContext};
use crate::agent::GameLogEvent;

/// Mirrors Java's `LookAtEffect.java`.
///
/// `SP$ LookAt | Defined$ You | NumCards$ N`
/// The activating player looks at cards in a hidden zone (e.g. top of library or opponent's hand)
/// without revealing them to others.
/// In the engine this is informational — we notify only the activating player's agent.
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `LookAtEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(LookAtEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let num = if sa.ir.num_cards_text.is_some() {
        resolve_numeric_svar(ctx.game, sa, "NumCards", 1)
    } else {
        resolve_numeric_svar(ctx.game, sa, "ScryNum", 1)
    }
    .max(0) as usize;

    let source_zone = sa.ir.source_zone.unwrap_or(ZoneType::Library);

    let look_player = sa
        .target_chosen
        .target_player
        .or_else(|| {
            sa.defined()
                .and_then(|d| resolve_defined_player(d, sa.activating_player, ctx.game))
        })
        .unwrap_or(sa.activating_player);

    let zone_cards = ctx.game.cards_in_zone(source_zone, look_player).to_vec();
    let count = num.min(zone_cards.len());

    let top = &zone_cards[zone_cards.len() - count..];
    let names: Vec<String> = top
        .iter()
        .map(|&id| ctx.game.card(id).card_name.clone())
        .collect();
    let msg = format!(
        "Looking at top {} card(s) of {:?}: [{}]",
        count,
        source_zone,
        names.join(", ")
    );
    // Only the activating player can see these.
    ctx.agents[sa.activating_player.index()].notify(
        crate::agent::notification::GameNotification::Event(
            GameLogEvent::info(msg).with_player(sa.activating_player),
        ),
    );
}
