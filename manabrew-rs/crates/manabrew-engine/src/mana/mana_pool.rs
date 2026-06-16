//! ManaPool — floating mana pool for a player.
//!
//! Mirrors Java's `ManaPool.java`.
//! Manages floating mana objects, payment, clearing at phase transitions,
//! and mana restriction checking.

use forge_foundation::mana::ManaAtom;
use forge_foundation::PhaseType;
use serde::{Deserialize, Serialize};

use super::mana_conversion_matrix::ManaConversionMatrix;
use super::mana_cost_being_paid::ManaCostBeingPaid;
use super::{mana_meets_restriction, Mana, ManaPaymentContext};
use crate::ids::CardId;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ManaPaymentOutcome {
    pub life_paid: i32,
    pub colors_spent: u16,
    pub paying_mana: Vec<u16>,
}

fn mana_matches_context(mana: &Mana, ctx: &ManaPaymentContext) -> bool {
    let Some(restriction) = &mana.restriction else {
        return true;
    };

    let effective = if restriction.contains("ChosenType") {
        if let Some(source_card) = mana.source_card {
            if let Some(chosen_type) = ctx.chosen_types_by_source.get(&source_card) {
                restriction.replace("ChosenType", chosen_type)
            } else {
                restriction.clone()
            }
        } else {
            restriction.clone()
        }
    } else {
        restriction.clone()
    };

    mana_meets_restriction(&effective, ctx)
}

/// Tracks available mana for a player during a turn.
/// Uses individual Mana objects to support source tracking, snow, and future restrictions.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ManaPool {
    #[serde(skip)]
    mana: Vec<Mana>,
    #[serde(skip)]
    last_payment_atoms: Vec<u16>,
    #[serde(skip)]
    record_payment_atoms: bool,
    /// `(svar_name, source_card)` pairs from mana spent during the most
    /// recent payment whose source had `TriggersWhenSpent$`. Populated by
    /// `try_pay*` helpers; consumed by cast/activation flows that fire the
    /// linked trigger after the cost resolves (Path of Ancestry's scry,
    /// etc.). Drained on read.
    #[serde(skip)]
    last_payment_triggers_consumed: Vec<(String, CardId)>,
    /// When set, caps total producible mana for playability checks.
    /// Used by `calculate_available_mana` to prevent multi-color sources
    /// (dual lands, Command Tower) from being counted as multiple mana.
    #[serde(skip)]
    pub total_sources: Option<i32>,
    /// Per-source color bitmasks for source-level matching in `can_pay`.
    /// Each entry is a bitmask of ManaAtom colors that one mana source can produce.
    /// Used by `calculate_available_mana` to prevent dual lands from satisfying
    /// multiple colored requirements simultaneously.
    #[serde(skip)]
    pub source_colors: Option<Vec<u16>>,
    /// Mana conversion/restriction matrix controlling what colors can pay for what.
    /// Mirrors Java's `ManaPool` inheriting from `ManaConversionMatrix`.
    #[serde(skip)]
    pub color_matrix: ManaConversionMatrix,
}

impl ManaPool {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn clear_last_payment_atoms(&mut self) {
        self.last_payment_atoms.clear();
    }

    pub fn last_payment_atoms(&self) -> &[u16] {
        &self.last_payment_atoms
    }

    // ── ManaConversionMatrix delegation (Java inheritance parity) ────

    /// Reset the color conversion matrix to identity.
    /// Mirrors Java's `ManaPool.restoreColorReplacements()`.
    pub fn restore_color_replacements(&mut self) {
        self.color_matrix.restore_color_replacements();
    }

    /// Merge another matrix into this pool's matrix.
    /// Mirrors Java's `ManaPool.applyCardMatrix(ManaConversionMatrix)`.
    pub fn apply_card_matrix(&mut self, other: &ManaConversionMatrix) {
        self.color_matrix.apply_card_matrix(other);
    }

    pub fn add(&mut self, atom: u16, amount: i32) {
        for _ in 0..amount {
            self.mana.push(Mana::simple(atom));
        }
    }

    /// Add mana with snow flag set (from a snow permanent source).
    pub fn add_snow(&mut self, atom: u16, amount: i32) {
        for _ in 0..amount {
            let mut m = Mana::simple(atom);
            m.is_snow = true;
            self.mana.push(m);
        }
    }

    /// Add mana with a restriction (from RestrictValid$).
    pub fn add_restricted(&mut self, atom: u16, restriction: String) {
        let mut m = Mana::simple(atom);
        m.restriction = Some(restriction);
        self.mana.push(m);
    }

    /// Count mana in pool that has the "can't be countered" flag.
    pub fn count_uncounterable(&self) -> i32 {
        self.mana.iter().filter(|m| m.adds_no_counter).count() as i32
    }

    /// Collect keywords that should be added to a spell based on consumed mana.
    /// Call this before and after payment to diff.
    pub fn collect_keyword_mana(&self) -> Vec<(String, Option<String>)> {
        self.mana
            .iter()
            .filter_map(|m| {
                m.adds_keywords
                    .as_ref()
                    .map(|kw| (kw.clone(), m.adds_keywords_valid.clone()))
            })
            .collect()
    }

    /// Collect counter specs from mana that should be applied to permanents cast with it.
    pub fn collect_counter_mana(&self) -> Vec<(String, Option<String>)> {
        self.mana
            .iter()
            .filter_map(|m| {
                m.adds_counters
                    .as_ref()
                    .map(|cs| (cs.clone(), m.adds_counters_valid.clone()))
            })
            .collect()
    }

    /// Collect trigger SVars from mana that should fire when spent.
    /// Returns (svar_name, source_card_id) pairs.
    pub fn collect_trigger_mana(&self) -> Vec<(String, CardId)> {
        self.mana
            .iter()
            .filter_map(|m| {
                m.triggers_when_spent
                    .as_ref()
                    .and_then(|svar| m.source_card.map(|src| (svar.clone(), src)))
            })
            .collect()
    }

    /// Get the color of each mana in the pool (for tracking consumed colors).
    pub fn mana_colors(&self) -> Vec<u16> {
        self.mana.iter().map(|m| m.color).collect()
    }

    pub fn mana_entries(&self) -> &[Mana] {
        &self.mana
    }

    /// Get a bitmask of all colors present in the pool.
    pub fn colors_present(&self) -> u16 {
        let mut mask = 0u16;
        for m in &self.mana {
            mask |= m.color;
        }
        mask
    }

    /// Count snow mana in the pool (any color).
    pub fn count_snow(&self) -> i32 {
        self.mana.iter().filter(|m| m.is_snow).count() as i32
    }

    pub fn add_mana(&mut self, m: Mana) {
        self.mana.push(m);
    }

    /// Total floating mana count.
    /// Mirrors Java's `ManaPool.totalMana()`.
    pub fn total_mana(&self) -> i32 {
        self.mana.len() as i32
    }

    pub fn count_color(&self, atom: u16) -> i32 {
        self.mana.iter().filter(|m| m.color == atom).count() as i32
    }

    pub fn white(&self) -> i32 {
        self.count_color(ManaAtom::WHITE)
    }
    pub fn blue(&self) -> i32 {
        self.count_color(ManaAtom::BLUE)
    }
    pub fn black(&self) -> i32 {
        self.count_color(ManaAtom::BLACK)
    }
    pub fn red(&self) -> i32 {
        self.count_color(ManaAtom::RED)
    }
    pub fn green(&self) -> i32 {
        self.count_color(ManaAtom::GREEN)
    }
    pub fn colorless(&self) -> i32 {
        self.count_color(ManaAtom::COLORLESS)
    }

    /// Remove `amount` of a given mana atom from the pool, saturating at 0.
    pub fn remove(&mut self, atom: u16, amount: i32) {
        let mut remaining = amount;
        let mut idx = 0usize;
        while remaining > 0 && idx < self.mana.len() {
            if self.mana[idx].color == atom {
                if self.record_payment_atoms {
                    self.last_payment_atoms.push(atom);
                }
                self.mana.remove(idx);
                remaining -= 1;
            } else {
                idx += 1;
            }
        }
    }

    /// Returns true if the pool contains at least `amount` of the given atom.
    pub fn has_atom(&self, atom: u16, amount: i32) -> bool {
        self.count_color(atom) >= amount
    }

    /// Spend generic mana from the pool, consuming colorless first then any color.
    /// Returns the amount actually spent.
    pub fn spend_generic(&mut self, mut amount: i32) -> i32 {
        let spent = amount.min(self.total_mana());
        // Consume colorless first
        let colorless_count = self.colorless();
        let from_colorless = amount.min(colorless_count);
        self.remove(ManaAtom::COLORLESS, from_colorless);
        amount -= from_colorless;
        // Then consume from colors in WUBRG order
        for &color in &[
            ManaAtom::WHITE,
            ManaAtom::BLUE,
            ManaAtom::BLACK,
            ManaAtom::RED,
            ManaAtom::GREEN,
        ] {
            if amount <= 0 {
                break;
            }
            let available = self.count_color(color);
            let take = amount.min(available);
            self.remove(color, take);
            amount -= take;
        }
        spent
    }

    /// Reset the pool completely (empties all floating mana).
    /// Mirrors Java's `ManaPool.resetPool()`.
    pub fn reset_pool(&mut self) {
        self.mana.clear();
    }

    /// Clear mana pool at phase transitions, retaining persistent and combat mana.
    /// Mirrors Java's PhaseHandler.onPhaseEnd() → clearPool(true) (MTG rule 500.4).
    pub fn clear_pool(&mut self, phase: PhaseType) -> usize {
        self.clear_pool_with_keep(phase, 0)
    }

    /// Clear the mana pool, retaining persistent mana, combat mana (if in combat),
    /// and mana of colors specified by `keep_colors` bitmask (from UnspentMana statics).
    /// Returns the number of mana cleared (for mana burn calculation).
    pub fn clear_pool_with_keep(&mut self, phase: PhaseType, keep_colors: u16) -> usize {
        let before = self.mana.len();
        let in_combat = matches!(
            phase,
            PhaseType::CombatBegin
                | PhaseType::CombatDeclareAttackers
                | PhaseType::CombatDeclareBlockers
                | PhaseType::CombatFirstStrikeDamage
                | PhaseType::CombatDamage
                | PhaseType::CombatEnd
        );
        self.mana.retain(|m| {
            m.is_persistent
                || (m.is_combat_mana && in_combat)
                || (keep_colors != 0 && (m.color & keep_colors) != 0)
        });
        before - self.mana.len()
    }

    /// Try to pay a mana cost. Returns true if successful and deducts the mana.
    /// This is a simplified payment algorithm that handles colored and generic mana.
    pub fn can_pay(&self, cost: &forge_foundation::ManaCost) -> bool {
        // When source_colors is available (from calculate_available_mana), use
        // source-level matching to prevent dual lands from satisfying multiple
        // colored requirements simultaneously.
        if let Some(ref sources) = self.source_colors {
            return Self::can_pay_source_matching(sources, cost, 0);
        }

        // Fallback for non-availability-estimate pools (actual mana during payment)
        if let Some(max) = self.total_sources {
            if cost.cmc() > max {
                return false;
            }
        }

        let mut pool = self.clone();
        pool.try_pay(cost)
    }

    /// Check if the pool can pay a cost with any-color conversion active.
    pub fn can_pay_any_color(&self, cost: &forge_foundation::ManaCost) -> bool {
        if let Some(max) = self.total_sources {
            if cost.cmc() > max {
                return false;
            }
        }
        let mut pool = self.clone();
        pool.try_pay_any_color(cost)
    }

    /// Create a clone with restricted mana filtered out based on context.
    fn filtered_for_context(&self, ctx: &ManaPaymentContext) -> ManaPool {
        let mut pool = self.clone();
        pool.mana.retain(|m| mana_matches_context(m, ctx));
        pool
    }

    /// Check if pool can pay a cost, respecting mana restrictions for the given spell context.
    pub fn can_pay_for_spell(
        &self,
        cost: &forge_foundation::ManaCost,
        ctx: &ManaPaymentContext,
    ) -> bool {
        let filtered = self.filtered_for_context(ctx);
        filtered.can_pay(cost)
    }

    /// Pay a cost, skipping restricted mana that doesn't match the context.
    /// Returns true if successful and deducts the mana from the ORIGINAL pool.
    pub fn try_pay_for_spell(
        &mut self,
        cost: &forge_foundation::ManaCost,
        ctx: &ManaPaymentContext,
    ) -> bool {
        // Temporarily remove ineligible mana, try to pay, then restore unused ones
        let mut ineligible: Vec<Mana> = Vec::new();
        let mut eligible: Vec<Mana> = Vec::new();
        for m in self.mana.drain(..) {
            if !mana_matches_context(&m, ctx) {
                ineligible.push(m);
                continue;
            }
            eligible.push(m);
        }
        self.mana = eligible;
        let result = self.try_pay(cost);
        // Restore ineligible mana
        self.mana.extend(ineligible);
        result
    }

    /// Pay a cost with restriction filtering and optional any-color conversion.
    pub fn try_pay_for_spell_converted(
        &mut self,
        cost: &forge_foundation::ManaCost,
        ctx: &ManaPaymentContext,
        any_color: bool,
    ) -> bool {
        let mut ineligible: Vec<Mana> = Vec::new();
        let mut eligible: Vec<Mana> = Vec::new();
        for m in self.mana.drain(..) {
            if !mana_matches_context(&m, ctx) {
                ineligible.push(m);
                continue;
            }
            eligible.push(m);
        }
        self.mana = eligible;
        let result = if any_color {
            self.try_pay_any_color(cost)
        } else {
            self.try_pay(cost)
        };
        self.mana.extend(ineligible);
        result
    }

    /// Pay a spell cost with restriction filtering and phyrexian-life fallback.
    /// Returns the life that must be paid after mana is deducted, or `None` if
    /// the cost cannot be covered by the current pool plus phyrexian life.
    pub fn try_pay_for_spell_converted_with_phyrexian_life(
        &mut self,
        cost: &forge_foundation::ManaCost,
        ctx: &ManaPaymentContext,
        any_color: bool,
        player_life: i32,
    ) -> Option<i32> {
        self.try_pay_for_spell_converted_with_phyrexian_life_result(
            cost,
            ctx,
            any_color,
            player_life,
        )
        .map(|outcome| outcome.life_paid)
    }

    pub fn try_pay_for_spell_converted_with_phyrexian_life_result(
        &mut self,
        cost: &forge_foundation::ManaCost,
        ctx: &ManaPaymentContext,
        any_color: bool,
        player_life: i32,
    ) -> Option<ManaPaymentOutcome> {
        let mut ineligible: Vec<Mana> = Vec::new();
        let mut eligible: Vec<Mana> = Vec::new();
        for m in self.mana.drain(..) {
            if !mana_matches_context(&m, ctx) {
                ineligible.push(m);
                continue;
            }
            eligible.push(m);
        }
        self.mana = eligible;
        let result = self.try_pay_with_phyrexian_life_result(cost, any_color, player_life);
        self.mana.extend(ineligible);
        result
    }

    /// Spend currently-floating mana against an existing unpaid cost tracker.
    ///
    /// This mirrors Java harness `AutoPay`: after each mana ability resolves,
    /// `ManaPool.payManaFromAbility` / `payManaCostFromPool` immediately remove
    /// usable mana from the pool before the next source is chosen. That matters
    /// when a source overproduces colored mana before a later colorless source.
    pub(crate) fn pay_unpaid_for_spell_incremental(
        &mut self,
        unpaid: &mut ManaCostBeingPaid,
        ctx: &ManaPaymentContext,
        any_color: bool,
    ) -> ManaPaymentOutcome {
        let mut outcome = ManaPaymentOutcome::default();

        loop {
            if unpaid.is_paid() {
                break;
            }

            let mut paid_index: Option<(usize, u16)> = None;
            for &color in &[
                ManaAtom::WHITE,
                ManaAtom::BLUE,
                ManaAtom::BLACK,
                ManaAtom::RED,
                ManaAtom::GREEN,
                ManaAtom::COLORLESS,
            ] {
                let Some(idx) = self
                    .mana
                    .iter()
                    .position(|m| m.color == color && mana_matches_context(m, ctx))
                else {
                    continue;
                };
                let payment_color = if any_color && color != ManaAtom::COLORLESS {
                    ManaAtom::COLORS_SUPERPOSITION
                } else {
                    color
                };
                if unpaid
                    .try_pay_mana(payment_color, payment_color as u8)
                    .is_some()
                {
                    paid_index = Some((idx, color));
                    break;
                }
            }

            let Some((idx, spent_color)) = paid_index else {
                break;
            };
            let mana = self.mana.remove(idx);
            outcome.colors_spent |= spent_color;
            outcome.paying_mana.push(spent_color);
            if let (Some(svar), Some(src)) = (mana.triggers_when_spent, mana.source_card) {
                self.last_payment_triggers_consumed.push((svar, src));
            }
        }

        self.last_payment_atoms = outcome.paying_mana.clone();
        outcome
    }

    /// Pay a mana cost with phyrexian-life fallback and return the life paid.
    /// Used for generic cost payments that don't need spell restriction filtering.
    pub fn try_pay_cost_with_phyrexian_life(
        &mut self,
        cost: &forge_foundation::ManaCost,
        any_color: bool,
        player_life: i32,
    ) -> Option<i32> {
        self.try_pay_with_phyrexian_life_result(cost, any_color, player_life)
            .map(|outcome| outcome.life_paid)
    }

    /// Returns true if the pool can pay `cost` plus `extra_generic` additional generic mana.
    /// Used for commander tax checks.
    pub fn can_pay_with_extra_generic(
        &self,
        cost: &forge_foundation::ManaCost,
        extra_generic: i32,
    ) -> bool {
        if let Some(ref sources) = self.source_colors {
            return Self::can_pay_source_matching(sources, cost, extra_generic);
        }
        // Check total source cap for availability estimates
        if let Some(max) = self.total_sources {
            if cost.cmc() + extra_generic > max {
                return false;
            }
        }
        let mut pool = self.clone();
        if !pool.try_pay(cost) {
            return false;
        }
        pool.total_mana() >= extra_generic
    }

    /// Source-level matching for mana availability checks.
    /// Prevents dual lands from satisfying multiple colored requirements simultaneously.
    /// Each shard becomes one requirement: a source matches if it can produce any of
    /// the shard's colors. Hybrid shards like {B/R} are a single requirement satisfied
    /// by either B or R, matching Java's ComputerUtilMana.canPayManaCost().
    fn can_pay_source_matching(
        sources: &[u16],
        cost: &forge_foundation::ManaCost,
        extra_generic: i32,
    ) -> bool {
        // Build requirements: one per shard, using the shard's full color bitmask.
        // A hybrid {B/R} becomes one requirement with (BLACK | RED) — any source
        // producing B or R can satisfy it. Generic shards are handled separately.
        let mut requirements: Vec<u16> = Vec::new();
        for shard in cost.shards() {
            if shard.is_x() {
                continue;
            }
            let atoms = shard.shard();
            // {C} requires a colorless source — COLORLESS belongs in the mask.
            let color_mask = atoms
                & (ManaAtom::WHITE
                    | ManaAtom::BLUE
                    | ManaAtom::BLACK
                    | ManaAtom::RED
                    | ManaAtom::GREEN
                    | ManaAtom::COLORLESS);
            if color_mask != 0 {
                requirements.push(color_mask);
            }
        }
        let generic_count = cost.generic_cost() + extra_generic;

        // Quick total check
        if (sources.len() as i32) < (requirements.len() as i32) + generic_count {
            return false;
        }

        // Sort requirements by number of matching sources (ascending = most constrained first),
        // then by bitmask value (ascending) for determinism.
        requirements.sort_by(|a, b| {
            let count_a = sources.iter().filter(|&&s| (s & a) != 0).count();
            let count_b = sources.iter().filter(|&&s| (s & b) != 0).count();
            count_a.cmp(&count_b).then_with(|| a.cmp(b))
        });

        // Greedy matching: for each requirement, commit the most constrained source.
        let mut committed = vec![false; sources.len()];
        for req in &requirements {
            let mut best_idx: Option<usize> = None;
            let mut best_pop: u32 = u32::MAX;
            let mut best_mask: u16 = u16::MAX;
            for (i, &src) in sources.iter().enumerate() {
                if committed[i] {
                    continue;
                }
                if (src & req) != 0 {
                    let pop = src.count_ones();
                    if pop < best_pop || (pop == best_pop && src < best_mask) {
                        best_idx = Some(i);
                        best_pop = pop;
                        best_mask = src;
                    }
                }
            }
            match best_idx {
                Some(idx) => committed[idx] = true,
                None => return false,
            }
        }

        let remaining = committed.iter().filter(|&&c| !c).count() as i32;
        remaining >= generic_count
    }

    /// Check if a cost with phyrexian shards can be paid, allowing phyrexian
    /// shards to fall back to life payment (2 life each) when no mana source
    /// is available.
    ///
    /// Matches Java's ComputerUtilMana.payManaCost() greedy simulation:
    /// 1. Try to match phyrexian shards with mana sources (highest priority)
    /// 2. Unmatched phyrexian shards are paid with life
    /// 3. Non-phyrexian colored shards must be matched with remaining sources
    /// 4. Generic cost must be covered by remaining sources
    pub fn can_pay_with_phyrexian_life(
        &self,
        cost: &forge_foundation::ManaCost,
        player_life: i32,
    ) -> bool {
        let sources = match self.source_colors {
            Some(ref s) => s.as_slice(),
            None => {
                let mut pool = self.clone();
                return pool
                    .try_pay_with_phyrexian_life(cost, false, player_life)
                    .is_some();
            }
        };
        use super::mana_cost_being_paid::{can_pay_for_shard_with_color, ManaCostBeingPaid};

        fn search_sources(
            sources: &[u16],
            source_index: usize,
            unpaid: ManaCostBeingPaid,
            reserved_generic: i32,
            player_life: i32,
        ) -> bool {
            if source_index >= sources.len() {
                let mut remaining_unpaid = unpaid;
                let mut life_needed = 0;
                while remaining_unpaid.contains_phyrexian_mana() {
                    if player_life < life_needed + 2 {
                        return false;
                    }
                    if !remaining_unpaid.pay_phyrexian() {
                        break;
                    }
                    life_needed += 2;
                }

                let remaining_cost = remaining_unpaid.to_mana_cost();
                let has_non_generic = remaining_cost.shards().iter().any(|shard| {
                    !shard.is_x()
                        && !shard.is_phyrexian()
                        && !matches!(shard, forge_foundation::ManaCostShard::Generic)
                });
                !has_non_generic && reserved_generic >= remaining_cost.generic_cost()
            } else {
                if search_sources(
                    sources,
                    source_index + 1,
                    unpaid.clone(),
                    reserved_generic + 1,
                    player_life,
                ) {
                    return true;
                }

                let source_mask = sources[source_index];
                for payment_color in [
                    ManaAtom::WHITE,
                    ManaAtom::BLUE,
                    ManaAtom::BLACK,
                    ManaAtom::RED,
                    ManaAtom::GREEN,
                    ManaAtom::COLORLESS,
                ] {
                    if payment_color != ManaAtom::COLORLESS && (source_mask & payment_color) == 0 {
                        continue;
                    }
                    if payment_color == ManaAtom::COLORLESS && source_mask != 0 {
                        continue;
                    }

                    for shard in unpaid.get_distinct_shards().into_iter().filter(|&shard| {
                        shard != forge_foundation::ManaCostShard::Generic
                            && can_pay_for_shard_with_color(shard, payment_color)
                    }) {
                        let mut next_unpaid = unpaid.clone();
                        if next_unpaid
                            .pay_specific_shard(shard, payment_color)
                            .is_none()
                        {
                            continue;
                        }
                        if search_sources(
                            sources,
                            source_index + 1,
                            next_unpaid,
                            reserved_generic,
                            player_life,
                        ) {
                            return true;
                        }
                    }
                }

                false
            }
        }

        search_sources(
            sources,
            0,
            super::mana_cost_being_paid::ManaCostBeingPaid::from_mana_cost(cost),
            0,
            player_life,
        )
    }

    /// Pay `extra_generic` additional generic mana from the pool.
    /// Returns true if successful.
    pub fn try_pay_extra_generic(&mut self, extra_generic: i32) -> bool {
        if self.total_mana() < extra_generic {
            return false;
        }
        self.pay_generic(extra_generic);
        true
    }

    /// Try to pay a mana cost, deducting from the pool. Returns true if successful.
    pub fn try_pay(&mut self, cost: &forge_foundation::ManaCost) -> bool {
        self.last_payment_atoms.clear();
        self.record_payment_atoms = true;
        // First, pay colored shards
        for shard in cost.shards() {
            if shard.is_x() {
                continue; // X shards are pre-resolved into generic mana before payment
            }

            let atoms = shard.shard();

            // Snow shard ({S}) — pay with any snow mana
            if shard.is_snow() {
                if let Some(idx) = self.mana.iter().position(|m| m.is_snow) {
                    if self.record_payment_atoms {
                        self.last_payment_atoms.push(self.mana[idx].color);
                    }
                    self.mana.remove(idx);
                    continue;
                } else {
                    self.record_payment_atoms = false;
                    return false;
                }
            }

            // Pure color shards
            if shard.is_mono_color() && !shard.is_phyrexian() && !shard.is_or_2_generic() {
                let paid = self.pay_color(atoms);
                if !paid {
                    return false;
                }
            } else if shard.is_or_2_generic() {
                // Can pay with the color or 2 generic
                let color_atoms = atoms & ManaAtom::COLORS_SUPERPOSITION;
                if !self.pay_color(color_atoms) {
                    // Try paying 2 generic instead
                    if self.total_mana() < 2 {
                        self.record_payment_atoms = false;
                        return false;
                    }
                    self.pay_generic(2);
                }
            } else if shard.is_multi_color() && !shard.is_phyrexian() {
                // Hybrid mana — try each color
                let color_atoms = atoms & ManaAtom::COLORS_SUPERPOSITION;
                let mut paid = false;
                for &bit in &[
                    ManaAtom::WHITE,
                    ManaAtom::BLUE,
                    ManaAtom::BLACK,
                    ManaAtom::RED,
                    ManaAtom::GREEN,
                ] {
                    if (color_atoms & bit) != 0 && self.count_color(bit) > 0 {
                        self.pay_color(bit);
                        paid = true;
                        break;
                    }
                }
                if !paid {
                    self.record_payment_atoms = false;
                    return false;
                }
            } else if shard.is_colorless() && !shard.is_multi_color() {
                // Pure colorless (C)
                if self.colorless() > 0 {
                    self.remove(ManaAtom::COLORLESS, 1);
                } else {
                    self.record_payment_atoms = false;
                    return false;
                }
            } else if shard.is_phyrexian() {
                // Phyrexian: pay with color or 2 life (life handled at play_card level).
                // For can_pay checks: assume color can be paid if available, otherwise
                // treat as payable (life payment will be resolved at cast time).
                let color_atoms = atoms & ManaAtom::COLORS_SUPERPOSITION;
                if !self.pay_color(color_atoms) {
                    // Color not available — life payment assumed possible at cast time.
                    // Don't fail here; play_card will verify life total.
                }
            }
        }

        // Then pay generic cost
        let generic = cost.generic_cost();
        if generic > 0 {
            if self.total_mana() < generic {
                self.record_payment_atoms = false;
                return false;
            }
            self.pay_generic(generic);
        }

        self.record_payment_atoms = false;
        true
    }

    /// Try to pay a mana cost with any-color conversion active.
    /// All colored mana can pay for any colored shard.
    pub fn try_pay_any_color(&mut self, cost: &forge_foundation::ManaCost) -> bool {
        self.last_payment_atoms.clear();
        self.record_payment_atoms = true;
        for shard in cost.shards() {
            if shard.is_x() {
                continue;
            }
            let atoms = shard.shard();
            if shard.is_snow() {
                if let Some(idx) = self.mana.iter().position(|m| m.is_snow) {
                    if self.record_payment_atoms {
                        self.last_payment_atoms.push(self.mana[idx].color);
                    }
                    self.mana.remove(idx);
                    continue;
                } else {
                    self.record_payment_atoms = false;
                    return false;
                }
            }
            if shard.is_colorless() && !shard.is_multi_color() {
                // Pure colorless (C) — must be paid with colorless
                if self.colorless() > 0 {
                    self.remove(ManaAtom::COLORLESS, 1);
                } else {
                    self.record_payment_atoms = false;
                    return false;
                }
            } else if shard.is_phyrexian() {
                // Phyrexian: any color can pay (with conversion active, even easier)
                let color_atoms = atoms & ManaAtom::COLORS_SUPERPOSITION;
                if color_atoms != 0 {
                    // Try to pay with any colored mana
                    if !self.pay_any_colored() {
                        // Life payment assumed possible
                    }
                }
            } else if shard.is_mono_color() || shard.is_multi_color() || shard.is_or_2_generic() {
                // With any-color conversion, any colored mana can pay any colored shard
                if !self.pay_any_colored() {
                    self.record_payment_atoms = false;
                    return false;
                }
            }
        }
        let generic = cost.generic_cost();
        if generic > 0 {
            if self.total_mana() < generic {
                self.record_payment_atoms = false;
                return false;
            }
            self.pay_generic(generic);
        }
        self.record_payment_atoms = false;
        true
    }

    /// Pay one mana of any color from the pool.
    fn pay_any_colored(&mut self) -> bool {
        for &color in &[
            ManaAtom::WHITE,
            ManaAtom::BLUE,
            ManaAtom::BLACK,
            ManaAtom::RED,
            ManaAtom::GREEN,
            ManaAtom::COLORLESS,
        ] {
            if self.count_color(color) > 0 {
                self.remove(color, 1);
                return true;
            }
        }
        false
    }

    pub fn pay_color(&mut self, atoms: u16) -> bool {
        for &color in &[
            ManaAtom::WHITE,
            ManaAtom::BLUE,
            ManaAtom::BLACK,
            ManaAtom::RED,
            ManaAtom::GREEN,
        ] {
            if (atoms & color) != 0 && self.count_color(color) > 0 {
                self.remove(color, 1);
                return true;
            }
        }
        false
    }

    pub fn pay_generic(&mut self, mut amount: i32) {
        // Pay with colorless first, then colors (WUBRG order)
        for &color in &[
            ManaAtom::COLORLESS,
            ManaAtom::WHITE,
            ManaAtom::BLUE,
            ManaAtom::BLACK,
            ManaAtom::RED,
            ManaAtom::GREEN,
        ] {
            if amount <= 0 {
                break;
            }
            let available = self.count_color(color);
            let take = amount.min(available);
            self.remove(color, take);
            amount -= take;
        }
    }

    // ── Java parity methods (ManaPool.java) ────────────────────────

    /// Whether floating mana will be lost at end of phase.
    /// Mirrors Java's `ManaPool.willManaBeLostAtEndOfPhase()`.
    pub fn will_mana_be_lost_at_end_of_phase(&self) -> bool {
        !self.mana.is_empty()
    }

    /// Whether the game has mana burn rules active.
    /// Mirrors Java's `ManaPool.hasBurn()`.
    pub fn has_burn(&self) -> bool {
        false // Mana burn removed in modern rules
    }

    /// Remove a specific Mana object from the pool.
    /// Mirrors Java's `ManaPool.removeMana(Mana)`.
    pub fn remove_mana(&mut self, mana: &Mana) -> bool {
        if let Some(pos) = self
            .mana
            .iter()
            .position(|m| m.color == mana.color && m.source_card == mana.source_card)
        {
            self.mana.remove(pos);
            true
        } else {
            false
        }
    }

    /// Pay mana cost using mana produced by a mana ability.
    /// Mirrors Java's `ManaPool.payManaFromAbility()`.
    pub fn pay_mana_from_ability(&mut self, produced_color: u16, amount: i32) {
        for _ in 0..amount {
            self.add(produced_color, 1);
        }
    }

    /// Try to pay a cost shard using floating mana of a specific color.
    /// Mirrors Java's `ManaPool.tryPayCostWithColor()`.
    pub fn try_pay_cost_with_color(&mut self, color: u16) -> bool {
        if self.count_color(color) > 0 {
            self.remove(color, 1);
            true
        } else {
            false
        }
    }

    /// Try to pay with a specific Mana object.
    /// Mirrors Java's `ManaPool.tryPayCostWithMana()`.
    pub fn try_pay_cost_with_mana(&mut self, mana: &Mana) -> bool {
        self.remove_mana(mana)
    }

    /// Account for mana produced by a mana ability (verify it's in the pool).
    /// Mirrors Java's `ManaPool.accountFor()`.
    pub fn account_for(&self, color: u16) -> bool {
        self.count_color(color) > 0
    }

    /// Refund mana back to the pool.
    /// Mirrors Java's `ManaPool.refundMana()`.
    pub fn refund_mana(&mut self, mana_spent: &mut Vec<Mana>) {
        for m in mana_spent.drain(..) {
            self.add_mana(m);
        }
    }

    /// Check if a mana cost shard can be paid by a given color.
    /// Mirrors Java's `ManaPool.canPayForShardWithColor()`.
    pub fn can_pay_for_shard_with_color(&self, shard_color: u16, pay_color: u16) -> bool {
        if shard_color == 0 {
            return true;
        }
        (shard_color & pay_color) != 0
    }

    /// Pay an entire mana cost from floating mana.
    /// Mirrors Java's `ManaPool.payManaCostFromPool()`.
    pub fn pay_mana_cost_from_pool(&mut self, cost: &forge_foundation::ManaCost) -> bool {
        self.try_pay(cost)
    }

    fn try_pay_with_phyrexian_life(
        &mut self,
        cost: &forge_foundation::ManaCost,
        any_color: bool,
        player_life: i32,
    ) -> Option<i32> {
        self.try_pay_with_phyrexian_life_result(cost, any_color, player_life)
            .map(|outcome| outcome.life_paid)
    }

    fn try_pay_with_phyrexian_life_result(
        &mut self,
        cost: &forge_foundation::ManaCost,
        any_color: bool,
        player_life: i32,
    ) -> Option<ManaPaymentOutcome> {
        use super::mana_cost_being_paid::ManaCostBeingPaid;
        self.last_payment_atoms.clear();
        self.record_payment_atoms = true;
        let unpaid = ManaCostBeingPaid::from_mana_cost(cost);
        let mut best: Option<(i32, Vec<usize>)> = None;
        self.search_phyrexian_payment(
            0,
            unpaid,
            any_color,
            player_life,
            &mut Vec::new(),
            &mut best,
        );

        let Some((life_to_pay, spent_indices)) = best else {
            self.record_payment_atoms = false;
            return None;
        };
        let mut colors_spent = 0u16;
        let mut paying_mana = Vec::new();
        let mut triggers_consumed: Vec<(String, CardId)> = Vec::new();
        for &idx in &spent_indices {
            colors_spent |= self.mana[idx].color;
            paying_mana.push(self.mana[idx].color);
            if let (Some(svar), Some(src)) = (
                self.mana[idx].triggers_when_spent.as_ref(),
                self.mana[idx].source_card,
            ) {
                triggers_consumed.push((svar.clone(), src));
            }
        }
        for idx in spent_indices.into_iter().rev() {
            self.mana.remove(idx);
        }
        self.last_payment_atoms = paying_mana.clone();
        self.last_payment_triggers_consumed = triggers_consumed;
        self.record_payment_atoms = false;
        Some(ManaPaymentOutcome {
            life_paid: life_to_pay,
            colors_spent,
            paying_mana,
        })
    }

    /// Drain and return the trigger metadata recorded by the most recent
    /// `try_pay*` call that consumed mana whose source set
    /// `TriggersWhenSpent$`.
    pub fn take_last_payment_triggers_consumed(&mut self) -> Vec<(String, CardId)> {
        std::mem::take(&mut self.last_payment_triggers_consumed)
    }

    fn search_phyrexian_payment(
        &self,
        mana_index: usize,
        unpaid: super::mana_cost_being_paid::ManaCostBeingPaid,
        any_color: bool,
        player_life: i32,
        chosen_indices: &mut Vec<usize>,
        best: &mut Option<(i32, Vec<usize>)>,
    ) {
        use super::mana_cost_being_paid::{can_pay_for_shard_with_color, ManaCostBeingPaid};
        use forge_foundation::ManaCostShard;

        if matches!(best, Some((0, _))) {
            return;
        }

        if mana_index >= self.mana.len() {
            let mut remaining_unpaid = unpaid;
            let mut life_to_pay = 0;
            while remaining_unpaid.contains_phyrexian_mana() {
                if player_life < life_to_pay + 2 {
                    return;
                }
                if !remaining_unpaid.pay_phyrexian() {
                    break;
                }
                life_to_pay += 2;
            }

            let mut remaining_pool = ManaPool::new();
            let mut remaining_indices: Vec<usize> = Vec::new();
            for (idx, mana) in self.mana.iter().enumerate() {
                if !chosen_indices.contains(&idx) {
                    remaining_indices.push(idx);
                    remaining_pool.mana.push(mana.clone());
                }
            }

            let remaining_cost = remaining_unpaid.to_mana_cost();
            let can_finish = if any_color {
                remaining_pool.try_pay_any_color(&remaining_cost)
            } else {
                remaining_pool.try_pay(&remaining_cost)
            };
            if !can_finish {
                return;
            }

            let mut kept = vec![false; remaining_indices.len()];
            for leftover in remaining_pool.mana_entries() {
                if let Some(pos) = remaining_indices.iter().enumerate().find_map(|(pos, _)| {
                    if kept[pos] {
                        return None;
                    }
                    (self.mana[remaining_indices[pos]] == *leftover).then_some(pos)
                }) {
                    kept[pos] = true;
                }
            }

            let mut spent = chosen_indices.clone();
            for (pos, &idx) in remaining_indices.iter().enumerate() {
                if !kept[pos] {
                    spent.push(idx);
                }
            }
            spent.sort_unstable();

            match best {
                Some((best_life, _)) if *best_life <= life_to_pay => {}
                _ => *best = Some((life_to_pay, spent)),
            }
            return;
        }

        self.search_phyrexian_payment(
            mana_index + 1,
            unpaid.clone(),
            any_color,
            player_life,
            chosen_indices,
            best,
        );

        let mana = &self.mana[mana_index];
        let payment_color = if any_color && mana.color != ManaAtom::COLORLESS {
            ManaAtom::COLORS_SUPERPOSITION
        } else {
            mana.color
        };
        let payable_shards: Vec<ManaCostShard> = unpaid
            .get_distinct_shards()
            .into_iter()
            .filter(|&shard| shard != ManaCostShard::Generic)
            .filter(|&shard| can_pay_for_shard_with_color(shard, payment_color))
            .collect();

        for shard in payable_shards {
            let mut next_unpaid: ManaCostBeingPaid = unpaid.clone();
            if next_unpaid
                .pay_specific_shard(shard, payment_color)
                .is_none()
            {
                continue;
            }
            chosen_indices.push(mana_index);
            self.search_phyrexian_payment(
                mana_index + 1,
                next_unpaid,
                any_color,
                player_life,
                chosen_indices,
                best,
            );
            chosen_indices.pop();
        }
    }

    /// Pay a non-spell cost with phyrexian-life fallback.
    /// Unlike `try_pay_for_spell_converted_with_phyrexian_life`, this does not
    /// filter mana by spell restriction context first.
    pub fn try_pay_with_phyrexian_life_unrestricted(
        &mut self,
        cost: &forge_foundation::ManaCost,
        player_life: i32,
    ) -> Option<i32> {
        self.try_pay_with_phyrexian_life_result(cost, false, player_life)
            .map(|outcome| outcome.life_paid)
    }

    /// Iterator over all floating mana.
    /// Mirrors Java's `ManaPool.iterator()`.
    pub fn iterator(&self) -> impl Iterator<Item = &Mana> {
        self.mana.iter()
    }

    // ── Tap tracking for mana rollback ─────────────────────────────

    /// Snapshot the pool state before a land tap. Call this BEFORE producing mana.
    /// Returns a snapshot (list of mana colors) that `end_tap_tracking` will diff against.
    pub fn begin_tap_tracking(&self) -> Vec<u16> {
        self.mana_colors()
    }

    /// Compute what mana was produced since `begin_tap_tracking` was called.
    /// Returns the list of mana atoms that were added to the pool.
    pub fn end_tap_tracking(&self, pool_before: &[u16]) -> Vec<u16> {
        let pool_after = self.mana_colors();
        let mut produced = pool_after;
        for &atom in pool_before {
            if let Some(pos) = produced.iter().position(|&a| a == atom) {
                produced.remove(pos);
            }
        }
        produced
    }

    /// Remove the exact mana that was produced by a previous tap.
    /// Used for mana rollback (untap) — removes ALL mana from that tap,
    /// including base production, aura triggers, static doublers, etc.
    pub fn rollback_tap(&mut self, produced: &[u16]) {
        for &atom in produced {
            self.remove(atom, 1);
        }
    }

    // ── Mana production (extracted from game_loop/game_action.rs) ────

    /// Produce mana from a mana string (e.g. "W", "U U", "R G") and add to pool.
    /// Handles source tracking, snow, restrictions, keywords, counters, triggers.
    /// This is the core mana production logic — the single source of truth.
    ///
    /// Call this from game_action.rs::resolve_mana_ability after determining
    /// what mana string to produce.
    pub fn produce_mana_from_string(
        &mut self,
        mana_string: &str,
        source_card: Option<CardId>,
        is_snow: bool,
        restriction: Option<String>,
        adds_no_counter: bool,
        adds_keywords: Option<String>,
        adds_keywords_valid: Option<String>,
        adds_counters: Option<String>,
        adds_counters_valid: Option<String>,
        triggers_when_spent: Option<String>,
    ) {
        for tok in mana_string.split_whitespace() {
            if let Some(atom) = super::mana_atom_from_produced(tok) {
                let mut m = Mana::simple(atom);
                m.source_card = source_card;
                m.is_snow = is_snow;
                m.restriction = restriction.clone();
                m.adds_no_counter = adds_no_counter;
                m.adds_keywords = adds_keywords.clone();
                m.adds_keywords_valid = adds_keywords_valid.clone();
                m.adds_counters = adds_counters.clone();
                m.adds_counters_valid = adds_counters_valid.clone();
                m.triggers_when_spent = triggers_when_spent.clone();
                self.add_mana(m);
            }
        }
    }

    /// Convert a ManaAtom to its short letter string.
    pub fn atom_to_letter(atom: u16) -> &'static str {
        match atom {
            ManaAtom::WHITE => "W",
            ManaAtom::BLUE => "U",
            ManaAtom::BLACK => "B",
            ManaAtom::RED => "R",
            ManaAtom::GREEN => "G",
            ManaAtom::COLORLESS => "C",
            _ => "C",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use forge_foundation::ManaCost;

    #[test]
    fn phyrexian_payment_reserves_mana_for_generic_costs() {
        let mut pool = ManaPool::new();
        pool.add(ManaAtom::BLUE, 4);

        let life_paid =
            pool.try_pay_cost_with_phyrexian_life(&ManaCost::parse("4 BP BP BP"), false, 20);

        assert_eq!(life_paid, Some(6));
        assert_eq!(pool.total_mana(), 0);
    }

    #[test]
    fn phyrexian_payment_uses_matching_mana_before_life_when_possible() {
        let mut pool = ManaPool::new();
        pool.add(ManaAtom::BLUE, 4);
        pool.add(ManaAtom::BLACK, 1);

        let life_paid =
            pool.try_pay_cost_with_phyrexian_life(&ManaCost::parse("4 BP BP BP"), false, 20);

        assert_eq!(life_paid, Some(4));
        assert_eq!(pool.total_mana(), 0);
    }

    #[test]
    fn phyrexian_castability_allows_generic_plus_life_with_off_color_sources() {
        let mut pool = ManaPool::new();
        pool.source_colors = Some(vec![ManaAtom::GREEN, ManaAtom::RED]);
        pool.total_sources = Some(2);

        assert!(pool.can_pay_with_phyrexian_life(&ManaCost::parse("1 BP BP"), 20));
    }

    #[test]
    fn phyrexian_payment_charges_life_when_generic_uses_off_color_mana() {
        let mut pool = ManaPool::new();
        pool.add(ManaAtom::RED, 1);

        let life_paid =
            pool.try_pay_cost_with_phyrexian_life(&ManaCost::parse("1 BP BP"), false, 20);

        assert_eq!(life_paid, Some(4));
        assert_eq!(pool.total_mana(), 0);
    }
}
