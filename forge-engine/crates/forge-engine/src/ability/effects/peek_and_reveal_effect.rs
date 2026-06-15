use forge_foundation::ZoneType;

use super::{resolve_numeric_svar, EffectContext};

/// Mirrors Java's `PeekAndRevealEffect.java`.
#[forge_engine_macros::spell_effect(PeekAndRevealEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let num = if sa.ir.peek_amount_text.is_some() {
        resolve_numeric_svar(ctx.game, sa, "PeekAmount", 1)
    } else {
        resolve_numeric_svar(ctx.game, sa, "NumCards", 1)
    }
    .max(0) as usize;
    let remember_revealed = sa.ir.remember_revealed;
    let imprint_revealed = sa.ir.imprint_revealed;
    let remember_peeked = sa.ir.remember_peeked;
    let reveal_optional = sa.ir.reveal_optional;

    let peeking_player = sa.activating_player;
    let no_peek = sa.ir.no_peek;
    let no_reveal = sa.ir.no_reveal;
    let src_zone = sa.ir.source_zone.unwrap_or(ZoneType::Library);

    let src_zone_players =
        crate::ability::spell_ability_effect::get_defined_players_or_targeted(ctx.game, sa);
    let players: Vec<_> = if src_zone_players.is_empty() {
        vec![peeking_player]
    } else {
        src_zone_players
    };

    for zone_to_peek in players {
        let peeked: Vec<_> = {
            let zone_cards = ctx.game.cards_in_zone(src_zone, zone_to_peek);
            let take = num.min(zone_cards.len());
            let start = zone_cards.len().saturating_sub(take);
            zone_cards[start..].to_vec()
        };

        let revealable: Vec<_> = if let Some(valid) = sa.ir.reveal_valid_text.as_deref() {
            peeked
                .iter()
                .copied()
                .filter(|&cid| {
                    crate::ability::ability_utils::matches_valid_cards_for_sa(
                        ctx.game,
                        sa,
                        ctx.game.card(cid),
                        sa.ir.reveal_valid_selector.as_ref(),
                        valid,
                    )
                })
                .collect()
        } else {
            peeked.clone()
        };

        if !no_peek && !peeked.is_empty() {
            ctx.agents[peeking_player.index()].reveal_cards(
                ctx.game,
                peeking_player,
                &peeked,
                src_zone,
                zone_to_peek,
                sa.source.map(|cid| ctx.game.card(cid).card_name.as_str()),
            );
        }

        let mut do_reveal = !no_reveal && !revealable.is_empty();
        if do_reveal && reveal_optional {
            do_reveal = ctx.agents[peeking_player.index()].confirm_action(
                peeking_player,
                None,
                "Reveal the card to other players?",
                &[],
                sa.source,
                sa.api,
            );
        }

        if do_reveal {
            let source_name = sa.source.map(|cid| ctx.game.card(cid).card_name.clone());
            for agent in ctx.agents.iter_mut() {
                agent.reveal_cards(
                    ctx.game,
                    peeking_player,
                    &revealable,
                    src_zone,
                    zone_to_peek,
                    source_name.as_deref(),
                );
            }
            if let Some(source_id) = sa.source {
                if remember_revealed {
                    for &card_id in &revealable {
                        ctx.game.card_mut(source_id).add_remembered_card(card_id);
                    }
                }
                if imprint_revealed {
                    for &card_id in &revealable {
                        ctx.game.card_mut(source_id).add_imprinted_card(card_id);
                    }
                }
            }
        } else if remember_peeked {
            if let Some(source_id) = sa.source {
                for &card_id in &revealable {
                    ctx.game.card_mut(source_id).add_remembered_card(card_id);
                }
            }
        }
    }
}
