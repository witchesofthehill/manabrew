use std::collections::VecDeque;

use forge_foundation::sealed_product::{
    IUnOpenedProduct, PaperCard, Rarity, SealedTemplate, UnOpenedProduct,
};
use rand::rngs::StdRng;
use rand::SeedableRng;

use crate::winston_draft_ai::WinstonDraftAI;

pub const NUM_PILES: usize = 3;
pub const NUM_PLAYERS: usize = 2;

/// What just happened on a Winston turn — drives UI updates.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WinstonOutcome {
    /// Active seat took a pile (or top-of-deck card). `seat` is the
    /// seat that picked, `cards` is what they got.
    Picked { seat: usize, cards: Vec<PaperCard> },
    /// Draft is done — both seats have drafted everything.
    Complete,
    /// Awaiting the human's choice on the current pile.
    AwaitingHuman,
}

pub struct WinstonDraft {
    seats: Vec<WinstonSeat>,
    deck: VecDeque<PaperCard>,
    piles: Vec<Vec<PaperCard>>,
    active_seat: usize,
    /// Index of the pile currently offered to the active seat (0..3).
    /// When the active seat passes pile 2, the loop offers top-of-deck
    /// instead and resets to 0 next turn.
    current_pile: usize,
    ai: WinstonDraftAI,
    pending_human_pile: Option<usize>,
}

pub struct WinstonSeat {
    pub seat: usize,
    pub name: String,
    pub is_human: bool,
    pub picked: Vec<PaperCard>,
}

impl WinstonDraft {
    /// Build a Winston draft with `pool_packs` packs of `template`
    /// shuffled into the central deck. Seat 0 is the human; seat 1 is
    /// the AI.
    pub fn new(template: SealedTemplate, pool: Vec<PaperCard>, pool_packs: usize) -> Self {
        assert!(pool_packs >= 1);
        let mut rng = StdRng::from_entropy();
        let mut product = UnOpenedProduct::new(template, pool);
        let mut deck: Vec<PaperCard> = Vec::new();
        for _ in 0..pool_packs * NUM_PLAYERS {
            for card in product.open(&mut rng) {
                if card.rarity != Rarity::BasicLand {
                    deck.push(card);
                }
            }
        }
        use rand::seq::SliceRandom;
        deck.shuffle(&mut rng);
        let mut deck: VecDeque<PaperCard> = deck.into();

        let mut piles = Vec::with_capacity(NUM_PILES);
        for _ in 0..NUM_PILES {
            let mut pile = Vec::new();
            if let Some(c) = deck.pop_front() {
                pile.push(c);
            }
            piles.push(pile);
        }

        Self {
            seats: vec![
                WinstonSeat {
                    seat: 0,
                    name: "You".into(),
                    is_human: true,
                    picked: Vec::new(),
                },
                WinstonSeat {
                    seat: 1,
                    name: "AI".into(),
                    is_human: false,
                    picked: Vec::new(),
                },
            ],
            deck,
            piles,
            active_seat: 0,
            current_pile: 0,
            ai: WinstonDraftAI::new(),
            pending_human_pile: None,
        }
    }

    pub fn active_seat(&self) -> usize {
        self.active_seat
    }
    pub fn current_pile(&self) -> usize {
        self.current_pile
    }
    pub fn piles(&self) -> &[Vec<PaperCard>] {
        &self.piles
    }
    pub fn deck_size(&self) -> usize {
        self.deck.len()
    }
    pub fn human_picked(&self) -> &[PaperCard] {
        &self.seats[0].picked
    }
    pub fn ai_picked_count(&self) -> usize {
        self.seats[1].picked.len()
    }
    pub fn is_human_turn(&self) -> bool {
        self.seats[self.active_seat].is_human
    }
    pub fn is_complete(&self) -> bool {
        self.deck.is_empty() && self.piles.iter().all(|p| p.is_empty())
    }

    pub fn seats(&self) -> &[WinstonSeat] {
        &self.seats
    }

    /// Drive the loop: if the AI is on the clock, run AI picks until
    /// either the draft is done or the human is on the clock.
    pub fn tick(&mut self) -> WinstonOutcome {
        loop {
            if self.is_complete() {
                return WinstonOutcome::Complete;
            }
            if self.is_human_turn() {
                self.pending_human_pile = Some(self.current_pile);
                return WinstonOutcome::AwaitingHuman;
            }
            let cards = self.ai_resolve_turn();
            let seat = self.active_seat;
            self.seats[seat].picked.extend(cards.iter().cloned());
            self.advance_seat();
            return WinstonOutcome::Picked { seat, cards };
        }
    }

    /// Human accepts the current pile.
    pub fn human_take_pile(&mut self) -> Result<Vec<PaperCard>, String> {
        if !self.is_human_turn() {
            return Err("not human's turn".into());
        }
        let cards = self.take_active_pile();
        self.seats[0].picked.extend(cards.iter().cloned());
        self.advance_seat();
        Ok(cards)
    }

    /// Human passes the current pile. Returns Some(cards) if the pass
    /// landed on top-of-deck (i.e. all 3 piles passed); None otherwise.
    pub fn human_pass_pile(&mut self) -> Result<Option<Vec<PaperCard>>, String> {
        if !self.is_human_turn() {
            return Err("not human's turn".into());
        }
        let drawn = self.pass_active_pile();
        if let Some(cards) = &drawn {
            self.seats[0].picked.extend(cards.iter().cloned());
            self.advance_seat();
        }
        Ok(drawn)
    }

    pub(crate) fn take_active_pile(&mut self) -> Vec<PaperCard> {
        let pile_idx = self.current_pile;
        let cards = std::mem::take(&mut self.piles[pile_idx]);
        self.refill_pile(pile_idx);
        self.current_pile = 0;
        cards
    }

    pub(crate) fn pass_active_pile(&mut self) -> Option<Vec<PaperCard>> {
        let pile_idx = self.current_pile;
        if let Some(c) = self.deck.pop_front() {
            self.piles[pile_idx].push(c);
        }
        self.current_pile += 1;
        if self.current_pile >= NUM_PILES {
            self.current_pile = 0;
            if let Some(c) = self.deck.pop_front() {
                Some(vec![c])
            } else {
                Some(Vec::new())
            }
        } else {
            None
        }
    }

    fn refill_pile(&mut self, pile_idx: usize) {
        if let Some(c) = self.deck.pop_front() {
            self.piles[pile_idx].push(c);
        }
    }

    fn advance_seat(&mut self) {
        self.active_seat = (self.active_seat + 1) % self.seats.len();
        self.current_pile = 0;
    }

    fn ai_resolve_turn(&mut self) -> Vec<PaperCard> {
        loop {
            let pile_idx = self.current_pile;
            let pile_size = self.piles[pile_idx].len() as i32;
            let take = self.ai.roll_take(pile_size) || self.is_last_pile_and_empty_deck();

            if take {
                return self.take_active_pile();
            }
            if let Some(drawn) = self.pass_active_pile() {
                return drawn;
            }
        }
    }

    /// True if the active pile is the last one and the deck is empty —
    /// AI uses this to take the pile no matter what.
    pub(crate) fn is_last_pile_and_empty_deck(&self) -> bool {
        self.deck.is_empty()
            && (self.current_pile + 1..NUM_PILES).any(|i| !self.piles[i].is_empty())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use forge_foundation::sealed_product::Rarity;

    fn pool() -> Vec<PaperCard> {
        let mut v = Vec::new();
        for i in 0..200 {
            v.push(PaperCard::new(
                format!("Common {i}"),
                "TST",
                format!("c{i}"),
                Rarity::Common,
            ));
        }
        for i in 0..40 {
            v.push(PaperCard::new(
                format!("Uncommon {i}"),
                "TST",
                format!("u{i}"),
                Rarity::Uncommon,
            ));
        }
        for i in 0..15 {
            v.push(PaperCard::new(
                format!("Rare {i}"),
                "TST",
                format!("r{i}"),
                Rarity::Rare,
            ));
        }
        v
    }

    fn draft() -> WinstonDraft {
        WinstonDraft::new(SealedTemplate::generic_draft_booster(), pool(), 6)
    }

    #[test]
    fn fresh_draft_has_3_piles_each_with_one_card() {
        let d = draft();
        assert_eq!(d.piles().len(), NUM_PILES);
        for pile in d.piles() {
            assert_eq!(pile.len(), 1);
        }
        assert_eq!(d.active_seat(), 0);
        assert_eq!(d.current_pile(), 0);
    }

    #[test]
    fn human_take_pile_advances_seat_and_refills() {
        let mut d = draft();
        let pre_deck = d.deck_size();
        let cards = d.human_take_pile().unwrap();
        assert_eq!(cards.len(), 1);
        assert_eq!(d.human_picked().len(), 1);
        assert_eq!(d.piles()[0].len(), 1);
        assert_eq!(d.deck_size(), pre_deck - 1);
        assert_eq!(d.active_seat(), 1);
    }

    #[test]
    fn human_pass_advances_pile_and_grows_it() {
        let mut d = draft();
        let pre_deck = d.deck_size();
        assert!(d.human_pass_pile().unwrap().is_none());
        assert_eq!(d.piles()[0].len(), 2);
        assert_eq!(d.deck_size(), pre_deck - 1);
        assert_eq!(d.current_pile(), 1);
        assert_eq!(d.active_seat(), 0);
    }

    #[test]
    fn passing_all_three_piles_draws_top_of_deck() {
        let mut d = draft();
        assert!(d.human_pass_pile().unwrap().is_none());
        assert!(d.human_pass_pile().unwrap().is_none());
        let drawn = d.human_pass_pile().unwrap();
        assert!(drawn.is_some());
        assert_eq!(drawn.unwrap().len(), 1);
        assert_eq!(d.human_picked().len(), 1);
        assert_eq!(d.active_seat(), 1);
        assert_eq!(d.current_pile(), 0);
    }

    #[test]
    fn ai_tick_picks_when_its_their_turn() {
        let mut d = draft();
        d.human_take_pile().unwrap();
        let outcome = d.tick();
        match outcome {
            WinstonOutcome::Picked { seat, cards } => {
                assert_eq!(seat, 1);
                assert!(!cards.is_empty(), "ai should pick at least one card");
                assert_eq!(d.active_seat(), 0);
            }
            other => panic!("expected Picked, got {other:?}"),
        }
    }
}
