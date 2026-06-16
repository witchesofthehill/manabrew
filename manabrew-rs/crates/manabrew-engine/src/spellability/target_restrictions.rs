//! Target restrictions for spell abilities.
//!
//! Mirrors Java's `spellability/TargetRestrictions.java` — defines what kinds
//! of targets a spell can select, checks for valid candidates, and retrieves
//! all valid target candidates.

use forge_foundation::{CoreType, ZoneType};
use serde::{Deserialize, Serialize};

use crate::card::{card_property, valid_filter};
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::parsing::{cached_compiled_selector, keys, CompiledSelector, Params, ParsedParams};
use crate::spellability::SpellAbility;

/// What kinds of targets a spell can select.
/// Mirrors Java's `TargetRestrictions.getValidTgts()` parsed target types.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TargetKind {
    /// Player only (e.g. "ValidTgts$ Player")
    Player,
    /// Any player or creature (e.g. "ValidTgts$ Any")
    Any,
    /// Creature with optional filter (e.g. "ValidTgts$ Creature.nonBlack")
    Creature(Option<String>),
    /// Any permanent on the battlefield with optional filter
    /// (e.g. "ValidTgts$ Permanent.nonLand+OppCtrl")
    Permanent(Option<String>),
    /// Card in a specific zone with optional filter (e.g. Raise Dead from graveyard)
    CardInZone {
        zone: ZoneType,
        filter: Option<String>,
    },
    /// Spell on the stack (for Counter effects, e.g. "ValidTgts$ Spell")
    Spell,
    /// No targets
    None,
}

/// Targeting restrictions for a spell ability.
/// Mirrors Java's `TargetRestrictions` — defines valid targets, min/max counts,
/// and which zones to search for targets.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TargetRestrictions {
    /// Raw valid target strings (e.g. ["Creature.OppCtrl"])
    pub valid_tgts: Vec<String>,
    /// Compiled ValidTgts selector used for card target filtering.
    #[serde(default)]
    pub valid_tgts_selector: CompiledSelector,
    /// Parsed target kind
    pub target_kind: TargetKind,
    /// Additional target type filter (e.g. "Spell" from TargetType$ parameter)
    pub target_type_filter: Option<String>,
    /// Minimum number of targets expression (default "1").
    /// Mirrors Java storing raw `TargetMin` and resolving dynamically.
    pub min_targets: String,
    /// Maximum number of targets expression (default "1").
    /// Mirrors Java storing raw `TargetMax` and resolving dynamically.
    pub max_targets: String,
    /// Zones to search for targets (default [Battlefield])
    pub tgt_zone: Vec<ZoneType>,
}

impl TargetRestrictions {
    pub fn new_from_parsed(parsed: &ParsedParams<'_>, params: &Params) -> Option<Self> {
        let valid_tgts_str = parsed.get(keys::VALID_TGTS)?;
        let valid_tgts: Vec<String> = valid_tgts_str
            .split(',')
            .map(|s| s.trim().to_string())
            .collect();
        // `TgtZone$` overrides the target-search zone (Java
        // `TargetRestrictions.setupTargeting` line 152). Falls back to
        // `Origin$` (the move-from zone used by most ChangeZone effects),
        // and finally to Battlefield as the implicit default.
        let target_zone = parsed_zone_type(parsed.get(keys::TGT_ZONE));
        let origin_zone = parsed_zone_type(parsed.get(keys::ORIGIN));
        let effective_zone = target_zone.or(origin_zone);
        let enhanced_input = if effective_zone.is_some_and(|z| z != ZoneType::Battlefield) {
            valid_tgts_str
        } else {
            &valid_tgts[0]
        };
        let mut target_kind = parse_target_kind_enhanced(enhanced_input, effective_zone);
        // Multi-clause `ValidTgts$` (e.g. `Creature.YouCtrl,Artifact.YouCtrl`)
        // collapses to a single TargetKind. The first-clause-only parse drops
        // the other clauses' candidates. Promote to `Any` so the per-clause
        // valid_tgts filter is applied against the full battlefield.
        if effective_zone.is_none_or(|z| z == ZoneType::Battlefield) && valid_tgts.len() > 1 {
            target_kind = TargetKind::Any;
        }
        let min_targets = parsed.get(keys::TARGET_MIN).unwrap_or("1").to_string();
        let max_targets = parsed.get(keys::TARGET_MAX).unwrap_or("1").to_string();
        let target_type_filter = parsed.get(keys::TARGET_TYPE).map(str::to_string);

        // Any TargetType$ value targets the stack (the script convention is
        // exclusively SA-kind tokens like Spell, Activated, Triggered, …).
        // Route these through the stack-entry filtering path instead of the
        // battlefield-permanent path.
        if target_type_filter.is_some() {
            target_kind = TargetKind::Spell;
        }

        Some(TargetRestrictions {
            valid_tgts,
            valid_tgts_selector: params
                .selector_untracked(keys::VALID_TGTS)
                .cloned()
                .unwrap_or_else(|| cached_compiled_selector(valid_tgts_str)),
            target_kind,
            target_type_filter,
            min_targets,
            max_targets,
            tgt_zone: effective_zone
                .map(|zone| vec![zone])
                .unwrap_or_else(|| vec![ZoneType::Battlefield]),
        })
    }

    /// Construct from parsed pipe params. Returns `None` if no `ValidTgts$`
    /// parameter exists (mirrors Java: null targetRestrictions means no targeting).
    pub fn new(params: &Params) -> Option<Self> {
        let valid_tgts_str = params.selector_value(keys::VALID_TGTS)?;
        let valid_tgts: Vec<String> = valid_tgts_str
            .split(',')
            .map(|s| s.trim().to_string())
            .collect();
        // `TgtZone$` overrides the target-search zone (Java
        // `TargetRestrictions.setupTargeting` line 152). Falls back to
        // `Origin$` (the move-from zone used by most ChangeZone effects),
        // and finally to Battlefield as the implicit default.
        let target_zone = params.zone_type(keys::TGT_ZONE);
        let origin_zone = params.zone_type(keys::ORIGIN);
        let effective_zone = target_zone.or(origin_zone);
        // For CardInZone targeting (non-battlefield zone), pass the full
        // ValidTgts string so comma-separated types (e.g. "Creature,Land")
        // are all included in the filter. For battlefield targeting, use
        // only the first token (legacy parser handles single types).
        let enhanced_input = if effective_zone.is_some_and(|z| z != ZoneType::Battlefield) {
            valid_tgts_str
        } else {
            &valid_tgts[0]
        };
        let mut target_kind = parse_target_kind_enhanced(enhanced_input, effective_zone);
        // Multi-clause `ValidTgts$` (e.g. `Creature.YouCtrl,Artifact.YouCtrl`)
        // collapses to a single TargetKind. The first-clause-only parse drops
        // the other clauses' candidates. Promote to `Any` so the per-clause
        // valid_tgts filter is applied against the full battlefield.
        if effective_zone.is_none_or(|z| z == ZoneType::Battlefield) && valid_tgts.len() > 1 {
            target_kind = TargetKind::Any;
        }
        let min_targets = params
            .get_cloned(keys::TARGET_MIN)
            .unwrap_or_else(|| "1".to_string());
        let max_targets = params
            .get_cloned(keys::TARGET_MAX)
            .unwrap_or_else(|| "1".to_string());

        // Parse TargetType$ parameter if present (used by counterspells)
        let target_type_filter = params.get_cloned(keys::TARGET_TYPE);

        // If TargetType$ Spell* is specified, override to Spell targeting.
        // This handles cases like Counterspell ("Spell") and Imp's Mischief
        // ("Spell.singleTarget").
        // Any TargetType$ value targets the stack (the script convention is
        // exclusively SA-kind tokens like Spell, Activated, Triggered, …).
        // Route these through the stack-entry filtering path instead of the
        // battlefield-permanent path.
        if target_type_filter.is_some() {
            target_kind = TargetKind::Spell;
        }

        Some(TargetRestrictions {
            valid_tgts,
            valid_tgts_selector: params
                .selector(keys::VALID_TGTS)
                .cloned()
                .unwrap_or_else(|| cached_compiled_selector(valid_tgts_str)),
            target_kind,
            target_type_filter,
            min_targets,
            max_targets,
            tgt_zone: effective_zone
                .map(|zone| vec![zone])
                .unwrap_or_else(|| vec![ZoneType::Battlefield]),
        })
    }

    /// Check if there is at least one valid target candidate.
    /// Accounts for Hexproof, Shroud, and Protection when `source_card` is provided.
    /// Mirrors Java's `TargetRestrictions.hasCandidates()`.
    pub fn has_candidates(
        &self,
        game: &GameState,
        player: PlayerId,
        source_card: Option<CardId>,
    ) -> bool {
        let _perf_scope =
            crate::perf::ParamsLookupScopeGuard::enter(crate::perf::ParamsLookupScope::Target);
        match &self.target_kind {
            TargetKind::None => true,
            // "target player" = any alive player (including the caster themselves).
            TargetKind::Player => !game.alive_players().is_empty(),
            // "any target" fallback: derive player/card candidates from ValidTgts.
            TargetKind::Any => {
                if any_target_allows_players(&self.valid_tgts) && !game.alive_players().is_empty() {
                    return true;
                }
                get_all_candidates_any_filtered_for_restrictions(game, self, player, source_card)
                    .into_iter()
                    .any(|cid| can_be_targeted_by(game, cid, player, source_card))
            }
            TargetKind::Creature(ref filter) => {
                get_all_candidates_creature_filtered_for_restrictions(
                    game,
                    self,
                    filter.as_deref(),
                    player,
                    source_card,
                )
                .into_iter()
                .filter(|&cid| !is_other_filter_self_hit(filter.as_deref(), source_card, cid))
                .any(|cid| can_be_targeted_by(game, cid, player, source_card))
            }
            TargetKind::Permanent(ref filter) => {
                get_all_battlefield_permanents_filtered_for_restrictions(
                    game,
                    self,
                    filter.as_deref(),
                    player,
                    source_card,
                )
                .into_iter()
                .filter(|&cid| !is_other_filter_self_hit(filter.as_deref(), source_card, cid))
                .any(|cid| can_be_targeted_by(game, cid, player, source_card))
            }
            TargetKind::CardInZone { zone, filter } => !get_valid_cards_in_zone_for_restrictions(
                game,
                self,
                *zone,
                player,
                filter.as_deref(),
                source_card,
            )
            .is_empty(),
            TargetKind::Spell => {
                !filter_spells_for_target_restrictions(game, &get_all_candidates_spells(game), self)
                    .is_empty()
            }
        }
    }

    /// Resolve Java-style `TargetMin` expression for this SA.
    pub fn get_min_targets(&self, game: &GameState, sa: &SpellAbility) -> i32 {
        resolve_target_count_expr(&self.min_targets, game, sa)
    }

    /// Resolve Java-style `TargetMax` expression for this SA.
    pub fn get_max_targets(&self, game: &GameState, sa: &SpellAbility) -> i32 {
        resolve_target_count_expr(&self.max_targets, game, sa)
    }

    /// Whether targeting is restricted to opponents only.
    /// Mirrors Java's `TargetRestrictions.canOnlyTgtOpponent()`.
    pub fn can_only_tgt_opponent(&self) -> bool {
        self.valid_tgts
            .iter()
            .all(|v| v.eq_ignore_ascii_case("Opponent"))
    }

    /// Whether this can target a player.
    /// Mirrors Java's `TargetRestrictions.canTgtPlayer()`.
    pub fn can_tgt_player(&self) -> bool {
        matches!(self.target_kind, TargetKind::Player | TargetKind::Any)
    }

    /// Whether this can target a permanent.
    /// Mirrors Java's `TargetRestrictions.canTgtPermanent()`.
    pub fn can_tgt_permanent(&self) -> bool {
        matches!(
            self.target_kind,
            TargetKind::Permanent(_) | TargetKind::Creature(_) | TargetKind::Any
        )
    }

    /// Whether this can target a creature.
    /// Mirrors Java's `TargetRestrictions.canTgtCreature()`.
    pub fn can_tgt_creature(&self) -> bool {
        matches!(self.target_kind, TargetKind::Creature(_) | TargetKind::Any)
    }

    /// Whether this can target a planeswalker.
    /// Mirrors Java's `TargetRestrictions.canTgtPlaneswalker()`.
    pub fn can_tgt_planeswalker(&self) -> bool {
        matches!(self.target_kind, TargetKind::Permanent(_) | TargetKind::Any)
    }

    /// Whether this can target both a creature and a player.
    /// Mirrors Java's `TargetRestrictions.canTgtCreatureAndPlayer()`.
    pub fn can_tgt_creature_and_player(&self) -> bool {
        matches!(self.target_kind, TargetKind::Any)
    }

    /// Clone this target restriction.
    /// Mirrors Java's `TargetRestrictions.copy()`.
    pub fn copy(&self) -> Self {
        self.clone()
    }

    /// Apply text changes to the target restriction strings.
    /// Mirrors Java's `TargetRestrictions.applyTargetTextChanges(Map)`.
    pub fn apply_target_text_changes(&mut self, changes: &[(&str, &str)]) {
        for tgt in &mut self.valid_tgts {
            for &(old, new) in changes {
                if tgt.contains(old) {
                    *tgt = tgt.replace(old, new);
                }
            }
        }
        // Re-parse target kind from updated valid_tgts
        if let Some(first) = self.valid_tgts.first() {
            self.target_kind = parse_target_kind_legacy(first);
        }
        self.valid_tgts_selector = cached_compiled_selector(&self.valid_tgts.join(","));
    }
}

fn parsed_zone_type(value: Option<&str>) -> Option<ZoneType> {
    let value = value?.trim();
    if value.eq_ignore_ascii_case("Deck") {
        Some(ZoneType::Library)
    } else {
        ZoneType::from_str_compat(value)
    }
}

impl TargetRestrictions {
    fn compiled_valid_tgts(&self) -> CompiledSelector {
        if self.valid_tgts_selector.alternatives.is_empty() {
            cached_compiled_selector(&self.valid_tgts.join(","))
        } else {
            self.valid_tgts_selector.clone()
        }
    }
}

fn has_other_qualifier(filter: &str) -> bool {
    filter.split(['.', '+']).any(|part| {
        part.eq_ignore_ascii_case("Other") || part.eq_ignore_ascii_case("StrictlyOther")
    })
}

fn is_other_filter_self_hit(
    filter: Option<&str>,
    source_card: Option<CardId>,
    candidate: CardId,
) -> bool {
    match (filter, source_card) {
        (Some(f), Some(src)) if src == candidate => has_other_qualifier(f),
        _ => false,
    }
}

/// Remove `Other`/`StrictlyOther` self-targets from candidate lists.
/// Mirrors Java `Other` semantics in valid target filters.
pub fn apply_other_source_filter(
    candidates: Vec<CardId>,
    filter: Option<&str>,
    source_card: Option<CardId>,
) -> Vec<CardId> {
    candidates
        .into_iter()
        .filter(|&cid| !is_other_filter_self_hit(filter, source_card, cid))
        .collect()
}

/// Resolve a target-count expression like `1`, `X`, or `Count$...`.
/// Mirrors Java `TargetRestrictions.getMinTargets/getMaxTargets` via
/// `AbilityUtils.calculateAmount(...)`.
fn resolve_target_count_expr(expr: &str, game: &GameState, sa: &SpellAbility) -> i32 {
    if let Some(n) = parse_literal_target_count(expr) {
        return n;
    }

    crate::svar::resolve_numeric_value(game, sa, expr, 1)
}

fn parse_literal_target_count(expr: &str) -> Option<i32> {
    if let Ok(n) = expr.trim().parse::<i32>() {
        return Some(n);
    }
    expr.trim().strip_prefix('+')?.parse::<i32>().ok()
}

/// Check if there are valid spells on the stack matching the TargetType$ filter.
pub fn has_valid_spell_with_filter(game: &GameState, filter: &str) -> bool {
    !filter_spells_by_type(game, &get_all_candidates_spells(game), filter).is_empty()
}

/// Filter stack entries using the full `TargetRestrictions` for spell targets.
pub fn filter_spells_for_target_restrictions(
    game: &GameState,
    candidates: &[u32],
    restrictions: &TargetRestrictions,
) -> Vec<u32> {
    let mut filtered = candidates.to_vec();
    if let Some(ref filter) = restrictions.target_type_filter {
        filtered = filter_spells_by_type(game, &filtered, filter);
    }
    if !restrictions.valid_tgts.is_empty()
        && !restrictions
            .valid_tgts
            .iter()
            .all(|clause| clause.eq_ignore_ascii_case("Card"))
    {
        let valid_filter = restrictions.valid_tgts.join(",");
        filtered = filter_spells_by_type(game, &filtered, &valid_filter);
    }
    filtered
}

/// Filter stack entries by a comma-separated TargetType$/ValidTgts$ filter.
/// SA-kind clauses (Spell, Activated, Triggered, …) dispatch through
/// `valid_sa::matches_valid_sa`, mirroring Java's `SpellAbility.isValid`.
/// Per-clause fallback then checks the entry's source-card properties so
/// ValidTgts tokens like `Card` and `OppCtrl` still match.
pub fn filter_spells_by_type(game: &GameState, candidates: &[u32], filter: &str) -> Vec<u32> {
    candidates
        .iter()
        .filter(|&&id| {
            let Some(entry) = game.stack.iter().find(|entry| entry.id == id) else {
                return false;
            };
            stack_entry_matches_filter(game, &entry.spell_ability, filter)
        })
        .copied()
        .collect()
}

fn stack_entry_matches_filter(
    game: &GameState,
    sa: &crate::spellability::SpellAbility,
    filter: &str,
) -> bool {
    if filter.trim().is_empty() {
        return sa.is_spell;
    }
    let Some(source_id) = sa.source else {
        return false;
    };
    let source = game.card(source_id);

    if crate::spellability::matches_valid_sa(filter, sa, source, Some(source)) {
        return true;
    }

    filter
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .any(|clause| {
            // Bare `Card` is the catch-all "any source" clause; `Card.<qual>`
            // still has to match the qualifier on the source card.
            if clause == crate::card::filter_constants::CARD {
                return true;
            }
            card_property::card_has_property(source, clause, sa.activating_player)
        })
}

/// Parse a single ValidTgts value into a TargetKind.
/// Forward-ported from Java for future use when enhanced targeting is needed.
#[allow(dead_code)]
fn parse_target_kind(val: &str) -> TargetKind {
    let val = val.trim();
    if val.eq_ignore_ascii_case("Any") {
        return TargetKind::Any;
    }
    if val.eq_ignore_ascii_case("Player") || val.eq_ignore_ascii_case("Opponent") {
        return TargetKind::Player;
    }
    if val.eq_ignore_ascii_case("Spell") {
        return TargetKind::Spell;
    }
    if val.starts_with("Creature") {
        // Safe: we just checked starts_with, so strip_prefix will succeed
        let filter = val.strip_prefix("Creature").unwrap_or("");
        if filter.is_empty() {
            return TargetKind::Creature(None);
        }
        let filter = filter.strip_prefix('.').unwrap_or(filter);
        return TargetKind::Creature(Some(filter.to_string()));
    }
    if val.starts_with("Permanent") {
        // Safe: we just checked starts_with, so strip_prefix will succeed
        let filter = val.strip_prefix("Permanent").unwrap_or("");
        if filter.is_empty() {
            return TargetKind::Permanent(None);
        }
        let filter = filter.strip_prefix('.').unwrap_or(filter);
        return TargetKind::Permanent(Some(filter.to_string()));
    }
    if val.starts_with("Land") {
        // "Land" targeting is a permanent target restricted to lands.
        // Keep land qualifiers (e.g. "Land.nonBasic") in the filter string.
        let filter = val.strip_prefix("Land").unwrap_or("");
        if filter.is_empty() {
            return TargetKind::Permanent(Some("Land".to_string()));
        }
        let filter = filter.strip_prefix('.').unwrap_or(filter);
        return TargetKind::Permanent(Some(format!("Land.{filter}")));
    }
    // Fallback: treat as "Any" if unrecognized
    TargetKind::Any
}

/// Parse `ValidTgts$` from a raw ability string.
/// Enhanced version that also considers `Origin$` for zone targeting.
/// Convenience wrapper for code that doesn't have parsed params yet.
pub fn parse_valid_targets(ability: &str) -> TargetKind {
    let params = Params::from_raw(ability);
    let origin_zone = params.zone_type(keys::ORIGIN);
    match params.selector_value(keys::VALID_TGTS) {
        Some(val) => parse_target_kind_enhanced(val, origin_zone),
        None => TargetKind::None,
    }
}

/// Check if there is at least one valid target for the given ability string.
/// Convenience wrapper that creates a temporary TargetRestrictions.
pub fn has_candidates(
    game: &GameState,
    player: PlayerId,
    ability: &str,
    source: Option<CardId>,
) -> bool {
    let _perf_scope =
        crate::perf::ParamsLookupScopeGuard::enter(crate::perf::ParamsLookupScope::Target);
    let params = Params::from_raw(ability);
    match TargetRestrictions::new(&params) {
        Some(tr) => tr.has_candidates(game, player, source),
        None => true, // No targeting = always valid
    }
}

/// Check if there is at least one valid target for every ability in the
/// SubAbility$ chain. Mirrors Java's target validation in `setupTargets()`
/// which checks each ability in the chain has at least one legal target.
pub fn has_candidates_in_chain(
    game: &GameState,
    player: PlayerId,
    ability: &str,
    source: Option<CardId>,
) -> bool {
    let _perf_scope =
        crate::perf::ParamsLookupScopeGuard::enter(crate::perf::ParamsLookupScope::Target);
    let params = Params::from_raw(ability);
    if let Some(tr) = TargetRestrictions::new(&params) {
        let min_targets = parse_literal_target_count(&tr.min_targets).unwrap_or_else(|| {
            if let Some(card_id) = source {
                let sa = crate::spellability::build_spell_ability(game, card_id, ability, player);
                tr.get_min_targets(game, &sa)
            } else {
                let sa = SpellAbility::new_simple(None, player, ability);
                tr.get_min_targets(game, &sa)
            }
        });
        if min_targets > 0 && !tr.has_candidates(game, player, source) {
            return false;
        }
    }

    if let Some(sub_svar_name) = params.get(keys::SUB_ABILITY) {
        if let Some(card_id) = source {
            if let Some(sub_text) = game.card(card_id).get_s_var(sub_svar_name) {
                let sub_text = sub_text.to_string();
                return has_candidates_in_chain(game, player, &sub_text, source);
            }
        }
    }

    true
}

/// Check target availability for an already-built spell ability chain.
///
/// This avoids reparsing the raw ability text in hot action-space paths that
/// already have a `SpellAbility` and its precompiled `TargetRestrictions`.
pub fn has_candidates_in_spell_ability_chain(
    game: &GameState,
    player: PlayerId,
    sa: &SpellAbility,
) -> bool {
    let _perf_scope =
        crate::perf::ParamsLookupScopeGuard::enter(crate::perf::ParamsLookupScope::Target);
    let mut current = Some(sa);
    while let Some(node) = current {
        if let Some(tr) = node.target_restrictions.as_ref() {
            let min_targets = tr.get_min_targets(game, node);
            if min_targets > 0 && !tr.has_candidates(game, player, node.source) {
                return false;
            }
        }
        current = node.sub_ability.as_deref();
    }
    true
}

/// Check if a card can be targeted by a spell/ability controlled by `source_controller`.
/// Mirrors Java's `Card.canBeTargetedBy(SpellAbility)` which delegates to
/// `StaticAbilityCantTarget` for Hexproof, Shroud, and Protection checks.
pub fn can_be_targeted_by(
    game: &GameState,
    target_id: CardId,
    source_controller: PlayerId,
    source_card: Option<CardId>,
) -> bool {
    can_be_targeted_by_internal(game, target_id, source_controller, source_card, None)
}

pub fn can_be_targeted_by_sa(
    game: &GameState,
    target_id: CardId,
    source_controller: PlayerId,
    source_sa: &SpellAbility,
) -> bool {
    let _perf_scope =
        crate::perf::ParamsLookupScopeGuard::enter(crate::perf::ParamsLookupScope::Target);
    can_be_targeted_by_internal(
        game,
        target_id,
        source_controller,
        source_sa.source,
        Some(source_sa),
    )
}

fn can_be_targeted_by_internal(
    game: &GameState,
    target_id: CardId,
    source_controller: PlayerId,
    source_card: Option<CardId>,
    source_sa: Option<&SpellAbility>,
) -> bool {
    let target = game.card(target_id);
    let source_card_ref = source_card.map(|id| game.card(id));
    if crate::staticability::static_ability_cant_target::cant_target(
        &game.cards,
        target,
        source_controller,
        source_card_ref,
        source_sa,
    ) {
        return false;
    }
    // Shroud/hexproof/protection are permanent abilities (CR 113.6b) —
    // they only apply while the card is on the battlefield. Cards in
    // graveyard/exile/hand/library don't carry these keyword effects, so
    // target-gating for those zones is purely about the valid-filter
    // (already applied upstream). Skip the battlefield-only checks when
    // the target isn't on the battlefield.
    if target.zone != ZoneType::Battlefield {
        return true;
    }
    // Shroud: can't be targeted by anyone
    let ignore_shroud = crate::staticability::static_ability_ignore_hexproof_shroud::ignore_shroud(
        &game.cards,
        target,
        source_controller,
    );
    if target.has_shroud() && !ignore_shroud {
        return false;
    }
    // Hexproof: can't be targeted by opponents
    let ignore_hexproof =
        crate::staticability::static_ability_ignore_hexproof_shroud::ignore_hexproof(
            &game.cards,
            target,
            source_controller,
        );
    if target.has_hexproof() && target.controller != source_controller && !ignore_hexproof {
        return false;
    }
    if let Some(src_id) = source_card {
        let src = game.card(src_id);
        // Check "Hexproof from <color>"
        if target.controller != source_controller {
            for color in &["white", "blue", "black", "red", "green"] {
                if target.has_hexproof_from(color) {
                    let has_color = crate::staticability::static_ability_colorless_damage_source::source_has_color(
                        &game.cards,
                        src,
                        color,
                    );
                    if has_color {
                        return false;
                    }
                }
            }
        }
        // Protection: can't be targeted by matching sources
        if crate::staticability::static_ability_colorless_damage_source::target_is_protected_from_source(
            &game.cards, target, src,
        ) {
            return false;
        }
    }
    true
}

/// Get all creatures on the battlefield (any player).
/// Part of `TargetRestrictions.getAllCandidates()` for creature targets.
pub fn get_all_candidates_creatures(game: &GameState) -> Vec<CardId> {
    let mut creatures = Vec::new();
    for &pid in &game.player_order {
        for &cid in game.cards_in_zone(ZoneType::Battlefield, pid) {
            let card = game.card(cid);
            // CR 702.26: phased-out permanents are treated as though they
            // don't exist. Match Java's `Player.getCardsIn(Battlefield)`
            // default `filterOutPhasedOut = true`.
            if card.phased_out {
                continue;
            }
            if card.is_creature() {
                creatures.push(cid);
            }
        }
    }
    creatures
}

/// Get creatures matching an optional filter (e.g. "nonBlack", "OppCtrl").
/// Mirrors Java's `TargetRestrictions.getAllCandidates()` with card property filtering.
pub fn get_all_candidates_creature_filtered(
    game: &GameState,
    filter: Option<&str>,
    source_controller: PlayerId,
) -> Vec<CardId> {
    let all = get_all_candidates_creatures(game);
    match filter {
        None => all,
        Some(f) => all
            .into_iter()
            .filter(|&cid| card_property::card_has_property(game.card(cid), f, source_controller))
            .collect(),
    }
}

pub fn get_all_candidates_creature_filtered_for_restrictions(
    game: &GameState,
    restrictions: &TargetRestrictions,
    filter: Option<&str>,
    source_controller: PlayerId,
    source_card: Option<CardId>,
) -> Vec<CardId> {
    let all = get_all_candidates_creatures(game);
    filter_card_candidates_for_restrictions(
        game,
        all,
        restrictions,
        filter,
        source_controller,
        source_card,
    )
}

/// Get all permanents on the battlefield (any player).
pub fn get_all_battlefield_permanents(game: &GameState) -> Vec<CardId> {
    let mut permanents = Vec::new();
    for &pid in &game.player_order {
        for &cid in game.cards_in_zone(ZoneType::Battlefield, pid) {
            // CR 702.26: phased-out permanents are treated as though they
            // don't exist. Exclude from target candidate lists.
            if game.card(cid).phased_out {
                continue;
            }
            permanents.push(cid);
        }
    }
    permanents
}

/// Get battlefield permanents matching an optional filter (e.g. "nonLand+OppCtrl").
/// Similar to `get_all_candidates_creature_filtered` but for any permanent type.
pub fn get_all_battlefield_permanents_filtered(
    game: &GameState,
    filter: Option<&str>,
    source_controller: PlayerId,
) -> Vec<CardId> {
    let all = get_all_battlefield_permanents(game);
    match filter {
        None => all,
        Some(f) => all
            .into_iter()
            .filter(|&cid| card_property::card_has_property(game.card(cid), f, source_controller))
            .collect(),
    }
}

pub fn get_all_battlefield_permanents_filtered_for_restrictions(
    game: &GameState,
    restrictions: &TargetRestrictions,
    filter: Option<&str>,
    source_controller: PlayerId,
    source_card: Option<CardId>,
) -> Vec<CardId> {
    let all = get_all_battlefield_permanents(game);
    filter_card_candidates_for_restrictions(
        game,
        all,
        restrictions,
        filter,
        source_controller,
        source_card,
    )
}

fn filter_card_candidates_for_restrictions(
    game: &GameState,
    candidates: Vec<CardId>,
    restrictions: &TargetRestrictions,
    filter: Option<&str>,
    source_controller: PlayerId,
    source_card: Option<CardId>,
) -> Vec<CardId> {
    let Some(source_id) = source_card else {
        return match filter {
            None => candidates,
            Some(f) => candidates
                .into_iter()
                .filter(|&cid| {
                    card_property::card_has_property(game.card(cid), f, source_controller)
                })
                .collect(),
        };
    };
    let selector = restrictions.compiled_valid_tgts();
    let source = game.card(source_id);
    candidates
        .into_iter()
        .filter(|&cid| !is_other_filter_self_hit(filter, source_card, cid))
        .filter(|&cid| {
            valid_filter::matches_valid_card_selector_in_game(
                &selector,
                game.card(cid),
                source,
                game,
            )
        })
        .collect()
}

// ── Zone-aware targeting for cards like Raise Dead ───────────────────

/// Enhanced parser that considers Origin$ parameter for zone targeting.
/// This parser handles both legacy battlefield targeting and zone-aware targeting
/// (e.g., Raise Dead with Origin$ Graveyard).
fn parse_target_kind_enhanced(val: &str, origin_zone: Option<ZoneType>) -> TargetKind {
    let val = val.trim();

    // Player/Opponent targeting is never card-in-zone, even when Origin$ is
    // a non-battlefield zone (e.g. Nihil Spellbomb targets a Player while
    // Origin$ Graveyard specifies where to exile cards from).
    if val.eq_ignore_ascii_case("Player") || val.eq_ignore_ascii_case("Opponent") {
        return TargetKind::Player;
    }

    // Handle the special case of CardInZone targeting
    if let Some(zone) = origin_zone {
        if zone != ZoneType::Battlefield {
            // If we have a non-battlefield origin, this is zone targeting.
            // Keep the full ValidTgts token (e.g., "Creature.YouCtrl"), mirroring
            // Java's Card.isValid(type.properties) flow.
            let filter = if val.is_empty() {
                None
            } else {
                Some(val.to_string())
            };
            return TargetKind::CardInZone { zone, filter };
        }
    }

    // For battlefield targeting (or no origin specified), use traditional parsing
    parse_target_kind_legacy(val)
}

/// Legacy parser for battlefield-targeting spells (Unsummon, Doom Blade, etc.)
fn parse_target_kind_legacy(val: &str) -> TargetKind {
    let val = val.trim();
    if val.eq_ignore_ascii_case("Any") {
        return TargetKind::Any;
    }
    if val.eq_ignore_ascii_case("Player") || val.eq_ignore_ascii_case("Opponent") {
        return TargetKind::Player;
    }
    if val.eq_ignore_ascii_case("Spell") {
        return TargetKind::Spell;
    }
    if val.starts_with("Creature") {
        // Safe: we just checked starts_with, so strip_prefix will succeed
        let filter = val.strip_prefix("Creature").unwrap_or("");
        if filter.is_empty() {
            return TargetKind::Creature(None);
        }
        let filter = filter.strip_prefix('.').unwrap_or(filter);
        return TargetKind::Creature(Some(filter.to_string()));
    }
    if val.starts_with("Permanent") {
        // Safe: we just checked starts_with, so strip_prefix will succeed
        let filter = val.strip_prefix("Permanent").unwrap_or("");
        if filter.is_empty() {
            return TargetKind::Permanent(None);
        }
        let filter = filter.strip_prefix('.').unwrap_or(filter);
        return TargetKind::Permanent(Some(filter.to_string()));
    }
    if val.starts_with("Land") {
        // "Land" targeting is a permanent target restricted to lands.
        // Keep land qualifiers (e.g. "Land.nonBasic") in the filter string.
        let filter = val.strip_prefix("Land").unwrap_or("");
        if filter.is_empty() {
            return TargetKind::Permanent(Some("Land".to_string()));
        }
        let filter = filter.strip_prefix('.').unwrap_or(filter);
        return TargetKind::Permanent(Some(format!("Land.{filter}")));
    }
    // Fallback: treat as "Any" if unrecognized
    TargetKind::Any
}

/// Get all cards in a zone matching the filter (for Raise Dead style targeting)
pub fn get_valid_cards_in_zone(
    game: &GameState,
    zone: ZoneType,
    player: PlayerId,
    filter: Option<&str>,
    source_card: Option<CardId>,
) -> Vec<CardId> {
    // Determine whether the filter restricts to a specific controller/owner.
    // If not restricted, search ALL players' zones (e.g. "target card from a graveyard"
    // can target any player's graveyard). Mirrors Java's TargetRestrictions.getAllCandidates().
    let restrict_to_player = filter
        .map(|f| {
            f.contains("YouCtrl")
                || f.contains("YouOwn")
                || f.contains("YouControl")
                || f.contains("EnchantedBy")
        })
        .unwrap_or(false);

    let zone_cards: Vec<CardId> = if restrict_to_player {
        game.cards_in_zone(zone, player).to_vec()
    } else {
        game.player_order
            .iter()
            .flat_map(|&pid| game.cards_in_zone(zone, pid).to_vec())
            .collect()
    };

    match filter {
        None => zone_cards,
        Some(f) => {
            // ValidTgts$ uses commas for OR logic (e.g. "Creature,Land" means
            // creature OR land). Split and match any clause.
            let clauses: Vec<&str> = f.split(',').map(str::trim).collect();
            zone_cards
                .into_iter()
                .filter(|&cid| !is_other_filter_self_hit(Some(f), source_card, cid))
                .filter(|&cid| {
                    clauses.iter().any(|clause| {
                        card_property::card_has_property(game.card(cid), clause, player)
                    })
                })
                .collect()
        }
    }
}

/// Get all cards in a zone matching this ability's target restrictions while
/// preserving trigger context for dynamic selectors such as `cmcLTX`.
pub fn get_valid_cards_in_zone_for_sa(
    game: &GameState,
    zone: ZoneType,
    player: PlayerId,
    filter: Option<&str>,
    ability: &SpellAbility,
) -> Vec<CardId> {
    let zone_cards = candidate_zone_cards(game, zone, player, filter);
    let Some(source_id) = ability.source else {
        return get_valid_cards_in_zone(game, zone, player, filter, None);
    };
    let Some(restrictions) = ability.target_restrictions.as_ref() else {
        return zone_cards;
    };
    let selector = restrictions.compiled_valid_tgts();
    let source = game.card(source_id);
    let triggering_card = ability.get_triggering_card(crate::ability::AbilityKey::Card);
    let triggering_player = ability
        .get_triggering_value(crate::ability::AbilityKey::Player)
        .and_then(|value| match value {
            crate::event::AbilityValue::Player(player) => Some(*player),
            _ => None,
        });

    zone_cards
        .into_iter()
        .filter(|&cid| !is_other_filter_self_hit(filter, ability.source, cid))
        .filter(|&cid| {
            valid_filter::matches_valid_card_selector_with_context(
                &selector,
                game.card(cid),
                valid_filter::MatchContext::from_source(source)
                    .with_game(game)
                    .with_triggering(triggering_card, triggering_player),
            )
        })
        .collect()
}

fn get_valid_cards_in_zone_for_restrictions(
    game: &GameState,
    restrictions: &TargetRestrictions,
    zone: ZoneType,
    player: PlayerId,
    filter: Option<&str>,
    source_card: Option<CardId>,
) -> Vec<CardId> {
    let zone_cards = candidate_zone_cards(game, zone, player, filter);
    let Some(source_id) = source_card else {
        return match filter {
            None => zone_cards,
            Some(f) => {
                let clauses: Vec<&str> = f.split(',').map(str::trim).collect();
                zone_cards
                    .into_iter()
                    .filter(|&cid| !is_other_filter_self_hit(Some(f), source_card, cid))
                    .filter(|&cid| {
                        clauses.iter().any(|clause| {
                            card_property::card_has_property(game.card(cid), clause, player)
                        })
                    })
                    .collect()
            }
        };
    };
    let selector = restrictions.compiled_valid_tgts();
    let source = game.card(source_id);
    zone_cards
        .into_iter()
        .filter(|&cid| !is_other_filter_self_hit(filter, source_card, cid))
        .filter(|&cid| {
            valid_filter::matches_valid_card_selector_in_game(
                &selector,
                game.card(cid),
                source,
                game,
            )
        })
        .collect()
}

fn candidate_zone_cards(
    game: &GameState,
    zone: ZoneType,
    player: PlayerId,
    filter: Option<&str>,
) -> Vec<CardId> {
    let restrict_to_player = filter
        .map(|f| {
            f.contains("YouCtrl")
                || f.contains("YouOwn")
                || f.contains("YouControl")
                || f.contains("EnchantedBy")
        })
        .unwrap_or(false);

    if restrict_to_player {
        game.cards_in_zone(zone, player).to_vec()
    } else {
        game.player_order
            .iter()
            .flat_map(|&pid| game.cards_in_zone(zone, pid).to_vec())
            .collect()
    }
}

/// Get all stack entry IDs for spells that can be countered.
/// Mirrors Java's `TargetRestrictions.getAllCandidates()` for Spell targets.
/// Returned in top-of-stack-first order to match Java's `LinkedBlockingDeque`
/// iteration (entries are pushed via `addFirst`, so `iterator()` walks the
/// top of the stack downward). Without this ordering, Stifle and similar
/// counters target the wrong stack entry under deterministic-agent picks.
pub fn get_all_candidates_spells(game: &GameState) -> Vec<u32> {
    let mut ids: Vec<u32> = game
        .stack
        .iter()
        .filter(|entry| !entry.is_pending_cast)
        .map(|entry| entry.id)
        .collect();
    ids.reverse();
    ids
}

fn token_allows_player_targets(token: &str) -> bool {
    let t = token.trim().to_ascii_lowercase();
    t == "any" || t.contains("player") || t == "you" || t == "opponent"
}

/// Whether this `TargetKind::Any` restriction may target players.
pub fn any_target_allows_players(valid_tgts: &[String]) -> bool {
    valid_tgts.iter().any(|t| token_allows_player_targets(t))
}

/// Candidate battlefield cards for `TargetKind::Any`, derived from `ValidTgts`.
pub fn get_all_candidates_any_filtered(
    game: &GameState,
    valid_tgts: &[String],
    source_controller: PlayerId,
) -> Vec<CardId> {
    if valid_tgts
        .iter()
        .any(|t| t.trim().eq_ignore_ascii_case("Any"))
    {
        return get_all_candidates_any_target_cards(game);
    }

    let mut candidates = Vec::new();
    for &pid in &game.player_order {
        for &cid in game.cards_in_zone(ZoneType::Battlefield, pid) {
            if valid_tgts.iter().any(|raw| {
                let token = raw.trim();
                if token_allows_player_targets(token) {
                    return false;
                }
                card_property::card_has_property(game.card(cid), token, source_controller)
            }) {
                candidates.push(cid);
            }
        }
    }
    candidates
}

pub fn get_all_candidates_any_filtered_for_restrictions(
    game: &GameState,
    restrictions: &TargetRestrictions,
    source_controller: PlayerId,
    source_card: Option<CardId>,
) -> Vec<CardId> {
    if restrictions
        .valid_tgts
        .iter()
        .any(|t| t.trim().eq_ignore_ascii_case("Any"))
    {
        return get_all_candidates_any_target_cards(game);
    }
    let candidates = get_all_battlefield_permanents(game);
    let Some(source_id) = source_card else {
        return candidates
            .into_iter()
            .filter(|&cid| {
                restrictions.valid_tgts.iter().any(|raw| {
                    let token = raw.trim();
                    if token_allows_player_targets(token) {
                        return false;
                    }
                    card_property::card_has_property(game.card(cid), token, source_controller)
                })
            })
            .collect();
    };
    let selector = restrictions.compiled_valid_tgts();
    let source = game.card(source_id);
    candidates
        .into_iter()
        .filter(|&cid| {
            valid_filter::matches_valid_card_selector_in_game(
                &selector,
                game.card(cid),
                source,
                game,
            )
        })
        .collect()
}

fn get_all_candidates_any_target_cards(game: &GameState) -> Vec<CardId> {
    let mut cards = Vec::new();
    for &pid in &game.player_order {
        for &cid in game.cards_in_zone(ZoneType::Battlefield, pid) {
            let card = game.card(cid);
            if card.phased_out {
                continue;
            }
            if card.is_creature()
                || card.type_line.is_planeswalker()
                || card.type_line.core_types.contains(&CoreType::Battle)
            {
                cards.push(cid);
            }
        }
    }
    cards
}

/// Check if there are valid targets in a specific zone.
pub fn has_valid_target_in_zone(
    game: &GameState,
    player: PlayerId,
    zone: ZoneType,
    filter: Option<&str>,
    source_card: Option<CardId>,
) -> bool {
    !get_valid_cards_in_zone(game, zone, player, filter, source_card).is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_valid_targets_any() {
        assert_eq!(
            parse_valid_targets("SP$ DealDamage | ValidTgts$ Any | NumDmg$ 3"),
            TargetKind::Any
        );
    }

    #[test]
    fn parse_valid_targets_creature_filter() {
        assert_eq!(
            parse_valid_targets("SP$ Destroy | ValidTgts$ Creature.nonBlack"),
            TargetKind::Creature(Some("nonBlack".to_string()))
        );
    }

    #[test]
    fn parse_valid_targets_creature_no_filter() {
        assert_eq!(
            parse_valid_targets("SP$ Destroy | ValidTgts$ Creature"),
            TargetKind::Creature(None)
        );
    }

    #[test]
    fn parse_valid_targets_player() {
        assert_eq!(
            parse_valid_targets("SP$ Draw | ValidTgts$ Player"),
            TargetKind::Player
        );
    }

    #[test]
    fn parse_valid_targets_graveyard_creature() {
        // Test parsing for Raise Dead style: ValidTgts$ Creature with Origin$ Graveyard
        let ability =
            "SP$ ChangeZone | Origin$ Graveyard | Destination$ Hand | ValidTgts$ Creature.YouCtrl";
        let target_kind = parse_valid_targets(ability);
        assert!(matches!(
            target_kind,
            TargetKind::CardInZone {
                zone: ZoneType::Graveyard,
                ..
            }
        ));
    }

    #[test]
    fn parse_valid_targets_land() {
        assert_eq!(
            parse_valid_targets("SP$ Destroy | ValidTgts$ Land"),
            TargetKind::Permanent(Some("Land".to_string()))
        );
    }

    #[test]
    fn parse_valid_targets_land_filter() {
        assert_eq!(
            parse_valid_targets("SP$ Destroy | ValidTgts$ Land.nonBasic"),
            TargetKind::Permanent(Some("Land.nonBasic".to_string()))
        );
    }

    #[test]
    fn target_restrictions_from_params() {
        let params = Params::from_raw("ValidTgts$ Creature.OppCtrl");
        let tr = TargetRestrictions::new(&params).unwrap();
        assert_eq!(tr.target_kind, TargetKind::Creature(Some("OppCtrl".into())));
        assert_eq!(tr.min_targets, "1");
        assert_eq!(tr.max_targets, "1");
    }

    #[test]
    fn target_restrictions_from_params_graveyard_origin() {
        let params = Params::from_raw("Origin$ Graveyard | ValidTgts$ Creature.YouCtrl");
        let tr = TargetRestrictions::new(&params).unwrap();
        assert_eq!(
            tr.target_kind,
            TargetKind::CardInZone {
                zone: ZoneType::Graveyard,
                filter: Some("Creature.YouCtrl".into()),
            }
        );
    }

    #[test]
    fn no_valid_tgts_returns_none() {
        let params = Params::from_raw("");
        assert!(TargetRestrictions::new(&params).is_none());
    }

    #[test]
    fn has_candidates_in_chain_allows_zero_target_subability() {
        use forge_foundation::{CardTypeLine, ColorSet, ManaCost};

        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);
        let mut card = crate::card::Card::new(
            CardId(0),
            "Valley Rally".to_string(),
            p0,
            CardTypeLine::parse("Instant"),
            ManaCost::parse("2 R"),
            ColorSet::RED,
            None,
            None,
            vec![],
            vec![
                "SP$ PumpAll | ValidCards$ Creature.YouCtrl | NumAtt$ +2 | SubAbility$ DBPump"
                    .to_string(),
            ],
        );
        card.svars.insert(
            "DBPump".to_string(),
            "DB$ Pump | ValidTgts$ Creature.YouCtrl | TargetMin$ X | TargetMax$ X | KW$ First Strike"
                .to_string(),
        );
        card.svars
            .insert("X".to_string(), "Count$PromisedGift.1.0".to_string());
        let card_id = game.create_card(card);
        game.move_card(card_id, ZoneType::Hand, p0);

        let ability = game.card(card_id).abilities[0].clone();
        assert!(has_candidates_in_chain(&game, p0, &ability, Some(card_id)));
    }
}
