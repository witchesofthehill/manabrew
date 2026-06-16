use crate::agent::PlayerAgent;
use crate::game::GameState;
use crate::game_loop::GameLoop;
use crate::ids::PlayerId;

/// Owns the live state and runtime services for one game session.
///
/// This is an additive facade over the existing `GameState` + `GameLoop`
/// split. It intentionally keeps `GameLoop::run(&mut GameState, ...)`
/// available so callers can migrate incrementally.
pub struct GameRuntime {
    pub game: GameState,
    pub loop_state: GameLoop,
    pub agents: Vec<Box<dyn PlayerAgent>>,
}

impl GameRuntime {
    pub fn from_parts(
        game: GameState,
        loop_state: GameLoop,
        agents: Vec<Box<dyn PlayerAgent>>,
    ) -> Self {
        Self {
            game,
            loop_state,
            agents,
        }
    }

    pub fn run(&mut self, rng: &mut impl rand::Rng, max_turns: u32) -> Option<PlayerId> {
        self.loop_state
            .run(&mut self.game, &mut self.agents, rng, max_turns)
    }

    pub fn run_opening_hand_actions(&mut self) {
        self.loop_state
            .run_opening_hand_actions(&mut self.game, &mut self.agents);
    }

    pub fn run_turn(&mut self, rng: &mut impl rand::Rng) {
        self.loop_state
            .run_turn(&mut self.game, &mut self.agents, rng);
    }

    pub fn game(&self) -> &GameState {
        &self.game
    }

    pub fn game_mut(&mut self) -> &mut GameState {
        &mut self.game
    }

    pub fn loop_state(&self) -> &GameLoop {
        &self.loop_state
    }

    pub fn loop_state_mut(&mut self) -> &mut GameLoop {
        &mut self.loop_state
    }

    pub fn agents(&self) -> &[Box<dyn PlayerAgent>] {
        &self.agents
    }

    pub fn agents_mut(&mut self) -> &mut [Box<dyn PlayerAgent>] {
        &mut self.agents
    }

    pub fn into_parts(self) -> (GameState, GameLoop, Vec<Box<dyn PlayerAgent>>) {
        (self.game, self.loop_state, self.agents)
    }
}
