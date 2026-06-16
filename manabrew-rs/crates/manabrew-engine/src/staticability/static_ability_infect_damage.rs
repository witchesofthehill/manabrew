use forge_foundation::ZoneType;

use crate::card::{valid_filter, Card};
use crate::game::GameState;
use crate::ids::PlayerId;
use crate::parsing::compare::compare_expr;
use crate::parsing::CompiledSelector;
use crate::staticability::StaticMode;

pub fn is_infect_damage(
    game: &GameState,
    cards: &[Card],
    target: PlayerId,
    source_controller: PlayerId,
) -> bool {
    is_infect_damage_with_life_override(game, cards, target, source_controller, None)
}

pub fn is_infect_damage_with_life_override(
    game: &GameState,
    cards: &[Card],
    target: PlayerId,
    _source_controller: PlayerId,
    target_life_override: Option<i32>,
) -> bool {
    for source in cards.iter().filter(|c| c.zone == ZoneType::Battlefield) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&StaticMode::InfectDamage))
        {
            let life_override = if source.controller == target {
                target_life_override
            } else {
                None
            };
            if !condition_matches(game, source, st_ab, life_override) {
                continue;
            }
            let valid = st_ab.ir.valid_target.as_ref();
            // ValidTarget is evaluated relative to the static ability source
            // (e.g. Phyrexian Unlife's controller), not the damage source.
            if matches_valid_player(valid, target, source.controller) {
                return true;
            }
        }
    }
    false
}

fn condition_matches(
    game: &GameState,
    source: &Card,
    st_ab: &crate::staticability::StaticAbility,
    life_override: Option<i32>,
) -> bool {
    let Some(check_svar) = st_ab.ir.check_svar_text.as_deref() else {
        return true;
    };
    let Some(compare) = st_ab.ir.svar_compare_text.as_deref() else {
        return true;
    };
    let Some(expr) = source.svars.get(check_svar) else {
        return true;
    };
    // Only support the pattern needed by Phyrexian Unlife.
    let value = if expr == "Count$YourLifeTotal" {
        life_override.unwrap_or_else(|| game.player(source.controller).life)
    } else {
        return true;
    };
    compare_expr(value, compare)
}

fn matches_valid_player(
    valid: Option<&CompiledSelector>,
    player: PlayerId,
    source_controller: PlayerId,
) -> bool {
    valid_filter::matches_valid_player_selector_opt(valid, player, source_controller)
}
