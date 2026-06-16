//! Activation/condition variables for spell abilities.
//!
//! Mirrors Java's `SpellAbilityVariables.java` — stores conditions like
//! zone, phase, sorcery speed, and various boolean game-state checks.

use std::collections::HashSet;

use forge_foundation::{PhaseType, ZoneType};
use serde::{Deserialize, Serialize};

/// Variables controlling when a spell ability can be activated or its conditions are met.
/// Mirrors Java's `SpellAbilityVariables` (lines 36-100).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpellAbilityVariables {
    /// Zone the card must be in to activate. Mirrors Java's `zone` field.
    zone: ZoneType,
    /// Phases during which the ability can be activated.
    phases: HashSet<PhaseType>,
    /// Whether this ability can only be activated at sorcery speed.
    sorcery_speed: bool,
    /// Whether this ability can be activated at instant speed.
    instant_speed: bool,
    /// Who can activate this ability. Mirrors Java's `activator` field.
    activator: String,
    /// Whether this can only be activated on an opponent's turn.
    opponent_turn: bool,
    /// Whether this can only be activated on the player's own turn.
    player_turn: bool,
    /// Per-turn activation limit expression (e.g. "1" means once per turn).
    limit_to_check: Option<String>,
    /// Per-game activation limit expression.
    game_limit_to_check: Option<String>,
    /// Number of cards required in hand (-1 = no restriction).
    cards_in_hand: i32,
    /// Threshold — seven or more cards in graveyard.
    threshold: bool,
    /// Metalcraft — three or more artifacts.
    metalcraft: bool,
    /// Delirium — four or more card types in graveyard.
    delirium: bool,
    /// Hellbent — no cards in hand.
    hellbent: bool,
    /// Revolt — a permanent you controlled left the battlefield this turn.
    revolt: bool,
    /// Desert — you control a Desert or have one in your graveyard.
    desert: bool,
    /// Blessing — your library has no cards (Blessing from Amonkhet).
    blessing: bool,
    /// Solved — this case has been solved (Murders at Karlov Manor).
    solved: bool,
    /// A card matching this expression must be present.
    is_present: Option<String>,
    /// Comparison operator for presence check (e.g. "GE1").
    present_compare: Option<String>,
    /// Zone to check for presence. Defaults to Battlefield.
    present_zone: ZoneType,
    /// Defined source for presence check (e.g. "You", "Opponent").
    present_defined: Option<String>,
    /// Variable operand 1 for condition/restriction comparisons.
    var_operand: Option<String>,
    /// Variable operand 2 for condition/restriction comparisons.
    var_operand2: Option<String>,
    /// Variable to check 1.
    var_to_check: Option<String>,
    /// Variable to check 2.
    var_to_check2: Option<String>,
    /// Comparison operator 1 (e.g. "GE", "EQ", "LT").
    var_operator: Option<String>,
    /// Comparison operator 2.
    var_operator2: Option<String>,
    /// Required Class level expression operand.
    class_level: Option<String>,
    /// Comparison operator for class level requirement.
    class_level_operator: Option<String>,
    /// Whether this targets a single target only.
    targets_single_target: bool,
}

impl Default for SpellAbilityVariables {
    fn default() -> Self {
        Self {
            zone: ZoneType::Battlefield,
            phases: HashSet::new(),
            sorcery_speed: false,
            instant_speed: false,
            activator: "You".to_string(),
            opponent_turn: false,
            player_turn: false,
            limit_to_check: None,
            game_limit_to_check: None,
            cards_in_hand: -1,
            threshold: false,
            metalcraft: false,
            delirium: false,
            hellbent: false,
            revolt: false,
            desert: false,
            blessing: false,
            solved: false,
            is_present: None,
            present_compare: None,
            present_zone: ZoneType::Battlefield,
            present_defined: None,
            var_operand: None,
            var_operand2: None,
            var_to_check: None,
            var_to_check2: None,
            var_operator: None,
            var_operator2: None,
            class_level: None,
            class_level_operator: None,
            targets_single_target: false,
        }
    }
}

impl SpellAbilityVariables {
    /// Create a new instance with default values.
    pub fn new() -> Self {
        Self::default()
    }

    // ── Zone ──────────────────────────────────────────────────────────────

    pub fn zone(&self) -> ZoneType {
        self.zone
    }

    pub fn set_zone(&mut self, zone: ZoneType) {
        self.zone = zone;
    }

    // ── Phases ────────────────────────────────────────────────────────────

    pub fn phases(&self) -> &HashSet<PhaseType> {
        &self.phases
    }

    pub fn set_phases(&mut self, phases: HashSet<PhaseType>) {
        self.phases = phases;
    }

    pub fn add_phase(&mut self, phase: PhaseType) {
        self.phases.insert(phase);
    }

    // ── Speed ─────────────────────────────────────────────────────────────

    pub fn sorcery_speed(&self) -> bool {
        self.sorcery_speed
    }

    pub fn set_sorcery_speed(&mut self, val: bool) {
        self.sorcery_speed = val;
    }

    pub fn instant_speed(&self) -> bool {
        self.instant_speed
    }

    pub fn set_instant_speed(&mut self, val: bool) {
        self.instant_speed = val;
    }

    // ── Activator ─────────────────────────────────────────────────────────

    pub fn activator(&self) -> &str {
        &self.activator
    }

    pub fn set_activator(&mut self, activator: String) {
        self.activator = activator;
    }

    // ── Turn restrictions ─────────────────────────────────────────────────

    pub fn opponent_turn(&self) -> bool {
        self.opponent_turn
    }

    pub fn set_opponent_turn(&mut self, val: bool) {
        self.opponent_turn = val;
    }

    pub fn player_turn(&self) -> bool {
        self.player_turn
    }

    pub fn set_player_turn(&mut self, val: bool) {
        self.player_turn = val;
    }

    // ── Limits ────────────────────────────────────────────────────────────

    pub fn limit_to_check(&self) -> Option<&str> {
        self.limit_to_check.as_deref()
    }

    pub fn set_limit_to_check(&mut self, limit: Option<String>) {
        self.limit_to_check = limit;
    }

    pub fn game_limit_to_check(&self) -> Option<&str> {
        self.game_limit_to_check.as_deref()
    }

    pub fn set_game_limit_to_check(&mut self, limit: Option<String>) {
        self.game_limit_to_check = limit;
    }

    // ── Cards in hand ─────────────────────────────────────────────────────

    pub fn cards_in_hand(&self) -> i32 {
        self.cards_in_hand
    }

    pub fn set_cards_in_hand(&mut self, count: i32) {
        self.cards_in_hand = count;
    }

    // ── Boolean conditions ────────────────────────────────────────────────

    pub fn threshold(&self) -> bool {
        self.threshold
    }

    pub fn set_threshold(&mut self, val: bool) {
        self.threshold = val;
    }

    pub fn metalcraft(&self) -> bool {
        self.metalcraft
    }

    pub fn set_metalcraft(&mut self, val: bool) {
        self.metalcraft = val;
    }

    pub fn delirium(&self) -> bool {
        self.delirium
    }

    pub fn set_delirium(&mut self, val: bool) {
        self.delirium = val;
    }

    pub fn hellbent(&self) -> bool {
        self.hellbent
    }

    pub fn set_hellbent(&mut self, val: bool) {
        self.hellbent = val;
    }

    pub fn revolt(&self) -> bool {
        self.revolt
    }

    pub fn set_revolt(&mut self, val: bool) {
        self.revolt = val;
    }

    pub fn desert(&self) -> bool {
        self.desert
    }

    pub fn set_desert(&mut self, val: bool) {
        self.desert = val;
    }

    pub fn blessing(&self) -> bool {
        self.blessing
    }

    pub fn set_blessing(&mut self, val: bool) {
        self.blessing = val;
    }

    pub fn solved(&self) -> bool {
        self.solved
    }

    pub fn set_solved(&mut self, val: bool) {
        self.solved = val;
    }

    // ── Presence checks ──────────────────────────────────────────────────

    pub fn is_present(&self) -> Option<&str> {
        self.is_present.as_deref()
    }

    pub fn set_is_present(&mut self, val: Option<String>) {
        self.is_present = val;
    }

    pub fn present_compare(&self) -> Option<&str> {
        self.present_compare.as_deref()
    }

    pub fn set_present_compare(&mut self, val: Option<String>) {
        self.present_compare = val;
    }

    pub fn present_zone(&self) -> ZoneType {
        self.present_zone
    }

    pub fn set_present_zone(&mut self, zone: ZoneType) {
        self.present_zone = zone;
    }

    pub fn present_defined(&self) -> Option<&str> {
        self.present_defined.as_deref()
    }

    pub fn set_present_defined(&mut self, val: Option<String>) {
        self.present_defined = val;
    }

    // ── Variable operands ─────────────────────────────────────────────────

    /// Get variable operand 1.
    /// Mirrors Java's `SpellAbilityVariables.getVarOperand()`.
    pub fn gets_var_operand(&self) -> Option<&str> {
        self.var_operand.as_deref()
    }

    /// Get variable operand 2.
    /// Mirrors Java's `SpellAbilityVariables.getVarOperand2()`.
    pub fn gets_var_operand2(&self) -> Option<&str> {
        self.var_operand2.as_deref()
    }

    /// Set variable operand 1.
    /// Mirrors Java's `SpellAbilityVariables.setVarOperand(String)`.
    pub fn sets_var_operand(&mut self, val: &str) {
        self.var_operand = Some(val.to_string());
    }

    /// Set variable operand 2.
    /// Mirrors Java's `SpellAbilityVariables.setVarOperand2(String)`.
    pub fn sets_var_operand2(&mut self, val: &str) {
        self.var_operand2 = Some(val.to_string());
    }

    // ── Variable to check ─────────────────────────────────────────────────

    /// Get variable to check 1.
    /// Mirrors Java's `SpellAbilityVariables.getVarToCheck()`.
    pub fn gets_var_to_check(&self) -> Option<&str> {
        self.var_to_check.as_deref()
    }

    /// Get variable to check 2.
    /// Mirrors Java's `SpellAbilityVariables.getVarToCheck2()`.
    pub fn gets_var_to_check2(&self) -> Option<&str> {
        self.var_to_check2.as_deref()
    }

    /// Set variable to check 1.
    /// Mirrors Java's `SpellAbilityVariables.setVarToCheck(String)`.
    pub fn sets_var_to_check(&mut self, val: &str) {
        self.var_to_check = Some(val.to_string());
    }

    /// Set variable to check 2.
    /// Mirrors Java's `SpellAbilityVariables.setVarToCheck2(String)`.
    pub fn sets_var_to_check2(&mut self, val: &str) {
        self.var_to_check2 = Some(val.to_string());
    }

    // ── Variable operators ────────────────────────────────────────────────

    /// Get variable operator 1.
    /// Mirrors Java's `SpellAbilityVariables.getVarOperator()`.
    pub fn gets_var_operator(&self) -> Option<&str> {
        self.var_operator.as_deref()
    }

    /// Get variable operator 2.
    /// Mirrors Java's `SpellAbilityVariables.getVarOperator2()`.
    pub fn gets_var_operator2(&self) -> Option<&str> {
        self.var_operator2.as_deref()
    }

    /// Set variable operator 1.
    /// Mirrors Java's `SpellAbilityVariables.setVarOperator(String)`.
    pub fn sets_var_operator(&mut self, val: &str) {
        self.var_operator = Some(val.to_string());
    }

    /// Set variable operator 2.
    /// Mirrors Java's `SpellAbilityVariables.setVarOperator2(String)`.
    pub fn sets_var_operator2(&mut self, val: &str) {
        self.var_operator2 = Some(val.to_string());
    }

    // ── Class level ───────────────────────────────────────────────────────

    pub fn class_level(&self) -> Option<&str> {
        self.class_level.as_deref()
    }

    pub fn set_class_level(&mut self, val: Option<String>) {
        self.class_level = val;
    }

    pub fn class_level_operator(&self) -> Option<&str> {
        self.class_level_operator.as_deref()
    }

    pub fn set_class_level_operator(&mut self, val: Option<String>) {
        self.class_level_operator = val;
    }

    // ── Single target ─────────────────────────────────────────────────────

    /// Whether this targets a single target.
    /// Mirrors Java's `SpellAbilityVariables.targetsSingleTarget()`.
    pub fn targets_single_target(&self) -> bool {
        self.targets_single_target
    }

    /// Set whether this targets a single target.
    pub fn set_targets_single_target(&mut self, val: bool) {
        self.targets_single_target = val;
    }

    // ── Copy ──────────────────────────────────────────────────────────────

    /// Clone these variables.
    /// Mirrors Java's `SpellAbilityVariables.copy()`.
    pub fn copy(&self) -> Self {
        self.clone()
    }
}
