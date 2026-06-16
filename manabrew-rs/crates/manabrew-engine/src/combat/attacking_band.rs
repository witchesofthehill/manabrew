use crate::ids::CardId;

/// A band of attacking creatures.
/// Mirrors Java's `AttackingBand.java`.
///
/// In standard play, each band contains exactly one creature. The banding
/// keyword (from Alpha/early sets) allows multiple creatures to form a single
/// band. We store the full band structure for parity, but `isValidBand` only
/// handles single-creature bands and explicit banding — "bands with" is
/// stubbed.
#[derive(Debug, Clone)]
pub struct AttackingBand {
    pub attackers: Vec<CardId>,
    /// `None` = not yet determined, `Some(true)` = blocked, `Some(false)` = unblocked.
    pub blocked: Option<bool>,
}

impl AttackingBand {
    pub fn new(card: CardId) -> Self {
        Self {
            attackers: vec![card],
            blocked: None,
        }
    }

    pub fn from_list(cards: Vec<CardId>) -> Self {
        Self {
            attackers: cards,
            blocked: None,
        }
    }

    pub fn get_attackers(&self) -> &[CardId] {
        &self.attackers
    }

    pub fn add_attacker(&mut self, card: CardId) {
        self.attackers.push(card);
    }

    pub fn remove_attacker(&mut self, card: CardId) {
        self.attackers.retain(|&c| c != card);
    }

    /// Check if `card` is part of this band.
    pub fn contains(&self, card: CardId) -> bool {
        self.attackers.contains(&card)
    }

    pub fn is_blocked(&self) -> Option<bool> {
        self.blocked
    }

    pub fn set_blocked(&mut self, value: bool) {
        self.blocked = Some(value);
    }

    pub fn is_empty(&self) -> bool {
        self.attackers.is_empty()
    }

    /// Validate that a band is legal. For starting a band (`share_damage` =
    /// false), all but one creature must have Banding. For sharing damage
    /// (`share_damage` = true), at least one must have Banding.
    ///
    /// Full "bands with" keyword support is stubbed — returns `true` for
    /// single-creature bands, which covers 99.9% of actual play.
    pub fn is_valid_band(band: &[CardId], cards: &[crate::card::Card], share_damage: bool) -> bool {
        if band.is_empty() {
            return false;
        }
        if band.len() == 1 {
            return true;
        }
        // Count creatures with the Banding keyword
        let banding_count = band
            .iter()
            .filter(|&&cid| {
                let card = &cards[cid.index()];
                card.has_keyword("Banding")
            })
            .count();
        let needed = if share_damage { 1 } else { band.len() - 1 };
        banding_count >= needed
    }

    /// Check if `card` can join this existing band.
    pub fn can_join_band(&self, card: CardId, cards: &[crate::card::Card]) -> bool {
        let mut new_band: Vec<CardId> = self.attackers.clone();
        new_band.push(card);
        Self::is_valid_band(&new_band, cards, false)
    }
}

impl std::fmt::Display for AttackingBand {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let blocked_str = match self.blocked {
            None => " ? ",
            Some(true) => ">||",
            Some(false) => ">>>",
        };
        write!(f, "{:?} {}", self.attackers, blocked_str)
    }
}
