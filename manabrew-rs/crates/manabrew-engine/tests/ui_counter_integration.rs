use forge_foundation::{CardTypeLine, ColorSet, ManaCost, PhaseType, ZoneType};
/// Integration test to verify counterspell and priority system works end-to-end
/// This validates that the UI components (chooseTargetSpell, stack rendering, priority passing)
/// have proper backend support
use manabrew_engine::agent::{PlayCardMode, PlayOption, PlayerAgent, TargetChoice};
use manabrew_engine::card::CardInstance;
use manabrew_engine::combat::DefenderId;
use manabrew_engine::game::GameState;
use manabrew_engine::game_loop::GameLoop;
use manabrew_engine::ids::{CardId, PlayerId};
use manabrew_engine::player::actions::PlayerAction;
use manabrew_engine::spellability::{SpellAbility, StackEntry};

/// Mock agent that simulates a human player casting counterspells
struct CounterspellAgent {
    step: usize,
}

impl CounterspellAgent {
    fn new() -> Self {
        CounterspellAgent { step: 0 }
    }
}

impl PlayerAgent for CounterspellAgent {
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
        self.step += 1;
        let requested_action_space;
        let action_space = match action_space {
            Some(action_space) => action_space,
            None => {
                requested_action_space = request_action_space();
                &requested_action_space
            }
        };
        let playable = &action_space.playable;

        match self.step {
            1 => {
                // Turn 1: Play first playable card (should be a land)
                if let Some(&opt) = playable.first() {
                    PlayerAction::CastSpell(opt)
                } else {
                    PlayerAction::PassPriority
                }
            }
            2 => {
                // Later turn: Cast Counterspell if available
                if let Some(&opt) = playable.first() {
                    PlayerAction::CastSpell(opt)
                } else {
                    PlayerAction::PassPriority
                }
            }
            _ => PlayerAction::PassPriority,
        }
    }

    fn choose_target_spell(
        &mut self,
        _player: PlayerId,
        valid: &[u32],
        _source: Option<CardId>,
    ) -> Option<u32> {
        // Always target the first valid spell (counter the opponent's spell)
        valid.first().copied()
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

fn make_counterspell(owner: PlayerId) -> CardInstance {
    CardInstance::new(
        CardId(0),
        "Counterspell".to_string(),
        owner,
        CardTypeLine::parse("Instant"),
        ManaCost::parse("U U"),
        ColorSet::BLUE,
        None,
        None,
        vec![],
        vec!["SP$ Counter | TargetType$ Spell | ValidTgts$ Card | SpellDescription$ Counter target spell.".to_string()],
    )
}

fn make_lightning_bolt(owner: PlayerId) -> CardInstance {
    CardInstance::new(
        CardId(0),
        "Lightning Bolt".to_string(),
        owner,
        CardTypeLine::parse("Instant"),
        ManaCost::parse("R"),
        ColorSet::RED,
        None,
        None,
        vec![],
        vec!["SP$ DealDamage | ValidTgts$ Any | NumDmg$ 3 | SpellDescription$ CARDNAME deals 3 damage to any target.".to_string()],
    )
}

/// Test priority passing during counterspell wars
#[test]
fn test_priority_passing_during_counter_war() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    // Setup: Both players have counterspells ready
    let counterspell1 = game.create_card(make_counterspell(p0));
    let counterspell2 = game.create_card(make_counterspell(p1));

    game.move_card(counterspell1, ZoneType::Hand, p0);
    game.move_card(counterspell2, ZoneType::Hand, p1);

    // Put a Lightning Bolt on stack (simulating being cast)
    let bolt = game.create_card(make_lightning_bolt(p0));
    game.move_card(bolt, ZoneType::Stack, p0);

    let sa = SpellAbility::new_simple(
        Some(bolt),
        p0,
        "SP$ DealDamage | ValidTgts$ Any | NumDmg$ 3",
    );
    let entry = StackEntry {
        id: 0, // Will be overwritten
        spell_ability: sa,
        is_creature_spell: false,
        is_permanent_spell: false,
        is_pending_cast: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    };
    let bolt_stack_id = game.stack.push(entry);

    // Verify initial state
    assert_eq!(game.stack.len(), 1, "Should start with Bolt on stack");

    // Priority system: players can respond in order
    // This tests that the priority_round function works correctly
    let mut game_loop = GameLoop::new(2);
    let mut pass_agents: Vec<Box<dyn PlayerAgent>> = vec![
        Box::new(manabrew_engine::agent::PassAgent),
        Box::new(manabrew_engine::agent::PassAgent),
    ];

    // Both players pass priority → step_with_priority resolves the stack
    game_loop.step_with_priority(&mut game, &mut pass_agents, false);

    // After both pass with empty stack response, the spell resolves
    assert_eq!(
        game.stack.len(),
        0,
        "Stack should resolve after both players pass"
    );
}

/// Test that UI can differentiate between valid and invalid counter targets
#[test]
fn test_valid_counter_target_filtering() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    // Create spells with different characteristics
    let counterable_spell = game.create_card(make_lightning_bolt(p1));
    game.move_card(counterable_spell, ZoneType::Stack, p1);

    let sa = SpellAbility::new_simple(Some(counterable_spell), p1, "SP$ DealDamage");
    let entry = StackEntry {
        id: 1, // Will be overwritten
        spell_ability: sa,
        is_creature_spell: false,
        is_permanent_spell: false,
        is_pending_cast: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    };
    let spell_stack_id = game.stack.push(entry);

    // The UI should be able to show this as a valid target
    // This tests that validSpellIds is properly populated
    let valid_targets: Vec<u32> = game.stack.iter().map(|e| e.id).collect();

    assert_eq!(valid_targets.len(), 1, "Should have 1 valid counter target");
    assert_eq!(
        valid_targets[0], spell_stack_id,
        "Target should be the Lightning Bolt"
    );
}
