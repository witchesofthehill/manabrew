use std::collections::HashSet;

use forge_foundation::ZoneType;

use crate::card::CardInstance;
use crate::event::RunParams;
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::player::player_factory_util::{add_trigger_ability, new_player_effect_card};
use crate::player::{GameLossReason, PlayerOutcome, RegisteredPlayer};
use crate::replacement::replacement_handler::{
    apply_replacements, apply_replacements_with_agents, ReplacementEvent,
};
use crate::replacement::replacement_result::ReplacementResult;
use crate::trigger::handler::TriggerHandler;
use crate::trigger::TriggerType;

impl GameState {
    pub fn new_from_registered_players(players: &[RegisteredPlayer]) -> Self {
        let names: Vec<&str> = players.iter().map(|p| p.name.as_str()).collect();
        let starting_life = players.first().map(|p| p.starting_life).unwrap_or(20);
        let mut game = Self::new(&names, starting_life);
        for (idx, rp) in players.iter().enumerate() {
            let pid = PlayerId(idx as u32);
            let player = game.player_mut(pid);
            player.name = rp.name.clone();
            player.id = rp.id.unwrap_or(pid);
            player.starting_life = rp.starting_life;
            player.life = rp.starting_life;
            player.starting_hand_size = rp.starting_hand;
            player.max_hand_size = rp.max_hand_size;
            player.statistics.notify_opening_hand_size(rp.starting_hand);
            player.mana_shards = rp.mana_shards;
            player.team_number = rp.team_number;
            player.commander_damage_enabled = rp.commander_damage_enabled;
        }
        game
    }

    pub fn initialize_registered_player_cards(
        &mut self,
        player: PlayerId,
        registered: &RegisteredPlayer,
        cards: Vec<(CardInstance, ZoneType)>,
        trigger_handler: Option<&mut TriggerHandler>,
    ) {
        for (mut card, zone) in cards {
            card.set_owner(player);
            card.set_controller(player);
            let card_id = self.create_card(card);
            self.move_card(card_id, zone, player);
        }
        self.initialize_player_commanders_from_registered(player, registered, trigger_handler);
    }

    fn remove_player_effect_card(&mut self, player: PlayerId, effect_id: Option<CardId>) {
        let Some(effect_id) = effect_id else {
            return;
        };
        let zone = self.card(effect_id).zone;
        if zone != ZoneType::None {
            self.remove_card_from_zone(zone, player, effect_id);
        }
        self.card_mut(effect_id).zone = ZoneType::None;
    }

    fn ensure_speed_effect(&mut self, player: PlayerId) -> Option<CardId> {
        if self.player(player).speed == 0 {
            if let Some(effect_id) = self.player(player).speed_effect_card {
                self.remove_player_effect_card(player, Some(effect_id));
                self.player_mut(player).speed_effect_card = None;
            }
            return None;
        }
        if let Some(effect_id) = self.player(player).speed_effect_card {
            return Some(effect_id);
        }

        let mut effect = new_player_effect_card(player, "Start Your Engines!", None);
        add_trigger_ability(
            &mut effect,
            "Mode$ LifeLostAll | ValidPlayer$ Opponent | TriggerZones$ Command | ActivationLimit$ 1 | PlayerTurn$ True | CheckSVar$ Count$YourSpeed | SVarCompare$ LT4 | Execute$ SpeedUp | TriggerDescription$ Whenever one or more opponents lose life during your turn, if your speed is less than 4, your speed increases by 1. This ability triggers only once each turn.",
            [("SpeedUp", "DB$ ChangeSpeed")],
        );

        let effect_id = self.create_card(effect);
        self.move_card(effect_id, ZoneType::Command, player);
        self.player_mut(player).speed_effect_card = Some(effect_id);
        Some(effect_id)
    }

    fn ensure_monarch_effect(&mut self, player: PlayerId) -> CardId {
        if let Some(effect_id) = self.player(player).monarch_effect_card {
            return effect_id;
        }
        let mut effect = new_player_effect_card(player, "The Monarch", None);
        add_trigger_ability(
            &mut effect,
            "Mode$ Phase | Phase$ End of Turn | TriggerZones$ Command | ValidPlayer$ You | Execute$ DrawMonarchCard | TriggerDescription$ At the beginning of your end step, draw a card.",
            [("DrawMonarchCard", "DB$ Draw | Defined$ You")],
        );
        add_trigger_ability(
            &mut effect,
            "Mode$ DamageDone | ValidSource$ Creature | ValidTarget$ You | CombatDamage$ True | TriggerZones$ Command | Execute$ GainMonarch | TriggerDescription$ Whenever a creature deals combat damage to you, its controller becomes the monarch.",
            [(
                "GainMonarch",
                "DB$ BecomeMonarch | Defined$ TriggeredSourceController",
            )],
        );
        let effect_id = self.create_card(effect);
        self.move_card(effect_id, ZoneType::Command, player);
        self.player_mut(player).monarch_effect_card = Some(effect_id);
        effect_id
    }

    fn remove_monarch_effect(&mut self, player: PlayerId) {
        let effect_id = self.player(player).monarch_effect_card;
        self.remove_player_effect_card(player, effect_id);
        self.player_mut(player).monarch_effect_card = None;
    }

    fn ensure_initiative_effect(&mut self, player: PlayerId) -> CardId {
        if let Some(effect_id) = self.player(player).initiative_effect_card {
            return effect_id;
        }
        let mut effect = new_player_effect_card(player, "The Initiative", None);
        add_trigger_ability(
            &mut effect,
            "Mode$ DamageDoneOnceByController | ValidSource$ Player | ValidTarget$ You | CombatDamage$ True | TriggerZones$ Command | Execute$ TakeTheInitiative | TriggerDescription$ Whenever one or more creatures a player controls deal combat damage to you, that player takes the initiative.",
            [(
                "TakeTheInitiative",
                "DB$ TakeInitiative | Defined$ TriggeredSource",
            )],
        );
        add_trigger_ability(
            &mut effect,
            "Mode$ Phase | Phase$ Upkeep | TriggerZones$ Command | ValidPlayer$ You | Execute$ VentureUndercity | TriggerDescription$ At the beginning of your upkeep, venture into Undercity. | Secondary$ True",
            [("VentureUndercity", "DB$ Venture | Dungeon$ Undercity")],
        );
        add_trigger_ability(
            &mut effect,
            "Mode$ TakesInitiative | ValidPlayer$ You | TriggerZones$ Command | Execute$ VentureUndercity | TriggerDescription$ Whenever you take the initiative, venture into Undercity.",
            [("VentureUndercity", "DB$ Venture | Dungeon$ Undercity")],
        );
        let effect_id = self.create_card(effect);
        self.move_card(effect_id, ZoneType::Command, player);
        self.player_mut(player).initiative_effect_card = Some(effect_id);
        effect_id
    }

    fn remove_initiative_effect(&mut self, player: PlayerId) {
        let effect_id = self.player(player).initiative_effect_card;
        self.remove_player_effect_card(player, effect_id);
        self.player_mut(player).initiative_effect_card = None;
    }

    fn ensure_blessing_effect(&mut self, player: PlayerId) -> Option<CardId> {
        if !self.player(player).has_city_blessing {
            let effect_id = self.player(player).blessing_effect_card;
            self.remove_player_effect_card(player, effect_id);
            self.player_mut(player).blessing_effect_card = None;
            return None;
        }
        if let Some(effect_id) = self.player(player).blessing_effect_card {
            return Some(effect_id);
        }
        let effect = new_player_effect_card(player, "City's Blessing", None);
        let effect_id = self.create_card(effect);
        self.move_card(effect_id, ZoneType::Command, player);
        self.player_mut(player).blessing_effect_card = Some(effect_id);
        Some(effect_id)
    }

    fn ensure_radiation_effect(&mut self, player: PlayerId) -> Option<CardId> {
        if self.player(player).radiation_counters <= 0 {
            let effect_id = self.player(player).radiation_effect_card;
            self.remove_player_effect_card(player, effect_id);
            self.player_mut(player).radiation_effect_card = None;
            return None;
        }
        if let Some(effect_id) = self.player(player).radiation_effect_card {
            return Some(effect_id);
        }
        let mut effect = new_player_effect_card(player, "Radiation", None);
        add_trigger_ability(
            &mut effect,
            "Mode$ Phase | Phase$ Main1 | ValidPlayer$ You | TriggerZones$ Command | Execute$ ProcessRadiation | TriggerDescription$ At the beginning of your precombat main phase, if you have any rad counters, mill that many cards. For each nonland card milled this way, you lose 1 life and a rad counter.",
            [("ProcessRadiation", "DB$ InternalRadiation")],
        );
        let effect_id = self.create_card(effect);
        self.move_card(effect_id, ZoneType::Command, player);
        self.player_mut(player).radiation_effect_card = Some(effect_id);
        Some(effect_id)
    }

    pub fn player_register_radiation_effect(
        &mut self,
        player: PlayerId,
        trigger_handler: &mut TriggerHandler,
    ) {
        if let Some(effect_id) = self.ensure_radiation_effect(player) {
            trigger_handler.register_active_trigger(self, effect_id);
        }
    }

    pub fn player_cleanup_turn_state(&mut self, player: PlayerId) {
        self.player_clear_damage_prevention(player);
    }

    pub fn player_mark_lost(&mut self, player: PlayerId, reason: GameLossReason) {
        self.player_mut(player).mark_lost(PlayerOutcome::Loss {
            reason,
            spell_name: None,
        });
    }

    pub fn player_mark_won(&mut self, player: PlayerId) {
        self.player_mut(player).mark_won(PlayerOutcome::Win);
    }

    pub fn player_alt_win_by_spell_effect(
        &mut self,
        player: PlayerId,
        source_name: Option<String>,
    ) {
        self.player_mut(player)
            .mark_won(PlayerOutcome::AltWin { source_name });
    }

    pub fn player_concede(&mut self, player: PlayerId) {
        self.player_mut(player).mark_lost(PlayerOutcome::Conceded);
    }

    pub fn player_clear_outcome(&mut self, player: PlayerId) {
        self.player_mut(player).clear_outcome();
    }

    pub fn player_reset_for_restart(&mut self, player: PlayerId) {
        self.player_mut(player).reset_for_restart();
    }

    pub fn player_set_controlled_by(&mut self, player: PlayerId, controller: Option<PlayerId>) {
        self.player_mut(player).controlled_by = controller;
    }

    pub fn player_add_skip_turns(&mut self, player: PlayerId, amount: i32) {
        self.player_mut(player).skip_turns += amount;
    }

    pub fn player_decrement_skip_turns(&mut self, player: PlayerId) {
        let p = self.player_mut(player);
        p.skip_turns = (p.skip_turns - 1).max(0);
    }

    pub fn player_set_monarch(
        &mut self,
        player: PlayerId,
        trigger_handler: Option<&mut TriggerHandler>,
    ) {
        if let Some(previous) = self.monarch {
            if previous != player {
                self.remove_monarch_effect(previous);
            }
        }
        self.monarch = Some(player);
        let effect_id = self.ensure_monarch_effect(player);
        if let Some(handler) = trigger_handler {
            handler.register_active_trigger(self, effect_id);
            handler.run_trigger(
                TriggerType::BecomeMonarch,
                RunParams {
                    player: Some(player),
                    ..Default::default()
                },
                false,
            );
        }
    }

    pub fn player_take_initiative(
        &mut self,
        player: PlayerId,
        trigger_handler: Option<&mut TriggerHandler>,
    ) {
        if let Some(previous) = self.initiative_holder {
            if previous != player {
                self.remove_initiative_effect(previous);
            }
        }
        self.initiative_holder = Some(player);
        let effect_id = self.ensure_initiative_effect(player);
        if let Some(handler) = trigger_handler {
            handler.register_active_trigger(self, effect_id);
            handler.run_trigger(
                TriggerType::TakeInitiative,
                RunParams {
                    player: Some(player),
                    ..Default::default()
                },
                false,
            );
        }
    }

    pub fn player_set_ring_bearer(&mut self, player: PlayerId, bearer: Option<CardId>) {
        self.player_mut(player).ring_bearer = bearer;
    }

    pub fn player_set_blessing(&mut self, player: PlayerId, value: bool) {
        self.player_mut(player).has_city_blessing = value;
        self.ensure_blessing_effect(player);
    }

    pub fn player_ring_tempt(&mut self, player: PlayerId) {
        let current = self.player(player).ring_level;
        if current < 4 {
            self.player_mut(player).ring_level = current + 1;
        }
    }

    pub fn player_add_poison(&mut self, player: PlayerId, amount: i32) {
        if amount > 0 {
            self.player_mut(player).poison_counters += amount;
        }
    }

    pub fn player_remove_poison(&mut self, player: PlayerId, amount: i32) {
        if amount > 0 {
            let p = self.player_mut(player);
            p.poison_counters = (p.poison_counters - amount).max(0);
        }
    }

    pub fn player_add_energy(&mut self, player: PlayerId, amount: i32) {
        self.player_mut(player).energy_counters += amount;
    }

    pub fn player_can_pay_energy(&self, player: PlayerId, amount: i32) -> bool {
        amount <= 0 || self.player(player).energy_counters >= amount
    }

    pub fn player_lose_energy(&mut self, player: PlayerId, amount: i32) -> i32 {
        if amount <= 0 {
            return 0;
        }
        let p = self.player_mut(player);
        let paid = amount.min(p.energy_counters);
        p.energy_counters -= paid;
        paid
    }

    pub fn player_pay_energy(&mut self, player: PlayerId, amount: i32) -> bool {
        if !self.player_can_pay_energy(player, amount) {
            return false;
        }
        self.player_lose_energy(player, amount);
        true
    }

    pub fn player_add_shards(&mut self, player: PlayerId, amount: i32) {
        self.player_mut(player).mana_shards += amount;
    }

    pub fn player_can_pay_shards(&self, player: PlayerId, amount: i32) -> bool {
        amount <= 0 || self.player(player).mana_shards >= amount
    }

    pub fn player_lose_shards(&mut self, player: PlayerId, amount: i32) -> i32 {
        if amount <= 0 {
            return 0;
        }
        let p = self.player_mut(player);
        let paid = amount.min(p.mana_shards);
        p.mana_shards -= paid;
        paid
    }

    pub fn player_pay_shards(&mut self, player: PlayerId, amount: i32) -> bool {
        if !self.player_can_pay_shards(player, amount) {
            return false;
        }
        self.player_lose_shards(player, amount);
        true
    }

    pub fn player_add_radiation(&mut self, player: PlayerId, amount: i32) {
        self.player_mut(player).radiation_counters += amount;
        self.ensure_radiation_effect(player);
    }

    pub fn player_remove_radiation(&mut self, player: PlayerId, amount: i32) {
        if amount > 0 {
            let p = self.player_mut(player);
            p.radiation_counters = (p.radiation_counters - amount).max(0);
        }
        self.ensure_radiation_effect(player);
    }

    pub fn player_set_radiation(&mut self, player: PlayerId, amount: i32) {
        self.player_mut(player).radiation_counters = amount.max(0);
        self.ensure_radiation_effect(player);
    }

    pub fn player_gain_life(&mut self, player: PlayerId, amount: i32) -> i32 {
        if amount <= 0 {
            return 0;
        }
        self.player_mut(player).gain_life(amount);
        amount
    }

    pub fn player_can_gain_life(&self, player: PlayerId) -> bool {
        !crate::staticability::static_ability_cant_gain_lose_pay_life::cant_gain_life(self, player)
    }

    pub fn player_lose_life(&mut self, player: PlayerId, amount: i32) -> i32 {
        if amount <= 0 {
            return 0;
        }
        self.player_mut(player).lose_life(amount);
        amount
    }

    pub fn player_deal_damage(&mut self, player: PlayerId, amount: i32) -> i32 {
        if amount <= 0 {
            return 0;
        }
        if crate::staticability::static_ability_cant_gain_lose_pay_life::cant_lose_life(
            self, player,
        ) {
            return 0;
        }
        let mut event = ReplacementEvent::LifeReduced {
            player,
            amount,
            is_damage: true,
        };
        let result = apply_replacements(self, &mut event);
        if result == ReplacementResult::Skipped || result == ReplacementResult::Replaced {
            return 0;
        }
        let final_amount = if let ReplacementEvent::LifeReduced { amount, .. } = event {
            amount
        } else {
            amount
        };
        if final_amount <= 0 {
            return 0;
        }
        self.player_mut(player).deal_damage(final_amount);
        final_amount
    }

    pub fn player_can_lose_life(&self, player: PlayerId) -> bool {
        self.player(player).is_alive()
    }

    pub fn player_can_pay_life(&self, player: PlayerId, amount: i32) -> bool {
        amount <= 0 || self.player(player).life >= amount
    }

    pub fn player_pay_life(&mut self, player: PlayerId, amount: i32) -> bool {
        if !self.player_can_pay_life(player, amount) {
            return false;
        }
        self.player_lose_life(player, amount);
        true
    }

    pub fn player_set_life(&mut self, player: PlayerId, amount: i32) -> i32 {
        self.player_mut(player).set_life(amount)
    }

    pub fn player_exchange_life_totals(&mut self, a: PlayerId, b: PlayerId) {
        let life_a = self.player(a).life;
        let life_b = self.player(b).life;
        self.player_set_life(a, life_b);
        self.player_set_life(b, life_a);
    }

    pub fn player_add_damage_prevention(&mut self, player: PlayerId, amount: i32) {
        if amount > 0 {
            self.player_mut(player).damage_prevention += amount;
        }
    }

    pub fn player_clear_damage_prevention(&mut self, player: PlayerId) {
        self.player_mut(player).damage_prevention = 0;
    }

    pub fn player_record_land_play(&mut self, player: PlayerId) {
        self.player_mut(player).lands_played_this_turn += 1;
    }

    pub fn player_add_team_life_gained(&mut self, player: PlayerId, amount: i32) {
        if amount > 0 {
            self.player_mut(player).life_gained_by_team_this_turn += amount;
        }
    }

    pub fn player_record_permanent_left_battlefield(&mut self, player: PlayerId) {
        self.player_mut(player)
            .permanents_left_battlefield_this_turn += 1;
    }

    pub fn player_record_landfall(&mut self, player: PlayerId) {
        self.player_mut(player).lands_entered_battlefield_this_turn += 1;
    }

    pub fn player_record_permanent_put_into_graveyard(&mut self, player: PlayerId) {
        self.player_mut(player)
            .permanents_put_into_graveyard_this_turn += 1;
    }

    pub fn player_add_mana_expended(&mut self, player: PlayerId, amount: i32) {
        if amount > 0 {
            self.player_mut(player).mana_expended_this_turn += amount;
        }
    }

    pub fn player_set_mana_expended(&mut self, player: PlayerId, amount: i32) {
        self.player_mut(player).mana_expended_this_turn = amount.max(0);
    }

    pub fn player_record_discard(&mut self, player: PlayerId, amount: i32) {
        if amount > 0 {
            self.player_mut(player).discarded_this_turn += amount;
        }
    }

    pub fn player_record_explore(&mut self, player: PlayerId, amount: i32) {
        if amount > 0 {
            self.player_mut(player).explored_this_turn += amount;
        }
    }

    pub fn player_record_roll(&mut self, player: PlayerId, result: Option<i32>) {
        let p = self.player_mut(player);
        p.num_rolls_this_turn += 1;
        if let Some(v) = result {
            p.dice_rolls_this_turn.push(v);
        }
    }

    pub fn player_record_attraction_visit(&mut self, player: PlayerId, amount: i32) {
        self.player_mut(player).attractions_visited_this_turn += amount;
    }

    pub fn player_clear_skip_untap(&mut self, player: PlayerId) {
        self.player_mut(player).skip_next_untap = false;
    }

    pub fn player_clear_skip_draw(&mut self, player: PlayerId) {
        self.player_mut(player).skip_next_draw = false;
    }

    pub fn player_clear_skip_combat(&mut self, player: PlayerId) {
        self.player_mut(player).skip_next_combat = false;
    }

    pub fn player_set_skip_untap(&mut self, player: PlayerId) {
        self.player_mut(player).skip_next_untap = true;
    }

    pub fn player_set_skip_draw(&mut self, player: PlayerId) {
        self.player_mut(player).skip_next_draw = true;
    }

    pub fn player_set_skip_combat(&mut self, player: PlayerId) {
        self.player_mut(player).skip_next_combat = true;
    }

    pub fn player_attack_combat_reset(&mut self, player: PlayerId) {
        self.player_mut(player).attacked_players_this_combat.clear();
    }

    pub fn player_record_attacked_player(&mut self, player: PlayerId, defender: PlayerId) {
        let p = self.player_mut(player);
        p.attacked_players_this_turn.push(defender);
        p.attacked_players_this_combat.push(defender);
    }

    pub fn player_apply_mana_burn(&mut self, player: PlayerId, amount: i32) {
        if amount > 0 {
            self.player_lose_life(player, amount);
        }
    }

    pub fn player_set_speed_effect(&mut self, player: PlayerId, effect_id: Option<CardId>) {
        self.player_mut(player).speed_effect_card = effect_id;
    }

    pub fn player_set_speed(
        &mut self,
        player: PlayerId,
        speed: i32,
        trigger_handler: Option<&mut TriggerHandler>,
    ) {
        self.player_mut(player).speed = speed.clamp(0, 4);
        let effect_id = self.ensure_speed_effect(player);
        if let (Some(handler), Some(effect_id)) = (trigger_handler, effect_id) {
            handler.register_active_trigger(self, effect_id);
        }
    }

    pub fn increase_player_speed(
        &mut self,
        player: PlayerId,
        trigger_handler: Option<&mut TriggerHandler>,
    ) {
        let current = self.player(player).speed;
        if current < 4 {
            self.player_set_speed(player, current + 1, trigger_handler);
        }
    }

    pub fn decrease_player_speed(
        &mut self,
        player: PlayerId,
        trigger_handler: Option<&mut TriggerHandler>,
    ) {
        let current = self.player(player).speed;
        if current > 1 {
            self.player_set_speed(player, current - 1, trigger_handler);
        }
    }

    pub fn player_add_commander_damage(
        &mut self,
        player: PlayerId,
        commander: CardId,
        amount: i32,
    ) {
        if amount <= 0 || !self.player(player).commander_damage_enabled {
            return;
        }
        self.player_mut(player)
            .commander_damage_received
            .entry(commander.0)
            .and_modify(|v| *v += amount)
            .or_insert(amount);
    }

    pub fn player_record_damage_assignment(
        &mut self,
        source: Option<CardId>,
        target_player: Option<PlayerId>,
        amount: i32,
        is_combat: bool,
    ) {
        if amount <= 0 {
            return;
        }
        let Some(source_id) = source else {
            return;
        };
        let controller = self.card(source_id).controller;
        {
            let controller_state = self.player_mut(controller);
            controller_state.assigned_damage_this_turn += amount;
            if is_combat {
                controller_state.assigned_combat_damage_this_turn += amount;
            }
        }
        if let Some(target) = target_player {
            if target != controller {
                self.player_mut(controller)
                    .opponents_assigned_damage_this_turn += amount;
            }
            if is_combat {
                self.player_mut(target)
                    .been_dealt_combat_damage_since_last_turn = true;
            }
        }
    }

    pub fn player_draw_one(&mut self, player: PlayerId) -> Option<CardId> {
        self.player_draw_one_internal(player, false, None)
    }

    /// Draw a card for the draw step (sets `is_first_in_draw_step: true`).
    pub fn player_draw_one_for_turn(&mut self, player: PlayerId) -> Option<CardId> {
        self.player_draw_one_internal(player, true, None)
    }

    /// Draw a card for the draw step with agent access for Optional replacement
    /// effects (Dredge). Mirrors Java's draw path which calls
    /// `confirmReplacementEffect` through the replacement handler.
    pub fn player_draw_one_for_turn_with_agents(
        &mut self,
        player: PlayerId,
        agents: &mut [Box<dyn crate::agent::PlayerAgent>],
    ) -> Option<CardId> {
        self.player_draw_one_internal(player, true, Some(agents))
    }

    /// Internal draw implementation shared by normal draws and draw-step draws.
    /// After the replacement handler runs, extra_draws are consumed by drawing
    /// additional cards (mirrors Java Draw replacement which increments NumCards).
    pub(crate) fn player_draw_one_internal(
        &mut self,
        player: PlayerId,
        is_first_in_draw_step: bool,
        agents: Option<&mut [Box<dyn crate::agent::PlayerAgent>]>,
    ) -> Option<CardId> {
        if !self.player_can_draw(player) {
            return None;
        }
        let mut event = ReplacementEvent::Draw {
            player,
            extra_draws: 0,
            is_first_in_draw_step,
        };
        let result = if let Some(agents) = agents {
            apply_replacements_with_agents(self, agents, &mut event)
        } else {
            apply_replacements(self, &mut event)
        };
        if result == ReplacementResult::Skipped || result == ReplacementResult::Replaced {
            return None;
        }
        // Extract extra_draws set by replacement effects (e.g. Alhammarret's Archive)
        let extra = if let ReplacementEvent::Draw { extra_draws, .. } = &event {
            *extra_draws
        } else {
            0
        };
        let Some(card_id) = self.take_top_card_from_zone(ZoneType::Library, player) else {
            self.player_mut(player).tried_to_draw_from_empty_library = true;
            return None;
        };
        self.move_card(card_id, ZoneType::Hand, player);
        self.player_mut(player).drawn_this_turn += 1;
        // Draw extra cards from replacement effects (each goes through its own
        // replacement pipeline — is_first_in_draw_step is false for extras).
        for _ in 0..extra {
            self.player_draw_one(player);
        }
        Some(card_id)
    }

    pub fn player_can_draw(&self, player: PlayerId) -> bool {
        crate::staticability::static_ability_cant_draw::can_draw_amount(self, player, 1) > 0
    }

    pub fn player_can_draw_amount(&self, player: PlayerId, amount: i32) -> bool {
        crate::staticability::static_ability_cant_draw::can_draw_amount(self, player, amount) > 0
    }

    pub fn player_draw_cards(&mut self, player: PlayerId, amount: usize) -> Vec<CardId> {
        let mut drawn = Vec::with_capacity(amount);
        for _ in 0..amount {
            if let Some(card_id) = self.player_draw_one(player) {
                drawn.push(card_id);
            } else {
                break;
            }
        }
        drawn
    }

    pub fn player_shuffle_library(&mut self, player: PlayerId, rng: &mut impl rand::Rng) {
        self.shuffle_zone_cards_with_rand(ZoneType::Library, player, rng);
    }

    pub fn player_record_spell_cast(&mut self, player: PlayerId, card_id: CardId) {
        let p = self.player_mut(player);
        p.spells_cast_this_turn += 1;
        p.spells_cast_this_game += 1;
        p.cards_cast_this_turn.push(card_id);
        p.statistics.record_spell_cast(card_id);
    }

    pub fn player_hand_count(&self, player: PlayerId) -> usize {
        self.cards_in_zone(ZoneType::Hand, player).len()
    }

    pub fn player_graveyard_count(&self, player: PlayerId) -> usize {
        self.cards_in_zone(ZoneType::Graveyard, player).len()
    }

    pub fn player_graveyard_type_count(&self, player: PlayerId) -> usize {
        let mut types = HashSet::new();
        for &cid in self.cards_in_zone(ZoneType::Graveyard, player) {
            let card = self.card(cid);
            for core_type in &card.type_line.core_types {
                types.insert(core_type.name());
            }
        }
        types.len()
    }

    pub fn player_has_hellbent(&self, player: PlayerId) -> bool {
        self.player_hand_count(player) == 0
    }

    pub fn player_has_threshold(&self, player: PlayerId) -> bool {
        self.player_graveyard_count(player) >= 7
    }

    pub fn player_has_metalcraft(&self, player: PlayerId) -> bool {
        self.cards_in_zone(ZoneType::Battlefield, player)
            .iter()
            .filter(|&&cid| self.card(cid).type_line.is_artifact())
            .count()
            >= 3
    }

    pub fn player_has_delirium(&self, player: PlayerId) -> bool {
        self.player_graveyard_type_count(player) >= 4
    }

    pub fn player_has_ferocious(&self, player: PlayerId) -> bool {
        self.cards_in_zone(ZoneType::Battlefield, player)
            .iter()
            .any(|&cid| {
                let card = self.card(cid);
                card.is_creature() && card.power() >= 4
            })
    }

    pub fn player_has_desert(&self, player: PlayerId) -> bool {
        self.cards_in_zone(ZoneType::Battlefield, player)
            .iter()
            .any(|&cid| self.card(cid).type_line.has_subtype("Desert"))
    }

    pub fn player_has_blessing(&self, player: PlayerId) -> bool {
        self.player(player).has_city_blessing
    }

    pub fn player_has_revolt(&self, player: PlayerId) -> bool {
        self.player(player).permanents_left_battlefield_this_turn > 0
    }

    pub fn player_has_landfall(&self, player: PlayerId) -> bool {
        self.player(player).lands_entered_battlefield_this_turn > 0
    }

    pub fn player_has_descended(&self, player: PlayerId) -> bool {
        self.player(player).permanents_put_into_graveyard_this_turn > 0
    }

    pub fn player_controls_urza_lands(&self, player: PlayerId) -> bool {
        let battlefield = self.cards_in_zone(ZoneType::Battlefield, player);
        let has_mine = battlefield
            .iter()
            .any(|&cid| self.card(cid).type_line.has_subtype("Mine"));
        let has_plant = battlefield
            .iter()
            .any(|&cid| self.card(cid).type_line.has_subtype("Power-Plant"));
        let has_tower = battlefield
            .iter()
            .any(|&cid| self.card(cid).type_line.has_subtype("Tower"));
        has_mine && has_plant && has_tower
    }

    pub fn player_opponents_lost_life_this_turn(&self, player: PlayerId) -> bool {
        self.player_order
            .iter()
            .copied()
            .filter(|&other| other != player)
            .any(|other| self.player(other).life_lost_this_turn > 0)
    }

    pub fn player_has_bloodthirst(&self, player: PlayerId) -> bool {
        self.player(player).opponents_assigned_damage_this_turn > 0
    }

    pub fn player_can_surge(&self, player: PlayerId) -> bool {
        self.player(player).spells_cast_this_turn > 0
    }

    pub fn player_spells_cast_this_turn(&self, player: PlayerId) -> i32 {
        self.player(player).spells_cast_this_turn
    }

    pub fn player_storm_count(&self, _player: PlayerId) -> i32 {
        (self.stack.spells_cast_this_turn() as i32 - 1).max(0)
    }

    pub fn player_reset_drawn_this_turn(&mut self, player: PlayerId) {
        self.player_mut(player).drawn_this_turn = 0;
    }

    pub fn player_new_turn(&mut self, player: PlayerId) {
        self.player_mut(player).new_turn();
    }

    pub fn player_check_lose_condition(&mut self, player: PlayerId) -> bool {
        if !self.player(player).is_alive() {
            return true;
        }
        if self.player(player).tried_to_draw_from_empty_library {
            self.player_mut(player).tried_to_draw_from_empty_library = false;
            let mut event = ReplacementEvent::GameLoss {
                player,
                reason: GameLossReason::Milled,
            };
            let result = apply_replacements(self, &mut event);
            if result != ReplacementResult::Replaced {
                self.player_mark_lost(player, GameLossReason::Milled);
                return true;
            }
        }
        if self.player(player).life <= 0 {
            let mut event = ReplacementEvent::GameLoss {
                player,
                reason: GameLossReason::LifeReachedZero,
            };
            let result = apply_replacements(self, &mut event);
            if result != ReplacementResult::Replaced {
                self.player_mark_lost(player, GameLossReason::LifeReachedZero);
                return true;
            }
        }
        if self.player(player).poison_counters >= 10 {
            let mut event = ReplacementEvent::GameLoss {
                player,
                reason: GameLossReason::Poisoned,
            };
            let result = apply_replacements(self, &mut event);
            if result != ReplacementResult::Replaced {
                self.player_mark_lost(player, GameLossReason::Poisoned);
                return true;
            }
        }
        if self.player(player).commander_damage_enabled
            && self
                .player(player)
                .commander_damage_received
                .values()
                .any(|&amount| amount >= 21)
        {
            let mut event = ReplacementEvent::GameLoss {
                player,
                reason: GameLossReason::CommanderDamage,
            };
            let result = apply_replacements(self, &mut event);
            if result != ReplacementResult::Replaced {
                self.player_mark_lost(player, GameLossReason::CommanderDamage);
                return true;
            }
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::player::registered_player::RegisteredPlayerVariant;

    #[test]
    fn draw_from_empty_library_sets_mill_loss_flag() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let player = PlayerId(0);

        assert_eq!(game.player_draw_one(player), None);
        assert!(game.player(player).tried_to_draw_from_empty_library);
    }

    #[test]
    fn empty_library_draw_loses_game_as_milled() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let player = PlayerId(0);

        assert_eq!(game.player_draw_one(player), None);
        assert!(game.player_check_lose_condition(player));
        assert!(game.player(player).has_lost);
        assert_eq!(
            game.player(player).outcome,
            Some(PlayerOutcome::Loss {
                reason: GameLossReason::Milled,
                spell_name: None,
            })
        );
        assert!(!game.player(player).tried_to_draw_from_empty_library);
    }

    #[test]
    fn brawl_registration_disables_commander_damage_loss() {
        let players = vec![
            RegisteredPlayer::for_variant_set(
                "Alice",
                &[RegisteredPlayerVariant::Brawl],
                vec!["Commander".to_string()],
                vec![],
                false,
                vec![],
                vec![],
            ),
            RegisteredPlayer::new("Bob"),
        ];
        let mut game = GameState::new_from_registered_players(&players);
        let commander = CardId(99);

        game.player_add_commander_damage(PlayerId(0), commander, 21);

        assert!(!game.player_check_lose_condition(PlayerId(0)));
        assert!(!game.player(PlayerId(0)).has_lost);
    }
}
