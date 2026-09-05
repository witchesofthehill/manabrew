use std::collections::BTreeSet;

use forge_carddb::{CardFace, CardRules};
use forge_foundation::CardSplitType;

use super::{matches_valid_cards_for_sa, EffectContext};
use crate::card::Card;
use crate::game::{CardDatabaseRegistry, GameState};
use crate::ids::{CardId, PlayerId};
use crate::spellability::SpellAbility;

fn insert_name(names: &mut BTreeSet<String>, game: &GameState, sa: &SpellAbility, card: &Card) {
    if matches_valid_cards_for_sa(game, sa, card, sa.ir.valid_cards_selector.as_ref(), "Card") {
        names.insert(card.card_name.clone());
    }
}

fn card_from_face(face: &CardFace, owner: PlayerId) -> Card {
    let mut card = Card::new(
        CardId(u32::MAX),
        face.name.clone(),
        owner,
        face.type_line.clone(),
        face.mana_cost.clone(),
        face.resolved_color(),
        face.int_power,
        face.int_toughness,
        face.keywords.clone(),
        Vec::new(),
    );
    card.oracle_text = face.oracle_text.replace("\\n", "\n");
    card.initial_loyalty = face.initial_loyalty.clone();
    card
}

fn insert_face(names: &mut BTreeSet<String>, game: &GameState, sa: &SpellAbility, face: &CardFace) {
    insert_name(names, game, sa, &card_from_face(face, sa.activating_player));
}

fn insert_all_rules_faces(
    names: &mut BTreeSet<String>,
    game: &GameState,
    sa: &SpellAbility,
    rules: &CardRules,
) {
    insert_face(names, game, sa, &rules.main_part);
    if let Some(other) = rules.other_part.as_ref() {
        insert_face(names, game, sa, other);
    }
    for face in rules.specialized_parts.values() {
        insert_face(names, game, sa, face);
    }
}

fn insert_defined_rules_faces(
    names: &mut BTreeSet<String>,
    game: &GameState,
    sa: &SpellAbility,
    rules: &CardRules,
) {
    insert_face(names, game, sa, &rules.main_part);
    if rules.split_type == CardSplitType::Split {
        if let Some(other) = rules.other_part.as_ref() {
            insert_face(names, game, sa, other);
        }
    }
}

fn insert_game_card_faces(
    names: &mut BTreeSet<String>,
    game: &GameState,
    sa: &SpellAbility,
    card: &Card,
    include_other: bool,
) {
    insert_name(names, game, sa, card);
    if include_other && card.other_part.is_some() {
        let mut other_face = card.clone();
        other_face.transform();
        insert_name(names, game, sa, &other_face);
    }
}

fn valid_names(ctx: &EffectContext, sa: &SpellAbility) -> Vec<String> {
    if let Some(list) = sa.ir.choose_from_list_text.as_deref() {
        return list
            .split(',')
            .map(|name| name.trim().replace(';', ","))
            .collect();
    }

    let database = CardDatabaseRegistry::get();
    let mut names = BTreeSet::new();
    if sa.ir.choose_from_defined_cards {
        if let Some(source_id) = sa.source {
            for card_id in ctx.game.card(source_id).remembered_cards.iter().copied() {
                let card = ctx.game.card(card_id);
                if let Some(rules) =
                    database.and_then(|database| database.get_by_card_name(&card.full_name))
                {
                    insert_defined_rules_faces(&mut names, ctx.game, sa, rules);
                } else {
                    insert_game_card_faces(&mut names, ctx.game, sa, card, false);
                }
            }
        }
    } else if sa.ir.at_random {
        let database = CardDatabaseRegistry::all()
            .expect("card database must be loaded for random card naming");
        for (_, rules) in database.iter() {
            insert_all_rules_faces(&mut names, ctx.game, sa, rules);
        }
    } else {
        for card in &ctx.game.cards {
            if let Some(rules) =
                database.and_then(|database| database.get_by_card_name(&card.full_name))
            {
                insert_all_rules_faces(&mut names, ctx.game, sa, rules);
            } else {
                insert_game_card_faces(&mut names, ctx.game, sa, card, true);
            }
        }
    }
    names.into_iter().collect()
}

#[manabrew_engine_macros::spell_effect(NameCardEffect)]
fn resolve(ctx: &mut EffectContext, sa: &SpellAbility) {
    let controller = sa.activating_player;
    let mut valid_names = valid_names(ctx, sa);
    let chosen = if sa.ir.at_random && sa.ir.choose_from_list_text.is_some() {
        (!valid_names.is_empty()).then(|| {
            let index = ctx.rng.next_int(valid_names.len() as i32) as usize;
            valid_names[index].clone()
        })
    } else if sa.ir.at_random && !sa.ir.choose_from_defined_cards {
        valid_names.sort_by_cached_key(|name| name.to_lowercase());
        let mut chosen = None;
        for (index, name) in valid_names.into_iter().enumerate() {
            if index == 0 || ctx.rng.next_int((index + 1) as i32) == 0 {
                chosen = Some(name);
            }
        }
        chosen
    } else {
        ctx.agents[controller.index()].choose_card_name(controller, &valid_names)
    };

    if let (Some(chosen_name), Some(source_id)) = (chosen, sa.source) {
        ctx.game.card_mut(source_id).add_named_card(&chosen_name);
    }
}
