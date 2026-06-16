use forge_foundation::ZoneType;

use crate::card::{valid_filter, Card};
use crate::ids::PlayerId;
use crate::parsing::CompiledSelector;
use crate::staticability::StaticMode;

pub fn ignore_hexproof(cards: &[Card], target: &Card, activator: PlayerId) -> bool {
    any_ignore(cards, target, activator, StaticMode::IgnoreHexproof)
}

pub fn ignore_shroud(cards: &[Card], target: &Card, activator: PlayerId) -> bool {
    any_ignore(cards, target, activator, StaticMode::IgnoreShroud)
}

fn any_ignore(cards: &[Card], target: &Card, activator: PlayerId, mode: StaticMode) -> bool {
    for source in cards
        .iter()
        .filter(|c| c.zone == ZoneType::Battlefield || c.zone == ZoneType::Command)
    {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&mode))
        {
            if !matches_valid_player(
                st_ab.ir.activator_raw.as_deref(),
                activator,
                source.controller,
                source,
            ) {
                continue;
            }
            if !matches_valid_entity(st_ab.ir.valid_entity.as_ref(), target, source) {
                continue;
            }
            return true;
        }
    }
    false
}

fn matches_valid_player(
    valid: Option<&str>,
    player: PlayerId,
    source_controller: PlayerId,
    source: &Card,
) -> bool {
    match valid {
        None => true,
        Some(v) if v.eq_ignore_ascii_case("Player") => true,
        Some(v) if v.eq_ignore_ascii_case("You") || v.eq_ignore_ascii_case("YouCtrl") => {
            player == source_controller
        }
        Some(v) if v.eq_ignore_ascii_case("Opponent") || v.eq_ignore_ascii_case("OppCtrl") => {
            player != source_controller
        }
        Some(v) if v.eq_ignore_ascii_case("Player.IsRemembered") => {
            source.remembered_players.contains(&player)
        }
        _ => true,
    }
}

fn matches_valid_entity(valid: Option<&CompiledSelector>, target: &Card, source: &Card) -> bool {
    valid_filter::matches_valid_card_selector_opt(valid, target, source)
}
