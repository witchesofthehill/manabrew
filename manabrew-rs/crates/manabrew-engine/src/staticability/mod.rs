pub mod layer;
pub mod static_ability;
pub mod static_ability_activate_ability_as_if_haste;
pub mod static_ability_adapt;
pub mod static_ability_alternative_cost;
pub mod static_ability_assign_combat_damage_as_unblocked;
pub mod static_ability_assign_no_combat_damage;
pub mod static_ability_attack_restrict;
pub mod static_ability_block_restrict;
pub mod static_ability_can_attack_defender;
pub mod static_ability_cant_attach;
pub mod static_ability_cant_attack_block;
pub mod static_ability_cant_be_cast;
pub mod static_ability_cant_be_copied;
pub mod static_ability_cant_be_suspected;
pub mod static_ability_cant_become_monarch;
pub mod static_ability_cant_change_day_time;
pub mod static_ability_cant_crew;
pub mod static_ability_cant_discard;
pub mod static_ability_cant_draw;
pub mod static_ability_cant_exile;
pub mod static_ability_cant_gain_lose_pay_life;
pub mod static_ability_cant_phase;
pub mod static_ability_cant_put_counter;
pub mod static_ability_cant_regenerate;
pub mod static_ability_cant_sacrifice;
pub mod static_ability_cant_target;
pub mod static_ability_cant_transform;
pub mod static_ability_cant_venture;
pub mod static_ability_cast_with_flash;
pub mod static_ability_colorless_damage_source;
pub mod static_ability_combat_damage_toughness;
pub mod static_ability_continuous;
pub mod static_ability_cost_change;
pub mod static_ability_counters_remain;
pub mod static_ability_devotion;
pub mod static_ability_disable_triggers;
pub mod static_ability_exhaust;
pub mod static_ability_flip_coin_mod;
pub mod static_ability_gain_life_radiation;
pub mod static_ability_ignore_hexproof_shroud;
pub mod static_ability_ignore_landwalk;
pub mod static_ability_ignore_legend_rule;
pub mod static_ability_infect_damage;
pub mod static_ability_layer;
pub mod static_ability_mana_convert;
pub mod static_ability_max_counter;
pub mod static_ability_mode;
pub mod static_ability_must_attack;
pub mod static_ability_must_block;
pub mod static_ability_must_target;
pub mod static_ability_no_cleanup_damage;
pub mod static_ability_num_loyalty_act;
pub mod static_ability_panharmonicon;
pub mod static_ability_plot_zone;
pub mod static_ability_surveil_num;
pub mod static_ability_tap_power_value;
pub mod static_ability_turn_phase_reversed;
pub mod static_ability_unspent_mana;
pub mod static_ability_untap_other_player;
pub mod static_ability_view;
pub mod static_ability_wither_damage;

use forge_foundation::ZoneType;

use crate::card::Card;
use crate::game::GameState;
use crate::ids::PlayerId;

pub use self::static_ability::*;
pub use layer::*;

/// Java-parity constructor entrypoint for `StaticAbility.java#create`.
/// Canonical parsing remains `parse_static_ability`.
pub fn create(params: &str) -> Option<StaticAbility> {
    static_ability::parse_static_ability(params)
}

/// Java-parity bridge for `StaticAbility.applyContinuousAbilityBefore(...)`.
/// The engine keeps a single source of truth in `layer::apply_continuous_effects`.
pub fn apply_continuous_ability_before(
    st_ab: &StaticAbility,
    source: &Card,
    game: &mut GameState,
    layer: Layer,
) {
    static_ability_continuous::apply_continuous_ability(st_ab, source, game, layer);
}

/// Java-parity bridge for `StaticAbility.applyContinuousAbility(...)`.
pub fn apply_continuous_ability(
    st_ab: &StaticAbility,
    source: &Card,
    game: &mut GameState,
    layer: Layer,
) {
    static_ability_continuous::apply_continuous_ability(st_ab, source, game, layer);
}

/// Java-parity helper for `StaticAbility.hasAttackCost(...)`.
pub fn has_attack_cost(st_ab: &StaticAbility, attacker: &Card, source: &Card) -> bool {
    if !st_ab.check_mode(&StaticMode::OptionalAttackCost) {
        return false;
    }
    static_ability_cant_attack_block::get_attack_cost(st_ab, attacker, source.controller, source)
        .is_some()
}

/// Java-parity bridge for `StaticAbility.checkMode(...)`.
pub fn check_mode(st_ab: &StaticAbility, mode: &StaticMode) -> bool {
    st_ab.check_mode(mode)
}

/// Java-parity bridge for `StaticAbility.checkConditions(...)`.
pub fn check_conditions(st_ab: &StaticAbility, source: &Card, game: &GameState) -> bool {
    st_ab.check_conditions(source, game)
}

/// Java-parity bridge for `StaticAbility.zonesCheck()`.
pub fn zones_check(st_ab: &StaticAbility, source_zone: ZoneType) -> bool {
    st_ab.zones_check(source_zone)
}

/// Java-parity bridge for `StaticAbility.addIgnoreEffectPlayers(...)`.
pub fn add_ignore_effect_players(st_ab: &mut StaticAbility, player: PlayerId) {
    st_ab.add_ignore_effect_players(player);
}

/// Java-parity bridge for `StaticAbility.clearIgnoreEffects()`.
pub fn clear_ignore_effects(st_ab: &mut StaticAbility) {
    st_ab.clear_ignore_effects();
}

/// Java-parity bridge for `StaticAbility.incMayPlayTurn()`.
pub fn inc_may_play_turn(st_ab: &mut StaticAbility) {
    st_ab.inc_may_play_turn();
}

/// Java-parity bridge for `StaticAbility.resetMayPlayTurn()`.
pub fn reset_may_play_turn(st_ab: &mut StaticAbility) {
    st_ab.reset_may_play_turn();
}

/// Java-parity bridge for `StaticAbility.copy(...)`.
pub fn copy(st_ab: &StaticAbility) -> StaticAbility {
    st_ab.copy()
}
