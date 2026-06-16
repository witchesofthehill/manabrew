//! Replacement logic for `Event$ GameLoss`.
//!
//! Mirrors Java `ReplaceGameLoss.java` in `forge/game/replacement/`.

use crate::card::Card;
use crate::game::GameState;
use crate::ids::CardId;

use super::replacement_effect::{GameLossReason, ReplacementEffect};
use super::replacement_handler::ReplacementEvent;
use super::replacement_result::ReplacementResult;
use super::replacement_type::ReplacementType;
use crate::card_trait_base::CardTrait;

/// Mirrors Java `ReplaceGameLoss.canReplace()`.
pub fn can_replace(
    effect: &ReplacementEffect,
    event: &ReplacementEvent,
    _game: &GameState,
    source_card: &Card,
) -> bool {
    if effect.event != ReplacementType::GameLoss {
        return false;
    }
    let (player, reason) = match event {
        ReplacementEvent::GameLoss { player, reason } => (*player, *reason),
        _ => return false,
    };
    if let Some(valid) = effect.ir.valid_player_selector.as_ref() {
        if !effect.matches_compiled_valid_player(valid, player, source_card) {
            return false;
        }
    }
    if let Some(valid_reason) = effect.ir.valid_lose_reason_text.as_deref() {
        let matches_reason = valid_reason.split(',').map(str::trim).any(|r| {
            r.eq_ignore_ascii_case(match reason {
                GameLossReason::LifeReachedZero => "LifeReachedZero",
                GameLossReason::Poisoned => "Poisoned",
                GameLossReason::CommanderDamage => "CommanderDamage",
                GameLossReason::Milled => "Milled",
                GameLossReason::OpponentWon => "OpponentWon",
                GameLossReason::SpellEffect => "SpellEffect",
                GameLossReason::IntentionalDraw => "IntentionalDraw",
            })
        });
        if !matches_reason {
            return false;
        }
    }
    true
}

/// CantHappen layer prevents the game loss (e.g. Platinum Angel).
pub fn execute(
    _effect: &ReplacementEffect,
    _event: &mut ReplacementEvent,
    _game: &GameState,
    _source_card_id: CardId,
) -> ReplacementResult {
    ReplacementResult::Replaced
}
