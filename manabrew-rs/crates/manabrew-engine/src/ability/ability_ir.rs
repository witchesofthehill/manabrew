use std::collections::BTreeMap;

use crate::ability::ProducedMana;
use crate::card::counter_type::parse_counter_type;
use crate::card::valid_filter::CardTraitRequirementsIr;
use crate::card::CounterType;
use crate::parsing::amount::AmountExpr;
use crate::parsing::{
    keys, parse_semantic_param_value, split_param_list_value, CompiledSelector, Params,
    ParsedParams, SemanticParamValue,
};
use crate::spellability::{AbilityDuration, ReplaceDyingCondition, SpellAbilityMode};
use forge_foundation::ZoneType;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EffectIr {
    DamageAll(NumericAmountIr),
    DealDamage(DealDamageIr),
    Draw(NumericAmountIr),
    GainLife(NumericAmountIr),
    LifeSet(NumericAmountIr),
    LoseLife(NumericAmountIr),
    Mill(NumericAmountIr),
    Poison(NumericAmountIr),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DayTimeValue {
    Day,
    Night,
    Switch,
}

impl DayTimeValue {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "Day" => Some(Self::Day),
            "Night" => Some(Self::Night),
            "Switch" => Some(Self::Switch),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DebuffAllSuffixKeywords {
    Walk,
}

impl DebuffAllSuffixKeywords {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "walk" => Some(Self::Walk),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DebuffIr {
    pub num_present: bool,
    pub keywords: Vec<String>,
    pub all_suffix_keywords: Option<DebuffAllSuffixKeywords>,
}

impl DebuffIr {
    pub fn from_parsed(params: &ParsedParams<'_>) -> Self {
        Self {
            num_present: params.has(keys::NUM),
            keywords: split_param_list_value(params.get(keys::KEYWORDS), " & "),
            all_suffix_keywords: params
                .get(keys::ALL_SUFFIX_KEYWORDS)
                .and_then(DebuffAllSuffixKeywords::parse),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SpellAbilityIr {
    pub card_trait_requirements: CardTraitRequirementsIr,
    pub effect: Option<EffectIr>,
    pub mode_text: Option<String>,
    pub discard_mode: Option<crate::ability::effects::discard_effect::DiscardMode>,
    pub produced_ir: Option<ProducedMana>,
    pub reflect_property: Option<String>,
    pub color_or_type: Option<String>,
    pub restrict_valid: Option<String>,
    pub valid_filter_text: Option<String>,
    pub valid_filter_selector: Option<CompiledSelector>,
    pub adds_keywords: Option<String>,
    pub adds_keywords_valid: Option<String>,
    pub adds_counters: Option<String>,
    pub adds_counters_valid: Option<String>,
    pub triggers_when_spent: Option<String>,
    pub valid_cards_text: Option<String>,
    pub valid_cards_selector: Option<CompiledSelector>,
    pub valid_card_text: Option<String>,
    pub valid_card_selector: Option<CompiledSelector>,
    pub valid_players_text: Option<String>,
    pub valid_players_selector: Option<CompiledSelector>,
    pub valid_player_text: Option<String>,
    pub valid_player_selector: Option<CompiledSelector>,
    pub valid_tgts_text: Option<String>,
    pub valid_tgts_selector: Option<CompiledSelector>,
    pub valid_target_text: Option<String>,
    pub valid_target_selector: Option<CompiledSelector>,
    pub all_valid_text: Option<String>,
    pub all_valid_selector: Option<CompiledSelector>,
    pub defined_name_text: Option<String>,
    pub set_chosen_number: Option<String>,
    pub starting_with: Option<String>,
    pub repeat: Option<String>,
    pub branch_condition_svar: Option<String>,
    pub branch_condition_svar_compare: Option<String>,
    pub true_sub_ability: Option<String>,
    pub false_sub_ability: Option<String>,
    pub play_cost_text: Option<String>,
    pub unless_cost: Option<String>,
    pub amount: Option<String>,
    pub counter_num_text: Option<String>,
    pub max_repeat: Option<String>,
    pub precost_desc: Option<String>,
    pub token_amount: Option<String>,
    pub sac_valid: Option<String>,
    pub defined: Option<DefinedExpr>,
    pub defined_player: Option<DefinedExpr>,
    pub defined_text: Option<String>,
    pub defined_player_text: Option<String>,
    pub controller_text: Option<String>,
    pub effect_owner: Option<DefinedExpr>,
    pub effect_owner_text: Option<String>,
    pub origin_text: Option<String>,
    pub origin_zone: Option<ZoneType>,
    pub origin_zones: Vec<ZoneType>,
    pub destination_text: Option<String>,
    pub destination_zone: Option<ZoneType>,
    pub destination_zone_2: Option<ZoneType>,
    pub zone1: Option<ZoneType>,
    pub zone2: Option<ZoneType>,
    pub change_type: Option<String>,
    pub change_type_selector: Option<CompiledSelector>,
    pub primary_text: Option<String>,
    pub secondary_text: Option<String>,
    pub secondary_type_text: Option<String>,
    pub library_position: Option<String>,
    pub library_position_2: Option<String>,
    pub library_position_alternative: Option<String>,
    pub shuffle_raw: Option<String>,
    pub no_shuffle: bool,
    pub mandatory: bool,
    pub toggle: bool,
    pub can_repeat_modes: bool,
    pub entwine: bool,
    pub skip_untap: bool,
    pub tapped: bool,
    pub shuffle: bool,
    pub optional: bool,
    pub gain_control: bool,
    pub gain_control_text: Option<String>,
    pub forget_changed: bool,
    pub adds_no_counter: bool,
    pub no_regen: bool,
    pub damage_map: bool,
    pub remember_damaged_creature: bool,
    pub num_dmg_present: bool,
    pub boon: bool,
    pub unique: bool,
    pub exile_on_moved: bool,
    pub forget_on_phased_in: bool,
    pub forget_counter: bool,
    pub radiance: bool,
    pub chooser: Option<String>,
    pub gains: Option<String>,
    pub choices: Option<String>,
    pub choices_selector: Option<CompiledSelector>,
    pub debuff: DebuffIr,
    pub for_each_text: Option<String>,
    pub exclude: Option<String>,
    pub object_text: Option<String>,
    pub source_text: Option<String>,
    pub attached_to: Option<String>,
    pub attached_to_player_text: Option<String>,
    pub attach_after_text: Option<String>,
    pub destination_alternative: Option<String>,
    pub select_prompt: Option<String>,
    pub sub_ability_name: Option<String>,
    pub name_text: Option<String>,
    pub names_text: Option<String>,
    pub choose_from_list_text: Option<String>,
    pub choose_from_defined_cards: bool,
    pub stack_id: Option<u32>,
    pub token_script: Option<String>,
    pub token_owner: Option<String>,
    pub token_name_text: Option<String>,
    pub token_power: Option<i32>,
    pub token_toughness: Option<i32>,
    pub token_types_text: Option<String>,
    pub token_colors_text: Option<String>,
    pub token_keywords_text: Option<String>,
    pub token_until_text: Option<String>,
    pub keyword_text: Option<String>,
    pub with_counters_type_text: Option<String>,
    pub with_counters_type: Option<CounterType>,
    pub with_counters_amount_text: Option<String>,
    pub change_num: usize,
    pub hidden: bool,
    pub skip_reorder: bool,
    pub secretly: bool,
    pub random_chosen: bool,
    pub forget_other_remembered: bool,
    pub remember_changed: bool,
    pub imprint: bool,
    pub face_down: bool,
    pub exile_face_down: bool,
    pub transformed: bool,
    pub at_random_text: Option<String>,
    pub at_random: bool,
    pub reveal: bool,
    pub reveal_true: bool,
    pub reveal_text: Option<String>,
    pub remember_drawn: bool,
    pub remember_removed_cards: bool,
    pub remember_destroyed: bool,
    pub remember_abandoned: bool,
    pub may_shuffle: bool,
    pub remember_altered: bool,
    pub alter_attribute_activate: bool,
    pub alter_attribute_attributes: Vec<String>,
    pub remember_amass: bool,
    pub remember_flag: bool,
    pub remember_chosen: bool,
    pub imprint_chosen: bool,
    pub remember_clasher: bool,
    pub remember_cloaked: bool,
    pub remember_discovered: bool,
    pub remember_drafted: bool,
    pub remember_exchanged: bool,
    pub remember_investigating_players: bool,
    pub remember_made: bool,
    pub always_remember: bool,
    pub remember_milled: bool,
    pub change_zone_table: bool,
    pub at_eot: Option<String>,
    pub execute: Option<String>,
    pub replace_with_text: Option<String>,
    pub damage_amount_text: Option<String>,
    pub counter_type_text: Option<String>,
    pub counter_type: Option<CounterType>,
    pub simple_counter_type_choice_path: bool,
    pub modular: bool,
    pub adapt: bool,
    pub monstrosity: bool,
    pub bloodthirst: bool,
    pub renown: bool,
    pub abilities: Option<String>,
    pub replacement_effects: Option<String>,
    pub static_abilities: Option<String>,
    pub triggers: Option<String>,
    pub imprint_cards: Option<String>,
    pub remember_spell: Option<String>,
    pub remember_lki: Option<String>,
    pub remember_targets: bool,
    pub forget_other_targets: bool,
    pub remember_cost_mana: bool,
    pub forget_on_moved_text: Option<String>,
    pub forget_on_moved_zone: Option<ZoneType>,
    pub replace_dying_defined: Option<DefinedExpr>,
    pub replace_dying_defined_text: Option<String>,
    pub replace_dying_valid: Option<String>,
    pub replace_dying_zone_text: Option<String>,
    pub replace_dying_zone: Option<ZoneType>,
    pub remember_objects: Option<String>,
    /// `RememberObjects$ Remembered` — lowered from the `" & "`-separated list
    /// (Java splits on `" & "`) so runtime sites read a bool instead of
    /// re-splitting the raw string.
    pub remember_objects_remembered: bool,
    /// `RememberObjects$ RememberedController` (Arcane Denial, Sudden
    /// Substitution).
    pub remember_objects_remembered_controller: bool,
    /// `RememberObjects$ RememberedLKI`.
    pub remember_objects_remembered_lki: bool,
    /// `RememberObjects$ TriggeredAttackerLKICopy` (Teferi's Veil).
    pub remember_objects_triggered_attacker_lki_copy: bool,
    pub remember_number: bool,
    pub remember_svar_amount: Option<String>,
    pub remember_exiled: bool,
    pub delayed_trigger_defined_player: Option<DefinedExpr>,
    pub delayed_trigger_defined_player_text: Option<String>,
    pub this_turn: bool,
    pub condition_hellbent: bool,
    pub condition_threshold: bool,
    pub condition_metalcraft: bool,
    pub condition_delirium: bool,
    pub condition_revolt: bool,
    pub condition_desert: bool,
    pub condition_blessing: bool,
    pub condition_kicked: bool,
    pub condition_optional_paid: bool,
    pub condition_optional_not_paid: bool,
    pub condition_opponent_turn: bool,
    pub condition_player_turn: Option<String>,
    pub condition_cards_in_hand: Option<String>,
    pub condition_phases: Option<String>,
    pub condition_life_compare: Option<String>,
    pub condition: Option<String>,
    pub condition_check_svar: Option<String>,
    pub condition_svar_compare: Option<String>,
    pub condition_present: Option<String>,
    pub condition_defined: Option<DefinedExpr>,
    pub condition_defined_text: Option<String>,
    pub condition_compare: Option<String>,
    pub condition_zone_text: Option<String>,
    pub condition_zone: Option<ZoneType>,
    pub optional_present: bool,
    pub remove_from_combat: bool,
    pub num_att: Option<String>,
    pub num_def: Option<String>,
    pub types_text: Option<String>,
    pub add_types: Option<String>,
    pub set_color: Option<String>,
    pub set_power: Option<String>,
    pub set_toughness: Option<String>,
    pub set_mana_cost: Option<String>,
    pub clone_target: Option<String>,
    pub kw: Option<String>,
    pub pump_keywords: Option<String>,
    pub add_keywords: Option<String>,
    pub kw_choice: Option<String>,
    pub up_to: bool,
    /// `Upto$` for `DrawEffect`: decider chooses how many to draw (0..=NumCards).
    /// Mirrors Java `DrawEffect.resolve`'s `final boolean upto = sa.hasParam("Upto")`.
    pub upto: bool,
    /// `OptionalDecider$` — optional-effect gatekeeper for the drawing player
    /// (and similar effects). Stored as the raw player reference (e.g. "You").
    pub optional_decider: Option<String>,
    /// `ReplaceGraveyard$ <Zone>` for `PlayEffect`: install a one-shot
    /// replacement that reroutes the played card to `<Zone>` if it would
    /// otherwise be put into the graveyard from the stack.
    pub replace_graveyard: Option<String>,
    pub two_colors: bool,
    pub or_colors: bool,
    pub can_block_any: bool,
    pub can_block_amount: Option<String>,
    pub option_question: Option<String>,
    pub perpetual_duration: bool,
    pub pump_zone: Option<String>,
    pub repeat_sub_ability: Option<String>,
    pub repeat_check_svar: bool,
    pub repeat_svar_compare: Option<String>,
    pub repeat_defined: Option<String>,
    pub repeat_present: Option<String>,
    pub repeat_compare: Option<String>,
    pub repeat_optional: bool,
    pub repeat_optional_decider: Option<String>,
    pub repeat_cards_text: Option<String>,
    pub repeat_cards_selector: Option<CompiledSelector>,
    pub repeat_players: Option<String>,
    pub change_num_text: Option<String>,
    pub change_valid: Option<String>,
    pub zone: Option<ZoneType>,
    pub valid_zone: Option<ZoneType>,
    pub source_zone: Option<ZoneType>,
    pub restrict_from_zone: Option<ZoneType>,
    pub choice_zone: Option<ZoneType>,
    pub with_total_cmc: Option<i32>,
    pub with_total_power: Option<i32>,
    pub mana_ability: bool,
    pub type_filter: Option<String>,
    pub valid_types_text: Option<String>,
    pub remember_countered: bool,
    pub remember_countered_cmc: bool,
    pub remember_for_counter: bool,
    pub lose_control: Option<crate::card::LoseControlCondition>,
    pub untap_on_resolve: bool,
    pub add_kws: Option<String>,
    pub fallback_ability: Option<String>,
    pub cumulative_upkeep: Option<String>,
    pub echo: Option<String>,
    pub exploit: bool,
    pub strict_amount: bool,
    pub base_power: bool,
    pub remember_sacrificed: bool,
    pub unimprint: bool,
    pub drain_mana: bool,
    pub remember_drained_mana: bool,
    pub clear_remembered: bool,
    pub etb: bool,
    pub remember_tapped: bool,
    pub untap_type: Option<String>,
    pub untap_up_to: bool,
    pub track_discarded: bool,
    pub no_peek: bool,
    pub no_reveal: bool,
    pub remember_peeked: bool,
    pub reveal_optional: bool,
    pub remember_revealed: bool,
    pub imprint_revealed: bool,
    pub remember_found: bool,
    pub imprint_found: bool,
    pub peek_amount_text: Option<String>,
    pub champion: bool,
    pub with_noted_counters: bool,
    pub exiled_with_effect_source: bool,
    pub token_tapped: bool,
    pub token_blocking_text: Option<String>,
    pub remember_tokens: bool,
    pub remember_original_tokens: bool,
    pub imprint_tokens: bool,
    pub remember_source: bool,
    pub token_remembered: Option<String>,
    pub cleanup_for_each: bool,
    pub add_triggers_from_text: Option<String>,
    pub at_eot_trig_text: Option<String>,
    pub pump_duration_text: Option<String>,
    pub searched: bool,
    pub reorder: bool,
    pub exactly: bool,
    pub no_looking: bool,
    pub remember_lki_flag: bool,
    pub remember_searched: bool,
    pub ninjutsu: bool,
    pub unearth: bool,
    pub attacking: bool,
    pub cant_fizzle: bool,
    pub cant_be_countered: bool,
    pub unpayable: bool,
    pub pw_ability: bool,
    pub flash: bool,
    pub split_second: bool,
    pub random: bool,
    pub random_target: bool,
    pub rest_random_order: bool,
    pub prompt_to_skip_optional_ability: bool,
    pub prompt_if_only_possible_ability: bool,
    pub skip_cancel_prompt: bool,
    pub temp_remember: bool,
    pub num_random_choices: Option<String>,
    pub num_dmg_text: Option<String>,
    pub num_cards_text: Option<String>,
    pub sides: Option<i32>,
    pub result_sub_abilities_text: Option<String>,
    pub result_svar_text: Option<String>,
    pub chosen_svar_text: Option<String>,
    pub other_svar_text: Option<String>,
    pub spellbook_text: Option<String>,
    pub dungeon_text: Option<String>,
    pub var_name_text: Option<String>,
    pub animate_power: Option<i32>,
    pub animate_toughness: Option<i32>,
    pub animate_types_text: Option<String>,
    pub animate_keywords_text: Option<String>,
    pub animate_remove_keywords_text: Option<String>,
    pub animate_triggers_text: Option<String>,
    pub animate_colors_text: Option<String>,
    pub overwrite_colors: bool,
    pub animate_overwrite_types: bool,
    pub animate_remove_creature_types: bool,
    pub animate_remove_all_abilities: bool,
    pub animate_incorporate_text: Option<String>,
    pub animate_mana_cost_override_text: Option<String>,
    pub sneak: bool,
    pub attacking_text: Option<String>,
    pub ninjutsu_text: Option<String>,
    pub token_attacking_text: Option<String>,
    pub without_mana_cost: bool,
    pub cast_from_play_effect: bool,
    pub store_vote_num: bool,
    pub remember_voted_objects: bool,
    pub remember_played: bool,
    pub discard_valid_text: Option<String>,
    pub discard_valid_selector: Option<CompiledSelector>,
    pub reveal_valid_text: Option<String>,
    pub reveal_valid_selector: Option<CompiledSelector>,
    pub any_number: bool,
    pub remember_discarded: bool,
    pub allows_paying_with_shard: bool,
    pub cant_be_copied_ability: bool,
    pub mana_replacement: Option<String>,
    pub remember_manifested: bool,
    pub unless_payer_text: Option<String>,
    pub unless_resolve_subs: Option<String>,
    pub unless_switched: bool,
    pub vote_message_text: Option<String>,
    pub optional_decider_text: Option<String>,
    pub stack_description_text: Option<String>,
    pub sp_desc_text: Option<String>,
    pub spell_description_text: Option<String>,
    pub condition_description_text: Option<String>,
    pub after_description_text: Option<String>,
    pub announce_text: Option<String>,
    pub x_max_limit_text: Option<String>,
    pub announce_max_text: Option<String>,
    pub optional_ability_prompt: Option<String>,
    pub svar_name_text: Option<String>,
    pub svar_type_text: Option<String>,
    pub svar_expression_text: Option<String>,
    pub change_color_word_text: Option<String>,
    pub change_type_word_text: Option<String>,
    pub forbidden_new_types_text: Option<String>,
    pub cost_has_x: bool,
    pub targeting_player: bool,
    pub targeting_player_text: Option<String>,
    pub effect_source: bool,
    pub defined_magnet_text: Option<String>,
    pub targets_with_defined_controller_text: Option<String>,
    pub replace_dying_exiled_with: bool,
    pub mode: Option<SpellAbilityMode>,
    pub duration: Option<AbilityDuration>,
    pub replace_dying_condition: Option<ReplaceDyingCondition>,
    pub day_time_value: Option<DayTimeValue>,
    pub choice_restriction_text: Option<String>,
    pub phase_text: Option<String>,
    pub step_text: Option<String>,
    pub phase_in_or_out_text: Option<String>,
    pub found_destination_zone: Option<ZoneType>,
    pub revealed_destination_zone: Option<ZoneType>,
    pub extra_phase_text: Option<String>,
    pub card_state_name: Option<String>,
    pub track_mana_spent: bool,
    pub become_starting_player: bool,
    pub tap_creatures_for_mana: bool,
    pub remember_players_text: Option<String>,
    pub no_call: bool,
    pub flip_until_you_lose: bool,
    pub different_names: bool,
    pub different_cmc: bool,
    pub different_power: bool,
    pub share_land_type: bool,
    pub imprint_last: bool,
    pub foretold: bool,
    pub foretold_cost: bool,
    pub random_order: bool,
    pub shuffle_changed_pile: bool,
    pub warp: bool,
    pub morph: bool,
    pub morph_up: bool,
    pub megamorph: bool,
    pub mega: bool,
    pub imprint_made: bool,
    pub to_visit_your_attractions: bool,
    pub remember_highest_player: bool,
    pub use_highest_roll: bool,
    pub use_difference_between_rolls: bool,
    pub store_results: bool,
    pub even_odd_results: bool,
    pub different_results: bool,
    pub max_rolls_results: bool,
    pub note_doubles: bool,
    pub subs_for_each: bool,
    pub reroll_results: bool,
    pub semantic_numeric_params: BTreeMap<String, NumericParamIr>,
}

impl SpellAbilityIr {
    pub fn from_parsed(
        api: Option<crate::ability::api_type::ApiType>,
        params: &ParsedParams<'_>,
    ) -> Self {
        Self {
            card_trait_requirements: CardTraitRequirementsIr::from_parsed(params),
            effect: lower_effect_ir(api, params),
            mode_text: params.get(keys::MODE).map(str::to_string),
            discard_mode: params
                .get(keys::MODE)
                .and_then(crate::ability::effects::discard_effect::DiscardMode::parse),
            produced_ir: params
                .semantic_get(keys::PRODUCED)
                .and_then(|param| match param.value {
                    SemanticParamValue::ProducedMana(produced) => {
                        Some(ProducedMana::from_semantic(&produced))
                    }
                    _ => None,
                }),
            reflect_property: params.get(keys::REFLECT_PROPERTY).map(str::to_string),
            color_or_type: params.get(keys::COLOR_OR_TYPE).map(str::to_string),
            restrict_valid: params.get(keys::RESTRICT_VALID).map(str::to_string),
            valid_filter_text: params.get(keys::VALID).map(str::to_string),
            valid_filter_selector: params.get(keys::VALID).map(CompiledSelector::parse),
            adds_keywords: params.get(keys::ADDS_KEYWORDS).map(str::to_string),
            adds_keywords_valid: params.get(keys::ADDS_KEYWORDS_VALID).map(str::to_string),
            adds_counters: params.get(keys::ADDS_COUNTERS).map(str::to_string),
            adds_counters_valid: params.get(keys::ADDS_COUNTERS_VALID).map(str::to_string),
            triggers_when_spent: params.get(keys::TRIGGERS_WHEN_SPENT).map(str::to_string),
            valid_cards_text: params.get(keys::VALID_CARDS).map(str::to_string),
            valid_cards_selector: params.get(keys::VALID_CARDS).map(CompiledSelector::parse),
            valid_card_text: params.get(keys::VALID_CARD).map(str::to_string),
            valid_card_selector: params.get(keys::VALID_CARD).map(CompiledSelector::parse),
            valid_players_text: params.get(keys::VALID_PLAYERS).map(str::to_string),
            valid_players_selector: params.get(keys::VALID_PLAYERS).map(CompiledSelector::parse),
            valid_player_text: params.get(keys::VALID_PLAYER).map(str::to_string),
            valid_player_selector: params.get(keys::VALID_PLAYER).map(CompiledSelector::parse),
            valid_tgts_text: params.get(keys::VALID_TGTS).map(str::to_string),
            valid_tgts_selector: params.get(keys::VALID_TGTS).map(CompiledSelector::parse),
            valid_target_text: params.get(keys::VALID_TARGET).map(str::to_string),
            valid_target_selector: params.get(keys::VALID_TARGET).map(CompiledSelector::parse),
            all_valid_text: params.get("AllValid").map(str::to_string),
            all_valid_selector: params.get("AllValid").map(CompiledSelector::parse),
            defined_name_text: params.get(keys::DEFINED_NAME).map(str::to_string),
            set_chosen_number: params.get("SetChosenNumber").map(str::to_string),
            starting_with: params.get("StartingWith").map(str::to_string),
            repeat: params.get(keys::REPEAT).map(str::to_string),
            branch_condition_svar: params.get(keys::BRANCH_CONDITION_SVAR).map(str::to_string),
            branch_condition_svar_compare: params
                .get(keys::BRANCH_CONDITION_SVAR_COMPARE)
                .map(str::to_string),
            true_sub_ability: params.get(keys::TRUE_SUB_ABILITY).map(str::to_string),
            false_sub_ability: params.get(keys::FALSE_SUB_ABILITY).map(str::to_string),
            play_cost_text: params.get(keys::PLAY_COST).map(str::to_string),
            unless_cost: params.get(keys::UNLESS_COST).map(str::to_string),
            amount: params.get(keys::AMOUNT).map(str::to_string),
            counter_num_text: params.get("CounterNum").map(str::to_string),
            max_repeat: params.get("MaxRepeat").map(str::to_string),
            precost_desc: params.get(keys::PRECOST_DESC).map(str::to_string),
            token_amount: params.get("TokenAmount").map(str::to_string),
            sac_valid: params.get(keys::SAC_VALID).map(str::to_string),
            defined: params.get(keys::DEFINED).map(DefinedExpr::parse),
            defined_player: params.get(keys::DEFINED_PLAYER).map(DefinedExpr::parse),
            defined_text: params.get(keys::DEFINED).map(str::to_string),
            defined_player_text: params.get(keys::DEFINED_PLAYER).map(str::to_string),
            controller_text: params.get(keys::CONTROLLER).map(str::to_string),
            effect_owner: params.get(keys::EFFECT_OWNER).map(DefinedExpr::parse),
            effect_owner_text: params.get(keys::EFFECT_OWNER).map(str::to_string),
            origin_text: params.get(keys::ORIGIN).map(str::to_string),
            origin_zone: parsed_zone_type(params.get(keys::ORIGIN)),
            origin_zones: parsed_zone_types(params.get(keys::ORIGIN)),
            destination_text: params
                .get(keys::DESTINATION_ZONE)
                .or_else(|| params.get(keys::DESTINATION))
                .map(str::to_string),
            destination_zone: parsed_zone_type(
                params
                    .get(keys::DESTINATION_ZONE)
                    .or_else(|| params.get(keys::DESTINATION)),
            ),
            destination_zone_2: parsed_zone_type(params.get(keys::DESTINATION_ZONE_2)),
            zone1: parsed_zone_type(params.get(keys::ZONE1)),
            zone2: parsed_zone_type(params.get(keys::ZONE2)),
            change_type: params.get(keys::CHANGE_TYPE).map(str::to_string),
            change_type_selector: params.get(keys::CHANGE_TYPE).map(CompiledSelector::parse),
            primary_text: params.get(keys::PRIMARY).map(str::to_string),
            secondary_text: params.get(keys::SECONDARY).map(str::to_string),
            secondary_type_text: params.get(keys::SECONDARY_TYPE).map(str::to_string),
            library_position: params.get(keys::LIBRARY_POSITION).map(str::to_string),
            library_position_2: params.get(keys::LIBRARY_POSITION_2).map(str::to_string),
            library_position_alternative: params
                .get(keys::LIBRARY_POSITION_ALTERNATIVE)
                .map(str::to_string),
            shuffle_raw: params.get(keys::SHUFFLE).map(str::to_string),
            no_shuffle: parsed_true(params.get(keys::NO_SHUFFLE)),
            mandatory: parsed_true(params.get(keys::MANDATORY)),
            toggle: parsed_true(params.get(keys::TOGGLE)),
            can_repeat_modes: params.has(keys::CAN_REPEAT_MODES),
            entwine: params.has(keys::ENTWINE),
            skip_untap: params.has(keys::SKIP_UNTAP),
            tapped: parsed_true(params.get(keys::TAPPED)),
            shuffle: parsed_true(params.get(keys::SHUFFLE)),
            optional: params.has(keys::OPTIONAL),
            gain_control: params.has(keys::GAIN_CONTROL),
            gain_control_text: params.get(keys::GAIN_CONTROL).map(str::to_string),
            forget_changed: parsed_true(params.get(keys::FORGET_CHANGED)),
            adds_no_counter: parsed_true(params.get(keys::ADDS_NO_COUNTER)),
            no_regen: params.has("NoRegen"),
            damage_map: params.has(keys::DAMAGE_MAP),
            remember_damaged_creature: parsed_true(params.get(keys::REMEMBER_DAMAGED_CREATURE)),
            num_dmg_present: params.has(keys::NUM_DMG),
            boon: params.has("Boon"),
            unique: params.has("Unique"),
            exile_on_moved: params.has("ExileOnMoved"),
            forget_on_phased_in: params.has("ForgetOnPhasedIn"),
            forget_counter: params.has("ForgetCounter"),
            radiance: params.has("Radiance"),
            chooser: params.get(keys::CHOOSER).map(str::to_string),
            gains: params.get(keys::GAINS).map(str::to_string),
            choices: params.get(keys::CHOICES).map(str::to_string),
            choices_selector: params.get(keys::CHOICES).map(CompiledSelector::parse),
            debuff: DebuffIr::from_parsed(params),
            for_each_text: params.get(keys::FOR_EACH).map(str::to_string),
            exclude: params.get("Exclude").map(str::to_string),
            object_text: params.get(keys::OBJECT).map(str::to_string),
            source_text: params.get(keys::SOURCE).map(str::to_string),
            attached_to: params.get(keys::ATTACHED_TO).map(str::to_string),
            attached_to_player_text: params.get(keys::ATTACHED_TO_PLAYER).map(str::to_string),
            attach_after_text: params.get(keys::ATTACH_AFTER).map(str::to_string),
            destination_alternative: params
                .get(keys::DESTINATION_ALTERNATIVE)
                .map(str::to_string),
            select_prompt: params.get(keys::SELECT_PROMPT).map(str::to_string),
            sub_ability_name: params.get(keys::SUB_ABILITY).map(str::to_string),
            name_text: params.get(keys::NAME).map(str::to_string),
            names_text: params.get(keys::NAMES).map(str::to_string),
            choose_from_list_text: params.get(keys::CHOOSE_FROM_LIST).map(str::to_string),
            choose_from_defined_cards: params.has(keys::CHOOSE_FROM_DEFINED_CARDS),
            stack_id: params
                .get(keys::STACK_ID)
                .and_then(|value| value.parse().ok()),
            token_script: params.get(keys::TOKEN_SCRIPT).map(str::to_string),
            token_owner: params.get(keys::TOKEN_OWNER).map(str::to_string),
            token_name_text: params.get(keys::TOKEN_NAME).map(str::to_string),
            token_power: parsed_i32(params.get(keys::TOKEN_POWER)),
            token_toughness: parsed_i32(params.get(keys::TOKEN_TOUGHNESS)),
            token_types_text: params.get(keys::TOKEN_TYPES).map(str::to_string),
            token_colors_text: params.get(keys::TOKEN_COLORS).map(str::to_string),
            token_keywords_text: params.get(keys::TOKEN_KEYWORDS).map(str::to_string),
            token_until_text: params.get("TokenUntil").map(str::to_string),
            keyword_text: params.get("Keyword").map(str::to_string),
            with_counters_type_text: params.get(keys::WITH_COUNTERS_TYPE).map(str::to_string),
            with_counters_type: params.get(keys::WITH_COUNTERS_TYPE).map(parse_counter_type),
            with_counters_amount_text: params.get(keys::WITH_COUNTERS_AMOUNT).map(str::to_string),
            change_num: parsed_usize(params.get(keys::CHANGE_NUM)).unwrap_or(1),
            hidden: parsed_true(params.get(keys::HIDDEN)),
            skip_reorder: parsed_true(params.get("SkipReorder")),
            secretly: parsed_true(params.get(keys::SECRETLY)),
            random_chosen: parsed_true(params.get(keys::RANDOM_CHOSEN)),
            forget_other_remembered: parsed_true(params.get(keys::FORGET_OTHER_REMEMBERED)),
            remember_changed: params.has(keys::REMEMBER_CHANGED),
            imprint: parsed_true(params.get(keys::IMPRINT)),
            face_down: params.has(keys::FACE_DOWN),
            exile_face_down: parsed_true(params.get(keys::EXILE_FACE_DOWN)),
            transformed: parsed_true(params.get(keys::TRANSFORMED)),
            at_random_text: params.get(keys::AT_RANDOM).map(str::to_string),
            at_random: params.has(keys::AT_RANDOM),
            reveal: !parsed_true(params.get(keys::NO_REVEAL)),
            reveal_true: parsed_true(params.get(keys::REVEAL)),
            reveal_text: params.get(keys::REVEAL).map(str::to_string),
            remember_drawn: params.has("RememberDrawn"),
            remember_removed_cards: parsed_true(params.get(keys::REMEMBER_REMOVED_CARDS)),
            remember_destroyed: parsed_true(params.get("RememberDestroyed")),
            remember_abandoned: params.get("RememberAbandoned").is_some(),
            may_shuffle: params.has(keys::MAY_SHUFFLE),
            remember_altered: parsed_true(params.get(keys::REMEMBER_ALTERED)),
            alter_attribute_activate: parsed_bool_default(params.get(keys::ACTIVATE), true),
            alter_attribute_attributes: split_param_list_value(params.get(keys::ATTRIBUTES), ","),
            remember_amass: parsed_true(params.get(keys::REMEMBER_AMASS)),
            remember_flag: params.has(keys::REMEMBER),
            remember_chosen: parsed_true(params.get(keys::REMEMBER_CHOSEN)),
            imprint_chosen: parsed_true(params.get(keys::IMPRINT_CHOSEN)),
            remember_clasher: parsed_true(params.get(keys::REMEMBER_CLASHER)),
            remember_cloaked: parsed_true(params.get(keys::REMEMBER_CLOAKED)),
            remember_discovered: parsed_true(params.get(keys::REMEMBER_DISCOVERED)),
            remember_drafted: parsed_true(params.get(keys::REMEMBER_DRAFTED)),
            remember_exchanged: parsed_true(params.get(keys::REMEMBER_EXCHANGED)),
            remember_investigating_players: parsed_true(
                params.get(keys::REMEMBER_INVESTIGATING_PLAYERS),
            ),
            remember_made: parsed_true(params.get(keys::REMEMBER_MADE)),
            always_remember: parsed_true(params.get("AlwaysRemember")),
            remember_milled: params.has("RememberMilled"),
            change_zone_table: params.has("ChangeZoneTable"),
            at_eot: params.get(keys::AT_EOT).map(str::to_string),
            execute: params.get(keys::EXECUTE).map(str::to_string),
            replace_with_text: params.get(keys::REPLACE_WITH).map(str::to_string),
            damage_amount_text: params.get(keys::DAMAGE_AMOUNT).map(str::to_string),
            counter_type_text: params.get(keys::COUNTER_TYPE).map(str::to_string),
            counter_type: params.get(keys::COUNTER_TYPE).map(parse_counter_type),
            simple_counter_type_choice_path: params.get(keys::COUNTER_TYPE).is_some()
                && ![
                    "EachExistingCounter",
                    "EachFromSource",
                    "UniqueType",
                    "CounterTypePerDefined",
                    "CounterTypes",
                    "ChooseDifferent",
                    "PutOnEachOther",
                    "PutOnDefined",
                    "TriggeredCounterMap",
                    "SharedKeywords",
                ]
                .iter()
                .any(|key| params.has(key)),
            modular: parsed_true(params.get(keys::MODULAR)),
            adapt: parsed_true(params.get(keys::ADAPT)),
            monstrosity: parsed_true(params.get(keys::MONSTROSITY)),
            bloodthirst: parsed_true(params.get("Bloodthirst")),
            renown: parsed_true(params.get(keys::RENOWN)),
            abilities: params.get("Abilities").map(str::to_string),
            replacement_effects: params.get("ReplacementEffects").map(str::to_string),
            static_abilities: params.get(keys::STATIC_ABILITIES).map(str::to_string),
            triggers: params.get(keys::TRIGGERS).map(str::to_string),
            imprint_cards: params.get("ImprintCards").map(str::to_string),
            remember_spell: params.get("RememberSpell").map(str::to_string),
            remember_lki: params.get("RememberLKI").map(str::to_string),
            remember_targets: params.has("RememberTargets"),
            forget_other_targets: params.has("ForgetOtherTargets"),
            remember_cost_mana: params.has("RememberCostMana"),
            forget_on_moved_text: params.get(keys::FORGET_ON_MOVED).map(str::to_string),
            forget_on_moved_zone: parsed_zone_type(params.get(keys::FORGET_ON_MOVED)),
            replace_dying_defined: params.get("ReplaceDyingDefined").map(DefinedExpr::parse),
            replace_dying_defined_text: params.get("ReplaceDyingDefined").map(str::to_string),
            replace_dying_valid: params.get("ReplaceDyingValid").map(str::to_string),
            replace_dying_zone_text: params.get("ReplaceDyingZone").map(str::to_string),
            replace_dying_zone: parsed_zone_type(params.get("ReplaceDyingZone")),
            remember_objects: params.get(keys::REMEMBER_OBJECTS).map(str::to_string),
            remember_objects_remembered: has_remember_objects_token(params, "Remembered"),
            remember_objects_remembered_controller: has_remember_objects_token(
                params,
                "RememberedController",
            ),
            remember_objects_remembered_lki: has_remember_objects_token(params, "RememberedLKI"),
            remember_objects_triggered_attacker_lki_copy: has_remember_objects_token(
                params,
                "TriggeredAttackerLKICopy",
            ),
            remember_number: params.has(keys::REMEMBER_NUMBER),
            remember_svar_amount: params.get(keys::REMEMBER_SVAR_AMOUNT).map(str::to_string),
            remember_exiled: params.has("RememberExiled"),
            delayed_trigger_defined_player: params
                .get(keys::DELAYED_TRIGGER_DEFINED_PLAYER)
                .map(DefinedExpr::parse),
            delayed_trigger_defined_player_text: params
                .get(keys::DELAYED_TRIGGER_DEFINED_PLAYER)
                .map(str::to_string),
            this_turn: params.has("ThisTurn"),
            condition_hellbent: parsed_true(params.get("ConditionHellbent")),
            condition_threshold: parsed_true(params.get("ConditionThreshold")),
            condition_metalcraft: parsed_true(params.get("ConditionMetalcraft")),
            condition_delirium: parsed_true(params.get("ConditionDelirium")),
            condition_revolt: parsed_true(params.get("ConditionRevolt")),
            condition_desert: parsed_true(params.get("ConditionDesert")),
            condition_blessing: parsed_true(params.get("ConditionBlessing")),
            condition_kicked: parsed_true(params.get("ConditionKicked")),
            condition_optional_paid: parsed_true(params.get("ConditionOptionalPaid")),
            condition_optional_not_paid: parsed_true(params.get("ConditionOptionalNotPaid")),
            condition_opponent_turn: parsed_true(params.get("ConditionOpponentTurn")),
            condition_player_turn: params.get("ConditionPlayerTurn").map(str::to_string),
            condition_cards_in_hand: params.get("ConditionCardsInHand").map(str::to_string),
            condition_phases: params.get("ConditionPhases").map(str::to_string),
            condition_life_compare: params.get("ConditionLifeCompare").map(str::to_string),
            condition: params.get(keys::CONDITION).map(str::to_string),
            condition_check_svar: params.get(keys::CONDITION_CHECK_SVAR).map(str::to_string),
            condition_svar_compare: params.get("ConditionSVarCompare").map(str::to_string),
            condition_present: params.get(keys::CONDITION_PRESENT).map(str::to_string),
            condition_defined: params.get(keys::CONDITION_DEFINED).map(DefinedExpr::parse),
            condition_defined_text: params.get(keys::CONDITION_DEFINED).map(str::to_string),
            condition_compare: params.get(keys::CONDITION_COMPARE).map(str::to_string),
            condition_zone_text: params.get(keys::CONDITION_ZONE).map(str::to_string),
            condition_zone: parsed_zone_type(params.get(keys::CONDITION_ZONE)),
            optional_present: params.has(keys::OPTIONAL),
            remove_from_combat: parsed_true(params.get(keys::REMOVE_FROM_COMBAT)),
            num_att: params.get(keys::NUM_ATT).map(str::to_string),
            num_def: params.get(keys::NUM_DEF).map(str::to_string),
            types_text: params
                .get(keys::TYPES)
                .or_else(|| params.get(keys::TYPE))
                .map(str::to_string),
            add_types: params.get(keys::ADD_TYPES).map(str::to_string),
            set_color: params.get(keys::SET_COLOR).map(str::to_string),
            set_power: params.get(keys::SET_POWER).map(str::to_string),
            set_toughness: params.get(keys::SET_TOUGHNESS).map(str::to_string),
            set_mana_cost: params.get(keys::SET_MANA_COST).map(str::to_string),
            clone_target: params.get(keys::CLONE_TARGET).map(str::to_string),
            kw: params.get(keys::KW).map(str::to_string),
            pump_keywords: params.get(keys::PUMP_KEYWORDS).map(str::to_string),
            add_keywords: params.get(keys::ADD_KEYWORDS).map(str::to_string),
            kw_choice: params.get("KWChoice").map(str::to_string),
            up_to: params.has("UpTo"),
            upto: params.has(keys::UPTO),
            optional_decider: params.get(keys::OPTIONAL_DECIDER).map(str::to_string),
            replace_graveyard: params.get(keys::REPLACE_GRAVEYARD).map(str::to_string),
            two_colors: params.has("TwoColors"),
            or_colors: params.has("OrColors"),
            can_block_any: parsed_true(params.get("CanBlockAny")),
            can_block_amount: params.get("CanBlockAmount").map(str::to_string),
            option_question: params.get("OptionQuestion").map(str::to_string),
            perpetual_duration: matches!(
                params.get(keys::DURATION).map(AbilityDuration::parse),
                Some(AbilityDuration::Perpetual)
            ),
            pump_zone: params.get("PumpZone").map(str::to_string),
            repeat_sub_ability: params.get(keys::REPEAT_SUB_ABILITY).map(str::to_string),
            repeat_check_svar: params.has("RepeatCheckSVar"),
            repeat_svar_compare: params.get("RepeatSVarCompare").map(str::to_string),
            repeat_defined: params.get("RepeatDefined").map(str::to_string),
            repeat_present: params.get("RepeatPresent").map(str::to_string),
            repeat_compare: params.get("RepeatCompare").map(str::to_string),
            repeat_optional: params.has("RepeatOptional"),
            repeat_optional_decider: params.get("RepeatOptionalDecider").map(str::to_string),
            repeat_cards_text: params.get(keys::REPEAT_CARDS).map(str::to_string),
            repeat_cards_selector: params.get(keys::REPEAT_CARDS).map(CompiledSelector::parse),
            repeat_players: params.get(keys::REPEAT_PLAYERS).map(str::to_string),
            change_num_text: params.get(keys::CHANGE_NUM).map(str::to_string),
            change_valid: params.get(keys::CHANGE_VALID).map(str::to_string),
            zone: parsed_zone_type(params.get(keys::ZONE)),
            valid_zone: parsed_zone_type(params.get(keys::VALID_ZONE)),
            source_zone: parsed_zone_type(params.get("SourceZone")),
            restrict_from_zone: parsed_zone_type(params.get(keys::RESTRICT_FROM_ZONE)),
            choice_zone: parsed_zone_type(params.get(keys::CHOICE_ZONE)),
            with_total_cmc: parsed_i32(params.get(keys::WITH_TOTAL_CMC)),
            with_total_power: parsed_i32(params.get(keys::WITH_TOTAL_POWER)),
            mana_ability: parsed_true(params.get(keys::MANA_ABILITY)),
            type_filter: params.get(keys::TYPE).map(str::to_string),
            valid_types_text: params.get(keys::VALID_TYPES).map(str::to_string),
            remember_countered: params.has(keys::REMEMBER_COUNTERED),
            remember_countered_cmc: params.has(keys::REMEMBER_COUNTERED_CMC),
            remember_for_counter: params.has(keys::REMEMBER_FOR_COUNTER),
            lose_control: params
                .get(keys::LOSE_CONTROL)
                .and_then(|raw| raw.parse::<crate::card::LoseControlCondition>().ok()),
            untap_on_resolve: params.has(keys::UNTAP),
            add_kws: params.get(keys::ADD_KWS).map(str::to_string),
            fallback_ability: params.get("FallbackAbility").map(str::to_string),
            cumulative_upkeep: params.get(keys::CUMULATIVE_UPKEEP).map(str::to_string),
            echo: params.get("Echo").map(str::to_string),
            exploit: parsed_true(params.get(keys::EXPLOIT)),
            strict_amount: params.has(keys::STRICT_AMOUNT),
            base_power: params.get("BasePower").is_some(),
            remember_sacrificed: parsed_true(params.get(keys::REMEMBER_SACRIFICED)),
            unimprint: parsed_true(params.get(keys::UNIMPRINT)),
            drain_mana: parsed_true(params.get(keys::DRAIN_MANA)),
            remember_drained_mana: parsed_true(params.get(keys::REMEMBER_DRAINED_MANA)),
            clear_remembered: parsed_true(params.get("ClearRemembered")),
            etb: params.has(keys::ETB),
            remember_tapped: params.has(keys::REMEMBER_TAPPED),
            untap_type: params.get("UntapType").map(str::to_string),
            untap_up_to: parsed_true(params.get("UntapUpTo")),
            track_discarded: parsed_true(params.get(keys::TRACK_DISCARDED)),
            no_peek: parsed_true(params.get("NoPeek")),
            no_reveal: parsed_true(params.get("NoReveal")),
            remember_peeked: parsed_true(params.get("RememberPeeked")),
            reveal_optional: parsed_true(params.get("RevealOptional")),
            remember_revealed: parsed_true(params.get("RememberRevealed")),
            imprint_revealed: parsed_true(params.get("ImprintRevealed")),
            remember_found: parsed_true(params.get(keys::REMEMBER_FOUND)),
            imprint_found: parsed_true(params.get(keys::IMPRINT_FOUND)),
            peek_amount_text: params.get("PeekAmount").map(str::to_string),
            champion: parsed_true(params.get(keys::CHAMPION)),
            with_noted_counters: parsed_true(params.get(keys::WITH_NOTED_COUNTERS)),
            exiled_with_effect_source: params.has("ExiledWithEffectSource"),
            token_tapped: params.has(keys::TOKEN_TAPPED),
            token_blocking_text: params.get(keys::TOKEN_BLOCKING).map(str::to_string),
            remember_tokens: params.has(keys::REMEMBER_TOKENS),
            remember_original_tokens: params.has(keys::REMEMBER_ORIGINAL_TOKENS),
            imprint_tokens: params.has(keys::IMPRINT_TOKENS),
            remember_source: params.has(keys::REMEMBER_SOURCE),
            token_remembered: params.get(keys::TOKEN_REMEMBERED).map(str::to_string),
            cleanup_for_each: params.has(keys::CLEANUP_FOR_EACH),
            add_triggers_from_text: params.get(keys::ADD_TRIGGERS_FROM).map(str::to_string),
            at_eot_trig_text: params.get(keys::AT_EOT_TRIG).map(str::to_string),
            pump_duration_text: params.get(keys::PUMP_DURATION).map(str::to_string),
            searched: parsed_true(params.get(keys::SEARCHED)),
            reorder: parsed_true(params.get("Reorder")),
            exactly: parsed_true(params.get(keys::EXACTLY)),
            no_looking: parsed_true(params.get(keys::NO_LOOKING)),
            remember_lki_flag: parsed_true(params.get("RememberLKI")),
            remember_searched: parsed_true(params.get(keys::REMEMBER_SEARCHED)),
            ninjutsu: parsed_true(params.get(keys::NINJUTSU)),
            unearth: parsed_true(params.get(keys::UNEARTH)),
            attacking: params.has(keys::ATTACKING),
            cant_fizzle: params.has(keys::CANT_FIZZLE),
            cant_be_countered: parsed_true(params.get("CantBeCountered")),
            unpayable: parsed_true(params.get("Unpayable")),
            pw_ability: parsed_true(params.get(keys::PLANESWALKER))
                || parsed_true(params.get("PwAbility")),
            flash: parsed_true(params.get("Flash")),
            split_second: parsed_true(params.get("SplitSecond")),
            random: parsed_true(params.get("Random")),
            random_target: parsed_true(params.get(keys::RANDOM_TARGET)),
            rest_random_order: parsed_true(params.get("RestRandomOrder")),
            prompt_to_skip_optional_ability: params.has(keys::PROMPT_TO_SKIP_OPTIONAL_ABILITY),
            prompt_if_only_possible_ability: parsed_true(params.get("PromptIfOnlyPossible")),
            skip_cancel_prompt: parsed_true(params.get("SkipCancelPrompt")),
            temp_remember: params.has("TempRemember"),
            num_random_choices: params.get("NumRandomChoices").map(str::to_string),
            num_dmg_text: params.get("NumDmg").map(str::to_string),
            num_cards_text: params.get("NumCards").map(str::to_string),
            sides: parsed_i32(params.get(keys::SIDES)),
            result_sub_abilities_text: params.get(keys::RESULT_SUB_ABILITIES).map(str::to_string),
            result_svar_text: params.get("ResultSVar").map(str::to_string),
            chosen_svar_text: params.get("ChosenSVar").map(str::to_string),
            other_svar_text: params.get("OtherSVar").map(str::to_string),
            spellbook_text: params.get(keys::SPELLBOOK).map(str::to_string),
            dungeon_text: params.get(keys::DUNGEON).map(str::to_string),
            var_name_text: params.get(keys::VAR_NAME).map(str::to_string),
            animate_power: parsed_i32(params.get(keys::POWER)),
            animate_toughness: parsed_i32(params.get(keys::TOUGHNESS)),
            animate_types_text: params.get(keys::TYPES).map(str::to_string),
            animate_keywords_text: params.get(keys::KEYWORDS).map(str::to_string),
            animate_remove_keywords_text: params.get("RemoveKeywords").map(str::to_string),
            animate_triggers_text: params.get(keys::TRIGGERS).map(str::to_string),
            animate_colors_text: params.get("Colors").map(str::to_string),
            overwrite_colors: parsed_true(params.get(keys::OVERWRITE_COLORS)),
            animate_overwrite_types: parsed_true(params.get("OverwriteTypes")),
            animate_remove_creature_types: parsed_true(params.get(keys::REMOVE_CREATURE_TYPES)),
            animate_remove_all_abilities: parsed_true(params.get(keys::REMOVE_ALL_ABILITIES)),
            animate_incorporate_text: params.get("Incorporate").map(str::to_string),
            animate_mana_cost_override_text: params.get("ManaCost").map(str::to_string),
            sneak: parsed_true(params.get(keys::SNEAK)),
            attacking_text: params.get(keys::ATTACKING).map(str::to_string),
            ninjutsu_text: params.get(keys::NINJUTSU).map(str::to_string),
            token_attacking_text: params.get(keys::TOKEN_ATTACKING).map(str::to_string),
            without_mana_cost: params.has("WithoutManaCost"),
            cast_from_play_effect: params.has("CastFromPlayEffect"),
            store_vote_num: parsed_true(params.get(keys::STORE_VOTE_NUM)),
            remember_voted_objects: parsed_true(params.get(keys::REMEMBER_VOTED_OBJECTS)),
            remember_played: parsed_true(params.get("RememberPlayed")),
            discard_valid_text: params.get("DiscardValid").map(str::to_string),
            discard_valid_selector: params.get("DiscardValid").map(CompiledSelector::parse),
            reveal_valid_text: params.get("RevealValid").map(str::to_string),
            reveal_valid_selector: params.get("RevealValid").map(CompiledSelector::parse),
            any_number: parsed_true(params.get("AnyNumber")),
            remember_discarded: parsed_true(params.get("RememberDiscarded")),
            allows_paying_with_shard: parsed_true(params.get("AllowsPayingWithShard")),
            cant_be_copied_ability: parsed_true(params.get("CantBeCopied")),
            mana_replacement: params.get(keys::MANA_REPLACEMENT).map(str::to_string),
            remember_manifested: parsed_true(params.get(keys::REMEMBER_MANIFESTED)),
            unless_payer_text: params.get(keys::UNLESS_PAYER).map(str::to_string),
            unless_resolve_subs: params.get("UnlessResolveSubs").map(str::to_string),
            unless_switched: params.has(keys::UNLESS_SWITCHED),
            vote_message_text: params.get(keys::VOTE_MESSAGE).map(str::to_string),
            optional_decider_text: params.get(keys::OPTIONAL_DECIDER).map(str::to_string),
            stack_description_text: params.get("StackDescription").map(str::to_string),
            sp_desc_text: params.get("SpDesc").map(str::to_string),
            spell_description_text: params.get("SpellDescription").map(str::to_string),
            condition_description_text: params.get("ConditionDescription").map(str::to_string),
            after_description_text: params.get("AfterDescription").map(str::to_string),
            announce_text: params.get("Announce").map(str::to_string),
            x_max_limit_text: params.get("XMaxLimit").map(str::to_string),
            announce_max_text: params.get("AnnounceMax").map(str::to_string),
            optional_ability_prompt: params
                .get(keys::OPTIONAL_ABILITY_PROMPT)
                .map(str::to_string),
            svar_name_text: params
                .get("SVar")
                .or_else(|| params.get(keys::SVAR_NAME))
                .map(str::to_string),
            svar_type_text: params.get("Type").map(str::to_string),
            svar_expression_text: params
                .get("Expression")
                .or_else(|| params.get(keys::SVAR_VALUE))
                .map(str::to_string),
            change_color_word_text: params.get(keys::CHANGE_COLOR_WORD).map(str::to_string),
            change_type_word_text: params.get(keys::CHANGE_TYPE_WORD).map(str::to_string),
            forbidden_new_types_text: params.get(keys::FORBIDDEN_NEW_TYPES).map(str::to_string),
            cost_has_x: params
                .get(keys::COST)
                .is_some_and(|cost| cost.contains('X')),
            targeting_player: params.has(keys::TARGETING_PLAYER),
            targeting_player_text: params.get(keys::TARGETING_PLAYER).map(str::to_string),
            effect_source: params.has(keys::EFFECT_SOURCE),
            defined_magnet_text: params.get(keys::DEFINED_MAGNET).map(str::to_string),
            targets_with_defined_controller_text: params
                .get("TargetsWithDefinedController")
                .map(str::to_string),
            replace_dying_exiled_with: params.has("ReplaceDyingExiledWith"),
            mode: params.get(keys::MODE).map(SpellAbilityMode::parse),
            duration: params.get(keys::DURATION).map(AbilityDuration::parse),
            replace_dying_condition: params
                .get("ReplaceDyingCondition")
                .map(ReplaceDyingCondition::parse),
            day_time_value: params.get(keys::VALUE).and_then(DayTimeValue::parse),
            choice_restriction_text: params.get("ChoiceRestriction").map(str::to_string),
            phase_text: params.get(keys::PHASE).map(str::to_string),
            step_text: params.get(keys::STEP).map(str::to_string),
            phase_in_or_out_text: params.get("PhaseInOrOut").map(str::to_string),
            found_destination_zone: parsed_zone_type(params.get("FoundDestination")),
            revealed_destination_zone: parsed_zone_type(params.get("RevealedDestination")),
            extra_phase_text: params.get("ExtraPhase").map(str::to_string),
            card_state_name: params.get("CardState").map(str::to_string),
            track_mana_spent: parsed_true(params.get("TrackManaSpent")),
            become_starting_player: params.has("BecomeStartingPlayer"),
            tap_creatures_for_mana: params.has("TapCreaturesForMana"),
            remember_players_text: params.get(keys::REMEMBER_PLAYERS).map(str::to_string),
            no_call: parsed_true(params.get("NoCall")),
            flip_until_you_lose: parsed_true(params.get("FlipUntilYouLose")),
            different_names: parsed_true(params.get(keys::DIFFERENT_NAMES)),
            different_cmc: parsed_true(params.get(keys::DIFFERENT_CMC)),
            different_power: parsed_true(params.get(keys::DIFFERENT_POWER)),
            share_land_type: parsed_true(params.get(keys::SHARE_LAND_TYPE)),
            imprint_last: parsed_true(params.get(keys::IMPRINT_LAST)),
            foretold: parsed_true(params.get(keys::FORETOLD)),
            foretold_cost: parsed_true(params.get(keys::FORETOLD_COST)),
            random_order: parsed_true(params.get(keys::RANDOM_ORDER)),
            shuffle_changed_pile: parsed_true(params.get(keys::SHUFFLE_CHANGED_PILE)),
            warp: params.has(keys::WARP),
            morph: parsed_true(params.get("Morph")),
            morph_up: parsed_true(params.get("MorphUp")),
            megamorph: parsed_true(params.get("Megamorph")),
            mega: parsed_true(params.get(keys::MEGA)),
            imprint_made: parsed_true(params.get(keys::IMPRINT_MADE)),
            to_visit_your_attractions: parsed_true(params.get("ToVisitYourAttractions")),
            remember_highest_player: parsed_true(params.get("RememberHighestPlayer")),
            use_highest_roll: parsed_true(params.get("UseHighestRoll")),
            use_difference_between_rolls: parsed_true(params.get("UseDifferenceBetweenRolls")),
            store_results: parsed_true(params.get("StoreResults")),
            even_odd_results: parsed_true(params.get("EvenOddResults")),
            different_results: parsed_true(params.get("DifferentResults")),
            max_rolls_results: parsed_true(params.get("MaxRollsResults")),
            note_doubles: parsed_true(params.get("NoteDoubles")),
            subs_for_each: parsed_true(params.get("SubsForEach")),
            reroll_results: parsed_true(params.get("RerollResults")),
            semantic_numeric_params: BTreeMap::new(),
        }
    }

    pub fn compile_numeric_params_from_runtime(&mut self, params: &Params) {
        self.semantic_numeric_params = params
            .iter()
            .filter_map(|(key, value)| {
                NumericParamIr::from_semantic(&parse_semantic_param_value(key, value))
                    .map(|compiled| (key.to_string(), compiled))
            })
            .collect();
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DefinedExpr {
    pub refs: Vec<DefinedRef>,
}

impl DefinedExpr {
    pub fn parse(raw: &str) -> Self {
        Self {
            refs: raw
                .split(" & ")
                .map(str::trim)
                .filter(|part| !part.is_empty())
                .map(DefinedRef::parse)
                .collect(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, strum_macros::AsRefStr, strum_macros::EnumString)]
pub enum DefinedRef {
    #[strum(serialize = "Self", serialize = "CARDNAME")]
    SelfCard,
    You,
    Opponent,
    Player,
    Players,
    Targeted,
    TargetedCard,
    ThisTargetedCard,
    TargetedPlayer,
    ThisTargetedPlayer,
    TargetedOrController,
    TargetedController,
    ThisTargetedController,
    ParentTargetedController,
    TargetedOwner,
    ThisTargetedOwner,
    ParentTarget,
    ParentTargeted,
    TriggeredCard,
    #[strum(serialize = "TriggeredCardLKI")]
    TriggeredCardLki,
    #[strum(serialize = "TriggeredCardLKICopy")]
    TriggeredCardLkiCopy,
    TriggeredPlayer,
    TriggeredSource,
    TriggeredNewCard,
    #[strum(serialize = "TriggeredNewCardLKICopy")]
    TriggeredNewCardLkiCopy,
    TriggeredAttacker,
    TriggeredAttackers,
    TriggeredBlocker,
    TriggeredTarget,
    #[strum(serialize = "TriggeredTargetLKICopy")]
    TriggeredTargetLkiCopy,
    TriggeredTargets,
    TriggeredTargetController,
    TriggeredTargetsController,
    TriggeredAttackerController,
    TriggeredBlockerController,
    DefendingPlayer,
    TriggeredDefendingPlayer,
    ReplacedCard,
    #[strum(serialize = "ReplacedCardLKI")]
    ReplacedCardLki,
    Remembered,
    #[strum(serialize = "RememberedLKI")]
    RememberedLki,
    DelayTriggerRemembered,
    #[strum(serialize = "DelayTriggerRememberedLKI")]
    DelayTriggerRememberedLki,
    TriggerRemembered,
    Imprinted,
    ExiledWith,
    Explorer,
    Explored,
    Discarded,
    Sacrificed,
    #[strum(default)]
    Unsupported(String),
}

impl DefinedRef {
    pub fn parse(raw: &str) -> Self {
        raw.parse()
            .unwrap_or_else(|_| Self::Unsupported(raw.to_string()))
    }

    pub fn is_supported(&self) -> bool {
        !matches!(self, Self::Unsupported(_))
    }

    pub fn as_legacy_str(&self) -> &str {
        match self {
            Self::SelfCard => "Self",
            Self::Unsupported(raw) => raw,
            other => other.as_ref(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NumericParamIr {
    Integer(i32),
    Amount(AmountExpr),
    SVarReference(Vec<String>),
    Raw(String),
}

impl NumericParamIr {
    fn from_semantic(value: &SemanticParamValue<'_>) -> Option<Self> {
        match value {
            SemanticParamValue::Integer(value) => Some(Self::Integer(*value)),
            SemanticParamValue::Amount(amount) => {
                Some(Self::Amount(AmountExpr::from_semantic(amount)))
            }
            SemanticParamValue::SVarReference(names) => Some(Self::SVarReference(
                names.iter().map(|name| (*name).to_string()).collect(),
            )),
            SemanticParamValue::Raw(raw)
            | SemanticParamValue::Expression(raw)
            | SemanticParamValue::Text(raw)
            | SemanticParamValue::Symbol(raw) => Some(Self::Raw((*raw).to_string())),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DealDamageIr {
    pub amount: Option<AmountExpr>,
    pub valid_targets: Option<String>,
    pub damage_map: bool,
}

impl DealDamageIr {
    pub fn from_parsed(params: &ParsedParams<'_>) -> Self {
        Self {
            amount: semantic_amount_expr(params, keys::NUM_DMG),
            valid_targets: params.get(keys::VALID_TGTS).map(str::to_string),
            damage_map: params.has(keys::DAMAGE_MAP),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NumericAmountIr {
    pub amount: Option<AmountExpr>,
}

impl NumericAmountIr {
    pub fn from_parsed(params: &ParsedParams<'_>, key: &str) -> Self {
        Self {
            amount: semantic_amount_expr(params, key),
        }
    }
}

fn semantic_amount_expr(params: &ParsedParams<'_>, key: &str) -> Option<AmountExpr> {
    let param = params.semantic_get(key)?;
    match param.value {
        SemanticParamValue::Amount(amount) => Some(AmountExpr::from_semantic(&amount)),
        SemanticParamValue::Integer(value) => Some(AmountExpr::Literal(value)),
        SemanticParamValue::Raw(raw)
        | SemanticParamValue::Expression(raw)
        | SemanticParamValue::Text(raw)
        | SemanticParamValue::Symbol(raw) => Some(AmountExpr::parse(raw)),
        _ => param
            .raw_value
            .is_empty()
            .then_some(AmountExpr::Raw(String::new())),
    }
}

pub fn lower_effect_ir(
    api: Option<crate::ability::api_type::ApiType>,
    params: &ParsedParams<'_>,
) -> Option<EffectIr> {
    match api {
        Some(crate::ability::api_type::ApiType::DamageAll) => Some(EffectIr::DamageAll(
            NumericAmountIr::from_parsed(params, keys::NUM_DMG),
        )),
        Some(crate::ability::api_type::ApiType::DealDamage) => {
            Some(EffectIr::DealDamage(DealDamageIr::from_parsed(params)))
        }
        Some(crate::ability::api_type::ApiType::Draw) => Some(EffectIr::Draw(
            NumericAmountIr::from_parsed(params, keys::NUM_CARDS),
        )),
        Some(crate::ability::api_type::ApiType::GainLife) => Some(EffectIr::GainLife(
            NumericAmountIr::from_parsed(params, keys::LIFE_AMOUNT),
        )),
        Some(crate::ability::api_type::ApiType::SetLife) => Some(EffectIr::LifeSet(
            NumericAmountIr::from_parsed(params, keys::LIFE_AMOUNT),
        )),
        Some(crate::ability::api_type::ApiType::LoseLife) => Some(EffectIr::LoseLife(
            NumericAmountIr::from_parsed(params, keys::LIFE_AMOUNT),
        )),
        Some(crate::ability::api_type::ApiType::Mill) => Some(EffectIr::Mill(
            NumericAmountIr::from_parsed(params, keys::NUM_CARDS),
        )),
        Some(crate::ability::api_type::ApiType::Poison) => Some(EffectIr::Poison(
            NumericAmountIr::from_parsed(params, keys::NUM),
        )),
        _ => None,
    }
}

fn parsed_zone_type(value: Option<&str>) -> Option<ZoneType> {
    let value = value?.trim();
    if value.eq_ignore_ascii_case("Deck") {
        Some(ZoneType::Library)
    } else {
        ZoneType::from_str_compat(value)
    }
}

fn parsed_zone_types(value: Option<&str>) -> Vec<ZoneType> {
    value
        .map(|zones| {
            zones
                .split([',', ' '])
                .map(str::trim)
                .filter(|zone| !zone.is_empty())
                .filter_map(|zone| {
                    if zone.eq_ignore_ascii_case("Deck") {
                        Some(ZoneType::Library)
                    } else {
                        ZoneType::from_str_compat(zone)
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parsed_i32(value: Option<&str>) -> Option<i32> {
    value?.parse().ok()
}

fn parsed_usize(value: Option<&str>) -> Option<usize> {
    value?.parse().ok()
}

fn parsed_bool_default(value: Option<&str>, default: bool) -> bool {
    value
        .map(|value| value.eq_ignore_ascii_case("True"))
        .unwrap_or(default)
}

fn parsed_true(value: Option<&str>) -> bool {
    value.is_some_and(|value| value.eq_ignore_ascii_case("True"))
}

fn has_remember_objects_token(params: &ParsedParams<'_>, token: &str) -> bool {
    params
        .get(keys::REMEMBER_OBJECTS)
        .is_some_and(|raw| raw.split(" & ").any(|t| t.trim() == token))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parsing::ParsedParams;

    #[test]
    fn planeswalker_param_marks_pw_ability() {
        let params = ParsedParams::parse("AB$ Discard | Planeswalker$ True");
        let ir = SpellAbilityIr::from_parsed(None, &params);
        assert!(ir.pw_ability);
    }
}
