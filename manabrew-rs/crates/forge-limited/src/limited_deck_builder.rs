use std::sync::Arc;

use forge_foundation::sealed_product::{PaperCard, Rarity};
use forge_foundation::ColorSet;
use thiserror::Error;

use crate::card_ranker::CardRanker;
use crate::deck_colors::DeckColors;

#[derive(Debug, Clone)]
pub struct LimitedDeck {
    pub name: String,
    pub main: Vec<PaperCard>,
    pub sideboard: Vec<PaperCard>,
}

#[derive(Debug, Error)]
pub enum DeckBuildError {
    #[error("not enough cards in pool: needed {needed}, have {have}")]
    InsufficientPool { needed: usize, have: usize },
}

pub struct LimitedDeckBuilder {
    available: Vec<PaperCard>,
    deck_colors: DeckColors,
    ranker: Arc<CardRanker>,
    color_of: Box<dyn Fn(&PaperCard) -> ColorSet + Send + Sync>,
    is_land: Box<dyn Fn(&PaperCard) -> bool + Send + Sync>,
}

impl LimitedDeckBuilder {
    pub const DECK_SIZE: usize = 40;
    pub const LAND_PERCENTAGE: f32 = 0.44;

    pub fn new(
        available: Vec<PaperCard>,
        deck_colors: DeckColors,
        ranker: Arc<CardRanker>,
        color_of: impl Fn(&PaperCard) -> ColorSet + Send + Sync + 'static,
        is_land: impl Fn(&PaperCard) -> bool + Send + Sync + 'static,
    ) -> Self {
        Self {
            available,
            deck_colors,
            ranker,
            color_of: Box::new(color_of),
            is_land: Box::new(is_land),
        }
    }

    pub fn deck_colors(&self) -> &DeckColors {
        &self.deck_colors
    }

    pub fn build_deck(
        &mut self,
        deck_name: impl Into<String>,
        land_set_code: Option<&str>,
    ) -> Result<LimitedDeck, DeckBuildError> {
        let chosen_colors = self.deck_colors.chosen();
        let target_lands = (Self::DECK_SIZE as f32 * Self::LAND_PERCENTAGE).round() as usize;

        let spells: Vec<PaperCard> = self
            .available
            .iter()
            .filter(|c| !(self.is_land)(c))
            .cloned()
            .collect();
        let scored = self.ranker.rank_cards_in_pack(
            &spells,
            &[],
            chosen_colors,
            self.deck_colors.can_choose_more_colors() || chosen_colors.is_colorless(),
            |c| (self.color_of)(c),
        );

        let spell_target = Self::DECK_SIZE - target_lands;
        let mut main: Vec<PaperCard> = scored.iter().take(spell_target).cloned().collect();
        let sideboard: Vec<PaperCard> = scored.into_iter().skip(spell_target).collect();

        let mut lands: Vec<PaperCard> = self
            .available
            .iter()
            .filter(|c| (self.is_land)(c))
            .cloned()
            .collect();
        if let Some(set) = land_set_code {
            lands.sort_by_key(|c| {
                let matches = c.set_code.eq_ignore_ascii_case(set);
                let is_basic = c.rarity == Rarity::BasicLand;
                (!is_basic, !matches)
            });
        }
        let mut land_picks: Vec<PaperCard> = lands.into_iter().take(target_lands).collect();

        if land_picks.len() < target_lands {
            let needed = target_lands - land_picks.len();
            let set_for_basics = land_set_code.unwrap_or("");
            for i in 0..needed {
                land_picks.push(PaperCard::new(
                    synthetic_basic_name(i, chosen_colors),
                    set_for_basics,
                    format!("basic{i}"),
                    Rarity::BasicLand,
                ));
            }
        }

        if main.len() + land_picks.len() < Self::DECK_SIZE {
            return Err(DeckBuildError::InsufficientPool {
                needed: Self::DECK_SIZE,
                have: main.len() + land_picks.len(),
            });
        }

        main.extend(land_picks);
        main.truncate(Self::DECK_SIZE);

        Ok(LimitedDeck {
            name: deck_name.into(),
            main,
            sideboard,
        })
    }
}

fn synthetic_basic_name(index: usize, colors: ColorSet) -> String {
    let basics: Vec<&str> = [
        ("Plains", ColorSet::WHITE),
        ("Island", ColorSet::BLUE),
        ("Swamp", ColorSet::BLACK),
        ("Mountain", ColorSet::RED),
        ("Forest", ColorSet::GREEN),
    ]
    .into_iter()
    .filter_map(|(name, mask)| {
        if colors.shares_color_with(mask) {
            Some(name)
        } else {
            None
        }
    })
    .collect();
    if basics.is_empty() {
        "Wastes".to_string()
    } else {
        basics[index % basics.len()].to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::draft_rank_cache::DraftRankCache;

    fn pool() -> Vec<PaperCard> {
        let mut v = Vec::new();
        for i in 0..30 {
            v.push(PaperCard::new(
                format!("Spell {i}"),
                "TST",
                format!("s{i}"),
                Rarity::Common,
            ));
        }
        for i in 0..10 {
            v.push(PaperCard::new(
                format!("Forest {i}"),
                "TST",
                format!("l{i}"),
                Rarity::BasicLand,
            ));
        }
        v
    }

    #[test]
    fn builds_a_40_card_deck() {
        let cache = Arc::new(DraftRankCache::new());
        let ranker = Arc::new(CardRanker::new(cache));
        let mut builder = LimitedDeckBuilder::new(
            pool(),
            DeckColors::new(),
            ranker,
            |_| ColorSet::COLORLESS,
            |c| c.rarity == Rarity::BasicLand,
        );
        let deck = builder.build_deck("test", Some("TST")).unwrap();
        assert_eq!(deck.main.len(), LimitedDeckBuilder::DECK_SIZE);
        let lands = deck
            .main
            .iter()
            .filter(|c| c.rarity == Rarity::BasicLand)
            .count();
        assert!(lands >= 17 && lands <= 18, "lands = {lands}");
    }

    #[test]
    fn synthesises_basics_when_pool_lacks_them() {
        let cache = Arc::new(DraftRankCache::new());
        let ranker = Arc::new(CardRanker::new(cache));
        let mut spells = Vec::new();
        for i in 0..30 {
            spells.push(PaperCard::new(
                format!("Spell {i}"),
                "TST",
                format!("s{i}"),
                Rarity::Common,
            ));
        }
        let mut builder = LimitedDeckBuilder::new(
            spells,
            DeckColors::new(),
            ranker,
            |_| ColorSet::COLORLESS,
            |_| false,
        );
        let deck = builder.build_deck("test", Some("M21")).unwrap();
        assert_eq!(deck.main.len(), 40);
        let basics = deck.main.iter().filter(|c| c.set_code == "M21").count();
        assert!(basics >= 17, "basics = {basics}");
    }
}
