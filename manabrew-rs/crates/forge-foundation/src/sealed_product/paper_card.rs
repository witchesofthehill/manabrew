use serde::{Deserialize, Serialize};

use super::rarity::Rarity;
use crate::color::ColorSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperCard {
    pub name: String,
    pub set_code: String,
    pub collector_number: String,
    pub rarity: Rarity,
    #[serde(default)]
    pub foil: bool,
    #[serde(default)]
    pub colors: ColorSet,
    #[serde(default)]
    pub is_double_faced: bool,
}

impl PaperCard {
    pub fn new(
        name: impl Into<String>,
        set_code: impl Into<String>,
        collector_number: impl Into<String>,
        rarity: Rarity,
    ) -> Self {
        Self {
            name: name.into(),
            set_code: set_code.into(),
            collector_number: collector_number.into(),
            rarity,
            foil: false,
            colors: ColorSet::COLORLESS,
            is_double_faced: false,
        }
    }

    pub fn with_double_faced(mut self, dfc: bool) -> Self {
        self.is_double_faced = dfc;
        self
    }

    pub fn with_foil(&self) -> Self {
        let mut copy = self.clone();
        copy.foil = true;
        copy
    }

    pub fn with_colors(mut self, colors: ColorSet) -> Self {
        self.colors = colors;
        self
    }
}

impl PartialEq for PaperCard {
    fn eq(&self, other: &Self) -> bool {
        self.set_code.eq_ignore_ascii_case(&other.set_code)
            && self.collector_number == other.collector_number
            && self.foil == other.foil
    }
}

impl Eq for PaperCard {}

impl std::hash::Hash for PaperCard {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.set_code.to_ascii_lowercase().hash(state);
        self.collector_number.hash(state);
        self.foil.hash(state);
    }
}
