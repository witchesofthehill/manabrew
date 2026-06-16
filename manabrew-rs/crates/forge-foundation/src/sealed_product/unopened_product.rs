use rand::Rng;

use super::booster_generator::BoosterGenerator;
use super::paper_card::PaperCard;
use super::sealed_template::SealedTemplate;

pub trait IUnOpenedProduct {
    fn open<R: Rng + ?Sized>(&mut self, rng: &mut R) -> Vec<PaperCard>;
}

pub struct UnOpenedProduct {
    template: SealedTemplate,
    pool: Vec<PaperCard>,
    pool_limited: bool,
}

impl UnOpenedProduct {
    pub fn new(template: SealedTemplate, pool: Vec<PaperCard>) -> Self {
        Self {
            template,
            pool,
            pool_limited: false,
        }
    }

    pub fn template(&self) -> &SealedTemplate {
        &self.template
    }

    pub fn pool(&self) -> &[PaperCard] {
        &self.pool
    }

    pub fn set_limited_pool(&mut self, limited: bool) {
        self.pool_limited = limited;
    }

    pub fn is_pool_limited(&self) -> bool {
        self.pool_limited
    }
}

impl IUnOpenedProduct for UnOpenedProduct {
    fn open<R: Rng + ?Sized>(&mut self, rng: &mut R) -> Vec<PaperCard> {
        let pack = BoosterGenerator::get_booster_pack(&self.template, &self.pool, rng);

        if self.pool_limited && !pack.is_empty() {
            let to_remove: Vec<PaperCard> = pack
                .iter()
                .map(|c| {
                    let mut copy = c.clone();
                    copy.foil = false;
                    copy
                })
                .collect();
            self.pool.retain(|c| !to_remove.contains(c));
        }

        pack
    }
}

#[cfg(test)]
mod tests {
    use super::super::rarity::Rarity;
    use super::*;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    fn pool() -> Vec<PaperCard> {
        let mut v = Vec::new();
        for i in 0..40 {
            v.push(PaperCard::new(
                format!("Common {i}"),
                "TST",
                format!("c{i}"),
                Rarity::Common,
            ));
        }
        for i in 0..15 {
            v.push(PaperCard::new(
                format!("Uncommon {i}"),
                "TST",
                format!("u{i}"),
                Rarity::Uncommon,
            ));
        }
        for i in 0..8 {
            v.push(PaperCard::new(
                format!("Rare {i}"),
                "TST",
                format!("r{i}"),
                Rarity::Rare,
            ));
        }
        for i in 0..5 {
            v.push(PaperCard::new(
                format!("Land {i}"),
                "TST",
                format!("l{i}"),
                Rarity::BasicLand,
            ));
        }
        v
    }

    #[test]
    fn opens_six_packs_for_sealed() {
        let mut rng = StdRng::seed_from_u64(7);
        let mut prod = UnOpenedProduct::new(SealedTemplate::generic_draft_booster(), pool());
        let mut total = 0;
        for _ in 0..6 {
            total += prod.open(&mut rng).len();
        }
        assert_eq!(total, 90);
    }
}
