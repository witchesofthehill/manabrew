use std::sync::Arc;

use forge_foundation::sealed_product::{PaperCard, Rarity};
use forge_foundation::ColorSet;

use crate::card_ranking_comparator::CardRankingComparator;
use crate::draft_rank_cache::DraftRankCache;

pub struct CardRanker {
    rank_cache: Arc<DraftRankCache>,
    custom_rankings: Option<std::collections::HashMap<String, u32>>,
}

impl CardRanker {
    pub const SCORE_UNPICKABLE: f64 = -100.0;

    pub fn new(rank_cache: Arc<DraftRankCache>) -> Self {
        Self {
            rank_cache,
            custom_rankings: None,
        }
    }

    pub fn with_custom_rankings(
        mut self,
        rankings: std::collections::HashMap<String, u32>,
    ) -> Self {
        self.custom_rankings = Some(rankings);
        self
    }

    fn normalise_rank(rank: u32) -> f64 {
        let bounded = rank.min(250) as f64;
        ((250.0 - bounded) / 250.0) * 100.0
    }

    pub fn get_raw_score(&self, card: &PaperCard) -> f64 {
        if let Some(custom) = &self.custom_rankings {
            if let Some(r) = custom.get(&card.name.to_lowercase()).copied() {
                return Self::normalise_rank(r);
            }
        }
        if let Some(r) = self.rank_cache.rank(&card.set_code, &card.name) {
            return Self::normalise_rank(r);
        }
        if let Some(r) = self.rank_cache.best_rank(&card.name) {
            return Self::normalise_rank(r);
        }
        match card.rarity {
            Rarity::Mythic => 70.0,
            Rarity::Rare => 60.0,
            Rarity::Uncommon => 40.0,
            Rarity::Common => 25.0,
            Rarity::BasicLand => 10.0,
            Rarity::Special | Rarity::Token | Rarity::Unknown => 5.0,
        }
    }

    pub fn get_scores(&self, cards: &[PaperCard]) -> Vec<(f64, PaperCard)> {
        cards
            .iter()
            .map(|c| (self.get_raw_score(c), c.clone()))
            .collect()
    }

    pub fn get_ordered_raw_scores(&self, cards: &[PaperCard]) -> Vec<PaperCard> {
        let mut scored = self.get_scores(cards);
        CardRankingComparator::sort(&mut scored);
        scored.into_iter().map(|(_, c)| c).collect()
    }

    pub fn rank_cards_in_deck(&self, cards: &[PaperCard]) -> Vec<PaperCard> {
        self.get_ordered_raw_scores(cards)
    }

    pub fn rank_cards_in_pack(
        &self,
        pack: &[PaperCard],
        deck: &[PaperCard],
        chosen_colors: ColorSet,
        can_add_more_colors: bool,
        card_color_lookup: impl Fn(&PaperCard) -> ColorSet,
    ) -> Vec<PaperCard> {
        let _ = deck;
        let mut scored: Vec<(f64, PaperCard)> = pack
            .iter()
            .map(|c| {
                let raw = self.get_raw_score(c);
                let colors = card_color_lookup(c);
                let score = if !chosen_colors.is_colorless()
                    && !can_add_more_colors
                    && !colors.is_colorless()
                    && !chosen_colors.contains_all_colors_from(colors)
                {
                    Self::SCORE_UNPICKABLE
                } else {
                    raw
                };
                (score, c.clone())
            })
            .collect();
        CardRankingComparator::sort(&mut scored);
        scored.into_iter().map(|(_, c)| c).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cache() -> Arc<DraftRankCache> {
        let c = DraftRankCache::new();
        c.register_from_rnk("TST", "1|Best|C|TST\n10|Mid|C|TST\n100|Filler|C|TST\n");
        Arc::new(c)
    }

    fn card(name: &str, rarity: Rarity) -> PaperCard {
        PaperCard::new(name, "TST", "1", rarity)
    }

    #[test]
    fn higher_rank_wins() {
        let r = CardRanker::new(cache());
        let pack = vec![
            card("Filler", Rarity::Common),
            card("Best", Rarity::Common),
            card("Mid", Rarity::Common),
        ];
        let order = r.get_ordered_raw_scores(&pack);
        assert_eq!(order[0].name, "Best");
        assert_eq!(order[1].name, "Mid");
        assert_eq!(order[2].name, "Filler");
    }

    #[test]
    fn rarity_fallback_when_no_rank() {
        let r = CardRanker::new(Arc::new(DraftRankCache::new()));
        let pack = vec![
            card("RareUnranked", Rarity::Rare),
            card("CommonUnranked", Rarity::Common),
        ];
        let order = r.get_ordered_raw_scores(&pack);
        assert_eq!(order[0].name, "RareUnranked");
    }

    #[test]
    fn off_color_locked_drops_to_unpickable() {
        let r = CardRanker::new(cache());
        let red = card("Best", Rarity::Common);
        let blue = card("Mid", Rarity::Common);
        let order = r.rank_cards_in_pack(
            &vec![red.clone(), blue.clone()],
            &[],
            ColorSet::WHITE,
            false,
            |c| {
                if c.name == "Best" {
                    ColorSet::RED
                } else {
                    ColorSet::WHITE
                }
            },
        );
        assert_eq!(order[0].name, "Mid");
    }
}
