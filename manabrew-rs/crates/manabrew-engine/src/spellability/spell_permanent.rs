//! SpellPermanent -- factory for permanent spells.
//! Mirrors Java's `SpellPermanent.java`.
//! Creates SpellAbility instances configured as permanent spells (creatures
//! and non-creatures) that resolve by moving to the battlefield.

use std::collections::HashMap;

use crate::ability::api_type::ApiType;
use crate::ids::{CardId, PlayerId};
use crate::spellability::target_choices::TargetChoices;
use crate::spellability::{SpellAbility, SpellAbilityCondition, SpellAbilityRestriction};

/// Create a SpellAbility configured as a permanent spell.
/// Mirrors Java's `SpellPermanent` constructor.
///
/// - `card_id`: The card being cast.
/// - `is_creature`: If true, the API type is `PermanentCreature`; otherwise
///   `PermanentNoncreature`.
/// - `player`: The casting player.
pub fn create_permanent_spell(
    card_id: CardId,
    is_creature: bool,
    player: PlayerId,
) -> SpellAbility {
    let api = if is_creature {
        ApiType::PermanentCreature
    } else {
        ApiType::PermanentNoncreature
    };

    SpellAbility {
        id: 0,
        api: Some(api),
        source: Some(card_id),
        original_host: None,
        activating_player: player,
        targeting_player: None,
        ability_text: String::new(),
        record_type: crate::ability::ability_factory::AbilityRecordType::Spell,
        ir: crate::ability::ability_ir::SpellAbilityIr::default(),
        target_restrictions: None,
        target_chosen: TargetChoices::default(),
        pay_costs: None,
        sub_ability: None,
        wrapped_ability: None,
        is_spell: true,
        is_trigger: false,
        is_activated: false,
        intrinsic: false,
        trigger_source: None,
        trigger_source_zone_timestamp: None,
        source_zone_timestamp: None,
        source_trigger_id: None,
        trigger_index: None,
        alt_cost: None,
        alt_cost_index: 0,
        evoke_keyword_count: 0,
        kicked: false,
        buyback_paid: false,
        overloaded: false,
        is_copy: false,
        paid_life_amount: 0,
        kick_count: 0,
        replicate_count: 0,
        optional_generic_cost_paid: false,
        trigger_remembered_amount: 0,
        x_mana_cost_paid: 0,
        discarded_cost_cards: Vec::new(),
        optional_costs: Vec::new(),
        paid_hash: HashMap::new(),
        paying_mana: Vec::new(),
        paid_abilities: Vec::new(),
        mana_part: None,
        express_mana_choice: None,
        convoke_tapped: Vec::new(),
        spliced_cards: Vec::new(),
        announce_vars: HashMap::new(),
        sacrificed_as_emerge: None,
        sacrificed_as_offering: None,
        description: String::new(),
        stack_description: String::new(),
        is_mana_ability: false,
        is_land_ability: false,
        cast_face_down: false,
        trigger_objects: HashMap::new(),
        trigger_spell_abilities: HashMap::new(),
        additional_ability_lists: HashMap::new(),
        replacing_objects: HashMap::new(),
        trigger_remembered: Vec::new(),
        restriction: SpellAbilityRestriction::default(),
        condition: SpellAbilityCondition::default(),
        rollback_effects: Vec::new(),
        optional_keyword_amounts: HashMap::new(),
        pips_to_reduce: Vec::new(),
        may_choose_new_targets: false,
        last_state: HashMap::new(),
        change_zone_table: None,
        damage_map: None,
        prevent_map: None,
    }
}
