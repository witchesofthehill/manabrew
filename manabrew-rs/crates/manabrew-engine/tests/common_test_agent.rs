use std::cell::RefCell;
use std::rc::Rc;

use forge_foundation::ZoneType;
use manabrew_engine::agent::{PlayOption, PlayerAgent, TargetChoice};
use manabrew_engine::combat::DefenderId;
use manabrew_engine::game::GameState;
use manabrew_engine::ids::{CardId, PlayerId};
use manabrew_engine::mana::ManaPool;
use manabrew_engine::player::actions::PlayerAction;
use manabrew_engine::spellability::SpellAbility;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CallbackEvent {
    Reveal(Vec<String>),
    PayCostToPreventEffect(String),
    Reorder(Vec<String>),
    ChooseSingle(Vec<String>),
}

#[derive(Default)]
pub struct RecordingState {
    pub events: Vec<CallbackEvent>,
    pub pay_answers: Vec<bool>,
}

pub struct RecordingAgent {
    state: Rc<RefCell<RecordingState>>,
}

impl RecordingAgent {
    pub fn new(state: Rc<RefCell<RecordingState>>) -> Self {
        Self { state }
    }

    fn card_names(game: &GameState, cards: &[CardId]) -> Vec<String> {
        cards
            .iter()
            .map(|&cid| game.card(cid).card_name.clone())
            .collect()
    }
}

impl PlayerAgent for RecordingAgent {
    fn mulligan_decision(&mut self, _: PlayerId, _: &[CardId], _: u32) -> bool {
        true
    }

    fn choose_action(
        &mut self,
        player: PlayerId,
        action_space: Option<&manabrew_engine::agent::PriorityActionSpace>,
        request_action_space: &mut dyn FnMut() -> manabrew_engine::agent::PriorityActionSpace,
    ) -> PlayerAction {
        PlayerAction::PassPriority
    }

    fn choose_attackers(
        &mut self,
        _: PlayerId,
        _: &[CardId],
        _: &[DefenderId],
    ) -> Vec<(CardId, DefenderId)> {
        vec![]
    }

    fn choose_blockers(
        &mut self,
        _: PlayerId,
        _: &[CardId],
        _: &[CardId],
        _: Option<usize>,
    ) -> Vec<(CardId, CardId)> {
        vec![]
    }

    fn choose_targets_for(
        &mut self,
        sa: &mut SpellAbility,
        game: &GameState,
        mana_pools: &[ManaPool],
    ) -> bool {
        manabrew_engine::spellability::choose_targets_by_kind(self, sa, game, mana_pools)
    }

    fn choose_target_player(
        &mut self,
        _: PlayerId,
        valid: &[PlayerId],
        _: Option<&SpellAbility>,
    ) -> Option<PlayerId> {
        valid.first().copied()
    }

    fn choose_target_card(
        &mut self,
        _: PlayerId,
        valid: &[CardId],
        _: Option<&SpellAbility>,
    ) -> Option<CardId> {
        valid.first().copied()
    }

    fn choose_target_any(
        &mut self,
        _: PlayerId,
        valid_players: &[PlayerId],
        valid_cards: &[CardId],
        _: Option<&SpellAbility>,
    ) -> TargetChoice {
        if let Some(&pid) = valid_players.first() {
            TargetChoice::Player(pid)
        } else if let Some(&cid) = valid_cards.first() {
            TargetChoice::Card(cid)
        } else {
            TargetChoice::None
        }
    }

    fn reveal_cards(
        &mut self,
        game: &GameState,
        _: PlayerId,
        cards: &[CardId],
        _: ZoneType,
        _: PlayerId,
        _: Option<&str>,
    ) {
        self.state
            .borrow_mut()
            .events
            .push(CallbackEvent::Reveal(Self::card_names(game, cards)));
    }

    fn pay_cost_to_prevent_effect(
        &mut self,
        _: PlayerId,
        cost_kind: &str,
        _: &str,
        _: Option<CardId>,
        _: Option<manabrew_engine::ability::api_type::ApiType>,
        _can_pay: bool,
    ) -> bool {
        let mut state = self.state.borrow_mut();
        state
            .events
            .push(CallbackEvent::PayCostToPreventEffect(cost_kind.to_string()));
        state.pay_answers.remove(0)
    }

    fn choose_reorder_library(
        &mut self,
        _: &GameState,
        _: PlayerId,
        cards: &[CardId],
    ) -> Vec<CardId> {
        self.state.borrow_mut().events.push(CallbackEvent::Reorder(
            cards.iter().map(|c| format!("{}", c.0)).collect(),
        ));
        cards.to_vec()
    }

    fn choose_single_card_for_zone_change(
        &mut self,
        _: &GameState,
        _: PlayerId,
        valid: &[CardId],
        _: &str,
        _: bool,
    ) -> Option<CardId> {
        self.state
            .borrow_mut()
            .events
            .push(CallbackEvent::ChooseSingle(
                valid.iter().map(|c| format!("{}", c.0)).collect(),
            ));
        valid.first().copied()
    }

    fn choose_land_or_spell(&mut self, _: PlayerId) -> Option<bool> {
        None
    }
}
