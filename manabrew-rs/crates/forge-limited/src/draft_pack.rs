use forge_foundation::sealed_product::PaperCard;

#[derive(Debug, Clone)]
pub struct DraftPack {
    cards: Vec<PaperCard>,
    id: u32,
    passed_from: Option<usize>,
    awaiting_guess: Option<(usize, PaperCard)>,
    picks_remaining: u32,
}

impl DraftPack {
    pub fn new(cards: Vec<PaperCard>, id: u32) -> Self {
        Self {
            cards,
            id,
            passed_from: None,
            awaiting_guess: None,
            picks_remaining: 1,
        }
    }

    pub fn id(&self) -> u32 {
        self.id
    }

    pub fn cards(&self) -> &[PaperCard] {
        &self.cards
    }

    pub fn cards_mut(&mut self) -> &mut Vec<PaperCard> {
        &mut self.cards
    }

    pub fn len(&self) -> usize {
        self.cards.len()
    }

    pub fn is_empty(&self) -> bool {
        self.cards.is_empty()
    }

    pub fn passed_from(&self) -> Option<usize> {
        self.passed_from
    }

    pub fn set_passed_from(&mut self, seat: usize) {
        self.passed_from = Some(seat);
    }

    pub fn remove_card(&mut self, card: &PaperCard) -> bool {
        if let Some(pos) = self.cards.iter().position(|c| c == card) {
            self.cards.remove(pos);
            true
        } else {
            false
        }
    }

    pub fn awaiting_guess(&self) -> Option<&(usize, PaperCard)> {
        self.awaiting_guess.as_ref()
    }

    pub fn set_awaiting_guess(&mut self, seat: usize, card: PaperCard) {
        self.awaiting_guess = Some((seat, card));
    }

    pub fn reset_awaiting_guess(&mut self) {
        self.awaiting_guess = None;
    }

    pub fn picks_remaining(&self) -> u32 {
        self.picks_remaining
    }

    pub fn set_picks_remaining(&mut self, n: u32) {
        self.picks_remaining = n.max(1);
    }

    pub fn decrement_picks_remaining(&mut self) {
        self.picks_remaining = self.picks_remaining.saturating_sub(1);
    }
}
