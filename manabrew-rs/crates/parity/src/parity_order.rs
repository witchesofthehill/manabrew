use forge_foundation::Color;
use manabrew_engine::card::Card;
use manabrew_engine::ids::CardId;
use manabrew_engine::player::actions::player_action::STATIC_ALTERNATIVE_ABILITY_INDEX;

pub fn sort_cards_by_name_then_id(
    cards: &[CardId],
    mut card_name: impl FnMut(CardId) -> String,
    mut parity_id: impl FnMut(CardId) -> u32,
) -> Vec<CardId> {
    let mut out: Vec<CardId> = cards.to_vec();
    out.sort_by(|a, b| {
        let an = card_name(*a);
        let bn = card_name(*b);
        an.cmp(&bn).then_with(|| parity_id(*a).cmp(&parity_id(*b)))
    });
    out
}

pub fn sort_replacement_descriptions_with_indices(descriptions: &[String]) -> Vec<(usize, String)> {
    let mut out: Vec<(usize, String)> = descriptions.iter().cloned().enumerate().collect();
    out.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)));
    out
}

pub fn ability_declaration_sort_index(
    cards: &[Card],
    ability_texts: &[((CardId, usize), String)],
    card_id: CardId,
    ability_idx: usize,
) -> usize {
    let Some(card) = cards.iter().find(|card| card.id == card_id) else {
        return ability_idx;
    };
    let mut entries: Vec<(usize, u8)> = ability_texts
        .iter()
        .filter_map(|((cid, idx), text)| {
            if *cid != card_id {
                return None;
            }
            let group = if card.abilities.iter().any(|raw| raw == text) {
                0
            } else if card.granted_svars.values().any(|raw| raw == text) {
                1
            } else {
                2
            };
            Some((*idx, group))
        })
        .collect();
    entries.sort_by_key(|(idx, group)| (*group, *idx));
    entries
        .iter()
        .position(|(idx, _)| *idx == ability_idx)
        .unwrap_or(ability_idx)
}

pub fn ability_declaration_sort_key(
    cards: &[Card],
    ability_texts: &[((CardId, usize), String)],
    card_id: CardId,
    ability_idx: usize,
) -> String {
    if ability_idx == STATIC_ALTERNATIVE_ABILITY_INDEX {
        "-0001".to_string()
    } else {
        format!(
            "{:05}",
            ability_declaration_sort_index(cards, ability_texts, card_id, ability_idx)
        )
    }
}

fn java_color_set_order(mask: u8) -> &'static [Color] {
    use Color::{Black as B, Blue as U, Green as G, Red as R, White as W};
    match mask & 0b1_1111 {
        0 => &[],
        1 => &[W],
        2 => &[U],
        3 => &[W, U],
        4 => &[B],
        5 => &[W, B],
        6 => &[U, B],
        7 => &[W, U, B],
        8 => &[R],
        9 => &[R, W],
        10 => &[U, R],
        11 => &[U, R, W],
        12 => &[B, R],
        13 => &[R, W, B],
        14 => &[U, B, R],
        15 => &[W, U, B, R],
        16 => &[G],
        17 => &[G, W],
        18 => &[G, U],
        19 => &[G, W, U],
        20 => &[B, G],
        21 => &[W, B, G],
        22 => &[B, G, U],
        23 => &[G, W, U, B],
        24 => &[R, G],
        25 => &[R, G, W],
        26 => &[G, U, R],
        27 => &[R, G, W, U],
        28 => &[B, R, G],
        29 => &[B, R, G, W],
        30 => &[U, B, R, G],
        31 => &[W, U, B, R, G],
        _ => &[],
    }
}

pub fn sort_color_names_like_java(valid_colors: &[String]) -> Vec<String> {
    let mut mask = 0u8;
    for color in valid_colors {
        if let Some(parsed) = Color::from_name(color) {
            mask |= parsed.mask();
        }
    }
    let ordered = java_color_set_order(mask);
    if ordered.is_empty() {
        return valid_colors.to_vec();
    }
    ordered
        .iter()
        .map(|color| color.long_name().to_string())
        .collect()
}
