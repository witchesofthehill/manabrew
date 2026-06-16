use forge_foundation::ZoneType;

use crate::card::{valid_filter, Card};
use crate::game::GameState;
use crate::ids::PlayerId;
use crate::staticability::StaticAbility;
use crate::staticability::StaticMode;

fn next_player_in_direction(game: &GameState, from: PlayerId, direction: &str) -> PlayerId {
    let alive: Vec<PlayerId> = game
        .player_order
        .iter()
        .copied()
        .filter(|&pid| game.player(pid).is_alive())
        .collect();
    if alive.is_empty() {
        return from;
    }
    let Some(idx) = alive.iter().position(|&pid| pid == from) else {
        return alive[0];
    };
    let len = alive.len();
    let is_left = direction.eq_ignore_ascii_case("Left");
    let next_idx = if is_left {
        (idx + 1) % len
    } else {
        (idx + len - 1) % len
    };
    alive[next_idx]
}

fn nearest_opponent_in_direction(
    game: &GameState,
    controller: PlayerId,
    direction: &str,
) -> Option<PlayerId> {
    let alive_count = game
        .player_order
        .iter()
        .filter(|&&pid| game.player(pid).is_alive())
        .count();
    if alive_count <= 1 {
        return None;
    }
    let mut next = controller;
    for _ in 0..alive_count {
        next = next_player_in_direction(game, next, direction);
        if next != controller {
            return Some(next);
        }
    }
    None
}

// ── cantAttack ──────────────────────────────────────────────────────────────

/// Check if a creature can't attack.
/// Mirrors Java's `StaticAbilityCantAttackBlock.cantAttack()`.
pub fn cant_attack(game: &GameState, cards: &[Card], attacker: &Card, defender: PlayerId) -> bool {
    // Keywords — replace with static ability if able
    if attacker.has_keyword("CARDNAME can't attack.")
        || attacker.has_keyword("CARDNAME can't attack or block.")
    {
        return true;
    }

    // Detained check
    if attacker.detained {
        return true;
    }

    for source in cards.iter().filter(|c| c.zone.is_static_ability_source()) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_conditions_full(&StaticMode::CantAttack, source, game))
        {
            if apply_cant_attack_ability(game, st_ab, attacker, source, defender, cards) {
                return true;
            }
        }
    }
    false
}

/// Mirrors Java's `StaticAbilityCantAttackBlock.applyCantAttackAbility()`.
pub fn apply_cant_attack_ability(
    game: &GameState,
    st_ab: &StaticAbility,
    card: &Card,
    source: &Card,
    defender: PlayerId,
    cards: &[Card],
) -> bool {
    if !valid_filter::matches_valid_card_selector_opt_in_game(
        st_ab.ir.valid_card.as_ref(),
        card,
        source,
        game,
    ) {
        return false;
    }

    // IgnoreEffectCards — if this card is in the ignore list, skip.
    if st_ab.ignore_effect_cards.contains(&card.id) {
        return false;
    }

    // Target (the defender entity) validation
    // In Java, `Target` is validated against the GameEntity (defender).
    // We use player validation since defender is a PlayerId in our model.
    if !valid_filter::matches_valid_player_opt(
        st_ab.ir.target_text.as_deref(),
        defender,
        source.controller,
    ) {
        return false;
    }

    // Check for "can attack as if didn't have Defender" static.
    // In Java: if (stAb.isKeyword(Keyword.DEFENDER) && canAttackDefender(card, target))
    if st_ab
        .ir
        .kw_text
        .as_deref()
        .is_some_and(|v| v.eq_ignore_ascii_case("Defender"))
        && can_attack_defender(game, cards, card, defender)
    {
        return false;
    }

    if st_ab.ir.defender_not_nearest_to_you_in_chosen_direction {
        // Mirrors Java: if no chosen direction exists, this restriction does not apply.
        let Some(direction) = source.svars.get("ChosenDirection") else {
            return false;
        };
        if nearest_opponent_in_direction(game, card.controller, direction) == Some(defender) {
            return false;
        }
    }

    // UnlessDefender — if the defending player matches the filter, allow the attack.
    if let Some(unless_type) = st_ab.ir.unless_defender_text.as_deref() {
        if valid_filter::matches_valid_player(unless_type, defender, source.controller) {
            return false;
        }
    }

    true
}

// ── canAttackDefender ───────────────────────────────────────────────────────

/// Check if a creature can attack a specific defender despite having Defender keyword.
/// Mirrors Java's `StaticAbilityCantAttackBlock.canAttackDefender()`.
pub fn can_attack_defender(
    game: &GameState,
    cards: &[Card],
    card: &Card,
    defender: PlayerId,
) -> bool {
    for source in cards.iter().filter(|c| c.zone.is_static_ability_source()) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_conditions_full(&StaticMode::CanAttackDefender, source, game))
        {
            if apply_can_attack_defender_ability(game, st_ab, card, source, defender) {
                return true;
            }
        }
    }
    false
}

/// Mirrors Java's `StaticAbilityCantAttackBlock.applyCanAttackDefenderAbility()`.
pub fn apply_can_attack_defender_ability(
    game: &GameState,
    st_ab: &StaticAbility,
    card: &Card,
    source: &Card,
    defender: PlayerId,
) -> bool {
    if !valid_filter::matches_valid_card_selector_opt_in_game(
        st_ab.ir.valid_card.as_ref(),
        card,
        source,
        game,
    ) {
        return false;
    }

    // In Java: matchesValidParam("ValidAttacked", target) — target is the defender entity.
    if !valid_filter::matches_valid_player_selector_opt(
        st_ab.ir.valid_attacked.as_ref(),
        defender,
        source.controller,
    ) {
        return false;
    }

    true
}

// ── cantBlock ───────────────────────────────────────────────────────────────

/// Check if a creature can't block.
/// Mirrors Java's `StaticAbilityCantAttackBlock.cantBlock()`.
pub fn cant_block(game: &GameState, cards: &[Card], blocker: &Card) -> bool {
    // Detained check
    if blocker.detained {
        return true;
    }

    // Java builds a list from STATIC_ABILITIES_SOURCE_ZONES + the blocker itself (for LKI)
    for source in cards
        .iter()
        .filter(|c| c.zone.is_static_ability_source() || c.id == blocker.id)
    {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_conditions_full(&StaticMode::CantBlock, source, game))
        {
            if apply_cant_block_ability(game, st_ab, blocker, source) {
                return true;
            }
        }
    }
    false
}

/// Mirrors Java's `StaticAbilityCantAttackBlock.applyCantBlockAbility()`.
pub fn apply_cant_block_ability(
    game: &GameState,
    st_ab: &StaticAbility,
    blocker: &Card,
    source: &Card,
) -> bool {
    if !valid_filter::matches_valid_card_selector_opt_in_game(
        st_ab.ir.valid_card.as_ref(),
        blocker,
        source,
        game,
    ) {
        return false;
    }

    // IgnoreEffectCards
    if st_ab.ignore_effect_cards.contains(&blocker.id) {
        return false;
    }

    true
}

// ── cantBlockBy ─────────────────────────────────────────────────────────────

/// Check if a specific attacker can't be blocked by a specific blocker.
/// Mirrors Java's `StaticAbilityCantAttackBlock.cantBlockBy()`.
pub fn cant_block_by(
    game: &GameState,
    cards: &[Card],
    attacker: &Card,
    blocker: Option<&Card>,
) -> bool {
    // Java builds list from STATIC_ABILITIES_SOURCE_ZONES + attacker + blocker (for LKI)
    for source in cards.iter().filter(|c| {
        c.zone.is_static_ability_source()
            || c.id == attacker.id
            || blocker.is_some_and(|b| c.id == b.id)
    }) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_conditions_full(&StaticMode::CantBlockBy, source, game))
        {
            if apply_cant_block_by_ability(game, st_ab, attacker, blocker, source, cards) {
                return true;
            }
        }
    }
    false
}

/// Returns true if attacker can't be blocked by blocker.
/// Mirrors Java's `StaticAbilityCantAttackBlock.applyCantBlockByAbility()`.
pub fn apply_cant_block_by_ability(
    game: &GameState,
    st_ab: &StaticAbility,
    attacker: &Card,
    blocker: Option<&Card>,
    source: &Card,
    cards: &[Card],
) -> bool {
    if !valid_filter::matches_valid_card_selector_opt_in_game(
        st_ab.ir.valid_attacker.as_ref(),
        attacker,
        source,
        game,
    ) {
        return false;
    }

    // ValidBlocker — complex logic matching Java's comma-split + withoutReach check
    if let Some(valid_blocker_param) = st_ab.ir.valid_blocker.as_ref() {
        let mut still_block = true;
        for alternative in &valid_blocker_param.alternatives {
            if let Some(b) = blocker {
                let matches_blocker =
                    crate::parsing::CompiledSelector::from_alternatives(vec![alternative.clone()]);
                if valid_filter::matches_valid_card_selector_in_game(
                    &matches_blocker,
                    b,
                    source,
                    game,
                ) {
                    still_block = false;
                    // Dragon Hunter check: if the filter includes "withoutReach"
                    // and canBlockIfReach returns true, re-set still_block.
                    if alternative
                        .parts
                        .iter()
                        .any(|part| part.value.eq_ignore_ascii_case("withoutReach"))
                        && can_block_if_reach(game, cards, attacker, b)
                    {
                        still_block = true;
                    }
                    if !still_block {
                        break;
                    }
                }
            }
        }
        if still_block {
            return false;
        }
    }

    // ValidAttackerRelative — relative to blocker
    if let Some(blocker_card) = blocker {
        if !valid_filter::matches_valid_card_selector_opt_in_game(
            st_ab.ir.valid_attacker_relative.as_ref(),
            attacker,
            blocker_card,
            game,
        ) {
            return false;
        }
    } else if st_ab.ir.has_valid_attacker_relative {
        return false;
    }

    // ValidBlockerRelative — relative to attacker
    if let Some(blocker_card) = blocker {
        if !valid_filter::matches_valid_card_selector_opt_in_game(
            st_ab.ir.valid_blocker_relative.as_ref(),
            blocker_card,
            attacker,
            game,
        ) {
            return false;
        }
    } else if st_ab.ir.has_valid_blocker_relative {
        return false;
    }

    // ValidDefender — checks blocker's controller
    if let Some(blocker_card) = blocker {
        if !valid_filter::matches_valid_player_selector_opt(
            st_ab.ir.valid_defender.as_ref(),
            blocker_card.controller,
            source.controller,
        ) {
            return false;
        }
    } else {
        // blocker is null => doesn't match ValidDefender
        return false;
    }

    // Landwalk check
    if let Some(kw_val) = st_ab.ir.kw_text.as_deref() {
        if kw_val.contains("Landwalk") || kw_val.contains("landwalk") {
            if let Some(blocker_card) = blocker {
                if crate::staticability::static_ability_ignore_landwalk::ignore_land_walk(
                    cards,
                    attacker,
                    blocker_card,
                    kw_val,
                ) {
                    return false;
                }
            }
        }
    }

    true
}

// ── canBlockIfReach ─────────────────────────────────────────────────────────

/// Check if reach allows blocking despite a restriction.
/// Mirrors Java's `StaticAbilityCantAttackBlock.canBlockIfReach()`.
pub fn can_block_if_reach(
    game: &GameState,
    cards: &[Card],
    attacker: &Card,
    blocker: &Card,
) -> bool {
    for source in cards.iter().filter(|c| c.zone.is_static_ability_source()) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_conditions_full(&StaticMode::CanBlockIfReach, source, game))
        {
            if apply_can_block_if_reach_ability(game, st_ab, attacker, blocker, source) {
                return true;
            }
        }
    }
    false
}

/// Mirrors Java's `StaticAbilityCantAttackBlock.applyCanBlockIfReachAbility()`.
pub fn apply_can_block_if_reach_ability(
    game: &GameState,
    st_ab: &StaticAbility,
    attacker: &Card,
    blocker: &Card,
    source: &Card,
) -> bool {
    if !valid_filter::matches_valid_card_selector_opt_in_game(
        st_ab.ir.valid_attacker.as_ref(),
        attacker,
        source,
        game,
    ) {
        return false;
    }
    if !valid_filter::matches_valid_card_selector_opt_in_game(
        st_ab.ir.valid_blocker.as_ref(),
        blocker,
        source,
        game,
    ) {
        return false;
    }
    true
}

// ── canBlockTapped ──────────────────────────────────────────────────────────

/// Check if tapped creatures can block.
/// Mirrors Java's `StaticAbilityCantAttackBlock.canBlockTapped()`.
pub fn can_block_tapped(game: &GameState, cards: &[Card], card: &Card) -> bool {
    for source in cards.iter().filter(|c| c.zone.is_static_ability_source()) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_conditions_full(&StaticMode::BlockTapped, source, game))
        {
            if apply_block_tapped(game, st_ab, card, source) {
                return true;
            }
        }
    }
    false
}

/// Mirrors Java's `StaticAbilityCantAttackBlock.applyBlockTapped()`.
fn apply_block_tapped(game: &GameState, st_ab: &StaticAbility, card: &Card, source: &Card) -> bool {
    if !valid_filter::matches_valid_card_selector_opt_in_game(
        st_ab.ir.valid_card.as_ref(),
        card,
        source,
        game,
    ) {
        return false;
    }
    true
}

// ── canAttackHaste ──────────────────────────────────────────────────────────

/// Check if a creature can attack despite summoning sickness (as if it had haste).
/// Mirrors Java's `StaticAbilityCantAttackBlock.canAttackHaste()`.
pub fn can_attack_haste(
    game: &GameState,
    cards: &[Card],
    attacker: &Card,
    _defender: PlayerId,
) -> bool {
    // If the creature is not summoning sick, it can always attack (no need to check statics)
    if !attacker.summoning_sick {
        return true;
    }

    for source in cards.iter().filter(|c| c.zone.is_static_ability_source()) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_conditions_full(&StaticMode::CanAttackIfHaste, source, game))
        {
            if apply_can_attack_haste_ability(game, st_ab, attacker, _defender, source) {
                return true;
            }
        }
    }
    false
}

/// Mirrors Java's `StaticAbilityCantAttackBlock.applyCanAttackHasteAbility()`.
pub fn apply_can_attack_haste_ability(
    game: &GameState,
    st_ab: &StaticAbility,
    card: &Card,
    defender: PlayerId,
    source: &Card,
) -> bool {
    if !valid_filter::matches_valid_card_selector_opt_in_game(
        st_ab.ir.valid_card.as_ref(),
        card,
        source,
        game,
    ) {
        return false;
    }

    // ValidTarget — in Java this validates the target entity (defender).
    if !valid_filter::matches_valid_player_selector_opt(
        st_ab.ir.valid_target.as_ref(),
        defender,
        source.controller,
    ) {
        return false;
    }

    true
}

// ── getMinMaxBlocker ────────────────────────────────────────────────────────

/// Get the minimum and maximum number of creatures that must/can block an attacker.
/// Returns (min, max). Mirrors Java's `StaticAbilityCantAttackBlock.getMinMaxBlocker()`.
pub fn get_min_max_blocker(
    game: &GameState,
    cards: &[Card],
    attacker: &Card,
    _defender: PlayerId,
) -> (i32, i32) {
    let mut min: i32 = 1;
    let mut max: i32 = i32::MAX;

    // Menace baseline: requires at least 2 blockers
    if attacker.has_menace() {
        min = 2;
    }

    for source in cards.iter().filter(|c| c.zone.is_static_ability_source()) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_conditions_full(&StaticMode::MinMaxBlocker, source, game))
        {
            apply_min_max_blocker_ability(
                game, st_ab, attacker, source, _defender, cards, &mut min, &mut max,
            );
        }
    }

    (min, max)
}

/// Mirrors Java's `StaticAbilityCantAttackBlock.applyMinMaxBlockerAbility()`.
pub fn apply_min_max_blocker_ability(
    game: &GameState,
    st_ab: &StaticAbility,
    attacker: &Card,
    source: &Card,
    defender: PlayerId,
    cards: &[Card],
    min: &mut i32,
    max: &mut i32,
) {
    if !valid_filter::matches_valid_card_selector_opt_in_game(
        st_ab.ir.valid_card.as_ref(),
        attacker,
        source,
        game,
    ) {
        return;
    }

    if let Some(min_val) = st_ab.ir.min_text.as_deref() {
        if min_val == "All" {
            // In Java: defender.getCreaturesInPlay().size()
            // Count creatures controlled by the defending player
            let creature_count = cards
                .iter()
                .filter(|c| {
                    c.controller == defender && c.zone == ZoneType::Battlefield && c.is_creature()
                })
                .count() as i32;
            *min = creature_count;
        } else if let Some(val) = resolve_amount_expr(None, source, min_val) {
            *min = val;
        }
    }

    if let Some(max_val) = st_ab.ir.max_text.as_deref() {
        if let Some(val) = resolve_amount_expr(None, source, max_val) {
            *max = val;
        }
    }
}

// ── attackVigilance ─────────────────────────────────────────────────────────

/// Check if attacker has vigilance from a static ability (doesn't tap when attacking).
/// Mirrors Java's `StaticAbilityCantAttackBlock.attackVigilance()`.
pub fn attack_vigilance(game: &GameState, cards: &[Card], card: &Card) -> bool {
    for source in cards.iter().filter(|c| c.zone.is_static_ability_source()) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_conditions_full(&StaticMode::AttackVigilance, source, game))
        {
            if apply_attack_vigilance_ability(game, st_ab, card, source) {
                return true;
            }
        }
    }
    false
}

/// Mirrors Java's `StaticAbilityCantAttackBlock.applyAttackVigilanceAbility()`.
pub fn apply_attack_vigilance_ability(
    game: &GameState,
    st_ab: &StaticAbility,
    card: &Card,
    source: &Card,
) -> bool {
    if !valid_filter::matches_valid_card_selector_opt_in_game(
        st_ab.ir.valid_card.as_ref(),
        card,
        source,
        game,
    ) {
        return false;
    }
    true
}

// ── getAttackCost ───────────────────────────────────────────────────────────

/// Get the cost required to attack with a creature.
/// Returns the cost string if applicable, or None.
/// Mirrors Java's `StaticAbilityCantAttackBlock.getAttackCost()`.
pub fn get_attack_cost(
    st_ab: &StaticAbility,
    attacker: &Card,
    target: PlayerId,
    source: &Card,
) -> Option<String> {
    if !valid_filter::matches_valid_card_selector_opt(
        st_ab.ir.valid_card.as_ref(),
        attacker,
        source,
    ) {
        return None;
    }

    if !valid_filter::matches_valid_player_opt(
        st_ab.ir.target_text.as_deref(),
        target,
        source.controller,
    ) {
        return None;
    }

    let mut cost_string = st_ab.ir.cost.clone()?;
    if let Some(svar_expr) = source.svars.get(&cost_string) {
        let add_x = cost_string.starts_with('X');
        let amount = crate::svar::evaluate_svar(
            svar_expr,
            &crate::spellability::SpellAbility::new_empty(Some(source.id), source.controller),
        );
        cost_string = amount.to_string();
        if add_x {
            cost_string.push_str(" X");
        }
    }

    if st_ab.ir.trigger {
        // TODO: cost.getCostParts().get(0).setTrigger(stAb.getPayingTrigSA())
        // Trigger-based cost parts not yet modelled.
    }

    Some(cost_string)
}

// ── getBlockCost ────────────────────────────────────────────────────────────

/// Get the cost required to block with a creature.
/// Returns the cost string if applicable, or None.
/// Mirrors Java's `StaticAbilityCantAttackBlock.getBlockCost()`.
pub fn get_block_cost(
    st_ab: &StaticAbility,
    blocker: &Card,
    attacker_player: PlayerId,
    source: &Card,
) -> Option<String> {
    if !valid_filter::matches_valid_card_selector_opt(st_ab.ir.valid_card.as_ref(), blocker, source)
    {
        return None;
    }

    // Attacker validation — in Java this is matchesValidParam("Attacker", attacker)
    // where attacker is a GameEntity. We validate as a player for now.
    if !valid_filter::matches_valid_player_opt(
        st_ab.ir.attacker_text.as_deref(),
        attacker_player,
        source.controller,
    ) {
        return None;
    }

    let mut cost_string = st_ab.ir.cost.clone()?;
    if let Some(svar_expr) = source.svars.get(&cost_string) {
        let add_x = cost_string.starts_with('X');
        let amount = crate::svar::evaluate_svar(
            svar_expr,
            &crate::spellability::SpellAbility::new_empty(Some(source.id), source.controller),
        );
        cost_string = amount.to_string();
        if add_x {
            cost_string.push_str(" X");
        }
    }

    Some(cost_string)
}

fn resolve_amount_expr(game: Option<&GameState>, source: &Card, expr: &str) -> Option<i32> {
    if let Ok(v) = expr.parse::<i32>() {
        return Some(v);
    }
    let svar_expr = source.svars.get(expr)?;
    if let Some(g) = game {
        if svar_expr.starts_with("Count$") {
            return Some(crate::svar::resolve_count_svar(
                svar_expr,
                g,
                source.id,
                source.controller,
            ));
        }
    }
    Some(crate::svar::evaluate_svar(
        svar_expr,
        &crate::spellability::SpellAbility::new_empty(Some(source.id), source.controller),
    ))
}
