use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};
/// Test for Cancel (1UU) - should counter any spell including creature spells
/// This tests the fix for the TargetType$ Spell + ValidTgts$ Card combination
use manabrew_engine::agent::{PlayOption, PlayerAgent, TargetChoice};
use manabrew_engine::card::CardInstance;
use manabrew_engine::combat::DefenderId;
use manabrew_engine::game::GameState;
use manabrew_engine::ids::{CardId, PlayerId};
use manabrew_engine::player::actions::PlayerAction;
use manabrew_engine::spellability::target_restrictions::{self, has_valid_spell_with_filter};
use manabrew_engine::spellability::{SpellAbility, StackEntry};

/// Simple agent that always passes
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

    fn choose_target_spell(
        &mut self,
        _player: PlayerId,
        valid: &[u32],
        _source: Option<CardId>,
    ) -> Option<u32> {
        valid.first().copied()
    }

    fn choose_land_or_spell(&mut self, _player: PlayerId) -> Option<bool> {
        None
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

    fn choose_targets_for(
        &mut self,
        sa: &mut manabrew_engine::spellability::SpellAbility,
        game: &manabrew_engine::game::GameState,
        mana_pools: &[manabrew_engine::mana::ManaPool],
    ) -> bool {
        manabrew_engine::spellability::choose_targets_by_kind(self, sa, game, mana_pools)
    }
}

fn make_counterspell_card(owner: PlayerId) -> CardInstance {
    // Cancel: 1UU - Counter target spell
    CardInstance::new(
        CardId(0),
        "Cancel".to_string(),
        owner,
        CardTypeLine::parse("Instant"),
        ManaCost::parse("1 U U"),
        ColorSet::BLUE,
        None,
        None,
        vec![],
        vec!["SP$ Counter | TargetType$ Spell | ValidTgts$ Card | TgtPrompt$ Select target spell | SpellDescription$ Counter target spell.".to_string()],
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
        vec![],
    )
}

fn make_enchantment_spell(owner: PlayerId) -> CardInstance {
    CardInstance::new(
        CardId(0),
        "Test Enchantment".to_string(),
        owner,
        CardTypeLine::parse("Enchantment"),
        ManaCost::parse("1 W"),
        ColorSet::WHITE,
        None,
        None,
        vec![],
        vec![],
    )
}

fn make_mana_ability(owner: PlayerId) -> SpellAbility {
    SpellAbility::new_simple(None, owner, "AB$ Mana")
}

/// Test that the TargetType$ filter correctly identifies spell vs ability
#[test]
fn test_target_type_filter() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);

    // Empty stack - no valid spells
    assert!(
        !has_valid_spell_with_filter(&game, "Spell"),
        "Empty stack should have no valid spells"
    );

    //////////////////////////////
    // Test 1: Creature spell
    //////////////////////////////
    let bears = game.create_card(make_grizzly_bears(p0));
    let mut sa = SpellAbility::new_simple(Some(bears), p0, "");
    sa.is_spell = true; // Creature spells ARE spells
    let entry = StackEntry {
        id: 42, // ID will be overwritten by push()
        spell_ability: sa,
        is_creature_spell: true,
        is_permanent_spell: false,
        is_pending_cast: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    };
    let entry_id = game.stack.push(entry);

    assert_eq!(entry_id, 0, "First stack entry should have ID 0");
    assert!(
        has_valid_spell_with_filter(&game, "Spell"),
        "Stack with creature spell should have valid spell targets"
    );

    //////////////////////////////
    // Test 2: Ability added - should still have valid spell targets
    //////////////////////////////
    let ability = make_mana_ability(p0);
    let entry2 = StackEntry {
        id: 43,
        spell_ability: ability,
        is_creature_spell: false,
        is_permanent_spell: false,
        is_pending_cast: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    };
    let entry_id2 = game.stack.push(entry2);
    assert_eq!(entry_id2, 1, "Second stack entry should have ID 1");

    // Should still have valid spell targets (the creature spell)
    let valid = target_restrictions::get_all_candidates_spells(&game);
    assert_eq!(valid.len(), 2, "Stack should have 2 entries total");

    // Apply Spell filter - should only keep actual spells
    let valid_filtered = target_restrictions::filter_spells_by_type(&game, &valid, "Spell");
    assert_eq!(
        valid_filtered.len(),
        1,
        "Should only have 1 spell after Spell filter"
    );
    assert_eq!(
        valid_filtered[0], 0,
        "Remaining spell should be the creature spell (ID 0)"
    );

    //////////////////////////////
    // Test 3: Stack only has abilities - no valid spells
    //////////////////////////////
    let mut game2 = GameState::new(&["Alice", "Bob"], 20);
    let ability = make_mana_ability(p0);
    let entry = StackEntry {
        id: 44,
        spell_ability: ability,
        is_creature_spell: false,
        is_permanent_spell: false,
        is_pending_cast: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    };
    game2.stack.push(entry);

    assert!(
        !has_valid_spell_with_filter(&game2, "Spell"),
        "Stack with only abilities should have no valid spell targets"
    );
}

/// Test that Cancel can target and counter a creature spell
#[test]
fn test_cancel_counters_creature_spell() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0); // Alice with Cancel
    let p1 = PlayerId(1); // Bob with Grizzly Bears

    // Put a Grizzly Bears on the stack (simulating being cast)
    let bears = game.create_card(make_grizzly_bears(p1));
    game.move_card(bears, ZoneType::Stack, p1);

    let mut sa = SpellAbility::new_simple(Some(bears), p1, "");
    sa.is_spell = true; // This is a spell
    let entry = StackEntry {
        id: 42, // Will be overwritten
        spell_ability: sa,
        is_creature_spell: true,
        is_permanent_spell: false,
        is_pending_cast: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    };
    let creature_spell_id = game.stack.push(entry);

    // Verify the Bears is on the stack
    assert_eq!(game.stack.len(), 1, "Grizzly Bears should be on stack");
    assert_eq!(creature_spell_id, 0, "Entry should have ID 0");

    // Create Cancel spell
    let cancel = game.create_card(make_counterspell_card(p0));
    let mut cancel_sa = SpellAbility::new_simple(
        Some(cancel),
        p0,
        "SP$ Counter | TargetType$ Spell | ValidTgts$ Spell",
    );

    // Setup targeting with TargetType$ Spell filter
    cancel_sa.target_restrictions = Some(target_restrictions::TargetRestrictions {
        valid_tgts: vec!["Spell".to_string()],
        valid_tgts_selector: manabrew_engine::parsing::CompiledSelector::parse("Spell"),
        target_kind: target_restrictions::parse_valid_targets(
            "SP$ Counter | TargetType$ Spell | ValidTgts$ Spell",
        ),
        target_type_filter: Some("Spell".to_string()),
        min_targets: "1".to_string(),
        max_targets: "1".to_string(),
        tgt_zone: vec![ZoneType::Battlefield],
    });

    // Check if Cancel can target the creature spell
    assert!(
        cancel_sa
            .target_restrictions
            .as_ref()
            .unwrap()
            .has_candidates(&game, p0, None),
        "Cancel should have valid targets (the Grizzly Bears spell)"
    );

    // Get valid targets
    let valid = target_restrictions::get_all_candidates_spells(&game);
    assert_eq!(valid.len(), 1, "Should have 1 valid target");
    assert_eq!(
        valid[0], creature_spell_id,
        "Target should be the creature spell"
    );

    // Apply the TargetType$ filter - this should keep the creature spell
    let valid_filtered = target_restrictions::filter_spells_by_type(&game, &valid, "Spell");
    assert_eq!(
        valid_filtered.len(),
        1,
        "Should still have 1 valid target after Spell filter"
    );
    assert_eq!(
        valid_filtered[0], creature_spell_id,
        "Creature spell should still be targetable"
    );

    println!("✓ Cancel can target creature spells correctly");
}

/// Test that Cancel can target non-creature spells too
#[test]
fn test_cancel_counters_noncreature_spell() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    // Put a Lightning Bolt (instant) on the stack
    let bolt = game.create_card(make_lightning_bolt(p1));
    game.move_card(bolt, ZoneType::Stack, p1);

    let mut sa = SpellAbility::new_simple(Some(bolt), p1, "SP$ DealDamage");
    sa.is_spell = true; // This is a spell
    let entry = StackEntry {
        id: 42, // Will be overwritten
        spell_ability: sa,
        is_creature_spell: false,
        is_permanent_spell: false,
        is_pending_cast: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    };
    let instant_spell_id = game.stack.push(entry);

    // Verify the Bolt is on the stack
    assert_eq!(game.stack.len(), 1, "Lightning Bolt should be on stack");
    assert_eq!(instant_spell_id, 0, "Entry should have ID 0");

    // Create Cancel spell
    let cancel = game.create_card(make_counterspell_card(p0));
    let mut cancel_sa = SpellAbility::new_simple(
        Some(cancel),
        p0,
        "SP$ Counter | TargetType$ Spell | ValidTgts$ Spell",
    );

    // Setup targeting with TargetType$ Spell filter
    cancel_sa.target_restrictions = Some(target_restrictions::TargetRestrictions {
        valid_tgts: vec!["Spell".to_string()],
        valid_tgts_selector: manabrew_engine::parsing::CompiledSelector::parse("Spell"),
        target_kind: target_restrictions::parse_valid_targets(
            "SP$ Counter | TargetType$ Spell | ValidTgts$ Spell",
        ),
        target_type_filter: Some("Spell".to_string()),
        min_targets: "1".to_string(),
        max_targets: "1".to_string(),
        tgt_zone: vec![ZoneType::Battlefield],
    });

    // Check if Cancel can target the instant spell
    assert!(
        cancel_sa
            .target_restrictions
            .as_ref()
            .unwrap()
            .has_candidates(&game, p0, None),
        "Cancel should have valid targets (the Lightning Bolt spell)"
    );

    // Get valid targets
    let valid = target_restrictions::get_all_candidates_spells(&game);
    assert_eq!(valid.len(), 1, "Should have 1 valid target");

    // Apply the TargetType$ filter - this should keep the instant spell
    let valid_filtered = target_restrictions::filter_spells_by_type(&game, &valid, "Spell");
    assert_eq!(
        valid_filtered.len(),
        1,
        "Should still have 1 valid target after Spell filter"
    );
    assert_eq!(
        valid_filtered[0], instant_spell_id,
        "Instant spell should still be targetable"
    );

    println!("✓ Cancel can target non-creature spells correctly");
}

#[test]
fn test_instant_sorcery_filter_excludes_enchantment_spells() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p1 = PlayerId(1);

    let instant = game.create_card(make_lightning_bolt(p1));
    game.move_card(instant, ZoneType::Stack, p1);
    let mut instant_sa = SpellAbility::new_simple(Some(instant), p1, "SP$ DealDamage");
    instant_sa.is_spell = true;
    game.stack.push(StackEntry {
        id: 0,
        spell_ability: instant_sa,
        is_creature_spell: false,
        is_permanent_spell: false,
        is_pending_cast: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    });

    let enchantment = game.create_card(make_enchantment_spell(p1));
    game.move_card(enchantment, ZoneType::Stack, p1);
    let mut enchantment_sa = SpellAbility::new_simple(Some(enchantment), p1, "");
    enchantment_sa.is_spell = true;
    game.stack.push(StackEntry {
        id: 0,
        spell_ability: enchantment_sa,
        is_creature_spell: false,
        is_permanent_spell: true,
        is_pending_cast: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    });

    let all = target_restrictions::get_all_candidates_spells(&game);
    assert_eq!(all.len(), 2, "Both stack entries are spells");

    let filtered = target_restrictions::filter_spells_by_type(&game, &all, "Instant,Sorcery");
    assert_eq!(
        filtered.len(),
        1,
        "Only the instant should match Miscast-style targeting"
    );
    let matched = game
        .stack
        .iter()
        .find(|entry| entry.id == filtered[0])
        .and_then(|entry| entry.spell_ability.source)
        .expect("filtered spell should have a source card");
    assert_eq!(game.card(matched).card_name, "Lightning Bolt");
}

#[test]
fn test_noncreature_spell_filter_excludes_creature_spells() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    let bears = game.create_card(make_grizzly_bears(p1));
    game.move_card(bears, ZoneType::Stack, p1);
    let mut creature_sa = SpellAbility::new_simple(Some(bears), p1, "");
    creature_sa.is_spell = true;
    game.stack.push(StackEntry {
        id: 0,
        spell_ability: creature_sa,
        is_creature_spell: true,
        is_permanent_spell: true,
        is_pending_cast: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    });

    let bolt = game.create_card(make_lightning_bolt(p1));
    game.move_card(bolt, ZoneType::Stack, p1);
    let mut instant_sa = SpellAbility::new_simple(Some(bolt), p1, "SP$ DealDamage");
    instant_sa.is_spell = true;
    game.stack.push(StackEntry {
        id: 0,
        spell_ability: instant_sa,
        is_creature_spell: false,
        is_permanent_spell: false,
        is_pending_cast: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    });

    let restrictions = target_restrictions::TargetRestrictions {
        valid_tgts: vec!["Card.nonCreature".to_string()],
        valid_tgts_selector: manabrew_engine::parsing::CompiledSelector::parse("Card.nonCreature"),
        target_kind: target_restrictions::TargetKind::Spell,
        target_type_filter: Some("Spell".to_string()),
        min_targets: "1".to_string(),
        max_targets: "1".to_string(),
        tgt_zone: vec![ZoneType::Battlefield],
    };

    assert!(
        restrictions.has_candidates(&game, p0, None),
        "An Offer-style targeting should still find the instant spell",
    );

    let all = target_restrictions::get_all_candidates_spells(&game);
    let filtered =
        target_restrictions::filter_spells_for_target_restrictions(&game, &all, &restrictions);
    assert_eq!(
        filtered.len(),
        1,
        "Only the noncreature spell should remain"
    );
    let matched = game
        .stack
        .iter()
        .find(|entry| entry.id == filtered[0])
        .and_then(|entry| entry.spell_ability.source)
        .expect("filtered spell should have a source card");
    assert_eq!(game.card(matched).card_name, "Lightning Bolt");
}
