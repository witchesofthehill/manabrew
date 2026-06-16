use crate::card::{valid_filter, Card};
use crate::game::GameState;
use crate::ids::PlayerId;
use crate::parsing::compare::compare_expr;
use crate::spellability::SpellAbility;
use crate::staticability::StaticMode;
use forge_foundation::ZoneType;

/// Mirrors Java's `StaticAbilityCantBeCast.cantBeCastAbility`.
///
/// Sets the cast SA on the card, then iterates all cards in static-ability
/// source zones plus the card itself, checking CantBeCast static abilities.
pub fn cant_be_cast_ability(
    cards: &[Card],
    spell: &SpellAbility,
    card: &Card,
    activator: PlayerId,
) -> bool {
    cant_be_cast_ability_in_context(cards, spell, card, activator, None)
}

/// Context-aware variant used by playability/casting code where full game
/// timing checks (e.g. OnlySorcerySpeed) are available.
pub fn cant_be_cast_ability_in_context(
    cards: &[Card],
    spell: &SpellAbility,
    card: &Card,
    activator: PlayerId,
    game: Option<&GameState>,
) -> bool {
    // Java: card.setCastSA(spell);
    // TODO: setCastSA not yet wired — the card should store the current cast SA
    // so that static abilities can inspect it. For now we pass `spell` through
    // to the apply function directly.

    // Java: allp = game.getCardsIn(STATIC_ABILITIES_SOURCE_ZONES); allp.add(card);
    // We iterate cards whose zone is a static-ability source, plus always include
    // the card being cast (it may be in Hand which is not a source zone).
    for source in cards
        .iter()
        .filter(|c| c.zone.is_static_ability_source() || c.id == card.id)
    {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.is_active_for(StaticMode::CantBeCast, source.zone))
        {
            if let Some(g) = game {
                if !st_ab.check_conditions(source, g) {
                    continue;
                }
            }
            if apply_cant_be_cast_ability(st_ab, spell, card, source, activator, game) {
                return true;
            }
        }
    }
    false
}

/// Mirrors Java's `StaticAbilityCantBeCast.applyCantBeCastAbility`.
///
/// Checks: ValidCard, Caster, IgnoreEffectPlayers, OnlySorcerySpeed,
/// Origin, cmcGT, NumLimitEachTurn.
pub fn apply_cant_be_cast_ability(
    st_ab: &crate::staticability::StaticAbility,
    _spell: &SpellAbility,
    card: &Card,
    source: &Card,
    activator: PlayerId,
    game: Option<&GameState>,
) -> bool {
    // ValidCard check
    if !valid_filter::matches_valid_card_selector_opt(st_ab.ir.valid_card.as_ref(), card, source) {
        return false;
    }

    // Caster check
    if !valid_filter::matches_valid_player_selector_opt(
        st_ab.ir.caster.as_ref(),
        activator,
        source.controller,
    ) {
        return false;
    }

    // IgnoreEffectPlayers — Java: stAb.getIgnoreEffectPlayers().contains(activator)
    if st_ab.ignore_effect_players.contains(&activator) {
        return false;
    }

    // OnlySorcerySpeed — if the activator can cast at sorcery speed, this
    // restriction does not apply.
    if st_ab.ir.sorcery_speed || st_ab.ir.only_sorcery_speed {
        if let Some(g) = game {
            let can_cast_sorcery =
                activator == g.active_player() && g.turn.is_main_phase() && g.stack.is_empty();
            if can_cast_sorcery {
                return false;
            }
        }
    }

    // Origin — the zone the card is being cast from must be in the listed zones.
    if !st_ab.ir.origin_zones.is_empty() {
        // Java uses card.getCastFrom().getZoneType().
        // Rust currently uses the card's current pre-stack zone as cast-from.
        let cast_from = card.zone;
        if !st_ab.ir.origin_zones.contains(&cast_from) {
            return false;
        }
    }

    // cmcGT — card's CMC must be greater than a threshold
    if let Some(cmc_gt) = st_ab.ir.cmc_gt.as_deref() {
        if let Some(g) = game {
            let threshold = if cmc_gt.eq_ignore_ascii_case("Turns") {
                g.turn.turn_number as i32
            } else {
                g.cards_in_zone(ZoneType::Battlefield, activator)
                    .iter()
                    .filter(|&&cid| {
                        let c = g.card(cid);
                        match cmc_gt {
                            "Creature" => c.is_creature(),
                            "Artifact" => c.type_line.is_artifact(),
                            "Enchantment" => c.type_line.is_enchantment(),
                            "Land" => c.is_land(),
                            "Instant" => c.type_line.is_instant(),
                            "Sorcery" => c.type_line.is_sorcery(),
                            "Planeswalker" => c.type_line.is_planeswalker(),
                            _ => c.type_line.has_subtype(cmc_gt),
                        }
                    })
                    .count() as i32
            };
            if card.mana_value() <= threshold {
                return false;
            }
        }
    }

    // NumLimitEachTurn — limits how many matching spells can be cast per turn
    if let Some(limit) = st_ab.ir.num_limit_each_turn {
        if let Some(g) = game {
            let valid = st_ab.ir.valid_card.as_ref();
            let count = g
                .player(activator)
                .cards_cast_this_turn
                .iter()
                .filter(|&&cid| {
                    valid_filter::matches_valid_card_selector_opt(valid, g.card(cid), source)
                })
                .count() as i32;
            if count < limit {
                return false;
            }
        }
    }

    true
}

/// Mirrors Java's `StaticAbilityCantBeCast.cantBeActivatedAbility`.
///
/// If the spell is a trigger, it cannot be blocked by CantBeActivated.
/// Then iterates all cards in static-ability source zones.
pub fn cant_be_activated_ability(
    game: &GameState,
    cards: &[Card],
    spell: &SpellAbility,
    card: &Card,
    activator: PlayerId,
) -> bool {
    // Java: if (spell.isTrigger()) return false;
    if spell.is_trigger {
        return false;
    }

    for source in cards.iter().filter(|c| c.zone.is_static_ability_source()) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.is_active_for(StaticMode::CantBeActivated, source.zone))
        {
            if !st_ab.check_conditions(source, game) {
                continue;
            }
            if apply_cant_be_activated_ability(st_ab, spell, card, source, activator) {
                return true;
            }
        }
    }
    false
}

/// Mirrors Java's `StaticAbilityCantBeCast.applyCantBeActivatedAbility`.
///
/// Checks: ValidCard, IgnoreEffectCards, ValidSA, AffectedZone, Activator.
pub fn apply_cant_be_activated_ability(
    st_ab: &crate::staticability::StaticAbility,
    spell: &SpellAbility,
    card: &Card,
    source: &Card,
    activator: PlayerId,
) -> bool {
    // ValidCard check
    if !valid_filter::matches_valid_card_selector_opt(st_ab.ir.valid_card.as_ref(), card, source) {
        return false;
    }

    // IgnoreEffectCards — Java: stAb.getIgnoreEffectCards().contains(card)
    if st_ab.ignore_effect_cards.contains(&card.id) {
        return false;
    }

    // ValidSA — check the spell ability itself against a filter
    if let Some(valid_sa) = st_ab.ir.valid_sa.as_deref() {
        if !matches_valid_sa(valid_sa, spell) {
            return false;
        }
    }

    // AffectedZone — the card must be in the specified zone
    if let Some(zone) = st_ab.ir.affected_zone {
        if card.zone != zone {
            return false;
        }
    }

    // Activator check
    if !valid_filter::matches_valid_player_selector_opt(
        st_ab.ir.activator.as_ref(),
        activator,
        source.controller,
    ) {
        return false;
    }

    true
}

/// Mirrors Java's `StaticAbilityCantBeCast.cantPlayLandAbility`.
///
/// Iterates all cards in static-ability source zones checking CantPlayLand.
pub fn cant_play_land_ability(cards: &[Card], card: &Card, player: PlayerId) -> bool {
    for source in cards.iter().filter(|c| c.zone.is_static_ability_source()) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.is_active_for(StaticMode::CantPlayLand, source.zone))
        {
            if apply_cant_play_land_ability(st_ab, card, source, player) {
                return true;
            }
        }
    }
    false
}

/// Mirrors Java's `StaticAbilityCantBeCast.applyCantPlayLandAbility`.
///
/// Checks: ValidCard, Origin, Player, IgnoreEffectPlayers.
pub fn apply_cant_play_land_ability(
    st_ab: &crate::staticability::StaticAbility,
    card: &Card,
    source: &Card,
    player: PlayerId,
) -> bool {
    // ValidCard check
    if !valid_filter::matches_valid_card_selector_opt(st_ab.ir.valid_card.as_ref(), card, source) {
        return false;
    }

    // Origin — the zone the land is being played from
    if !st_ab.ir.origin_zones.is_empty() {
        // Java: card.getLastKnownZone().getZoneType()
        // In Rust we use card.zone as the best proxy for last-known zone.
        if !st_ab.ir.origin_zones.contains(&card.zone) {
            return false;
        }
    }

    // Player check
    if !valid_filter::matches_valid_player_selector_opt(
        st_ab.ir.player.as_ref(),
        player,
        source.controller,
    ) {
        return false;
    }

    // IgnoreEffectPlayers — Java: stAb.getIgnoreEffectPlayers().contains(player)
    if st_ab.ignore_effect_players.contains(&player) {
        return false;
    }

    true
}

// ── Helpers ──────────────────────────────────────────────────────────

/// Simple ValidSA matching for CantBeActivated.
/// Mirrors the pattern used in trigger.rs `matches_valid_sa`.
fn matches_valid_sa(filter: &str, sa: &SpellAbility) -> bool {
    let f = filter.trim();
    if f.is_empty() {
        return true;
    }
    if f.eq_ignore_ascii_case("Spell") {
        return sa.is_spell;
    }
    if f.eq_ignore_ascii_case("Ability") {
        return !sa.is_spell;
    }
    if f.eq_ignore_ascii_case("ManaAbility") {
        return sa.api == Some(crate::ability::api_type::ApiType::Mana);
    }
    if f.eq_ignore_ascii_case("NonManaAbility") {
        return sa.api != Some(crate::ability::api_type::ApiType::Mana);
    }
    if let Some(cond) = f.strip_prefix("ActivationCount$") {
        // Java uses richer activation history. For parity-safe support, map to
        // trigger_remembered_amount when provided by the caller.
        return compare_expr(sa.trigger_remembered_amount, cond.trim());
    }
    // TODO: extend with more SA filter types as needed
    true
}
