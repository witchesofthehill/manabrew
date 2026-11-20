use forge_carddb::parse_card_script;
use forge_foundation::ZoneType;
use manabrew_engine::agent::{PassAgent, PlayerAgent};
use manabrew_engine::card::{Card, CounterType};
use manabrew_engine::game::GameState;
use manabrew_engine::game_loop::GameLoop;
use manabrew_engine::ids::{CardId, PlayerId};
use manabrew_engine::spellability::{build_spell_ability_from_host_card, StackEntry};
use manabrew_engine::staticability::layer::apply_continuous_effects;

fn counter_and_suppress(duration: &str) -> (GameState, GameLoop, CardId, CardId) {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let target_rules = parse_card_script(
        "Name:Triggered creature\nManaCost:2 R R\nTypes:Artifact Creature\nPT:3/3\nK:Flying\nT:Mode$ SpellCast | ValidCard$ Card | ValidActivatingPlayer$ You | Execute$ TrigMana | TriggerZones$ Battlefield\nSVar:TrigMana:DB$ Mana | Produced$ R | SubAbility$ DBPutCounter\nSVar:DBPutCounter:DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ 1",
    ).unwrap();
    let target = game.create_card(Card::from_rules(&target_rules, PlayerId(1)));
    game.move_card(target, ZoneType::Battlefield, PlayerId(1));
    game.card_mut(target).add_counter(&CounterType::P1P1, 2);
    let host_rules = parse_card_script(&format!(
        "Name:Suppressor\nManaCost:2 U\nTypes:Creature\nPT:3/2\nSVar:CounterAbility:DB$ Counter | RememberCountered$ True | SubAbility$ Suppress\nSVar:Suppress:DB$ Effect | StaticAbilities$ LoseAbilities | RememberObjects$ Remembered | ForgetOnMoved$ Battlefield | Duration$ {duration} | SubAbility$ Cleanup\nSVar:LoseAbilities:Mode$ Continuous | Affected$ Card.IsRemembered | RemoveAllAbilities$ True | AffectedZone$ Battlefield\nSVar:Cleanup:DB$ Cleanup | ClearRemembered$ True"
    )).unwrap();
    let host = game.create_card(Card::from_rules(&host_rules, PlayerId(0)));
    game.move_card(host, ZoneType::Battlefield, PlayerId(0));
    let mut trigger = build_spell_ability_from_host_card(
        game.card(target),
        &game.card(target).svars["TrigMana"],
        PlayerId(1),
    );
    trigger.is_trigger = true;
    let target_entry = game.stack.push(StackEntry {
        id: 0,
        spell_ability: trigger,
        is_pending_cast: false,
        is_creature_spell: false,
        is_permanent_spell: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    });
    let mut counter = build_spell_ability_from_host_card(
        game.card(host),
        &game.card(host).svars["CounterAbility"],
        PlayerId(0),
    );
    counter.is_trigger = true;
    counter.target_chosen.target_stack_entry = Some(target_entry);
    game.stack.push(StackEntry {
        id: 0,
        spell_ability: counter,
        is_pending_cast: false,
        is_creature_spell: false,
        is_permanent_spell: false,
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    });
    let mut game_loop = GameLoop::new(2);
    let mut agents: Vec<Box<dyn PlayerAgent>> = vec![Box::new(PassAgent), Box::new(PassAgent)];
    game_loop.resolve_stack(&mut game, &mut agents);
    assert!(game.stack.is_empty());
    assert_eq!(game.card(target).counter_count(&CounterType::P1P1), 2);
    assert!(game.card(target).triggers.is_empty());
    assert!(!game.card(target).has_keyword("Flying"));
    (game, game_loop, host, target)
}

#[test]
fn suppression_survives_cleanup_and_ends_when_source_leaves() {
    let (mut game, mut game_loop, host, target) = counter_and_suppress("AsLongAsInPlay");
    let mut agents: Vec<Box<dyn PlayerAgent>> = vec![Box::new(PassAgent), Box::new(PassAgent)];
    for _ in 0..2 {
        game_loop.step_cleanup(&mut game, &mut agents);
        assert!(game.card(target).triggers.is_empty());
        assert!(!game.card(target).has_keyword("Flying"));
    }
    game.move_card(host, ZoneType::Graveyard, PlayerId(0));
    apply_continuous_effects(&mut game);
    assert_eq!(game.card(target).triggers.len(), 1);
    assert!(game.card(target).has_keyword("Flying"));
}

#[test]
fn suppression_ends_permanently_when_source_phases_out() {
    let (mut game, _, host, target) = counter_and_suppress("AsLongAsInPlay");
    game.card_mut(host).set_phased_out(true);
    apply_continuous_effects(&mut game);
    assert_eq!(game.card(target).triggers.len(), 1);
    assert!(game.card(target).has_keyword("Flying"));
    game.card_mut(host).set_phased_out(false);
    apply_continuous_effects(&mut game);
    assert_eq!(game.card(target).triggers.len(), 1);
    assert!(game.card(target).has_keyword("Flying"));
}

#[test]
fn until_host_leaves_play_survives_source_phasing() {
    let (mut game, _, host, target) = counter_and_suppress("UntilHostLeavesPlay");
    game.card_mut(host).set_phased_out(true);
    apply_continuous_effects(&mut game);
    assert!(game.card(target).triggers.is_empty());
    game.card_mut(host).set_phased_out(false);
    apply_continuous_effects(&mut game);
    assert!(game.card(target).triggers.is_empty());
}
