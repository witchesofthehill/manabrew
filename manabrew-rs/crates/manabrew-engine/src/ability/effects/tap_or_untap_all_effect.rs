use forge_foundation::ZoneType;

use super::{matches_valid_cards_for_sa, resolve_defined_players, EffectContext};
use crate::agent::BinaryChoiceKind;
use crate::ids::{CardId, PlayerId};

/// `SP$ TapOrUntapAll` — choose tap or untap, then apply to all matching cards.
///
/// Mirrors Java `TapOrUntapAllEffect.java` binary prompt behavior.
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `TapOrUntapAllEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(TapOrUntapAllEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;
    let source_name = sa
        .source
        .map(|cid| ctx.game.card(cid).card_name.clone())
        .unwrap_or_else(|| "Ability".to_string());

    let prompt = "Tap or untap all matching permanents?";
    let to_tap = ctx.agents[controller.index()].choose_binary(
        controller,
        prompt,
        BinaryChoiceKind::TapOrUntap,
        None,
        sa.source,
        sa.api,
    );

    let valid_filter = sa
        .ir
        .valid_cards_text
        .as_deref()
        .unwrap_or("Permanent")
        .to_string();
    let valid_selector = sa.ir.valid_cards_selector.as_ref();

    let restrict_controllers: Option<Vec<PlayerId>> =
        if let Some(pid) = sa.target_chosen.target_player {
            Some(vec![pid])
        } else if let Some(defined) = sa.ir.defined_text.as_deref() {
            Some(resolve_defined_players(defined, controller, ctx.game))
        } else {
            None
        };

    let mut cards: Vec<CardId> = Vec::new();
    for &pid in &ctx.game.player_order {
        for cid in ctx
            .game
            .cards_in_zone(ZoneType::Battlefield, pid)
            .iter()
            .copied()
        {
            if let Some(ref allowed) = restrict_controllers {
                if !allowed.contains(&ctx.game.card(cid).controller) {
                    continue;
                }
            }
            if matches_valid_cards_for_sa(
                ctx.game,
                sa,
                ctx.game.card(cid),
                valid_selector,
                &valid_filter,
            ) {
                cards.push(cid);
            }
        }
    }

    for cid in cards {
        if ctx.game.card(cid).zone != ZoneType::Battlefield {
            continue;
        }
        if to_tap {
            if ctx.game.tap(cid) {
                ctx.trigger_handler.run_trigger(
                    crate::trigger::TriggerType::Taps,
                    crate::event::RunParams {
                        card: Some(cid),
                        player: Some(controller),
                        ..Default::default()
                    },
                    false,
                );
            }
        } else if ctx.game.untap(cid) {
            ctx.trigger_handler.run_trigger(
                crate::trigger::TriggerType::Untaps,
                crate::event::RunParams {
                    card: Some(cid),
                    player: Some(controller),
                    ..Default::default()
                },
                false,
            );
        }
    }
}
