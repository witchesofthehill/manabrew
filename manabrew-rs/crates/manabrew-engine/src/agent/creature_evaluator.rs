//! Creature evaluation scoring for AI decision-making.
//!
//! Mirrors Java `forge/forge-ai/src/main/java/forge/ai/CreatureEvaluator.java`.
//! Used by AttachAi to decide whether to re-equip equipment.

use crate::card::Card;

/// Evaluate a creature's worth for AI decisions.
/// Returns a numeric score where higher = better creature.
///
/// Mirrors Java `CreatureEvaluator.evaluateCreature(Card, true, true)`.
pub fn evaluate_creature(card: &Card) -> i32 {
    evaluate_creature_full(card, true, true)
}

/// Evaluate a creature with optional P/T and CMC consideration.
///
/// Mirrors Java `CreatureEvaluator.evaluateCreature(Card, boolean, boolean)`.
pub fn evaluate_creature_full(card: &Card, consider_pt: bool, consider_cmc: bool) -> i32 {
    let mut value: i32 = 80;

    // Tokens are worth less than actual cards
    if !card.is_token {
        value += 20;
    }

    let power = if card.has_keyword("Prevent all combat damage that would be dealt by CARDNAME.")
        || card.has_keyword("Prevent all damage that would be dealt by CARDNAME.")
        || card
            .has_keyword("Prevent all combat damage that would be dealt to and dealt by CARDNAME.")
        || card.has_keyword("Prevent all damage that would be dealt to and dealt by CARDNAME.")
    {
        0
    } else if card.toughness_assigns_damage() {
        card.toughness()
    } else {
        card.power()
    };
    let toughness = card.toughness();

    if consider_pt {
        value += power * 15;
        value += toughness * 10;

        // Double-faced cards with daybound are stronger due to potential
        if card.has_keyword("Daybound") && card.is_double_faced() {
            value += power * 10;
        }
    }

    if consider_cmc {
        value += card.mana_value() * 5;
    }

    // ── Evasion keywords ──────────────────────────────────────────────
    if card.has_flying() {
        value += power * 10;
    }
    if card.has_keyword("Horsemanship") {
        value += power * 10;
    }
    // Unblockable check (simplified — Java uses StaticAbilityCantAttackBlock.cantBlockBy)
    if card.has_keyword("CARDNAME can't be blocked.") {
        value += power * 10;
    } else {
        if card.has_keyword("Fear") {
            value += power * 6;
        }
        if card.has_keyword("Intimidate") {
            value += power * 6;
        }
        if card.has_keyword("Menace") {
            value += power * 4;
        }
        if card.has_keyword("Skulk") {
            value += power * 3;
        }
    }

    // ── Combat keywords (only if power > 0) ───────────────────────────
    if power > 0 {
        if card.has_keyword("Double Strike") {
            value += 10 + (power * 15);
        } else if card.has_first_strike() {
            value += 10 + (power * 5);
        }
        if card.has_deathtouch() {
            value += 25;
        }
        if card.has_lifelink() {
            value += power * 10;
        }
        if power > 1 && card.has_keyword("Trample") {
            value += (power - 1) * 5;
        }
        if card.has_keyword("Vigilance") {
            value += (power * 5) + (toughness * 5);
        }
        if card.has_keyword("Infect") {
            value += power * 15;
        } else if card.has_keyword("Wither") {
            value += power * 10;
        }
        value += keyword_magnitude(card, "Toxic") * 5;
        value += keyword_magnitude(card, "Afflict") * 5;
        value += keyword_magnitude(card, "Rampage");
    }

    value += keyword_magnitude(card, "Annihilator") * 50;
    value += keyword_magnitude(card, "Absorb") * 11;

    // Keywords that produce buffs over time
    if card.has_keyword("Outlast") {
        value += 10;
    }
    value += keyword_magnitude(card, "Bushido") * 16;
    value += keyword_count(card, "Flanking") * 15;
    value += keyword_count(card, "Exalted") * 15;
    value += keyword_count(card, "Melee") * 18;
    value += keyword_count(card, "Prowess") * 5;

    // ── Defensive keywords ────────────────────────────────────────────
    if card.has_keyword("Reach") && !card.has_flying() {
        value += 5;
    }

    // ── Protection ────────────────────────────────────────────────────
    if card.has_indestructible() {
        value += 70;
    }
    // Shield counters: +20 per shield (CounterType::Shield may not exist yet)
    // else { value += 20 * card.counter_count(&CounterType::Shield); }
    if card.has_keyword("Prevent all damage that would be dealt to CARDNAME.") {
        value += 60;
    } else if card.has_keyword("Prevent all combat damage that would be dealt to CARDNAME.") {
        value += 50;
    }
    if card.has_hexproof() {
        value += 35;
    } else if card.has_keyword("Shroud") {
        value += 30;
    } else if card.has_keyword("Ward") {
        value += 10;
    }
    if card.has_keyword("Protection") {
        value += 20;
    }

    // Undying/Persist
    if card.has_keyword("Undying") || card.has_keyword("Persist") {
        value += 30;
    }

    // ── Bad keywords ──────────────────────────────────────────────────
    if card.has_defender() || card.has_keyword("CARDNAME can't attack.") {
        value -= (power * 9) + 40;
    }
    if card.has_keyword("CARDNAME can't attack or block.") {
        value = 50 + (card.mana_value() * 5); // reset — useless
    } else if card.has_keyword("CARDNAME can't block.") {
        value -= 10;
    }

    // Tapped + can't untap = useless
    if card.tapped && !card.can_untap() {
        value = 50 + (card.mana_value() * 5); // reset — useless
    }

    if !card.tapped {
        value += 1; // slight bonus for being untapped
    }

    // Mana abilities add value
    if card.activated_abilities.iter().any(|ab| ab.is_mana_ability) {
        value += 10;
    }

    // Phasing reduces value
    if card.has_keyword("Phasing") {
        value -= 20.max(value / 2);
    }

    // End of turn leaves play
    if card
        .svars
        .get("EndOfTurnLeavePlay")
        .map(|v| v == "True")
        .unwrap_or(false)
    {
        value -= 50;
    }

    value
}

/// Check if a creature is "useless" (can't attack or block effectively).
///
/// Mirrors Java `ComputerUtilCard.isUselessCreature()`.
pub fn is_useless_creature(card: &Card) -> bool {
    if card.has_defender() {
        return true;
    }
    if card.has_keyword("CARDNAME can't attack.") {
        return true;
    }
    if card.has_keyword("CARDNAME can't attack or block.") {
        return true;
    }
    if card.tapped && !card.can_untap() {
        return true;
    }
    false
}

/// Get the magnitude of a keyword (e.g. "Toxic:2" → 2).
/// Returns 0 if not found.
fn keyword_magnitude(card: &Card, kw: &str) -> i32 {
    card.get_keyword_cost(kw)
        .and_then(|s| s.parse::<i32>().ok())
        .unwrap_or(0)
}

/// Count how many times a keyword appears (e.g. multiple Exalted instances).
/// Returns 0 if not found.
fn keyword_count(card: &Card, kw: &str) -> i32 {
    card.keywords
        .as_string_list()
        .iter()
        .filter(|k| k.starts_with(kw))
        .count() as i32
}
