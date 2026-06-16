use rand::Rng;

use super::paper_card::PaperCard;

#[derive(Debug, Clone)]
pub struct PrintSheet {
    name: String,
    cards_with_weights: Vec<(PaperCard, u32)>,
}

impl PrintSheet {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            cards_with_weights: Vec::new(),
        }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn is_empty(&self) -> bool {
        self.cards_with_weights.is_empty()
    }

    pub fn count_distinct(&self) -> usize {
        self.cards_with_weights.len()
    }

    pub fn count_all(&self) -> u32 {
        self.cards_with_weights.iter().map(|(_, w)| *w).sum()
    }

    pub fn contains(&self, pc: &PaperCard) -> bool {
        self.cards_with_weights.iter().any(|(c, _)| c == pc)
    }

    pub fn add(&mut self, card: PaperCard) {
        self.add_weighted(card, 1);
    }

    pub fn add_weighted(&mut self, card: PaperCard, weight: u32) {
        if weight == 0 {
            return;
        }
        if let Some(entry) = self.cards_with_weights.iter_mut().find(|(c, _)| c == &card) {
            entry.1 += weight;
        } else {
            self.cards_with_weights.push((card, weight));
        }
    }

    pub fn add_all<I: IntoIterator<Item = PaperCard>>(&mut self, cards: I) {
        self.add_all_weighted(cards, 1);
    }

    pub fn add_all_weighted<I: IntoIterator<Item = PaperCard>>(&mut self, cards: I, weight: u32) {
        for c in cards {
            self.add_weighted(c, weight);
        }
    }

    pub fn remove<'a, I: IntoIterator<Item = &'a PaperCard>>(&mut self, cards: I) {
        for c in cards {
            self.cards_with_weights.retain(|(card, _)| card != c);
        }
    }

    pub fn to_flat_list(&self) -> Vec<PaperCard> {
        let mut out = Vec::with_capacity(self.count_all() as usize);
        for (card, w) in &self.cards_with_weights {
            for _ in 0..*w {
                out.push(card.clone());
            }
        }
        out
    }

    pub fn random<R: Rng + ?Sized>(
        &self,
        number: usize,
        want_unique: bool,
        rng: &mut R,
    ) -> Vec<PaperCard> {
        let mut result: Vec<PaperCard> = Vec::with_capacity(number);
        let total_weight = self.count_all();
        if total_weight == 0 {
            return result;
        }

        let unique_cards = self.count_distinct();
        let mut remaining = number;

        while unique_cards > 0 && remaining >= unique_cards {
            for (card, _) in &self.cards_with_weights {
                result.push(card.clone());
            }
            remaining -= unique_cards;
        }

        let mut uniques: Vec<PaperCard> = Vec::new();
        for _ in 0..remaining {
            let index = rng.gen_range(0..total_weight);
            let to_skip = if want_unique { Some(&uniques) } else { None };
            let picked = self.fetch_roulette(0, index, to_skip);
            if let Some(card) = picked {
                if want_unique {
                    uniques.push(card.clone());
                }
                result.push(card);
            }
        }
        result
    }

    pub fn pick_one<R: Rng + ?Sized>(&self, rng: &mut R) -> Option<PaperCard> {
        self.random(1, false, rng).into_iter().next()
    }

    fn fetch_roulette(
        &self,
        start: u32,
        roulette: u32,
        to_skip: Option<&Vec<PaperCard>>,
    ) -> Option<PaperCard> {
        let mut sum = start;
        let is_second_run = start > 0;
        for (card, weight) in &self.cards_with_weights {
            sum = sum.saturating_add(*weight);
            if sum > roulette {
                if let Some(skip) = to_skip {
                    if skip.contains(card) {
                        continue;
                    }
                }
                return Some(card.clone());
            }
        }
        if is_second_run {
            return None;
        }
        self.fetch_roulette(sum + 1, roulette, to_skip)
    }
}

#[cfg(test)]
mod tests {
    use super::super::rarity::Rarity;
    use super::*;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    fn rare(i: u32) -> PaperCard {
        PaperCard::new(format!("Rare {i}"), "TST", format!("r{i}"), Rarity::Rare)
    }
    fn mythic(i: u32) -> PaperCard {
        PaperCard::new(
            format!("Mythic {i}"),
            "TST",
            format!("m{i}"),
            Rarity::Mythic,
        )
    }

    #[test]
    fn weighted_picks_match_ratio() {
        let mut sheet = PrintSheet::new("RareMythic test");
        for i in 0..15 {
            sheet.add_weighted(mythic(i), 1);
        }
        for i in 0..53 {
            sheet.add_weighted(rare(i), 2);
        }
        assert_eq!(sheet.count_all(), 15 + 53 * 2);

        let mut rng = StdRng::seed_from_u64(1);
        let trials = 60;
        let per_trial = 50;
        let total = trials * per_trial;
        let mut mythic_count = 0;
        for _ in 0..trials {
            let picks = sheet.random(per_trial, false, &mut rng);
            mythic_count += picks.iter().filter(|c| c.rarity == Rarity::Mythic).count();
        }
        let ratio = mythic_count as f64 / total as f64;
        assert!(
            (0.09..0.16).contains(&ratio),
            "mythic ratio off: {ratio} (expected ~0.124)"
        );
    }

    #[test]
    fn unique_picks_drain_sheet() {
        let mut sheet = PrintSheet::new("uniques");
        for i in 0..3 {
            sheet.add(rare(i));
        }
        let mut rng = StdRng::seed_from_u64(0);
        let picks = sheet.random(3, true, &mut rng);
        assert_eq!(picks.len(), 3);
        let unique: std::collections::HashSet<_> = picks.iter().collect();
        assert_eq!(unique.len(), 3);
    }
}
