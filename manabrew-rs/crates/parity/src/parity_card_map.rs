use std::collections::HashMap;
use std::sync::Mutex;

use forge_foundation::ZoneType;
use manabrew_engine::game::GameState;
use manabrew_engine::ids::{CardId, PlayerId};

/// Maps engine-internal card IDs to stable, cross-engine parity IDs.
///
/// Deck cards are assigned sequential IDs (1, 2, 3, ...) at game start from the
/// opening hand + library.  Cards created mid-game (tokens, copies, detached
/// effects) are assigned the next sequential ID on first access, so both engines
/// produce identical parity IDs as long as they encounter cards in the same order.
pub struct ParityCardMap {
    inner: Mutex<ParityCardMapInner>,
}

struct ParityCardMapInner {
    by_card: HashMap<CardId, u32>,
    next: u32,
}

impl Default for ParityCardMap {
    fn default() -> Self {
        Self {
            inner: Mutex::new(ParityCardMapInner {
                by_card: HashMap::new(),
                next: 1,
            }),
        }
    }
}

impl ParityCardMap {
    fn assign_if_absent(inner: &mut ParityCardMapInner, cid: CardId) {
        if inner.by_card.contains_key(&cid) {
            return;
        }
        let id = inner.next;
        inner.next += 1;
        inner.by_card.insert(cid, id);
    }

    pub fn from_opening_state(game: &GameState) -> Self {
        let mut by_card: HashMap<CardId, u32> = HashMap::new();
        let mut next: u32 = 1;

        let mut players: Vec<PlayerId> = game.player_order.clone();
        players.sort_by_key(|p| p.0);

        for pid in players {
            for &cid in game.cards_in_zone(ZoneType::Hand, pid) {
                if by_card.insert(cid, next).is_none() {
                    next += 1;
                }
            }
            // Rust library top is the end of the vector; Java top is iterated first.
            // Assign parity ids in draw order (top -> bottom) to match Java.
            for &cid in game.cards_in_zone(ZoneType::Library, pid).iter().rev() {
                if by_card.insert(cid, next).is_none() {
                    next += 1;
                }
            }
        }

        Self {
            inner: Mutex::new(ParityCardMapInner { by_card, next }),
        }
    }

    /// Assign parity IDs for all currently existing cards in a canonical order.
    ///
    /// This prevents ID assignment from depending on first-touch order at
    /// decision time (which can differ between Rust/Java for same-name cards,
    /// especially tokens).
    pub fn sync_with_game(&self, game: &GameState) {
        let mut inner = self.inner.lock().unwrap();

        let mut players: Vec<PlayerId> = game.player_order.clone();
        players.sort_by_key(|p| p.0);

        for pid in players {
            let mut hand_cards: Vec<CardId> = game.cards_in_zone(ZoneType::Hand, pid).to_vec();
            hand_cards.sort_by(|a, b| {
                let ca = game.card(*a);
                let cb = game.card(*b);
                ca.card_name
                    .cmp(&cb.card_name)
                    .then_with(|| ca.owner.0.cmp(&cb.owner.0))
                    .then_with(|| ca.controller.0.cmp(&cb.controller.0))
                    .then_with(|| ca.zone_timestamp.cmp(&cb.zone_timestamp))
                    .then_with(|| a.index().cmp(&b.index()))
            });
            for cid in hand_cards {
                Self::assign_if_absent(&mut inner, cid);
            }
            // Draw order parity for library: top -> bottom.
            for &cid in game.cards_in_zone(ZoneType::Library, pid).iter().rev() {
                Self::assign_if_absent(&mut inner, cid);
            }
            let mut battlefield_cards: Vec<CardId> =
                game.cards_in_zone(ZoneType::Battlefield, pid).to_vec();
            battlefield_cards.sort_by(|a, b| {
                let ca = game.card(*a);
                let cb = game.card(*b);
                ca.card_name
                    .cmp(&cb.card_name)
                    .then_with(|| ca.owner.0.cmp(&cb.owner.0))
                    .then_with(|| ca.controller.0.cmp(&cb.controller.0))
                    .then_with(|| ca.zone_timestamp.cmp(&cb.zone_timestamp))
                    .then_with(|| a.index().cmp(&b.index()))
            });
            for cid in battlefield_cards {
                Self::assign_if_absent(&mut inner, cid);
            }
            let mut graveyard_cards: Vec<CardId> = game
                .cards_in_zone(ZoneType::Graveyard, pid)
                .iter()
                .copied()
                .filter(|&cid| !game.card(cid).is_token)
                .collect();
            graveyard_cards.sort_by(|a, b| {
                let ca = game.card(*a);
                let cb = game.card(*b);
                ca.card_name
                    .cmp(&cb.card_name)
                    .then_with(|| ca.owner.0.cmp(&cb.owner.0))
                    .then_with(|| ca.controller.0.cmp(&cb.controller.0))
                    .then_with(|| ca.zone_timestamp.cmp(&cb.zone_timestamp))
                    .then_with(|| a.index().cmp(&b.index()))
            });
            for cid in graveyard_cards {
                Self::assign_if_absent(&mut inner, cid);
            }
            let mut exile_cards: Vec<CardId> = game
                .cards_in_zone(ZoneType::Exile, pid)
                .iter()
                .copied()
                .filter(|&cid| !game.card(cid).is_token)
                .collect();
            exile_cards.sort_by(|a, b| {
                let ca = game.card(*a);
                let cb = game.card(*b);
                ca.card_name
                    .cmp(&cb.card_name)
                    .then_with(|| ca.owner.0.cmp(&cb.owner.0))
                    .then_with(|| ca.controller.0.cmp(&cb.controller.0))
                    .then_with(|| ca.zone_timestamp.cmp(&cb.zone_timestamp))
                    .then_with(|| a.index().cmp(&b.index()))
            });
            for cid in exile_cards {
                Self::assign_if_absent(&mut inner, cid);
            }
            let mut stack_cards: Vec<CardId> = game
                .cards_in_zone(ZoneType::Stack, pid)
                .iter()
                .copied()
                .filter(|&cid| !game.card(cid).is_token)
                .collect();
            stack_cards.sort_by(|a, b| {
                let ca = game.card(*a);
                let cb = game.card(*b);
                ca.card_name
                    .cmp(&cb.card_name)
                    .then_with(|| ca.owner.0.cmp(&cb.owner.0))
                    .then_with(|| ca.controller.0.cmp(&cb.controller.0))
                    .then_with(|| ca.zone_timestamp.cmp(&cb.zone_timestamp))
                    .then_with(|| a.index().cmp(&b.index()))
            });
            for cid in stack_cards {
                Self::assign_if_absent(&mut inner, cid);
            }
        }
    }

    /// Return the stable parity ID for `cid`.  If this card has not been seen
    /// before (e.g. a token or copy created mid-game), a new sequential ID is
    /// assigned automatically.
    pub fn id(&self, cid: CardId) -> u32 {
        let mut inner = self.inner.lock().unwrap();
        if let Some(&id) = inner.by_card.get(&cid) {
            return id;
        }
        let id = inner.next;
        inner.next += 1;
        inner.by_card.insert(cid, id);
        id
    }
}
