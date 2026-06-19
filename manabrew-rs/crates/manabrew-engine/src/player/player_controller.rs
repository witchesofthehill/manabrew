use std::collections::BTreeSet;

use crate::agent::game_log::GameLogEvent;
use crate::agent::types::{
    BinaryChoiceKind, CombatCostAction, GameEntity, ManaAbilityOption, ManaCostAction, PlayOption,
    RollSwapChoice, TargetChoice,
};
use crate::agent::PlayerAgent;
use crate::combat::DefenderId;
use crate::cost::{payment_decision::PaymentDecision, CostPart};
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::mana::ManaPool;
use crate::player::actions::PlayerAction;
use crate::player::player_factory_util::build_priority_actions;
use crate::player::DelayedReveal;
use crate::spellability::SpellAbility;
use forge_foundation::{ManaCost, ZoneType};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum FullControlFlag {
    ChooseCostOrder,
    ChooseCostReductionOrderAndVariableAmount,
    NoPaymentFromManaAbility,
    NoFreeCombatCostHandling,
    AllowPaymentStartWithMissingResources,
    LayerTimestampOrder,
}

pub struct PlayerController<'a, A: PlayerAgent + ?Sized> {
    pub game: &'a GameState,
    pub player: PlayerId,
    pub agent: &'a mut A,
    pub full_controls: BTreeSet<FullControlFlag>,
}

impl<'a, A: PlayerAgent + ?Sized> PlayerController<'a, A> {
    pub fn new(game: &'a GameState, player: PlayerId, agent: &'a mut A) -> Self {
        Self {
            game,
            player,
            agent,
            full_controls: BTreeSet::new(),
        }
    }

    pub fn snapshot_state(&mut self, mana_pools: &[ManaPool]) {
        self.agent.snapshot_state(self.game, mana_pools);
    }

    pub fn available_priority_actions(
        &self,
        playable: &[PlayOption],
        tappable_lands: &[CardId],
        untappable_lands: &[CardId],
        activatable: &[(CardId, usize)],
    ) -> Vec<PlayerAction> {
        build_priority_actions(playable, tappable_lands, untappable_lands, activatable)
    }

    pub fn add_full_control(&mut self, flag: FullControlFlag) {
        self.full_controls.insert(flag);
    }

    pub fn remove_full_control(&mut self, flag: FullControlFlag) {
        self.full_controls.remove(&flag);
    }

    pub fn has_full_control(&self, flag: FullControlFlag) -> bool {
        self.full_controls.contains(&flag)
    }

    pub fn notify(&mut self, event: crate::agent::notification::GameNotification) {
        self.agent.notify(event);
    }

    pub fn reveal_cards(
        &mut self,
        cards: &[CardId],
        zone: ZoneType,
        owner: PlayerId,
        message_prefix: Option<&str>,
    ) {
        self.agent
            .reveal_cards(self.game, self.player, cards, zone, owner, message_prefix);
        let mut message = String::new();
        if let Some(prefix) = message_prefix {
            message.push_str(prefix);
            message.push(' ');
        }
        message.push_str("Reveal ");
        message.push_str(&format!("{zone:?} cards"));
        self.agent
            .notify(crate::agent::notification::GameNotification::Event(
                GameLogEvent::rule(message)
                    .with_player(owner)
                    .with_card(*cards.first().unwrap_or(&CardId(0))),
            ));
    }

    pub fn temp_show_cards(&mut self, cards: &[CardId]) {
        self.reveal_cards(cards, ZoneType::Hand, self.player, Some("Show"));
    }

    pub fn end_temp_show_cards(&mut self) {}

    pub fn reveal_delayed(&mut self, delayed: &DelayedReveal) {
        let owner = delayed.owner.unwrap_or(self.player);
        for &zone in &delayed.zone {
            self.reveal_cards(
                &delayed.cards,
                zone,
                owner,
                delayed.message_prefix.as_deref(),
            );
        }
    }

    pub fn choose_attackers(
        &mut self,
        available: &[CardId],
        possible_defenders: &[DefenderId],
    ) -> Vec<(CardId, DefenderId)> {
        self.agent
            .choose_attackers(self.player, available, possible_defenders)
    }

    pub fn choose_blockers(
        &mut self,
        attackers: &[CardId],
        available_blockers: &[CardId],
        max_blockers: Option<usize>,
    ) -> Vec<(CardId, CardId)> {
        self.agent
            .choose_blockers(self.player, attackers, available_blockers, max_blockers)
    }

    pub fn choose_blocker_for(&mut self, attackers: &[CardId], blocker: CardId) -> Option<CardId> {
        self.agent
            .choose_blocker_for(self.player, attackers, blocker)
    }

    pub fn exert_attackers(&mut self, attackers: &[CardId]) -> Vec<CardId> {
        self.agent.exert_attackers(self.player, attackers)
    }

    pub fn enlist_attackers(&mut self, attackers: &[CardId]) -> Vec<CardId> {
        self.agent.enlist_attackers(self.player, attackers)
    }

    pub fn choose_damage_assignment_order(
        &mut self,
        attacker: CardId,
        blockers: &[CardId],
    ) -> Vec<CardId> {
        self.agent
            .choose_damage_assignment_order(self.player, attacker, blockers)
    }

    pub fn assign_combat_damage(
        &mut self,
        attacker: CardId,
        blockers_in_order: &[CardId],
        defender: Option<DefenderId>,
        damage_to_assign: i32,
    ) -> Vec<(Option<CardId>, i32)> {
        self.agent.assign_combat_damage(
            self.game,
            self.player,
            attacker,
            blockers_in_order,
            defender,
            damage_to_assign,
        )
    }

    pub fn choose_target_player(
        &mut self,
        valid: &[PlayerId],
        sa: Option<&SpellAbility>,
    ) -> Option<PlayerId> {
        self.agent.choose_target_player(self.player, valid, sa)
    }

    pub fn choose_target_card(
        &mut self,
        valid: &[CardId],
        sa: Option<&SpellAbility>,
    ) -> Option<CardId> {
        self.agent.choose_target_card(self.player, valid, sa)
    }

    pub fn choose_target_any(
        &mut self,
        valid_players: &[PlayerId],
        valid_cards: &[CardId],
        sa: Option<&SpellAbility>,
    ) -> TargetChoice {
        self.agent
            .choose_target_any(self.player, valid_players, valid_cards, sa)
    }

    pub fn choose_entities_for_effect(
        &mut self,
        candidates: &[GameEntity],
        min: usize,
        max: usize,
    ) -> Vec<GameEntity> {
        self.agent
            .choose_entities_for_effect(self.player, candidates, min, max)
    }

    pub fn choose_single_entity_for_effect(
        &mut self,
        candidates: &[GameEntity],
    ) -> Option<GameEntity> {
        // Route through the trait's single-entity method so the deterministic
        // parity agent emits `choose_single_entity_for_effect` (with `pick_one[N]`)
        // rather than the multi-entity `choose_entities_for_effect`
        // (`pick_count` + `pick_index` + `pick_many_unique`). Both pick the same
        // candidate for size-1 lists, but the callback log lines and RNG
        // consumption differ — the single-entity variant matches Java's
        // `chooseSingleEntityForEffect` behaviour.
        self.agent
            .choose_single_entity_for_effect(self.player, candidates, false)
    }

    pub fn choose_cards_for_effect(
        &mut self,
        valid: &[CardId],
        min: usize,
        max: usize,
    ) -> Vec<CardId> {
        self.agent
            .choose_cards_for_effect(self.player, valid, min, max)
    }

    pub fn choose_cards_for_zone_change(
        &mut self,
        valid: &[CardId],
        min: usize,
        max: usize,
        select_prompt: &str,
    ) -> Vec<CardId> {
        self.agent.choose_cards_for_zone_change(
            self.game,
            self.player,
            valid,
            min,
            max,
            select_prompt,
        )
    }

    pub fn choose_single_card_for_zone_change(
        &mut self,
        valid: &[CardId],
        select_prompt: &str,
        is_optional: bool,
    ) -> Option<CardId> {
        self.agent.choose_single_card_for_zone_change(
            self.game,
            self.player,
            valid,
            select_prompt,
            is_optional,
        )
    }

    pub fn choose_type(&mut self, type_category: &str, valid_types: &[String]) -> Option<String> {
        self.agent
            .choose_type(self.player, type_category, valid_types)
    }

    pub fn choose_some_type(
        &mut self,
        type_category: &str,
        valid_types: &[String],
    ) -> Option<String> {
        self.choose_type(type_category, valid_types)
    }

    pub fn choose_number_from_list(
        &mut self,
        choices: &[i32],
        message: &str,
        source_card_id: Option<CardId>,
    ) -> Option<i32> {
        self.agent
            .choose_number_from_list(self.player, choices, message, source_card_id)
    }

    pub fn choose_binary(
        &mut self,
        question: &str,
        kind: BinaryChoiceKind,
        default_choice: Option<bool>,
        source: Option<CardId>,
        api: Option<crate::ability::api_type::ApiType>,
    ) -> bool {
        self.agent
            .choose_binary(self.player, question, kind, default_choice, source, api)
    }

    pub fn confirm_action(
        &mut self,
        mode: Option<&str>,
        message: &str,
        options: &[String],
        source: Option<CardId>,
        api: Option<crate::ability::api_type::ApiType>,
    ) -> bool {
        self.agent
            .confirm_action(self.player, mode, message, options, source, api)
    }

    pub fn confirm_payment(
        &mut self,
        cost_kind: &str,
        message: &str,
        source: Option<CardId>,
        api: Option<crate::ability::api_type::ApiType>,
    ) -> bool {
        self.agent
            .confirm_payment(self.player, cost_kind, message, source, api)
    }

    pub fn pay_cost_to_prevent_effect(
        &mut self,
        cost_kind: &str,
        message: &str,
        source: Option<CardId>,
        api: Option<crate::ability::api_type::ApiType>,
        can_pay: bool,
        targets: &[crate::agent::GameEntity],
        effect_text: &str,
    ) -> bool {
        self.agent.pay_cost_to_prevent_effect(
            self.player,
            cost_kind,
            message,
            source,
            api,
            can_pay,
            targets,
            effect_text,
        )
    }

    pub fn confirm_bid_action(
        &mut self,
        mode: Option<&str>,
        message: &str,
        bid: i32,
        winner: Option<PlayerId>,
    ) -> bool {
        let mut options = vec![format!("Bid {bid}")];
        if let Some(winner) = winner {
            options.push(format!("Winner {}", winner.0));
        }
        self.confirm_action(mode, message, &options, None, None)
    }

    pub fn confirm_replacement_effect(
        &mut self,
        description: &str,
        source: Option<CardId>,
    ) -> bool {
        self.confirm_action(Some("ReplacementEffect"), description, &[], source, None)
    }

    pub fn confirm_static_application(
        &mut self,
        message: &str,
        logic: Option<&str>,
        source: Option<CardId>,
    ) -> bool {
        let options = logic.into_iter().map(str::to_string).collect::<Vec<_>>();
        self.confirm_action(Some("StaticAbility"), message, &options, source, None)
    }

    pub fn choose_optional_trigger(
        &mut self,
        description: &str,
        source: Option<CardId>,
        api: Option<crate::ability::api_type::ApiType>,
    ) -> bool {
        self.agent
            .choose_optional_trigger(self.player, description, source, api)
    }

    pub fn choose_target_spell(
        &mut self,
        valid_entries: &[u32],
        source: Option<CardId>,
    ) -> Option<u32> {
        self.agent
            .choose_target_spell(self.player, valid_entries, source)
    }

    pub fn choose_mode(
        &mut self,
        descriptions: &[String],
        min: usize,
        max: usize,
        source_card_id: Option<CardId>,
    ) -> Vec<usize> {
        self.agent
            .choose_mode(self.player, descriptions, min, max, source_card_id)
    }

    pub fn pay_mana_cost(
        &mut self,
        card_id: CardId,
        card_name: &str,
        mana_cost: &str,
        mana_cost_display: &str,
        mana_cost_checkpoint: &str,
        can_confirm_from_pool: bool,
        allow_reserved_source_reuse: bool,
        reserved_sacrifices: &[CardId],
        mana_ability_options: &[ManaAbilityOption],
        tappable_lands: &[CardId],
        untappable_lands: &[CardId],
        mana_pool: &ManaPool,
    ) -> ManaCostAction {
        self.agent.pay_mana_cost(
            self.player,
            card_id,
            card_name,
            mana_cost,
            mana_cost_display,
            mana_cost_checkpoint,
            can_confirm_from_pool,
            allow_reserved_source_reuse,
            reserved_sacrifices,
            mana_ability_options,
            tappable_lands,
            untappable_lands,
            mana_pool,
        )
    }

    pub fn pay_combat_cost(
        &mut self,
        attacker: CardId,
        cost: i32,
        description: &str,
        mana_ability_options: &[ManaAbilityOption],
        tappable_lands: &[CardId],
        untappable_lands: &[CardId],
        mana_pool_total: i32,
    ) -> CombatCostAction {
        self.agent.pay_combat_cost(
            self.player,
            attacker,
            cost,
            description,
            mana_ability_options,
            tappable_lands,
            untappable_lands,
            mana_pool_total,
        )
    }

    pub fn decide_cost_part(
        &mut self,
        source: CardId,
        cost_part: &CostPart,
    ) -> Option<PaymentDecision> {
        self.agent
            .decide_cost_part(self.player, source, cost_part, self.game)
    }

    pub fn order_cost_parts(&mut self, parts: Vec<CostPart>) -> Vec<CostPart> {
        self.agent.order_cost_parts(parts)
    }

    pub fn choose_color(&mut self, valid_colors: &[String]) -> Option<String> {
        self.agent.choose_color(self.player, valid_colors)
    }

    pub fn choose_card_name(&mut self, valid_names: &[String]) -> Option<String> {
        self.agent.choose_card_name(self.player, valid_names)
    }

    pub fn choose_scry(&mut self, source: Option<CardId>, cards: &[CardId]) -> Vec<Vec<CardId>> {
        self.agent
            .choose_scry(self.game, self.player, source, cards)
    }

    pub fn choose_surveil(&mut self, source: Option<CardId>, cards: &[CardId]) -> Vec<Vec<CardId>> {
        self.agent
            .choose_surveil(self.game, self.player, source, cards)
    }

    pub fn choose_reorder_library(&mut self, cards: &[CardId]) -> Vec<CardId> {
        self.agent
            .choose_reorder_library(self.game, self.player, cards)
    }

    pub fn choose_discard(&mut self, hand: &[CardId], num: usize) -> Vec<CardId> {
        self.agent.choose_discard(self.player, hand, num)
    }

    pub fn choose_random_discard(&mut self, hand: &[CardId], num: usize) -> Vec<CardId> {
        self.agent.choose_random_discard(self.player, hand, num)
    }

    pub fn choose_delve(
        &mut self,
        valid: &[CardId],
        max: usize,
        source: Option<CardId>,
    ) -> Vec<CardId> {
        self.agent.choose_delve(self.player, valid, max, source)
    }

    pub fn choose_improvise(
        &mut self,
        untapped_artifacts: &[CardId],
        remaining_cost: &ManaCost,
        source: Option<CardId>,
    ) -> Vec<CardId> {
        self.agent
            .choose_improvise(self.player, untapped_artifacts, remaining_cost, source)
    }

    pub fn choose_convoke(
        &mut self,
        untapped_creatures: &[CardId],
        remaining_cost: &ManaCost,
        source: Option<CardId>,
    ) -> Vec<CardId> {
        self.agent
            .choose_convoke(self.player, untapped_creatures, remaining_cost, source)
    }

    pub fn specify_mana_combo(
        &mut self,
        available_colors: &[String],
        amount: usize,
        source: Option<CardId>,
        express_choice: Option<u16>,
    ) -> Vec<String> {
        self.agent.specify_mana_combo(
            self.player,
            available_colors,
            amount,
            source,
            express_choice,
        )
    }

    pub fn choose_roll_swap_value(
        &mut self,
        current_result: i32,
        power: i32,
        toughness: i32,
        source: Option<CardId>,
    ) -> Option<RollSwapChoice> {
        self.agent
            .choose_roll_swap_value(self.player, current_result, power, toughness, source)
    }

    pub fn reveal(
        &mut self,
        cards: &[CardId],
        zone: ZoneType,
        owner: PlayerId,
        message_prefix: Option<&str>,
    ) {
        self.reveal_cards(cards, zone, owner, message_prefix);
    }

    pub fn notify_of_value(&mut self, label: &str, value: &str) {
        self.notify(crate::agent::notification::GameNotification::Event(
            GameLogEvent::info(format!("{label}: {value}")).with_player(self.player),
        ));
    }

    pub fn choose_single_replacement_effect(&mut self, descriptions: &[String]) -> usize {
        self.agent
            .choose_single_replacement_effect(self.player, descriptions)
    }

    pub fn choose_land_or_spell(&mut self) -> Option<bool> {
        self.agent.choose_land_or_spell(self.player)
    }

    pub fn choose_sector(&mut self, sectors: &[String]) -> Option<String> {
        self.choose_some_type("Sector", sectors)
    }

    pub fn add_keyword_cost(&mut self, prompt: &str) -> bool {
        self.choose_binary(
            prompt,
            BinaryChoiceKind::AddOrRemove,
            Some(true),
            None,
            None,
        )
    }

    pub fn cheat_shuffle(&mut self) {
        self.notify(crate::agent::notification::GameNotification::Event(
            GameLogEvent::info("Shuffle requested"),
        ));
    }

    pub fn reset_inputs(&mut self) {}

    pub fn can_play_unlimited_lands(&self) -> bool {
        self.game.player(self.player).unlimited_land_plays
    }
}
