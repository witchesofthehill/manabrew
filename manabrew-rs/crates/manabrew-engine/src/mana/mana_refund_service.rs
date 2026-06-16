//! Mana refund service for returning paid mana to the pool.
//!
//! Mirrors Java's `forge.game.mana.ManaRefundService`.

use super::{Mana, ManaPool};
use crate::ids::PlayerId;

/// Handles refunding mana that was spent on a spell or ability back to the pool.
///
/// When a spell fizzles or is countered, the mana spent to cast it is returned
/// to the caster's mana pool. This service coordinates that refund.
///
/// Mirrors Java's `forge.game.mana.ManaRefundService`.
#[derive(Debug, Clone)]
pub struct ManaRefundService {
    /// The player whose mana should be refunded.
    activating_player: PlayerId,
}

impl ManaRefundService {
    /// Create a new refund service for the given player.
    pub fn new(player: PlayerId) -> Self {
        Self {
            activating_player: player,
        }
    }

    /// Return the activating player.
    pub fn activating_player(&self) -> PlayerId {
        self.activating_player
    }

    /// Refund mana that was paid, returning it to the pool.
    ///
    /// Moves all mana from `mana_spent` back into the pool, clearing the spent list.
    /// In Java this also undoes mana abilities (untapping lands, restoring counters),
    /// which is handled separately in the Rust engine's undo system.
    ///
    /// Mirrors Java's `ManaRefundService.refundManaPaid()`.
    pub fn refund_mana_paid(&self, pool: &mut ManaPool, mana_spent: &mut Vec<Mana>) {
        for m in mana_spent.drain(..) {
            pool.add_mana(m);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use forge_foundation::mana::ManaAtom;

    #[test]
    fn refund_returns_mana_to_pool() {
        let service = ManaRefundService::new(PlayerId(0));
        let mut pool = ManaPool::new();
        let mut spent = vec![
            Mana::simple(ManaAtom::RED),
            Mana::simple(ManaAtom::GREEN),
            Mana::simple(ManaAtom::BLUE),
        ];

        service.refund_mana_paid(&mut pool, &mut spent);

        assert_eq!(pool.total_mana(), 3);
        assert!(spent.is_empty());
    }

    #[test]
    fn activating_player_stored() {
        let service = ManaRefundService::new(PlayerId(42));
        assert_eq!(service.activating_player(), PlayerId(42));
    }
}
