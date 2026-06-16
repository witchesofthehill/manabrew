use rand::seq::SliceRandom;
use rand::Rng;

use super::paper_card::PaperCard;
use super::sealed_template::SealedTemplate;
use super::unopened_product::IUnOpenedProduct;
use crate::edition::EditionsRegistry;

pub struct ChaosBoosterSupplier {
    sets: Vec<(String, SealedTemplate, Vec<PaperCard>)>,
    bag: Vec<usize>,
}

impl ChaosBoosterSupplier {
    pub fn new(sets: Vec<(String, SealedTemplate, Vec<PaperCard>)>) -> Self {
        assert!(
            !sets.is_empty(),
            "ChaosBoosterSupplier needs at least one set to draw from"
        );
        Self {
            sets,
            bag: Vec::new(),
        }
    }

    pub fn from_codes<F>(editions: &EditionsRegistry, codes: &[&str], pool_for: F) -> Self
    where
        F: Fn(&str) -> Vec<PaperCard>,
    {
        let mut sets = Vec::new();
        for code in codes {
            let edition = match editions.get(code) {
                Some(e) => e,
                None => {
                    eprintln!("[chaos_booster] edition `{code}` not registered");
                    continue;
                }
            };
            let template = match edition.to_sealed_template() {
                Some(t) => t,
                None => {
                    eprintln!("[chaos_booster] edition `{code}` has no Booster recipe");
                    continue;
                }
            };
            let pool = pool_for(code);
            sets.push((code.to_string(), template, pool));
        }
        Self::new(sets)
    }

    pub fn set_count(&self) -> usize {
        self.sets.len()
    }

    pub fn bag_empty(&self) -> bool {
        self.bag.is_empty()
    }

    fn refill_bag<R: Rng + ?Sized>(&mut self, rng: &mut R) {
        self.bag = (0..self.sets.len()).collect();
        self.bag.shuffle(rng);
    }
}

impl IUnOpenedProduct for ChaosBoosterSupplier {
    fn open<R: Rng + ?Sized>(&mut self, rng: &mut R) -> Vec<PaperCard> {
        if self.bag.is_empty() {
            self.refill_bag(rng);
        }
        let idx = self.bag.pop().expect("bag refilled but still empty");
        let (_code, template, pool) = &self.sets[idx];
        super::booster_generator::BoosterGenerator::get_booster_pack(template, pool, rng)
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
        for i in 0..30 {
            v.push(PaperCard::new(
                format!("Common {i}"),
                "TST",
                format!("c{i}"),
                Rarity::Common,
            ));
        }
        for i in 0..6 {
            v.push(PaperCard::new(
                format!("Rare {i}"),
                "TST",
                format!("r{i}"),
                Rarity::Rare,
            ));
        }
        v
    }

    #[test]
    fn bag_visits_each_set_before_repeating() {
        let mut tpl = SealedTemplate::generic_no_slot_booster();
        tpl.foil_chance = 0.0;
        tpl.foil_type = super::super::foil_type::FoilType::NotSupported;
        let sets = vec![
            ("AAA".to_string(), tpl.clone(), pool()),
            ("BBB".to_string(), tpl.clone(), pool()),
            ("CCC".to_string(), tpl, pool()),
        ];
        let mut supp = ChaosBoosterSupplier::new(sets);
        let mut rng = StdRng::seed_from_u64(0);
        for _ in 0..3 {
            assert_eq!(supp.open(&mut rng).len(), 15);
        }
        assert!(
            supp.bag_empty(),
            "bag should be drained after one set per pack"
        );
    }
}
