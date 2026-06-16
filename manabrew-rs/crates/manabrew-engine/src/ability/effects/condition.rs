//! SpellAbility condition gating.
//!
use forge_foundation::ZoneType;

use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::parsing::compare::{compare_expr, CompareExpr};
use crate::spellability::SpellAbility;

use super::helpers::matches_valid_cards_for_sa;

/// Check if a conditional gate on this SA is satisfied.
pub(super) fn check_condition(game: &GameState, sa: &SpellAbility) -> bool {
    let activator = sa.activating_player;

    // Player-state gates (SpellAbilityCondition.areMet L263–L269).
    if sa.ir.condition_hellbent && !crate::player::has_hellbent(game, activator) {
        return false;
    }
    if sa.ir.condition_threshold && !crate::player::has_threshold(game, activator) {
        return false;
    }
    if sa.ir.condition_metalcraft && !crate::player::has_metalcraft(game, activator) {
        return false;
    }
    if sa.ir.condition_delirium && !crate::player::has_delirium(game, activator) {
        return false;
    }
    if sa.ir.condition_revolt && !crate::player::has_revolt(game, activator) {
        return false;
    }
    if sa.ir.condition_desert && !crate::player::has_desert(game, activator) {
        return false;
    }
    if sa.ir.condition_blessing && !crate::player::has_blessing(game, activator) {
        return false;
    }

    // Kicked-related flags (L271–L280).
    if sa.ir.condition_kicked && !sa.kicked {
        return false;
    }
    if sa.ir.condition_optional_paid && !sa.optional_generic_cost_paid {
        return false;
    }
    if sa.ir.condition_optional_not_paid && sa.optional_generic_cost_paid {
        return false;
    }

    // Turn-owner gates (L300–L311).
    if let Some(raw) = sa.ir.condition_player_turn.as_deref() {
        let expect_self_turn = !raw.eq_ignore_ascii_case("False");
        let is_self_turn = game.turn.active_player == activator;
        if expect_self_turn != is_self_turn {
            return false;
        }
    }
    if sa.ir.condition_opponent_turn && game.turn.active_player == activator {
        return false;
    }

    // Hand-size gate: `ConditionCardsInHand$ N` or `ConditionCardsInHand$ GE3`.
    if let Some(raw) = sa.ir.condition_cards_in_hand.as_deref() {
        let size = game
            .cards_in_zone(forge_foundation::ZoneType::Hand, activator)
            .len() as i32;
        if let Ok(n) = raw.parse::<i32>() {
            if size != n {
                return false;
            }
        } else if !compare_expr(size, raw) {
            return false;
        }
    }

    // Phase gate: `ConditionPhases$ End Of Turn,Upkeep` (comma-separated).
    if let Some(phases) = sa.ir.condition_phases.as_deref() {
        let current = game.turn.phase;
        let ok = phases
            .split(',')
            .map(str::trim)
            .filter_map(forge_foundation::PhaseType::from_script_name)
            .any(|p| p == current);
        if !ok {
            return false;
        }
    }

    // Life-compare gate: `ConditionLifeCompare$ GE20`.
    if let Some(cmp) = sa.ir.condition_life_compare.as_deref() {
        if !compare_expr(game.player(activator).life, cmp) {
            return false;
        }
    }

    // Check Condition$ Kicked (most common pattern: simple kicked gate)
    if let Some(cond) = sa.ir.condition.as_deref() {
        if cond == "Kicked" {
            return sa.kicked;
        }
    }
    // Check ConditionCheckSVar$ Kicked (SVar-based kicked gate)
    if let Some(cond) = sa.ir.condition_check_svar.as_deref() {
        if cond == "Kicked" || cond == "X:Kicked" {
            return sa.kicked;
        }
        let compare = sa.ir.condition_svar_compare.as_deref().unwrap_or("GE1");
        let Some(source_id) = sa.source else {
            return false;
        };
        let Some(expr) = game.card(source_id).get_s_var(cond) else {
            return false;
        };

        let value = if let Some(valid_filter) = expr.strip_prefix("Imprinted$Valid ") {
            let imprinted = game.card(source_id).imprinted_cards.clone();
            if valid_filter.eq_ignore_ascii_case("Card.sharesNameWith Remembered") {
                let remembered_names: std::collections::HashSet<String> = game
                    .card(source_id)
                    .remembered_cards
                    .iter()
                    .map(|&cid| game.card(cid).card_name.clone())
                    .collect();
                imprinted
                    .into_iter()
                    .filter(|&cid| remembered_names.contains(&game.card(cid).card_name))
                    .count() as i32
            } else {
                imprinted
                    .into_iter()
                    .filter(|&cid| {
                        matches_valid_cards_for_sa(game, sa, game.card(cid), None, valid_filter)
                    })
                    .count() as i32
            }
        } else {
            crate::svar::resolve_svar_expression(expr, game, source_id, sa.activating_player, sa)
        };
        return compare_with_svar_threshold(value, compare, game, source_id, sa);
    }
    true
}

/// Like `compare_expr` but resolves an SVar reference when the threshold isn't
/// a literal integer. Beza's condition uses
/// `ConditionSVarCompare$ GTYLands` where `YLands` is another SVar on the host
/// — the bare comparator parser would fall through to "permissive true" and
/// silently make every conditional sub-ability fire.
fn compare_with_svar_threshold(
    value: i32,
    compare: &str,
    game: &GameState,
    source_id: CardId,
    sa: &SpellAbility,
) -> bool {
    if let Some(parsed) = CompareExpr::parse(compare) {
        return parsed.evaluate(value);
    }
    let Some((op_str, rhs_name)) = split_compare_prefix(compare) else {
        return true;
    };
    let Some(rhs_expr) = game.card(source_id).get_s_var(rhs_name) else {
        return true;
    };
    let rhs_value =
        crate::svar::resolve_svar_expression(rhs_expr, game, source_id, sa.activating_player, sa);
    compare_expr(value, &format!("{op_str}{rhs_value}"))
}

fn split_compare_prefix(expr: &str) -> Option<(&'static str, &str)> {
    for prefix in ["GE", "GT", "LE", "LT", "NE", "EQ"] {
        if let Some(rest) = expr.strip_prefix(prefix) {
            return Some((prefix, rest));
        }
    }
    None
}

/// Check ConditionPresent$ / ConditionZone$ / ConditionCompare$ against game state.
/// Returns true if the condition is met (or if no condition params exist).
///
/// When `ConditionDefined$` is present, check the defined cards instead of
/// scanning a zone
pub(super) fn check_condition_present(
    game: &GameState,
    sa: &SpellAbility,
    player: PlayerId,
    source_id: CardId,
) -> bool {
    let condition = match sa.ir.condition_present.as_deref() {
        Some(c) => c,
        None => return true, // No condition — always passes
    };

    // Parse condition alternatives (comma-separated)
    let alternatives: Vec<&str> = condition.split(',').map(|s| s.trim()).collect();

    // ── ConditionDefined$ — check specific defined cards, not a zone ──
    if let Some(cond_defined) = sa.ir.condition_defined.as_ref() {
        let defined_cards: Vec<CardId> = match cond_defined.refs.first() {
            Some(crate::ability::ability_ir::DefinedRef::Targeted) => {
                sa.target_chosen.target_card.into_iter().collect()
            }
            Some(crate::ability::ability_ir::DefinedRef::SelfCard) => {
                sa.source.into_iter().collect()
            }
            Some(crate::ability::ability_ir::DefinedRef::Remembered) => sa
                .source
                .map(|sid| game.card(sid).remembered_cards.clone())
                .unwrap_or_default(),
            Some(other) => match other.as_legacy_str() {
                "Targeted" => sa.target_chosen.target_card.into_iter().collect(),
                "Self" => sa.source.into_iter().collect(),
                "Remembered" => sa
                    .source
                    .map(|sid| game.card(sid).remembered_cards.clone())
                    .unwrap_or_default(),
                _ => Vec::new(),
            },
            None => Vec::new(),
        };

        // ConditionDefined$ cards are explicitly defined — don't exclude self.
        // Self-exclusion only makes sense for the zone-scan path below.
        let count = defined_cards
            .iter()
            .filter(|&&cid| {
                matches_condition_filter_no_self_exclude(
                    game,
                    cid,
                    source_id,
                    player,
                    &alternatives,
                )
            })
            .count() as i32;

        return if let Some(compare) = sa.ir.condition_compare.as_deref() {
            compare_expr(count, compare)
        } else {
            count > 0
        };
    }

    let zone = sa.ir.condition_zone.unwrap_or(ZoneType::Battlefield);

    let cards: Vec<CardId> = game
        .players
        .iter()
        .flat_map(|p| game.cards_in_zone(zone, p.id).iter().copied())
        .collect();
    let count = cards
        .iter()
        .filter(|&&cid| {
            matches_condition_filter_no_self_exclude(game, cid, source_id, player, &alternatives)
        })
        .count() as i32;

    // Check ConditionCompare$ (e.g. "GE2", "EQ0")
    if let Some(compare) = sa.ir.condition_compare.as_deref() {
        compare_expr(count, compare)
    } else {
        count > 0
    }
}

/// Check if a card matches a condition filter expression.
/// Handles type matching + qualifier checks (YouCtrl, OppCtrl, ChosenCtrl, etc.).
/// Like matches_condition_filter but without self-exclusion.
/// Used by ConditionDefined$ where the defined cards are explicitly specified.
fn matches_condition_filter_no_self_exclude(
    game: &GameState,
    cid: CardId,
    source_id: CardId,
    player: PlayerId,
    alternatives: &[&str],
) -> bool {
    let card = game.card(cid);
    let source = game.card(source_id);
    alternatives
        .iter()
        .any(|alt| crate::card::valid_filter::matches_valid(alt, Some(card), None, source, player))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card::Card;
    use crate::game::GameState;
    use crate::ids::{CardId, PlayerId};
    use crate::spellability::SpellAbility;
    use forge_foundation::{CardTypeLine, ColorSet, ManaCost};

    #[test]
    fn condition_present_targeted_nonbasic_matches_destroyed_land() {
        let player = PlayerId(0);
        let mut game = GameState::new(&["P1"], 20);
        let spell_source = game.create_card(Card::new(
            CardId(0),
            "Choking Sands".to_string(),
            player,
            CardTypeLine::parse("Sorcery"),
            ManaCost::parse("1 B B"),
            ColorSet::BLACK,
            None,
            None,
            vec![],
            vec![],
        ));
        let target = game.create_card(Card::new(
            CardId(0),
            "Cliffgate".to_string(),
            player,
            CardTypeLine::parse("Land - Gate"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            None,
            None,
            vec![],
            vec![],
        ));

        let mut sa = SpellAbility::new_simple(
            Some(spell_source),
            player,
            "DB$ DealDamage | ConditionDefined$ Targeted | ConditionPresent$ Land.Basic | ConditionCompare$ EQ0",
        );
        sa.target_chosen.target_card = Some(target);

        assert!(check_condition_present(&game, &sa, player, spell_source));
    }
}
