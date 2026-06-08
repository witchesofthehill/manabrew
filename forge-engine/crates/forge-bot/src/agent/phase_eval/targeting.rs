// Adapted from phase-rs/phase crates/phase-ai (Apache-2.0). See THIRD-PARTY-NOTICES.md.
use forge_agent_interface::game_view_dto::GameViewDto;
use forge_agent_interface::prompt::PlayerAction;

use super::eval::{evaluate_creature, threat_level, KeywordBonuses};
use super::view::{is_creature, BotView};

pub fn choose_target_player(
    me: &str,
    game_view: &GameViewDto,
    valid_player_ids: &[String],
    hostile: bool,
) -> PlayerAction {
    let view = BotView::new(game_view, me);
    let chosen = if hostile {
        valid_player_ids
            .iter()
            .filter(|id| id.as_str() != me)
            .max_by(|a, b| threat_level(&view, a).total_cmp(&threat_level(&view, b)))
            .or_else(|| valid_player_ids.first())
            .cloned()
    } else {
        valid_player_ids
            .iter()
            .find(|id| id.as_str() == me)
            .or_else(|| valid_player_ids.first())
            .cloned()
    };
    PlayerAction::TargetPlayer { player_id: chosen }
}

pub fn choose_target_card(
    me: &str,
    game_view: &GameViewDto,
    valid_card_ids: &[String],
    hostile: bool,
) -> PlayerAction {
    let view = BotView::new(game_view, me);
    let bonuses = KeywordBonuses::default();
    let chosen = valid_card_ids
        .iter()
        .filter_map(|id| view.card_by_id(id))
        .filter(|c| {
            is_creature(c)
                && (if hostile {
                    c.controller_id != me
                } else {
                    c.controller_id == me
                })
        })
        .max_by(|a, b| evaluate_creature(a, &bonuses).total_cmp(&evaluate_creature(b, &bonuses)))
        .map(|c| c.id.clone())
        .or_else(|| valid_card_ids.first().cloned());
    PlayerAction::TargetCard { card_id: chosen }
}
