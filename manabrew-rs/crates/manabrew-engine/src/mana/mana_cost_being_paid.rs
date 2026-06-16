use forge_foundation::mana::ManaAtom;
use forge_foundation::ManaCost;
use forge_foundation::ManaCostShard;
use std::collections::BTreeMap;

use super::Mana;

#[derive(Debug, Clone, Default)]
struct ShardCount {
    total_count: i32,
    /// How many of these shards are the X portion (for xManaCostPaidByColor tracking).
    x_count: i32,
}

/// Rust mirror of Java `forge.game.mana.ManaCostBeingPaid`.
#[derive(Debug, Clone, Default)]
pub struct ManaCostBeingPaid {
    unpaid_shards: BTreeMap<ManaCostShard, ShardCount>,
    /// Tracks which colors were used to pay X costs (for colored X restrictions).
    /// Maps color short string ("W","U","B","R","G") to count paid.
    pub x_mana_cost_paid_by_color: BTreeMap<String, i32>,
    /// Bitmask of all colors paid (for Sunburst/Converge).
    pub sunburst_map: u16,
    /// Number of X shards in the original cost.
    cnt_x: i32,
    /// Iterator state for `next` / `has_next`.
    iter_keys: Option<Vec<ManaCostShard>>,
    iter_pos: usize,
    iter_remaining: i32,
    iter_sent_x: bool,
}

impl ManaCostBeingPaid {
    pub fn from_mana_cost(cost: &ManaCost) -> Self {
        let mut out = Self::default();
        for &shard in cost.shards() {
            if shard.is_x() {
                out.cnt_x += 1;
                continue;
            }
            out.increase_shard(shard, 1);
        }
        out.increase_generic_mana(cost.generic_cost());
        out
    }

    /// Set the X mana payment — converts X shards into concrete shards.
    /// Mirrors Java `ManaCostBeingPaid.setXManaCostPaid()`.
    pub fn set_x_mana_cost_paid(&mut self, x_paid: i32, x_color: &str) {
        let x_cost = x_paid * self.cnt_x;
        self.cnt_x = 0;
        let shard = match x_color {
            "W" => ManaCostShard::White,
            "U" => ManaCostShard::Blue,
            "B" => ManaCostShard::Black,
            "R" => ManaCostShard::Red,
            "G" => ManaCostShard::Green,
            "C" => ManaCostShard::Colorless,
            _ => ManaCostShard::Generic,
        };
        self.increase_shard_with_x(shard, x_cost);
    }

    fn increase_shard_with_x(&mut self, shard: ManaCostShard, amount: i32) {
        if amount <= 0 {
            return;
        }
        let entry = self.unpaid_shards.entry(shard).or_default();
        entry.total_count += amount;
        entry.x_count += amount;
    }

    pub fn is_paid(&self) -> bool {
        self.unpaid_shards.is_empty()
    }

    pub fn get_distinct_shards(&self) -> Vec<ManaCostShard> {
        self.unpaid_shards.keys().copied().collect()
    }

    pub fn get_unpaid_shards(&self, shard: ManaCostShard) -> i32 {
        self.unpaid_shards
            .get(&shard)
            .map(|s| s.total_count)
            .unwrap_or(0)
    }

    pub fn get_generic_mana_amount(&self) -> i32 {
        self.get_unpaid_shards(ManaCostShard::Generic)
    }

    /// Whether any unpaid shard has the given kind bitmask.
    /// Mirrors Java's `ManaCostBeingPaid.hasAnyKind()`.
    pub fn has_any_kind(&self, kind: u16) -> bool {
        self.unpaid_shards
            .iter()
            .any(|(shard, count)| (shard.shard() & kind) != 0 && count.total_count > 0)
    }

    /// Increase the generic mana amount.
    /// Mirrors Java's `ManaCostBeingPaid.increaseGenericMana()`.
    pub fn increase_generic_mana(&mut self, amount: i32) {
        self.increase_shard(ManaCostShard::Generic, amount);
    }

    /// Increase the count of a specific shard.
    /// Mirrors Java's `ManaCostBeingPaid.increaseShard()`.
    pub fn increase_shard(&mut self, shard: ManaCostShard, amount: i32) {
        if amount <= 0 {
            return;
        }
        let entry = self.unpaid_shards.entry(shard).or_default();
        entry.total_count += amount;
    }

    /// Decrease the count of a specific shard. Falls back to compatible shards
    /// when the exact shard is absent (Java parity).
    /// Mirrors Java's `ManaCostBeingPaid.decreaseShard()`.
    pub fn decrease_shard(&mut self, shard: ManaCostShard, amount: i32) {
        if amount <= 0 {
            return;
        }

        if let Some(entry) = self.unpaid_shards.get_mut(&shard) {
            entry.total_count -= amount;
            if entry.total_count <= 0 {
                self.unpaid_shards.remove(&shard);
            }
            return;
        }

        // Java behavior: if mono-color shard is requested but absent, consume compatible
        // hybrid/phyrexian/colorless-hybrid shards before generic.
        if !shard.is_mono_color() && shard != ManaCostShard::Generic {
            return;
        }

        let mut remaining = amount;

        if shard.is_mono_color() {
            let color_mask = shard.shard() & ManaAtom::COLORS_SUPERPOSITION;
            let compatible: Vec<ManaCostShard> = self
                .unpaid_shards
                .keys()
                .copied()
                .filter(|s| {
                    (s.shard() & color_mask) != 0
                        && (s.is_multi_color()
                            || s.is_or_2_generic()
                            || s.is_colorless()
                            || s.is_phyrexian())
                })
                .collect();

            for s in compatible {
                if remaining <= 0 {
                    break;
                }
                let current = self.get_unpaid_shards(s);
                let take = current.min(remaining);
                if take > 0 {
                    self.decrease_shard(s, take);
                    remaining -= take;
                }
            }
        }

        if remaining > 0 {
            let generic = self.get_unpaid_shards(ManaCostShard::Generic);
            let take = generic.min(remaining);
            if take > 0 {
                self.decrease_shard(ManaCostShard::Generic, take);
            }
        }
    }

    /// Decrease generic mana by the given amount.
    /// Mirrors Java's `ManaCostBeingPaid.decreaseGenericMana()`.
    pub fn decrease_generic_mana(&mut self, amount: i32) {
        self.decrease_shard(ManaCostShard::Generic, amount);
    }

    pub fn get_shard_to_pay_by_priority(
        &self,
        payable_shards: &[ManaCostShard],
        possible_uses: u8,
    ) -> Option<ManaCostShard> {
        let mut choice: Option<ManaCostShard> = None;
        let mut priority = i32::MIN;

        for &to_pay in payable_shards {
            let p = get_pay_priority(to_pay, possible_uses);
            if p > priority {
                priority = p;
                choice = Some(to_pay);
            }
        }

        choice
    }

    pub fn try_pay_mana(&mut self, color_mask: u16, possible_uses: u8) -> Option<ManaCostShard> {
        let payable: Vec<ManaCostShard> = self
            .get_distinct_shards()
            .into_iter()
            .filter(|&s| can_pay_for_shard_with_color(s, color_mask))
            .collect();

        let chosen = self.get_shard_to_pay_by_priority(&payable, possible_uses)?;

        // Track X color payment before decreasing
        if let Some(sc) = self.unpaid_shards.get_mut(&chosen) {
            if sc.x_count > 0 {
                sc.x_count -= 1;
                let color_str = color_mask_to_short(color_mask);
                if !color_str.is_empty() {
                    *self.x_mana_cost_paid_by_color.entry(color_str).or_insert(0) += 1;
                }
            }
        }

        self.decrease_shard(chosen, 1);

        // Java behavior for 2/C: if paid using the generic route, add 1 generic back.
        if chosen.is_or_2_generic() && (chosen.color_mask() & possible_uses) == 0 {
            self.increase_generic_mana(1);
        }

        // Track sunburst
        self.sunburst_map |= color_mask;

        Some(chosen)
    }

    // ── Iterator methods (mirrors Java ManaCostBeingPaidIterator) ────────

    /// Remove the current shard from the iterator (Java Iterator.remove()).
    /// Mirrors Java's `ManaCostBeingPaidIterator.remove()` which is unsupported;
    /// here we simply decrement the current shard by 1.
    pub fn remove(&mut self) {
        // Java throws UnsupportedOperationException. In Rust we provide a
        // useful implementation: remove one instance of the last-yielded shard.
        if let Some(ref keys) = self.iter_keys {
            if self.iter_pos > 0 && self.iter_pos <= keys.len() {
                let shard = keys[self.iter_pos - 1];
                self.decrease_shard(shard, 1);
            }
        }
    }

    /// Return the next unpaid shard in iteration order.
    /// Mirrors Java's `ManaCostBeingPaidIterator.next()`.
    #[allow(clippy::should_implement_trait)]
    pub fn next(&mut self) -> Option<ManaCostShard> {
        if !self.has_next() {
            return None;
        }
        self.iter_remaining -= 1;
        let keys = self.iter_keys.as_ref()?;
        if self.iter_pos == 0 && !self.iter_sent_x {
            // Yielding X shard
            return Some(ManaCostShard::X);
        }
        if self.iter_pos > 0 && self.iter_pos <= keys.len() {
            return Some(keys[self.iter_pos - 1]);
        }
        None
    }

    /// Whether there are more unpaid shards to iterate.
    /// Mirrors Java's `ManaCostBeingPaidIterator.hasNext()`.
    pub fn has_next(&mut self) -> bool {
        // Initialize iterator on first call
        if self.iter_keys.is_none() {
            let keys: Vec<ManaCostShard> = self
                .unpaid_shards
                .keys()
                .copied()
                .filter(|s| *s != ManaCostShard::Generic)
                .collect();
            self.iter_keys = Some(keys);
            self.iter_pos = 0;
            self.iter_remaining = 0;
            self.iter_sent_x = false;
        }

        if self.iter_remaining > 0 {
            return true;
        }

        // Emit X shards first (Java parity)
        if !self.iter_sent_x && self.cnt_x > 0 {
            self.iter_sent_x = true;
            self.iter_remaining = self.cnt_x;
            return true;
        }
        self.iter_sent_x = true;

        let keys = self.iter_keys.as_ref().unwrap();
        while self.iter_pos < keys.len() {
            let shard = keys[self.iter_pos];
            self.iter_pos += 1;
            if let Some(sc) = self.unpaid_shards.get(&shard) {
                if sc.total_count > 0 {
                    self.iter_remaining = sc.total_count;
                    return true;
                }
            }
        }

        false
    }

    /// Whether any unpaid shard is phyrexian.
    /// Mirrors Java's `ManaCostBeingPaid.containsPhyrexianMana()`.
    pub fn contains_phyrexian_mana(&self) -> bool {
        self.unpaid_shards.keys().any(|s| s.is_phyrexian())
    }

    /// Whether ALL unpaid shards are phyrexian.
    /// Mirrors Java's `ManaCostBeingPaid.containsOnlyPhyrexianMana()`.
    pub fn contains_only_phyrexian_mana(&self) -> bool {
        !self.unpaid_shards.is_empty() && self.unpaid_shards.keys().all(|s| s.is_phyrexian())
    }

    /// Pay one phyrexian shard by removing it (the 2-life payment is handled externally).
    /// Mirrors Java's `ManaCostBeingPaid.payPhyrexian()`.
    pub fn pay_phyrexian(&mut self) -> bool {
        let phy = self
            .unpaid_shards
            .keys()
            .find(|s| s.is_phyrexian())
            .copied();
        match phy {
            Some(shard) => {
                self.decrease_shard(shard, 1);
                true
            }
            None => false,
        }
    }

    /// Check if a specific color is needed to pay remaining shards.
    /// Mirrors Java's `ManaCostBeingPaid.needsColor()`.
    pub fn needs_color(&self, color_mask: u16) -> bool {
        for shard in self.unpaid_shards.keys() {
            if *shard == ManaCostShard::Generic {
                continue;
            }
            if shard.is_or_2_generic() {
                if (shard.color_mask() as u16 & color_mask) != 0 {
                    return true;
                }
            } else if can_pay_for_shard_with_color(*shard, color_mask) {
                return true;
            }
        }
        false
    }

    /// AI mana payment — pay a shard using the given color name.
    /// Mirrors Java's `ManaCostBeingPaid.ai_payMana()`.
    pub fn ai_pay_mana(&mut self, color_mask: u16, possible_uses: u8) -> Option<ManaCostShard> {
        self.try_pay_mana(color_mask, possible_uses)
    }

    /// Pay a mana shard using a Mana object from the pool.
    /// Mirrors Java's `ManaCostBeingPaid.payMana()`.
    pub fn pay_mana(&mut self, mana: &Mana, possible_uses: u8) -> Option<ManaCostShard> {
        self.try_pay_mana(mana.color, possible_uses)
    }

    pub fn pay_specific_shard(
        &mut self,
        shard: ManaCostShard,
        payment_color: u16,
    ) -> Option<ManaCostShard> {
        if !self.unpaid_shards.contains_key(&shard) {
            return None;
        }
        if !can_pay_for_shard_with_color(shard, payment_color) {
            return None;
        }

        if let Some(sc) = self.unpaid_shards.get_mut(&shard) {
            if sc.x_count > 0 {
                sc.x_count -= 1;
                let color_str = color_mask_to_short(payment_color);
                if !color_str.is_empty() {
                    *self.x_mana_cost_paid_by_color.entry(color_str).or_insert(0) += 1;
                }
            }
        }

        self.decrease_shard(shard, 1);
        self.sunburst_map |= payment_color;
        Some(shard)
    }

    /// Pay a shard via convoke (tapping a creature for a color).
    /// Mirrors Java's `ManaCostBeingPaid.payManaViaConvoke()`.
    pub fn pay_mana_via_convoke(&mut self, color: u16) -> Option<ManaCostShard> {
        let payable: Vec<ManaCostShard> = self
            .get_distinct_shards()
            .into_iter()
            .filter(|&s| {
                !s.is_snow() && !s.is_colorless() && can_pay_for_shard_with_color(s, color)
            })
            .collect();
        let chosen = self.get_shard_to_pay_by_priority(&payable, 0xFF)?;
        self.decrease_shard(chosen, 1);
        self.sunburst_map |= color;
        Some(chosen)
    }

    /// Check if a colored X shard can be paid by a specific color.
    /// Returns false if that color was already used for X payment.
    /// Mirrors Java's `ManaCostBeingPaid.canColoredXShardBePaidByColor()`.
    pub fn can_colored_x_shard_be_paid_by_color(&self, color: &str) -> bool {
        !self.x_mana_cost_paid_by_color.contains_key(color)
    }

    /// Add another ManaCost on top of the current unpaid cost.
    /// Mirrors Java's `ManaCostBeingPaid.addManaCost()`.
    pub fn add_mana_cost(&mut self, extra: &ManaCost) {
        for &shard in extra.shards() {
            if shard.is_x() {
                self.cnt_x += 1;
            } else {
                self.increase_shard(shard, 1);
            }
        }
        self.increase_generic_mana(extra.generic_cost());
    }

    /// Subtract a ManaCost from the current unpaid cost.
    /// Mirrors Java's `ManaCostBeingPaid.subtractManaCost()`.
    pub fn subtract_mana_cost(&mut self, sub: &ManaCost) {
        for &shard in sub.shards() {
            if shard.is_x() {
                self.cnt_x -= 1;
            } else if self.unpaid_shards.contains_key(&shard) {
                self.decrease_shard(shard, 1);
            } else {
                self.decrease_generic_mana(shard.cmc());
            }
        }
        self.decrease_generic_mana(sub.generic_cost());
    }

    /// Convert the remaining unpaid cost back to a ManaCost.
    /// Mirrors Java's `ManaCostBeingPaid.toManaCost()`.
    pub fn to_mana_cost(&self) -> ManaCost {
        let generic = self.get_generic_mana_amount();
        let mut shards: Vec<ManaCostShard> = Vec::new();
        for (&shard, sc) in &self.unpaid_shards {
            if shard == ManaCostShard::Generic {
                continue;
            }
            for _ in 0..sc.total_count {
                shards.push(shard);
            }
        }
        for _ in 0..self.cnt_x {
            shards.push(ManaCostShard::X);
        }
        ManaCost::from_parts(shards, generic)
    }

    /// Remove all generic mana from the unpaid cost.
    /// Mirrors Java's `ManaCostBeingPaid.removeGenericMana()`.
    pub fn remove_generic_mana(&mut self) {
        self.unpaid_shards.remove(&ManaCostShard::Generic);
    }
}

fn color_mask_to_short(mask: u16) -> String {
    if (mask & ManaAtom::WHITE) != 0 {
        return "W".into();
    }
    if (mask & ManaAtom::BLUE) != 0 {
        return "U".into();
    }
    if (mask & ManaAtom::BLACK) != 0 {
        return "B".into();
    }
    if (mask & ManaAtom::RED) != 0 {
        return "R".into();
    }
    if (mask & ManaAtom::GREEN) != 0 {
        return "G".into();
    }
    String::new()
}

pub fn can_pay_for_shard_with_color(shard: ManaCostShard, color: u16) -> bool {
    if shard == ManaCostShard::Generic {
        return true;
    }
    if shard.is_or_2_generic() {
        return true;
    }

    let atoms = shard.shard();

    if (atoms & ManaAtom::COLORLESS) != 0 && color == ManaAtom::COLORLESS {
        return true;
    }

    let color_atoms = atoms & ManaAtom::COLORS_SUPERPOSITION;
    color_atoms != 0 && (color_atoms & color) != 0
}

pub fn get_pay_priority(shard: ManaCostShard, payment_color: u8) -> i32 {
    if shard == ManaCostShard::Generic {
        return 2;
    }

    if shard.is_mono_color() {
        if shard.is_or_2_generic() {
            return if (shard.color_mask() & payment_color) != 0 {
                9
            } else {
                1
            };
        }
        if shard.is_phyrexian() {
            return 8;
        }
        return 10;
    }

    5
}
