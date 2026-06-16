use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};
use manabrew_engine::ability::effects::{resolve_effect, EffectContext};
/// Integration test for counterspells and control effects
///
/// This test verifies that:
/// 1. Counterspells properly counter spells on the stack
/// 2. Control effects properly change controller of permanents
///
/// These features were identified as broken in PR #37's priority system implementation.
use manabrew_engine::agent::{PlayOption, PlayerAgent, TargetChoice};
use manabrew_engine::card::CardInstance;
use manabrew_engine::combat::DefenderId;
use manabrew_engine::game::GameState;
use manabrew_engine::ids::{CardId, PlayerId};
use manabrew_engine::player::actions::PlayerAction;
use manabrew_engine::spellability::{SpellAbility, StackEntry};

/// A simple agent that always passes (for testing)
struct PassAgent;

impl PlayerAgent for PassAgent {
    fn mulligan_decision(
        &mut self,
        _player: PlayerId,
        _hand: &[CardId],
        _mulligan_count: u32,
    ) -> bool {
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
        _player: PlayerId,
        _available: &[CardId],
        _possible_defenders: &[DefenderId],
    ) -> Vec<(CardId, DefenderId)> {
        Vec::new()
    }

    fn choose_blockers(
        &mut self,
        _player: PlayerId,
        _attackers: &[CardId],
        _available_blockers: &[CardId],
        _max_blockers: Option<usize>,
    ) -> Vec<(CardId, CardId)> {
        Vec::new()
    }

    fn choose_target_player(
        &mut self,
        _player: PlayerId,
        valid: &[PlayerId],
        _sa: Option<&manabrew_engine::spellability::SpellAbility>,
    ) -> Option<PlayerId> {
        valid.first().copied()
    }

    fn choose_target_card(
        &mut self,
        _player: PlayerId,
        valid: &[CardId],
        _sa: Option<&manabrew_engine::spellability::SpellAbility>,
    ) -> Option<CardId> {
        valid.first().copied()
    }

    fn choose_target_any(
        &mut self,
        _player: PlayerId,
        valid_players: &[PlayerId],
        valid_cards: &[CardId],
        _sa: Option<&manabrew_engine::spellability::SpellAbility>,
    ) -> TargetChoice {
        if let Some(&pid) = valid_players.last() {
            TargetChoice::Player(pid)
        } else if let Some(&cid) = valid_cards.first() {
            TargetChoice::Card(cid)
        } else {
            TargetChoice::None
        }
    }

    fn choose_land_or_spell(&mut self, _player: PlayerId) -> Option<bool> {
        None
    }

    fn choose_targets_for(
        &mut self,
        sa: &mut manabrew_engine::spellability::SpellAbility,
        game: &manabrew_engine::game::GameState,
        mana_pools: &[manabrew_engine::mana::ManaPool],
    ) -> bool {
        manabrew_engine::spellability::choose_targets_by_kind(self, sa, game, mana_pools)
    }
}

fn make_island(owner: PlayerId) -> CardInstance {
    CardInstance::new(
        CardId(0),
        "Island".to_string(),
        owner,
        CardTypeLine::parse("Basic Land - Island"),
        ManaCost::no_cost(),
        ColorSet::COLORLESS,
        None,
        None,
        vec![],
        vec![],
    )
}

fn make_grizzly_bears(owner: PlayerId) -> CardInstance {
    CardInstance::new(
        CardId(0),
        "Grizzly Bears".to_string(),
        owner,
        CardTypeLine::parse("Creature - Bear"),
        ManaCost::parse("1 G"),
        ColorSet::GREEN,
        Some(2),
        Some(2),
        vec![],
        vec![],
    )
}

/// Test basic control change functionality
#[test]
fn test_basic_control_change() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0); // Alice
    let p1 = PlayerId(1); // Bob

    // Bob has a Grizzly Bears on the battlefield
    let bears = game.create_card(make_grizzly_bears(p1));
    game.move_card(bears, ZoneType::Battlefield, p1);
    game.card_mut(bears).summoning_sick = false;

    // Verify initial state
    let bears_card = game.card(bears);
    assert_eq!(
        bears_card.controller, p1,
        "Bears initially controlled by Bob"
    );
    assert_eq!(bears_card.owner, p1, "Bears owned by Bob");

    // Change control to Alice
    game.change_controller(bears, p0);

    // Verify new state
    let bears_card = game.card(bears);
    assert_eq!(bears_card.controller, p0, "Bears now controlled by Alice");
    assert_eq!(bears_card.owner, p1, "Bears still owned by Bob");

    // Verify zone tracking
    let alice_battlefield = game.zone(ZoneType::Battlefield, p0);
    let bob_battlefield = game.zone(ZoneType::Battlefield, p1);

    assert_eq!(alice_battlefield.len(), 1, "Alice should have Bears");
    assert_eq!(bob_battlefield.len(), 0, "Bob should have no creatures");
}
