//! Effect resolution system.
//!
//! Each effect type lives in its own file, mirroring the Java Forge
//! `ability/effects/` package (204 files). Effects are dispatched by
//! API type string extracted from the ability text.

pub mod abandon_effect;
pub mod activate_ability_effect;
pub mod add_phase_effect;
pub mod add_turn_effect;
pub mod advance_crank_effect;
pub mod airbend_effect;
pub mod alter_attribute_effect;
pub mod amass_effect;
pub mod animate_all_effect;
pub mod animate_effect;
pub mod ascend_effect;
pub mod assemble_contraption_effect;
pub mod assign_group_effect;
pub mod attach_effect;
pub mod balance_effect;
pub mod become_monarch_effect;
pub mod becomes_blocked_effect;
pub mod bid_life_effect;
pub mod blank_line_effect;
pub mod blight_effect;
pub mod block_effect;
pub mod bond_effect;
pub mod branch_effect;
pub mod camouflage_effect;
pub mod cast_from_effect;
pub mod change_combatants_effect;
pub mod change_speed_effect;
pub mod change_targets_effect;
pub mod change_text_effect;
pub mod change_x_effect;
pub mod change_zone_all_effect;
pub mod change_zone_effect;
pub mod change_zone_resolve_effect;
pub mod chaos_ensues_effect;
pub mod charm_effect;
pub mod choose_card_effect;
pub mod choose_card_name_effect;
pub mod choose_color_effect;
pub mod choose_direction_effect;
pub mod choose_even_odd_effect;
pub mod choose_generic_effect;
pub mod choose_number_effect;
pub mod choose_player_effect;
pub mod choose_sector_effect;
pub mod choose_source_effect;
pub mod choose_type_effect;
pub mod claim_the_prize_effect;
pub mod clash_effect;
pub mod class_level_up_effect;
pub mod clean_up_effect;
pub mod cleanup_effect;
pub mod cloak_effect;
pub mod clone_effect;
pub mod connive_effect;
pub mod control_exchange_effect;
pub mod control_exchange_variant_effect;
pub mod control_gain_effect;
pub mod control_gain_variant_effect;
pub mod control_player_effect;
pub mod control_spell_effect;
pub mod copy_permanent_effect;
pub mod copy_spell_ability_effect;
pub mod counter_effect;
pub mod counters_move_effect;
pub mod counters_multiply_effect;
pub mod counters_note_effect;
pub mod counters_proliferate_effect;
pub mod counters_put_all_effect;
pub mod counters_put_effect;
pub mod counters_put_or_remove_effect;
pub mod counters_remove_all_effect;
pub mod counters_remove_effect;
pub mod damage_all_effect;
pub mod damage_base_effect;
pub mod damage_deal_effect;
pub mod damage_each_effect;
pub mod damage_prevent_effect;
pub mod damage_resolve_effect;
pub mod day_time_effect;
pub mod debuff_effect;
pub mod delayed_trigger_effect;
pub mod destroy_all_effect;
pub mod destroy_effect;
pub mod detached_card_effect;
pub mod detain_effect;
pub mod dig_effect;
pub mod dig_multiple_effect;
pub mod dig_until_effect;
pub mod discard_effect;
pub mod discover_effect;
pub mod draft_effect;
pub mod drain_mana_effect;
pub mod draw_effect;
pub mod earthbend_effect;
pub mod effect_effect;
pub mod encode_effect;
pub mod end_combat_phase_effect;
pub mod end_turn_effect;
pub mod endure_effect;
pub mod explore_effect;
pub mod fight_effect;
pub mod flip_coin_effect;
pub mod flip_onto_battlefield_effect;
pub mod fog_effect;
pub mod game_draw_effect;
pub mod game_loss_effect;
pub mod game_win_effect;
pub mod goad_effect;
pub mod haunt_effect;
pub mod heist_effect;
pub mod immediate_trigger_effect;
pub mod incubate_effect;
pub mod intensify_effect;
pub mod internal_radiation_effect;
pub mod investigate_effect;
pub mod learn_effect;
pub mod life_exchange_effect;
pub mod life_exchange_variant_effect;
pub mod life_gain_effect;
pub mod life_lose_effect;
pub mod life_set_effect;
pub mod look_at_effect;
pub mod lose_perpetual_effect;
pub mod make_card_effect;
pub mod mana_effect;
pub mod mana_reflected_effect;
pub mod manifest_base_effect;
pub mod manifest_dread_effect;
pub mod manifest_effect;
pub mod meld_effect;
pub mod mill_effect;
pub mod move_counter_effect;
pub mod multiple_piles_effect;
pub mod must_block_effect;
pub mod mutate_effect;
pub mod name_card_effect;
pub mod open_attraction_effect;
pub mod ownership_gain_effect;
pub mod peek_and_reveal_effect;
pub mod permanent_creature_effect;
pub mod permanent_effect;
pub mod permanent_noncreature_effect;
pub mod phases_effect;
pub mod planeswalk_effect;
pub mod play_effect;
pub mod play_land_variant_effect;
pub mod plot_effect;
pub mod poison_effect;
pub mod power_exchange_effect;
pub mod prevent_damage_effect;
pub mod protect_all_effect;
pub mod protect_effect;
pub mod pump_all_effect;
pub mod pump_effect;
pub mod radiation_effect;
pub mod rearrange_top_of_library_effect;
pub mod regenerate_effect;
pub mod regeneration_effect;
pub mod remove_from_combat_effect;
pub mod remove_from_game_effect;
pub mod remove_from_match_effect;
pub mod reorder_zone_effect;
pub mod repeat_each_effect;
pub mod repeat_effect;
pub mod replace_counter_effect;
pub mod replace_damage_effect;
pub mod replace_effect;
pub mod replace_mana_effect;
pub mod replace_split_damage_effect;
pub mod replace_token_effect;
pub mod restart_game_effect;
pub mod reveal_effect;
pub mod reveal_hand_effect;
pub mod reverse_turn_order_effect;
pub mod ring_tempts_you_effect;
pub mod roll_dice_effect;
pub mod roll_planar_dice_effect;
pub mod run_chaos_effect;
pub mod sacrifice_all_effect;
pub mod sacrifice_effect;
pub mod scry_effect;
pub mod seek_effect;
pub mod set_in_motion_effect;
pub mod set_state_effect;
pub mod shuffle_effect;
pub mod skip_phase_effect;
pub mod skip_turn_effect;
pub mod store_s_var_effect;
pub mod subgame_effect;
pub mod surveil_effect;
pub mod switch_block_effect;
pub mod take_initiative_effect;
pub mod tap_all_effect;
pub mod tap_effect;
pub mod tap_or_untap_all_effect;
pub mod tap_or_untap_effect;
pub mod text_box_exchange_effect;
pub mod time_travel_effect;
pub mod token_effect;
pub mod token_effect_base;
pub mod trait_animate_effect;
pub mod two_piles_effect;
pub mod unattach_effect;
pub mod unlock_door_effect;
pub mod untap_all_effect;
pub mod untap_effect;
pub mod venture_effect;
pub mod villainous_choice_effect;
pub mod vote_effect;
pub mod zone_exchange_effect;

// ── Infrastructure split out of this file for readability ─────────
pub mod combat_helpers;
pub mod condition;
pub mod cost_payment;
pub mod effect_context;
pub mod effect_resolver;
pub mod helpers;
pub mod targeting_triggers;
pub mod zone_triggers;

// ── Re-exports so external callers keep the `effects::X` path ──────
pub(crate) use combat_helpers::add_to_combat;
pub(crate) use cost_payment::{try_pay_cumulative_upkeep, try_pay_echo, try_pay_unless_cost};
pub use effect_context::EffectContext;
pub(crate) use effect_resolver::{build_spell_ability_for_api, sub_ability_handled_internally};
pub use effect_resolver::{
    resolve_effect, resolve_effect_chain, resolve_effect_chain_with_parent, IMPLEMENTED_API_TYPES,
};
pub(crate) use targeting_triggers::{emit_targeting_triggers, emit_targeting_triggers_for_sa};

// Re-exports so effect files can use short paths like `super::parse_counter_type()`.
pub use crate::mana::mana_atom_from_produced;
pub use crate::svar::{
    evaluate_svar, resolve_count_svar, resolve_count_svar_for_sa, resolve_numeric_svar,
    resolve_numeric_value,
};
pub use helpers::*;
pub use zone_triggers::*;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_num_dmg_test() {
        assert_eq!(
            helpers::parse_num_dmg(
                "SP$ DealDamage | ValidTgts$ Any | NumDmg$ 3 | SpellDescription$ test"
            ),
            3
        );
    }

    #[test]
    fn parse_param_test() {
        assert_eq!(
            helpers::parse_param("SP$ Pump | NumAtt$ 3 | NumDef$ 3", "NumAtt$ "),
            Some(3)
        );
        assert_eq!(
            helpers::parse_param("SP$ Pump | NumAtt$ 3 | NumDef$ 3", "NumDef$ "),
            Some(3)
        );
        assert_eq!(
            helpers::parse_param("SP$ Draw | NumCards$ 2", "NumCards$ "),
            Some(2)
        );
    }
}
