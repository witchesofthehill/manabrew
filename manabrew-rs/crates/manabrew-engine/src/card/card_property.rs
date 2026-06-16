//! Card property matching for targeting and filtering.
//!
//! Mirrors Java's `CardProperty.cardHasProperty()` — evaluates whether a card
//! matches a property string used in `ValidTgts$` filters (e.g. "nonBlack",
//! "OppCtrl", "YouCtrl").

use forge_foundation::Color;

use crate::card::filter_constants as fc;
use crate::card::Card;
use crate::ids::PlayerId;

/// Check if a card matches a compound filter string.
/// Supports color filters ("nonBlack"), controller filters ("OppCtrl", "YouCtrl"),
/// and combined dot-separated filters (e.g. "OppCtrl.nonBlack").
/// Mirrors Java's `CardProperty.cardHasProperty()` with dot-separated qualifiers.
pub fn card_has_property(card: &Card, filter: &str, source_controller: PlayerId) -> bool {
    // Handle compound filters separated by '.' or '+' (e.g. "OppCtrl.nonBlack", "nonLand+OppCtrl")
    // Both separators mean AND — all parts must match.
    for part in filter.split(['.', '+']) {
        if !matches_single_property(card, part, source_controller) {
            return false;
        }
    }
    true
}

/// Match a single property qualifier against a card.
/// Mirrors individual property checks in Java's `CardProperty.cardHasProperty()`.
fn matches_single_property(card: &Card, property: &str, source_controller: PlayerId) -> bool {
    match property {
        // Inclusive type checks (mirrors Java Card.isValid type token before dot).
        fc::CARD | "card" => true,
        fc::PERMANENT => card.is_permanent(),
        fc::CREATURE => card.is_creature(),
        fc::LAND => card.is_land(),
        fc::INSTANT => card.type_line.is_instant(),
        fc::SORCERY => card.type_line.is_sorcery(),
        fc::ARTIFACT => card.type_line.is_artifact(),
        fc::ENCHANTMENT => card.type_line.is_enchantment(),
        fc::PLANESWALKER => card.type_line.is_planeswalker(),
        fc::OPP_CTRL => card.controller != source_controller,
        fc::YOU_CTRL => card.controller == source_controller,
        fc::YOU_DONT_CTRL => card.controller != source_controller,
        "YouOwn" => card.owner == source_controller,
        "OppOwn" => card.owner != source_controller,
        "YouDontOwn" => card.owner != source_controller,
        // Combat qualifier used by scripts such as Stalking Leonin
        // (`ValidTgts$ Creature.attackingYou`): card must currently be
        // attacking the source controller.
        "attackingYou" => card.attacking_player == Some(source_controller),
        fc::OTHER => true, // "Other" means "not self" — handled at call site
        // Type-based filters
        fc::BASIC => card.type_line.is_basic(),
        "Legendary" => card.type_line.is_legendary(),
        fc::NON_LAND => !card.type_line.is_land(),
        fc::NON_CREATURE => !card.is_creature(),
        fc::NON_ARTIFACT => !card.type_line.is_artifact(),
        "tapped" => card.tapped,
        "untapped" => !card.tapped,
        _ => {
            let lower = property.to_ascii_lowercase();
            // Power comparisons (powerLE2, powerGE3, etc.)
            if let Some(rest) = lower.strip_prefix("powerle") {
                if let Ok(n) = rest.parse::<i32>() {
                    return card.power() <= n;
                }
                return false;
            }
            if let Some(rest) = lower.strip_prefix("powerge") {
                if let Ok(n) = rest.parse::<i32>() {
                    return card.power() >= n;
                }
                return false;
            }
            if let Some(rest) = lower.strip_prefix("powergt") {
                if let Ok(n) = rest.parse::<i32>() {
                    return card.power() > n;
                }
                return false;
            }
            if let Some(rest) = lower.strip_prefix("powerlt") {
                if let Ok(n) = rest.parse::<i32>() {
                    return card.power() < n;
                }
                return false;
            }
            if let Some(rest) = lower.strip_prefix("powereq") {
                if let Ok(n) = rest.parse::<i32>() {
                    return card.power() == n;
                }
                return false;
            }
            // Toughness comparisons (toughnessLE2, toughnessGE3, etc.)
            if let Some(rest) = lower.strip_prefix("toughnessle") {
                if let Ok(n) = rest.parse::<i32>() {
                    return card.toughness() <= n;
                }
                return false;
            }
            if let Some(rest) = lower.strip_prefix("toughnessge") {
                if let Ok(n) = rest.parse::<i32>() {
                    return card.toughness() >= n;
                }
                return false;
            }
            if let Some(rest) = lower.strip_prefix("toughnessgt") {
                if let Ok(n) = rest.parse::<i32>() {
                    return card.toughness() > n;
                }
                return false;
            }
            if let Some(rest) = lower.strip_prefix("toughnesslt") {
                if let Ok(n) = rest.parse::<i32>() {
                    return card.toughness() < n;
                }
                return false;
            }
            if let Some(rest) = lower.strip_prefix("toughnesseq") {
                if let Ok(n) = rest.parse::<i32>() {
                    return card.toughness() == n;
                }
                return false;
            }
            // CMC comparisons
            if let Some(rest) = lower.strip_prefix("cmcge") {
                if let Ok(n) = rest.parse::<i32>() {
                    return card.mana_cost.cmc() >= n;
                }
                return false;
            }
            if let Some(rest) = lower.strip_prefix("cmcgt") {
                if let Ok(n) = rest.parse::<i32>() {
                    return card.mana_cost.cmc() > n;
                }
                return false;
            }
            if let Some(rest) = lower.strip_prefix("cmcle") {
                if let Ok(n) = rest.parse::<i32>() {
                    return card.mana_cost.cmc() <= n;
                }
                return false;
            }
            if let Some(rest) = lower.strip_prefix("cmclt") {
                if let Ok(n) = rest.parse::<i32>() {
                    return card.mana_cost.cmc() < n;
                }
                return false;
            }
            if let Some(rest) = lower.strip_prefix("cmceq") {
                if let Ok(n) = rest.parse::<i32>() {
                    return card.mana_cost.cmc() == n;
                }
                return false;
            }
            if let Some(color_name) = lower.strip_prefix("non") {
                if let Some(color) = Color::from_name(color_name) {
                    !card.color.has_color(color)
                } else {
                    match color_name {
                        "colorless" => !card.color.is_colorless(),
                        "basic" => !card.type_line.is_basic(),
                        "legendary" => !card.type_line.is_legendary(),
                        "land" => !card.type_line.is_land(),
                        "creature" => !card.is_creature(),
                        "artifact" => !card.type_line.is_artifact(),
                        "enchantment" => !card.type_line.is_enchantment(),
                        "token" => !card.is_token,
                        _ => !card.has_subtype(&property[3..]),
                    }
                }
            } else if let Some(keyword) = property.strip_prefix("without") {
                !card.has_keyword(keyword)
            } else if let Some(keyword) = property.strip_prefix("with") {
                card.has_keyword(keyword)
            } else {
                // Check if it's a creature subtype (Wall, Zombie, Elf, etc.).
                // Mirrors Java's CardProperty.cardHasProperty() subtype matching.
                card.has_subtype(property)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use forge_foundation::{ColorSet, ManaCost};

    #[test]
    fn non_black_filter() {
        use crate::ids::CardId;

        let black_creature = Card::new(
            CardId(0),
            "Doom".to_string(),
            PlayerId(0),
            forge_foundation::CardTypeLine::parse("Creature - Zombie"),
            ManaCost::parse("1 B"),
            ColorSet::BLACK,
            Some(2),
            Some(2),
            vec![],
            vec![],
        );
        let green_creature = Card::new(
            CardId(1),
            "Bear".to_string(),
            PlayerId(0),
            forge_foundation::CardTypeLine::parse("Creature - Bear"),
            ManaCost::parse("1 G"),
            ColorSet::GREEN,
            Some(2),
            Some(2),
            vec![],
            vec![],
        );
        let caster = PlayerId(1);
        assert!(!card_has_property(&black_creature, "nonBlack", caster));
        assert!(card_has_property(&green_creature, "nonBlack", caster));
    }

    #[test]
    fn opp_ctrl_filter() {
        use crate::ids::CardId;

        let mut card = Card::new(
            CardId(0),
            "Bear".to_string(),
            PlayerId(1),
            forge_foundation::CardTypeLine::parse("Creature - Bear"),
            ManaCost::parse("1 G"),
            ColorSet::GREEN,
            Some(2),
            Some(2),
            vec![],
            vec![],
        );
        card.controller = PlayerId(1);
        let caster = PlayerId(0);
        assert!(card_has_property(&card, "OppCtrl", caster));
        assert!(!card_has_property(&card, "YouCtrl", caster));
    }

    #[test]
    fn compound_filter() {
        use crate::ids::CardId;

        let mut card = Card::new(
            CardId(0),
            "Bear".to_string(),
            PlayerId(1),
            forge_foundation::CardTypeLine::parse("Creature - Bear"),
            ManaCost::parse("1 G"),
            ColorSet::GREEN,
            Some(2),
            Some(2),
            vec![],
            vec![],
        );
        card.controller = PlayerId(1);
        let caster = PlayerId(0);
        // OppCtrl.nonBlack → opponent controls + not black → true for green creature
        assert!(card_has_property(&card, "OppCtrl.nonBlack", caster));
    }

    #[test]
    fn ownership_filters() {
        use crate::ids::CardId;

        let mut card = Card::new(
            CardId(8),
            "Borrowed Bear".to_string(),
            PlayerId(0),
            forge_foundation::CardTypeLine::parse("Creature - Bear"),
            ManaCost::parse("1 G"),
            ColorSet::GREEN,
            Some(2),
            Some(2),
            vec![],
            vec![],
        );
        card.controller = PlayerId(1);

        assert!(card_has_property(&card, "YouOwn", PlayerId(0)));
        assert!(!card_has_property(&card, "YouOwn", PlayerId(1)));
        assert!(card_has_property(&card, "OppOwn", PlayerId(1)));
    }

    #[test]
    fn non_swamp_filter_checks_subtype_not_color() {
        use crate::ids::CardId;

        let swamp = Card::new(
            CardId(4),
            "Swamp".to_string(),
            PlayerId(0),
            forge_foundation::CardTypeLine::parse("Basic Land - Swamp"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            None,
            None,
            vec![],
            vec![],
        );
        let cliffgate = Card::new(
            CardId(5),
            "Cliffgate".to_string(),
            PlayerId(0),
            forge_foundation::CardTypeLine::parse("Land - Gate"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            None,
            None,
            vec![],
            vec![],
        );

        assert!(!card_has_property(&swamp, "nonSwamp", PlayerId(0)));
        assert!(card_has_property(&cliffgate, "nonSwamp", PlayerId(0)));
    }

    #[test]
    fn nonbasic_filter_checks_basic_supertype() {
        use crate::ids::CardId;

        let basic_swamp = Card::new(
            CardId(6),
            "Swamp".to_string(),
            PlayerId(0),
            forge_foundation::CardTypeLine::parse("Basic Land - Swamp"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            None,
            None,
            vec![],
            vec![],
        );
        let cliffgate = Card::new(
            CardId(7),
            "Cliffgate".to_string(),
            PlayerId(0),
            forge_foundation::CardTypeLine::parse("Land - Gate"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            None,
            None,
            vec![],
            vec![],
        );

        assert!(!card_has_property(&basic_swamp, "nonBasic", PlayerId(0)));
        assert!(card_has_property(&cliffgate, "nonBasic", PlayerId(0)));
    }

    #[test]
    fn creature_you_ctrl_requires_creature_type() {
        use crate::ids::CardId;

        let sorcery = Card::new(
            CardId(2),
            "Innocent Blood".to_string(),
            PlayerId(0),
            forge_foundation::CardTypeLine::parse("Sorcery"),
            ManaCost::parse("B"),
            ColorSet::BLACK,
            None,
            None,
            vec![],
            vec![],
        );

        assert!(!card_has_property(
            &sorcery,
            "Creature.YouCtrl",
            PlayerId(0)
        ));
    }

    #[test]
    fn cmc_comparators() {
        use crate::ids::CardId;

        let creature = Card::new(
            CardId(3),
            "Hill Giant".to_string(),
            PlayerId(0),
            forge_foundation::CardTypeLine::parse("Creature - Giant"),
            ManaCost::parse("3 R"),
            ColorSet::RED,
            Some(3),
            Some(3),
            vec![],
            vec![],
        );

        assert!(card_has_property(&creature, "cmcGE3", PlayerId(0)));
        assert!(card_has_property(&creature, "cmcGT2", PlayerId(0)));
        assert!(card_has_property(&creature, "cmcLE4", PlayerId(0)));
        assert!(card_has_property(&creature, "cmcLT5", PlayerId(0)));
        assert!(card_has_property(&creature, "cmcEQ4", PlayerId(0)));
        assert!(!card_has_property(&creature, "cmcGE5", PlayerId(0)));
        assert!(!card_has_property(&creature, "cmcEQ3", PlayerId(0)));
    }
}
