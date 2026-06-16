use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};
/// Integration tests for Zone Change Effects (Issue #13):
/// ChangeZone, ChangeZoneAll, Sacrifice, SacrificeAll
use manabrew_engine::agent::{PassAgent, PlayerAgent};
use manabrew_engine::card::CardInstance;
use manabrew_engine::game::GameState;
use manabrew_engine::game_loop::GameLoop;
use manabrew_engine::game_rng::GameRng;
use manabrew_engine::ids::{CardId, PlayerId};
use manabrew_engine::spellability::{SpellAbility, StackEntry};

// ── Card constructors ────────────────────────────────────────────────

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

fn effect_source(game: &mut GameState, controller: PlayerId) -> CardId {
    let source = game.create_card(make_test_source(controller));
    game.move_card(source, ZoneType::Command, controller);
    source
}

/// Build a minimal 2-agent PassAgent slice for tests that don't care about choices.
fn pass_agents() -> Vec<Box<dyn PlayerAgent>> {
    vec![Box::new(PassAgent), Box::new(PassAgent)]
}

struct ReverseShuffleRng;

impl GameRng for ReverseShuffleRng {
    fn shuffle_cards(&mut self, cards: &mut [CardId]) {
        cards.reverse();
    }

    fn next_int(&mut self, _bound: i32) -> i32 {
        0
    }
}

/// Push a fake non-permanent spell entry for testing effect resolution.
fn push_effect_entry(
    game: &mut GameState,
    controller: PlayerId,
    ability_text: &str,
    target_card: Option<CardId>,
    target_player: Option<PlayerId>,
    source: Option<CardId>,
) {
    let mut sa = SpellAbility::new_simple(source, controller, ability_text);
    sa.target_chosen.target_card = target_card;
    sa.target_chosen.target_player = target_player;
    let entry = StackEntry {
        id: 0,
        spell_ability: sa,
        is_creature_spell: false,
        is_permanent_spell: false,
        is_pending_cast: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    };
    game.stack.push(entry);
}

// ── Test 1: Bounce to Hand (Battlefield → Hand) ──────────────────────

/// ChangeZone Battlefield→Hand on a targeted creature (bounce effect like Unsummon).
#[test]
fn test_bounce_to_hand() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    // Put a creature on Bob's battlefield
    let bears = game.create_card(make_grizzly_bears(p1));
    game.move_card(bears, ZoneType::Battlefield, p1);

    // Alice casts an Unsummon-like effect targeting Bob's creature
    let ability = "SP$ ChangeZone | Origin$ Battlefield | Destination$ Hand | ValidTgts$ Creature";
    push_effect_entry(&mut game, p0, ability, Some(bears), None, None);

    // Create a fake source card for the effect (not important, just needs to exist)
    // Actually, the effect resolves the stack and moves to graveyard, but there's no source card.
    // We need to wrap this as a triggered/activated ability so it doesn't try to move a card
    // from source. Let's use an activated ability entry instead.
    // Clear the stack and use is_activated_ability = true
    game.stack.pop();

    let mut sa = SpellAbility::new_simple(Some(effect_source(&mut game, p0)), p0, ability);
    sa.is_activated = true;
    sa.target_chosen.target_card = Some(bears);
    let entry = StackEntry {
        id: 0,
        spell_ability: sa,
        is_creature_spell: false,
        is_permanent_spell: false,
        is_pending_cast: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    };
    game.stack.push(entry);

    let mut agents = pass_agents();
    let mut game_loop = GameLoop::new(2);
    game_loop.game_rng = Box::new(ReverseShuffleRng);
    game_loop.resolve_stack(&mut game, &mut agents);

    // Creature should now be in Bob's hand
    assert_eq!(
        game.card(bears).zone,
        ZoneType::Hand,
        "Bounced creature should be in Bob's hand"
    );
    assert_eq!(
        game.zone(ZoneType::Battlefield, p1).len(),
        0,
        "Bob's battlefield should be empty"
    );
    assert_eq!(
        game.zone(ZoneType::Hand, p1).len(),
        1,
        "Bob should have 1 card in hand (bounced creature)"
    );
}

// ── Test 2: Exile Permanent (Battlefield → Exile) ────────────────────

/// ChangeZone Battlefield→Exile on a targeted creature (Swords to Plowshares style).
#[test]
fn test_exile_permanent() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    // Put a creature on Bob's battlefield
    let bears = game.create_card(make_grizzly_bears(p1));
    game.move_card(bears, ZoneType::Battlefield, p1);

    let ability = "SP$ ChangeZone | Origin$ Battlefield | Destination$ Exile | ValidTgts$ Creature";
    let mut sa = SpellAbility::new_simple(Some(effect_source(&mut game, p0)), p0, ability);
    sa.is_activated = true;
    sa.target_chosen.target_card = Some(bears);
    let entry = StackEntry {
        id: 0,
        spell_ability: sa,
        is_creature_spell: false,
        is_permanent_spell: false,
        is_pending_cast: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    };
    game.stack.push(entry);

    let mut agents = pass_agents();
    let mut game_loop = GameLoop::new(2);
    game_loop.resolve_stack(&mut game, &mut agents);

    assert_eq!(
        game.card(bears).zone,
        ZoneType::Exile,
        "Exiled creature should be in Exile zone"
    );
    assert_eq!(
        game.zone(ZoneType::Battlefield, p1).len(),
        0,
        "Bob's battlefield should be empty"
    );
}

// ── Test 3: Reanimate (Graveyard → Battlefield) ──────────────────────

/// ChangeZone Graveyard→Battlefield on a creature in the graveyard (Animate Dead style).
#[test]
fn test_reanimate() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    // Put a creature in Bob's graveyard
    let bears = game.create_card(make_grizzly_bears(p1));
    game.move_card(bears, ZoneType::Graveyard, p1);

    // Alice reanimates it onto the battlefield
    let ability = "SP$ ChangeZone | Origin$ Graveyard | Destination$ Battlefield | ValidTgts$ Creature.inZoneGraveyard";
    let mut sa = SpellAbility::new_simple(Some(effect_source(&mut game, p0)), p0, ability);
    sa.is_activated = true;
    sa.target_chosen.target_card = Some(bears);
    let entry = StackEntry {
        id: 0,
        spell_ability: sa,
        is_creature_spell: false,
        is_permanent_spell: false,
        is_pending_cast: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    };
    game.stack.push(entry);

    let mut agents = pass_agents();
    let mut game_loop = GameLoop::new(2);
    game_loop.resolve_stack(&mut game, &mut agents);

    // Without explicit gain-control text, the card returns under its owner's control.
    assert_eq!(
        game.card(bears).zone,
        ZoneType::Battlefield,
        "Reanimated creature should be on the battlefield"
    );
    assert_eq!(
        game.zone(ZoneType::Graveyard, p1).len(),
        0,
        "Bob's graveyard should be empty after reanimation"
    );
    // It returns under Bob's (owner's) control.
    assert_eq!(
        game.zone(ZoneType::Battlefield, p1).len(),
        1,
        "The reanimated creature should be on Bob's battlefield (owner controls it)"
    );
}

// ── Test 4: Raise Dead (Graveyard → Hand) ────────────────────────────

/// ChangeZone Graveyard→Hand on a creature in the graveyard (Raise Dead style).
#[test]
fn test_raise_dead() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let _p1 = PlayerId(1);

    // Put a creature in Alice's graveyard
    let bears = game.create_card(make_grizzly_bears(p0));
    game.move_card(bears, ZoneType::Graveyard, p0);

    // Alice casts Raise Dead targeting her own creature
    let ability = "SP$ ChangeZone | Origin$ Graveyard | Destination$ Hand | ValidTgts$ Creature.inZoneGraveyard";
    let mut sa = SpellAbility::new_simple(Some(effect_source(&mut game, p0)), p0, ability);
    sa.is_activated = true;
    sa.target_chosen.target_card = Some(bears);
    let entry = StackEntry {
        id: 0,
        spell_ability: sa,
        is_creature_spell: false,
        is_permanent_spell: false,
        is_pending_cast: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    };
    game.stack.push(entry);

    let mut agents = pass_agents();
    let mut game_loop = GameLoop::new(2);
    game_loop.resolve_stack(&mut game, &mut agents);

    assert_eq!(
        game.card(bears).zone,
        ZoneType::Hand,
        "Raised creature should be in hand"
    );
    assert_eq!(
        game.zone(ZoneType::Graveyard, p0).len(),
        0,
        "Alice's graveyard should be empty"
    );
    assert_eq!(
        game.zone(ZoneType::Hand, p0).len(),
        1,
        "Alice should have 1 card in hand"
    );
}

/// ChangeZone Graveyard->Library with Shuffle$ True must actually shuffle the
/// destination library, matching Java's ChangeZoneEffect behavior.
#[test]
fn test_graveyard_to_library_with_shuffle() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);

    let forest = game.create_card(make_forest(p0));
    let mountain_one = game.create_card(make_mountain(p0));
    let mountain_two = game.create_card(make_mountain(p0));
    let bears = game.create_card(make_grizzly_bears(p0));

    game.move_card(forest, ZoneType::Library, p0);
    game.move_card(mountain_one, ZoneType::Library, p0);
    game.move_card(mountain_two, ZoneType::Library, p0);
    game.move_card(bears, ZoneType::Graveyard, p0);

    let expected_without_shuffle = vec![forest, mountain_one, mountain_two, bears];

    let ability =
        "SP$ ChangeZone | Origin$ Graveyard | Destination$ Library | Defined$ Self | Shuffle$ True";
    let mut sa = SpellAbility::new_simple(Some(bears), p0, ability);
    sa.is_activated = true;
    let entry = StackEntry {
        id: 0,
        spell_ability: sa,
        is_creature_spell: false,
        is_permanent_spell: false,
        is_pending_cast: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    };
    game.stack.push(entry);

    let mut agents = pass_agents();
    let mut game_loop = GameLoop::new(2);
    game_loop.resolve_stack(&mut game, &mut agents);

    assert_eq!(
        game.card(bears).zone,
        ZoneType::Library,
        "The moved card should end up in the library"
    );
    assert_ne!(
        game.zone(ZoneType::Library, p0).cards,
        expected_without_shuffle,
        "Shuffle$ True should not leave the library in simple append order"
    );
}

// ── Test 5: ChangeZoneAll Board Wipe (Battlefield → Exile) ───────────

/// ChangeZoneAll Battlefield→Exile moves all creatures off the battlefield.
#[test]
fn test_change_zone_all_board_wipe() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    // Put creatures on both battlefields
    let alice_bears = game.create_card(make_grizzly_bears(p0));
    game.move_card(alice_bears, ZoneType::Battlefield, p0);

    let bob_bears = game.create_card(make_grizzly_bears(p1));
    game.move_card(bob_bears, ZoneType::Battlefield, p1);

    // Also put a land on Alice's battlefield — it should NOT be exiled
    let alice_forest = game.create_card(make_forest(p0));
    game.move_card(alice_forest, ZoneType::Battlefield, p0);

    // Exile all creatures (Cataclysm-style)
    let ability =
        "SP$ ChangeZoneAll | Origin$ Battlefield | Destination$ Exile | ValidCards$ Creature";
    let mut sa = SpellAbility::new_simple(Some(effect_source(&mut game, p0)), p0, ability);
    sa.is_activated = true;
    let entry = StackEntry {
        id: 0,
        spell_ability: sa,
        is_creature_spell: false,
        is_permanent_spell: false,
        is_pending_cast: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    };
    game.stack.push(entry);

    let mut agents = pass_agents();
    let mut game_loop = GameLoop::new(2);
    game_loop.resolve_stack(&mut game, &mut agents);

    // Both creatures should be exiled
    assert_eq!(
        game.card(alice_bears).zone,
        ZoneType::Exile,
        "Alice's creature should be in Exile"
    );
    assert_eq!(
        game.card(bob_bears).zone,
        ZoneType::Exile,
        "Bob's creature should be in Exile"
    );
    // Land should remain on battlefield
    assert_eq!(
        game.card(alice_forest).zone,
        ZoneType::Battlefield,
        "Land should remain on the battlefield"
    );
    // Both players' battlefields should only have land (Alice has 1, Bob has 0)
    assert_eq!(
        game.zone(ZoneType::Battlefield, p0).len(),
        1,
        "Alice's battlefield should have only the land"
    );
    assert_eq!(
        game.zone(ZoneType::Battlefield, p1).len(),
        0,
        "Bob's battlefield should be empty"
    );
}

// ── Test 6: Sacrifice Self (SacValid$ Self) ───────────────────────────

/// Sacrifice with SacValid$=Self sacrifices the source card.
#[test]
fn test_sacrifice_self() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let _p1 = PlayerId(1);

    // Put a creature on Alice's battlefield as the source of the ability
    let bears = game.create_card(make_grizzly_bears(p0));
    game.move_card(bears, ZoneType::Battlefield, p0);

    // The creature sacrifices itself (like a Loxodon Warhammer echo)
    let ability = "SP$ Sacrifice | SacValid$ Self";
    let mut sa = SpellAbility::new_simple(Some(bears), p0, ability); // source is the creature that sacrifices
    sa.is_activated = true;
    let entry = StackEntry {
        id: 0,
        spell_ability: sa,
        is_creature_spell: false,
        is_permanent_spell: false,
        is_pending_cast: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    };
    game.stack.push(entry);

    let mut agents = pass_agents();
    let mut game_loop = GameLoop::new(2);
    game_loop.resolve_stack(&mut game, &mut agents);

    assert_eq!(
        game.card(bears).zone,
        ZoneType::Graveyard,
        "Self-sacrificed creature should be in graveyard"
    );
    assert_eq!(
        game.zone(ZoneType::Battlefield, p0).len(),
        0,
        "Alice's battlefield should be empty"
    );
}

// ── Test 7: SacrificeAll Creatures ────────────────────────────────────

/// SacrificeAll moves all creatures from battlefield to graveyard.
#[test]
fn test_sacrifice_all_creatures() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    // Put creatures on both battlefields
    let alice_bears = game.create_card(make_grizzly_bears(p0));
    game.move_card(alice_bears, ZoneType::Battlefield, p0);

    let bob_bears = game.create_card(make_grizzly_bears(p1));
    game.move_card(bob_bears, ZoneType::Battlefield, p1);

    // Put a land on Alice's battlefield — it should survive
    let alice_forest = game.create_card(make_forest(p0));
    game.move_card(alice_forest, ZoneType::Battlefield, p0);

    // Sacrifice all creatures (Overwhelming Splendor style)
    let ability = "SP$ SacrificeAll | ValidCards$ Creature";
    let mut sa = SpellAbility::new_simple(Some(effect_source(&mut game, p0)), p0, ability);
    sa.is_activated = true;
    let entry = StackEntry {
        id: 0,
        spell_ability: sa,
        is_creature_spell: false,
        is_permanent_spell: false,
        is_pending_cast: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    };
    game.stack.push(entry);

    let mut agents = pass_agents();
    let mut game_loop = GameLoop::new(2);
    game_loop.resolve_stack(&mut game, &mut agents);

    // Both creatures should be in their owners' graveyards
    assert_eq!(
        game.card(alice_bears).zone,
        ZoneType::Graveyard,
        "Alice's creature should be in graveyard"
    );
    assert_eq!(
        game.card(bob_bears).zone,
        ZoneType::Graveyard,
        "Bob's creature should be in graveyard"
    );
    // Land survives
    assert_eq!(
        game.card(alice_forest).zone,
        ZoneType::Battlefield,
        "Land should still be on battlefield"
    );
    // Graveyard counts
    assert_eq!(
        game.zone(ZoneType::Graveyard, p0).len(),
        1,
        "Alice's graveyard should have 1 card"
    );
    assert_eq!(
        game.zone(ZoneType::Graveyard, p1).len(),
        1,
        "Bob's graveyard should have 1 card"
    );
}

// ── Test 8: Sacrifice Defined$ Player — each player sacrifices ────────

/// Sacrifice with Defined$ Player (Innocent Blood) makes BOTH players sacrifice a creature.
#[test]
fn test_sacrifice_each_player() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    // Both players have a creature on the battlefield
    let alice_bears = game.create_card(make_grizzly_bears(p0));
    game.move_card(alice_bears, ZoneType::Battlefield, p0);

    let bob_bears = game.create_card(make_grizzly_bears(p1));
    game.move_card(bob_bears, ZoneType::Battlefield, p1);

    // Innocent Blood: each player sacrifices a creature
    let ability = "SP$ Sacrifice | SacValid$ Creature | Defined$ Player";
    let mut sa = SpellAbility::new_simple(Some(effect_source(&mut game, p0)), p0, ability);
    sa.is_activated = true;
    let entry = StackEntry {
        id: 0,
        spell_ability: sa,
        is_creature_spell: false,
        is_permanent_spell: false,
        is_pending_cast: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    };
    game.stack.push(entry);

    let mut agents = pass_agents();
    let mut game_loop = GameLoop::new(2);
    game_loop.resolve_stack(&mut game, &mut agents);

    // Both creatures must have been sacrificed
    assert_eq!(
        game.card(alice_bears).zone,
        ZoneType::Graveyard,
        "Alice's creature should be sacrificed (Defined$ Player affects each player)"
    );
    assert_eq!(
        game.card(bob_bears).zone,
        ZoneType::Graveyard,
        "Bob's creature should be sacrificed (Defined$ Player affects each player)"
    );
    assert_eq!(
        game.zone(ZoneType::Battlefield, p0).len(),
        0,
        "Alice's battlefield should be empty"
    );
    assert_eq!(
        game.zone(ZoneType::Battlefield, p1).len(),
        0,
        "Bob's battlefield should be empty"
    );
}

// ── Test 9: Tuck to Library Bottom (LibraryPosition$ -1) ─────────────

/// ChangeZone Battlefield→Library with LibraryPosition$=-1 places the card at the bottom.
#[test]
fn test_tuck_to_library_bottom() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    // Give Alice some cards in her library first
    let library_card1 = game.create_card(make_mountain(p0));
    game.move_card(library_card1, ZoneType::Library, p0);
    let library_card2 = game.create_card(make_forest(p0));
    game.move_card(library_card2, ZoneType::Library, p0);

    // Put a creature on Bob's battlefield that will get tucked
    let bears = game.create_card(make_grizzly_bears(p1));
    game.move_card(bears, ZoneType::Battlefield, p1);

    // Alice casts Condemn on Bob's attacking creature — puts it on bottom of its owner's library
    let ability = "SP$ ChangeZone | Origin$ Battlefield | Destination$ Library | LibraryPosition$ -1 | ValidTgts$ Creature";
    let mut sa = SpellAbility::new_simple(Some(effect_source(&mut game, p0)), p0, ability);
    sa.is_activated = true;
    sa.target_chosen.target_card = Some(bears);
    let entry = StackEntry {
        id: 0,
        spell_ability: sa,
        is_creature_spell: false,
        is_permanent_spell: false,
        is_pending_cast: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    };
    game.stack.push(entry);

    let mut agents = pass_agents();
    let mut game_loop = GameLoop::new(2);
    game_loop.resolve_stack(&mut game, &mut agents);

    // Creature should be in Bob's library (its owner)
    assert_eq!(
        game.card(bears).zone,
        ZoneType::Library,
        "Tucked creature should be in Bob's library"
    );
    assert_eq!(
        game.zone(ZoneType::Battlefield, p1).len(),
        0,
        "Bob's battlefield should be empty"
    );

    // The tucked card should be at the bottom (index 0 in our internal representation)
    // Bob's library only has the bears card
    let bob_library = &game.zone(ZoneType::Library, p1).cards;
    assert_eq!(bob_library.len(), 1, "Bob's library should have 1 card");
    assert_eq!(
        bob_library[0], bears,
        "Tucked creature should be at bottom of Bob's library (index 0)"
    );

    // Alice's library should be untouched
    assert_eq!(
        game.zone(ZoneType::Library, p0).len(),
        2,
        "Alice's library should still have 2 cards"
    );
}
