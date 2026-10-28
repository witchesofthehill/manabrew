//! Java parity bridge for `StaticAbilityContinuous.java`.
//! Canonical CR613 recomputation lives in `layer.rs`.

use crate::card::Card;
use crate::game::GameState;
use crate::staticability::{Layer, StaticAbility};

pub fn apply_continuous_ability(
    st_ab: &StaticAbility,
    source: &Card,
    game: &mut GameState,
    layer: Layer,
) {
    if !crate::staticability::layer::classify_static_layers(st_ab).contains(&layer) {
        return;
    }
    if !st_ab.check_conditions(source, game) {
        return;
    }
    crate::staticability::layer::apply_continuous_effects(game);
}

pub fn resolve(st_ab: &StaticAbility, source: &Card, game: &GameState) {
    let _ = run(st_ab, source, game);
}

pub fn can_play(st_ab: &StaticAbility, source: &Card, card: &Card, game: &GameState) -> bool {
    if !st_ab.ir.may_play || !st_ab.check_conditions(source, game) {
        return false;
    }
    // Check AffectedZone$ — the zone where the affected cards must be.
    // Default is Hand if not specified (normal MayPlay like casting from hand).
    if !st_ab.ir.affected_zones.is_empty() {
        if !st_ab.ir.affected_zones.contains(&card.zone) {
            return false;
        }
    } else if card.zone != forge_foundation::ZoneType::Hand {
        return false;
    }
    crate::card::valid_filter::matches_valid_card_selector_opt_in_game(
        st_ab.ir.affected.as_ref(),
        card,
        source,
        game,
    )
}

pub fn can_play_or_granted(
    st_ab: &StaticAbility,
    source: &Card,
    card: &Card,
    game: &GameState,
) -> bool {
    if can_play(st_ab, source, card, game) {
        return true;
    }
    if !st_ab.check_conditions(source, game) {
        return false;
    }
    if !crate::card::valid_filter::matches_valid_card_selector_opt(
        st_ab.ir.affected.as_ref(),
        source,
        source,
    ) {
        return false;
    }
    let Some(add_static) = st_ab.ir.add_static_ability_text.as_deref() else {
        return false;
    };
    add_static
        .split(" & ")
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .filter_map(|svar_name| source.svars.get(svar_name))
        .filter_map(|static_text| crate::staticability::parse_static_ability(static_text))
        .any(|granted| can_play(&granted, source, card, game))
}

fn can_play_spell(
    st_ab: &StaticAbility,
    source: &Card,
    card: &Card,
    game: &GameState,
    spell: &crate::spellability::SpellAbility,
) -> bool {
    can_play(st_ab, source, card, game)
        && !st_ab.ir.may_play_dont_grant_zone_permissions
        && st_ab.ir.valid_sa.as_deref().is_none_or(|valid| {
            crate::spellability::matches_valid_sa(valid, spell, source, Some(card))
        })
}

pub fn can_play_spell_from_zone(
    game: &GameState,
    player: crate::ids::PlayerId,
    card: &Card,
    spell: &crate::spellability::SpellAbility,
) -> bool {
    if card.zone == forge_foundation::ZoneType::Hand && card.owner == player {
        return true;
    }
    if card.is_on_adventure() && card.owner == player && !card.adventure_spell {
        return true;
    }
    if card.zone == forge_foundation::ZoneType::Exile
        && card.owner == player
        && card.has_keyword(crate::card::KEYWORD_WARP_EXILED)
    {
        return true;
    }
    if matches!(
        card.zone,
        forge_foundation::ZoneType::Battlefield
            | forge_foundation::ZoneType::Stack
            | forge_foundation::ZoneType::None
    ) {
        return false;
    }
    game.cards_in_zone(forge_foundation::ZoneType::Battlefield, player)
        .iter()
        .chain(game.cards_in_zone(forge_foundation::ZoneType::Command, player))
        .any(|&source_id| {
            let source = game.card(source_id);
            source.static_abilities.iter().any(|st_ab| {
                if can_play_spell(st_ab, source, card, game, spell) {
                    return true;
                }
                if !st_ab.check_conditions(source, game)
                    || !crate::card::valid_filter::matches_valid_card_selector_opt_in_game(
                        st_ab.ir.affected.as_ref(),
                        source,
                        source,
                        game,
                    )
                {
                    return false;
                }
                st_ab
                    .ir
                    .add_static_ability_text
                    .as_deref()
                    .is_some_and(|add_static| {
                        add_static
                            .split(" & ")
                            .map(str::trim)
                            .filter_map(|name| source.svars.get(name))
                            .filter_map(|text| crate::staticability::parse_static_ability(text))
                            .any(|granted| can_play_spell(&granted, source, card, game, spell))
                    })
            })
        })
}

pub fn may_play_alt_mana_cost(
    st_ab: &StaticAbility,
    source: &Card,
    card: &Card,
    game: &GameState,
    spell: &crate::spellability::SpellAbility,
) -> Option<String> {
    if can_play(st_ab, source, card, game)
        && st_ab.ir.valid_sa.as_deref().is_none_or(|valid| {
            crate::spellability::matches_valid_sa(valid, spell, source, Some(card))
        })
    {
        if st_ab.ir.may_play_without_mana_cost {
            return Some("0".to_string());
        }
        if let Some(cost) = &st_ab.ir.may_play_alt_mana_cost {
            return Some(cost.clone());
        }
    }
    if !st_ab.check_conditions(source, game)
        || !crate::card::valid_filter::matches_valid_card_selector_opt_in_game(
            st_ab.ir.affected.as_ref(),
            source,
            source,
            game,
        )
    {
        return None;
    }
    st_ab
        .ir
        .add_static_ability_text
        .as_deref()
        .and_then(|add_static| {
            add_static
                .split(" & ")
                .map(str::trim)
                .filter_map(|name| source.svars.get(name))
                .filter_map(|text| crate::staticability::parse_static_ability(text))
                .find_map(|granted| may_play_alt_mana_cost(&granted, source, card, game, spell))
        })
}

pub fn run(st_ab: &StaticAbility, source: &Card, game: &GameState) -> bool {
    st_ab.check_conditions(source, game)
}
