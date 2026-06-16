use crate::card::valid_filter;
use crate::game::GameState;
use crate::ids::PlayerId;
use crate::staticability::StaticMode;

/// Total surveil modifier for a player from all active SurveilNum statics.
///
/// Mirrors Java's `StaticAbilitySurveilNum.surveilNumMod()`.
pub fn surveil_num_mod(game: &GameState, player: PlayerId) -> i32 {
    let mut total = 0;
    for card in game
        .cards
        .iter()
        .filter(|c| c.zone.is_static_ability_source())
    {
        for st_ab in card
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&StaticMode::SurveilNum) && sa.zones_check(card.zone))
        {
            total += get_surveil_mod(st_ab, card.controller, player);
        }
    }
    total
}

/// Get the surveil modifier from a single static ability.
///
/// Mirrors Java's `StaticAbilitySurveilNum.getSurveilMod()`.
fn get_surveil_mod(
    st_ab: &crate::staticability::StaticAbility,
    source_controller: PlayerId,
    player: PlayerId,
) -> i32 {
    // ValidPlayer$
    if !valid_filter::matches_valid_player_selector_opt(
        st_ab.ir.valid_player.as_ref(),
        player,
        source_controller,
    ) {
        return 0;
    }

    // Optional$ — in Java, prompts the player for confirmation.
    // The engine doesn't yet have a confirm callback, so we auto-accept.
    // TODO: implement player confirmation for optional surveil modifier.
    if st_ab.ir.optional {
        // Java: if (!p.getController().confirmStaticApplication(
        //     stAb.getHostCard(), null, stAb.toString() + "?", null)) return 0;
    }

    // Num$
    st_ab.ir.num_value.unwrap_or(0)
}
