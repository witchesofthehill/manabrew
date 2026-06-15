use serde::{Deserialize, Serialize};

use crate::ability::api_type::ApiType;
use crate::ability::ProducedMana;
use crate::cost::{parse_cost, Cost};
use crate::parsing::keys;
use crate::parsing::{parse_semantic_param_value, Params, SemanticParamValue};
use forge_foundation::ZoneType;

/// A parsed activated ability from a card's A: line.
/// Mirrors Java's SpellAbility with AB$ prefix.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivatedAbility {
    /// Index of this ability in the card's abilities list.
    pub ability_index: usize,
    /// The parsed cost to activate.
    pub cost: Cost,
    /// The full raw ability text (for effect resolution reuse).
    pub ability_text: String,
    /// Whether this is a mana ability (resolves without using the stack).
    pub is_mana_ability: bool,
    /// Parsed AB$ API name.
    #[serde(default)]
    pub ability_kind: String,
    /// Parsed AB$ API type when recognized by the engine.
    #[serde(default)]
    pub ability_api: Option<ApiType>,
    /// Parsed ActivationZone$ override. Activated abilities default to battlefield.
    #[serde(default)]
    pub activation_zone: Option<ZoneType>,
    /// Lowered Produced$ mana expression.
    #[serde(default)]
    pub produced_ir: Option<ProducedMana>,
    /// Parsed RestrictValid$ value for mana abilities.
    #[serde(default)]
    pub restrict_valid: Option<String>,
    /// Parsed Amount$ value for mana abilities.
    #[serde(default)]
    pub amount: Option<String>,
    /// Parsed SpellDescription$ value for UI prompts.
    #[serde(default)]
    pub spell_description: Option<String>,
    /// Parsed PrecostDesc$ value for UI prompts.
    #[serde(default)]
    pub precost_desc: Option<String>,
    /// Parsed Description$ value for UI prompts.
    #[serde(default)]
    pub description: Option<String>,
    /// Parsed AddNoCounter$ flag for produced mana metadata.
    #[serde(default)]
    pub adds_no_counter: bool,
    /// Parsed AddsKeywords$ value for produced mana metadata.
    #[serde(default)]
    pub adds_keywords: Option<String>,
    /// Parsed AddsKeywordsValid$ value for produced mana metadata.
    #[serde(default)]
    pub adds_keywords_valid: Option<String>,
    /// Parsed AddsCounters$ value for produced mana metadata.
    #[serde(default)]
    pub adds_counters: Option<String>,
    /// Parsed AddsCountersValid$ value for produced mana metadata.
    #[serde(default)]
    pub adds_counters_valid: Option<String>,
    /// Parsed TriggersWhenSpent$ value for produced mana metadata.
    #[serde(default)]
    pub triggers_when_spent: Option<String>,
    /// Parsed SubAbility$ SVar name.
    #[serde(default)]
    pub sub_ability: Option<String>,
    /// Lowercased SpellDescription$ for activation keyword routing.
    #[serde(default)]
    pub spell_description_lower: String,
    /// Parsed GameActivationLimit$ for cheap action-space gating.
    #[serde(default)]
    pub game_activation_limit: Option<u32>,
    /// Whether this ability has PowerUp$ True.
    #[serde(default)]
    pub power_up: bool,
    /// Whether this ability has SorcerySpeed$ True.
    #[serde(default)]
    pub sorcery_speed: bool,
    /// Whether this is the synthetic Room UnlockDoor ability.
    #[serde(default)]
    pub is_unlock_door: bool,
    /// Whether this is a ManaReflected ability.
    #[serde(default)]
    pub is_mana_reflected: bool,
    /// Parsed pipe-delimited parameters.
    pub params: Params,
}

impl ActivatedAbility {
    pub fn display_description(&self, card_name: &str) -> String {
        self.spell_description
            .as_deref()
            .or(self.precost_desc.as_deref())
            .or(self.description.as_deref())
            .unwrap_or(&self.ability_text)
            .replace("CARDNAME", card_name)
    }

    pub fn cost_string(&self) -> Option<String> {
        let s = self.cost.to_simple_string();
        (!s.is_empty()).then_some(s)
    }

    pub fn produced_color_symbols(&self) -> Vec<String> {
        use crate::ability::{ProducedMana, ProducedManaCombo};
        match &self.produced_ir {
            Some(ProducedMana::Fixed(v))
            | Some(ProducedMana::Combo(ProducedManaCombo::Colors(v))) => v.clone(),
            _ => Vec::new(),
        }
    }
}

/// Parse an ability string into an ActivatedAbility, if it's an AB$ line.
/// Returns None for SP$/DB$/trigger lines.
///
/// Example AB$ lines:
/// - `"AB$ Mana | Cost$ T | Produced$ G | SpellDescription$ Add {G}."`
/// - `"AB$ DealDamage | Cost$ T | ValidTgts$ Any | NumDmg$ 1 | ..."`
/// - `"AB$ ChangeZone | Cost$ Sac<1/CARDNAME> | Origin$ Library | ..."`
pub fn parse_activated_ability(raw: &str, index: usize) -> Option<ActivatedAbility> {
    let params = Params::from_raw(raw);

    // Check if any key contains "AB" — the main key is something like "AB" with value "Mana"
    // In practice the format is "AB$ Mana | Cost$ T | ..."
    // After Params::from_raw, we get {"AB": "Mana", "Cost": "T", ...}
    let has_ab = params.has(keys::AB);
    if !has_ab {
        return None;
    }

    // Extract cost
    let cost_str = params.get(keys::COST).unwrap_or("");
    let cost = parse_cost(cost_str);

    // Determine if this is a mana ability:
    // - Effect type is "Mana"
    // - No ValidTgts$ (targeting makes it non-mana)
    // - No loyalty cost
    let ab_type = params.get(keys::AB).unwrap_or("");
    let has_targets = params.has(keys::VALID_TGTS);
    let is_planeswalker_ability = params.is_true(keys::PLANESWALKER);
    let is_mana_ability = (ab_type.eq_ignore_ascii_case("Mana")
        || ab_type.eq_ignore_ascii_case("ManaReflected"))
        && !has_targets
        && !is_planeswalker_ability;
    let activation_zone = params
        .get(keys::ACTIVATION_ZONE)
        .and_then(ZoneType::from_str_compat);
    let game_activation_limit = params
        .get(keys::GAME_ACTIVATION_LIMIT)
        .and_then(|v| v.parse::<u32>().ok());
    let power_up = params.is_true(keys::POWER_UP);
    let sorcery_speed = params.is_true(keys::SORCERY_SPEED);
    let is_unlock_door = ab_type.eq_ignore_ascii_case("UnlockDoor");
    let is_mana_reflected = ab_type.eq_ignore_ascii_case("ManaReflected");
    let ability_kind = ab_type.to_string();
    let ability_api = ApiType::smart_value_of(ab_type);
    let produced_ir = params.get(keys::PRODUCED).and_then(|raw| {
        match parse_semantic_param_value(keys::PRODUCED, raw) {
            SemanticParamValue::ProducedMana(produced) => {
                Some(ProducedMana::from_semantic(&produced))
            }
            _ => None,
        }
    });
    let restrict_valid = params.get(keys::RESTRICT_VALID).map(str::to_string);
    let amount = params.get(keys::AMOUNT).map(str::to_string);
    let spell_description = params.get(keys::SPELL_DESCRIPTION).map(str::to_string);
    let precost_desc = params.get(keys::PRECOST_DESC).map(str::to_string);
    let description = params.get(keys::DESCRIPTION).map(str::to_string);
    let adds_no_counter = params.is_true(keys::ADDS_NO_COUNTER);
    let adds_keywords = params.get(keys::ADDS_KEYWORDS).map(str::to_string);
    let adds_keywords_valid = params.get(keys::ADDS_KEYWORDS_VALID).map(str::to_string);
    let adds_counters = params.get(keys::ADDS_COUNTERS).map(str::to_string);
    let adds_counters_valid = params.get(keys::ADDS_COUNTERS_VALID).map(str::to_string);
    let triggers_when_spent = params.get(keys::TRIGGERS_WHEN_SPENT).map(str::to_string);
    let sub_ability = params.get(keys::SUB_ABILITY).map(str::to_string);
    let spell_description_lower = params
        .get(keys::SPELL_DESCRIPTION)
        .unwrap_or("")
        .to_ascii_lowercase();

    Some(ActivatedAbility {
        ability_index: index,
        cost,
        ability_text: raw.to_string(),
        is_mana_ability,
        ability_kind,
        ability_api,
        activation_zone,
        produced_ir,
        restrict_valid,
        amount,
        spell_description,
        precost_desc,
        description,
        adds_no_counter,
        adds_keywords,
        adds_keywords_valid,
        adds_counters,
        adds_counters_valid,
        triggers_when_spent,
        sub_ability,
        spell_description_lower,
        game_activation_limit,
        power_up,
        sorcery_speed,
        is_unlock_door,
        is_mana_reflected,
        params,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_llanowar_elves_mana_ability() {
        let raw = "AB$ Mana | Cost$ T | Produced$ G | SpellDescription$ Add {G}.";
        let ab = parse_activated_ability(raw, 0).unwrap();
        assert!(ab.is_mana_ability);
        assert!(ab.cost.has_tap);
        assert_eq!(
            ab.produced_ir
                .as_ref()
                .map(ProducedMana::as_script_text)
                .as_deref(),
            Some("G")
        );
    }

    #[test]
    fn parse_planeswalker_mana_ability_uses_stack() {
        let raw = "AB$ Mana | Cost$ AddCounter<0/LOYALTY> | Planeswalker$ True | Produced$ C | Amount$ 3 | SpellDescription$ Add {C}{C}{C}.";
        let ab = parse_activated_ability(raw, 0).unwrap();
        assert!(!ab.is_mana_ability);
    }

    #[test]
    fn parse_prodigal_sorcerer_non_mana() {
        let raw = "AB$ DealDamage | Cost$ T | ValidTgts$ Any | NumDmg$ 1 | SpellDescription$ CARDNAME deals 1 damage to any target.";
        let ab = parse_activated_ability(raw, 0).unwrap();
        let ActivatedAbility {
            params: raw_params, ..
        } = &ab;
        assert!(!ab.is_mana_ability);
        assert!(ab.cost.has_tap);
        assert_eq!(raw_params.get(keys::NUM_DMG).unwrap(), "1");
    }

    #[test]
    fn parse_sakura_tribe_elder_sacrifice() {
        let raw = "AB$ ChangeZone | Cost$ Sac<1/CARDNAME> | Origin$ Library | Destination$ Battlefield | Tapped$ True | ChangeType$ Land.Basic | SpellDescription$ Search for a basic land.";
        let ab = parse_activated_ability(raw, 0).unwrap();
        let ActivatedAbility {
            params: raw_params, ..
        } = &ab;
        assert!(!ab.is_mana_ability);
        assert!(!ab.cost.has_tap);
        assert_eq!(raw_params.get(keys::ORIGIN).unwrap(), "Library");
        assert_eq!(raw_params.get(keys::DESTINATION).unwrap(), "Battlefield");
    }

    #[test]
    fn sp_line_returns_none() {
        let raw = "SP$ DealDamage | ValidTgts$ Any | NumDmg$ 3 | SpellDescription$ test";
        assert!(parse_activated_ability(raw, 0).is_none());
    }

    #[test]
    fn db_line_returns_none() {
        let raw = "DB$ Draw | Defined$ You | NumCards$ 2";
        assert!(parse_activated_ability(raw, 0).is_none());
    }
}
