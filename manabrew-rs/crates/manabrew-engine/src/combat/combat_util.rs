//! Static utility methods related to combat.
use forge_foundation::ZoneType;

use super::attack_constraints::AttackConstraints;
use super::{CombatState, DefenderId, LureType};
use crate::card::{valid_filter, Card};
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::staticability::static_ability::StaticMode;
use crate::staticability::static_ability_cant_attack_block;

pub fn get_available_attackers(game: &GameState, player: PlayerId) -> Vec<CardId> {
    let defending = game.opponent_of(player);
    game.creatures_on_battlefield(player)
        .into_iter()
        .filter(|&cid| {
            let card = game.card(cid);
            if card.can_attack() {
                return true;
            }
            card.is_creature()
                && !card.tapped
                && !card.cant_attack_static
                && !card.detained
                && (card.has_haste() || !card.summoning_sick)
                && card.zone == ZoneType::Battlefield
                && card.has_defender()
                && crate::staticability::static_ability_can_attack_defender::can_attack_defender(
                    &game.cards,
                    card,
                    defending,
                )
        })
        .collect()
}

pub fn can_attack_player(game: &GameState, player: PlayerId) -> bool {
    !get_available_attackers(game, player).is_empty()
}

pub fn can_attack_defender(game: &GameState, attacker_id: CardId, defender: DefenderId) -> bool {
    let card = game.card(attacker_id);

    // Basic creature checks
    if !card.is_creature() || card.tapped || card.phased_out {
        return false;
    }
    // Summoning sickness (unless haste)
    if card.summoning_sick && !card.has_haste() {
        return false;
    }

    // CantAttack static abilities
    if card.cant_attack_static {
        return false;
    }
    if card.detained {
        return false;
    }

    // Check per-defender CantAttack static abilities
    if let DefenderId::Player(pid) = defender {
        if !crate::staticability::static_ability_can_attack_defender::can_attack_defender(
            &game.cards,
            card,
            pid,
        ) {
            return false;
        }
    }

    true
}

pub fn validate_attackers(
    game: &GameState,
    constraints: &AttackConstraints,
    current_attackers: &[(CardId, DefenderId)],
) -> bool {
    let my_violations = constraints.count_violations(current_attackers, &game.cards);
    if my_violations == -1 {
        return false;
    }
    let (_, best_violations) = constraints.get_legal_attackers(&game.cards);
    my_violations <= best_violations
}

pub fn get_possible_defenders(game: &GameState, attacking_player: PlayerId) -> Vec<DefenderId> {
    let mut defenders = Vec::new();
    for pid in game.alive_players() {
        if pid == attacking_player {
            continue;
        }
        defenders.push(DefenderId::Player(pid));
        // Planeswalkers controlled by this opponent
        for &cid in game.cards_in_zone(ZoneType::Battlefield, pid) {
            let card = game.card(cid);
            if card.type_line.is_planeswalker() {
                defenders.push(DefenderId::Permanent(cid));
            }
        }
    }
    defenders
}

pub fn get_available_blockers(game: &GameState, player: PlayerId) -> Vec<CardId> {
    game.creatures_on_battlefield(player)
        .into_iter()
        .filter(|&cid| can_block(game, cid))
        .collect()
}

pub fn can_creature_block(game: &GameState, blocker_id: CardId, attacker_id: CardId) -> bool {
    let attacker = game.card(attacker_id);
    let blocker = game.card(blocker_id);

    if !blocker.can_block() {
        return false;
    }

    // Flying: only blocked by flying or reach
    if attacker.has_flying() && !blocker.has_flying() && !blocker.has_reach() {
        return false;
    }
    // Fear: only blocked by artifact or black creatures
    if attacker.has_fear() && !blocker.type_line.is_artifact() && !blocker.color.has_black() {
        return false;
    }
    // Intimidate: only blocked by artifact or creatures sharing a color
    if attacker.has_intimidate()
        && !blocker.type_line.is_artifact()
        && !blocker.color.shares_color_with(attacker.color)
    {
        return false;
    }
    // Shadow: shadow only blocked by shadow, non-shadow not blocked by shadow
    if attacker.has_shadow() != blocker.has_shadow() {
        return false;
    }
    // Horsemanship: only blocked by horsemanship
    if attacker.has_horsemanship() && !blocker.has_horsemanship() {
        return false;
    }
    // Skulk: can't be blocked by creatures with greater power
    if attacker.has_skulk() && blocker.power() > attacker.power() {
        return false;
    }
    // Protection: can't be blocked by matching creatures
    if attacker.is_protected_from(blocker) {
        return false;
    }
    // CantBlockBy static abilities
    if cant_block_by(game, attacker_id, blocker_id) {
        return false;
    }
    true
}

/// Check if any `CantBlockBy` static ability prevents blocking.
fn cant_block_by(game: &GameState, attacker_id: CardId, blocker_id: CardId) -> bool {
    let attacker = game.card(attacker_id);
    let blocker = game.card(blocker_id);

    for source in game
        .cards
        .iter()
        .filter(|c| c.zone == ZoneType::Battlefield || c.zone == ZoneType::Command)
    {
        for sa in &source.static_abilities {
            if !sa.check_mode(&StaticMode::CantBlockBy) {
                continue;
            }

            if let Some(valid_attacker) = sa.ir.valid_attacker.as_ref() {
                if !valid_filter::matches_valid_card_selector_in_game(
                    valid_attacker,
                    attacker,
                    source,
                    game,
                ) {
                    continue;
                }
            }

            if let Some(valid_blocker) = sa.ir.valid_blocker.as_ref() {
                if !valid_filter::matches_valid_card_selector_in_game(
                    valid_blocker,
                    blocker,
                    source,
                    game,
                ) {
                    continue;
                }
            }

            return true;
        }
    }
    false
}

/// Filter blockers to only those that can legally block at least one attacker.
pub fn filter_legal_blockers(
    game: &GameState,
    attackers: &[CardId],
    blockers: &[CardId],
) -> Vec<CardId> {
    blockers
        .iter()
        .filter(|&&blocker_id| {
            attackers
                .iter()
                .any(|&attacker_id| can_creature_block(game, blocker_id, attacker_id))
        })
        .copied()
        .collect()
}

pub fn validate_blocks(game: &GameState, combat: &CombatState) -> Vec<(CardId, CardId)> {
    let mut invalid = Vec::new();

    for &(attacker_id, _) in &combat.attackers {
        let blockers_for = combat.get_blockers_for(attacker_id);
        let num_blockers = blockers_for.len();

        if num_blockers == 0 {
            continue;
        }

        // Check blockers with "can't block alone" keyword
        for &blocker_id in &blockers_for {
            let blocker = game.card(blocker_id);
            let cant_block_alone = blocker
                .keywords
                .iter_strings()
                .chain(blocker.granted_keywords.iter_strings())
                .chain(blocker.pump_keywords.iter_strings())
                .any(|kw| kw.to_lowercase().contains("can't block alone"));

            if cant_block_alone && num_blockers == 1 {
                invalid.push((blocker_id, attacker_id));
            }
        }
    }

    invalid
}

/// Check if a blocker must block an attacker this combat.
pub fn must_block_an_attacker(game: &GameState, combat: &CombatState, blocker_id: CardId) -> bool {
    let blocker = game.card(blocker_id);
    if blocker.must_block {
        return true;
    }
    !compute_must_block_targets(game, combat, blocker_id).is_empty()
}

/// Determine the lure type of an attacker.
pub fn get_lure_type(card: &Card) -> LureType {
    for kw in card
        .keywords
        .iter_strings()
        .chain(card.granted_keywords.iter_strings())
        .chain(card.pump_keywords.iter_strings())
    {
        let lower = kw.to_lowercase();
        if lower.contains("all creatures able to block") && lower.contains("do so") {
            return LureType::AllMustBlock;
        }
        if lower.contains("must be blocked if able") {
            return LureType::MustBeBlockedIfAble;
        }
    }
    LureType::None
}

/// Get attackers that `blocker_id` MUST block (if able).
pub fn compute_must_block_targets(
    game: &GameState,
    combat: &CombatState,
    blocker_id: CardId,
) -> Vec<CardId> {
    let mut targets = Vec::new();
    let blocker = game.card(blocker_id);

    for &(attacker_id, _) in &combat.attackers {
        let attacker = game.card(attacker_id);
        let lure = get_lure_type(attacker);
        match lure {
            LureType::AllMustBlock | LureType::MustBeBlockedIfAble => {
                if can_creature_block(game, blocker_id, attacker_id) {
                    targets.push(attacker_id);
                }
            }
            LureType::None => {}
        }
    }

    // Check explicit must_block_cards on the blocker
    for &attacker_id in &blocker.must_block_cards {
        if combat.is_attacking(attacker_id)
            && can_creature_block(game, blocker_id, attacker_id)
            && !targets.contains(&attacker_id)
        {
            targets.push(attacker_id);
        }
    }

    targets
}

/// Check if blocker can block more creatures than it currently is.
pub fn can_block_more_creatures(
    game: &GameState,
    combat: &CombatState,
    blocker_id: CardId,
) -> bool {
    let currently_blocking = combat
        .blockers
        .iter()
        .filter(|(b, _)| *b == blocker_id)
        .count();
    if currently_blocking == 0 {
        return true;
    }
    // Check for "can block additional creature" type keywords
    let card = game.card(blocker_id);
    for kw in card
        .keywords
        .iter_strings()
        .chain(card.granted_keywords.iter_strings())
        .chain(card.pump_keywords.iter_strings())
    {
        let lower = kw.to_lowercase();
        if lower.contains("can block any number of creatures") {
            return true;
        }
        if lower.contains("can block an additional creature") && currently_blocking < 2 {
            return true;
        }
    }
    false
}

/// Get the minimum number of blockers required to block an attacker.
pub fn get_min_num_blockers_for_attacker(game: &GameState, attacker_id: CardId) -> usize {
    let card = game.card(attacker_id);
    if card.has_menace() {
        2
    } else {
        1
    }
}

/// Check if a creature can be blocked with a given number of blockers.
pub fn can_attacker_be_blocked_with_amount(
    game: &GameState,
    attacker_id: CardId,
    amount: usize,
) -> bool {
    amount >= get_min_num_blockers_for_attacker(game, attacker_id)
}

/// Declared-attacker trigger helper.
pub fn check_declared_attacker(game: &mut GameState, attacker_id: CardId, defender: DefenderId) {
    let controlling = defender.controlling_player(game);
    game.card_mut(attacker_id).set_attacking_player(controlling);
}

/// Get attack constraints for a combat.
pub fn get_all_requirements(
    game: &GameState,
    attacking_player: PlayerId,
    possible_defenders: &[DefenderId],
) -> AttackConstraints {
    AttackConstraints::new(game, attacking_player, possible_defenders)
}

/// Check if a creature can attack any legal defender.
pub fn can_attack(game: &GameState, attacker_id: CardId) -> bool {
    let card = game.card(attacker_id);
    let possible_defenders = get_possible_defenders(game, card.controller);
    possible_defenders
        .iter()
        .any(|&defender| can_attack_defender(game, attacker_id, defender))
}

/// Check if a creature could attack next turn (ignores tap/summoning sickness).
pub fn can_attack_next_turn(game: &GameState, attacker_id: CardId, defender: DefenderId) -> bool {
    let card = game.card(attacker_id);

    // Skip tap/summoning sickness checks for next-turn evaluation
    if !card.is_creature() || card.phased_out {
        return false;
    }
    if card.cant_attack_static || card.detained {
        return false;
    }
    if let DefenderId::Player(pid) = defender {
        if !crate::staticability::static_ability_can_attack_defender::can_attack_defender(
            &game.cards,
            card,
            pid,
        ) {
            return false;
        }
    }
    true
}

/// Check if a creature could attack but is not currently attacking.
pub fn could_attack_but_not_attacking(
    game: &GameState,
    combat: &CombatState,
    attacker_id: CardId,
) -> bool {
    if combat.is_attacking(attacker_id) {
        return false;
    }
    can_attack(game, attacker_id)
}

/// Check propaganda-style effects that require paying a cost to attack.
pub fn check_propaganda_effects(
    game: &GameState,
    attacker_id: CardId,
    defender: DefenderId,
) -> bool {
    let attacker = game.card(attacker_id);
    let cost = super::attack_cost::get_attack_cost(&game.cards, attacker, defender);
    cost == 0
}

/// Pay required block costs for a blocker.
pub fn pay_required_block_costs(game: &GameState, blocker_id: CardId, attacker_id: CardId) -> bool {
    let blocker = game.card(blocker_id);
    let attacker = game.card(attacker_id);
    let cost = super::block_cost::get_block_cost(&game.cards, blocker, attacker);
    cost == 0
}

/// Check if a creature can block (basic check: untapped creature).
pub fn can_block(game: &GameState, blocker_id: CardId) -> bool {
    let blocker = game.card(blocker_id);

    if !blocker.is_creature() || blocker.phased_out {
        return false;
    }

    if blocker.tapped
        && !static_ability_cant_attack_block::can_block_tapped(game, &game.cards, blocker)
    {
        return false;
    }

    if blocker.has_keyword("CARDNAME can't block.")
        || blocker.has_keyword("CARDNAME can't attack or block.")
    {
        return false;
    }

    if static_ability_cant_attack_block::cant_block(game, &game.cards, blocker) {
        return false;
    }

    blocker.zone == ZoneType::Battlefield
}

/// Check if an attacker can be blocked by the given set of potential blockers.
pub fn can_be_blocked(
    game: &GameState,
    attacker_id: CardId,
    potential_blockers: &[CardId],
) -> bool {
    potential_blockers
        .iter()
        .any(|&blocker_id| can_creature_block(game, blocker_id, attacker_id))
}

/// Check if a blocker can block at least one attacker from a list.
pub fn can_block_at_least_one(game: &GameState, blocker_id: CardId, attackers: &[CardId]) -> bool {
    attackers
        .iter()
        .any(|&attacker_id| can_creature_block(game, blocker_id, attacker_id))
}

/// Find blockers that are not yet assigned to block anything.
pub fn find_free_blockers(
    game: &GameState,
    combat: &CombatState,
    defending_player: PlayerId,
) -> Vec<CardId> {
    let available = get_available_blockers(game, defending_player);
    available
        .into_iter()
        .filter(|&blocker_id| !combat.is_blocking(blocker_id))
        .collect()
}
