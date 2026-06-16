//! Activation restrictions for spell abilities.
//!
//! Mirrors Java's `SpellAbilityRestriction.java` — determines whether a
//! spell ability can be legally activated given the current game state.

use forge_foundation::{PhaseType, ZoneType};
use serde::{Deserialize, Serialize};

use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::parsing::compare::compare_expr;
use crate::parsing::{Params, ParsedParams};
use crate::spellability::SpellAbility;

use super::spell_ability_variables::SpellAbilityVariables;

/// Activation restrictions for a spell ability.
/// Mirrors Java's `SpellAbilityRestriction` — wraps `SpellAbilityVariables`
/// and checks game state conditions to determine if activation is legal.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpellAbilityRestriction {
    pub variables: SpellAbilityVariables,
}

impl Default for SpellAbilityRestriction {
    fn default() -> Self {
        Self {
            variables: SpellAbilityVariables::new(),
        }
    }
}

impl SpellAbilityRestriction {
    /// Create a new restriction with default variables.
    pub fn new() -> Self {
        Self::default()
    }

    /// Parse activation restrictions from ability params.
    /// Mirrors Java's `SpellAbilityRestriction.setRestrictions(SpellAbility)`.
    pub fn set_restrictions(&mut self, params: &Params) {
        self.set_restrictions_from(|key| params.get(key));
    }

    pub fn set_restrictions_parsed(&mut self, params: &ParsedParams<'_>) {
        self.set_restrictions_from(|key| params.get(key));
    }

    fn set_restrictions_from<'a, F>(&mut self, get: F)
    where
        F: Fn(&str) -> Option<&'a str>,
    {
        let is_true = |key| get(key).is_some_and(|value| value.eq_ignore_ascii_case("True"));

        if let Some(value) = get("Activation") {
            match value {
                "Threshold" => self.variables.set_threshold(true),
                "Metalcraft" => self.variables.set_metalcraft(true),
                "Delirium" => self.variables.set_delirium(true),
                "Hellbent" => self.variables.set_hellbent(true),
                "Desert" => self.variables.set_desert(true),
                "Blessing" => self.variables.set_blessing(true),
                "Solved" => self.variables.set_solved(true),
                _ => {}
            }
        }

        // Parse activation zone
        if let Some(zone_str) = get("ActivationZone") {
            if let Some(zone) = parse_zone(zone_str) {
                self.variables.set_zone(zone);
            }
        }

        // Parse phase restrictions
        if let Some(phases_str) = get("ActivationPhases") {
            for phase_name in phases_str.split(',') {
                if let Some(phase) = PhaseType::from_script_name(phase_name.trim()) {
                    self.variables.add_phase(phase);
                }
            }
        }

        // Parse sorcery speed restriction
        if is_true("SorcerySpeed") {
            self.variables.set_sorcery_speed(true);
        }

        // Parse instant speed
        if is_true("InstantSpeed") {
            self.variables.set_instant_speed(true);
        }

        // Parse activator
        if let Some(activator) = get("Activator") {
            self.variables.set_activator(activator.to_string());
        }

        // Parse turn restrictions
        if is_true("PlayerTurn") {
            self.variables.set_player_turn(true);
        }
        if is_true("OpponentTurn") {
            self.variables.set_opponent_turn(true);
        }

        // Parse activation limits
        if let Some(limit) = get("ActivationLimit") {
            self.variables.set_limit_to_check(Some(limit.to_string()));
        }
        if let Some(game_limit) = get("GameActivationLimit") {
            self.variables
                .set_game_limit_to_check(Some(game_limit.to_string()));
        }

        // Parse condition flags
        if is_true("Threshold") {
            self.variables.set_threshold(true);
        }
        if is_true("Metalcraft") {
            self.variables.set_metalcraft(true);
        }
        if is_true("Delirium") {
            self.variables.set_delirium(true);
        }
        if is_true("Hellbent") {
            self.variables.set_hellbent(true);
        }
        if is_true("Revolt") {
            self.variables.set_revolt(true);
        }
        if is_true("Desert") {
            self.variables.set_desert(true);
        }
        if is_true("Blessing") {
            self.variables.set_blessing(true);
        }
        if is_true("Solved") {
            self.variables.set_solved(true);
        }

        // Parse presence check
        if let Some(present) = get("IsPresent") {
            self.variables.set_is_present(Some(present.to_string()));
        }
        if let Some(compare) = get("PresentCompare") {
            self.variables
                .set_present_compare(Some(compare.to_string()));
        }
        if let Some(zone_str) = get("PresentZone") {
            if let Some(zone) = parse_zone(zone_str) {
                self.variables.set_present_zone(zone);
            }
        }
        if let Some(defined) = get("PresentDefined") {
            self.variables
                .set_present_defined(Some(defined.to_string()));
        }

        if let Some(class_level) = get("ClassLevel") {
            if class_level.len() >= 2 {
                self.variables
                    .set_class_level_operator(Some(class_level[..2].to_string()));
                self.variables
                    .set_class_level(Some(class_level[2..].to_string()));
            }
        }

        // Parse cards in hand requirement
        if let Some(count_str) = get("ActivateCardsInHand") {
            if let Ok(count) = count_str.parse::<i32>() {
                self.variables.set_cards_in_hand(count);
            }
        }
    }

    /// Check if this spell ability can be played given the current game state.
    /// Mirrors Java's `SpellAbilityRestriction.canPlay(Card, SpellAbility)`.
    pub fn can_play(&self, game: &GameState, card_id: CardId, player: PlayerId) -> bool {
        self.can_play_with_sa(game, card_id, player, None)
    }

    pub fn can_play_with_sa(
        &self,
        game: &GameState,
        card_id: CardId,
        player: PlayerId,
        sa: Option<&SpellAbility>,
    ) -> bool {
        // Check zone restriction
        let card_zone = game.card_current_zone(card_id);
        if card_zone != self.variables.zone() {
            return false;
        }
        let card = game.card(card_id);
        if !self.can_player_activate_host(game, card_id, player) {
            return false;
        }

        // Check phase restriction
        let phases = self.variables.phases();
        if !phases.is_empty() && !phases.contains(&game.turn.phase) {
            return false;
        }

        // Check sorcery speed: must be a main phase and the stack must be empty
        if self.variables.sorcery_speed() {
            let is_main = game.turn.phase.is_main();
            let stack_empty = game.stack.is_empty();
            let is_active = game.turn.active_player == player;
            if !is_main || !stack_empty || !is_active {
                return false;
            }
        }

        // Check turn restrictions
        let is_players_turn = game.turn.active_player == player;
        if self.variables.player_turn() && !is_players_turn {
            return false;
        }
        if self.variables.opponent_turn() && is_players_turn {
            return false;
        }

        // Check cards in hand requirement
        let required = self.variables.cards_in_hand();
        if required >= 0 && game.player_hand_count(player) < required as usize {
            return false;
        }

        if self.variables.hellbent() && !game.player_has_hellbent(player) {
            return false;
        }

        if self.variables.threshold() && !game.player_has_threshold(player) {
            return false;
        }

        if self.variables.metalcraft() && !game.player_has_metalcraft(player) {
            return false;
        }

        if self.variables.delirium() && !game.player_has_delirium(player) {
            return false;
        }

        if self.variables.revolt() && !game.player_has_revolt(player) {
            return false;
        }

        if self.variables.desert() && !game.player_has_desert(player) {
            return false;
        }

        if self.variables.blessing() && !game.player_has_blessing(player) {
            return false;
        }

        if !self.check_presence_restriction(game, card_id, player, sa) {
            return false;
        }

        if let Some(class_level) = self.variables.class_level() {
            let Some(operator) = self.variables.class_level_operator() else {
                return false;
            };
            let operand = class_level.parse::<i32>().unwrap_or(0);
            if !compare_expr(card.class_level, &format!("{operator}{operand}")) {
                return false;
            }
        }

        true
    }

    fn check_presence_restriction(
        &self,
        game: &GameState,
        card_id: CardId,
        player: PlayerId,
        sa: Option<&SpellAbility>,
    ) -> bool {
        let Some(is_present) = self.variables.is_present() else {
            return true;
        };
        let cards = if let Some(defined) = self.variables.present_defined() {
            crate::ability::ability_utils::get_defined_cards(
                game,
                Some(card_id),
                defined,
                Some(player),
            )
        } else {
            game.cards_in_zone(self.variables.present_zone(), player)
                .iter()
                .copied()
                .collect()
        };
        let count = cards
            .into_iter()
            .filter(|&cid| {
                if let Some(sa) = sa {
                    crate::ability::ability_utils::matches_valid_cards_for_sa(
                        game,
                        sa,
                        game.card(cid),
                        None,
                        is_present,
                    )
                } else {
                    crate::ability::ability_utils::matches_valid_cards_for_source(
                        game,
                        card_id,
                        game.card(cid),
                        None,
                        is_present,
                    )
                }
            })
            .count() as i32;
        let compare = self.variables.present_compare().unwrap_or("GE1");
        compare_expr(count, compare)
    }

    /// Check zone restrictions only.
    /// Mirrors Java's `SpellAbilityRestriction.checkZoneRestrictions(Card, SpellAbility)`.
    pub fn check_zone_restrictions(&self, game: &GameState, card_id: CardId) -> bool {
        game.card_current_zone(card_id) == self.variables.zone()
    }

    /// Check timing restrictions (phase, sorcery speed, etc.).
    /// Mirrors Java's `SpellAbilityRestriction.checkTimingRestrictions(Card, SpellAbility)`.
    pub fn check_timing_restrictions(&self, game: &GameState, player: PlayerId) -> bool {
        let phases = self.variables.phases();
        if !phases.is_empty() && !phases.contains(&game.turn.phase) {
            return false;
        }
        if self.variables.sorcery_speed() {
            let is_main = game.turn.phase.is_main();
            let stack_empty = game.stack.is_empty();
            let is_active = game.turn.active_player == player;
            if !is_main || !stack_empty || !is_active {
                return false;
            }
        }
        let is_players_turn = game.turn.active_player == player;
        if self.variables.player_turn() && !is_players_turn {
            return false;
        }
        if self.variables.opponent_turn() && is_players_turn {
            return false;
        }
        true
    }

    /// Check activator restrictions.
    /// Mirrors Java's `SpellAbilityRestriction.checkActivatorRestrictions(Card, SpellAbility)`.
    pub fn check_activator_restrictions(&self, game: &GameState, player: PlayerId) -> bool {
        let activator = self.variables.activator();
        if activator == "Player" {
            return true;
        }
        if activator == "You" {
            return true;
        }
        if activator == "Opponent" {
            return game.turn.active_player != player;
        }
        true
    }

    /// Whether `player` may activate an ability hosted by `card_id`.
    /// Mirrors the common Java valid-player cases used by `Activator$`.
    pub fn can_player_activate_host(
        &self,
        game: &GameState,
        card_id: CardId,
        player: PlayerId,
    ) -> bool {
        let controller = game.card(card_id).controller;
        match self.variables.activator() {
            "Player" => true,
            "You" => player == controller,
            "Opponent" => player != controller,
            activator if activator.starts_with("Player.PlayerUID_") => activator
                .strip_prefix("Player.PlayerUID_")
                .and_then(|id| id.parse::<u32>().ok())
                .map(|id| player.0 == id)
                .unwrap_or(false),
            _ => player == controller,
        }
    }

    /// Check other restrictions (threshold, metalcraft, etc.).
    /// Mirrors Java's `SpellAbilityRestriction.checkOtherRestrictions(Card, SpellAbility)`.
    pub fn check_other_restrictions(&self, game: &GameState, player: PlayerId) -> bool {
        if self.variables.hellbent() && !game.player_has_hellbent(player) {
            return false;
        }
        if self.variables.threshold() && !game.player_has_threshold(player) {
            return false;
        }
        if self.variables.metalcraft() && !game.player_has_metalcraft(player) {
            return false;
        }
        if self.variables.delirium() && !game.player_has_delirium(player) {
            return false;
        }
        if self.variables.revolt() && !game.player_has_revolt(player) {
            return false;
        }
        if self.variables.desert() && !game.player_has_desert(player) {
            return false;
        }
        if self.variables.blessing() && !game.player_has_blessing(player) {
            return false;
        }
        true
    }
}

/// Parse a zone string into a ZoneType.
fn parse_zone(s: &str) -> Option<ZoneType> {
    match s.to_lowercase().as_str() {
        "battlefield" => Some(ZoneType::Battlefield),
        "hand" => Some(ZoneType::Hand),
        "graveyard" => Some(ZoneType::Graveyard),
        "library" => Some(ZoneType::Library),
        "exile" => Some(ZoneType::Exile),
        "command" => Some(ZoneType::Command),
        _ => None,
    }
}
