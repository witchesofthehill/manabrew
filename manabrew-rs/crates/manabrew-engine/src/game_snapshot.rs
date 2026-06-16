use crate::combat::CombatState;
use crate::game::GameState;
use crate::mana::ManaPool;
use crate::spellability::MagicStack;
use crate::trigger::handler::TriggerHandler;

#[derive(Debug, Clone)]
pub struct GameSnapshot {
    game: GameState,
    mana_pools: Vec<ManaPool>,
    combat: CombatState,
    trigger_handler: TriggerHandler,
}

impl GameSnapshot {
    pub fn capture(
        game: &GameState,
        mana_pools: &[ManaPool],
        combat: &CombatState,
        trigger_handler: &TriggerHandler,
        include_stack: bool,
    ) -> Self {
        let mut game_copy = game.clone();
        if !include_stack {
            game_copy.stack = MagicStack::new();
        }
        Self {
            game: game_copy,
            mana_pools: mana_pools.to_vec(),
            combat: combat.clone(),
            trigger_handler: trigger_handler.clone(),
        }
    }

    /// Restore this snapshot into mutable game + loop runtime state.
    pub fn restore_game_state(
        &self,
        game: &mut GameState,
        mana_pools: &mut Vec<ManaPool>,
        combat: &mut CombatState,
        trigger_handler: &mut TriggerHandler,
    ) {
        *game = self.game.clone();
        *mana_pools = self.mana_pools.clone();
        *combat = self.combat.clone();
        *trigger_handler = self.trigger_handler.clone();
    }

    /// Restore this snapshot while preserving the caller-owned mana-pool
    /// allocation. Used by payment loops that hold a mutable slice into
    /// `GameLoop::mana_pools`; replacing the Vec there would invalidate the
    /// active slice.
    pub fn restore_game_state_with_mana_slice(
        &self,
        game: &mut GameState,
        mana_pools: &mut [ManaPool],
        combat: &mut CombatState,
        trigger_handler: &mut TriggerHandler,
    ) {
        *game = self.game.clone();
        assert_eq!(
            mana_pools.len(),
            self.mana_pools.len(),
            "snapshot mana pool count must match active game"
        );
        mana_pools.clone_from_slice(&self.mana_pools);
        *combat = self.combat.clone();
        *trigger_handler = self.trigger_handler.clone();
    }
}
