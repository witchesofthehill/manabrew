//! Partial parity module for Java `CardFactoryUtil`.

use std::collections::HashSet;

use crate::card::Card;
use crate::parsing::{keys, Params};
use crate::replacement::parse_replacement_effect;
use crate::replacement::ReplacementEffect;
use crate::spellability::SpellAbility;
use crate::staticability::StaticAbility;
use crate::trigger::Trigger;

pub fn ability_cast_face_down(card: &Card, _intrinsic: bool, key: &str) -> SpellAbility {
    SpellAbility::new_simple(Some(card.id), card.controller, &format!("FaceDown:{key}"))
}

pub fn resolve(sa: &SpellAbility, card: &mut Card) {
    if let Some(raw) = sa.ir.add_keywords.as_deref() {
        for kw in raw.split('&').map(str::trim).filter(|s| !s.is_empty()) {
            card.add_intrinsic_keyword(kw);
        }
    }
    if let Some(raw) = sa.ir.add_types.as_deref() {
        for ty in raw.split(',').map(str::trim).filter(|s| !s.is_empty()) {
            card.add_type(ty);
        }
    }
}

pub fn can_play(sa: &SpellAbility, card: &Card) -> bool {
    sa.source == Some(card.id) && sa.activating_player == card.controller
}

pub fn ability_unlock_room(card: &Card) -> SpellAbility {
    SpellAbility::new_simple(Some(card.id), card.controller, "UnlockRoom")
}

pub fn ability_morph_up(card: &Card, cost_str: &str, mega: bool, _intrinsic: bool) -> SpellAbility {
    SpellAbility::new_simple(
        Some(card.id),
        card.controller,
        &format!("MorphUp:{cost_str}:{mega}"),
    )
}

pub fn ability_disguise_up(card: &Card, cost_str: &str, _intrinsic: bool) -> SpellAbility {
    SpellAbility::new_simple(
        Some(card.id),
        card.controller,
        &format!("DisguiseUp:{cost_str}"),
    )
}

pub fn ability_turn_face_up(card: &Card, key: &str, desc: &str) -> SpellAbility {
    SpellAbility::new_simple(
        Some(card.id),
        card.controller,
        &format!("TurnFaceUp:{key}:{desc}"),
    )
}

pub fn handle_hidden_agenda(_player: crate::ids::PlayerId, _card: &mut Card) -> bool {
    false
}

pub fn extract_operators(expression: &str) -> String {
    expression
        .chars()
        .filter(|c| matches!(c, '+' | '-' | '*' | '/' | '<' | '>' | '=' | '!'))
        .collect()
}

pub fn sort_colors_from_list(list: &[Card]) -> [i32; 5] {
    let mut out = [0; 5];
    for c in list {
        if c.color.has_white() {
            out[0] += 1;
        }
        if c.color.has_blue() {
            out[1] += 1;
        }
        if c.color.has_black() {
            out[2] += 1;
        }
        if c.color.has_red() {
            out[3] += 1;
        }
        if c.color.has_green() {
            out[4] += 1;
        }
    }
    out
}

pub fn shared_keywords(
    keywords: impl IntoIterator<Item = String>,
    restrictions: &[String],
) -> Vec<String> {
    let restrictions_lc: HashSet<String> = restrictions
        .iter()
        .map(|s| s.to_ascii_lowercase())
        .collect();
    keywords
        .into_iter()
        .filter(|kw| {
            if restrictions_lc.is_empty() {
                return true;
            }
            restrictions_lc
                .iter()
                .any(|r| kw.to_ascii_lowercase().contains(r))
        })
        .collect()
}

pub fn add_ability_factory_abilities(card: &mut Card, abilities: &[String]) {
    for raw in abilities {
        let sa =
            crate::spellability::build_spell_ability_from_host_card(card, raw, card.controller);
        card.add_spell_ability(&sa);
    }
}

pub fn setup_keyworded_abilities(card: &mut Card) {
    card.generate_keyword_abilities();
    card.generate_keyword_triggers();
    card.base_ability_count = card.activated_abilities.len();
}

/// Generate Dredge replacement effects from the `Dredge:N` keyword.
///
/// Mirrors Java `CardFactoryUtil` Dredge keyword handling which creates a
/// Draw replacement effect:
/// ```text
/// R$ Event$ Draw | ActiveZones$ Graveyard | ValidPlayer$ You
///   | Secondary$ True | Optional$ True
///   | DredgeAmount$ N
///   | Description$ CARDNAME - Dredge N
/// ```
///
/// We use `DredgeAmount$` as a Rust-specific tag (instead of Java's
/// `CheckSVar$` / overriding ability) to keep the implementation simple.
/// The actual mill + return logic is in `replace_draw::execute`.
pub fn add_dredge_replacement(card: &mut Card) {
    let keywords = card.keywords.as_string_list();
    for keyword in keywords {
        let Some(rest) = keyword.strip_prefix("Dredge:") else {
            continue;
        };
        let Ok(amount) = rest.trim().parse::<usize>() else {
            continue;
        };
        let repl_str = format!(
            "R$ Event$ Draw | ActiveZones$ Graveyard | ValidPlayer$ You \
             | Secondary$ True | Optional$ True \
             | DredgeAmount$ {} \
             | Description$ {} - Dredge {}",
            amount, card.card_name, amount
        );
        if let Some(repl) = parse_replacement_effect(&repl_str) {
            card.add_replacement_effect(repl);
        }
    }
}

/// Java parity: convert `ETBReplacement:*` keywords into intrinsic
/// `Event$ Moved` replacement effects during card construction.
///
/// Mirrors `CardFactoryUtil.createETBReplacement(...)` plus the
/// `keyword.startsWith("ETBReplacement")` branch in Java.
pub fn add_etb_keyword_replacements(card: &mut Card) {
    let keywords = card.keywords.as_string_list();
    for keyword in keywords {
        if !keyword.starts_with("ETBReplacement") {
            continue;
        }
        let splitkw: Vec<&str> = keyword.split(':').collect();
        if splitkw.len() < 3 {
            continue;
        }

        let layer = splitkw[1].trim();
        let svar_name = splitkw[2].trim();
        let optional = splitkw.len() >= 4 && splitkw[3].contains("Optional");
        let zone = if splitkw.len() >= 5 {
            splitkw[4].trim()
        } else {
            ""
        };
        let valid = if splitkw.len() >= 6 {
            splitkw[5].trim()
        } else {
            "Card.Self"
        };

        let Some(svar_text) = card.svars.get(svar_name).cloned() else {
            continue;
        };
        let desc = Params::from_raw(&svar_text)
            .get(keys::SPELL_DESCRIPTION)
            .unwrap_or("Replacement effect")
            .replace('|', "/");

        let mut raw = format!(
            "R$ Event$ Moved | Layer$ {} | ValidCard$ {} | Destination$ Battlefield | ReplacementResult$ Updated | ReplaceWith$ {} | Description$ {}",
            layer, valid, svar_name, desc
        );
        if optional {
            raw.push_str(" | Optional$ True");
        }
        if !zone.is_empty() {
            raw.push_str(" | ActiveZones$ ");
            raw.push_str(zone);
        }

        if let Some(re) = parse_replacement_effect(&raw) {
            card.add_replacement_effect(re);
        }
    }
}

pub fn make_etb_counter(_kw: &str, _card: &Card, _intrinsic: bool) -> Option<ReplacementEffect> {
    None
}

pub fn add_madness_replacement(card: &mut Card) {
    let keywords = card.keywords.as_string_list();
    for keyword in keywords {
        let Some(cost) = keyword.strip_prefix("Madness:") else {
            continue;
        };
        let cost = cost.trim();
        let desc = if cost == "ManaCost" {
            "Madness: If you discard this card, discard it into exile.".to_string()
        } else {
            let display = forge_foundation::ManaCost::parse(cost);
            format!(
                "Madness {}: If you discard this card, discard it into exile.",
                display
            )
        };
        let repl_str = format!(
            "R$ Event$ Moved | ActiveZones$ Hand | ValidCard$ Card.Self | Discard$ True \
             | Secondary$ True | NewDestination$ Exile \
             | Description$ {}",
            desc
        );
        if let Some(repl) = parse_replacement_effect(&repl_str) {
            card.add_replacement_effect(repl);
        }
    }
}

/// Mirrors Java `CardFactoryUtil.aaFlashback()` — registers a replacement effect
/// that exiles the card instead of sending it to the graveyard from the stack.
/// Java uses `ValidStackSa$ Spell.Flashback+castKeyword` but in practice the
/// replacement fires for ANY card with the Flashback keyword leaving the stack,
/// because `castKeyword` matches the keyword's presence, not the cast mode.
pub fn add_flashback_replacement(card: &mut Card) {
    let keywords = card.keywords.as_string_list();
    let has_flashback = keywords.iter().any(|kw| kw.starts_with("Flashback:"));
    if !has_flashback {
        return;
    }
    let cost_display = keywords
        .iter()
        .find_map(|kw| kw.strip_prefix("Flashback:"))
        .map(|c| {
            let mc = forge_foundation::ManaCost::parse(c.trim());
            format!("{}", mc)
        })
        .unwrap_or_default();
    let desc = format!(
        "Flashback {} (You may cast this card from your graveyard for its flashback cost. Then exile it.)",
        cost_display
    );
    let repl_str = format!(
        "R$ Event$ Moved | ValidCard$ Card.Self | Origin$ Stack | ExcludeDestination$ Exile \
         | FlashbackCast$ True | Secondary$ True | NewDestination$ Exile \
         | Description$ {}",
        desc
    );
    if let Some(repl) = parse_replacement_effect(&repl_str) {
        card.add_replacement_effect(repl);
    }
}

pub fn add_harmonize_replacement(card: &mut Card) {
    let keywords = card.keywords.as_string_list();
    let Some(cost) = keywords
        .iter()
        .find_map(|kw| kw.strip_prefix("Harmonize:").map(str::trim))
    else {
        return;
    };
    let cost_display = forge_foundation::ManaCost::parse(cost);
    let desc = format!(
        "Harmonize {} (You may cast this card from your graveyard for its harmonize cost. You may tap a creature you control to reduce that cost by {{X}}, where X is its power. Then exile this spell.)",
        cost_display
    );
    let repl_str = format!(
        "R$ Event$ Moved | ValidCard$ Card.Self | Origin$ Stack | ExcludeDestination$ Exile \
         | HarmonizeCast$ True | Secondary$ True | NewDestination$ Exile \
         | Description$ {}",
        desc
    );
    if let Some(repl) = parse_replacement_effect(&repl_str) {
        card.add_replacement_effect(repl);
    }
}

pub fn add_trigger_ability(card: &mut Card, trig: Trigger) {
    card.add_trigger(trig);
}

pub fn add_replacement_effect(card: &mut Card, re: ReplacementEffect) {
    card.add_replacement_effect(re);
}

pub fn add_spell_ability(card: &mut Card, sa: &SpellAbility) {
    card.add_spell_ability(sa);
}

pub fn add_static_ability(card: &mut Card, st: StaticAbility) {
    card.add_static_ability(st);
}

pub fn setup_siege_abilities(card: &mut Card) {
    card.update_triggers();
}

pub fn setup_adventure_ability(_card: &mut Card) -> Option<ReplacementEffect> {
    None
}

pub fn setup_omen_ability(_card: &mut Card) -> Option<ReplacementEffect> {
    None
}

pub fn run() {
    let _ = extract_operators("X+Y");
}
