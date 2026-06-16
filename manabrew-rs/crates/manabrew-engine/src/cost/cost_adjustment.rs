//! Cost adjustment logic for spells and abilities.
//!
//! Mirrors Java's `forge.game.cost.CostAdjustment`.
//!
//! Scans static abilities on the battlefield (and the spell's own card) to
//! compute mana cost reductions, increases, set-cost floors (Trinisphere),
//! and additional non-mana cost parts (e.g. sacrifice from `Cost$` params).

use forge_foundation::color::Color;
use forge_foundation::mana::ManaCost;
use forge_foundation::ZoneType;

use crate::agent::PlayerAgent;
use crate::card::{valid_filter, Card};
use crate::card_trait_base::CardTraitIrOwner;
use crate::cost::{parse_cost, Cost, CostPart};
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::mana::mana_cost_being_paid::ManaCostBeingPaid;
use crate::mana::ManaPool;
use crate::player::player_predicates;
use crate::spellability::SpellAbility;
use crate::staticability::StaticMode;
use crate::trigger::TriggerHandler;

// ── CostAdjustment result struct ─────────────────────────────────────

/// Result of computing cost adjustments from static abilities.
///
/// Mirrors the net effect of Java's `CostAdjustment.adjust(ManaCostBeingPaid, ...)`
/// after scanning all ReduceCost / RaiseCost / SetCost static abilities.
#[derive(Debug, Clone, Default)]
pub struct CostAdjustment {
    /// Generic mana adjustment (positive = increase, negative = reduction).
    pub generic: i32,
    /// Per-color reductions: (color, amount, ignore_generic).
    pub color_reductions: Vec<(Color, i32, bool)>,
    /// Per-color increases: (color, amount).
    pub color_increases: Vec<(Color, i32)>,
    /// Minimum total mana cost after reductions (from MinMana$).
    pub min_mana: Option<i32>,
    /// Raise-to minimum (from SetCost + RaiseTo$, e.g. Trinisphere).
    pub raise_to: Option<i32>,
}

impl CostAdjustment {
    pub fn is_empty(&self) -> bool {
        self.generic == 0
            && self.color_reductions.is_empty()
            && self.color_increases.is_empty()
            && self.min_mana.is_none()
            && self.raise_to.is_none()
    }

    /// Apply this adjustment to a ManaCost, returning the modified cost.
    ///
    /// Mirrors the combined effect of Java's `applyReduceCostAbility`,
    /// `applySetCostAbility`, and generic increase logic in `CostAdjustment.adjust`.
    pub fn apply(&self, cost: &ManaCost) -> ManaCost {
        let mut result = cost.clone();

        // Apply color-specific reductions
        for &(color, amount, ignore_generic) in &self.color_reductions {
            result = result.reduce_color(color, amount, ignore_generic);
        }

        // Apply color-specific increases
        for &(color, amount) in &self.color_increases {
            let shard = color_to_shard(color);
            for _ in 0..amount {
                let mut shards = result.shards().to_vec();
                shards.push(shard);
                result = ManaCost::from_parts(shards, result.generic_cost());
            }
        }

        // Apply generic adjustment
        if self.generic > 0 {
            result = result.add(&ManaCost::generic(self.generic));
        } else if self.generic < 0 {
            result = result.reduce_generic(-self.generic);
        }

        // Enforce MinMana$ floor
        if let Some(min) = self.min_mana {
            if result.cmc() < min {
                let deficit = min - result.cmc();
                if deficit > 0 {
                    result = result.add(&ManaCost::generic(deficit));
                }
            }
        }

        // Enforce RaiseTo$ (Trinisphere): if cost would be less than N, raise to N
        if let Some(raise) = self.raise_to {
            if result.cmc() < raise {
                let deficit = raise - result.cmc();
                if deficit > 0 {
                    result = result.add(&ManaCost::generic(deficit));
                }
            }
        }

        result
    }

    /// Return the net generic change for simple affordability checks.
    pub fn net_generic_estimate(&self) -> i32 {
        let mut net = self.generic;
        for &(_, amount, _) in &self.color_reductions {
            net -= amount;
        }
        for &(_, amount) in &self.color_increases {
            net += amount;
        }
        net
    }
}

fn color_to_shard(color: Color) -> forge_foundation::mana::ManaCostShard {
    use forge_foundation::mana::ManaCostShard;
    match color {
        Color::White => ManaCostShard::White,
        Color::Blue => ManaCostShard::Blue,
        Color::Black => ManaCostShard::Black,
        Color::Red => ManaCostShard::Red,
        Color::Green => ManaCostShard::Green,
    }
}

fn matches_cost_adjustment_activator(
    game: &GameState,
    source: &Card,
    caster: PlayerId,
    activator: &str,
) -> bool {
    match activator.to_ascii_lowercase().as_str() {
        "you" | "player.you" => source.controller == caster,
        "opponent" | "player.opponent" => {
            player_predicates::is_opponent_of(game, caster, source.controller)
        }
        _ => {
            eprintln!("[WARN] Unknown cost adjustment Activator: {:?}", activator);
            false
        }
    }
}

// ── Public API: compute_cost_adjustment ──────────────────────────────

/// Compute cost adjustments for casting `spell_card` by `caster` from `cast_zone`.
///
/// Scans all battlefield permanents for ReduceCost / RaiseCost / SetCost static abilities.
/// Mirrors Java's `CostAdjustment.adjust(ManaCostBeingPaid, ...)` scanning loop.
///
/// Includes the spell card's own static abilities (e.g. Sunderflock's self-reduce) —
/// suitable for **playability** checks that need to know "could this spell be cast
/// in principle". For actual mana payment, use [`compute_cost_adjustment_for_payment`]
/// which excludes the spell card to mirror Java's split behaviour where
/// `ComputerUtilMana.canPayManaCost` and `CostAdjustment.adjust` disagree on
/// self-reducing statics for cards in hand.
pub fn compute_cost_adjustment(
    game: &GameState,
    spell_card: &Card,
    caster: PlayerId,
    cast_zone: ZoneType,
) -> CostAdjustment {
    compute_cost_adjustment_inner(game, spell_card, caster, cast_zone, &[], true)
}

/// Like `compute_cost_adjustment`, but also checks ValidTarget$ against chosen targets.
pub fn compute_cost_adjustment_with_targets(
    game: &GameState,
    spell_card: &Card,
    caster: PlayerId,
    cast_zone: ZoneType,
    targets: &[CardId],
) -> CostAdjustment {
    compute_cost_adjustment_inner(game, spell_card, caster, cast_zone, targets, true)
}

/// Payment-time variant. Includes the spell card itself so self-reducing
/// statics (Sunderflock's `Count$Valid Elemental.YouCtrl$GreatestCardManaCost`,
/// Animar's P1P1 counters, ...) apply at payment, matching Java's flow where
/// `InputPayMana` seeds `sa.setManaCostBeingPaid(reduced)` before handing
/// control to the payer (and the deterministic harness now mirrors that by
/// calling `CostAdjustment.adjust(ManaCostBeingPaid, ...)` itself).
pub fn compute_cost_adjustment_for_payment(
    game: &GameState,
    spell_card: &Card,
    caster: PlayerId,
    cast_zone: ZoneType,
    targets: &[CardId],
) -> CostAdjustment {
    compute_cost_adjustment_inner(game, spell_card, caster, cast_zone, targets, true)
}

fn compute_cost_adjustment_inner(
    game: &GameState,
    spell_card: &Card,
    caster: PlayerId,
    _cast_zone: ZoneType,
    targets: &[CardId],
    include_spell_self: bool,
) -> CostAdjustment {
    let mut adj = CostAdjustment::default();

    for source in game.cards.iter().filter(|c| {
        c.zone == ZoneType::Battlefield || (include_spell_self && c.id == spell_card.id)
    }) {
        for st_ab in source.static_abilities.iter() {
            let (is_reduce, is_set_cost) = if st_ab.check_mode(&StaticMode::ReduceCost) {
                (true, false)
            } else if st_ab.check_mode(&StaticMode::RaiseCost) {
                (false, false)
            } else if st_ab.check_mode(&StaticMode::SetCost) {
                (false, true)
            } else {
                continue;
            };

            // Java `CostAdjustment.applyRaiseCostAbility` merges `Cost$...` directly
            // into the spell's payable cost, not into generic mana deltas.
            // Those parts are handled by `compute_raise_cost_parts`; skip here.
            if st_ab.ir.cost.is_some() {
                continue;
            }

            // ── checkRequirement: Type$ filter ───────────────────────
            if let Some(type_filter) = st_ab.ir.type_filter.as_deref() {
                match type_filter.to_ascii_lowercase().as_str() {
                    "spell" => { /* casting a spell — ok */ }
                    _ => continue,
                }
            }

            // ── checkRequirement: Activator$ ─────────────────────────
            if let Some(activator) = st_ab.ir.activator_raw.as_deref() {
                if !matches_cost_adjustment_activator(game, source, caster, activator) {
                    continue;
                }
            } else {
                // No Activator$ parameter: applies to ALL players.
                // Java's matchesValidParam("Activator", ...) returns true when
                // the parameter is absent, making the effect universal.
                // Examples: Urza's Incubator (ReduceCost for all),
                // Thalia (RaiseCost for all).
            }

            // ── checkRequirement: ValidCard$ ─────────────────────────
            if !matches_valid_card(
                st_ab.ir.valid_card.as_ref(),
                spell_card,
                source,
                game,
                targets,
            ) {
                continue;
            }

            // EffectZone$ gates by the static's host zone (not the cast zone).
            // Empty declaration defaults to Battlefield — Java
            // `StaticAbility.zonesCheck`.
            if !st_ab.ir.effect_zone_all {
                let active = if st_ab.ir.effect_zones.is_empty() {
                    source.zone == ZoneType::Battlefield
                } else {
                    st_ab.ir.effect_zones.contains(&source.zone)
                };
                if !active {
                    continue;
                }
            }

            // ── checkRequirement: common CardTraitBase requirements ──
            if !st_ab.meets_card_trait_requirements(game, source, source) {
                continue;
            }

            // ── checkRequirement: OnlyFirstSpell$ ────────────────────
            if st_ab.ir.only_first_spell {
                // Only applies if no matching spells have been cast yet this turn
                if game.player(caster).spells_cast_this_turn > 0 {
                    continue;
                }
            }

            // ── checkRequirement: ValidTarget$ ───────────────────────
            if let Some(valid_target) = st_ab.ir.valid_target.as_ref() {
                let target_valid = if targets.is_empty() {
                    false
                } else {
                    targets.iter().any(|&tid| {
                        let target = game.card(tid);
                        matches_valid_card(Some(valid_target), target, source, game, targets)
                    })
                };
                if st_ab.ir.unless_valid_target {
                    if target_valid {
                        continue;
                    }
                } else if !target_valid {
                    continue;
                }
            }

            // ── checkRequirement: ValidSpell$ ────────────────────────
            if let Some(valid_spell) = st_ab.ir.valid_spell.as_deref() {
                if !check_valid_spell(valid_spell, spell_card) {
                    continue;
                }
            }

            // ── applyReduceCostAbility / increase: ForEachShard$ ─────
            if let Some(shard_color) = st_ab.ir.for_each_shard.as_deref() {
                let atom =
                    forge_foundation::mana::ManaAtom::from_name(&shard_color.to_ascii_lowercase());
                let count = spell_card
                    .mana_cost
                    .shards()
                    .iter()
                    .filter(|s| (s.shard() & atom) != 0)
                    .count() as i32;
                if count == 0 {
                    continue;
                }
                if is_reduce {
                    adj.generic -= count;
                } else {
                    adj.generic += count;
                }
                continue;
            }

            // ── applyReduceCostAbility: Amount$ (mirrors Java
            // `AbilityUtils.calculateAmount(hostCard, amount, staticAbility)`).
            // `Amount$ N` — literal integer; `Amount$ X` where `X` is an SVar
            // like `Count$CardCounters.P1P1` resolves against the host card
            // (e.g. Animar, Soul of Elements cost reduction by counters).
            let amount_str = st_ab.ir.amount.as_deref().unwrap_or("1");
            let amount: i32 = if let Ok(n) = amount_str.parse::<i32>() {
                n
            } else {
                crate::svar::resolve_cost_amount_svar(game, source, amount_str, caster)
            };

            // ── applyReduceCostAbility: MinMana$ ─────────────────────
            if let Some(min_val) = st_ab.ir.min_mana {
                adj.min_mana = Some(match adj.min_mana {
                    Some(existing) => existing.max(min_val),
                    None => min_val,
                });
            }

            // ── applySetCostAbility: SetCost + RaiseTo$ (Trinisphere) ──
            if is_set_cost {
                if st_ab.ir.raise_to {
                    adj.raise_to = Some(match adj.raise_to {
                        Some(existing) => existing.max(amount),
                        None => amount,
                    });
                }
                continue;
            }

            // ── applyReduceCostAbility: Color$ parameter ─────────────
            if let Some(color_str) = st_ab.ir.color.as_deref() {
                for token in color_str.split_whitespace() {
                    if let Some(color) = Color::from_name(token) {
                        if is_reduce {
                            adj.color_reductions
                                .push((color, amount, st_ab.ir.ignore_generic));
                        } else {
                            adj.color_increases.push((color, amount));
                        }
                    }
                }
                continue; // Color$ is exclusive — don't also adjust generic
            }

            // ── Generic adjustment ───────────────────────────────────
            if is_reduce {
                adj.generic -= amount;
            } else {
                adj.generic += amount;
            }
        }
    }

    adj
}

// ── Public API: compute_raise_cost_parts ─────────────────────────────

/// Compute additional non-standard cost parts contributed by `Mode$ RaiseCost`
/// static abilities (Java: `CostAdjustment.applyRaiseCostAbility` with `Cost$...`).
///
/// Returned `Cost` can contain mana and non-mana parts. Callers should:
/// - include mana parts in spell mana affordability/payment, and
/// - route non-mana parts through normal additional-cost payment plumbing.
pub fn compute_raise_cost_parts(
    game: &GameState,
    spell_card: &Card,
    caster: PlayerId,
    cast_zone: ZoneType,
) -> Option<Cost> {
    compute_raise_cost_parts_with_targets(game, spell_card, caster, cast_zone, &[])
}

/// Like `compute_raise_cost_parts`, but checks `ValidTarget$` against chosen targets.
pub fn compute_raise_cost_parts_with_targets(
    game: &GameState,
    spell_card: &Card,
    caster: PlayerId,
    cast_zone: ZoneType,
    targets: &[CardId],
) -> Option<Cost> {
    let mut merged_parts = Vec::new();
    let mut has_tap = false;
    let mut mandatory = false;

    for source in game
        .cards
        .iter()
        .filter(|c| c.zone == ZoneType::Battlefield || c.id == spell_card.id)
    {
        for st_ab in source.static_abilities.iter() {
            if !st_ab.check_mode(&StaticMode::RaiseCost) {
                continue;
            }

            let Some(scost) = st_ab.ir.cost.as_deref() else {
                continue;
            };

            // ── checkRequirement ─────────────────────────────────────
            if let Some(type_filter) = st_ab.ir.type_filter.as_deref() {
                match type_filter.to_ascii_lowercase().as_str() {
                    "spell" => {}
                    _ => continue,
                }
            }

            if let Some(activator) = st_ab.ir.activator_raw.as_deref() {
                if !matches_cost_adjustment_activator(game, source, caster, activator) {
                    continue;
                }
            } else {
                // RaiseCost without Activator$ → universal effect (e.g. Thalia)
            }

            if !matches_valid_card(
                st_ab.ir.valid_card.as_ref(),
                spell_card,
                source,
                game,
                targets,
            ) {
                continue;
            }

            if !st_ab.ir.effect_zone_all
                && !st_ab.ir.effect_zones.is_empty()
                && !st_ab.ir.effect_zones.contains(&cast_zone)
            {
                continue;
            }

            if !st_ab.meets_card_trait_requirements(game, source, source) {
                continue;
            }

            if st_ab.ir.only_first_spell && game.player(caster).spells_cast_this_turn > 0 {
                continue;
            }

            if let Some(valid_target) = st_ab.ir.valid_target.as_ref() {
                let target_valid = if targets.is_empty() {
                    false
                } else {
                    targets.iter().any(|&tid| {
                        let target = game.card(tid);
                        matches_valid_card(Some(valid_target), target, source, game, targets)
                    })
                };
                if (st_ab.ir.unless_valid_target && target_valid)
                    || (!st_ab.ir.unless_valid_target && !target_valid)
                {
                    continue;
                }
            }

            if let Some(valid_spell) = st_ab.ir.valid_spell.as_deref() {
                if !check_valid_spell(valid_spell, spell_card) {
                    continue;
                }
            }

            // ── applyRaiseCostAbility: compute count ─────────────────
            let count: i32 = if let Some(shard_color) = st_ab.ir.for_each_shard.as_deref() {
                let atom =
                    forge_foundation::mana::ManaAtom::from_name(&shard_color.to_ascii_lowercase());
                spell_card
                    .mana_cost
                    .shards()
                    .iter()
                    .filter(|s| (s.shard() & atom) != 0)
                    .count() as i32
            } else if st_ab.ir.relative {
                let amount_str = st_ab.ir.amount.as_deref().unwrap_or("1");
                crate::svar::resolve_cost_amount_svar(game, source, amount_str, caster)
            } else {
                st_ab
                    .ir
                    .amount
                    .as_deref()
                    .and_then(|a| a.parse().ok())
                    .unwrap_or(1)
            };

            if count <= 0 {
                continue;
            }

            let parsed = parse_cost(scost);
            // Mirrors `AbilityUtils.calculateAmount(host, getAmount(), sa)`:
            // resolve the inner `<Y/.../>` amount against the host SVars.
            // Zero means the part is opt-out (Announce$ default).
            let svar_amount = resolve_raise_cost_svar_amount(scost, source);
            if matches!(svar_amount, Some(n) if n <= 0) {
                continue;
            }
            let adjusted_parts = match svar_amount {
                Some(amt) => parsed
                    .parts
                    .iter()
                    .map(|p| substitute_part_amount(p, amt))
                    .collect::<Vec<_>>(),
                None => parsed.parts.clone(),
            };
            for _ in 0..count {
                merged_parts.extend(adjusted_parts.clone());
            }
            has_tap |= parsed.has_tap;
            mandatory |= parsed.mandatory;
        }
    }

    if merged_parts.is_empty() {
        None
    } else {
        Some(Cost {
            parts: merged_parts,
            has_tap,
            mandatory,
        })
    }
}

/// Resolve the `<amount/.../>` slot of a cost via the source card's SVars.
/// `None` when the slot is missing, numeric, or `X`.
fn resolve_raise_cost_svar_amount(scost: &str, source: &Card) -> Option<i32> {
    let start = scost.find('<')?;
    let rest = &scost[start + 1..];
    let end_rel = rest.find('>')?;
    let inner = &rest[..end_rel];
    let slash = inner.find('/')?;
    let name = inner[..slash].trim();
    if name.is_empty() || name.eq_ignore_ascii_case("X") || name.parse::<i32>().is_ok() {
        return None;
    }
    resolve_svar_amount_chain(source, name)
}

/// Walk an `SVar$NAME` chain to its first numeric value. 8-hop cap.
fn resolve_svar_amount_chain(source: &Card, start_name: &str) -> Option<i32> {
    let mut name = start_name.to_string();
    for _ in 0..8 {
        let raw = source.svars.get(&name)?;
        if let Some(rest) = raw.strip_prefix("SVar$") {
            let next = rest.split('/').next().unwrap_or("").trim();
            if next.is_empty() {
                return None;
            }
            name = next.to_string();
            continue;
        }
        if let Some(num_str) = raw.strip_prefix("Number$") {
            return num_str.trim().parse().ok();
        }
        return raw.trim().parse().ok();
    }
    None
}

/// Rewrite a parsed `CostPart`'s amount slot with `amount`.
fn substitute_part_amount(part: &CostPart, amount: i32) -> CostPart {
    let spec = crate::cost::AmountSpec::Literal(amount);
    match part {
        CostPart::Exile {
            type_filter, from, ..
        } => CostPart::Exile {
            amount: spec,
            type_filter: type_filter.clone(),
            from: *from,
        },
        CostPart::ExileFromAnyGrave { type_filter, .. } => CostPart::ExileFromAnyGrave {
            amount: spec,
            type_filter: type_filter.clone(),
        },
        CostPart::ExileFromSameGrave { type_filter, .. } => CostPart::ExileFromSameGrave {
            amount: spec,
            type_filter: type_filter.clone(),
        },
        CostPart::Sacrifice { type_filter, .. } => CostPart::Sacrifice {
            amount: spec,
            type_filter: type_filter.clone(),
        },
        CostPart::Discard { type_filter, .. } => CostPart::Discard {
            amount: spec,
            type_filter: type_filter.clone(),
        },
        CostPart::Return { type_filter, .. } => CostPart::Return {
            amount: spec,
            type_filter: type_filter.clone(),
        },
        other => other.clone(),
    }
}

// ── checkRequirement helpers (mirrors Java CostAdjustment.checkRequirement) ──

/// Check a ValidSpell$ parameter.
/// Mirrors the `ValidSpell` check in Java's `CostAdjustment.checkRequirement`.
fn check_valid_spell(valid_spell: &str, spell_card: &Card) -> bool {
    // Split comma-separated options — any match passes
    valid_spell.split(',').any(|option| {
        let parts: Vec<&str> = option.trim().split('.').collect();
        let category = parts.first().copied().unwrap_or("");
        match category {
            "Spell" => {
                // We're casting a spell, check sub-attributes
                parts
                    .iter()
                    .skip(1)
                    .all(|attr| match attr.to_lowercase().as_str() {
                        "bargain" => spell_card.has_keyword("Bargain"),
                        _ => true, // unknown attributes pass
                    })
            }
            "Activated" | "Static" => {
                // These are for ability cost changes, not spell casting
                false
            }
            _ => true,
        }
    })
}

// ── ValidCard$ matching (mirrors Java's checkRequirement ValidCard) ──

pub(crate) fn matches_valid_card(
    valid: Option<&crate::parsing::CompiledSelector>,
    spell: &Card,
    source: &Card,
    game: &GameState,
    targeted_cards: &[CardId],
) -> bool {
    let context = valid_filter::MatchContext::from_source(source)
        .with_game(game)
        .with_targets(targeted_cards, &[]);
    valid_filter::matches_valid_card_selector_opt_with_context(valid, spell, context)
}

// ── Affinity / Delve / Convoke / Improvise helpers ──────────────────
// These were in game_action_util.rs but belong in the cost module,
// mirroring Java's CostAdjustment which handles convoke/improvise/delve
// via adjustCostByConvokeOrImprovise() and adjustCostByOffering() etc.

/// Extract the affinity type from a card's keywords (e.g. "Affinity:Artifact" → "Artifact").
/// Mirrors Java's affinity keyword handling in `CostAdjustment`.
pub fn get_affinity_type(card: &Card) -> Option<String> {
    crate::keyword::extract_keyword_cost_from_all(
        [&card.keywords, &card.granted_keywords],
        "Affinity",
    )
}

/// Count permanents matching an affinity type on the battlefield.
/// Mirrors Java's affinity permanent counting in `CostAdjustment`.
pub fn count_affinity_permanents(
    game: &GameState,
    player: PlayerId,
    affinity_type: &str,
    exclude_card: CardId,
) -> i32 {
    game.cards_in_zone(ZoneType::Battlefield, player)
        .iter()
        .filter(|&&cid| {
            if cid == exclude_card {
                return false;
            }
            let c = game.card(cid);
            match affinity_type {
                "Artifact" => c.type_line.is_artifact(),
                "Creature" => c.is_creature(),
                "Enchantment" => c.type_line.is_enchantment(),
                "Land" => c.is_land(),
                "Planeswalker" => c.type_line.is_planeswalker(),
                other => c.type_line.has_subtype(other),
            }
        })
        .count() as i32
}

/// Apply Delve/Convoke/Improvise/Affinity generic cost reductions.
/// Used for `canPay` checks — estimates the maximum possible reduction.
/// Mirrors Java's CostAdjustment adjustment methods for these mechanics.
pub fn apply_cost_reductions(
    game: &GameState,
    player: PlayerId,
    card_id: CardId,
    card: &Card,
    cost: &ManaCost,
) -> ManaCost {
    if card.has_keyword("Delve") {
        let gy_count = game
            .cards_in_zone(ZoneType::Graveyard, player)
            .iter()
            .filter(|&&cid| cid != card_id)
            .count() as i32;
        cost.reduce_generic(gy_count)
    } else if card.has_keyword("Convoke") {
        let creature_count = game
            .cards_in_zone(ZoneType::Battlefield, player)
            .iter()
            .filter(|&&cid| {
                let c = game.card(cid);
                c.is_creature() && !c.tapped && cid != card_id
            })
            .count() as i32;
        cost.reduce_generic(creature_count)
    } else if card.has_keyword("Improvise") {
        let artifact_count = game
            .cards_in_zone(ZoneType::Battlefield, player)
            .iter()
            .filter(|&&cid| {
                let c = game.card(cid);
                c.type_line.is_artifact() && !c.tapped && cid != card_id
            })
            .count() as i32;
        cost.reduce_generic(artifact_count)
    } else if let Some(affinity_type) = get_affinity_type(card) {
        let count = count_affinity_permanents(game, player, &affinity_type, card_id);
        cost.reduce_generic(count)
    } else {
        cost.clone()
    }
}

/// Java-like `CostAdjustment.adjust(...)` entrypoint.
///
/// This composes the Rust cost-adjustment pieces and owns the cast-time
/// reduction choices that Java performs inside `CostAdjustment.adjust(...)`.
/// The helper mutates `sa` and can mutate the game when `test == false`.
pub fn adjust(
    game: &mut GameState,
    agents: &mut [Box<dyn PlayerAgent>],
    trigger_handler: &mut TriggerHandler,
    mana_pools: &[ManaPool],
    cost: &mut ManaCostBeingPaid,
    sa: &mut SpellAbility,
    payer: PlayerId,
    cards_to_delve_out: Option<&mut Vec<CardId>>,
    test: bool,
    effect: bool,
) -> bool {
    if effect || sa.is_trigger {
        return true;
    }

    let Some(card_id) = sa.source else {
        return true;
    };
    let cast_zone = game.card(card_id).zone;
    let target_cards = sa.get_targets().all_target_cards();

    let adjusted = compute_cost_adjustment_for_payment(
        game,
        game.card(card_id),
        payer,
        cast_zone,
        &target_cards,
    )
    .apply(&cost.to_mana_cost());
    *cost = ManaCostBeingPaid::from_mana_cost(&adjusted);

    if let Some(raise_cost) = compute_raise_cost_parts_with_targets(
        game,
        game.card(card_id),
        payer,
        cast_zone,
        &target_cards,
    ) {
        let raise_mana = mana_from_cost(&raise_cost);
        cost.add_mana_cost(&raise_mana);
    }

    apply_pip_reductions(cost, sa);
    if sa.is_spell {
        if !apply_offering_reduction(game, agents, mana_pools, trigger_handler, cost, sa, test) {
            return false;
        }
        if !apply_emerge_reduction(game, agents, mana_pools, trigger_handler, cost, sa, test) {
            return false;
        }
        if !apply_delve_reduction(
            game,
            agents,
            mana_pools,
            trigger_handler,
            cost,
            sa,
            test,
            cards_to_delve_out,
        ) {
            return false;
        }
        // Only offer Convoke/Improvise when the card actually has the
        // keyword. Otherwise Rust sends a spurious `choose_convoke` callback
        // to the agent on every spell cast, which diverges from Java.
        let has_convoke = game.card(card_id).has_keyword("Convoke");
        let has_improvise = game.card(card_id).has_keyword("Improvise");
        if has_convoke {
            apply_convoke_or_improvise_reduction(
                game, agents, mana_pools, cost, sa, payer, false, true, None, test,
            );
        }
        if has_improvise {
            apply_convoke_or_improvise_reduction(
                game, agents, mana_pools, cost, sa, payer, true, false, None, test,
            );
        }
    }
    if sa.ir.tap_creatures_for_mana {
        let max_reduction = cost.get_generic_mana_amount();
        apply_convoke_or_improvise_reduction(
            game,
            agents,
            mana_pools,
            cost,
            sa,
            payer,
            false,
            true,
            Some(max_reduction),
            test,
        );
    }
    apply_affinity_reduction(cost, payer, game.card(card_id), game);
    if effect {
        let max_reduction = cost.get_generic_mana_amount();
        apply_convoke_or_improvise_reduction(
            game,
            agents,
            mana_pools,
            cost,
            sa,
            payer,
            true,
            true,
            Some(max_reduction),
            test,
        );
    }

    true
}

fn apply_pip_reductions(cost: &mut ManaCostBeingPaid, sa: &SpellAbility) {
    for pip in &sa.pips_to_reduce {
        match pip.to_ascii_uppercase().as_str() {
            "W" => cost.decrease_shard(forge_foundation::mana::ManaCostShard::White, 1),
            "U" => cost.decrease_shard(forge_foundation::mana::ManaCostShard::Blue, 1),
            "B" => cost.decrease_shard(forge_foundation::mana::ManaCostShard::Black, 1),
            "R" => cost.decrease_shard(forge_foundation::mana::ManaCostShard::Red, 1),
            "G" => cost.decrease_shard(forge_foundation::mana::ManaCostShard::Green, 1),
            "C" => cost.decrease_shard(forge_foundation::mana::ManaCostShard::Colorless, 1),
            _ => {}
        }
    }
}

fn apply_offering_reduction(
    game: &mut GameState,
    agents: &mut [Box<dyn PlayerAgent>],
    mana_pools: &[ManaPool],
    _trigger_handler: &mut TriggerHandler,
    cost: &mut ManaCostBeingPaid,
    sa: &mut SpellAbility,
    _test: bool,
) -> bool {
    let Some(offering_type) = game
        .card(sa.source.expect("spell source"))
        .get_offering_type()
    else {
        return true;
    };
    if sa.sacrificed_as_offering.is_some() {
        let reduce = game
            .card(sa.sacrificed_as_offering.expect("checked above"))
            .mana_cost
            .cmc();
        cost.decrease_generic_mana(reduce);
        return true;
    }
    let offering_type_lower = offering_type.to_lowercase();
    let source = sa.source.expect("spell source");
    let player = sa.activating_player;
    let candidates: Vec<CardId> = game
        .cards_in_zone(ZoneType::Battlefield, player)
        .iter()
        .filter(|&&cid| {
            cid != source && {
                let c = game.card(cid);
                match offering_type_lower.as_str() {
                    "creature" => c.is_creature(),
                    "artifact" => c.type_line.is_artifact(),
                    "enchantment" => c.type_line.is_enchantment(),
                    "land" => c.is_land(),
                    _ => c.type_line.has_subtype(&offering_type),
                }
            }
        })
        .copied()
        .collect();
    if candidates.is_empty() {
        return true;
    }
    agents[player.index()].snapshot_state(game, mana_pools);
    if let Some(chosen) = agents[player.index()].choose_sacrifice(player, &candidates, sa.source) {
        sa.sacrificed_as_offering = Some(chosen);
        cost.decrease_generic_mana(game.card(chosen).mana_cost.cmc());
    }
    true
}

fn apply_emerge_reduction(
    game: &mut GameState,
    agents: &mut [Box<dyn PlayerAgent>],
    mana_pools: &[ManaPool],
    _trigger_handler: &mut TriggerHandler,
    cost: &mut ManaCostBeingPaid,
    sa: &mut SpellAbility,
    _test: bool,
) -> bool {
    if sa.alt_cost != Some(crate::spellability::AlternativeCost::Emerge) {
        return true;
    }
    if sa.sacrificed_as_emerge.is_some() {
        let reduce = game
            .card(sa.sacrificed_as_emerge.expect("checked above"))
            .mana_cost
            .cmc();
        cost.decrease_generic_mana(reduce);
        return true;
    }
    let source = sa.source.expect("spell source");
    let player = sa.activating_player;
    let valid_type = game
        .card(source)
        .keywords
        .get_values()
        .into_iter()
        .chain(game.card(source).granted_keywords.get_values())
        .find_map(|kw| {
            kw.original
                .strip_prefix("Emerge:")
                .map(|rest| rest.split(':').nth(1).unwrap_or("Creature").to_string())
        })
        .unwrap_or_else(|| "Creature".to_string());
    let candidates: Vec<CardId> = game
        .cards_in_zone(ZoneType::Battlefield, player)
        .iter()
        .filter(|&&cid| {
            cid != source && {
                let c = game.card(cid);
                match valid_type.as_str() {
                    "Creature" => c.is_creature(),
                    "Artifact" => c.type_line.is_artifact(),
                    "Enchantment" => c.type_line.is_enchantment(),
                    "Land" => c.is_land(),
                    other => c.type_line.has_subtype(other),
                }
            }
        })
        .copied()
        .collect();
    if candidates.is_empty() {
        return true;
    }
    agents[player.index()].snapshot_state(game, mana_pools);
    if let Some(chosen) = agents[player.index()].choose_sacrifice(player, &candidates, sa.source) {
        sa.sacrificed_as_emerge = Some(chosen);
        cost.decrease_generic_mana(game.card(chosen).mana_cost.cmc());
    }
    true
}

fn apply_affinity_reduction(
    cost: &mut ManaCostBeingPaid,
    payer: PlayerId,
    spell_card: &Card,
    game: &GameState,
) {
    let Some(affinity_type) = get_affinity_type(spell_card) else {
        return;
    };
    let count = count_affinity_permanents(game, payer, &affinity_type, spell_card.id);
    if count > 0 {
        cost.decrease_generic_mana(count);
    }
}

fn apply_delve_reduction(
    game: &mut GameState,
    agents: &mut [Box<dyn PlayerAgent>],
    mana_pools: &[ManaPool],
    _trigger_handler: &mut TriggerHandler,
    cost: &mut ManaCostBeingPaid,
    sa: &mut SpellAbility,
    test: bool,
    cards_to_delve_out: Option<&mut Vec<CardId>>,
) -> bool {
    let source = sa.source.expect("spell source");
    if !game.card(source).has_keyword("Delve") {
        return true;
    }
    let generic = cost.get_generic_mana_amount();
    if generic <= 0 {
        return true;
    }
    let player = sa.activating_player;
    let graveyard: Vec<CardId> = game
        .cards_in_zone(ZoneType::Graveyard, player)
        .iter()
        .filter(|&&cid| cid != source)
        .copied()
        .collect();
    if graveyard.is_empty() {
        return true;
    }
    let max_delve = (generic as usize).min(graveyard.len());
    agents[player.index()].snapshot_state(game, mana_pools);
    let chosen = agents[player.index()].choose_delve(player, &graveyard, max_delve, Some(source));
    game.card_mut(source).clear_delved();
    match cards_to_delve_out {
        Some(out) => {
            for &cid in chosen.iter().take(max_delve) {
                cost.decrease_generic_mana(1);
                out.push(cid);
            }
        }
        None => {
            for &cid in chosen.iter().take(max_delve) {
                cost.decrease_generic_mana(1);
                if !test {
                    game.card_mut(source).add_delved(cid);
                    let owner = game.card(cid).owner;
                    game.move_card_with_agents(cid, ZoneType::Exile, owner, agents);
                }
            }
        }
    }
    true
}

#[allow(clippy::too_many_arguments)]
fn apply_convoke_or_improvise_reduction(
    game: &mut GameState,
    agents: &mut [Box<dyn PlayerAgent>],
    mana_pools: &[ManaPool],
    cost: &mut ManaCostBeingPaid,
    sa: &mut SpellAbility,
    payer: PlayerId,
    artifacts: bool,
    creatures: bool,
    max_reduction: Option<i32>,
    test: bool,
) {
    let source = sa.source.expect("spell source");
    if creatures && !artifacts {
        sa.clear_tapped_for_convoke();
    }
    let mut untapped: Vec<CardId> = game
        .cards_in_zone(ZoneType::Battlefield, payer)
        .iter()
        .filter(|&&cid| !game.card(cid).tapped && cid != source)
        .copied()
        .collect();
    untapped.retain(|&cid| {
        let c = game.card(cid);
        if artifacts && creatures {
            c.type_line.is_artifact() || c.is_creature()
        } else if artifacts {
            c.type_line.is_artifact()
        } else {
            c.is_creature()
        }
    });
    if untapped.is_empty() {
        return;
    }
    let remaining_cost = cost.to_mana_cost();
    if remaining_cost.cmc() <= 0 {
        return;
    }
    let card_name = game.card(source).card_name.clone();
    agents[payer.index()].snapshot_state(game, mana_pools);
    let chosen = if artifacts && !creatures {
        agents[payer.index()].choose_improvise(payer, &untapped, &remaining_cost, Some(source))
    } else {
        agents[payer.index()].choose_convoke(payer, &untapped, &remaining_cost, Some(source))
    };
    let mut reduced = 0i32;
    for &cid in &chosen {
        if !untapped.contains(&cid) {
            continue;
        }
        if let Some(max) = max_reduction {
            if reduced >= max {
                break;
            }
        }
        let pay_generic_only = artifacts && !creatures;
        let mut paid = false;
        if !pay_generic_only {
            let payable_colors = game.card(cid).color.mask() as u16;
            let distinct = cost.get_distinct_shards();
            let payable: Vec<_> = distinct
                .into_iter()
                .filter(|shard| {
                    let shard_mask = shard.shard();
                    (shard_mask & payable_colors) != 0
                        && *shard != forge_foundation::mana::ManaCostShard::Generic
                })
                .collect();
            if let Some(chosen_shard) = payable.first().copied() {
                cost.decrease_shard(chosen_shard, 1);
                paid = true;
            }
        }
        if !paid && cost.get_generic_mana_amount() > 0 {
            cost.decrease_generic_mana(1);
            paid = true;
        }
        if !paid {
            continue;
        }
        if creatures && !artifacts {
            sa.add_tapped_for_convoke(cid);
        }
        if !test {
            game.tap(cid);
        }
        reduced += 1;
    }
}

fn mana_from_cost(cost: &Cost) -> ManaCost {
    cost.parts
        .iter()
        .filter_map(|part| match part {
            crate::cost::CostPart::Mana { cost, .. } => Some(cost.clone()),
            _ => None,
        })
        .fold(ManaCost::generic(0), |acc, mana| acc.add(&mana))
}

pub fn commit_offerings_and_emerge(
    game: &mut GameState,
    agents: &mut [Box<dyn PlayerAgent>],
    trigger_handler: &mut TriggerHandler,
    sa: &mut SpellAbility,
) {
    let to_sacrifice: Vec<_> = [sa.sacrificed_as_offering, sa.sacrificed_as_emerge]
        .into_iter()
        .flatten()
        .collect();
    crate::game_loop::perform_sacrifice(game, trigger_handler, agents, &to_sacrifice);
}
