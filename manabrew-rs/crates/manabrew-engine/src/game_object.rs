use crate::card::Card;
use crate::card_trait_base::CardTraitBase;
use crate::ids::PlayerId;
use crate::spellability::SpellAbility;

pub trait GameObject {
    fn can_be_targeted_by(&self, _sa: &SpellAbility) -> bool {
        false
    }

    fn is_valid(
        &self,
        restrictions: &[String],
        source_controller: PlayerId,
        source: &Card,
        spell_ability: &CardTraitBase,
    ) -> bool {
        for restriction in restrictions {
            if self.is_valid_single(restriction, source_controller, source, spell_ability) {
                return true;
            }
        }
        false
    }

    fn is_valid_single(
        &self,
        _restriction: &str,
        _source_controller: PlayerId,
        _source: &Card,
        _spell_ability: &CardTraitBase,
    ) -> bool {
        false
    }

    fn has_property(
        &self,
        _property: &str,
        _source_controller: PlayerId,
        _source: &Card,
        _spell_ability: &CardTraitBase,
    ) -> bool {
        false
    }
}
