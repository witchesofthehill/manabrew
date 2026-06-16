//! Card utility helpers mirroring Java's `CardUtil`.

use std::collections::{HashSet, VecDeque};

use forge_foundation::{CardStateName, CardTypeLine, Color, ColorSet, ZoneType};

use crate::ability::ability_factory;
use crate::ability::ability_utils;
use crate::ability::api_type::ApiType;
use crate::card::card_collection::CardCollection;
use crate::card::card_lists::CardLists;
use crate::card::valid_filter;
use crate::card::Card;
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::parsing::cached_compiled_selector;
use crate::spellability::target_restrictions;
use crate::spellability::SpellAbility;

const MODIFIABLE_KEYWORDS: &[&str] = &[
    "Enchant",
    "Protection",
    "Cumulative upkeep",
    "Equip",
    "Buyback",
    "Cycling",
    "Echo",
    "Kicker",
    "Flashback",
    "Madness",
    "Morph",
    "Affinity",
    "Entwine",
    "Splice",
    "Ninjutsu",
    "Transmute",
    "Replicate",
    "Recover",
    "Squad",
    "Suspend",
    "Aura swap",
    "Fortify",
    "Transfigure",
    "Champion",
    "Evoke",
    "Prowl",
    "Freerunning",
    "Reinforce",
    "Unearth",
    "Level up",
    "Miracle",
    "Overload",
    "Cleave",
    "Scavenge",
    "Encore",
    "Bestow",
    "Outlast",
    "Dash",
    "Surge",
    "Emerge",
    "Hexproof:",
    "Bands with other",
    "Landwalk",
    "Offering",
    "etbCounter",
    "Reflect",
    "Ward",
];

const NON_STACKING_LIST: &[&str] = &[];

/// Lightweight characteristic bundle used by face-down / empty-room helpers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CardCharacteristic {
    pub state: CardStateName,
    pub name: String,
    pub type_line: CardTypeLine,
    pub base_power: Option<i32>,
    pub base_toughness: Option<i32>,
}

pub fn is_keyword_modifiable(keyword: &str) -> bool {
    MODIFIABLE_KEYWORDS
        .iter()
        .any(|prefix| keyword.starts_with(prefix))
}

pub fn is_stacking_keyword(keyword: &str) -> bool {
    let kw = keyword.strip_prefix("HIDDEN").unwrap_or(keyword);
    !kw.starts_with("Protection") && !NON_STACKING_LIST.contains(&kw)
}

pub fn get_this_turn_entered(
    game: &GameState,
    to: ZoneType,
    from: ZoneType,
    valid: &str,
    src: CardId,
    controller: PlayerId,
) -> Vec<CardId> {
    let mut res = Vec::new();
    if to != ZoneType::Stack {
        for &pid in &game.player_order {
            res.extend(
                game.zone(to, pid)
                    .cards_added_this_turn
                    .iter()
                    .filter(|(origin, _)| *origin == from)
                    .map(|(_, cid)| *cid),
            );
        }
    } else {
        res.extend(game.stack.get_spells_cast_this_turn().iter().copied());
    }
    filter_valid_cards(game, res, valid, src, controller)
}

pub fn get_last_turn_entered(
    game: &GameState,
    to: ZoneType,
    from: ZoneType,
    valid: &str,
    src: CardId,
    controller: PlayerId,
) -> Vec<CardId> {
    let mut res = Vec::new();
    if to != ZoneType::Stack {
        for &pid in &game.player_order {
            res.extend(
                game.zone(to, pid)
                    .cards_added_last_turn
                    .iter()
                    .filter(|(origin, _)| *origin == from)
                    .map(|(_, cid)| *cid),
            );
        }
    } else {
        res.extend(game.stack.get_spells_cast_last_turn().iter().copied());
    }
    filter_valid_cards(game, res, valid, src, controller)
}

pub fn get_this_turn_cast(
    game: &GameState,
    valid: &str,
    src: CardId,
    controller: PlayerId,
) -> Vec<CardId> {
    filter_valid_cards(
        game,
        game.stack.get_spells_cast_this_turn().to_vec(),
        valid,
        src,
        controller,
    )
}

pub fn get_last_turn_cast(
    game: &GameState,
    valid: &str,
    src: CardId,
    controller: PlayerId,
) -> Vec<CardId> {
    filter_valid_cards(
        game,
        game.stack.get_spells_cast_last_turn().to_vec(),
        valid,
        src,
        controller,
    )
}

pub fn get_this_turn_activated(
    game: &GameState,
    valid: &str,
    src: CardId,
    controller: PlayerId,
) -> Vec<CardId> {
    let activated: Vec<CardId> = game
        .cards
        .iter()
        .filter(|card| card.activated_this_turn())
        .map(|card| card.id)
        .collect();
    filter_valid_cards(game, activated, valid, src, controller)
}

pub fn get_cast_since_beginning_of_your_last_turn(
    game: &GameState,
    valid: &str,
    src: CardId,
    controller: PlayerId,
) -> Vec<CardId> {
    filter_valid_cards(
        game,
        game.player(controller).cards_cast_this_turn.clone(),
        valid,
        src,
        controller,
    )
}

pub fn get_radiance(game: &GameState, sa: &SpellAbility) -> CardCollection {
    let Some(targeted) = find_sa_targeting_card(sa) else {
        return CardCollection::new();
    };
    if !targeted.uses_targeting() || !targeted.ir.radiance {
        return CardCollection::new();
    }

    let Some(source) = targeted.source else {
        return CardCollection::new();
    };
    let Some(target) = targeted.target_chosen.target_card else {
        return CardCollection::new();
    };

    let valid_tokens: Vec<&str> = targeted
        .ir
        .valid_tgts_text
        .as_deref()
        .map(|value| value.split(',').map(str::trim).collect())
        .unwrap_or_default();
    let valid_selectors: Vec<_> = valid_tokens
        .iter()
        .map(|token| cached_compiled_selector(token))
        .collect();

    let combined = game.card(target).color;
    let mut out = CardCollection::new();
    for color in combined.iter() {
        for &pid in &game.player_order {
            for &cid in game.cards_in_zone(ZoneType::Battlefield, pid) {
                if cid == target || out.iter().any(|existing| *existing == cid) {
                    continue;
                }
                let card = game.card(cid);
                if !card.color.has_color(color) {
                    continue;
                }
                if valid_selectors.is_empty()
                    || valid_selectors.iter().any(|selector| {
                        valid_filter::matches_valid_card_selector_in_game(
                            selector,
                            card,
                            game.card(source),
                            game,
                        )
                    })
                {
                    out.push(cid);
                }
            }
        }
    }

    out
}

pub fn get_colors_from_cards(game: &GameState, list: &[CardId]) -> ColorSet {
    let mut mask = 0u8;
    for &cid in list {
        mask |= game.card(cid).color.mask();
    }
    ColorSet::from_mask(mask)
}

pub fn get_face_down_characteristic(card: &Card) -> CardCharacteristic {
    get_face_down_characteristic_with_state(card, CardStateName::FaceDown)
}

pub fn get_face_down_characteristic_with_state(
    _card: &Card,
    state: CardStateName,
) -> CardCharacteristic {
    CardCharacteristic {
        state,
        name: String::new(),
        type_line: CardTypeLine::parse("Creature"),
        base_power: Some(2),
        base_toughness: Some(2),
    }
}

pub fn get_empty_room_characteristic(card: &Card) -> CardCharacteristic {
    get_empty_room_characteristic_with_state(card, CardStateName::EmptyRoom)
}

pub fn get_empty_room_characteristic_with_state(
    _card: &Card,
    state: CardStateName,
) -> CardCharacteristic {
    CardCharacteristic {
        state,
        name: String::new(),
        type_line: CardTypeLine::parse("Enchantment Room"),
        base_power: None,
        base_toughness: None,
    }
}

pub fn get_reflectable_mana_colors(game: &GameState, sa: &SpellAbility) -> HashSet<String> {
    get_reflectable_mana_colors_inner(game, sa, sa, HashSet::new(), Vec::new())
}

fn get_reflectable_mana_colors_inner(
    game: &GameState,
    root_sa: &SpellAbility,
    ab_mana: &SpellAbility,
    mut colors: HashSet<String>,
    mut parents: Vec<CardId>,
) -> HashSet<String> {
    if ab_mana.api != Some(ApiType::ManaReflected) {
        return colors;
    }

    let color_or_type = root_sa.ir.color_or_type.as_deref().unwrap_or("Color");
    let reflect_property = root_sa.ir.reflect_property.as_deref().unwrap_or("Is");
    let max_choices = if color_or_type.eq_ignore_ascii_case("Type") {
        6
    } else {
        5
    };

    let cards = collect_reflectable_cards(game, ab_mana, root_sa, &parents);
    if root_sa.ir.valid_filter_text.is_some() && cards.is_empty() {
        return colors;
    }

    match reflect_property {
        "Is" => {
            for cid in cards {
                for color in game.card(cid).color.iter() {
                    colors.insert(color_long_name(color).to_string());
                    if colors.len() == max_choices {
                        break;
                    }
                }
            }
        }
        "Produced" => {
            if let Some(produced_colors) =
                ab_mana.get_triggering_object(crate::ability::AbilityKey::Produced)
            {
                for color in Color::ALL {
                    if produced_colors.contains(color.short_name()) {
                        colors.insert(color_long_name(color).to_string());
                    }
                }
                if max_choices == 6
                    && (produced_colors.contains('1') || produced_colors.contains('C'))
                {
                    colors.insert("Colorless".to_string());
                }
            }
        }
        "Produce" => {
            let mut reflect_abilities = VecDeque::new();
            for cid in cards {
                let card = game.card(cid);
                for ab in &card.activated_abilities {
                    let ab = ability_factory::build_spell_ability(
                        game,
                        card.id,
                        &ab.ability_text,
                        card.controller,
                    );
                    if ab.is_spell || ab.is_land_ability {
                        continue;
                    }
                    if colors.len() == max_choices {
                        break;
                    }
                    if !parents.contains(&card.id) {
                        parents.push(card.id);
                    }
                    if ab.api == Some(ApiType::ManaReflected)
                        && ab.ir.reflect_property.as_deref().unwrap_or("") != "Produced"
                    {
                        reflect_abilities.push_back(ab);
                    } else {
                        colors = can_produce(max_choices, Some(&ab), colors);
                    }
                }
                for trig in &card.triggers {
                    let Some(mut trig_sa) = trig.ensure_ability(game, card.id, card.controller)
                    else {
                        continue;
                    };
                    if trig_sa.is_spell || trig_sa.is_land_ability {
                        continue;
                    }
                    if colors.len() == max_choices {
                        break;
                    }
                    if !parents.contains(&card.id) {
                        parents.push(card.id);
                    }
                    trig_sa.activating_player = card.controller;
                    if trig_sa.api == Some(ApiType::ManaReflected)
                        && trig_sa.ir.reflect_property.as_deref().unwrap_or("") != "Produced"
                    {
                        reflect_abilities.push_back(trig_sa);
                    } else {
                        colors = can_produce(max_choices, Some(&trig_sa), colors);
                    }
                }
            }

            while let Some(reflect_sa) = reflect_abilities.pop_front() {
                if colors.len() == max_choices {
                    break;
                }
                colors = get_reflectable_mana_colors_inner(
                    game,
                    root_sa,
                    &reflect_sa,
                    colors,
                    parents.clone(),
                );
            }
        }
        _ => {}
    }

    colors
}

fn collect_reflectable_cards(
    game: &GameState,
    ab_mana: &SpellAbility,
    root_sa: &SpellAbility,
    parents: &[CardId],
) -> Vec<CardId> {
    let Some(host) = ab_mana.source else {
        return Vec::new();
    };
    let Some(valid_card) = root_sa.ir.valid_filter_text.as_deref() else {
        return Vec::new();
    };

    let mut cards = if let Some(defined) = valid_card.strip_prefix("Defined.") {
        ability_utils::get_defined_cards(game, Some(host), defined, Some(ab_mana.activating_player))
    } else {
        let valid_selector = root_sa
            .ir
            .valid_filter_selector
            .clone()
            .unwrap_or_else(|| cached_compiled_selector(valid_card));
        game.player_order
            .iter()
            .flat_map(|&pid| {
                game.cards_in_zone(ZoneType::Battlefield, pid)
                    .iter()
                    .copied()
            })
            .filter(|&cid| {
                let card = game.card(cid);
                valid_filter::matches_valid_card_selector_in_game(
                    &valid_selector,
                    card,
                    game.card(host),
                    game,
                )
            })
            .collect()
    };

    cards.retain(|cid| !parents.contains(cid));
    cards
}

/// Java parity: accumulate colors/types a mana ability can produce.
pub fn can_produce(
    max_choices: usize,
    sa: Option<&SpellAbility>,
    mut colors: HashSet<String>,
) -> HashSet<String> {
    let Some(sa) = sa else {
        return colors;
    };

    for (short, long) in [
        ("W", "white"),
        ("U", "blue"),
        ("B", "black"),
        ("R", "red"),
        ("G", "green"),
    ] {
        if sa.can_produce(short) {
            colors.insert(long.to_string());
        }
    }
    if max_choices == 6 && sa.can_produce("C") {
        colors.insert("colorless".to_string());
    }

    colors
}

pub fn card_can_produce_color_mana(
    game: &GameState,
    card_id: CardId,
    colors: &HashSet<String>,
) -> bool {
    let card = game.card(card_id);
    for ab in &card.activated_abilities {
        if !ab.is_mana_ability {
            continue;
        }
        let sa = crate::ability::ability_factory::build_spell_ability(
            game,
            card_id,
            &ab.ability_text,
            card.controller,
        );
        for color in colors {
            if sa.api == Some(ApiType::ManaReflected) {
                if get_reflectable_mana_colors(game, &sa).contains(color) {
                    return true;
                }
            } else if sa.can_produce(color_short_name(color)) {
                return true;
            }
        }
    }
    false
}

pub fn card_can_produce_same_mana_type_with(
    game: &GameState,
    card_id: CardId,
    other_id: CardId,
) -> bool {
    let card = game.card(card_id);
    if !card.activated_abilities.iter().any(|ab| ab.is_mana_ability) {
        return false;
    }

    let other = game.card(other_id);
    let mut colors = HashSet::new();
    for ab in &other.activated_abilities {
        if !ab.is_mana_ability {
            continue;
        }
        let sa = crate::ability::ability_factory::build_spell_ability(
            game,
            other_id,
            &ab.ability_text,
            other.controller,
        );
        if sa.api == Some(ApiType::ManaReflected) {
            colors.extend(get_reflectable_mana_colors(game, &sa));
        } else {
            colors = can_produce(6, Some(&sa), colors);
        }
    }

    card_can_produce_color_mana(game, card_id, &colors)
}

pub fn get_valid_cards_to_target(game: &GameState, ability: &SpellAbility) -> Vec<CardId> {
    let Some(tgt) = ability.target_restrictions.as_ref() else {
        return Vec::new();
    };
    let player = ability
        .targeting_player
        .unwrap_or(ability.activating_player);

    let zones = if tgt.tgt_zone.is_empty() {
        vec![ZoneType::Battlefield]
    } else {
        tgt.tgt_zone.clone()
    };

    let mut candidates = Vec::new();
    for zone in zones {
        match zone {
            ZoneType::Battlefield => {
                candidates.extend(match &tgt.target_kind {
                    target_restrictions::TargetKind::Creature(filter) => {
                        target_restrictions::get_all_candidates_creature_filtered_for_restrictions(
                            game,
                            tgt,
                            filter.as_deref(),
                            player,
                            ability.source,
                        )
                    }
                    target_restrictions::TargetKind::Permanent(filter) => {
                        target_restrictions::get_all_battlefield_permanents_filtered_for_restrictions(
                            game,
                            tgt,
                            filter.as_deref(),
                            player,
                            ability.source,
                        )
                    }
                    target_restrictions::TargetKind::Any => {
                        target_restrictions::get_all_candidates_any_filtered_for_restrictions(
                            game,
                            tgt,
                            player,
                            ability.source,
                        )
                    }
                    _ => Vec::new(),
                });
            }
            _ => {
                if let target_restrictions::TargetKind::CardInZone {
                    filter,
                    zone: target_zone,
                } = &tgt.target_kind
                {
                    if *target_zone == zone {
                        candidates.extend(target_restrictions::get_valid_cards_in_zone_for_sa(
                            game,
                            zone,
                            player,
                            filter.as_deref(),
                            ability,
                        ));
                    }
                }
            }
        }
    }

    for valid in &tgt.valid_tgts {
        candidates = target_restrictions::apply_other_source_filter(
            candidates,
            Some(valid.as_str()),
            ability.source,
        );
    }

    candidates.retain(|&cid| {
        !ability.target_chosen.contains(cid)
            && target_restrictions::can_be_targeted_by_sa(
                game,
                cid,
                ability
                    .targeting_player
                    .unwrap_or(ability.activating_player),
                ability,
            )
    });

    candidates.sort_unstable_by_key(|cid| cid.0);
    candidates.dedup();
    candidates
}

fn filter_valid_cards(
    game: &GameState,
    cards: Vec<CardId>,
    valid: &str,
    src: CardId,
    controller: PlayerId,
) -> Vec<CardId> {
    if valid.is_empty() {
        return cards;
    }
    let _ = controller;
    CardLists::filter_as_list_with_source(game, &cards, valid, src)
}

fn color_long_name(color: Color) -> &'static str {
    match color {
        Color::White => "white",
        Color::Blue => "blue",
        Color::Black => "black",
        Color::Red => "red",
        Color::Green => "green",
    }
}

fn color_short_name(color: &str) -> &'static str {
    match color {
        "white" | "White" => "W",
        "blue" | "Blue" => "U",
        "black" | "Black" => "B",
        "red" | "Red" => "R",
        "green" | "Green" => "G",
        "colorless" | "Colorless" => "C",
        _ => "",
    }
}

fn find_sa_targeting_card(sa: &SpellAbility) -> Option<&SpellAbility> {
    let mut current = Some(sa);
    while let Some(node) = current {
        if node.uses_targeting() && node.ir.radiance {
            return Some(node);
        }
        current = node.get_sub_ability();
    }
    None
}
