//! Replacement logic for `Event$ ProduceMana`.
//!
//! Mirrors Java `ReplaceProduceMana.java` in `forge/game/replacement/`.

use crate::card::Card;
use crate::game::GameState;
use crate::ids::CardId;

use super::replacement_effect::ReplacementEffect;
use super::replacement_handler::ReplacementEvent;
use super::replacement_result::ReplacementResult;
use super::replacement_type::ReplacementType;
use crate::card_trait_base::CardTrait;

/// Mirrors Java `ReplaceProduceMana.canReplace()`.
pub fn can_replace(
    effect: &ReplacementEffect,
    event: &ReplacementEvent,
    game: &GameState,
    source_card: &Card,
) -> bool {
    if effect.event != ReplacementType::ProduceMana {
        return false;
    }
    let (source_id, activator) = match event {
        ReplacementEvent::ProduceMana {
            source, activator, ..
        } => (*source, *activator),
        _ => return false,
    };
    let producing_card = &game.cards[source_id.index()];
    if let Some(valid) = effect.ir.valid_card_selector.as_ref() {
        if !valid.is_any_of(["Permanent", "Card"])
            && !effect.matches_compiled_valid_card(valid, producing_card, source_card)
        {
            return false;
        }
    }
    if let Some(valid_player) = effect.ir.valid_activator_text.as_deref() {
        if !effect.matches_valid_player(valid_player, activator, source_card) {
            return false;
        }
    } else if let Some(valid_player) = effect.ir.valid_player_selector.as_ref() {
        if !effect.matches_compiled_valid_player(valid_player, activator, source_card) {
            return false;
        }
    }
    true
}

/// Mirrors Java `ReplaceManaEffect.resolve()`.
pub fn execute(
    effect: &ReplacementEffect,
    event: &mut ReplacementEvent,
    game: &GameState,
    source_card_id: CardId,
) -> ReplacementResult {
    let mana = match event {
        ReplacementEvent::ProduceMana { mana, .. } => mana,
        _ => return ReplacementResult::NotReplaced,
    };

    fn color_word_to_short(s: &str) -> String {
        match s.to_lowercase().as_str() {
            "white" | "w" => "W".into(),
            "blue" | "u" => "U".into(),
            "black" | "b" => "B".into(),
            "red" | "r" => "R".into(),
            "green" | "g" => "G".into(),
            "colorless" | "c" => "C".into(),
            _ => s.to_uppercase(),
        }
    }

    if let Some(replace_mana) = effect.ir.replace_mana_text.as_deref() {
        let replacement = if replace_mana == "Any" {
            "W".to_string()
        } else {
            color_word_to_short(replace_mana)
        };
        *mana = replacement;
        return ReplacementResult::Updated;
    } else if let Some(replace_type) = effect.ir.replace_type_text.as_deref() {
        let color = if replace_type == "Any" {
            "W".to_string()
        } else {
            color_word_to_short(replace_type)
        };
        let replaced: Vec<&str> = mana.split_whitespace().collect();
        let new_parts: Vec<String> = replaced.iter().map(|_| color.clone()).collect();
        *mana = new_parts.join(" ");
        return ReplacementResult::Updated;
    } else if let Some(replace_color) = effect.ir.replace_color_text.as_deref() {
        let color = if replace_color == "Chosen" {
            let host_card = &game.cards[source_card_id.index()];
            host_card
                .chosen_colors
                .first()
                .map(|c| color_word_to_short(c))
                .unwrap_or_else(|| "W".into())
        } else {
            color_word_to_short(replace_color)
        };
        let replace_only = effect
            .ir
            .replace_only_text
            .as_deref()
            .map(color_word_to_short);
        let colored = ["W", "U", "B", "R", "G"];
        let replaced: Vec<String> = mana
            .split_whitespace()
            .map(|tok| {
                if let Some(ref only) = replace_only {
                    if tok == only {
                        color.clone()
                    } else {
                        tok.to_string()
                    }
                } else if colored.contains(&tok) {
                    color.clone()
                } else {
                    tok.to_string()
                }
            })
            .collect();
        *mana = replaced.join(" ");
        return ReplacementResult::Updated;
    } else if let Some(replace_with) = effect.replace_with() {
        let multiplier = if replace_with.contains("Triple") || replace_with.contains("Thrice") {
            3usize
        } else if replace_with.contains("Twice") || replace_with.contains("Double") {
            2usize
        } else {
            effect
                .ir
                .replace_amount_text
                .as_deref()
                .and_then(|s| s.parse::<usize>().ok())
                .unwrap_or(2)
        };
        if multiplier > 1 {
            let parts: Vec<&str> = mana.split_whitespace().collect();
            let mut repeated = Vec::new();
            for _ in 0..multiplier {
                repeated.extend_from_slice(&parts);
            }
            *mana = repeated.join(" ");
            return ReplacementResult::Updated;
        }
    } else if let Some(amount) = effect.ir.replace_amount_text.as_deref() {
        if let Ok(multiplier) = amount.parse::<usize>() {
            if multiplier > 1 {
                let parts: Vec<&str> = mana.split_whitespace().collect();
                let mut repeated = Vec::new();
                for _ in 0..multiplier {
                    repeated.extend_from_slice(&parts);
                }
                *mana = repeated.join(" ");
                return ReplacementResult::Updated;
            }
        }
    }
    ReplacementResult::Replaced
}
