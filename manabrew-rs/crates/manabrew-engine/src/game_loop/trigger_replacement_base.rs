use std::collections::HashMap;

use forge_foundation::ZoneType;

use crate::card::card_state::CardState;
use crate::card_trait_base::CardTraitBase;
use crate::core::Identifiable;
use crate::game::GameState;
use crate::ids::CardId;
use crate::keyword::keyword_interface::KeywordInterface;
use crate::spellability::SpellAbility;
use serde::{Deserialize, Serialize};

/// Port of Java `TriggerReplacementBase`.
///
/// Java:
/// `public abstract class TriggerReplacementBase extends CardTraitBase implements IIdentifiable, Cloneable`
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TriggerReplacementBase {
    pub card_trait_base: CardTraitBase,
    pub valid_host_zones: Option<Vec<ZoneType>>,
    pub overriding_ability: Option<SpellAbility>,
}

impl Identifiable for TriggerReplacementBase {
    fn id(&self) -> i32 {
        self.card_trait_base.id()
    }
}

impl TriggerReplacementBase {
    pub fn set_host_card_id(&mut self, id: CardId) {
        self.card_trait_base.set_host_card_id(id);
        if let Some(overriding_ability) = self.overriding_ability.as_mut() {
            overriding_ability.set_host_card_id(id);
        }
    }

    pub fn set_keyword(&mut self, kw: KeywordInterface) {
        self.card_trait_base.set_keyword(kw.clone());
        if let Some(overriding_ability) = self.overriding_ability.as_mut() {
            overriding_ability.set_keyword(kw);
        }
    }

    pub fn set_card_state(&mut self, state: CardState) {
        self.card_trait_base.set_card_state(&state);
        if let Some(overriding_ability) = self.overriding_ability.as_mut() {
            overriding_ability.set_card_state(&state);
        }
    }

    pub fn get_active_zone(&self) -> Option<&[ZoneType]> {
        self.valid_host_zones.as_deref()
    }

    pub fn set_active_zone(&mut self, zones: Vec<ZoneType>) {
        self.valid_host_zones = Some(zones);
    }

    pub fn zones_check(&self, game: &GameState, host_card_zone: Option<ZoneType>) -> bool {
        !self.card_trait_base.host_card(game).phased_out
            && (self.valid_host_zones.is_none()
                || self
                    .valid_host_zones
                    .as_ref()
                    .is_some_and(|zones| zones.is_empty())
                || (host_card_zone.is_some()
                    && self
                        .valid_host_zones
                        .as_ref()
                        .is_some_and(|zones| zones.contains(&host_card_zone.unwrap()))))
    }

    pub fn get_overriding_ability(&self) -> Option<&SpellAbility> {
        self.overriding_ability.as_ref()
    }

    pub fn set_overriding_ability(&mut self, overriding_ability: SpellAbility) {
        self.overriding_ability = Some(overriding_ability);
        if let Some(ability) = self.overriding_ability.as_mut() {
            ability.set_host_card_id(self.card_trait_base.host_card_id());
            if let Some(keyword) = self.card_trait_base.get_keyword().cloned() {
                ability.set_keyword(keyword);
            }
            ability.set_intrinsic(self.card_trait_base.is_intrinsic());
        }
    }

    /// Port of Java `ensureAbility()`.
    ///
    /// The Java base type is abstract and concrete trigger/replacement classes
    /// may lazily populate the overriding ability. In the current Rust port,
    /// the base owns the resolved ability directly, so `ensure_ability`
    /// returns the stored ability when present.
    pub fn ensure_ability(&mut self) -> Option<&mut SpellAbility> {
        self.overriding_ability.as_mut()
    }

    pub fn change_text(&mut self) {
        if !self.card_trait_base.is_intrinsic() {
            return;
        }
        self.card_trait_base.change_text();

        let changed_text_pairs = self.card_trait_base.changed_text_pairs();
        if let Some(sa) = self.ensure_ability() {
            sa.apply_text_changes(&changed_text_pairs);
        }
    }

    pub fn change_text_intrinsic(
        &mut self,
        color_map: HashMap<String, String>,
        type_map: HashMap<String, String>,
    ) {
        self.card_trait_base
            .change_text_intrinsic(color_map.clone(), type_map.clone());

        if let Some(sa) = self.ensure_ability() {
            sa.apply_text_changes_intrinsic(&color_map, &type_map);
        }
    }
}
