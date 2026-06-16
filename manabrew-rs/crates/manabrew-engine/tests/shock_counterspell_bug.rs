use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};
/// Reproduces the bug: Counterspell resolves but Shock still deals damage
/// This should NOT happen - countered spells should never resolve
use manabrew_engine::agent::{PlayOption, PlayerAgent, TargetChoice};
use manabrew_engine::card::CardInstance;
use manabrew_engine::combat::DefenderId;
use manabrew_engine::game::GameState;
use manabrew_engine::game_loop::GameLoop;
use manabrew_engine::ids::{CardId, PlayerId};
use manabrew_engine::player::actions::PlayerAction;
use manabrew_engine::spellability::{SpellAbility, StackEntry};
use std::cell::RefCell;
use std::rc::Rc;

/// Agent that casts Shock (Bob) or Counterspell (Alice)
struct ShockTestAgent {
    step: usize,
    is_alice: bool,
    game_state: Rc<RefCell<GameState>>,
}

impl ShockTestAgent {
    fn new(is_alice: bool, game_state: Rc<RefCell<GameState>>) -> Self {
        ShockTestAgent {
            step: 0,
            is_alice,
            game_state,
        }
    }
}

impl PlayerAgent for ShockTestAgent {
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

        let game = self.game_state.borrow();

        if self.is_alice {
            // Alice: Cast Counterspell to counter Shock
            match self.step {
                1 => {
                    if let Some(&opt) = playable.iter().find(|opt| {
                        let card = game.card(opt.card_id);
                        card.card_name == "Counterspell"
                    }) {
                        PlayerAction::CastSpell(opt)
                    } else {
                        PlayerAction::PassPriority
                    }
                }
                _ => PlayerAction::PassPriority,
            }
        } else {
            // Bob: Cast Shock at Alice
            match self.step {
                1 => {
                    if let Some(&opt) = playable.iter().find(|opt| {
                        let card = game.card(opt.card_id);
                        card.card_name == "Shock"
                    }) {
                        PlayerAction::CastSpell(opt)
                    } else {
                        PlayerAction::PassPriority
                    }
                }
                _ => PlayerAction::PassPriority,
            }
        }
    }

    fn choose_target_spell(
        &mut self,
        _player: PlayerId,
        valid: &[u32],
        _source: Option<CardId>,
    ) -> Option<u32> {
        // Target the first valid spell (should be Shock)
        valid.first().copied()
    }

    fn choose_target_player(
        &mut self,
        _player: PlayerId,
        valid: &[PlayerId],
        _sa: Option<&manabrew_engine::spellability::SpellAbility>,
    ) -> Option<PlayerId> {
        // Shock targets opponent
        valid.iter().find(|&&p| p != _player).copied()
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

    fn notify(&mut self, _message: manabrew_engine::agent::notification::GameNotification) {
        println!(
            "[{}] {}",
            if self.is_alice { "Alice" } else { "Bob" },
            format!("{:?}", _message)
        );
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

fn make_shock(owner: PlayerId) -> CardInstance {
    CardInstance::new(
        CardId(0),
        "Shock".to_string(),
        owner,
        CardTypeLine::parse("Instant"),
        ManaCost::parse("R"),
        ColorSet::RED,
        None,
        None,
        vec![],
        vec!["SP$ DealDamage | ValidTgts$ Any | NumDmg$ 2 | SpellDescription$ CARDNAME deals 2 damage to any target.".to_string()],
    )
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

fn make_mountain(owner: PlayerId) -> CardInstance {
    CardInstance::new(
        CardId(0),
        "Mountain".to_string(),
        owner,
        CardTypeLine::parse("Basic Land - Mountain"),
        ManaCost::no_cost(),
        ColorSet::COLORLESS,
        None,
        None,
        vec![],
        vec![],
    )
}

#[test]
fn test_counterspell_should_stop_damage() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0); // Alice
    let p1 = PlayerId(1); // Bob

    // Setup Alice: 2 Islands + Counterspell in hand
    let island1 = game.create_card(make_island(p0));
    let island2 = game.create_card(make_island(p0));
    let counterspell = game.create_card(make_counterspell(p0));

    game.move_card(island1, ZoneType::Battlefield, p0);
    game.move_card(island2, ZoneType::Battlefield, p0);
    game.move_card(counterspell, ZoneType::Hand, p0);

    // Setup Bob: Mountain + Shock in hand
    let mountain = game.create_card(make_mountain(p1));
    let shock = game.create_card(make_shock(p1));

    game.move_card(mountain, ZoneType::Battlefield, p1);
    game.move_card(shock, ZoneType::Hand, p1);

    // Initial life totals
    let alice_initial_life = game.player(p0).life;
    let bob_initial_life = game.player(p1).life;
    println!(
        "Initial life - Alice: {}, Bob: {}",
        alice_initial_life, bob_initial_life
    );

    // Create game loop
    let mut game_loop = GameLoop::new(2);

    // Bob's turn: He casts Shock at Alice
    game.turn.active_player = p1;
    game.new_turn_for_player(p1);

    println!("\n=== Bob casts Shock at Alice ===");

    // Bob casts Shock manually for the test
    let shock_card = *game.cards_in_zone(ZoneType::Hand, p1).first().unwrap();
    let mut shock_sa = SpellAbility::new_simple(
        Some(shock_card),
        p1,
        "SP$ DealDamage | ValidTgts$ Any | NumDmg$ 2",
    );
    shock_sa.is_spell = true;
    shock_sa.target_chosen.target_player = Some(p0); // Target Alice

    let shock_entry = StackEntry {
        id: 0, // Will be overwritten
        spell_ability: shock_sa,
        is_creature_spell: false,
        is_permanent_spell: false,
        is_pending_cast: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    };
    let shock_stack_id = game.stack.push(shock_entry);
    println!("Shock placed on stack with ID: {}", shock_stack_id);

    // Verify Shock is on stack
    assert_eq!(game.stack.len(), 1, "Shock should be on stack");

    // Alice gets priority and casts Counterspell
    println!("\n=== Alice casts Counterspell ===");

    let counterspell_card = *game.cards_in_zone(ZoneType::Hand, p0).first().unwrap();
    let mut counterspell_sa = SpellAbility::new_simple(
        Some(counterspell_card),
        p0,
        "SP$ Counter | TargetType$ Spell | ValidTgts$ Card",
    );
    counterspell_sa.is_spell = true;

    // Choose target: the Shock (use its actual stack ID)
    counterspell_sa.target_chosen.target_stack_entry = Some(shock_stack_id);

    // Put Counterspell on stack
    let counter_entry = StackEntry {
        id: 0, // Will be overwritten
        spell_ability: counterspell_sa,
        is_creature_spell: false,
        is_permanent_spell: false,
        is_pending_cast: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    };
    let counter_id = game.stack.push(counter_entry);
    println!("Counterspell placed on stack with ID: {}", counter_id);
    println!("Stack now has {} entries", game.stack.len());

    // Verify Counterspell is targeting Shock
    let counterspell_on_stack = &game
        .stack
        .iter()
        .find(|e| e.id == counter_id)
        .unwrap()
        .spell_ability;
    assert_eq!(
        counterspell_on_stack.target_chosen.target_stack_entry,
        Some(shock_stack_id)
    );

    // Both players pass priority
    let mut pass_agents: Vec<Box<dyn PlayerAgent>> = vec![
        Box::new(manabrew_engine::agent::PassAgent),
        Box::new(manabrew_engine::agent::PassAgent),
    ];

    println!("\n=== Both players pass priority ===");
    println!("Stack before resolution: {} entries", game.stack.len());
    for entry in game.stack.iter() {
        let sa = &entry.spell_ability;
        let name = if let Some(card_id) = sa.source {
            game.card(card_id).card_name.clone()
        } else {
            "Ability".to_string()
        };
        println!("  - {} (ID: {}, is_spell: {})", name, entry.id, sa.is_spell);
    }

    // Both players pass priority → step_with_priority resolves the stack (LIFO: Counterspell first)
    game_loop.step_with_priority(&mut game, &mut pass_agents, false);

    println!("\n=== After stack resolution ===");
    println!("Stack size: {}", game.stack.len());
    for entry in game.stack.iter() {
        let sa = &entry.spell_ability;
        let name = if let Some(card_id) = sa.source {
            game.card(card_id).card_name.clone()
        } else {
            "Ability".to_string()
        };
        println!("  - {} (ID: {})", name, entry.id);
    }

    // Check final life totals
    let alice_final_life = game.player(p0).life;
    let bob_final_life = game.player(p1).life;
    println!(
        "\nFinal life - Alice: {}, Bob: {}",
        alice_final_life, bob_final_life
    );

    // CRITICAL ASSERTION: Alice should NOT have taken damage
    if alice_final_life != alice_initial_life {
        panic!(
            "BUG CONFIRMED: Alice took damage from a countered Shock! Life changed from {} to {}",
            alice_initial_life, alice_final_life
        );
    }

    assert_eq!(alice_final_life, alice_initial_life,
        "BUG: Alice took damage from a countered Shock! Counterspell should have prevented all damage.");

    // Shock should be in Bob's graveyard
    let bob_graveyard = game.zone(ZoneType::Graveyard, p1);
    assert_eq!(bob_graveyard.len(), 1, "Shock should be in Bob's graveyard");
    let graveyard_card = game.card(bob_graveyard.cards[0]);
    assert_eq!(
        graveyard_card.card_name, "Shock",
        "Countered spell should be Shock"
    );

    println!("✓ Test passed: Counterspell successfully prevented Shock damage");
}
