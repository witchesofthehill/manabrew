pub mod actions;
pub mod commander;
pub mod delayed_reveal;
pub mod game_loss_reason;
pub mod player_action_confirm_mode;
pub mod player_collection;
pub mod player_controller;
pub mod player_factory_util;
pub mod player_outcome;
pub mod player_predicates;
pub mod player_property;
pub mod player_statistics;
pub mod registered_player;
pub mod service;
pub mod state;

use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::player::player_factory_util::{
    add_static_ability, add_trigger_ability, new_player_effect_card,
};
use crate::spellability::SpellAbility;
use crate::trigger::handler::TriggerHandler;
use forge_foundation::ZoneType;

pub use delayed_reveal::DelayedReveal;
pub use game_loss_reason::GameLossReason;
pub use player_collection::PlayerCollection;
pub use player_controller::PlayerController;
pub use player_outcome::PlayerOutcome;
pub use player_property::player_has_property;
pub use player_statistics::PlayerStatistics;
pub use registered_player::RegisteredPlayer;
pub use state::PlayerState;

pub fn gain_life(game: &mut GameState, player: PlayerId, amount: i32) -> i32 {
    game.player_gain_life(player, amount)
}

pub fn can_gain_life(game: &GameState, player: PlayerId) -> bool {
    game.player_can_gain_life(player)
}

pub fn lose_life(game: &mut GameState, player: PlayerId, amount: i32) -> i32 {
    game.player_lose_life(player, amount)
}

pub fn can_lose_life(game: &GameState, player: PlayerId) -> bool {
    game.player_can_lose_life(player)
}

pub fn can_pay_life(game: &GameState, player: PlayerId, amount: i32) -> bool {
    game.player_can_pay_life(player, amount)
}

pub fn pay_life(game: &mut GameState, player: PlayerId, amount: i32) -> bool {
    game.player_pay_life(player, amount)
}

pub fn can_pay_energy(game: &GameState, player: PlayerId, amount: i32) -> bool {
    game.player_can_pay_energy(player, amount)
}

pub fn lose_energy(game: &mut GameState, player: PlayerId, amount: i32) -> i32 {
    game.player_lose_energy(player, amount)
}

pub fn pay_energy(game: &mut GameState, player: PlayerId, amount: i32) -> bool {
    game.player_pay_energy(player, amount)
}

pub fn can_pay_shards(game: &GameState, player: PlayerId, amount: i32) -> bool {
    game.player_can_pay_shards(player, amount)
}

pub fn lose_shards(game: &mut GameState, player: PlayerId, amount: i32) -> i32 {
    game.player_lose_shards(player, amount)
}

pub fn pay_shards(game: &mut GameState, player: PlayerId, amount: i32) -> bool {
    game.player_pay_shards(player, amount)
}

pub fn add_rad_counters(game: &mut GameState, player: PlayerId, amount: i32) {
    game.player_add_radiation(player, amount);
}

pub fn remove_rad_counters(game: &mut GameState, player: PlayerId, amount: i32) {
    game.player_remove_radiation(player, amount);
}

pub fn add_poison_counters(game: &mut GameState, player: PlayerId, amount: i32) {
    game.player_add_poison(player, amount);
}

pub fn remove_poison_counters(game: &mut GameState, player: PlayerId, amount: i32) {
    game.player_remove_poison(player, amount);
}

pub fn can_draw(game: &GameState, player: PlayerId) -> bool {
    game.player_can_draw(player)
}

pub fn can_draw_amount(game: &GameState, player: PlayerId, amount: i32) -> bool {
    game.player_can_draw_amount(player, amount)
}

pub fn draw_card(game: &mut GameState, player: PlayerId) -> Option<CardId> {
    game.player_draw_one(player)
}

pub fn draw_cards(game: &mut GameState, player: PlayerId, amount: usize) -> Vec<CardId> {
    game.player_draw_cards(player, amount)
}

pub fn reset_num_drawn_this_draw_step(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).drawn_this_draw_step = 0;
}

pub fn reset_num_drawn_this_turn(game: &mut GameState, player: PlayerId) {
    game.player_reset_drawn_this_turn(player);
}

pub fn num_drawn_this_draw_step(game: &GameState, player: PlayerId) -> i32 {
    game.player(player).drawn_this_draw_step
}

pub fn shuffle(game: &mut GameState, player: PlayerId, rng: &mut impl rand::Rng) {
    game.player_shuffle_library(player, rng);
}

pub fn play_land(game: &mut GameState, player: PlayerId) {
    game.player_record_land_play(player);
}

pub fn play_land_no_check(game: &mut GameState, player: PlayerId) {
    game.player_record_land_play(player);
}

pub fn can_play_land(game: &GameState, player: PlayerId) -> bool {
    game.player(player).can_play_land()
}

pub fn add_max_land_plays(game: &mut GameState, player: PlayerId, amount: i32) {
    game.player_mut(player).max_land_plays_per_turn += amount;
}

pub fn remove_max_land_plays(game: &mut GameState, player: PlayerId, amount: i32) {
    game.player_mut(player).max_land_plays_per_turn =
        (game.player(player).max_land_plays_per_turn - amount).max(0);
}

pub fn add_max_land_plays_infinite(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).unlimited_land_plays = true;
}

pub fn remove_max_land_plays_infinite(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).unlimited_land_plays = false;
}

pub fn add_land_played_this_turn(game: &mut GameState, player: PlayerId) {
    game.player_record_land_play(player);
}

pub fn reset_lands_played_this_turn(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).lands_played_this_turn = 0;
}

pub fn add_spell_cast_this_turn(game: &mut GameState, player: PlayerId, card_id: CardId) {
    game.player_record_spell_cast(player, card_id);
}

pub fn reset_spells_cast_this_turn(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).spells_cast_this_turn = 0;
    game.player_mut(player).cards_cast_this_turn.clear();
}

pub fn reset_spell_cast_this_game(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).spells_cast_this_game = 0;
}

pub fn add_life_gained_by_team_this_turn(game: &mut GameState, player: PlayerId, amount: i32) {
    game.player_add_team_life_gained(player, amount);
}

pub fn add_explored_this_turn(game: &mut GameState, player: PlayerId, amount: i32) {
    game.player_record_explore(player, amount);
}

pub fn reset_num_explored_this_turn(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).explored_this_turn = 0;
}

pub fn reset_discarded_this_turn(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).discarded_this_turn = 0;
}

pub fn surveil(game: &mut GameState, player: PlayerId, amount: i32) {
    game.player_mut(player).surveilled_this_turn += amount.max(0);
}

pub fn reset_surveil_this_turn(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).surveilled_this_turn = 0;
}

pub fn reset_num_rolls_this_turn(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).num_rolls_this_turn = 0;
    game.player_mut(player).dice_rolls_this_turn.clear();
}

pub fn roll(game: &mut GameState, player: PlayerId, result: i32) {
    game.player_record_roll(player, Some(result));
}

pub fn reset_num_flips_this_turn(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).num_flips_this_turn = 0;
}

pub fn flip(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).num_flips_this_turn += 1;
}

pub fn discard(game: &mut GameState, player: PlayerId, amount: i32) {
    game.player_record_discard(player, amount);
}

pub fn add_tokens_created_this_turn(game: &mut GameState, player: PlayerId, amount: i32) {
    game.player_mut(player).tokens_created_this_turn += amount.max(0);
}

pub fn reset_num_token_created_this_turn(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).tokens_created_this_turn = 0;
}

pub fn add_foretold_this_turn(game: &mut GameState, player: PlayerId, amount: i32) {
    game.player_mut(player).foretold_this_turn += amount.max(0);
}

pub fn reset_num_foretold_this_turn(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).foretold_this_turn = 0;
}

pub fn add_note_for_name(game: &mut GameState, player: PlayerId, name: &str, note: String) {
    game.player_mut(player)
        .notes
        .entry(name.to_string())
        .or_default()
        .push(note);
}

pub fn clear_notes_for_name(game: &mut GameState, player: PlayerId, name: &str) {
    game.player_mut(player).notes.remove(name);
}

pub fn note_number_for_name(game: &mut GameState, player: PlayerId, name: &str, value: i32) {
    game.player_mut(player)
        .noted_num
        .insert(name.to_string(), value);
}

pub fn mill(game: &mut GameState, player: PlayerId, amount: usize) -> Vec<CardId> {
    let mut milled = Vec::with_capacity(amount);
    for _ in 0..amount {
        let Some(card_id) = game.take_top_card_from_zone(ZoneType::Library, player) else {
            break;
        };
        let owner = game.card(card_id).owner;
        game.move_card(card_id, ZoneType::Graveyard, owner);
        milled.push(card_id);
    }
    milled
}

pub fn increase_speed(
    game: &mut GameState,
    player: PlayerId,
    trigger_handler: Option<&mut TriggerHandler>,
) {
    game.increase_player_speed(player, trigger_handler);
}

pub fn decrease_speed(
    game: &mut GameState,
    player: PlayerId,
    trigger_handler: Option<&mut TriggerHandler>,
) {
    game.decrease_player_speed(player, trigger_handler);
}

pub fn no_speed(game: &GameState, player: PlayerId) -> bool {
    game.player(player).speed == 0
}

pub fn max_speed(game: &GameState, player: PlayerId) -> bool {
    game.player(player).speed == 4
}

pub fn alt_win_by_spell_effect(
    game: &mut GameState,
    player: PlayerId,
    source_name: Option<String>,
) {
    game.player_alt_win_by_spell_effect(player, source_name);
}

pub fn concede(game: &mut GameState, player: PlayerId) {
    game.player_concede(player);
}

pub fn check_lose_condition(game: &mut GameState, player: PlayerId) -> bool {
    game.player_check_lose_condition(player)
}

pub fn has_lost(game: &GameState, player: PlayerId) -> bool {
    game.player(player).has_lost
}

pub fn has_won(game: &GameState, player: PlayerId) -> bool {
    game.player(player).has_won
}

pub fn has_metalcraft(game: &GameState, player: PlayerId) -> bool {
    game.player_has_metalcraft(player)
}

pub fn has_desert(game: &GameState, player: PlayerId) -> bool {
    game.player_has_desert(player)
}

pub fn has_threshold(game: &GameState, player: PlayerId) -> bool {
    game.player_has_threshold(player)
}

pub fn has_hellbent(game: &GameState, player: PlayerId) -> bool {
    game.player_has_hellbent(player)
}

pub fn has_revolt(game: &GameState, player: PlayerId) -> bool {
    game.player_has_revolt(player)
}

pub fn descend(game: &mut GameState, player: PlayerId) {
    game.player_record_permanent_put_into_graveyard(player);
}

pub fn has_delirium(game: &GameState, player: PlayerId) -> bool {
    game.player_has_delirium(player)
}

pub fn has_landfall(game: &GameState, player: PlayerId) -> bool {
    game.player_has_landfall(player)
}

pub fn has_ferocious(game: &GameState, player: PlayerId) -> bool {
    game.player_has_ferocious(player)
}

pub fn has_surge(game: &GameState, player: PlayerId) -> bool {
    game.player_can_surge(player)
}

pub fn has_bloodthirst(game: &GameState, player: PlayerId) -> bool {
    game.player_has_bloodthirst(player)
}

pub fn has_property(
    game: &GameState,
    player: PlayerId,
    property: &str,
    source_id: CardId,
    controller: PlayerId,
    sa: &SpellAbility,
) -> bool {
    player_property::player_has_property(player, property, game, source_id, controller, sa)
}

pub fn has_keyword(game: &GameState, player: PlayerId, keyword: &str) -> bool {
    player_predicates::has_keyword(game, player, keyword)
}

pub fn can_be_targeted_by(game: &GameState, player: PlayerId, _source: CardId) -> bool {
    game.player(player).is_alive() && !has_keyword(game, player, "Shroud")
}

pub fn can_mulligan(game: &GameState, player: PlayerId) -> bool {
    !game.cards_in_zone(ZoneType::Library, player).is_empty()
}

pub fn on_cleanup_phase(game: &mut GameState, player: PlayerId) {
    game.player_cleanup_turn_state(player);
}

pub fn update_zone_for_view(game: &GameState, player: PlayerId, zone: ZoneType) -> usize {
    game.cards_in_zone(zone, player).len()
}

pub fn update_all_zones_for_view(game: &GameState, player: PlayerId) -> Vec<(ZoneType, usize)> {
    [
        ZoneType::Battlefield,
        ZoneType::Hand,
        ZoneType::Graveyard,
        ZoneType::Library,
        ZoneType::Exile,
        ZoneType::Command,
    ]
    .into_iter()
    .map(|zone| (zone, game.cards_in_zone(zone, player).len()))
    .collect()
}

pub fn reset_extra_zones(game: &mut GameState, player: PlayerId) {
    let cards = game.cards_in_zone(ZoneType::ExtraHand, player).to_vec();
    for card_id in cards {
        game.remove_card_from_zone(ZoneType::ExtraHand, player, card_id);
        game.card_mut(card_id).zone = ZoneType::None;
    }
}

pub fn can_cast_sorcery(game: &GameState, player: PlayerId) -> bool {
    game.turn.active_player == player && game.turn.phase.is_main() && game.stack.is_empty()
}

pub fn create_speed_effect(
    game: &mut GameState,
    player: PlayerId,
    trigger_handler: Option<&mut TriggerHandler>,
) {
    let speed = game.player(player).speed.max(1);
    game.player_set_speed(player, speed, trigger_handler);
}

pub fn lose_condition_met(game: &mut GameState, player: PlayerId) -> bool {
    check_lose_condition(game, player)
}

pub fn intentional_draw(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).outcome = Some(PlayerOutcome::Draw);
}

pub fn conceded(game: &GameState, player: PlayerId) -> bool {
    game.player(player).has_conceded
}

pub fn cant_lose(game: &GameState, player: PlayerId) -> bool {
    !game.player_can_lose_life(player)
}

pub fn cant_lose_for_zero_or_less_life(game: &GameState, player: PlayerId) -> bool {
    crate::staticability::static_ability_cant_gain_lose_pay_life::cant_lose_life(game, player)
}

pub fn cant_lose_check(game: &GameState, player: PlayerId) -> bool {
    cant_lose(game, player) || cant_lose_for_zero_or_less_life(game, player)
}

pub fn cant_win(game: &GameState, player: PlayerId) -> bool {
    has_keyword(game, player, "CantWin")
}

pub fn add_commander(game: &mut GameState, player: PlayerId, commander: CardId) {
    game.player_register_commander(player, commander);
}

pub fn remove_commander(game: &mut GameState, player: PlayerId, commander: CardId) {
    game.player_remove_commander(player, commander);
}

pub fn add_commander_damage(
    game: &mut GameState,
    player: PlayerId,
    commander: CardId,
    amount: i32,
) {
    game.player_add_commander_damage(player, commander, amount);
}

pub fn inc_commander_cast(game: &mut GameState, player: PlayerId, commander: CardId) {
    game.player_increment_commander_cast(player, commander);
}

pub fn reset_commander_stats(game: &mut GameState, player: PlayerId) {
    game.player_reset_commander_state(player);
}

pub fn create_commander_effect(
    game: &mut GameState,
    player: PlayerId,
    trigger_handler: Option<&mut TriggerHandler>,
) -> Option<CardId> {
    game.player_create_commander_effect(player, trigger_handler)
}

pub fn create_monarch_effect(
    game: &mut GameState,
    player: PlayerId,
    trigger_handler: Option<&mut TriggerHandler>,
) {
    game.player_set_monarch(player, trigger_handler);
}

pub fn remove_monarch_effect(game: &mut GameState, player: PlayerId) {
    if let Some(effect_id) = game.player(player).monarch_effect_card {
        if game.card(effect_id).zone == ZoneType::Command {
            game.remove_card_from_zone(ZoneType::Command, player, effect_id);
        }
        game.card_mut(effect_id).zone = ZoneType::None;
    }
    if game.monarch == Some(player) {
        game.monarch = None;
    }
    game.player_mut(player).monarch_effect_card = None;
}

pub fn can_become_monarch(game: &GameState, player: PlayerId) -> bool {
    game.player(player).is_alive() && game.monarch != Some(player)
}

pub fn create_initiative_effect(
    game: &mut GameState,
    player: PlayerId,
    trigger_handler: Option<&mut TriggerHandler>,
) {
    game.player_take_initiative(player, trigger_handler);
}

pub fn has_initiative(game: &GameState, player: PlayerId) -> bool {
    game.initiative_holder == Some(player)
}

pub fn create_radiation_effect(
    game: &mut GameState,
    player: PlayerId,
    trigger_handler: &mut TriggerHandler,
) {
    game.player_register_radiation_effect(player, trigger_handler);
}

pub fn remove_initiative_effect(game: &mut GameState, player: PlayerId) {
    if let Some(effect_id) = game.player(player).initiative_effect_card {
        if game.card(effect_id).zone == ZoneType::Command {
            game.remove_card_from_zone(ZoneType::Command, player, effect_id);
        }
        game.card_mut(effect_id).zone = ZoneType::None;
    }
    if game.initiative_holder == Some(player) {
        game.initiative_holder = None;
    }
    game.player_mut(player).initiative_effect_card = None;
}

pub fn remove_radiation_effect(game: &mut GameState, player: PlayerId) {
    if let Some(effect_id) = game.player(player).radiation_effect_card {
        if game.card(effect_id).zone == ZoneType::Command {
            game.remove_card_from_zone(ZoneType::Command, player, effect_id);
        }
        game.card_mut(effect_id).zone = ZoneType::None;
    }
    game.player_mut(player).radiation_effect_card = None;
}

pub fn has_radiation_effect(game: &GameState, player: PlayerId) -> bool {
    game.player(player).radiation_effect_card.is_some()
}

pub fn has_blessing(game: &GameState, player: PlayerId) -> bool {
    game.player_has_blessing(player)
}

pub fn same_team(game: &GameState, player: PlayerId, other: PlayerId) -> bool {
    player_predicates::same_team(game, player, other)
}

pub fn can_discard_by(game: &GameState, player: PlayerId, other: PlayerId) -> bool {
    player_predicates::can_discard_by(game, player, other)
}

pub fn add_cycled(game: &mut GameState, player: PlayerId, card_id: CardId) {
    game.player_record_spell_cast(player, card_id);
}

pub fn has_urza_lands(game: &GameState, player: PlayerId) -> bool {
    game.player_controls_urza_lands(player)
}

pub fn commit_crime(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).committed_crime_this_turn += 1;
}

pub fn add_die_roll_this_turn(game: &mut GameState, player: PlayerId, roll: i32) {
    game.player_record_roll(player, Some(roll));
}

pub fn visit_attractions(game: &mut GameState, player: PlayerId, amount: i32) {
    game.player_record_attraction_visit(player, amount);
}

pub fn add_creatures_attacked_this_turn(
    game: &mut GameState,
    player: PlayerId,
    defender: PlayerId,
) {
    game.player_record_attacked_player(player, defender);
}

pub fn clear_attacked_players_my_combat(game: &mut GameState, player: PlayerId) {
    game.player_attack_combat_reset(player);
}

pub fn increment_ring_tempted_you(game: &mut GameState, player: PlayerId) {
    game.player_ring_tempt(player);
}

pub fn reset_ring_tempted_you(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).ring_level = 0;
    game.player_set_ring_bearer(player, None);
}

pub fn on_game_over(game: &mut GameState, player: PlayerId) {
    let face_down = reveal_face_down_cards(game, player);
    for card_id in face_down {
        game.card_mut(card_id).face_down = false;
    }
}

pub fn clear_the_ring(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).ring_level = 0;
}

pub fn clear_ring_bearer(game: &mut GameState, player: PlayerId) {
    game.player_set_ring_bearer(player, None);
}

pub fn increment_turn(game: &mut GameState, player: PlayerId) {
    game.player_new_turn(player);
}

pub fn has_tapped_land_for_mana_this_turn(game: &GameState, player: PlayerId) -> bool {
    game.player(player).tapped_land_for_mana_this_turn
}

pub fn has_been_dealt_combat_damage_since_last_turn(game: &GameState, player: PlayerId) -> bool {
    game.player(player).been_dealt_combat_damage_since_last_turn
}

pub fn clear_attacked_my_turn(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).attacked_players_this_turn.clear();
}

pub fn increment_ventured_this_turn(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).ventured_this_turn += 1;
}

pub fn reset_ventured_this_turn(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).ventured_this_turn = 0;
}

pub fn add_completed_dungeon(game: &mut GameState, player: PlayerId, dungeon: CardId) {
    game.player_mut(player).completed_dungeons.push(dungeon);
}

pub fn reset_completed_dungeons(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).completed_dungeons.clear();
}

pub fn has_prowl(game: &GameState, player: PlayerId) -> bool {
    game.player_has_bloodthirst(player)
}

pub fn has_freerunning(game: &GameState, player: PlayerId) -> bool {
    game.player_has_bloodthirst(player)
}

pub fn inc_library_searched(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).library_searched_this_turn += 1;
}

pub fn add_investigated_this_turn(game: &mut GameState, player: PlayerId, amount: i32) {
    game.player_mut(player).investigated_this_turn += amount.max(0);
}

pub fn reset_investigated_this_turn(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).investigated_this_turn = 0;
}

pub fn add_sacrificed_this_turn(game: &mut GameState, player: PlayerId, amount: i32) {
    game.player_mut(player).sacrificed_this_turn += amount.max(0);
}

pub fn reset_sacrificed_this_turn(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).sacrificed_this_turn = 0;
}

pub fn reset_spell_cast_since_beg_of_your_last_turn(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).cards_cast_this_turn.clear();
}

pub fn add_spell_cast_since_beg_of_your_last_turn(
    game: &mut GameState,
    player: PlayerId,
    card_id: CardId,
) {
    game.player_mut(player).cards_cast_this_turn.push(card_id);
}

pub fn add_damage_after_prevention(game: &mut GameState, player: PlayerId, amount: i32) -> i32 {
    let prevented = amount.min(game.player(player).damage_prevention);
    let final_amount = amount - prevented;
    game.player_mut(player).damage_prevention -= prevented;
    if final_amount > 0 {
        game.player_deal_damage(player, final_amount);
    }
    final_amount
}

pub fn static_replace_damage(_game: &GameState, _player: PlayerId, amount: i32) -> i32 {
    amount.max(0)
}

pub fn process_damage(game: &mut GameState, player: PlayerId, amount: i32) -> i32 {
    add_damage_after_prevention(game, player, amount)
}

pub fn can_receive_counters(game: &GameState, player: PlayerId, amount: i32) -> bool {
    amount > 0 && game.player(player).is_alive()
}

pub fn can_remove_counters(game: &GameState, player: PlayerId, counter: &str, amount: i32) -> bool {
    if !game.player(player).is_alive() {
        return false;
    }
    let current = match counter {
        "Poison" => game.player(player).poison_counters,
        "Energy" => game.player(player).energy_counters,
        "Rad" | "Radiation" => game.player(player).radiation_counters,
        _ => 0,
    };
    current >= amount.max(0)
}

pub fn add_counter_internal(game: &mut GameState, player: PlayerId, counter: &str, amount: i32) {
    match counter {
        "Poison" => add_poison_counters(game, player, amount),
        "Energy" => game.player_add_energy(player, amount),
        "Rad" | "Radiation" => add_rad_counters(game, player, amount),
        _ => {}
    }
}

pub fn subtract_counter(game: &mut GameState, player: PlayerId, counter: &str, amount: i32) {
    match counter {
        "Poison" => remove_poison_counters(game, player, amount),
        "Energy" => {
            game.player_lose_energy(player, amount);
        }
        "Rad" | "Radiation" => remove_rad_counters(game, player, amount),
        _ => {}
    }
}

pub fn clear_counters(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).poison_counters = 0;
    game.player_mut(player).energy_counters = 0;
    game.player_set_radiation(player, 0);
}

pub fn add_pump_keyword_with_duration(
    game: &mut GameState,
    player: PlayerId,
    keyword: String,
    duration: Option<&crate::spellability::AbilityDuration>,
) {
    match duration {
        Some(crate::spellability::AbilityDuration::UntilYourNextTurn) => {
            game.player_mut(player)
                .keywords_until_my_next_turn
                .push(keyword.clone());
        }
        Some(crate::spellability::AbilityDuration::Permanent)
        | Some(crate::spellability::AbilityDuration::Perpetual) => {}
        _ => {
            game.player_mut(player)
                .keywords_until_end_of_turn
                .push(keyword.clone());
        }
    }
    add_changed_keywords(game, player, keyword);
    update_keyword_card_ability_text(game, player);
}

pub fn expire_until_your_next_turn_keywords(game: &mut GameState, player: PlayerId) {
    let expired = std::mem::take(&mut game.player_mut(player).keywords_until_my_next_turn);
    for keyword in expired {
        remove_changed_keywords(game, player, &keyword);
    }
    update_keyword_card_ability_text(game, player);
}

pub fn expire_end_of_turn_keywords(game: &mut GameState, player: PlayerId) {
    let expired = std::mem::take(&mut game.player_mut(player).keywords_until_end_of_turn);
    for keyword in expired {
        remove_changed_keywords(game, player, &keyword);
    }
    update_keyword_card_ability_text(game, player);
}

pub fn add_changed_keywords(game: &mut GameState, player: PlayerId, keyword: String) {
    if !game.player(player).changed_keywords.contains(&keyword) {
        game.player_mut(player).changed_keywords.push(keyword);
    }
}

pub fn remove_changed_keywords(game: &mut GameState, player: PlayerId, keyword: &str) {
    game.player_mut(player)
        .changed_keywords
        .retain(|candidate| candidate != keyword);
}

pub fn add_maingame_card_mapping(
    game: &mut GameState,
    player: PlayerId,
    original: CardId,
    mapped: CardId,
) {
    game.player_mut(player)
        .maingame_card_mapping
        .insert(original, mapped);
}

pub fn update_mana_for_view(game: &GameState, player: PlayerId) -> i32 {
    game.player(player).mana_shards
}

pub fn add_controller(game: &mut GameState, player: PlayerId, controller: PlayerId) {
    game.player_set_controlled_by(player, Some(controller));
}

pub fn remove_controller(game: &mut GameState, player: PlayerId, controller: PlayerId) {
    if game.player(player).controlled_by == Some(controller) {
        game.player_set_controlled_by(player, None);
    }
}

pub fn clear_controller(game: &mut GameState, player: PlayerId) {
    game.player_set_controlled_by(player, None);
}

pub fn add_controlled_while_searching(
    game: &mut GameState,
    player: PlayerId,
    controller: PlayerId,
) {
    game.player_mut(player)
        .controlled_while_searching
        .insert(controller);
}

pub fn remove_controlled_while_searching(
    game: &mut GameState,
    player: PlayerId,
    controller: PlayerId,
) {
    game.player_mut(player)
        .controlled_while_searching
        .remove(&controller);
}

pub fn dangerously_set_controller(
    game: &mut GameState,
    player: PlayerId,
    controller: Option<PlayerId>,
) {
    game.player_set_controlled_by(player, controller);
}

pub fn update_avatar(game: &mut GameState, player: PlayerId, avatar_index: i32) {
    game.player_mut(player).avatar_index = avatar_index;
}

pub fn update_sleeve(game: &mut GameState, player: PlayerId, sleeve_index: i32) {
    game.player_mut(player).sleeve_index = sleeve_index;
}

pub fn run_with_controller<R>(
    game: &mut GameState,
    player: PlayerId,
    controller: Option<PlayerId>,
    f: impl FnOnce(&mut GameState) -> R,
) -> R {
    let previous = game.player(player).controlled_by;
    game.player_set_controlled_by(player, controller);
    let result = f(game);
    game.player_set_controlled_by(player, previous);
    result
}

pub fn add_inbound_token(game: &mut GameState, player: PlayerId, card: CardId) {
    if !game.player(player).inbound_tokens.contains(&card) {
        game.player_mut(player).inbound_tokens.push(card);
    }
}

pub fn remove_inbound_token(game: &mut GameState, player: PlayerId, card: CardId) {
    game.player_mut(player)
        .inbound_tokens
        .retain(|&c| c != card);
}

pub fn on_mulliganned(game: &mut GameState, player: PlayerId) {
    game.player_mut(player)
        .num_cards_in_hand_started_this_turn_with =
        game.cards_in_zone(ZoneType::Hand, player).len() as i32;
}

pub fn copy_commanders_to_snapshot(game: &GameState, player: PlayerId) -> Vec<CardId> {
    game.player_registered_commanders(player).to_vec()
}

pub fn update_merged_commander_info(game: &mut GameState, player: PlayerId) {
    let commanders = game.player_registered_commanders(player).to_vec();
    for commander in commanders {
        game.card_mut(commander).is_commander = true;
    }
}

pub fn init_variants_zones(game: &mut GameState, player: PlayerId) {
    for zone in [
        ZoneType::ExtraHand,
        ZoneType::SchemeDeck,
        ZoneType::PlanarDeck,
        ZoneType::AttractionDeck,
        ZoneType::ContraptionDeck,
        ZoneType::Junkyard,
    ] {
        let _ = game.zone(zone, player);
    }
}

pub fn init_commander_color(game: &mut GameState, player: PlayerId) {
    let commanders = game.player_registered_commanders(player).to_vec();
    for commander in commanders {
        let has_choose_color = game.card(commander).static_abilities.iter().any(|st_ab| {
            st_ab
                .ir
                .description_text
                .as_deref()
                .map(|desc| {
                    desc.contains(
                        "If CARDNAME is your commander, choose a color before the game begins.",
                    )
                })
                .unwrap_or(false)
        });
        if has_choose_color && game.card(commander).chosen_colors.is_empty() {
            game.card_mut(commander).add_chosen_color("White");
        }
    }
}

pub fn all_cards_unique_mana_symbols(game: &GameState, player: PlayerId) -> bool {
    use std::collections::HashSet;

    let mut colored = HashSet::new();
    let mut generic = HashSet::new();
    for &card_id in game.cards_in_zone(ZoneType::Library, player) {
        let cost = &game.card(card_id).mana_cost;
        for shard in cost.shards() {
            if !colored.insert(*shard) {
                return false;
            }
        }
        let generic_cost = cost.generic_cost();
        if (generic_cost > 0 || cost.cmc() == 0) && !generic.insert(generic_cost) {
            return false;
        }
    }
    true
}

pub fn assign_companion(game: &mut GameState, player: PlayerId, card: CardId) {
    if game.card(card).zone != ZoneType::Sideboard {
        return;
    }
    create_companion_effect(game, player);
    game.move_card(card, ZoneType::Command, player);
}

pub fn deck_matches_deck_restriction(
    game: &GameState,
    player: PlayerId,
    restriction: &str,
) -> bool {
    let restrictions: Vec<&str> = restriction
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();
    if restrictions.is_empty() {
        return true;
    }
    game.cards_in_zone(ZoneType::Library, player)
        .iter()
        .copied()
        .all(|card_id| {
            restrictions
                .iter()
                .all(|restriction| game.card(card_id).has_property(restriction))
        })
}

pub fn create_companion_effect(game: &mut GameState, player: PlayerId) {
    if game.player(player).companion_effect_card.is_some() {
        return;
    }
    let mut effect = new_player_effect_card(player, "Companion Effect", None);
    add_static_ability(
        &mut effect,
        "Mode$ Continuous | EffectZone$ Command | Affected$ Card.YouOwn+EffectSource | AffectedZone$ Command | AddAbility$ MoveToHand",
    );
    effect.set_s_var(
        "MoveToHand",
        "ST$ ChangeZone | Cost$ 3 | Defined$ Self | Origin$ Command | Destination$ Hand | SorcerySpeed$ True | ActivationZone$ Command | SpellDescription$ Companion - Put CARDNAME in to your hand",
    );
    let effect_id = game.create_card(effect);
    game.move_card(effect_id, ZoneType::Command, player);
    game.player_mut(player).companion_effect_card = Some(effect_id);
}

pub fn create_planechase_effects(game: &mut GameState, player: PlayerId) {
    if game.player(player).planar_dice_effect_card.is_some() {
        return;
    }
    let mut effect = new_player_effect_card(player, "Planar Dice", None);
    add_trigger_ability(
        &mut effect,
        "Mode$ PlanarDice | Result$ Planeswalk | TriggerZones$ Command | ValidPlayer$ You | Secondary$ True | Execute$ RolledPlaneswalk | TriggerDescription$ Whenever you roll the Planeswalker symbol on the planar die, planeswalk.",
        [("RolledPlaneswalk", "DB$ Planeswalk | Cause$ PlanarDie")],
    );
    effect.set_s_var(
        "RollPlanarDice",
        "ST$ RollPlanarDice | Cost$ X | SorcerySpeed$ True | Activator$ Player | SpecialAction$ True | ActivationZone$ Command | SpellDescription$ Roll the planar dice. X is equal to the number of times you have previously taken this action this turn. | CostDesc$ {X}: ",
    );
    let effect_id = game.create_card(effect);
    game.move_card(effect_id, ZoneType::Command, player);
    game.player_mut(player).planar_dice_effect_card = Some(effect_id);
}

pub fn create_the_ring(game: &mut GameState, player: PlayerId) {
    if game.player(player).ring_effect_card.is_some() {
        return;
    }
    let effect = new_player_effect_card(player, "The Ring", None);
    let effect_id = game.create_card(effect);
    game.move_card(effect_id, ZoneType::Command, player);
    game.player_mut(player).ring_effect_card = Some(effect_id);
}

pub fn change_ownership(game: &mut GameState, card_id: CardId, new_owner: PlayerId) {
    let old_owner = game.card(card_id).owner;
    if old_owner == new_owner {
        return;
    }
    game.card_mut(card_id).owner = new_owner;
    if !game.card(card_id).is_token {
        let old_player = game.player_mut(old_owner);
        if let Some(pos) = old_player
            .gained_ownership
            .iter()
            .position(|&c| c == card_id)
        {
            old_player.gained_ownership.remove(pos);
        } else if !old_player.lost_ownership.contains(&card_id) {
            old_player.lost_ownership.push(card_id);
        }
        let new_player = game.player_mut(new_owner);
        if let Some(pos) = new_player.lost_ownership.iter().position(|&c| c == card_id) {
            new_player.lost_ownership.remove(pos);
        } else if !new_player.gained_ownership.contains(&card_id) {
            new_player.gained_ownership.push(card_id);
        }
    }
}

pub fn destroy_physical_card(game: &mut GameState, card_id: CardId) {
    if !game.card(card_id).is_token {
        let owner = game.card(card_id).owner;
        if !game.player(owner).lost_ownership.contains(&card_id) {
            game.player_mut(owner).lost_ownership.push(card_id);
        }
    }
    let zone = game.card(card_id).zone;
    let controller = game.card(card_id).controller;
    if zone != ZoneType::None {
        game.remove_card_from_zone(zone, controller, card_id);
    }
    game.card_mut(card_id).zone = ZoneType::None;
}

pub fn push_paid_for_sa(game: &mut GameState, player: PlayerId, sa: &SpellAbility) {
    game.player_mut(player).paid_for_stack.push(sa.clone());
}

pub fn pop_paid_for_sa(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).paid_for_stack.pop();
}

pub fn clear_paid_for_sa(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).paid_for_stack.clear();
}

pub fn update_keyword_card_ability_text(game: &mut GameState, player: PlayerId) {
    trim_keywords(game, player);
    let has_keywords = !game.player(player).changed_keywords.is_empty();
    match (game.player(player).keyword_effect_card, has_keywords) {
        (Some(effect_id), false) => {
            if game.card(effect_id).zone != ZoneType::None {
                game.remove_card_from_zone(ZoneType::Command, player, effect_id);
                game.card_mut(effect_id).zone = ZoneType::None;
            }
            game.player_mut(player).keyword_effect_card = None;
        }
        (None, true) => {
            let effect = new_player_effect_card(player, "Keyword Effects", None);
            let effect_id = game.create_card(effect);
            game.move_card(effect_id, ZoneType::Command, player);
            game.player_mut(player).keyword_effect_card = Some(effect_id);
        }
        _ => {}
    }
}

pub fn trim_keywords(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).changed_keywords.sort();
    game.player_mut(player).changed_keywords.dedup();
}

pub fn check_keyword_card(game: &GameState, player: PlayerId, keyword: &str) -> bool {
    game.player(player)
        .changed_keywords
        .iter()
        .any(|candidate| candidate == keyword)
}

pub fn can_search_library_with(game: &GameState, player: PlayerId, source: CardId) -> bool {
    if has_keyword(game, player, "CantSearchLibrary") {
        return false;
    }
    let source_controller = game.card(source).controller;
    !(source_controller == player
        && has_keyword(
            game,
            player,
            "Spells and abilities you control can't cause you to search your library.",
        ))
}

pub fn add_additional_vote(game: &mut GameState, player: PlayerId, key: i64, amount: i32) {
    game.player_mut(player).additional_votes.insert(key, amount);
}

pub fn remove_additional_vote(game: &mut GameState, player: PlayerId, key: i64) {
    game.player_mut(player).additional_votes.remove(&key);
}

pub fn add_additional_optional_vote(game: &mut GameState, player: PlayerId, key: i64, amount: i32) {
    game.player_mut(player)
        .additional_optional_votes
        .insert(key, amount);
}

pub fn remove_additional_optional_vote(game: &mut GameState, player: PlayerId, key: i64) {
    game.player_mut(player)
        .additional_optional_votes
        .remove(&key);
}

pub fn add_control_vote(game: &mut GameState, player: PlayerId, key: i64) {
    game.player_mut(player).control_votes.insert(key);
}

pub fn remove_control_vote(game: &mut GameState, player: PlayerId, key: i64) {
    game.player_mut(player).control_votes.remove(&key);
}

pub fn add_additional_villainous_choices(
    game: &mut GameState,
    player: PlayerId,
    key: i64,
    amount: i32,
) {
    game.player_mut(player)
        .additional_villainous_choices
        .insert(key, amount);
}

pub fn remove_additional_villainous_choices(game: &mut GameState, player: PlayerId, key: i64) {
    game.player_mut(player)
        .additional_villainous_choices
        .remove(&key);
}

pub fn learn_lesson(game: &mut GameState, player: PlayerId) {
    if game.player(player).has_lost {
        return;
    }
    let lesson = game
        .cards_in_zone(ZoneType::Sideboard, player)
        .iter()
        .copied()
        .find(|&card_id| game.card(card_id).type_line.has_subtype("Lesson"));
    if let Some(card_id) = lesson {
        game.move_card(card_id, ZoneType::Hand, player);
    }
}

pub fn roll_to_visit_attractions(game: &mut GameState, player: PlayerId, result: i32) {
    roll(game, player, result);
    if result >= 1 {
        visit_attractions(game, player, 1);
    }
}

pub fn advance_crank_counter(game: &mut GameState, player: PlayerId) -> i32 {
    let next = (game.player(player).crank_counter % 3) + 1;
    game.player_mut(player).crank_counter = next;
    next
}

pub fn create_contraption_sprockets(game: &mut GameState, player: PlayerId) {
    if game
        .player(player)
        .contraption_sprocket_effect_card
        .is_some()
    {
        return;
    }
    let effect = new_player_effect_card(player, "Contraption Sprockets", None);
    let effect_id = game.create_card(effect);
    game.move_card(effect_id, ZoneType::Command, player);
    game.player_mut(player).contraption_sprocket_effect_card = Some(effect_id);
}

pub fn add_declares_attackers(game: &mut GameState, player: PlayerId, declarer: PlayerId) {
    game.player_mut(player).declares_attackers.insert(declarer);
}

pub fn remove_declares_attackers(game: &mut GameState, player: PlayerId, declarer: PlayerId) {
    game.player_mut(player).declares_attackers.remove(&declarer);
}

pub fn add_declares_blockers(game: &mut GameState, player: PlayerId, declarer: PlayerId) {
    game.player_mut(player).declares_blockers.insert(declarer);
}

pub fn remove_declares_blockers(game: &mut GameState, player: PlayerId, declarer: PlayerId) {
    game.player_mut(player).declares_blockers.remove(&declarer);
}

pub fn after_static_ability_layer(game: &mut GameState, player: PlayerId) {
    game.player_mut(player).devotion_mod = 0;
}

pub fn trigger_elemental_bend(game: &mut GameState, player: PlayerId, trigger: &str) {
    game.player_mut(player)
        .elemental_bend_triggers
        .insert(trigger.to_string());
}

pub fn has_all_element_bend(game: &GameState, player: PlayerId, triggers: &[&str]) -> bool {
    triggers.iter().all(|trigger| {
        game.player(player)
            .elemental_bend_triggers
            .contains(*trigger)
    })
}

pub fn planeswalk(game: &mut GameState, player: PlayerId) -> Option<CardId> {
    let next_plane = game
        .cards_in_zone(ZoneType::PlanarDeck, player)
        .first()
        .copied()?;
    planeswalk_to(game, player, next_plane);
    Some(next_plane)
}

pub fn planeswalk_to(game: &mut GameState, player: PlayerId, plane: CardId) {
    if game
        .player(player)
        .planeswalked_to_this_turn
        .contains(&plane)
    {
        return;
    }
    leave_current_plane(game, player);
    game.move_card(plane, ZoneType::Command, player);
    game.player_mut(player)
        .planeswalked_to_this_turn
        .push(plane);
}

pub fn leave_current_plane(game: &mut GameState, player: PlayerId) {
    if let Some(current) = game
        .cards_in_zone(ZoneType::Command, player)
        .iter()
        .copied()
        .find(|&card_id| {
            let card = game.card(card_id);
            card.type_line.has_subtype("Plane") || card.type_line.has_subtype("Phenomenon")
        })
    {
        game.move_card(current, ZoneType::PlanarDeck, player);
    }
}

pub fn remove_current_plane(game: &mut GameState, player: PlayerId) -> Option<CardId> {
    let current = game
        .cards_in_zone(ZoneType::Command, player)
        .iter()
        .copied()
        .find(|&card_id| {
            let card = game.card(card_id);
            card.type_line.has_subtype("Plane") || card.type_line.has_subtype("Phenomenon")
        })?;
    game.remove_card_from_zone(ZoneType::Command, player, current);
    game.card_mut(current).zone = ZoneType::None;
    Some(current)
}

pub fn init_plane(game: &mut GameState, player: PlayerId, plane: CardId) {
    game.move_card(plane, ZoneType::Command, player);
}

pub fn reveal_face_down_cards(game: &GameState, player: PlayerId) -> Vec<CardId> {
    game.cards_in_zone(ZoneType::Battlefield, player)
        .iter()
        .copied()
        .filter(|&card_id| game.card(card_id).face_down)
        .collect()
}
