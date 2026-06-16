use std::sync::Arc;

use forge_foundation::edition::EditionsRegistry;
use forge_foundation::sealed_product::{
    IUnOpenedProduct, PaperCard, SealedTemplate, UnOpenedProduct,
};
use forge_foundation::ColorSet;
use rand::Rng;

use crate::card_ranker::CardRanker;
use crate::custom_limited::CustomLimited;
use crate::deck_colors::DeckColors;
use crate::limited_deck_builder::{LimitedDeck, LimitedDeckBuilder};
use crate::limited_deck_evaluator::LimitedDeckEvaluator;
use crate::limited_pool_type::LimitedPoolType;

pub struct SealedCardPoolGenerator {
    pool_type: LimitedPoolType,
    card_pool: Vec<PaperCard>,
    products: Vec<UnOpenedProduct>,
    land_set_code: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SealedDeckGroup {
    pub deck_name: String,
    pub land_set_code: Option<String>,
    pub human_pool: Vec<PaperCard>,
    pub suggested_human_deck: Option<LimitedDeck>,
    pub ai_decks: Vec<LimitedDeck>,
}

impl SealedCardPoolGenerator {
    pub fn new(pool_type: LimitedPoolType, card_pool: Vec<PaperCard>) -> Self {
        Self {
            pool_type,
            card_pool,
            products: Vec::new(),
            land_set_code: None,
        }
    }

    pub fn with_full(self, num_boosters: usize) -> Self {
        self.with_template(SealedTemplate::generic_draft_booster(), num_boosters)
    }

    pub fn with_template(mut self, template: SealedTemplate, num_boosters: usize) -> Self {
        self.products = (0..num_boosters)
            .map(|_| UnOpenedProduct::new(template.clone(), self.card_pool.clone()))
            .collect();
        self
    }

    pub fn with_edition(
        self,
        editions: &EditionsRegistry,
        edition_code: &str,
        num_boosters: usize,
    ) -> Self {
        self.with_edition_variant(editions, edition_code, None, num_boosters)
    }

    pub fn with_edition_variant(
        self,
        editions: &EditionsRegistry,
        edition_code: &str,
        variant: Option<&str>,
        num_boosters: usize,
    ) -> Self {
        let template = editions
            .get(edition_code)
            .and_then(|e| e.to_sealed_template_named(variant))
            .unwrap_or_else(SealedTemplate::generic_draft_booster);
        self.with_template(template, num_boosters)
    }

    pub fn with_custom(mut self, cube: &CustomLimited) -> Self {
        self.land_set_code = cube.land_set_code.clone();
        let template = cube.template.clone();
        self.products = (0..cube.num_packs as usize)
            .map(|_| UnOpenedProduct::new(template.clone(), self.card_pool.clone()))
            .collect();
        self
    }

    pub fn land_set_code(&self) -> Option<&str> {
        self.land_set_code.as_deref()
    }

    pub fn pool_type(&self) -> LimitedPoolType {
        self.pool_type
    }

    pub fn is_empty(&self) -> bool {
        self.products.is_empty()
    }

    pub fn next_pool<R: Rng + ?Sized>(&mut self, rng: &mut R) -> Option<Vec<PaperCard>> {
        let mut prod = self.products.pop()?;
        Some(prod.open(rng))
    }

    pub fn generate_sealed_deck<R: Rng + ?Sized, ColorFn, LandFn>(
        &mut self,
        deck_name: impl Into<String>,
        rng: &mut R,
        ai_opponent_count: usize,
        ranker: Arc<CardRanker>,
        rank_cache: Arc<crate::DraftRankCache>,
        color_of: ColorFn,
        is_land: LandFn,
    ) -> SealedDeckGroup
    where
        ColorFn: Fn(&PaperCard) -> ColorSet + Send + Sync + Clone + 'static,
        LandFn: Fn(&PaperCard) -> bool + Send + Sync + Clone + 'static,
    {
        let deck_name = deck_name.into();
        let land_set_code = self.land_set_code.clone();

        let mut human_pool: Vec<PaperCard> = Vec::new();
        let mut products = std::mem::take(&mut self.products);
        for prod in &mut products {
            human_pool.extend(prod.open(rng));
        }

        let mut chosen = DeckColors::new();
        let top_third = (human_pool.len() / 3).max(1);
        let ranked_pool = ranker.get_ordered_raw_scores(&human_pool);
        for card in ranked_pool.iter().take(top_third) {
            let colors = color_of(card);
            chosen.observe(card, colors);
            if chosen.is_locked() {
                break;
            }
        }

        let suggested_human_deck = LimitedDeckBuilder::new(
            human_pool.clone(),
            chosen.clone(),
            ranker.clone(),
            color_of.clone(),
            is_land.clone(),
        )
        .build_deck(deck_name.clone(), land_set_code.as_deref())
        .ok();

        let mut ai_decks: Vec<LimitedDeck> = Vec::new();
        for ai_idx in 0..ai_opponent_count {
            let mut pool: Vec<PaperCard> = Vec::new();
            for _ in 0..products.len().max(1) {
                let mut prod = UnOpenedProduct::new(
                    products
                        .first()
                        .map(|p| p.template().clone())
                        .unwrap_or_else(SealedTemplate::generic_draft_booster),
                    self.card_pool.clone(),
                );
                pool.extend(prod.open(rng));
            }

            let mut ai_chosen = DeckColors::new();
            let ai_top = (pool.len() / 3).max(1);
            let ai_ranked = ranker.get_ordered_raw_scores(&pool);
            for card in ai_ranked.iter().take(ai_top) {
                let colors = color_of(card);
                ai_chosen.observe(card, colors);
                if ai_chosen.is_locked() {
                    break;
                }
            }

            if let Ok(deck) = LimitedDeckBuilder::new(
                pool,
                ai_chosen,
                ranker.clone(),
                color_of.clone(),
                is_land.clone(),
            )
            .build_deck(format!("AI {}", ai_idx + 1), land_set_code.as_deref())
            {
                ai_decks.push(deck);
            }
        }

        // Rank AI decks weakest-first so the gauntlet escalates.
        ai_decks.sort_by(|a, b| {
            let sa = LimitedDeckEvaluator::score_deck(&a.main, rank_cache.clone());
            let sb = LimitedDeckEvaluator::score_deck(&b.main, rank_cache.clone());
            sa.partial_cmp(&sb).unwrap_or(std::cmp::Ordering::Equal)
        });

        SealedDeckGroup {
            deck_name,
            land_set_code,
            human_pool,
            suggested_human_deck,
            ai_decks,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::draft_rank_cache::DraftRankCache;
    use forge_foundation::sealed_product::Rarity;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

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
        for i in 0..5 {
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
    fn generates_a_full_sealed_deck_group() {
        let mut rng = StdRng::seed_from_u64(123);
        let cache = Arc::new(DraftRankCache::new());
        let ranker = Arc::new(CardRanker::new(cache.clone()));

        let mut gen = SealedCardPoolGenerator::new(LimitedPoolType::Full, pool()).with_full(6);
        let group = gen.generate_sealed_deck(
            "Sealed Test",
            &mut rng,
            3,
            ranker,
            cache,
            |_| ColorSet::COLORLESS,
            |c| c.rarity == Rarity::BasicLand,
        );
        assert!(group.suggested_human_deck.is_some());
        assert_eq!(group.ai_decks.len(), 3);
        let human = group.suggested_human_deck.unwrap();
        assert_eq!(human.main.len(), 40);
    }
}
