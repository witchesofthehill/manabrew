use std::collections::BTreeSet;

use super::{matches_valid_cards_for_sa, EffectContext};
use crate::card::Card;
use crate::game::GameState;
use crate::spellability::SpellAbility;

fn insert_nameable_faces(
    names: &mut BTreeSet<String>,
    game: &GameState,
    sa: &SpellAbility,
    card: &Card,
) {
    if matches_valid_cards_for_sa(game, sa, card, sa.ir.valid_cards_selector.as_ref(), "Card") {
        names.insert(card.card_name.clone());
    }

    if card.other_part.is_some() {
        let mut other_face = card.clone();
        other_face.transform();
        if matches_valid_cards_for_sa(
            game,
            sa,
            &other_face,
            sa.ir.valid_cards_selector.as_ref(),
            "Card",
        ) {
            names.insert(other_face.card_name);
        }
    }
}

fn valid_names(ctx: &EffectContext, sa: &SpellAbility) -> Vec<String> {
    if let Some(list) = sa.ir.choose_from_list_text.as_deref() {
        return list
            .split(',')
            .map(|name| name.trim().replace(';', ","))
            .collect();
    }

    let mut names = BTreeSet::new();
    if sa.ir.choose_from_defined_cards {
        if let Some(source_id) = sa.source {
            for card_id in ctx.game.card(source_id).remembered_cards.iter().copied() {
                insert_nameable_faces(&mut names, ctx.game, sa, ctx.game.card(card_id));
            }
        }
    } else {
        for card in &ctx.game.cards {
            insert_nameable_faces(&mut names, ctx.game, sa, card);
        }
    }
    names.into_iter().collect()
}

#[manabrew_engine_macros::spell_effect(NameCardEffect)]
fn resolve(ctx: &mut EffectContext, sa: &SpellAbility) {
    let controller = sa.activating_player;
    let valid_names = valid_names(ctx, sa);
    let chosen = if sa.ir.at_random {
        (!valid_names.is_empty()).then(|| {
            let index = ctx.rng.next_int(valid_names.len() as i32) as usize;
            valid_names[index].clone()
        })
    } else {
        ctx.agents[controller.index()].choose_card_name(controller, &valid_names)
    };

    if let (Some(chosen_name), Some(source_id)) = (chosen, sa.source) {
        ctx.game.card_mut(source_id).add_named_card(&chosen_name);
    }
}
