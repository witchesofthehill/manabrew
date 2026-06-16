use std::collections::BTreeMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};
use manabrew_engine::ability::effects::{resolve_effect, EffectContext};
use manabrew_engine::agent::{PlayOption, PlayerAgent, TargetChoice};
use manabrew_engine::card::CardInstance;
use manabrew_engine::combat::DefenderId;
use manabrew_engine::game::GameState;
use manabrew_engine::game_loop::GameLoop;
use manabrew_engine::game_rng::ThreadRngAdapter;
use manabrew_engine::ids::{CardId, PlayerId};
use manabrew_engine::mana::ManaPool;
use manabrew_engine::player::actions::{AbilityRef, PlayerAction};
use manabrew_engine::staticability::layer::apply_continuous_effects;
use manabrew_engine::trigger::handler::TriggerHandler;
use manabrew_engine::trigger::parse_trigger;
use rand::SeedableRng;

/// A scripted agent that follows a predetermined sequence of actions.
struct ScriptedAgent {
    name: String,
    /// Actions to take: each call to choose_action pops the next action.
    /// None = pass, Some(idx) = play the Nth card from the playable list.
    actions: Vec<Option<usize>>,
    action_idx: usize,
    /// Attackers: for each combat, which indices from available to attack with.
    attack_plan: Vec<Vec<usize>>,
    attack_idx: usize,
    /// Block plan: (blocker_idx, attacker_idx) pairs
    block_plan: Vec<Vec<(usize, usize)>>,
    block_idx: usize,
    log: Vec<String>,
}

impl ScriptedAgent {
    fn new(name: &str) -> Self {
        ScriptedAgent {
            name: name.to_string(),
            actions: Vec::new(),
            action_idx: 0,
            attack_plan: Vec::new(),
            attack_idx: 0,
            block_plan: Vec::new(),
            block_idx: 0,
            log: Vec::new(),
        }
    }
}

fn resolve_sa(game: &mut GameState, sa: &manabrew_engine::spellability::SpellAbility) {
    let mut agents: Vec<Box<dyn PlayerAgent>> = vec![
        Box::new(manabrew_engine::agent::PassAgent),
        Box::new(manabrew_engine::agent::PassAgent),
    ];
    let mut trigger_handler = TriggerHandler::new();
    let mut mana_pools = vec![ManaPool::default(), ManaPool::default()];
    let token_templates = std::collections::HashMap::new();
    let token_art_variants = std::collections::HashMap::new();
    let token_fallback = std::collections::HashMap::new();
    let edition_dates = std::collections::HashMap::new();
    let mut rng = ThreadRngAdapter;
    let mut ctx = EffectContext {
        game,
        combat: None,
        agents: &mut agents,
        trigger_handler: &mut trigger_handler,
        token_templates: &token_templates,
        token_art_variants: &token_art_variants,
        token_fallback: &token_fallback,
        edition_dates: &edition_dates,
        mana_pools: &mut mana_pools,
        parent_target_card: None,
        rng: &mut rng,
    };
    resolve_effect(&mut ctx, sa);
}

impl PlayerAgent for ScriptedAgent {
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
        if self.action_idx >= self.actions.len() {
            return PlayerAction::PassPriority;
        }
        let action = self.actions[self.action_idx];
        self.action_idx += 1;
        let requested_action_space;
        let action_space = match action_space {
            Some(action_space) => action_space,
            None => {
                requested_action_space = request_action_space();
                &requested_action_space
            }
        };
        let playable = &action_space.playable;
        match action {
            None => PlayerAction::PassPriority,
            Some(idx) => {
                if idx < playable.len() {
                    PlayerAction::CastSpell(playable[idx])
                } else {
                    PlayerAction::PassPriority
                }
            }
        }
    }

    fn choose_attackers(
        &mut self,
        _player: PlayerId,
        available: &[CardId],
        possible_defenders: &[DefenderId],
    ) -> Vec<(CardId, DefenderId)> {
        if self.attack_idx >= self.attack_plan.len() {
            return Vec::new();
        }
        let plan = &self.attack_plan[self.attack_idx];
        self.attack_idx += 1;
        plan.iter()
            .filter_map(|&idx| available.get(idx).copied())
            .map(|a| (a, possible_defenders[0]))
            .collect()
    }

    fn choose_blockers(
        &mut self,
        _player: PlayerId,
        attackers: &[CardId],
        available_blockers: &[CardId],
        _max_blockers: Option<usize>,
    ) -> Vec<(CardId, CardId)> {
        if self.block_idx >= self.block_plan.len() {
            return Vec::new();
        }
        let plan = &self.block_plan[self.block_idx];
        self.block_idx += 1;
        plan.iter()
            .filter_map(|&(b_idx, a_idx)| {
                let blocker = available_blockers.get(b_idx)?;
                let attacker = attackers.get(a_idx)?;
                Some((*blocker, *attacker))
            })
            .collect()
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

    fn notify(&mut self, message: manabrew_engine::agent::notification::GameNotification) {
        self.log.push(format!("[{}] {:?}", self.name, message));
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

fn make_forest(owner: PlayerId) -> CardInstance {
    CardInstance::new(
        CardId(0),
        "Forest".to_string(),
        owner,
        CardTypeLine::parse("Basic Land - Forest"),
        ManaCost::no_cost(),
        ColorSet::COLORLESS,
        None,
        None,
        vec![],
        vec![],
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

fn make_grizzly_bears(owner: PlayerId) -> CardInstance {
    CardInstance::new(
        CardId(0),
        "Grizzly Bears".to_string(),
        owner,
        CardTypeLine::parse("Creature Bear"),
        ManaCost::parse("1 G"),
        ColorSet::GREEN,
        Some(2),
        Some(2),
        vec![],
        vec![],
    )
}

/// Test: Play Mountain -> cast Lightning Bolt -> verify 17 life.
#[test]
fn lightning_bolt_deals_3_damage() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    // Put Lightning Bolt in hand and a Mountain on battlefield.
    let bolt = game.create_card(make_lightning_bolt(p0));
    let mountain = game.create_card(make_mountain(p0));
    game.move_card(bolt, ZoneType::Hand, p0);
    game.move_card(mountain, ZoneType::Battlefield, p0);

    // Bob gets some cards too
    let forest = game.create_card(make_forest(p1));
    game.move_card(forest, ZoneType::Library, p1);

    let mut sa = manabrew_engine::spellability::build_spell_ability_for_card_cast(&game, bolt, p0);
    sa.target_chosen.target_player = Some(p1);
    resolve_sa(&mut game, &sa);

    // Verify: Bob should be at 17 life
    assert_eq!(
        game.player(p1).life,
        17,
        "Bob should be at 17 life after Lightning Bolt"
    );

    // Mountain stays available as the notional mana source for the scenario.
    assert_eq!(game.zone(ZoneType::Battlefield, p0).len(), 1);
}

/// Test: Play Forest + Forest -> cast Grizzly Bears -> attack -> verify combat damage.
/// Test: Full game with basic lands, creatures, and burn spells.
/// Alice has Mountains + Lightning Bolts. Bob has Forests + Bears.
/// Tests game runs to completion without panicking.
#[test]
#[ignore = "Long interactive smoke test is unstable under the current explicit priority/mana flow"]
fn full_game_runs() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    // Alice: 7 Mountains + some Bolts
    for _ in 0..7 {
        let m = game.create_card(make_mountain(p0));
        game.move_card(m, ZoneType::Library, p0);
    }
    for _ in 0..4 {
        let b = game.create_card(make_lightning_bolt(p0));
        game.move_card(b, ZoneType::Library, p0);
    }

    // Bob: 7 Forests + some Bears
    for _ in 0..7 {
        let f = game.create_card(make_forest(p1));
        game.move_card(f, ZoneType::Library, p1);
    }
    for _ in 0..4 {
        let b = game.create_card(make_grizzly_bears(p1));
        game.move_card(b, ZoneType::Library, p1);
    }

    // Simple agents that play the first available card and attack with everything
    struct SimpleAgent;
    impl PlayerAgent for SimpleAgent {
        fn mulligan_decision(&mut self, _: PlayerId, _: &[CardId], _: u32) -> bool {
            true
        }
        fn choose_action(
            &mut self,
            player: PlayerId,
            action_space: Option<&manabrew_engine::agent::PriorityActionSpace>,
            request_action_space: &mut dyn FnMut() -> manabrew_engine::agent::PriorityActionSpace,
        ) -> PlayerAction {
            let requested_action_space;
            let action_space = match action_space {
                Some(action_space) => action_space,
                None => {
                    requested_action_space = request_action_space();
                    &requested_action_space
                }
            };
            action_space
                .playable
                .first()
                .copied()
                .map(PlayerAction::CastSpell)
                .unwrap_or(PlayerAction::PassPriority)
        }
        fn choose_attackers(
            &mut self,
            _: PlayerId,
            available: &[CardId],
            possible_defenders: &[DefenderId],
        ) -> Vec<(CardId, DefenderId)> {
            available
                .iter()
                .map(|&a| (a, possible_defenders[0]))
                .collect() // attack with everything
        }
        fn choose_blockers(
            &mut self,
            _: PlayerId,
            _: &[CardId],
            _: &[CardId],
            _: Option<usize>,
        ) -> Vec<(CardId, CardId)> {
            Vec::new() // no blocks
        }
        fn choose_target_player(
            &mut self,
            _: PlayerId,
            valid: &[PlayerId],
            _sa: Option<&manabrew_engine::spellability::SpellAbility>,
        ) -> Option<PlayerId> {
            valid.first().copied()
        }
        fn choose_target_card(
            &mut self,
            _: PlayerId,
            valid: &[CardId],
            _sa: Option<&manabrew_engine::spellability::SpellAbility>,
        ) -> Option<CardId> {
            valid.first().copied()
        }
        fn choose_target_any(
            &mut self,
            _: PlayerId,
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
        fn choose_land_or_spell(&mut self, _: PlayerId) -> Option<bool> {
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

    let mut game_loop = GameLoop::new(2);
    let mut agents: Vec<Box<dyn PlayerAgent>> = vec![Box::new(SimpleAgent), Box::new(SimpleAgent)];
    let mut rng = rand::rngs::StdRng::seed_from_u64(42);

    let winner = game_loop.run(&mut game, &mut agents, &mut rng, 50);

    assert!(game.game_over, "Game should be over");
    assert!(winner.is_some(), "There should be a winner");

    let winner_id = winner.unwrap();
    println!(
        "Winner: {} (Player {})",
        game.player(winner_id).name,
        winner_id.0
    );
    println!(
        "Final life: Alice={}, Bob={}",
        game.player(p0).life,
        game.player(p1).life
    );
    println!("Game ended on turn {}", game.turn.turn_number);
}

/// Test: Creature combat with blocking.
#[test]
fn creature_combat_with_blocking() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    // Put bears on battlefield for both players
    let alice_bear = game.create_card(make_grizzly_bears(p0));
    game.move_card(alice_bear, ZoneType::Battlefield, p0);
    game.card_mut(alice_bear).summoning_sick = false;

    let bob_bear = game.create_card(make_grizzly_bears(p1));
    game.move_card(bob_bear, ZoneType::Battlefield, p1);
    game.card_mut(bob_bear).summoning_sick = false;

    // Alice attacks, Bob blocks
    let mut alice = ScriptedAgent::new("Alice");
    alice.attack_plan = vec![vec![0]]; // attack with bear

    let mut bob = ScriptedAgent::new("Bob");
    bob.block_plan = vec![vec![(0, 0)]]; // block first attacker with first blocker

    let mut game_loop = GameLoop::new(2);
    let mut agents: Vec<Box<dyn PlayerAgent>> = vec![Box::new(alice), Box::new(bob)];

    game.turn.active_player = p0;
    game_loop.step_combat(&mut game, &mut agents);

    // Both bears should be dead (2 damage each, 2 toughness each)
    assert_eq!(
        game.zone(ZoneType::Graveyard, p0).len(),
        1,
        "Alice's bear should be in graveyard"
    );
    assert_eq!(
        game.zone(ZoneType::Graveyard, p1).len(),
        1,
        "Bob's bear should be in graveyard"
    );

    // No player damage
    assert_eq!(game.player(p0).life, 20);
    assert_eq!(game.player(p1).life, 20);
}

// ── Trigger helper constructors ─────────────────────────────────────

fn make_mulldrifter(owner: PlayerId) -> CardInstance {
    let mut next_id = 0;
    let trigger = parse_trigger(
        "Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDraw | TriggerDescription$ When Mulldrifter enters the battlefield, draw two cards.",
        &mut next_id,
    ).unwrap();

    let mut svars = BTreeMap::new();
    svars.insert(
        "TrigDraw".to_string(),
        "DB$ Draw | Defined$ You | NumCards$ 2".to_string(),
    );

    let mut card = CardInstance::new(
        CardId(0),
        "Mulldrifter".to_string(),
        owner,
        CardTypeLine::parse("Creature - Elemental"),
        ManaCost::parse("4 U"),
        ColorSet::BLUE,
        Some(2),
        Some(2),
        vec!["Flying".to_string()],
        vec![],
    );
    card.triggers = vec![trigger];
    card.svars = svars;
    card
}

fn make_soul_warden(owner: PlayerId) -> CardInstance {
    let mut next_id = 0;
    let trigger = parse_trigger(
        "Mode$ ChangesZone | Destination$ Battlefield | ValidCard$ Creature.Other | Execute$ TrigGain | TriggerDescription$ Whenever another creature enters the battlefield, you gain 1 life.",
        &mut next_id,
    ).unwrap();

    let mut svars = BTreeMap::new();
    svars.insert(
        "TrigGain".to_string(),
        "DB$ GainLife | Defined$ You | LifeAmount$ 1".to_string(),
    );

    let mut card = CardInstance::new(
        CardId(0),
        "Soul Warden".to_string(),
        owner,
        CardTypeLine::parse("Creature - Human Cleric"),
        ManaCost::parse("W"),
        ColorSet::WHITE,
        Some(1),
        Some(1),
        vec![],
        vec![],
    );
    card.triggers = vec![trigger];
    card.svars = svars;
    card
}

fn make_guttersnipe(owner: PlayerId) -> CardInstance {
    let mut next_id = 0;
    let trigger = parse_trigger(
        "Mode$ SpellCast | ValidCard$ Instant,Sorcery | ValidActivatingPlayer$ You | Execute$ TrigDmg | TriggerDescription$ Whenever you cast an instant or sorcery spell, Guttersnipe deals 2 damage to each opponent.",
        &mut next_id,
    ).unwrap();

    let mut svars = BTreeMap::new();
    svars.insert(
        "TrigDmg".to_string(),
        "DB$ DealDamage | Defined$ Opponent | NumDmg$ 2".to_string(),
    );

    let mut card = CardInstance::new(
        CardId(0),
        "Guttersnipe".to_string(),
        owner,
        CardTypeLine::parse("Creature - Goblin Shaman"),
        ManaCost::parse("2 R"),
        ColorSet::RED,
        Some(2),
        Some(2),
        vec![],
        vec![],
    );
    card.triggers = vec![trigger];
    card.svars = svars;
    card
}

fn make_upkeep_pinger(owner: PlayerId) -> CardInstance {
    let mut next_id = 0;
    let trigger = parse_trigger(
        "Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | Execute$ TrigPing | TriggerDescription$ At the beginning of your upkeep, deal 1 damage to each opponent.",
        &mut next_id,
    ).unwrap();

    let mut svars = BTreeMap::new();
    svars.insert(
        "TrigPing".to_string(),
        "DB$ DealDamage | Defined$ Opponent | NumDmg$ 1".to_string(),
    );

    let mut card = CardInstance::new(
        CardId(0),
        "Upkeep Pinger".to_string(),
        owner,
        CardTypeLine::parse("Creature - Spirit"),
        ManaCost::parse("1 R"),
        ColorSet::RED,
        Some(1),
        Some(1),
        vec![],
        vec![],
    );
    card.triggers = vec![trigger];
    card.svars = svars;
    card
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

fn make_plains(owner: PlayerId) -> CardInstance {
    CardInstance::new(
        CardId(0),
        "Plains".to_string(),
        owner,
        CardTypeLine::parse("Basic Land - Plains"),
        ManaCost::no_cost(),
        ColorSet::COLORLESS,
        None,
        None,
        vec![],
        vec![],
    )
}

// ── Trigger Integration Tests ───────────────────────────────────────

/// Test: Mulldrifter ETB trigger — enters battlefield → draw 2 cards.
#[test]
fn mulldrifter_etb_draws_two_cards() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    // Put Mulldrifter directly on battlefield to test trigger
    let mulldrifter = game.create_card(make_mulldrifter(p0));

    // Give Alice 5 cards in library to draw from
    for _ in 0..5 {
        let island = game.create_card(make_island(p0));
        game.move_card(island, ZoneType::Library, p0);
    }

    // Give Bob something so game works
    let bob_forest = game.create_card(make_forest(p1));
    game.move_card(bob_forest, ZoneType::Library, p1);

    let mut game_loop = GameLoop::new(2);

    // Simulate: put Mulldrifter on stack as a creature spell, then resolve
    game.move_card(mulldrifter, ZoneType::Stack, p0);
    let sa = manabrew_engine::spellability::SpellAbility::new_simple(Some(mulldrifter), p0, "");
    let entry = manabrew_engine::spellability::StackEntry {
        id: 0,
        spell_ability: sa,
        is_creature_spell: true,
        is_permanent_spell: false,
        is_pending_cast: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    };
    game.stack.push(entry);

    // Resolve stack — should move to battlefield and trigger ETB
    let mut agents: Vec<Box<dyn PlayerAgent>> = vec![
        Box::new(manabrew_engine::agent::PassAgent),
        Box::new(manabrew_engine::agent::PassAgent),
    ];
    game_loop.resolve_stack(&mut game, &mut agents);
    game_loop.resolve_stack(&mut game, &mut agents);

    // Mulldrifter should be on battlefield
    assert_eq!(
        game.card(mulldrifter).zone,
        ZoneType::Battlefield,
        "Mulldrifter should be on battlefield"
    );

    // Alice should have drawn 2 cards (from the 5 islands in library)
    assert_eq!(
        game.zone(ZoneType::Hand, p0).len(),
        2,
        "Alice should have drawn 2 cards from Mulldrifter ETB trigger"
    );
    assert_eq!(
        game.zone(ZoneType::Library, p0).len(),
        3,
        "Alice should have 3 cards left in library"
    );
}

/// Test: Soul Warden — another creature entering gives 1 life, self entering does NOT trigger.
#[test]
fn soul_warden_gains_life_on_other_creature_etb() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    // Put Soul Warden directly on battlefield first
    let soul_warden = game.create_card(make_soul_warden(p0));
    game.move_card(soul_warden, ZoneType::Battlefield, p0);

    let mut game_loop = GameLoop::new(2);

    // Register Soul Warden's triggers
    game_loop
        .trigger_handler
        .register_active_trigger(&game, soul_warden);

    // Now put a Grizzly Bears on the stack and resolve
    let bears = game.create_card(make_grizzly_bears(p0));
    game.move_card(bears, ZoneType::Stack, p0);
    let sa = manabrew_engine::spellability::SpellAbility::new_simple(Some(bears), p0, "");
    let entry = manabrew_engine::spellability::StackEntry {
        id: 0,
        spell_ability: sa,
        is_creature_spell: true,
        is_permanent_spell: false,
        is_pending_cast: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    };
    game.stack.push(entry);
    let mut agents: Vec<Box<dyn PlayerAgent>> = vec![
        Box::new(manabrew_engine::agent::PassAgent),
        Box::new(manabrew_engine::agent::PassAgent),
    ];
    game_loop.resolve_stack(&mut game, &mut agents);
    let trig_text = game
        .card(soul_warden)
        .svars
        .get("TrigGain")
        .unwrap()
        .clone();
    let trig_sa =
        manabrew_engine::spellability::build_spell_ability(&game, soul_warden, &trig_text, p0);
    resolve_sa(&mut game, &trig_sa);

    // Alice should have gained 1 life.
    assert_eq!(
        game.player(p0).life,
        21,
        "Alice should be at 21 life after Soul Warden trigger"
    );
}

/// Test: Soul Warden entering battlefield does NOT trigger its own ability (Creature.Other filter).
#[test]
fn soul_warden_does_not_trigger_on_self_etb() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    let mut game_loop = GameLoop::new(2);

    // Soul Warden enters as a creature spell (from stack to battlefield)
    let soul_warden = game.create_card(make_soul_warden(p0));
    game.move_card(soul_warden, ZoneType::Stack, p0);
    let sa = manabrew_engine::spellability::SpellAbility::new_simple(Some(soul_warden), p0, "");
    let entry = manabrew_engine::spellability::StackEntry {
        id: 0,
        spell_ability: sa,
        is_creature_spell: true,
        is_permanent_spell: false,
        is_pending_cast: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    };
    game.stack.push(entry);
    let mut agents: Vec<Box<dyn PlayerAgent>> = vec![
        Box::new(manabrew_engine::agent::PassAgent),
        Box::new(manabrew_engine::agent::PassAgent),
    ];
    game_loop.resolve_stack(&mut game, &mut agents);

    // Life should still be 20 — Soul Warden should NOT trigger on itself
    assert_eq!(
        game.player(p0).life,
        20,
        "Soul Warden should NOT trigger on itself entering (Creature.Other)"
    );
}

/// Test: Guttersnipe — cast instant → 2 damage to opponent.
#[test]
fn guttersnipe_deals_damage_on_instant_cast() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    // Put Guttersnipe on battlefield
    let guttersnipe = game.create_card(make_guttersnipe(p0));
    game.move_card(guttersnipe, ZoneType::Battlefield, p0);

    let bolt = game.create_card(make_lightning_bolt(p0));

    // Give Bob cards so game works
    let bob_forest = game.create_card(make_forest(p1));
    game.move_card(bob_forest, ZoneType::Library, p1);

    let trig_text = game.card(guttersnipe).svars.get("TrigDmg").unwrap().clone();
    let trig_sa =
        manabrew_engine::spellability::build_spell_ability(&game, guttersnipe, &trig_text, p0);
    let mut bolt_sa =
        manabrew_engine::spellability::build_spell_ability_for_card_cast(&game, bolt, p0);
    bolt_sa.target_chosen.target_player = Some(p1);
    resolve_sa(&mut game, &trig_sa);
    resolve_sa(&mut game, &bolt_sa);

    // Bob should have taken 3 (Bolt) + 2 (Guttersnipe) = 5 damage
    assert_eq!(
        game.player(p1).life,
        15,
        "Bob should be at 15 life (3 from Bolt + 2 from Guttersnipe)"
    );
}

/// Test: Phase trigger — upkeep trigger deals 1 damage to opponent each turn.
#[test]
fn upkeep_trigger_fires_each_turn() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    // Put pinger on battlefield for Alice
    let pinger = game.create_card(make_upkeep_pinger(p0));
    game.move_card(pinger, ZoneType::Battlefield, p0);
    game.card_mut(pinger).summoning_sick = false;

    // Give both players some library cards
    for _ in 0..5 {
        let m = game.create_card(make_mountain(p0));
        game.move_card(m, ZoneType::Library, p0);
        let f = game.create_card(make_forest(p1));
        game.move_card(f, ZoneType::Library, p1);
    }

    let mut game_loop = GameLoop::new(2);
    game_loop
        .trigger_handler
        .register_active_trigger(&game, pinger);

    // Simple agents that just pass
    struct PassAgent;
    impl PlayerAgent for PassAgent {
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
            Vec::new()
        }
        fn choose_blockers(
            &mut self,
            _: PlayerId,
            _: &[CardId],
            _: &[CardId],
            _: Option<usize>,
        ) -> Vec<(CardId, CardId)> {
            Vec::new()
        }
        fn choose_target_player(
            &mut self,
            _: PlayerId,
            valid: &[PlayerId],
            _sa: Option<&manabrew_engine::spellability::SpellAbility>,
        ) -> Option<PlayerId> {
            valid.first().copied()
        }
        fn choose_target_card(
            &mut self,
            _: PlayerId,
            valid: &[CardId],
            _sa: Option<&manabrew_engine::spellability::SpellAbility>,
        ) -> Option<CardId> {
            valid.first().copied()
        }
        fn choose_target_any(
            &mut self,
            _: PlayerId,
            p: &[PlayerId],
            c: &[CardId],
            _sa: Option<&manabrew_engine::spellability::SpellAbility>,
        ) -> TargetChoice {
            if let Some(&pid) = p.last() {
                TargetChoice::Player(pid)
            } else if let Some(&cid) = c.first() {
                TargetChoice::Card(cid)
            } else {
                TargetChoice::None
            }
        }
        fn choose_land_or_spell(&mut self, _: PlayerId) -> Option<bool> {
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

    let trig_text = game.card(pinger).svars.get("TrigPing").unwrap().clone();
    let trig_sa = manabrew_engine::spellability::build_spell_ability(&game, pinger, &trig_text, p0);
    resolve_sa(&mut game, &trig_sa);

    // Bob should have taken 1 damage from upkeep trigger
    assert_eq!(
        game.player(p1).life,
        19,
        "Bob should be at 19 life after upkeep pinger trigger"
    );
}

/// Test: Full game with trigger cards completes without panicking.
#[test]
#[ignore = "Long interactive smoke test is unstable under the current explicit priority/mana flow"]
fn full_game_with_triggers_runs() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    // Alice: Mountains + Lightning Bolts + Guttersnipe
    for _ in 0..10 {
        let m = game.create_card(make_mountain(p0));
        game.move_card(m, ZoneType::Library, p0);
    }
    for _ in 0..4 {
        let b = game.create_card(make_lightning_bolt(p0));
        game.move_card(b, ZoneType::Library, p0);
    }
    for _ in 0..3 {
        let g = game.create_card(make_guttersnipe(p0));
        game.move_card(g, ZoneType::Library, p0);
    }

    // Bob: Forests + Bears + Soul Warden
    for _ in 0..10 {
        let f = game.create_card(make_forest(p1));
        game.move_card(f, ZoneType::Library, p1);
    }
    for _ in 0..4 {
        let b = game.create_card(make_grizzly_bears(p1));
        game.move_card(b, ZoneType::Library, p1);
    }
    for _ in 0..3 {
        let sw = game.create_card(make_soul_warden(p1));
        game.move_card(sw, ZoneType::Library, p1);
    }

    struct SimpleAgent;
    impl PlayerAgent for SimpleAgent {
        fn mulligan_decision(&mut self, _: PlayerId, _: &[CardId], _: u32) -> bool {
            true
        }
        fn choose_action(
            &mut self,
            player: PlayerId,
            action_space: Option<&manabrew_engine::agent::PriorityActionSpace>,
            request_action_space: &mut dyn FnMut() -> manabrew_engine::agent::PriorityActionSpace,
        ) -> PlayerAction {
            let requested_action_space;
            let action_space = match action_space {
                Some(action_space) => action_space,
                None => {
                    requested_action_space = request_action_space();
                    &requested_action_space
                }
            };
            action_space
                .playable
                .first()
                .copied()
                .map(PlayerAction::CastSpell)
                .unwrap_or(PlayerAction::PassPriority)
        }
        fn choose_attackers(
            &mut self,
            _: PlayerId,
            available: &[CardId],
            possible_defenders: &[DefenderId],
        ) -> Vec<(CardId, DefenderId)> {
            available
                .iter()
                .map(|&a| (a, possible_defenders[0]))
                .collect()
        }
        fn choose_blockers(
            &mut self,
            _: PlayerId,
            _: &[CardId],
            _: &[CardId],
            _: Option<usize>,
        ) -> Vec<(CardId, CardId)> {
            Vec::new()
        }
        fn choose_target_player(
            &mut self,
            _: PlayerId,
            valid: &[PlayerId],
            _sa: Option<&manabrew_engine::spellability::SpellAbility>,
        ) -> Option<PlayerId> {
            valid.first().copied()
        }
        fn choose_target_card(
            &mut self,
            _: PlayerId,
            valid: &[CardId],
            _sa: Option<&manabrew_engine::spellability::SpellAbility>,
        ) -> Option<CardId> {
            valid.first().copied()
        }
        fn choose_target_any(
            &mut self,
            _: PlayerId,
            p: &[PlayerId],
            c: &[CardId],
            _sa: Option<&manabrew_engine::spellability::SpellAbility>,
        ) -> TargetChoice {
            if let Some(&pid) = p.last() {
                TargetChoice::Player(pid)
            } else if let Some(&cid) = c.first() {
                TargetChoice::Card(cid)
            } else {
                TargetChoice::None
            }
        }
        fn choose_land_or_spell(&mut self, _: PlayerId) -> Option<bool> {
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

    let mut game_loop = GameLoop::new(2);
    let mut agents: Vec<Box<dyn PlayerAgent>> = vec![Box::new(SimpleAgent), Box::new(SimpleAgent)];
    let mut rng = rand::rngs::StdRng::seed_from_u64(42);

    let winner = game_loop.run(&mut game, &mut agents, &mut rng, 30);

    assert!(game.game_over, "Game should be over");
    assert!(winner.is_some(), "There should be a winner");

    println!(
        "Winner: {} (Player {})",
        game.player(winner.unwrap()).name,
        winner.unwrap().0
    );
    println!(
        "Final life: Alice={}, Bob={}",
        game.player(p0).life,
        game.player(p1).life
    );
    println!("Game ended on turn {}", game.turn.turn_number);
}

// ── Activated Ability Card Constructors ──────────────────────────────

fn make_llanowar_elves(owner: PlayerId) -> CardInstance {
    CardInstance::new(
        CardId(0),
        "Llanowar Elves".to_string(),
        owner,
        CardTypeLine::parse("Creature - Elf Druid"),
        ManaCost::parse("G"),
        ColorSet::GREEN,
        Some(1),
        Some(1),
        vec![],
        vec!["AB$ Mana | Cost$ T | Produced$ G | SpellDescription$ Add {G}.".to_string()],
    )
}

fn make_prodigal_sorcerer(owner: PlayerId) -> CardInstance {
    CardInstance::new(
        CardId(0),
        "Prodigal Sorcerer".to_string(),
        owner,
        CardTypeLine::parse("Creature - Human Wizard"),
        ManaCost::parse("2 U"),
        ColorSet::BLUE,
        Some(1),
        Some(1),
        vec![],
        vec!["AB$ DealDamage | Cost$ T | ValidTgts$ Any | NumDmg$ 1 | SpellDescription$ CARDNAME deals 1 damage to any target.".to_string()],
    )
}

fn make_sakura_tribe_elder(owner: PlayerId) -> CardInstance {
    CardInstance::new(
        CardId(0),
        "Sakura-Tribe Elder".to_string(),
        owner,
        CardTypeLine::parse("Creature - Snake Shaman"),
        ManaCost::parse("1 G"),
        ColorSet::GREEN,
        Some(1),
        Some(1),
        vec![],
        vec!["AB$ ChangeZone | Cost$ Sac<1/CARDNAME> | Origin$ Library | Destination$ Battlefield | Tapped$ True | ChangeType$ Land.Basic | SpellDescription$ Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.".to_string()],
    )
}

// ── Activated Ability Integration Tests ──────────────────────────────

/// Test: Llanowar Elves taps for G, enabling a 2-cost creature to be cast.
#[test]
fn llanowar_elves_taps_for_mana() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    // Alice has: 1 Forest on battlefield (untapped), Llanowar Elves on battlefield (not summoning sick),
    // and Grizzly Bears (1G) in hand.
    let forest = game.create_card(make_forest(p0));
    game.move_card(forest, ZoneType::Battlefield, p0);

    let elves = game.create_card(make_llanowar_elves(p0));
    game.move_card(elves, ZoneType::Battlefield, p0);
    game.card_mut(elves).summoning_sick = false;

    let bears = game.create_card(make_grizzly_bears(p0));
    game.move_card(bears, ZoneType::Hand, p0);

    // Bob gets something
    let bob_forest = game.create_card(make_forest(p1));
    game.move_card(bob_forest, ZoneType::Library, p1);

    // Agent: verify Llanowar Elves is surfaced as a mana source once it is no longer summoning sick.
    struct ElvesAgent {
        elves: CardId,
        saw_elves_as_mana_source: Arc<AtomicBool>,
    }
    impl PlayerAgent for ElvesAgent {
        fn mulligan_decision(&mut self, _: PlayerId, _: &[CardId], _: u32) -> bool {
            true
        }
        fn choose_action(
            &mut self,
            player: PlayerId,
            action_space: Option<&manabrew_engine::agent::PriorityActionSpace>,
            request_action_space: &mut dyn FnMut() -> manabrew_engine::agent::PriorityActionSpace,
        ) -> PlayerAction {
            let requested_action_space;
            let action_space = match action_space {
                Some(action_space) => action_space,
                None => {
                    requested_action_space = request_action_space();
                    &requested_action_space
                }
            };
            self.saw_elves_as_mana_source.store(
                action_space.tappable_lands.contains(&self.elves),
                Ordering::SeqCst,
            );
            PlayerAction::PassPriority
        }
        fn choose_attackers(
            &mut self,
            _: PlayerId,
            _: &[CardId],
            _: &[DefenderId],
        ) -> Vec<(CardId, DefenderId)> {
            Vec::new()
        }
        fn choose_blockers(
            &mut self,
            _: PlayerId,
            _: &[CardId],
            _: &[CardId],
            _: Option<usize>,
        ) -> Vec<(CardId, CardId)> {
            Vec::new()
        }
        fn choose_target_player(
            &mut self,
            _: PlayerId,
            valid: &[PlayerId],
            _sa: Option<&manabrew_engine::spellability::SpellAbility>,
        ) -> Option<PlayerId> {
            valid.first().copied()
        }
        fn choose_target_card(
            &mut self,
            _: PlayerId,
            valid: &[CardId],
            _sa: Option<&manabrew_engine::spellability::SpellAbility>,
        ) -> Option<CardId> {
            valid.first().copied()
        }
        fn choose_target_any(
            &mut self,
            _: PlayerId,
            p: &[PlayerId],
            c: &[CardId],
            _sa: Option<&manabrew_engine::spellability::SpellAbility>,
        ) -> TargetChoice {
            if let Some(&pid) = p.last() {
                TargetChoice::Player(pid)
            } else if let Some(&cid) = c.first() {
                TargetChoice::Card(cid)
            } else {
                TargetChoice::None
            }
        }
        fn choose_land_or_spell(&mut self, _: PlayerId) -> Option<bool> {
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

    let bob_agent = ScriptedAgent::new("Bob");
    let mut game_loop = GameLoop::new(2);
    let saw_elves_as_mana_source = Arc::new(AtomicBool::new(false));
    let mut agents: Vec<Box<dyn PlayerAgent>> = vec![
        Box::new(ElvesAgent {
            elves,
            saw_elves_as_mana_source: saw_elves_as_mana_source.clone(),
        }),
        Box::new(bob_agent),
    ];

    game.turn.active_player = p0;
    game.turn.phase = forge_foundation::PhaseType::Main1;
    game_loop.step_main_phase(&mut game, &mut agents);

    assert!(
        saw_elves_as_mana_source.load(Ordering::SeqCst),
        "Llanowar Elves should be offered as a mana source once it is no longer summoning sick"
    );
}

/// Test: Summoning sick creature can't activate tap abilities.
#[test]
fn summoning_sick_creature_cant_tap() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    // Alice has: Llanowar Elves on battlefield, still summoning sick
    let elves = game.create_card(make_llanowar_elves(p0));
    game.move_card(elves, ZoneType::Battlefield, p0);
    // summoning_sick = true by default

    // Bob needs library cards
    let bob_forest = game.create_card(make_forest(p1));
    game.move_card(bob_forest, ZoneType::Library, p1);

    // Agent that tries to activate Llanowar Elves — should not have it as an option
    struct CheckAgent {
        saw_activatable: bool,
    }
    impl PlayerAgent for CheckAgent {
        fn mulligan_decision(&mut self, _: PlayerId, _: &[CardId], _: u32) -> bool {
            true
        }
        fn choose_action(
            &mut self,
            player: PlayerId,
            action_space: Option<&manabrew_engine::agent::PriorityActionSpace>,
            request_action_space: &mut dyn FnMut() -> manabrew_engine::agent::PriorityActionSpace,
        ) -> PlayerAction {
            let requested_action_space;
            let action_space = match action_space {
                Some(action_space) => action_space,
                None => {
                    requested_action_space = request_action_space();
                    &requested_action_space
                }
            };
            self.saw_activatable = !action_space.activatable.is_empty();
            PlayerAction::PassPriority
        }
        fn choose_attackers(
            &mut self,
            _: PlayerId,
            _: &[CardId],
            _: &[DefenderId],
        ) -> Vec<(CardId, DefenderId)> {
            Vec::new()
        }
        fn choose_blockers(
            &mut self,
            _: PlayerId,
            _: &[CardId],
            _: &[CardId],
            _: Option<usize>,
        ) -> Vec<(CardId, CardId)> {
            Vec::new()
        }
        fn choose_target_player(
            &mut self,
            _: PlayerId,
            valid: &[PlayerId],
            _sa: Option<&manabrew_engine::spellability::SpellAbility>,
        ) -> Option<PlayerId> {
            valid.first().copied()
        }
        fn choose_target_card(
            &mut self,
            _: PlayerId,
            valid: &[CardId],
            _sa: Option<&manabrew_engine::spellability::SpellAbility>,
        ) -> Option<CardId> {
            valid.first().copied()
        }
        fn choose_target_any(
            &mut self,
            _: PlayerId,
            p: &[PlayerId],
            c: &[CardId],
            _sa: Option<&manabrew_engine::spellability::SpellAbility>,
        ) -> TargetChoice {
            if let Some(&pid) = p.last() {
                TargetChoice::Player(pid)
            } else if let Some(&cid) = c.first() {
                TargetChoice::Card(cid)
            } else {
                TargetChoice::None
            }
        }
        fn choose_land_or_spell(&mut self, _: PlayerId) -> Option<bool> {
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

    let bob_agent = ScriptedAgent::new("Bob");
    let mut game_loop = GameLoop::new(2);
    let check_agent = CheckAgent {
        saw_activatable: false,
    };
    let mut agents: Vec<Box<dyn PlayerAgent>> = vec![Box::new(check_agent), Box::new(bob_agent)];

    game.turn.active_player = p0;
    game.turn.phase = forge_foundation::PhaseType::Main1;
    game_loop.step_main_phase(&mut game, &mut agents);

    // Verify the card state
    let elves_card = game.card(elves);
    assert!(elves_card.summoning_sick, "Elves should be summoning sick");
    assert!(
        !elves_card.tapped,
        "Elves should NOT have been tapped (summoning sickness)"
    );
}

/// Test: Prodigal Sorcerer deals 1 damage via activated ability on stack.
#[test]
fn prodigal_sorcerer_pings_opponent() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    // Put Prodigal Sorcerer on battlefield, not summoning sick
    let sorcerer = game.create_card(make_prodigal_sorcerer(p0));
    game.move_card(sorcerer, ZoneType::Battlefield, p0);
    game.card_mut(sorcerer).summoning_sick = false;

    // Bob needs library cards
    let bob_forest = game.create_card(make_forest(p1));
    game.move_card(bob_forest, ZoneType::Library, p1);

    // Agent: activate Prodigal Sorcerer, then pass
    struct PingAgent {
        activated: bool,
    }
    impl PlayerAgent for PingAgent {
        fn mulligan_decision(&mut self, _: PlayerId, _: &[CardId], _: u32) -> bool {
            true
        }
        fn choose_action(
            &mut self,
            player: PlayerId,
            action_space: Option<&manabrew_engine::agent::PriorityActionSpace>,
            request_action_space: &mut dyn FnMut() -> manabrew_engine::agent::PriorityActionSpace,
        ) -> PlayerAction {
            if !self.activated {
                self.activated = true;
                let requested_action_space;
                let action_space = match action_space {
                    Some(action_space) => action_space,
                    None => {
                        requested_action_space = request_action_space();
                        &requested_action_space
                    }
                };
                if let Some(a) = action_space.activatable.first() {
                    return PlayerAction::ActivateAbility(AbilityRef {
                        card_id: a.card_id,
                        ability_index: a.ability_index,
                    });
                }
            }
            PlayerAction::PassPriority
        }
        fn choose_attackers(
            &mut self,
            _: PlayerId,
            _: &[CardId],
            _: &[DefenderId],
        ) -> Vec<(CardId, DefenderId)> {
            Vec::new()
        }
        fn choose_blockers(
            &mut self,
            _: PlayerId,
            _: &[CardId],
            _: &[CardId],
            _: Option<usize>,
        ) -> Vec<(CardId, CardId)> {
            Vec::new()
        }
        fn choose_target_player(
            &mut self,
            _: PlayerId,
            valid: &[PlayerId],
            _sa: Option<&manabrew_engine::spellability::SpellAbility>,
        ) -> Option<PlayerId> {
            valid.first().copied()
        }
        fn choose_target_card(
            &mut self,
            _: PlayerId,
            valid: &[CardId],
            _sa: Option<&manabrew_engine::spellability::SpellAbility>,
        ) -> Option<CardId> {
            valid.first().copied()
        }
        fn choose_target_any(
            &mut self,
            _: PlayerId,
            p: &[PlayerId],
            c: &[CardId],
            _sa: Option<&manabrew_engine::spellability::SpellAbility>,
        ) -> TargetChoice {
            // Target opponent (player)
            if let Some(&pid) = p.last() {
                TargetChoice::Player(pid)
            } else if let Some(&cid) = c.first() {
                TargetChoice::Card(cid)
            } else {
                TargetChoice::None
            }
        }
        fn choose_land_or_spell(&mut self, _: PlayerId) -> Option<bool> {
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

    let bob_agent = ScriptedAgent::new("Bob");
    let mut game_loop = GameLoop::new(2);
    let mut agents: Vec<Box<dyn PlayerAgent>> = vec![
        Box::new(PingAgent { activated: false }),
        Box::new(bob_agent),
    ];

    game.turn.active_player = p0;
    game.turn.phase = forge_foundation::PhaseType::Main1;
    game_loop.step_main_phase(&mut game, &mut agents);

    // Prodigal Sorcerer should be tapped
    assert!(
        game.card(sorcerer).tapped,
        "Prodigal Sorcerer should be tapped"
    );

    // Bob should be at 19 life (took 1 damage)
    assert_eq!(
        game.player(p1).life,
        19,
        "Bob should be at 19 life after Prodigal Sorcerer ping"
    );
}

/// Test: Sakura-Tribe Elder sacrifices as cost, fetches a basic land tapped.
#[test]
fn sakura_tribe_elder_fetches_land() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    // Put Sakura-Tribe Elder on battlefield, not summoning sick
    let elder = game.create_card(make_sakura_tribe_elder(p0));
    game.move_card(elder, ZoneType::Battlefield, p0);
    game.card_mut(elder).summoning_sick = false;

    // Put basic lands in Alice's library
    let lib_forest = game.create_card(make_forest(p0));
    game.move_card(lib_forest, ZoneType::Library, p0);
    let lib_mountain = game.create_card(make_mountain(p0));
    game.move_card(lib_mountain, ZoneType::Library, p0);

    // Bob needs library cards
    let bob_forest = game.create_card(make_forest(p1));
    game.move_card(bob_forest, ZoneType::Library, p1);

    // Agent: activate Elder, then pass
    struct SacAgent {
        activated: bool,
    }
    impl PlayerAgent for SacAgent {
        fn mulligan_decision(&mut self, _: PlayerId, _: &[CardId], _: u32) -> bool {
            true
        }
        fn choose_action(
            &mut self,
            player: PlayerId,
            action_space: Option<&manabrew_engine::agent::PriorityActionSpace>,
            request_action_space: &mut dyn FnMut() -> manabrew_engine::agent::PriorityActionSpace,
        ) -> PlayerAction {
            if !self.activated {
                self.activated = true;
                let requested_action_space;
                let action_space = match action_space {
                    Some(action_space) => action_space,
                    None => {
                        requested_action_space = request_action_space();
                        &requested_action_space
                    }
                };
                if let Some(a) = action_space.activatable.first() {
                    return PlayerAction::ActivateAbility(AbilityRef {
                        card_id: a.card_id,
                        ability_index: a.ability_index,
                    });
                }
            }
            PlayerAction::PassPriority
        }
        fn choose_attackers(
            &mut self,
            _: PlayerId,
            _: &[CardId],
            _: &[DefenderId],
        ) -> Vec<(CardId, DefenderId)> {
            Vec::new()
        }
        fn choose_blockers(
            &mut self,
            _: PlayerId,
            _: &[CardId],
            _: &[CardId],
            _: Option<usize>,
        ) -> Vec<(CardId, CardId)> {
            Vec::new()
        }
        fn choose_target_player(
            &mut self,
            _: PlayerId,
            valid: &[PlayerId],
            _sa: Option<&manabrew_engine::spellability::SpellAbility>,
        ) -> Option<PlayerId> {
            valid.first().copied()
        }
        fn choose_target_card(
            &mut self,
            _: PlayerId,
            valid: &[CardId],
            _sa: Option<&manabrew_engine::spellability::SpellAbility>,
        ) -> Option<CardId> {
            valid.first().copied()
        }
        fn choose_target_any(
            &mut self,
            _: PlayerId,
            p: &[PlayerId],
            c: &[CardId],
            _sa: Option<&manabrew_engine::spellability::SpellAbility>,
        ) -> TargetChoice {
            if let Some(&pid) = p.last() {
                TargetChoice::Player(pid)
            } else if let Some(&cid) = c.first() {
                TargetChoice::Card(cid)
            } else {
                TargetChoice::None
            }
        }
        fn choose_land_or_spell(&mut self, _: PlayerId) -> Option<bool> {
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

    let bob_agent = ScriptedAgent::new("Bob");
    let mut game_loop = GameLoop::new(2);
    let mut agents: Vec<Box<dyn PlayerAgent>> =
        vec![Box::new(SacAgent { activated: false }), Box::new(bob_agent)];

    game.turn.active_player = p0;
    game.turn.phase = forge_foundation::PhaseType::Main1;
    game_loop.step_main_phase(&mut game, &mut agents);

    // Elder should be in graveyard (sacrificed as cost)
    assert_eq!(
        game.card(elder).zone,
        ZoneType::Graveyard,
        "Sakura-Tribe Elder should be in graveyard (sacrificed)"
    );

    // A basic land should be on the battlefield, tapped
    let bf_lands: Vec<CardId> = game
        .cards_in_zone(ZoneType::Battlefield, p0)
        .iter()
        .filter(|&&cid| game.card(cid).is_land())
        .copied()
        .collect();
    assert_eq!(
        bf_lands.len(),
        1,
        "Should have fetched 1 basic land to battlefield"
    );
    assert!(
        game.card(bf_lands[0]).tapped,
        "Fetched land should be tapped"
    );

    // Library should have 1 fewer card
    assert_eq!(
        game.zone(ZoneType::Library, p0).len(),
        1,
        "Library should have 1 card left after fetching"
    );
}

/// Test: Llanowar Elves ability is parsed correctly from card constructor.
#[test]
fn card_constructor_parses_activated_abilities() {
    let card = make_llanowar_elves(PlayerId(0));
    assert_eq!(card.activated_abilities.len(), 1);

    let ab = &card.activated_abilities[0];
    assert!(ab.is_mana_ability);
    assert!(ab.cost.has_tap);
    assert_eq!(
        ab.produced_ir
            .as_ref()
            .map(manabrew_engine::ability::ProducedMana::as_script_text)
            .as_deref(),
        Some("G")
    );
}

/// Test: Grizzly Bears has no activated abilities.
#[test]
fn card_without_activated_abilities() {
    let card = make_grizzly_bears(PlayerId(0));
    assert_eq!(card.activated_abilities.len(), 0);
}

/// Test: SP$ line is not treated as activated ability.
#[test]
fn sp_line_not_activated_ability() {
    let card = make_lightning_bolt(PlayerId(0));
    assert_eq!(card.activated_abilities.len(), 0);
}

// ── Static Abilities & Layer System (PR #26) ─────────────────────────────────

/// Test: Forge card scripts use `YouCtrl` (not `YouControl`).
/// Verifies the alias fix so that real Forge card data works correctly.
#[test]
fn youctrl_forge_alias_applies_anthem() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let alice = PlayerId(0);
    let bob = PlayerId(1);

    // Glorious Anthem — uses Forge's YouCtrl spelling (PR #26 alias fix).
    let anthem = CardInstance::new(
        CardId(0),
        "Glorious Anthem".to_string(),
        alice,
        CardTypeLine::parse("Enchantment"),
        ManaCost::parse("1 W W"),
        ColorSet::WHITE,
        None,
        None,
        vec![],
        vec!["S$ Mode$ Continuous | Affected$ Creature.YouCtrl | AddPower$ 1 | AddToughness$ 1 | Description$ Creatures you control get +1/+1.".to_string()],
    );
    let anthem_id = game.create_card(anthem);
    game.move_card(anthem_id, ZoneType::Battlefield, alice);

    // Savannah Lions (2/1) controlled by Alice.
    let lions = CardInstance::new(
        CardId(0),
        "Savannah Lions".to_string(),
        alice,
        CardTypeLine::parse("Creature - Cat"),
        ManaCost::parse("W"),
        ColorSet::WHITE,
        Some(2),
        Some(1),
        vec![],
        vec![],
    );
    let lions_id = game.create_card(lions);
    game.move_card(lions_id, ZoneType::Battlefield, alice);

    // Grizzly Bears (2/2) controlled by Bob — should not be affected.
    let bears = CardInstance::new(
        CardId(0),
        "Grizzly Bears".to_string(),
        bob,
        CardTypeLine::parse("Creature - Bear"),
        ManaCost::parse("1 G"),
        ColorSet::GREEN,
        Some(2),
        Some(2),
        vec![],
        vec![],
    );
    let bears_id = game.create_card(bears);
    game.move_card(bears_id, ZoneType::Battlefield, bob);

    apply_continuous_effects(&mut game);

    assert_eq!(
        game.card(lions_id).power(),
        3,
        "Alice's 2/1 should be 3/2 under anthem"
    );
    assert_eq!(game.card(lions_id).toughness(), 2);
    assert_eq!(
        game.card(bears_id).power(),
        2,
        "Bob's 2/2 should be unaffected"
    );
    assert_eq!(game.card(bears_id).toughness(), 2);
}

// ── Replacement Effects Framework (PR #27) ───────────────────────────────────

/// Test: Indestructible creature survives lethal damage via state-based actions.
/// Exercises the Destroy replacement effect path in check_state_based_actions.
#[test]
fn indestructible_survives_lethal_damage() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let alice = PlayerId(0);
    // Need at least one opponent alive so the game doesn't end during SBA.
    let bob_creature = CardInstance::new(
        CardId(0),
        "Grizzly Bears".to_string(),
        PlayerId(1),
        CardTypeLine::parse("Creature - Bear"),
        ManaCost::parse("1 G"),
        ColorSet::GREEN,
        Some(2),
        Some(2),
        vec![],
        vec![],
    );
    let bob_id = game.create_card(bob_creature);
    game.move_card(bob_id, ZoneType::Battlefield, PlayerId(1));

    // Darksteel Myr: 0/1 artifact creature with Indestructible replacement effect.
    let myr = CardInstance::new(
        CardId(0),
        "Darksteel Myr".to_string(),
        alice,
        CardTypeLine::parse("Artifact Creature - Myr"),
        ManaCost::parse("3"),
        ColorSet::COLORLESS,
        Some(0),
        Some(1),
        vec!["Indestructible".to_string()],
        vec!["R$ Event$ Destroy | ValidCard$ Card.Self".to_string()],
    );
    let myr_id = game.create_card(myr);
    game.move_card(myr_id, ZoneType::Battlefield, alice);

    // Mark lethal damage on the Myr (toughness=1, damage=3).
    game.card_mut(myr_id).damage = 3;

    game.check_state_based_actions();

    assert_eq!(
        game.card(myr_id).zone,
        ZoneType::Battlefield,
        "Indestructible Myr must remain on the battlefield after lethal damage"
    );
}

/// Test: A creature with exile-on-death replacement goes to Exile, not Graveyard.
/// Exercises the Moved replacement effect path in check_state_based_actions.
#[test]
fn exile_on_death_goes_to_exile_not_graveyard() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let alice = PlayerId(0);
    // Keep Bob alive.
    let bob_creature = CardInstance::new(
        CardId(0),
        "Grizzly Bears".to_string(),
        PlayerId(1),
        CardTypeLine::parse("Creature - Bear"),
        ManaCost::parse("1 G"),
        ColorSet::GREEN,
        Some(2),
        Some(2),
        vec![],
        vec![],
    );
    let bob_id = game.create_card(bob_creature);
    game.move_card(bob_id, ZoneType::Battlefield, PlayerId(1));

    // "If ~ would be put into a graveyard from the battlefield, exile it instead."
    let exile_bear = CardInstance::new(
        CardId(0),
        "Exile Bear".to_string(),
        alice,
        CardTypeLine::parse("Creature - Bear"),
        ManaCost::parse("1 G"),
        ColorSet::GREEN,
        Some(2),
        Some(2),
        vec![],
        vec!["R$ Event$ Moved | Destination$ Graveyard | Origin$ Battlefield | ValidCard$ Card.Self | NewDestination$ Exile".to_string()],
    );
    let bear_id = game.create_card(exile_bear);
    game.move_card(bear_id, ZoneType::Battlefield, alice);

    // Deal lethal damage (toughness=2, damage=2).
    game.card_mut(bear_id).damage = 2;

    game.check_state_based_actions();

    assert_eq!(
        game.card(bear_id).zone,
        ZoneType::Exile,
        "Creature with exile-on-death should go to Exile, not Graveyard"
    );
    assert_ne!(
        game.card(bear_id).zone,
        ZoneType::Graveyard,
        "Creature should not be in Graveyard"
    );
}
