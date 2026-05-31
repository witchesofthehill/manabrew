use std::fmt;
use std::hash::{Hash, Hasher};

use dyn_clone::DynClone;
use forge_foundation::{PhaseType, ZoneType};
use serde::{Deserialize, Serialize};

use crate::ability::AbilityKey;
use crate::card::{valid_filter, Card};
use crate::card_trait_base::{CardTrait, CardTraitBase, CardTraitIrOwner, MatchValidTarget};
use crate::core::HasSVars;
use crate::event::{AbilityValue, RunParams};
use crate::game::GameState;
use crate::game_loop::trigger_replacement_base::TriggerReplacementBase;
use crate::ids::{CardId, PlayerId};
use crate::parsing::{keys, CompiledSelector, Params};
use crate::player::PlayerCollection;
use crate::spellability::{build_spell_ability, SpellAbility, TriggerCondition};
use crate::trigger::trigger_ir::TriggerIr;
use crate::trigger::TriggerType;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trigger {
    pub id: u32,
    #[serde(skip, default)]
    pub base: TriggerReplacementBase,
    /// Cheap discriminant for pattern-matching (replaces `matches!(t.mode, TriggerMode::X { .. })`).
    #[serde(default)]
    pub kind: TriggerType,
    pub mode: Box<dyn TriggerBehavior>,
    #[serde(skip, default)]
    pub ir: TriggerIr,
    pub execute: String,
    pub optional: bool,
    pub description: String,
    pub static_trigger: bool,
    #[serde(default)]
    pub trigger_remembered: Vec<AbilityValue>,
    #[serde(default)]
    pub spawning_ability: Option<SpellAbility>,
}

impl PartialEq for Trigger {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}

impl Eq for Trigger {}

impl Hash for Trigger {
    fn hash<H: Hasher>(&self, state: &mut H) {
        "Trigger".hash(state);
        self.id.hash(state);
    }
}

impl fmt::Display for Trigger {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.to_string_with_active(false))
    }
}

#[typetag::serde(tag = "type")]
pub trait TriggerBehavior: fmt::Debug + DynClone + Send + Sync {
    fn trigger_type(&self) -> TriggerType;
    /// Java's `Trigger.performTest()`. The `trigger` parameter provides access
    /// to the parent `Trigger`'s params, base, and host card — equivalent of
    /// Java's `this` in the trigger subclass.
    fn perform_test(&self, trigger: &Trigger, run_params: &RunParams, game: &GameState) -> bool;
    fn set_triggering_objects(
        &self,
        trigger: &Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        game: &GameState,
    );
    fn get_important_stack_objects(&self, trigger: &Trigger, sa: &SpellAbility) -> String;
    fn origin_zone(&self) -> Option<ZoneType> {
        None
    }
    fn destination_zone(&self) -> Option<ZoneType> {
        None
    }
    fn drawn_number(&self) -> Option<i32> {
        None
    }
}

dyn_clone::clone_trait_object!(TriggerBehavior);

impl Trigger {
    pub fn get_id(&self) -> u32 {
        self.id
    }

    pub fn set_id(&mut self, id: u32) {
        self.id = id;
        self.base.card_trait_base.set_id(id as i32);
    }

    /// Returns the host card's ID. Mirrors Java's `getHostCard().getId()`.
    pub fn host_card_id(&self) -> CardId {
        self.base.card_trait_base.host_card_id()
    }

    /// Returns the host card's current controller from live game state.
    /// Use this instead of the stored host card's controller, which may be stale.
    pub fn host_controller(&self, game: &GameState) -> PlayerId {
        game.card(self.host_card_id()).controller
    }

    pub fn get_mode(&self) -> &dyn TriggerBehavior {
        &*self.mode
    }

    pub fn origin_zone(&self) -> Option<ZoneType> {
        self.ir.origin_zone
    }

    pub fn destination_zone(&self) -> Option<ZoneType> {
        self.ir.destination_zone
    }

    pub fn set_mode(&mut self, mode: Box<dyn TriggerBehavior>) {
        self.kind = mode.trigger_type();
        self.mode = mode;
    }

    pub fn get_trigger_remembered(&self) -> &[AbilityValue] {
        &self.trigger_remembered
    }

    pub fn bind_host_card_id(&mut self, host_card: CardId) {
        self.base.set_host_card_id(host_card);
    }

    pub fn get_active_zone(&self) -> &[ZoneType] {
        self.base.get_active_zone().unwrap_or(&[])
    }

    pub fn set_active_zone(&mut self, zones: Vec<ZoneType>) {
        self.base.set_active_zone(zones);
    }

    pub fn is_intrinsic(&self) -> bool {
        self.base.card_trait_base.is_intrinsic()
    }

    pub fn set_intrinsic(&mut self, intrinsic: bool) {
        self.base.card_trait_base.set_intrinsic(intrinsic);
    }

    pub fn get_overriding_ability(&self) -> Option<&SpellAbility> {
        self.base.get_overriding_ability()
    }

    pub fn set_overriding_ability(&mut self, mut overriding_ability: SpellAbility) {
        overriding_ability.is_trigger = true;
        overriding_ability.source_trigger_id = Some(self.id);
        self.base.set_overriding_ability(overriding_ability);
    }

    pub fn get_spawning_ability(&self) -> Option<&SpellAbility> {
        self.spawning_ability.as_ref()
    }

    pub fn set_spawning_ability(&mut self, ability: SpellAbility) {
        self.spawning_ability = Some(ability);
    }
}

/// Mirrors Java's `Trigger extends CardTraitBase` override of `matchesValid`:
/// when `this instanceof Trigger` and a spawning ability is present, the
/// source player resolves to the spawning ability's activating player rather
/// than the source card's controller.
impl CardTrait for Trigger {
    fn base(&self) -> &CardTraitBase {
        &self.base.card_trait_base
    }

    fn resolve_source_player(&self, src_card: &Card) -> PlayerId {
        self.spawning_ability
            .as_ref()
            .map(|sa| sa.activating_player)
            .unwrap_or(src_card.controller)
    }

    fn matches_compiled_valid(
        &self,
        target: &MatchValidTarget<'_>,
        selector: &CompiledSelector,
        src_card: Option<&Card>,
    ) -> bool {
        let Some(src) = src_card else {
            return false;
        };
        let player = self.resolve_source_player(src);
        match target {
            MatchValidTarget::Card(card) => {
                let trigger_remembered_cards = self
                    .trigger_remembered
                    .iter()
                    .filter_map(|value| match value {
                        AbilityValue::Card(card_id) => Some(*card_id),
                        _ => None,
                    })
                    .collect::<Vec<_>>();
                valid_filter::matches_valid_card_selector_with_context(
                    selector,
                    card,
                    valid_filter::MatchContext::from_source(src)
                        .with_source_controller(player)
                        .with_trigger_remembered_cards(&trigger_remembered_cards),
                )
            }
            _ => self
                .base()
                .matches_compiled_valid_with_player(target, selector, src, player),
        }
    }
}

impl CardTraitIrOwner for Trigger {
    type Ir = TriggerIr;

    fn ir(&self) -> &Self::Ir {
        &self.ir
    }

    fn card_trait_requirements(&self) -> &valid_filter::CardTraitRequirementsIr {
        &self.ir.card_trait_requirements
    }
}

impl Trigger {
    pub fn set_trigger_phases(&mut self, phases: Vec<PhaseType>) {
        self.ir.valid_phases = Some(phases);
    }

    /// Java parity shim for Trigger.resetIDs().
    pub fn reset_i_ds(next_id: &mut u32) {
        *next_id = 50_000;
    }

    pub fn to_string_with_active(&self, active: bool) -> String {
        if self.ir.trigger_description.is_none() || self.base.card_trait_base.is_suppressed() {
            return String::new();
        }

        let mut desc = self.ir.trigger_description.clone().unwrap_or_default();

        if !desc.contains("ABILITY") {
            let host_name = self.base.card_trait_base.host_card_id().0.to_string();
            desc = desc.replace("CARDNAME", &host_name);
            desc = desc.replace("NICKNAME", &host_name);
            if desc.contains("ORIGINALHOST") {
                let original_host = self
                    .get_overriding_ability()
                    .and_then(|sa| sa.original_host)
                    .map(|id| id.0.to_string())
                    .unwrap_or_default();
                desc = desc.replace("ORIGINALHOST", &original_host);
            }
        }

        if desc.contains("EFFECTSOURCE") {
            let replacement = if active {
                self.base.card_trait_base.host_card_id().0.to_string()
            } else {
                self.base.card_trait_base.host_card_id().0.to_string()
            };
            desc = desc.replace("EFFECTSOURCE", &replacement);
        }

        if !self.trigger_remembered.is_empty() {
            desc.push_str(&format!(" ({:?})", self.trigger_remembered));
        }

        desc
    }

    /// Minimal `ABILITY` replacement parity used by stack text paths.
    pub fn replace_ability_text(
        &self,
        desc: &str,
        game: &GameState,
        host_card: CardId,
        activating_player: PlayerId,
    ) -> String {
        self.replace_ability_text_for_stack(desc, None, false, game, host_card, activating_player)
    }

    pub fn replace_ability_text_with_ability(
        &self,
        desc: &str,
        sa: Option<SpellAbility>,
        game: &GameState,
        host_card: CardId,
        activating_player: PlayerId,
    ) -> String {
        self.replace_ability_text_for_stack(desc, sa, false, game, host_card, activating_player)
    }

    pub fn replace_ability_text_for_stack(
        &self,
        desc: &str,
        mut sa: Option<SpellAbility>,
        _for_stack: bool,
        game: &GameState,
        host_card: CardId,
        activating_player: PlayerId,
    ) -> String {
        if !desc.contains("ABILITY") {
            return desc.to_string();
        }

        if sa.is_none() {
            sa = self
                .ensure_ability(game, host_card, activating_player)
                .or_else(|| self.get_overriding_ability().cloned());
        }

        let Some(mut sa) = sa else {
            return desc.to_string();
        };

        let mut sa_desc = String::new();
        let mut dig_more = true;

        if sa.is_wrapper() {
            let wrapped = sa.get_wrapped_ability().clone();
            sa = wrapped;

            if sa.api == Some(crate::ability::api_type::ApiType::Charm) {
                sa_desc = sa.stack_description.clone();
                dig_more = false;
            }
        }

        if dig_more {
            let mut trig_sa = Some(sa.clone());
            while let Some(current) = trig_sa {
                match current.api {
                    Some(crate::ability::api_type::ApiType::Charm) => {
                        let source_id = current.source.unwrap_or(host_card);
                        let choices = current.ir.choices.as_deref().unwrap_or("");
                        sa_desc = crate::ability::effects::charm_effect::make_formated_description(
                            game, source_id, choices,
                        );
                        break;
                    }
                    Some(crate::ability::api_type::ApiType::ImmediateTrigger)
                    | Some(crate::ability::api_type::ApiType::DelayedTrigger) => {
                        trig_sa = current.get_additional_ability("Execute").cloned();
                    }
                    _ => {
                        trig_sa = current.get_sub_ability().cloned();
                    }
                }
            }
        }

        if sa_desc.is_empty() {
            sa_desc = sa.to_string();
        }

        sa_desc = sa_desc.trim().to_string();
        if !sa_desc.is_empty() {
            let host_name = game.card(host_card).card_name.clone();
            if !sa_desc.starts_with(&host_name) {
                let mut chars = sa_desc.chars();
                if let Some(first) = chars.next() {
                    sa_desc = first.to_lowercase().collect::<String>() + chars.as_str();
                }
            }
            if sa_desc.contains("ORIGINALHOST") {
                let original_host = sa
                    .original_host
                    .map(|id| game.card(id).card_name.clone())
                    .unwrap_or_default();
                sa_desc = sa_desc.replace("ORIGINALHOST", &original_host);
            }
        } else {
            sa_desc = "<take no action>".to_string();
        }

        let mut result = desc.replace("ABILITY", &sa_desc);
        let translated_name = game.card(host_card).card_name.clone();
        result = result.replace("CARDNAME", &translated_name);
        result = result.replace("NICKNAME", &translated_name);
        result
    }

    /// Mirrors Java Trigger.phasesCheck() for common phase/turn params.
    pub fn phases_check(
        &self,
        game: &GameState,
        host_card: CardId,
        event_phase: Option<PhaseType>,
    ) -> bool {
        let phase = event_phase.unwrap_or(game.turn.phase);
        let host_controller = game.card(host_card).controller;

        if let Some(valid_phases) = self.ir.valid_phases.as_ref() {
            if !valid_phases.contains(&phase) {
                return false;
            }
            if let Some(expected) = self.ir.phase_count {
                let current = if phase == PhaseType::Main2 { 2 } else { 1 };
                if current != expected {
                    return false;
                }
            }
        }

        if self.ir.player_turn && game.turn.active_player != host_controller {
            return false;
        }
        if self.ir.not_player_turn && game.turn.active_player == host_controller {
            return false;
        }
        if self.ir.opponent_turn {
            let active = game.turn.active_player;
            let is_opponent_turn = active != host_controller;
            if !is_opponent_turn {
                return false;
            }
        }
        if self.ir.first_upkeep && !(phase == PhaseType::Upkeep && game.turn.turn_number >= 1) {
            return false;
        }
        if self.ir.first_upkeep_this_game
            && !(phase == PhaseType::Upkeep && game.turn.turn_number == 1)
        {
            return false;
        }
        if self.ir.first_combat && phase != PhaseType::CombatBegin {
            return false;
        }
        if let Some(expected) = self.ir.turn_count {
            if game.turn.turn_number != expected {
                return false;
            }
        }
        true
    }

    /// Mirrors Java Trigger.requirementsCheck() subset used in current engine.
    pub fn requirements_check(&self, game: &GameState, host_card: CardId) -> bool {
        if self.ir.a_player_has_more_life_than_each_other {
            let mut highest = i32::MIN;
            let mut count = 0;
            for p in &game.players {
                if p.life > highest {
                    highest = p.life;
                    count = 1;
                } else if p.life == highest {
                    count += 1;
                }
            }
            if count != 1 {
                return false;
            }
        }
        if self.ir.a_player_has_most_cards_in_hand {
            let mut largest = i32::MIN;
            let mut count = 0;
            for p in &game.players {
                let hand_count = game.cards_in_zone(ZoneType::Hand, p.id).len() as i32;
                if hand_count > largest {
                    largest = hand_count;
                    count = 1;
                } else if hand_count == largest {
                    count += 1;
                }
            }
            if count != 1 {
                return false;
            }
        }
        let host = game.card(host_card);
        if !self.meets_card_trait_requirements(game, host, &self.base.card_trait_base) {
            return false;
        }
        self.check_resolved_limit(game, host_card)
    }

    /// Mirrors Java Trigger.checkResolvedLimit() (approximation with per-card counter).
    pub fn check_resolved_limit(&self, game: &GameState, host_card: CardId) -> bool {
        if let Some(limit) = self.ir.resolved_limit {
            if self.get_overriding_ability().is_none() {
                let Some(ability_text) = game.card(host_card).get_s_var(&self.execute) else {
                    return true;
                };
                let ability = build_spell_ability(
                    game,
                    host_card,
                    ability_text,
                    game.card(host_card).controller,
                );
                return (game
                    .card(host_card)
                    .get_ability_resolved_this_turn_activators(Some(&ability))
                    .len() as u32)
                    < limit;
            }
            return (game
                .card(host_card)
                .get_ability_resolved_this_turn_activators(self.get_overriding_ability())
                .len() as u32)
                < limit;
        }
        true
    }

    /// Mirrors Java Trigger.checkActivationLimit().
    pub fn check_activation_limit(&self, game: &GameState, host_card: CardId) -> bool {
        if let Some(limit) = self.ir.activation_limit {
            if self.get_activations_this_turn(game, host_card) >= limit {
                return false;
            }
        }
        if let Some(limit) = self.ir.game_activation_limit {
            let used = self.get_activations_this_game(game, host_card);
            if used >= limit {
                return false;
            }
        }
        true
    }

    pub fn get_activations_this_turn(&self, game: &GameState, host_card: CardId) -> u32 {
        if self.get_overriding_ability().is_some() {
            return game
                .card(host_card)
                .get_ability_activated_this_turn(self.get_overriding_ability());
        }
        0
    }

    /// Polymorphic `Valid...` check for optional card payloads.
    /// Mirrors Java's `matchesValidParam` flow by routing through `CardTrait`.
    pub fn matches_optional_valid_card_filter(
        &self,
        filter: &Option<CompiledSelector>,
        card_id: Option<CardId>,
        game: &GameState,
    ) -> bool {
        match (filter.as_ref(), card_id) {
            (None, _) => true,
            (Some(_), None) => false,
            (Some(selector), Some(card_id)) => {
                let src = self.base.card_trait_base.host_card(game);
                let player = self.resolve_source_player(src);
                let trigger_remembered_cards = self
                    .trigger_remembered
                    .iter()
                    .filter_map(|value| match value {
                        AbilityValue::Card(card_id) => Some(*card_id),
                        _ => None,
                    })
                    .collect::<Vec<_>>();
                valid_filter::matches_valid_card_selector_with_context(
                    selector,
                    game.card(card_id),
                    valid_filter::MatchContext::from_source(src)
                        .with_game(game)
                        .with_source_controller(player)
                        .with_trigger_remembered_cards(&trigger_remembered_cards),
                )
            }
        }
    }

    /// Polymorphic `Valid...` check for optional player payloads.
    /// Mirrors Java's `matchesValidParam` flow by routing through `CardTrait`.
    pub fn matches_optional_valid_player_filter(
        &self,
        filter: &Option<CompiledSelector>,
        player_id: Option<PlayerId>,
        game: &GameState,
    ) -> bool {
        match (filter.as_ref(), player_id) {
            (None, _) => true,
            (Some(_), None) => false,
            (Some(selector), Some(player_id)) => self.matches_compiled_valid(
                &MatchValidTarget::Player(player_id),
                selector,
                Some(self.base.card_trait_base.host_card(game)),
            ),
        }
    }

    /// Matches a required card against a `Valid...` card filter from this trigger's host context.
    pub fn matches_valid_card_filter(
        &self,
        filter: &CompiledSelector,
        card_id: CardId,
        game: &GameState,
    ) -> bool {
        self.matches_compiled_valid(
            &MatchValidTarget::Card(game.card(card_id)),
            filter,
            Some(self.base.card_trait_base.host_card(game)),
        )
    }

    /// Matches a required player against a `Valid...` player filter from this trigger's host context.
    pub fn matches_valid_player_filter(
        &self,
        filter: &CompiledSelector,
        player: PlayerId,
        game: &GameState,
    ) -> bool {
        self.matches_compiled_valid(
            &MatchValidTarget::Player(player),
            filter,
            Some(self.base.card_trait_base.host_card(game)),
        )
    }

    /// Matches a required player against a `Valid...` player filter from an explicit source controller.
    pub fn matches_valid_player_filter_with_controller(
        &self,
        filter: &CompiledSelector,
        player: PlayerId,
        source_controller: PlayerId,
    ) -> bool {
        valid_filter::matches_valid_player_selector(filter, player, source_controller)
    }

    /// Matches an optional counter-type filter.
    pub fn matches_counter_type_filter(expected: &Option<String>, actual: &Option<String>) -> bool {
        if let Some(expected) = expected {
            if let Some(actual) = actual {
                actual.eq_ignore_ascii_case(expected)
            } else {
                false
            }
        } else {
            true
        }
    }

    /// Matches zone filters (origin and/or destination).
    pub fn matches_zone_filter(expected: &Option<ZoneType>, actual: Option<ZoneType>) -> bool {
        if let Some(expected) = expected {
            actual == Some(*expected)
        } else {
            true
        }
    }

    /// Matches spell-ability filter tokens.
    pub fn matches_valid_sa_filter(
        &self,
        filter: &str,
        sa: &crate::spellability::SpellAbility,
    ) -> bool {
        let f = filter.trim();
        if f.is_empty() {
            return true;
        }
        if f.eq_ignore_ascii_case("Spell") {
            return sa.is_spell;
        }
        if f.eq_ignore_ascii_case("Ability") {
            return !sa.is_spell;
        }
        true
    }

    /// Matches a damage target filter for either player or card targets.
    pub fn matches_damage_target_filter(
        &self,
        filter: &Option<CompiledSelector>,
        run_params: &RunParams,
        game: &GameState,
        strict_card_filter: bool,
    ) -> bool {
        let filter = match filter {
            Some(f) => f,
            None => return true,
        };
        if let Some(target_card) = run_params.damage_target_card {
            self.matches_valid_card_filter(filter, target_card, game)
        } else if strict_card_filter {
            let raw = filter.as_raw();
            let is_card_filter = raw.starts_with("Card.")
                || raw.starts_with("Creature.")
                || raw.starts_with("Permanent.")
                || raw.starts_with("Artifact.")
                || raw.starts_with("Enchantment.")
                || raw.starts_with("Planeswalker.");
            if is_card_filter {
                false
            } else if let Some(target_player) = run_params.damage_target_player {
                self.matches_valid_player_filter(filter, target_player, game)
            } else {
                false
            }
        } else if let Some(target_player) = run_params.damage_target_player {
            self.matches_valid_player_filter(filter, target_player, game)
        } else {
            false
        }
    }

    pub fn get_activations_this_game(&self, game: &GameState, host_card: CardId) -> u32 {
        if self.get_overriding_ability().is_some() {
            return game
                .card(host_card)
                .get_ability_activated_this_game(self.get_overriding_ability());
        }
        0
    }

    /// Mirrors Java Trigger.meetsRequirementsOnTriggeredObjects() subset.
    pub fn meets_requirements_on_triggered_objects(
        &self,
        game: &GameState,
        run_params: &RunParams,
        host_card: CardId,
    ) -> bool {
        let condition = self.ir.condition.as_ref();

        if self
            .base
            .card_trait_base
            .is_keyword(crate::keyword::keyword_instance::Keyword::Evolve)
            || matches!(condition, Some(TriggerCondition::Evolve))
        {
            let Some(moved) = run_params.card else {
                return false;
            };
            let moved_card = game.card(moved);
            let host = game.card(host_card);
            if !moved_card.is_creature() || !host.is_creature() {
                return false;
            }
            if moved_card.power() <= host.power() && moved_card.toughness() <= host.toughness() {
                return false;
            }
        }

        let Some(condition) = condition else {
            return true;
        };

        match condition {
            TriggerCondition::LifePaid => {
                if let Some(sa) = run_params.spell_ability.as_ref() {
                    sa.get_amount_life_paid() > 0
                } else {
                    true
                }
            }
            TriggerCondition::NoOpponentHasMoreLifeThanAttacked => {
                let attacked = run_params
                    .get_player(AbilityKey::Attacked)
                    .or_else(|| run_params.get_player(AbilityKey::Defender));
                let Some(attacked_player) = attacked else {
                    return false;
                };
                let life = game.player(attacked_player).life;
                !PlayerCollection::opponents_of(game, game.card(host_card).controller)
                    .into_iter()
                    .filter(|opp| *opp != attacked_player)
                    .any(|opp| game.player(opp).life > life)
            }
            TriggerCondition::Sacrificed => run_params
                .spell_ability
                .as_ref()
                .map(|sa| {
                    !sa.paid_hash
                        .get("Sacrificed")
                        .cloned()
                        .unwrap_or_default()
                        .is_empty()
                })
                .unwrap_or(true),
            TriggerCondition::AttackedPlayerWithMostLife => {
                let attacked = run_params
                    .get_player(AbilityKey::Attacked)
                    .or_else(|| run_params.get_player(AbilityKey::Defender));
                let Some(attacked_player) = attacked else {
                    return false;
                };
                let attacked_life = game.player(attacked_player).life;
                game.alive_players()
                    .into_iter()
                    .all(|pid| game.player(pid).life <= attacked_life)
            }
            TriggerCondition::AttackerHasUnattackedOpp => {
                let Some(attacking_player) = run_params.attacking_player else {
                    return false;
                };
                let attacked_this_combat =
                    &game.player(attacking_player).attacked_players_this_combat;
                !PlayerCollection::opponents_of(game, attacking_player)
                    .into_iter()
                    .all(|opp| attacked_this_combat.contains(&opp))
            }
            TriggerCondition::Evolve | TriggerCondition::Unsupported(_) => true,
        }
    }

    pub fn add_remembered<T: Into<AbilityValue>>(&mut self, item: T) {
        self.trigger_remembered.push(item.into());
    }

    pub fn is_static(&self) -> bool {
        self.static_trigger
    }

    /// Mirrors Java's `Trigger.isManaAbility()`.
    /// A trigger is a mana ability only if its mode is TapsForMana or ManaAdded
    /// AND the resulting SpellAbility itself is a mana ability (has a mana part).
    pub fn is_mana_ability(
        &self,
        game: &GameState,
        host_card: CardId,
        activating_player: PlayerId,
    ) -> bool {
        if !matches!(self.kind, TriggerType::TapsForMana | TriggerType::ManaAdded) {
            return false;
        }
        self.ensure_ability(game, host_card, activating_player)
            .is_some_and(|sa| sa.is_mana_ability)
    }

    pub fn add_remembered_many<T: Into<AbilityValue>, I: IntoIterator<Item = T>>(
        &mut self,
        items: I,
    ) {
        for item in items {
            self.add_remembered(item);
        }
    }

    pub fn copy(&self, next_id: &mut u32, keep_id: bool) -> Self {
        let mut out = self.clone();
        if !keep_id {
            out.id = *next_id;
            *next_id = next_id.saturating_add(1);
        }
        out.base.card_trait_base.set_id(out.id as i32);
        out
    }

    pub fn copy_to_host(
        &self,
        new_host: crate::card::Card,
        lki: bool,
        keep_text_changes: bool,
        spell_ability: Option<SpellAbility>,
        next_id: &mut u32,
    ) -> Self {
        let mut copy = self.clone();
        self.base.card_trait_base.copy_helper_with_text(
            &mut copy.base.card_trait_base,
            new_host.clone(),
            lki || keep_text_changes,
        );

        if let Some(spell_ability) = spell_ability {
            copy.set_overriding_ability(spell_ability);
        } else if let Some(overriding_ability) = self.get_overriding_ability() {
            copy.set_overriding_ability(
                overriding_ability.copy_with_host_lki(new_host.clone(), lki),
            );
        }

        if !lki {
            copy.set_id(*next_id);
            *next_id = next_id.saturating_add(1);
        }

        if let Some(valid_phases) = self.ir.valid_phases.clone() {
            copy.set_trigger_phases(valid_phases);
        }
        copy.base.valid_host_zones = self.base.valid_host_zones.clone();
        copy
    }

    /// Tracks trigger activation on the host card.
    pub fn trigger_run(&self, game: &mut GameState, host_card: CardId) {
        if self.get_overriding_ability().is_some() {
            game.card_mut(host_card)
                .add_ability_activated_for(self.get_overriding_ability());
        }
    }

    /// Ensures trigger execute ability can be built from host SVar.
    pub fn ensure_ability(
        &self,
        game: &GameState,
        host_card: CardId,
        activating_player: PlayerId,
    ) -> Option<SpellAbility> {
        if let Some(overriding_ability) = self.get_overriding_ability() {
            return Some(overriding_ability.clone());
        }
        let holder: &dyn HasSVars = if self.is_intrinsic() {
            &self.base.card_trait_base
        } else {
            game.card(host_card)
        };
        if self.execute.is_empty() {
            return None;
        }
        let ability_text = holder
            .get_svar(&self.execute)
            .or_else(|| game.card(host_card).get_svar(&self.execute))?;
        Some(build_spell_ability(
            game,
            host_card,
            ability_text,
            activating_player,
        ))
    }

    pub fn ensure_ability_mut(
        &mut self,
        game: &GameState,
        host_card: CardId,
        activating_player: PlayerId,
    ) -> Option<&mut SpellAbility> {
        if self.get_overriding_ability().is_none() {
            let ability = self.ensure_ability(game, host_card, activating_player)?;
            self.set_overriding_ability(ability);
        }
        self.base.overriding_ability.as_mut()
    }

    pub fn is_chapter(&self) -> bool {
        self.ir.chapter.is_some()
    }

    pub fn get_chapter(&self) -> Option<i32> {
        self.ir.chapter
    }

    pub fn is_last_chapter(&self) -> bool {
        false
    }

    pub fn while_keyword_check(&self, _param: &str, _run_params: &RunParams) -> bool {
        // TODO: JacoRefactor
        false
    }

    pub fn set_triggering_objects(
        &self,
        sa: &mut SpellAbility,
        params: &RunParams,
        game: &GameState,
        _host_card: CardId,
        _host_controller: PlayerId,
    ) {
        params.add_common_trigger_objects(sa);
        self.mode.set_triggering_objects(self, sa, params, game);
    }

    pub fn build_triggered_spell_ability(
        &self,
        game: &GameState,
        host_card: CardId,
        host_controller: PlayerId,
        trigger_index: usize,
        params: &RunParams,
    ) -> SpellAbility {
        let host = game.card(host_card);
        let (mut sa, svar_text) = if let Some(overriding_ability) = self.get_overriding_ability() {
            (overriding_ability.clone(), String::new())
        } else {
            let svar_text = host.get_s_var(&self.execute).map(str::to_string).unwrap_or_else(|| {
                panic!(
                    "Trigger::build_triggered_spell_ability missing/empty Execute SVar: host={} execute={} trigger_index={} description={}",
                    host.card_name,
                    self.execute,
                    trigger_index,
                    self.description
                )
            });
            (
                build_spell_ability(game, host_card, &svar_text, host_controller),
                svar_text,
            )
        };
        sa.is_trigger = true;
        sa.trigger_source = Some(host_card);
        sa.trigger_source_zone_timestamp = Some(game.card(host_card).zone_timestamp);
        sa.source_trigger_id = Some(self.id);
        sa.trigger_index = Some(trigger_index);
        sa.trigger_remembered = self.trigger_remembered.clone();
        self.set_triggering_objects(&mut sa, params, game, host_card, host_controller);
        self.configure_triggered_spell_ability(&mut sa, params, game, &svar_text);
        sa
    }

    fn configure_triggered_spell_ability(
        &self,
        sa: &mut SpellAbility,
        params: &RunParams,
        game: &GameState,
        svar_text: &str,
    ) {
        if let Some(pid) = params.damage_target_player {
            sa.target_chosen.target_player = Some(pid);
        }
        if sa.target_chosen.target_player.is_none() && svar_text.contains("TriggeredPlayer") {
            if let Some(pid) = params.player {
                sa.target_chosen.target_player = Some(pid);
            }
        }
        if let Some(pid) = params.defending_player {
            if sa.target_chosen.target_player.is_none() && svar_text.contains("DefendingPlayer") {
                sa.target_chosen.target_player = Some(pid);
            }
        }
        if let Some(cid) = params.damage_target_card {
            sa.target_chosen.target_card = Some(cid);
        }
        if let Some(cause_cid) = params.cause_card {
            if let Some(entry) = game.stack.find_by_source_card(cause_cid) {
                sa.target_chosen.target_stack_entry = Some(entry.id);
            }
        }
        if let Some(attacker_id) = params.attacker {
            if svar_text.contains("TriggeredAttacker") {
                sa.target_chosen.target_card = Some(attacker_id);
            }
        }
        if let Some(blocker_id) = params.blocker {
            if svar_text.contains("TriggeredBlocker") {
                sa.target_chosen.target_card = Some(blocker_id);
            }
        }
        if let Some(lki_p1p1) = params.lki_p1p1_counters {
            if self.execute.contains("Modular") || svar_text.contains("Modular") {
                sa.trigger_remembered_amount = lki_p1p1;
            }
        }
    }
}

/// Mirrors Java's TriggerHandler.parseTrigger().
/// Parses raw "Mode$ ChangesZone | Origin$ Any | ..." into Trigger struct.
pub fn parse_trigger(raw: &str, next_id: &mut u32) -> Option<Trigger> {
    let _perf_scope =
        crate::perf::ParamsLookupScopeGuard::enter(crate::perf::ParamsLookupScope::Trigger);
    let params = Params::from_raw(raw);

    let mode_str = params.get(keys::MODE)?;
    let mode: Box<dyn TriggerBehavior> = match mode_str {
        "ChangesZone" => crate::trigger::trigger_changes_zone::TriggerChangesZone::parse(&params),
        "Phase" => crate::trigger::trigger_phase::TriggerPhase::parse(&params),
        "SpellCast" | "AbilityCast" | "SpellAbilityCast" => {
            crate::trigger::trigger_spell_ability_cast_or_copy::TriggerSpellAbilityCastOrCopy::parse(mode_str, &params)
        }
        "Attacks" => crate::trigger::trigger_attacks::TriggerAttacks::parse(&params),
        "Fight" => crate::trigger::trigger_fight::TriggerFight::parse(&params),
        "FightOnce" => crate::trigger::trigger_fight_once::TriggerFightOnce::parse(&params),
        "DamageDone" => crate::trigger::trigger_damage_done::TriggerDamageDone::parse(&params),
        "Countered" => {
            let valid_card = params.selector_cloned(keys::VALID_CARD);
            let valid_cause = params.selector_cloned(keys::VALID_CAUSE);
            let valid_sa = params.get_cloned(keys::VALID_SA);
            crate::trigger::trigger_countered::TriggerCountered::parse(valid_card, valid_cause, valid_sa)
        }
        "Blocks" => crate::trigger::trigger_blocks::TriggerBlocks::parse(&params),
        "AttackerBlocked" => crate::trigger::trigger_attacker_blocked::TriggerAttackerBlocked::parse(&params),
        "AttackerUnblocked" => crate::trigger::trigger_attacker_unblocked::TriggerAttackerUnblocked::parse(&params),
        "LifeGained" => crate::trigger::trigger_life_gained::TriggerLifeGained::parse(&params),
        "LifeLost" => crate::trigger::trigger_life_lost::TriggerLifeLost::parse(&params),
        "CounterAdded" => crate::trigger::trigger_counter_added::TriggerCounterAdded::parse(&params),
        "CounterRemoved" => crate::trigger::trigger_counter_removed::TriggerCounterRemoved::parse(&params),
        "Sacrificed" => crate::trigger::trigger_sacrificed::TriggerSacrificed::parse(&params),
        "Drawn" => crate::trigger::trigger_drawn::TriggerDrawn::parse(&params),
        "Milled" => crate::trigger::trigger_milled::TriggerMilled::parse(&params),
        "Taps" => crate::trigger::trigger_taps::TriggerTaps::parse(&params),
        "Untaps" => crate::trigger::trigger_untaps::TriggerUntaps::parse(&params),
        "Transformed" => crate::trigger::trigger_transformed::TriggerTransformed::parse(&params),
        "TurnFaceUp" => crate::trigger::trigger_turn_face_up::TriggerTurnFaceUp::parse(&params),
        "Attached" => crate::trigger::trigger_attached::TriggerAttached::parse(&params),
        "Unattached" => crate::trigger::trigger_unattach::TriggerUnattach::parse(&params),
        "LandPlayed" => crate::trigger::trigger_land_played::TriggerLandPlayed::parse(&params),
        "BecomesTarget" => crate::trigger::trigger_becomes_target::TriggerBecomesTarget::parse(&params),
        "TapsForMana" => crate::trigger::trigger_taps_for_mana::TriggerTapsForMana::parse(&params),
        "AbilityActivated" => crate::trigger::trigger_ability_activated::TriggerAbilityActivated::parse(&params),
        "Explored" | "Explores" => crate::trigger::trigger_explores::TriggerExplores::parse(&params),
        "BecomeMonstrous" => crate::trigger::trigger_become_monstrous::TriggerBecomeMonstrous::parse(&params),
        "BecomeMonarch" => crate::trigger::trigger_become_monarch::TriggerBecomeMonarch::parse(&params),
        "DamageDealtOnce" => crate::trigger::trigger_damage_dealt_once::TriggerDamageDealtOnce::parse(&params),
        "Destroyed" => crate::trigger::trigger_destroyed::TriggerDestroyed::parse(&params),
        "Exiled" => crate::trigger::trigger_exiled::TriggerExiled::parse(&params),
        "CollectEvidence" => {
            let valid_player = params.selector_cloned(keys::VALID_PLAYER);
            crate::trigger::trigger_collect_evidence::TriggerCollectEvidence::parse(valid_player)
        }
        "Forage" => crate::trigger::trigger_forage::TriggerForage::parse(&params),
        "Enlisted" => crate::trigger::trigger_enlisted::TriggerEnlisted::parse(&params),
        "FlippedCoin" => crate::trigger::trigger_flipped_coin::TriggerFlippedCoin::parse(&params),
        "RolledDie" => crate::trigger::trigger_rolled_die::TriggerRolledDie::parse(&params),
        "RolledDieOnce" => crate::trigger::trigger_rolled_die_once::TriggerRolledDieOnce::parse(&params),
        "TokenCreated" => crate::trigger::trigger_token_created::TriggerTokenCreated::parse(&params),
        "SpellCastOrCopy" | "SpellCopied" | "SpellAbilityCopy" | "SpellCopy" => {
            crate::trigger::trigger_spell_ability_cast_or_copy::TriggerSpellAbilityCastOrCopy::parse(mode_str, &params)
        }
        "AttackersDeclared" | "AttackersDeclaredOneTarget" => {
            crate::trigger::trigger_attackers_declared::TriggerAttackersDeclared::parse(mode_str, &params)
        }
        "BlockersDeclared" => crate::trigger::trigger_blockers_declared::TriggerBlockersDeclared::parse(&params),
        "ChangesZoneAll" => crate::trigger::trigger_changes_zone_all::TriggerChangesZoneAll::parse(&params),
        "ChangesController" => {
            let valid_card = params.selector_cloned(keys::VALID_CARD);
            crate::trigger::trigger_changes_controller::TriggerChangesController::parse(valid_card)
        }
        "TurnBegin" | "NewTurn" => crate::trigger::trigger_turn_begin::TriggerTurnBegin::parse(&params),
        "DamageDoneOnce" => crate::trigger::trigger_damage_done_once::TriggerDamageDoneOnce::parse(&params),
        "DamageDoneOnceByController" => crate::trigger::trigger_damage_done_once_by_controller::TriggerDamageDoneOnceByController::parse(&params),
        "SpellCastAll" => {
            crate::trigger::trigger_spell_ability_cast_or_copy::TriggerSpellAbilityCastOrCopy::parse(mode_str, &params)
        }
        "LifeLostAll" => crate::trigger::trigger_life_lost_all::TriggerLifeLostAll::parse(&params),
        "CounterAddedOnce" => {
            let valid_card = params.selector_cloned(keys::VALID_CARD);
            let counter_type = params.get_cloned(keys::COUNTER_TYPE);
            let valid_source = params.selector_cloned(keys::VALID_SOURCE);
            crate::trigger::trigger_counter_added_once::TriggerCounterAddedOnce::parse(valid_card, counter_type, valid_source)
        }
        "CounterAddedAll" => {
            let counter_type = params.get_cloned(keys::COUNTER_TYPE);
            let valid = params.selector_cloned_any(&[keys::VALID, keys::VALID_CARD]);
            crate::trigger::trigger_counter_added_all::TriggerCounterAddedAll::parse(counter_type, valid)
        }
        "CounterPlayerAddedAll" => {
            let valid_source = params.selector_cloned("ValidSource");
            let valid_object = params.selector_cloned("ValidObject");
            let valid_object_to_source = params.selector_cloned("ValidObjectToSource");
            crate::trigger::trigger_counter_player_added_all::TriggerCounterPlayerAddedAll::parse(valid_source, valid_object, valid_object_to_source)
        }
        "CounterTypeAddedAll" => {
            let valid_object = params.selector_cloned("ValidObject");
            let first_time_only = params.has("FirstTime");
            crate::trigger::trigger_counter_type_added_all::TriggerCounterTypeAddedAll::parse(valid_object, first_time_only)
        }
        "DiscardedAll" => crate::trigger::trigger_discarded_all::TriggerDiscardedAll::parse(&params),
        "Discarded" => crate::trigger::trigger_discarded::TriggerDiscarded::parse(&params),
        "SacrificedOnce" => crate::trigger::trigger_sacrificed_once::TriggerSacrificedOnce::parse(&params),
        "Cycled" | "Cycling" => crate::trigger::trigger_cycled::TriggerCycled::parse(&params),
        "PhasedIn" | "PhaseIn" => crate::trigger::trigger_phase_in::TriggerPhaseIn::parse(&params),
        "PhasedOut" | "PhaseOut" => crate::trigger::trigger_phase_out::TriggerPhaseOut::parse(&params),
        "Always" => crate::trigger::trigger_always::TriggerAlways::parse(&params),
        "Immediate" => crate::trigger::trigger_immediate::TriggerImmediate::parse(&params),
        "Surveil" => crate::trigger::trigger_surveil::TriggerSurveil::parse(&params),
        "Scry" => crate::trigger::trigger_scry::TriggerScry::parse(&params),
        "Foretell" | "Foretold" => crate::trigger::trigger_foretell::TriggerForetell::parse(&params),
        "SearchedLibrary" => crate::trigger::trigger_searched_library::TriggerSearchedLibrary::parse(&params),
        "Shuffled" => crate::trigger::trigger_shuffled::TriggerShuffled::parse(&params),
        "ManaAdded" => crate::trigger::trigger_mana_added::TriggerManaAdded::parse(&params),
        "TokenCreatedOnce" => crate::trigger::trigger_token_created_once::TriggerTokenCreatedOnce::parse(&params),
        "TapAll" => crate::trigger::trigger_tap_all::TriggerTapAll::parse(&params),
        "UntapAll" => crate::trigger::trigger_untap_all::TriggerUntapAll::parse(&params),
        "BecomesTargetOnce" => crate::trigger::trigger_becomes_target_once::TriggerBecomesTargetOnce::parse(&params),
        "AttackerBlockedByCreature" => crate::trigger::trigger_attacker_blocked_by_creature::TriggerAttackerBlockedByCreature::parse(&params),
        "AttackerBlockedOnce" => crate::trigger::trigger_attacker_blocked_once::TriggerAttackerBlockedOnce::parse(&params),
        "AttackerUnblockedOnce" => crate::trigger::trigger_attacker_unblocked_once::TriggerAttackerUnblockedOnce::parse(&params),
        "SpellCastOnce" | "SpellCastOfType" => {
            crate::trigger::trigger_spell_ability_cast_or_copy::TriggerSpellAbilityCastOrCopy::parse(mode_str, &params)
        }
        "DamageAll" => crate::trigger::trigger_damage_all::TriggerDamageAll::parse(&params),
        "DamagePreventedOnce" => crate::trigger::trigger_damage_prevented_once::TriggerDamagePreventedOnce::parse(&params),
        "ExcessDamage" => crate::trigger::trigger_excess_damage::TriggerExcessDamage::parse(&params),
        "ExcessDamageAll" => crate::trigger::trigger_excess_damage_all::TriggerExcessDamageAll::parse(&params),
        "CounterRemovedOnce" => {
            let valid_card = params.selector_cloned(keys::VALID_CARD);
            let counter_type = params.get_cloned(keys::COUNTER_TYPE);
            crate::trigger::trigger_counter_removed_once::TriggerCounterRemovedOnce::parse(valid_card, counter_type)
        }
        "Exerted" => crate::trigger::trigger_exerted::TriggerExerted::parse(&params),
        "ManaExpend" => crate::trigger::trigger_mana_expend::TriggerManaExpend::parse(&params),
        "Mutates" => crate::trigger::trigger_mutates::TriggerMutates::parse(&params),
        "SetInMotion" => crate::trigger::trigger_set_in_motion::TriggerSetInMotion::parse(&params),
        "CaseSolved" => {
            let valid_card = params.selector_cloned(keys::VALID_CARD);
            let valid_player = params.selector_cloned(keys::VALID_PLAYER);
            crate::trigger::trigger_case_solved::TriggerCaseSolved::parse(valid_card, valid_player)
        }
        "ClaimPrize" => {
            let valid_player = params.selector_cloned(keys::VALID_PLAYER);
            let valid_card = params.selector_cloned(keys::VALID_CARD);
            crate::trigger::trigger_claim_prize::TriggerClaimPrize::parse(valid_player, valid_card)
        }
        "TakesInitiative" | "TakeInitiative" => crate::trigger::trigger_takes_initiative::TriggerTakesInitiative::parse(&params),
        "Adapt" => crate::trigger::trigger_adapt::TriggerAdapt::parse(&params),
        "BecomeRenowned" => crate::trigger::trigger_become_renowned::TriggerBecomeRenowned::parse(&params),
        "Evolved" => crate::trigger::trigger_evolved::TriggerEvolved::parse(&params),
        "BecomesPlotted" => crate::trigger::trigger_becomes_plotted::TriggerBecomesPlotted::parse(&params),
        "Investigated" => crate::trigger::trigger_investigated::TriggerInvestigated::parse(&params),
        "Proliferate" => crate::trigger::trigger_proliferate::TriggerProliferate::parse(&params),
        "CompletedDungeon" | "DungeonCompleted" => {
            let valid_player = params.selector_cloned(keys::VALID_PLAYER);
            crate::trigger::trigger_completed_dungeon::TriggerCompletedDungeon::parse(valid_player)
        }
        "CommitCrime" => {
            let valid_player = params.selector_cloned(keys::VALID_PLAYER);
            crate::trigger::trigger_commit_crime::TriggerCommitCrime::parse(valid_player)
        }
        "GiveGift" => crate::trigger::trigger_give_gift::TriggerGiveGift::parse(&params),
        "RingTemptsYou" => crate::trigger::trigger_ring_tempts_you::TriggerRingTemptsYou::parse(&params),
        "PayLife" => crate::trigger::trigger_pay_life::TriggerPayLife::parse(&params),
        "PayEcho" => crate::trigger::trigger_pay_echo::TriggerPayEcho::parse(&params),
        "ClassLevelGained" => {
            let valid_card = params.selector_cloned(keys::VALID_CARD);
            let class_level = params.as_i32("ClassLevel");
            crate::trigger::trigger_class_level_gained::TriggerClassLevelGained::parse(valid_card, class_level)
        }
        "NewGame" => crate::trigger::trigger_new_game::TriggerNewGame::parse(&params),
        "DayTimeChanges" => crate::trigger::trigger_day_time_changes::TriggerDayTimeChanges::parse(&params),
        "LosesGame" => crate::trigger::trigger_loses_game::TriggerLosesGame::parse(&params),
        "Discover" => crate::trigger::trigger_discover::TriggerDiscover::parse(&params),
        "Elementalbend" | "ElementalBend" | "Airbend" | "Earthbend" | "Firebend" | "Waterbend" => {
            crate::trigger::trigger_elementalbend::TriggerElementalbend::parse(&params)
        }
        "PlanarDice" => crate::trigger::trigger_planar_dice::TriggerPlanarDice::parse(&params),
        "PhaseOutAll" => crate::trigger::trigger_phase_out_all::TriggerPhaseOutAll::parse(&params),
        "VisitAttraction" => crate::trigger::trigger_visit_attraction::TriggerVisitAttraction::parse(&params),
        "EnteredRoom" | "RoomEntered" => crate::trigger::trigger_entered_room::TriggerEnteredRoom::parse(&params),
        "MilledAll" => crate::trigger::trigger_milled_all::TriggerMilledAll::parse(&params),
        "MilledOnce" => crate::trigger::trigger_milled_once::TriggerMilledOnce::parse(&params),
        "Abandoned" => crate::trigger::trigger_abandoned::TriggerAbandoned::parse(&params),
        "ManifestDread" => crate::trigger::trigger_manifest_dread::TriggerManifestDread::parse(&params),
        "Specializes" => crate::trigger::trigger_specializes::TriggerSpecializes::parse(&params),
        "Trains" => crate::trigger::trigger_trains::TriggerTrains::parse(&params),
        "Devoured" => crate::trigger::trigger_devoured::TriggerDevoured::parse(&params),
        "ConjureAll" => {
            let valid_player = params.selector_cloned(keys::VALID_PLAYER);
            let valid_card = params.selector_cloned(keys::VALID_CARD);
            crate::trigger::trigger_conjure_all::TriggerConjureAll::parse(valid_player, valid_card)
        }
        "SeekAll" => crate::trigger::trigger_seek_all::TriggerSeekAll::parse(&params),
        "BecomesCrewed" => crate::trigger::trigger_becomes_crewed::TriggerBecomesCrewed::parse(&params),
        "Championed" => {
            let valid_card = params.selector_cloned_any(&["ValidCard", "ValidChampioned"]);
            let valid_source = params.selector_cloned("ValidSource");
            crate::trigger::trigger_championed::TriggerChampioned::parse(valid_card, valid_source)
        }
        "Clashed" => {
            let valid_player = params.selector_cloned(keys::VALID_PLAYER);
            let won = params.get("Won").map(|v| v.eq_ignore_ascii_case("True"));
            crate::trigger::trigger_clashed::TriggerClashed::parse(valid_player, won)
        }
        "Mentored" => crate::trigger::trigger_mentored::TriggerMentored::parse(&params),
        "FullyUnlock" => crate::trigger::trigger_fully_unlock::TriggerFullyUnlock::parse(&params),
        "AbilityResolves" => crate::trigger::trigger_ability_resolves::TriggerAbilityResolves::parse(&params),
        "AbilityTriggered" => crate::trigger::trigger_ability_triggered::TriggerAbilityTriggered::parse(&params),
        "UnlockDoor" => crate::trigger::trigger_unlock_door::TriggerUnlockDoor::parse(&params),
        "Vote" => crate::trigger::trigger_vote::TriggerVote::parse(&params),
        "PlaneswalkedFrom" => crate::trigger::trigger_planeswalked_from::TriggerPlaneswalkedFrom::parse(&params),
        "PlaneswalkedTo" | "Planeswalk" => crate::trigger::trigger_planeswalked_to::TriggerPlaneswalkedTo::parse(&params),
        "CrankContraption" | "CrankAdvanced" => crate::trigger::trigger_crank_contraption::TriggerCrankContraption::parse(&params),
        "PayCumulativeUpkeep" => crate::trigger::trigger_pay_cumulative_upkeep::TriggerPayCumulativeUpkeep::parse(&params),
        "ChaosEnsues" => {
            let valid_player = params.selector_cloned(keys::VALID_PLAYER);
            crate::trigger::trigger_chaos_ensues::TriggerChaosEnsues::parse(valid_player)
        }
        "BecomesSaddled" => crate::trigger::trigger_becomes_saddled::TriggerBecomesSaddled::parse(&params),
        "Crewed" | "Saddled" | "Stationed" => crate::trigger::trigger_crewed_saddled::TriggerCrewedSaddled::parse(&params),
        "Unattach" => crate::trigger::trigger_unattach::TriggerUnattach::parse(&params),
        "Exploited" => crate::trigger::trigger_exploited::TriggerExploited::parse(&params),
        _ => return None,
    };

    let optional = params.has(keys::OPTIONAL_DECIDER);
    let static_trigger = params.has("Static");

    // Parse active zones (default: Battlefield)
    let mut active_zones = params
        .get(keys::TRIGGER_ZONES)
        .map(|s| {
            s.split(',')
                .filter_map(|z| ZoneType::from_str_compat(z.trim()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| vec![ZoneType::Battlefield]);
    // SpellCast triggers with ValidCard$ Card.Self fire while the card is on
    // the stack (cast triggers). Java handles these via addTrigAbility() on
    // the stack entry. In Rust, add Stack to active zones so the trigger is
    // registered when the card is being cast.
    if matches!(
        mode.trigger_type(),
        TriggerType::SpellCast | TriggerType::SpellCastOrCopy
    ) {
        let valid_card_is_self = params
            .selector(keys::VALID_CARD)
            .map(|selector| selector.is_any_of(["Card.Self"]))
            .unwrap_or(false);
        if valid_card_is_self && !active_zones.contains(&ZoneType::Stack) {
            active_zones.push(ZoneType::Stack);
        }
    }

    if !params.has(keys::TRIGGER_ZONES) && mode.trigger_type() == TriggerType::ChangesZone {
        if let Some(valid_card) = params.selector(keys::VALID_CARD) {
            let leaves_battlefield = params
                .get(keys::ORIGIN)
                .map(|origin| origin.split(',').any(|z| z.trim() == "Battlefield"))
                .unwrap_or(false);
            if leaves_battlefield && !static_trigger {
                active_zones = vec![ZoneType::Battlefield];
            }

            let self_trigger = valid_card
                .alternatives
                .iter()
                .flat_map(|alternative| &alternative.parts)
                .any(|part| part.value.eq_ignore_ascii_case("Self"));
            let any_origin = params
                .get(keys::ORIGIN)
                .map(|origin| origin.eq_ignore_ascii_case("Any"))
                .unwrap_or(true);
            if self_trigger && any_origin {
                if let Some(destinations) = params.get(keys::DESTINATION) {
                    let zones = destinations
                        .split(',')
                        .filter_map(|z| ZoneType::from_str_compat(z.trim()))
                        .collect::<Vec<_>>();
                    if !zones.is_empty() {
                        active_zones = zones;
                    }
                }
            }
        }
    }

    let ir = TriggerIr::from_params(&params);
    let execute = params.get_cloned(keys::EXECUTE).unwrap_or_default();
    let description = params
        .get_cloned(keys::TRIGGER_DESCRIPTION)
        .unwrap_or_default();

    let id = *next_id;
    *next_id += 1;

    let mut base = TriggerReplacementBase::default();
    base.card_trait_base.set_id(id as i32);
    base.card_trait_base.set_intrinsic(true);
    base.valid_host_zones = Some(active_zones);

    let kind = mode.trigger_type();
    Some(Trigger {
        id,
        base,
        kind,
        mode,
        ir,
        execute,
        optional,
        description,
        static_trigger,
        trigger_remembered: Vec::new(),
        spawning_ability: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card::Card;
    use crate::event::RunParams;
    use crate::ids::{CardId, PlayerId};
    use crate::spellability::SpellAbility;
    use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};

    #[test]
    fn parse_pipe_params_basic() {
        let params = Params::from_raw("Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDraw");
        assert_eq!(params.get("Mode"), Some("ChangesZone"));
        assert_eq!(params.get("Origin"), Some("Any"));
        assert_eq!(params.get("Destination"), Some("Battlefield"));
        assert_eq!(params.selector_value("ValidCard"), Some("Card.Self"));
        assert_eq!(params.get("Execute"), Some("TrigDraw"));
    }

    #[test]
    fn parse_trigger_changes_zone() {
        let mut next_id = 0;
        let trigger = parse_trigger(
            "Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDraw | TriggerDescription$ When CARDNAME enters the battlefield, draw two cards.",
            &mut next_id,
        ).unwrap();

        assert_eq!(trigger.id, 0);
        assert_eq!(trigger.execute, "TrigDraw");
        assert_eq!(trigger.kind, TriggerType::ChangesZone);
    }
}
