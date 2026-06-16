use forge_carddb::parse_card_script;
use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};
use manabrew_engine::ability::AbilityKey;
/// Integration tests for Token Creation and Copy Effects (Issue #14).
use manabrew_engine::agent::{PassAgent, PlayerAgent};
use manabrew_engine::card::CardInstance;
use manabrew_engine::game::GameState;
use manabrew_engine::game_loop::GameLoop;
use manabrew_engine::ids::{CardId, PlayerId};
use manabrew_engine::mana::ManaPool;
use manabrew_engine::player::actions::PlayerAction;
use manabrew_engine::spellability::{SpellAbility, StackEntry};
use manabrew_engine::trigger::parse_trigger;

// ── Helpers ──────────────────────────────────────────────────────────

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

fn make_goblin_token(owner: PlayerId) -> CardInstance {
    let mut card = CardInstance::new(
        CardId(0),
        "Goblin Token".to_string(),
        owner,
        CardTypeLine::parse("Creature Goblin"),
        ManaCost::no_cost(),
        ColorSet::RED,
        Some(1),
        Some(1),
        vec![],
        vec![],
    );
    card.is_token = true;
    card
}

fn make_soldier_token(owner: PlayerId) -> CardInstance {
    let mut card = CardInstance::new(
        CardId(0),
        "Soldier Token".to_string(),
        owner,
        CardTypeLine::parse("Creature Soldier"),
        ManaCost::no_cost(),
        ColorSet::WHITE,
        Some(1),
        Some(1),
        vec![],
        vec![],
    );
    card.is_token = true;
    card
}

fn make_test_source(owner: PlayerId) -> CardInstance {
    CardInstance::new(
        CardId(0),
        "Test Source".to_string(),
        owner,
        CardTypeLine::parse("Artifact"),
        ManaCost::no_cost(),
        ColorSet::COLORLESS,
        None,
        None,
        vec![],
        vec![],
    )
}

fn make_etb_life_creature(owner: PlayerId) -> CardInstance {
    let mut card = CardInstance::new(
        CardId(0),
        "Life Test".to_string(),
        owner,
        CardTypeLine::parse("Creature Elemental"),
        ManaCost::parse("2 G"),
        ColorSet::GREEN,
        Some(3),
        Some(3),
        vec![],
        vec![],
    );
    let mut next_trigger_id = 0;
    let trigger = parse_trigger(
        "Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigGain | TriggerDescription$ When CARDNAME enters the battlefield, you gain 3 life.",
        &mut next_trigger_id,
    )
    .expect("trigger should parse");
    card.set_triggers(vec![trigger]);
    card.svars.insert(
        "TrigGain".to_string(),
        "DB$ GainLife | Defined$ You | LifeAmount$ 3".to_string(),
    );
    card
}

fn pass_agents() -> Vec<Box<dyn PlayerAgent>> {
    vec![Box::new(PassAgent), Box::new(PassAgent)]
}

struct DiscardOneAgent;

impl PlayerAgent for DiscardOneAgent {
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
        _possible_defenders: &[manabrew_engine::combat::DefenderId],
    ) -> Vec<(CardId, manabrew_engine::combat::DefenderId)> {
        vec![]
    }

    fn choose_blockers(
        &mut self,
        _player: PlayerId,
        _attackers: &[CardId],
        _available_blockers: &[CardId],
        _max_blockers: Option<usize>,
    ) -> Vec<(CardId, CardId)> {
        vec![]
    }

    fn choose_discard_any_number(
        &mut self,
        _player: PlayerId,
        hand: &[CardId],
        _min: usize,
        max: usize,
    ) -> Vec<CardId> {
        hand.iter().copied().take(max.min(1)).collect()
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
        _player: PlayerId,
        valid: &[PlayerId],
        _sa: Option<&SpellAbility>,
    ) -> Option<PlayerId> {
        valid.first().copied()
    }

    fn choose_target_card(
        &mut self,
        _player: PlayerId,
        valid: &[CardId],
        _sa: Option<&SpellAbility>,
    ) -> Option<CardId> {
        valid.first().copied()
    }

    fn choose_target_any(
        &mut self,
        _player: PlayerId,
        valid_players: &[PlayerId],
        valid_cards: &[CardId],
        _sa: Option<&SpellAbility>,
    ) -> manabrew_engine::agent::TargetChoice {
        if let Some(&player) = valid_players.first() {
            manabrew_engine::agent::TargetChoice::Player(player)
        } else if let Some(&card) = valid_cards.first() {
            manabrew_engine::agent::TargetChoice::Card(card)
        } else {
            manabrew_engine::agent::TargetChoice::None
        }
    }

    fn choose_land_or_spell(&mut self, _player: PlayerId) -> Option<bool> {
        None
    }
}

fn push_activated_entry(
    game: &mut GameState,
    controller: PlayerId,
    ability_text: &str,
    target_card: Option<CardId>,
) {
    let source = game.create_card(make_test_source(controller));
    game.move_card(source, ZoneType::Command, controller);
    let mut sa = SpellAbility::new_simple(Some(source), controller, ability_text);
    sa.is_activated = true;
    sa.target_chosen.target_card = target_card;
    game.stack.push(StackEntry {
        id: 0,
        spell_ability: sa,
        is_creature_spell: false,
        is_permanent_spell: false,
        is_pending_cast: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    });
}

fn push_triggered_copy_entry(
    game: &mut GameState,
    controller: PlayerId,
    ability_text: &str,
    triggered_card: CardId,
) {
    let source = game.create_card(make_test_source(controller));
    game.move_card(source, ZoneType::Command, controller);
    let mut sa = SpellAbility::new_simple(Some(source), controller, ability_text);
    sa.is_trigger = true;
    sa.set_triggering_object(AbilityKey::Card, triggered_card);
    game.stack.push(StackEntry {
        id: 0,
        spell_ability: sa,
        is_creature_spell: false,
        is_permanent_spell: false,
        is_pending_cast: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    });
}

fn push_triggered_copy_entry_with_svars(
    game: &mut GameState,
    controller: PlayerId,
    ability_text: &str,
    triggered_card: CardId,
    svars: &[(&str, &str)],
) {
    let source = game.create_card(make_test_source(controller));
    game.move_card(source, ZoneType::Command, controller);
    for (key, value) in svars {
        game.card_mut(source).set_s_var(*key, *value);
    }
    let mut sa = SpellAbility::new_simple(Some(source), controller, ability_text);
    sa.is_trigger = true;
    sa.set_triggering_object(AbilityKey::Card, triggered_card);
    game.stack.push(StackEntry {
        id: 0,
        spell_ability: sa,
        is_creature_spell: false,
        is_permanent_spell: false,
        is_pending_cast: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    });
}

// ── Token Creation Tests ──────────────────────────────────────────────

/// Token effect creates N tokens on the battlefield for the controller.
#[test]
fn test_create_single_token() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);

    let ability = "SP$ Token | TokenAmount$ 1 | TokenScript$ r_1_1_goblin | TokenOwner$ You";
    push_activated_entry(&mut game, p0, ability, None);

    let mut agents = pass_agents();
    let mut game_loop = GameLoop::new(2);
    // Register the goblin token template
    game_loop.register_token("r_1_1_goblin", make_goblin_token(p0));

    game_loop.resolve_stack(&mut game, &mut agents);

    assert_eq!(
        game.zone(ZoneType::Battlefield, p0).len(),
        1,
        "Alice should have 1 token on the battlefield"
    );
    let token_id = game.zone(ZoneType::Battlefield, p0).cards[0];
    assert!(
        game.card(token_id).is_token,
        "Created card should be a token"
    );
    assert_eq!(game.card(token_id).card_name, "Goblin Token");
    assert_eq!(game.card(token_id).base_power, Some(1));
    assert_eq!(game.card(token_id).base_toughness, Some(1));
}

/// Token effect creates multiple tokens (TokenAmount$ 3).
#[test]
fn test_create_multiple_tokens() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);

    let ability = "SP$ Token | TokenAmount$ 3 | TokenScript$ r_1_1_goblin | TokenOwner$ You";
    push_activated_entry(&mut game, p0, ability, None);

    let mut agents = pass_agents();
    let mut game_loop = GameLoop::new(2);
    game_loop.register_token("r_1_1_goblin", make_goblin_token(p0));
    game_loop.resolve_stack(&mut game, &mut agents);

    assert_eq!(
        game.zone(ZoneType::Battlefield, p0).len(),
        3,
        "Alice should have 3 Goblin tokens"
    );
    for &tid in &game.zone(ZoneType::Battlefield, p0).cards.clone() {
        assert!(game.card(tid).is_token);
    }
}

/// TokenOwner$ Opponent creates the token for the opponent.
#[test]
fn test_token_for_opponent() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    let ability = "SP$ Token | TokenAmount$ 2 | TokenScript$ w_1_1_soldier | TokenOwner$ Opponent";
    push_activated_entry(&mut game, p0, ability, None);

    let mut agents = pass_agents();
    let mut game_loop = GameLoop::new(2);
    game_loop.register_token("w_1_1_soldier", make_soldier_token(p0));
    game_loop.resolve_stack(&mut game, &mut agents);

    assert_eq!(
        game.zone(ZoneType::Battlefield, p1).len(),
        2,
        "Bob should have 2 soldier tokens (TokenOwner$ Opponent)"
    );
    assert_eq!(game.zone(ZoneType::Battlefield, p0).len(), 0);
}

/// Missing token script logs a warning and creates nothing (no panic).
#[test]
fn test_missing_token_script_is_silent() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);

    let ability = "SP$ Token | TokenAmount$ 1 | TokenScript$ nonexistent_token | TokenOwner$ You";
    push_activated_entry(&mut game, p0, ability, None);

    let mut agents = pass_agents();
    let mut game_loop = GameLoop::new(2);
    // Intentionally do NOT register the script
    game_loop.resolve_stack(&mut game, &mut agents);

    assert_eq!(
        game.zone(ZoneType::Battlefield, p0).len(),
        0,
        "No token should be created"
    );
}

// ── Token Cease-to-Exist Tests ────────────────────────────────────────

/// Tokens cease to exist when they leave the battlefield (CR 110.5g).
#[test]
fn test_token_ceases_to_exist_on_death() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);

    // Place a token directly on the battlefield
    let token = game.create_card(make_goblin_token(p0));
    game.move_card(token, ZoneType::Battlefield, p0);
    assert_eq!(game.zone(ZoneType::Battlefield, p0).len(), 1);

    // Now deal lethal damage and run SBAs
    game.deal_damage_to_card(token, 5);
    game.check_state_based_actions();

    // Token should be gone from all zones
    assert_eq!(
        game.zone(ZoneType::Battlefield, p0).len(),
        0,
        "Token should leave battlefield"
    );
    assert_eq!(
        game.zone(ZoneType::Graveyard, p0).len(),
        0,
        "Token should NOT go to graveyard"
    );
    assert_eq!(
        game.card(token).zone,
        ZoneType::None,
        "Token zone should be None (ceased to exist)"
    );
}

/// Regular (non-token) creatures still go to the graveyard when they die.
#[test]
fn test_non_token_goes_to_graveyard_on_death() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);

    let bears = game.create_card(make_grizzly_bears(p0));
    game.move_card(bears, ZoneType::Battlefield, p0);
    game.deal_damage_to_card(bears, 5);
    game.check_state_based_actions();

    assert_eq!(
        game.zone(ZoneType::Graveyard, p0).len(),
        1,
        "Regular creature should go to graveyard"
    );
    assert_eq!(game.card(bears).zone, ZoneType::Graveyard);
}

// ── CopyPermanent Tests ───────────────────────────────────────────────

/// CopyPermanent creates a copy of a targeted creature on the battlefield.
#[test]
fn test_copy_permanent() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    // Bob has a Grizzly Bears on the battlefield
    let bears = game.create_card(make_grizzly_bears(p1));
    game.move_card(bears, ZoneType::Battlefield, p1);

    // Alice copies it (Clone effect)
    let ability = "SP$ CopyPermanent";
    push_activated_entry(&mut game, p0, ability, Some(bears));

    let mut agents = pass_agents();
    let mut game_loop = GameLoop::new(2);
    game_loop.resolve_stack(&mut game, &mut agents);

    // Alice should now have a copy
    assert_eq!(
        game.zone(ZoneType::Battlefield, p0).len(),
        1,
        "Alice should have the copy"
    );
    // Bob still has the original
    assert_eq!(
        game.zone(ZoneType::Battlefield, p1).len(),
        1,
        "Bob still has the original"
    );

    let copy_id = game.zone(ZoneType::Battlefield, p0).cards[0];
    assert!(
        game.card(copy_id).is_token,
        "Copy should be flagged as token"
    );
    assert_eq!(game.card(copy_id).card_name, "Grizzly Bears");
    assert_eq!(game.card(copy_id).base_power, Some(2));
    assert_eq!(game.card(copy_id).base_toughness, Some(2));
}

/// CopyPermanent with PumpKeywords$ adds the keyword to the copy.
#[test]
fn test_copy_permanent_with_pump_keywords() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    let bears = game.create_card(make_grizzly_bears(p1));
    game.move_card(bears, ZoneType::Battlefield, p1);

    let ability = "SP$ CopyPermanent | PumpKeywords$ Haste";
    push_activated_entry(&mut game, p0, ability, Some(bears));

    let mut agents = pass_agents();
    let mut game_loop = GameLoop::new(2);
    game_loop.resolve_stack(&mut game, &mut agents);

    let copy_id = game.zone(ZoneType::Battlefield, p0).cards[0];
    assert!(
        game.card(copy_id).keywords.contains_string("Haste"),
        "Copy should have Haste from PumpKeywords$"
    );
}

/// Copy-tokens cease to exist when they leave the battlefield.
#[test]
fn test_copy_ceases_to_exist_on_leaving() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    let bears = game.create_card(make_grizzly_bears(p1));
    game.move_card(bears, ZoneType::Battlefield, p1);

    let ability = "SP$ CopyPermanent";
    push_activated_entry(&mut game, p0, ability, Some(bears));

    let mut agents = pass_agents();
    let mut game_loop = GameLoop::new(2);
    game_loop.resolve_stack(&mut game, &mut agents);

    let copy_id = game.zone(ZoneType::Battlefield, p0).cards[0];
    // Move copy to graveyard (simulating death)
    game.move_card(copy_id, ZoneType::Graveyard, p0);

    assert_eq!(
        game.card(copy_id).zone,
        ZoneType::None,
        "Copy should cease to exist"
    );
    assert_eq!(
        game.zone(ZoneType::Graveyard, p0).len(),
        0,
        "Copy should NOT be in graveyard"
    );
}

#[test]
fn test_copy_permanent_triggers_copied_etb() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    let creature = game.create_card(make_etb_life_creature(p1));
    game.move_card(creature, ZoneType::Battlefield, p1);
    assert_eq!(game.player(p0).life, 20);

    let ability = "SP$ CopyPermanent";
    push_activated_entry(&mut game, p0, ability, Some(creature));

    let mut agents = pass_agents();
    let mut game_loop = GameLoop::new(2);
    game_loop.resolve_stack(&mut game, &mut agents);
    game_loop.step_with_priority(&mut game, &mut agents, true);

    assert_eq!(
        game.player(p0).life,
        23,
        "Copied permanent should fire its own ETB trigger"
    );
}

#[test]
fn test_copy_permanent_triggered_card_lki_copy_keeps_etb() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    let creature = game.create_card(make_etb_life_creature(p1));
    game.move_card(creature, ZoneType::Battlefield, p1);
    game.move_card(creature, ZoneType::Graveyard, p1);

    let ability = "SP$ CopyPermanent | Defined$ TriggeredCardLKICopy";
    push_triggered_copy_entry(&mut game, p0, ability, creature);

    let mut agents = pass_agents();
    let mut game_loop = GameLoop::new(2);
    game_loop.resolve_stack(&mut game, &mut agents);
    game_loop.step_with_priority(&mut game, &mut agents, true);

    assert_eq!(
        game.player(p0).life,
        23,
        "TriggeredCardLKICopy should preserve ETB triggers on the copied token"
    );
}

#[test]
fn test_copy_permanent_triggered_card_lki_copy_keeps_cavalier_etb() {
    let rules = parse_card_script(
        "Name:Cavalier of Flame\nManaCost:2 R R R\nTypes:Creature Elemental Knight\nPT:6/5\nA:AB$ PumpAll | Cost$ 1 R | ValidCards$ Creature.YouCtrl | NumAtt$ +1 | KW$ Haste | SpellDescription$ Creatures you control get +1/+0 and gain haste until end of turn.\nT:Mode$ ChangesZone | ValidCard$ Card.Self | Origin$ Any | Destination$ Battlefield | Execute$ TrigDiscard | TriggerDescription$ When CARDNAME enters, discard any number of cards, then draw that many cards.\nSVar:TrigDiscard:DB$ Discard | AnyNumber$ True | Optional$ True | Mode$ TgtChoose | RememberDiscarded$ True | SubAbility$ DBDraw\nSVar:DBDraw:DB$ Draw | Defined$ You | NumCards$ Y | SubAbility$ DBCleanup\nSVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True\nSVar:Y:Remembered$Amount\nT:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self | Execute$ TrigDamageAll | TriggerDescription$ When CARDNAME dies, it deals X damage to each opponent and each planeswalker they control, where X is the number of land cards in your graveyard.\nSVar:TrigDamageAll:DB$ DamageAll | ValidPlayers$ Player.Opponent | ValidCards$ Planeswalker.OppCtrl | NumDmg$ X | SpellDescription$ CARDNAME deals X damage to each opponent and each planeswalker they control, where X is the number of land cards in your graveyard.\nSVar:X:Count$ValidGraveyard Land.YouOwn",
    )
    .expect("card script should parse");

    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    let cavalier = game.create_card(CardInstance::from_rules(&rules, p1));
    game.move_card(cavalier, ZoneType::Battlefield, p1);
    game.move_card(cavalier, ZoneType::Graveyard, p1);

    let hand_card = game.create_card(make_grizzly_bears(p0));
    game.move_card(hand_card, ZoneType::Hand, p0);
    let draw_card = game.create_card(make_soldier_token(p0));
    game.move_card(draw_card, ZoneType::Library, p0);

    let ability = "SP$ CopyPermanent | Defined$ TriggeredCardLKICopy";
    push_triggered_copy_entry(&mut game, p0, ability, cavalier);

    let mut agents: Vec<Box<dyn PlayerAgent>> =
        vec![Box::new(DiscardOneAgent), Box::new(PassAgent)];
    let mut game_loop = GameLoop::new(2);
    game_loop.resolve_stack(&mut game, &mut agents);
    game_loop.step_with_priority(&mut game, &mut agents, true);

    assert!(
        game.zone(ZoneType::Graveyard, p0)
            .cards
            .contains(&hand_card),
        "Copied Cavalier ETB should discard a card"
    );
}

#[test]
fn test_copy_permanent_with_ashling_wrapper_keeps_cavalier_etb() {
    let rules = parse_card_script(
        "Name:Cavalier of Flame\nManaCost:2 R R R\nTypes:Creature Elemental Knight\nPT:6/5\nA:AB$ PumpAll | Cost$ 1 R | ValidCards$ Creature.YouCtrl | NumAtt$ +1 | KW$ Haste | SpellDescription$ Creatures you control get +1/+0 and gain haste until end of turn.\nT:Mode$ ChangesZone | ValidCard$ Card.Self | Origin$ Any | Destination$ Battlefield | Execute$ TrigDiscard | TriggerDescription$ When CARDNAME enters, discard any number of cards, then draw that many cards.\nSVar:TrigDiscard:DB$ Discard | AnyNumber$ True | Optional$ True | Mode$ TgtChoose | RememberDiscarded$ True | SubAbility$ DBDraw\nSVar:DBDraw:DB$ Draw | Defined$ You | NumCards$ Y | SubAbility$ DBCleanup\nSVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True\nSVar:Y:Remembered$Amount\nT:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self | Execute$ TrigDamageAll | TriggerDescription$ When CARDNAME dies, it deals X damage to each opponent and each planeswalker they control, where X is the number of land cards in your graveyard.\nSVar:TrigDamageAll:DB$ DamageAll | ValidPlayers$ Player.Opponent | ValidCards$ Planeswalker.OppCtrl | NumDmg$ X | SpellDescription$ CARDNAME deals X damage to each opponent and each planeswalker they control, where X is the number of land cards in your graveyard.\nSVar:X:Count$ValidGraveyard Land.YouOwn",
    )
    .expect("card script should parse");

    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    let cavalier = game.create_card(CardInstance::from_rules(&rules, p1));
    game.move_card(cavalier, ZoneType::Battlefield, p1);
    game.move_card(cavalier, ZoneType::Graveyard, p1);

    let hand_card = game.create_card(make_grizzly_bears(p0));
    game.move_card(hand_card, ZoneType::Hand, p0);
    let draw_card = game.create_card(make_soldier_token(p0));
    game.move_card(draw_card, ZoneType::Library, p0);

    push_triggered_copy_entry_with_svars(
        &mut game,
        p0,
        "DB$ CopyPermanent | Defined$ TriggeredCardLKICopy | PumpKeywords$ Haste | RememberTokens$ True | SubAbility$ DelTrig",
        cavalier,
        &[
            (
                "DelTrig",
                "DB$ DelayedTrigger | Mode$ Phase | Phase$ End of Turn | ValidPlayer$ You | Execute$ TrigSac | RememberObjects$ Remembered | TriggerDescription$ At the beginning of your next end step, sacrifice that token unless you pay {W}{U}{B}{R}{G}. | SubAbility$ DBCleanup",
            ),
            (
                "TrigSac",
                "DB$ SacrificeAll | Defined$ DelayTriggerRememberedLKI | UnlessCost$ W U B R G | UnlessPayer$ You",
            ),
            ("DBCleanup", "DB$ Cleanup | ClearRemembered$ True"),
        ],
    );

    let mut agents: Vec<Box<dyn PlayerAgent>> =
        vec![Box::new(DiscardOneAgent), Box::new(PassAgent)];
    let mut game_loop = GameLoop::new(2);
    game_loop.resolve_stack(&mut game, &mut agents);
    game_loop.step_with_priority(&mut game, &mut agents, true);

    assert!(
        game.zone(ZoneType::Graveyard, p0)
            .cards
            .contains(&hand_card),
        "Ashling-style CopyPermanent wrapper should still allow copied Cavalier ETB to resolve"
    );
}
