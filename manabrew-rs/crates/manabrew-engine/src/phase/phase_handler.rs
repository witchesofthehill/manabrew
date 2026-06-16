//! PhaseHandler — manages game turn and phase progression.
//!
//! Mirrors Java's `PhaseHandler.java`.
//! The core turn state machine lives in `crate::game_loop::GameLoop`;
//! this module provides the phase-specific state tracking that the
//! game loop delegates to.

use std::collections::HashMap;

use forge_foundation::PhaseType;

use crate::ids::PlayerId;

use super::extra_phase::ExtraPhase;
use super::extra_turn::ExtraTurn;

/// Tracks phase-specific state for a game.
/// Mirrors Java's `PhaseHandler` fields.
#[derive(Debug, Clone)]
pub struct PhaseHandler {
    phase: Option<PhaseType>,
    turn: i32,

    /// Stack of extra turns (LIFO — most recent on top).
    extra_turns: Vec<ExtraTurn>,
    /// Extra phases keyed by the phase they follow.
    extra_phases: HashMap<PhaseType, Vec<ExtraPhase>>,

    pub n_upkeeps_this_turn: i32,
    pub n_upkeeps_this_game: i32,
    pub n_combats_this_turn: i32,
    pub n_mains_this_turn: i32,
    pub n_end_of_turns_this_turn: i32,
    pub planar_dice_special_action_this_turn: i32,

    player_turn: Option<PlayerId>,
    player_previous_turn: Option<PlayerId>,

    priority_player: Option<PlayerId>,
    first_priority: Option<PlayerId>,

    pub skip_damage_steps: bool,
    pub repeat_cleanup: bool,
    pub give_priority_to_player: bool,
}

impl PhaseHandler {
    pub fn new() -> Self {
        PhaseHandler {
            phase: None,
            turn: 0,
            extra_turns: Vec::new(),
            extra_phases: HashMap::new(),
            n_upkeeps_this_turn: 0,
            n_upkeeps_this_game: 0,
            n_combats_this_turn: 0,
            n_mains_this_turn: 0,
            n_end_of_turns_this_turn: 0,
            planar_dice_special_action_this_turn: 0,
            player_turn: None,
            player_previous_turn: None,
            priority_player: None,
            first_priority: None,
            skip_damage_steps: false,
            repeat_cleanup: false,
            give_priority_to_player: false,
        }
    }

    pub fn get_phase(&self) -> Option<PhaseType> {
        self.phase
    }

    pub fn set_phase(&mut self, phase: PhaseType) {
        self.phase = Some(phase);
    }

    pub fn get_turn(&self) -> i32 {
        self.turn
    }

    pub fn is_player_turn(&self, player: PlayerId) -> bool {
        self.player_turn == Some(player)
    }

    pub fn get_player_turn(&self) -> Option<PlayerId> {
        self.player_turn
    }

    pub fn set_player_turn(&mut self, player: PlayerId) {
        self.player_turn = Some(player);
        self.set_priority(player);
    }

    pub fn get_previous_player_turn(&self) -> Option<PlayerId> {
        self.player_previous_turn
    }

    pub fn get_priority_player(&self) -> Option<PlayerId> {
        self.priority_player
    }

    pub fn set_priority(&mut self, player: PlayerId) {
        self.first_priority = Some(player);
        self.priority_player = Some(player);
    }

    pub fn reset_priority(&mut self) {
        if let Some(player) = self.player_turn {
            self.set_priority(player);
        }
    }

    pub fn is_first_combat(&self) -> bool {
        self.n_combats_this_turn == 1
    }

    pub fn get_num_combat(&self) -> i32 {
        self.n_combats_this_turn
    }

    pub fn get_num_upkeep(&self) -> i32 {
        self.n_upkeeps_this_turn
    }

    pub fn is_first_upkeep(&self) -> bool {
        self.phase == Some(PhaseType::Upkeep) && self.n_upkeeps_this_turn == 0
    }

    pub fn is_first_upkeep_this_game(&self) -> bool {
        self.phase == Some(PhaseType::Upkeep) && self.n_upkeeps_this_game == 0
    }

    pub fn get_num_main(&self) -> i32 {
        self.n_mains_this_turn
    }

    pub fn before_first_post_combat_main_end(&self) -> bool {
        self.n_mains_this_turn
            <= if self.phase == Some(PhaseType::Main2) {
                2
            } else {
                1
            }
    }

    pub fn skipped_declare_blockers(&self) -> bool {
        self.skip_damage_steps
    }

    pub fn get_num_end_of_turn(&self) -> i32 {
        self.n_end_of_turns_this_turn
    }

    pub fn is(&self, phase: PhaseType) -> bool {
        self.phase == Some(phase)
    }

    pub fn is_phase_player(&self, phase: PhaseType, player: PlayerId) -> bool {
        self.phase == Some(phase) && self.player_turn == Some(player)
    }

    /// Add an extra turn for the given player.
    /// Mirrors Java's `PhaseHandler.addExtraTurn()`.
    pub fn add_extra_turn(&mut self, player: PlayerId, player_order: &[PlayerId]) -> &ExtraTurn {
        // Use a stack: if empty, push the normal next turn first
        if self.extra_turns.is_empty() {
            if let Some(current) = self.player_turn {
                let next = next_player_after(current, player_order);
                self.extra_turns.push(ExtraTurn::new(next));
            }
        }
        self.extra_turns.push(ExtraTurn::new(player));
        self.extra_turns.last().unwrap()
    }

    /// Add extra phase(s) after the given phase.
    /// Mirrors Java's `PhaseHandler.addExtraPhase()`.
    pub fn add_extra_phase(
        &mut self,
        after_phase: PhaseType,
        extra_phase_list: &[PhaseType],
        next_phase: PhaseType,
    ) {
        for (i, &extra) in extra_phase_list.iter().enumerate() {
            let entry = self.extra_phases.entry(extra).or_default();
            if i < extra_phase_list.len() - 1 {
                entry.push(ExtraPhase::new(extra_phase_list[i + 1]));
            } else {
                entry.push(ExtraPhase::new(next_phase));
            }
        }
        let after_entry = self.extra_phases.entry(after_phase).or_default();
        after_entry.push(ExtraPhase::new(extra_phase_list[0]));
    }

    pub fn get_next_turn(&self, player_order: &[PlayerId]) -> Option<PlayerId> {
        if let Some(last) = self.extra_turns.last() {
            Some(last.get_player())
        } else {
            self.player_turn.map(|p| next_player_after(p, player_order))
        }
    }

    /// Reset the phase handler for a game restart (e.g. Karn Liberated).
    /// Mirrors Java's `PhaseHandler.restart()`.
    pub fn restart(&mut self) {
        self.extra_phases.clear();
        self.extra_turns.clear();
        self.turn = 0;
    }

    /// Called when the stack resolves — re-enable priority.
    /// Mirrors Java's `PhaseHandler.onStackResolved()`.
    pub fn on_stack_resolved(&mut self) {
        self.give_priority_to_player = true;
    }

    pub fn get_planar_dice_special_action_this_turn(&self) -> i32 {
        self.planar_dice_special_action_this_turn
    }

    pub fn inc_planar_dice_special_action_this_turn(&mut self) {
        self.planar_dice_special_action_this_turn += 1;
    }

    /// Get the continuous extra turn count for a player.
    /// Mirrors Java's `PhaseHandler.getExtraTurnForPlayer()`.
    pub fn get_extra_turn_for_player(&self, player: PlayerId) -> i32 {
        if self.extra_turns.len() < 2 {
            return 0;
        }
        let mut count = 0;
        // Skip the first element (bottom of stack = normal turn)
        for et in self.extra_turns.iter().skip(1) {
            if et.get_player() != player {
                break;
            }
            count += 1;
        }
        count
    }

    /// Advance to the next turn. Returns the player who gets the next turn.
    /// Mirrors Java's `PhaseHandler.handleNextTurn()`.
    pub fn handle_next_turn(&mut self, player_order: &[PlayerId]) -> PlayerId {
        self.player_previous_turn = self.player_turn;

        let next = if let Some(extra) = self.extra_turns.pop() {
            let player = extra.get_player();
            // Register skip_untap if needed
            if extra.is_skip_untap() {
                // Caller should handle this
            }
            player
        } else {
            self.player_turn
                .map(|p| next_player_after(p, player_order))
                .unwrap_or(player_order[0])
        };

        self.turn += 1;
        self.extra_phases.clear();
        self.n_upkeeps_this_turn = 0;
        self.n_combats_this_turn = 0;
        self.n_mains_this_turn = 0;
        self.n_end_of_turns_this_turn = 0;
        self.planar_dice_special_action_this_turn = 0;

        self.set_player_turn(next);
        next
    }

    pub fn end_combat_phase_by_effect(&mut self) {
        self.phase = Some(PhaseType::CombatEnd);
    }

    pub fn end_turn_by_effect(&mut self) {
        self.extra_phases.clear();
        self.phase = Some(PhaseType::Cleanup);
    }

    pub fn debug_print_state(&self, has_priority: bool) -> String {
        format!(
            "{:?}'s {:?} [{}P] {:?}",
            self.player_turn,
            self.phase,
            if has_priority { "+" } else { "-" },
            self.priority_player
        )
    }

    /// Returns true if a combat is currently in progress.
    /// Mirrors Java's `PhaseHandler.inCombat()`.
    pub fn in_combat(&self) -> bool {
        self.phase.is_some_and(|p| p.is_combat())
    }

    /// End the current combat.
    /// Mirrors Java's `PhaseHandler.endCombat()`.
    pub fn end_combat(&mut self) {
        // The actual combat cleanup (removing attackers/blockers) is handled
        // by the game loop's CombatState. This resets phase-level tracking.
        self.skip_damage_steps = false;
    }

    /// Set up the first turn of the game for the given player.
    /// Mirrors Java's `PhaseHandler.setupFirstTurn()`.
    pub fn setup_first_turn(&mut self, goes_first: PlayerId) {
        self.set_player_turn(goes_first);
        self.set_phase(PhaseType::Untap);
        self.turn = 1;
        self.give_priority_to_player = false;
    }

    /// Start the first turn and enter the main game loop.
    /// Mirrors Java's `PhaseHandler.startFirstTurn()`.
    /// In Rust, the actual loop is driven by `GameLoop::run_turn_state_machine()`.
    pub fn start_first_turn(&mut self, goes_first: PlayerId) {
        self.setup_first_turn(goes_first);
    }

    /// Dev mode: advance to a target phase, running phase transitions.
    /// Mirrors Java's `PhaseHandler.devAdvanceToPhase()`.
    pub fn dev_advance_to_phase(&mut self, target_phase: PhaseType) -> bool {
        while let Some(current) = self.phase {
            if !current.is_before(target_phase) {
                break;
            }
            self.phase = Some(current.next());
        }
        true
    }

    /// Dev mode: set the phase and player directly.
    /// Mirrors Java's `PhaseHandler.devModeSet()`.
    pub fn dev_mode_set(
        &mut self,
        phase: Option<PhaseType>,
        player: Option<PlayerId>,
        end_combat: bool,
        cturn: i32,
    ) {
        if let Some(p) = phase {
            self.set_phase(p);
        }
        if let Some(pl) = player {
            self.set_player_turn(pl);
        }
        self.turn = cturn;
        if end_combat {
            self.end_combat();
        }
    }
}

impl Default for PhaseHandler {
    fn default() -> Self {
        Self::new()
    }
}

/// Get the next player in turn order after the given player.
fn next_player_after(current: PlayerId, player_order: &[PlayerId]) -> PlayerId {
    if let Some(pos) = player_order.iter().position(|&p| p == current) {
        let next = (pos + 1) % player_order.len();
        player_order[next]
    } else {
        player_order[0]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_phase_handler() {
        let ph = PhaseHandler::new();
        assert_eq!(ph.get_phase(), None);
        assert_eq!(ph.get_turn(), 0);
    }

    #[test]
    fn set_phase() {
        let mut ph = PhaseHandler::new();
        ph.set_phase(PhaseType::Upkeep);
        assert_eq!(ph.get_phase(), Some(PhaseType::Upkeep));
        assert!(ph.is(PhaseType::Upkeep));
    }

    #[test]
    fn extra_turn_count() {
        let mut ph = PhaseHandler::new();
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);
        ph.set_player_turn(p0);
        ph.add_extra_turn(p0, &[p0, p1]);
        assert_eq!(ph.get_extra_turn_for_player(p0), 1);
        assert_eq!(ph.get_extra_turn_for_player(p1), 0);
    }
}
