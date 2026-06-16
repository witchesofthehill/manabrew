use forge_foundation::ZoneType;

use crate::game::GameState;
use crate::ids::PlayerId;
use crate::parsing::CompiledSelector;
use crate::spellability::SpellAbility;
use crate::staticability::StaticMode;

pub fn cant_gain_life(game: &GameState, player: PlayerId) -> bool {
    any_common(
        game,
        player,
        &[StaticMode::CantGainLife, StaticMode::CantChangeLife],
        None,
        false,
    )
}

pub fn any_cant_gain_life(game: &GameState, player: PlayerId) -> bool {
    cant_gain_life(game, player)
}

pub fn cant_lose_life(game: &GameState, player: PlayerId) -> bool {
    any_common(
        game,
        player,
        &[StaticMode::CantLoseLife, StaticMode::CantChangeLife],
        None,
        false,
    )
}

pub fn any_cant_lose_life(game: &GameState, player: PlayerId) -> bool {
    cant_lose_life(game, player)
}

pub fn cant_pay_life(
    game: &GameState,
    player: PlayerId,
    is_cost: bool,
    cause: Option<&SpellAbility>,
) -> bool {
    any_common(
        game,
        player,
        &[
            StaticMode::CantPayLife,
            StaticMode::CantLoseLife,
            StaticMode::CantChangeLife,
        ],
        cause,
        is_cost,
    )
}

pub fn any_cant_pay_life(
    game: &GameState,
    player: PlayerId,
    is_cost: bool,
    cause: Option<&SpellAbility>,
) -> bool {
    cant_pay_life(game, player, is_cost, cause)
}

pub fn apply_common_ability(
    st_ab: &crate::staticability::StaticAbility,
    source_id: crate::ids::CardId,
    game: &GameState,
    source_controller: PlayerId,
    player: PlayerId,
    is_cost: bool,
) -> bool {
    if let Some(for_cost) = st_ab.ir.for_cost {
        if for_cost != is_cost {
            return false;
        }
    }
    matches_valid_player(
        st_ab.ir.valid_player.as_ref(),
        player,
        source_id,
        source_controller,
        game,
    )
}

fn any_common(
    game: &GameState,
    player: PlayerId,
    modes: &[StaticMode],
    _cause: Option<&SpellAbility>,
    is_cost: bool,
) -> bool {
    for card in game
        .cards
        .iter()
        .filter(|c| c.zone == ZoneType::Battlefield)
    {
        for st_ab in &card.static_abilities {
            if !modes.iter().any(|m| st_ab.check_mode(m)) {
                continue;
            }
            if let Some(for_cost) = st_ab.ir.for_cost {
                if for_cost != is_cost {
                    continue;
                }
            }
            if !matches_valid_player(
                st_ab.ir.valid_player.as_ref(),
                player,
                card.id,
                card.controller,
                game,
            ) {
                continue;
            }
            return true;
        }
    }
    false
}

fn matches_valid_player(
    valid: Option<&CompiledSelector>,
    player: PlayerId,
    source_id: crate::ids::CardId,
    source_controller: PlayerId,
    game: &GameState,
) -> bool {
    let Some(valid) = valid else {
        return true;
    };
    if valid.alternatives.is_empty() {
        return true;
    }
    let sa = SpellAbility::new_simple(Some(source_id), source_controller, "");
    valid.alternatives.iter().any(|alternative| {
        let mut checked_property = false;
        let properties_match = alternative
            .parts
            .iter()
            .map(|part| part.value.as_str())
            .filter(|part| !part.eq_ignore_ascii_case("Player"))
            .all(|property| {
                checked_property = true;
                crate::player::player_property::player_has_property(
                    player,
                    property,
                    game,
                    source_id,
                    source_controller,
                    &sa,
                )
            });
        !checked_property || properties_match
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card::Card;
    use crate::ids::CardId;
    use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};

    #[test]
    fn cant_gain_life_respects_player_enchanted_by() {
        let mut game = GameState::new(&["A", "B"], 20);
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);
        let aura_id = game.create_card(Card::new(
            CardId(1),
            "Grievous Wound".to_string(),
            p0,
            CardTypeLine::parse("Enchantment Aura"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            None,
            None,
            vec![],
            vec!["S:Mode$ CantGainLife | ValidPlayer$ Player.EnchantedBy".to_string()],
        ));
        game.card_mut(aura_id).zone = ZoneType::Battlefield;
        game.attach_to_player(aura_id, p1);

        assert!(cant_gain_life(&game, p1));
        assert!(!cant_gain_life(&game, p0));
    }
}
