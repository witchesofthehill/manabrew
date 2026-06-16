use forge_foundation::ColorSet;

#[derive(Debug, Clone)]
pub struct FullDeckColors {
    chosen: ColorSet,
}

impl Default for FullDeckColors {
    fn default() -> Self {
        Self {
            chosen: ColorSet::COLORLESS,
        }
    }
}

impl FullDeckColors {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn chosen(&self) -> ColorSet {
        self.chosen
    }

    pub fn count(&self) -> u32 {
        self.chosen.count_colors()
    }

    pub fn observe(&mut self, card_colors: ColorSet) -> bool {
        let merged = self.chosen.union(card_colors);
        if merged == self.chosen {
            return false;
        }
        self.chosen = merged;
        true
    }
}
