use forge_foundation::sealed_product::PaperCard;
use forge_foundation::ColorSet;

#[derive(Debug, Clone)]
pub struct DeckColors {
    chosen: ColorSet,
    locked: bool,
}

impl Default for DeckColors {
    fn default() -> Self {
        Self {
            chosen: ColorSet::COLORLESS,
            locked: false,
        }
    }
}

impl DeckColors {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn chosen(&self) -> ColorSet {
        self.chosen
    }

    pub fn count(&self) -> u32 {
        self.chosen.count_colors()
    }

    pub fn is_locked(&self) -> bool {
        self.locked
    }

    pub fn can_choose_more_colors(&self) -> bool {
        !self.locked && self.chosen.count_colors() < 2
    }

    pub fn observe(&mut self, card: &PaperCard, card_colors: ColorSet) -> bool {
        if self.locked {
            return false;
        }
        if card_colors.count_colors() != 1 {
            return false;
        }
        let _ = card;
        let merged = self.chosen.union(card_colors);
        if merged == self.chosen {
            return false;
        }
        if merged.count_colors() > 2 {
            self.locked = true;
            return false;
        }
        self.chosen = merged;
        if self.chosen.count_colors() == 2 {
            self.locked = true;
        }
        true
    }
}
