use std::collections::HashMap;

use rand::Rng;
use serde::{Deserialize, Serialize};

use super::booster_slot::BoosterSlot;
use super::booster_slots::BoosterSlots;
use super::foil_type::FoilType;
use super::sealed_template::SealedTemplate;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SealedTemplateWithSlots {
    pub template: SealedTemplate,
    pub named_slots: HashMap<String, BoosterSlot>,
}

impl SealedTemplateWithSlots {
    pub fn new(template: SealedTemplate, named_slots: HashMap<String, BoosterSlot>) -> Self {
        Self {
            template,
            named_slots,
        }
    }

    pub fn resolve<R: Rng + ?Sized>(&self, rng: &mut R) -> SealedTemplate {
        let mut resolved = self.template.clone();
        for (slot_name, count) in resolved.slots.iter_mut() {
            if let Some(slot) = self.named_slots.get(slot_name) {
                if let Some(replacement) = slot.replace_slot(rng) {
                    *slot_name = replacement;
                }
            }
            let _ = count;
        }
        resolved
    }

    pub fn generic_modern_with_showcase() -> Self {
        let mut named_slots = HashMap::new();
        named_slots.insert(
            "BonusRare".to_string(),
            BoosterSlot::parse_slot(
                "BonusRare",
                &[
                    format!("Base={}", BoosterSlots::RARE_MYTHIC),
                    format!("Replace=1% {}", BoosterSlots::SPECIAL),
                ],
            ),
        );
        let mut tpl = SealedTemplate::new(
            Some("MODERN_SHOWCASE".to_string()),
            vec![
                (BoosterSlots::COMMON.to_string(), 10),
                (BoosterSlots::UNCOMMON.to_string(), 3),
                ("BonusRare".to_string(), 1),
                (BoosterSlots::BASIC_LAND.to_string(), 1),
            ],
        );
        tpl.foil_chance = 1.0 / 3.0;
        tpl.foil_type = FoilType::Modern;
        Self::new(tpl, named_slots)
    }
}

#[cfg(test)]
mod tests {
    use super::super::booster_generator::BoosterGenerator;
    use super::super::paper_card::PaperCard;
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
        for i in 0..10 {
            v.push(PaperCard::new(
                format!("Uncommon {i}"),
                "TST",
                format!("u{i}"),
                Rarity::Uncommon,
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
        for i in 0..3 {
            v.push(PaperCard::new(
                format!("Mythic {i}"),
                "TST",
                format!("m{i}"),
                Rarity::Mythic,
            ));
        }
        for i in 0..3 {
            v.push(PaperCard::new(
                format!("Showcase {i}"),
                "TST",
                format!("s{i}"),
                Rarity::Special,
            ));
        }
        for i in 0..2 {
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
    fn modern_with_showcase_opens_15_card_packs() {
        let template = SealedTemplateWithSlots::generic_modern_with_showcase();
        let pool = pool();
        let mut rng = StdRng::seed_from_u64(42);
        for _ in 0..50 {
            let pack = BoosterGenerator::get_booster_pack_with_slots(&template, &pool, &mut rng);
            assert!(
                pack.len() >= 14 && pack.len() <= 16,
                "pack size off: {}",
                pack.len()
            );
            let lands = pack
                .iter()
                .filter(|c| c.rarity == Rarity::BasicLand)
                .count();
            assert_eq!(lands, 1, "expected 1 basic land");
        }
    }
}
