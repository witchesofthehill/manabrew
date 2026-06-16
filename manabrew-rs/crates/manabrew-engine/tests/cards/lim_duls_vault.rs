use std::cell::RefCell;
use std::rc::Rc;

use forge_carddb::CardDatabase;
use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};
use manabrew_engine::ability::ability_factory::build_spell_ability;
use manabrew_engine::card::CardInstance;
use manabrew_engine::game::GameState;
use manabrew_engine::game_loop::GameLoop;
use manabrew_engine::ids::{CardId, PlayerId};
use manabrew_engine::spellability::StackEntry;

use crate::common_test_agent::{CallbackEvent, RecordingAgent, RecordingState};

fn make_named_card(owner: PlayerId, name: &str) -> CardInstance {
    CardInstance::new(
        CardId(0),
        name.to_string(),
        owner,
        CardTypeLine::parse("Creature"),
        ManaCost::parse("1"),
        ColorSet::COLORLESS,
        Some(1),
        Some(1),
        vec![],
        vec![],
    )
}

fn make_changeling_outcast(owner: PlayerId) -> CardInstance {
    CardInstance::new(
        CardId(0),
        "Changeling Outcast".to_string(),
        owner,
        CardTypeLine::parse("Creature - Shapeshifter Rogue"),
        ManaCost::parse("B"),
        ColorSet::BLACK,
        Some(1),
        Some(1),
        vec!["Changeling".to_string()],
        vec![],
    )
}

fn make_lim_duls_vault(owner: PlayerId) -> CardInstance {
    let bytes = forge_cardset_archive::build_test_archive(&[(
        "lim-dûl's vault",
        include_str!("../../../../../forge/forge-gui/res/cardsfolder/l/lim_duls_vault.txt"),
    )]);
    let bundle = CardDatabase::load_from_archive(&bytes).expect("synthetic archive should load");
    let rules = bundle
        .cards
        .get_by_card_name("Lim-Dûl's Vault")
        .expect("Vault rules should load from the real card script");
    CardInstance::from_rules(rules, owner)
}

fn run_lim_duls_vault(pay_answers: Vec<bool>) -> (GameState, PlayerId, Vec<CallbackEvent>) {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);

    for name in ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"] {
        let card = game.create_card(make_named_card(p0, name));
        game.move_card(card, ZoneType::Library, p0);
    }

    for name in ["Foo", "Bar", "Baz", "Quux"] {
        let card = game.create_card(make_named_card(p0, name));
        game.move_card(card, ZoneType::Library, p0);
    }
    let changeling = game.create_card(make_changeling_outcast(p0));
    game.move_card(changeling, ZoneType::Library, p0);

    let vault = game.create_card(make_lim_duls_vault(p0));
    game.move_card(vault, ZoneType::Stack, p0);

    let sa = build_spell_ability(&game, vault, &game.card(vault).abilities[0], p0);
    game.stack.push(StackEntry {
        id: 0,
        spell_ability: sa,
        is_creature_spell: false,
        is_permanent_spell: false,
        is_pending_cast: false,
        cast_from_zone: Some(ZoneType::Hand),
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    });

    let shared = Rc::new(RefCell::new(RecordingState {
        events: Vec::new(),
        pay_answers,
    }));
    let mut agents: Vec<Box<dyn manabrew_engine::agent::PlayerAgent>> = vec![
        Box::new(RecordingAgent::new(shared.clone())),
        Box::new(manabrew_engine::agent::PassAgent),
    ];

    let mut game_loop = GameLoop::new(2);
    game_loop.resolve_stack(&mut game, &mut agents);

    let events = shared.borrow().events.clone();
    (game, p0, events)
}

#[test]
fn lim_duls_vault_records_reveal_pay_reveal_pay_reorder_callbacks() {
    let (game, p0, events) = run_lim_duls_vault(vec![true, false]);
    assert_eq!(
        game.player(p0).life,
        19,
        "Vault should only charge 1 life for one repeat"
    );

    let expected = vec![
        CallbackEvent::Reveal(vec![
            "Foo".to_string(),
            "Bar".to_string(),
            "Baz".to_string(),
            "Quux".to_string(),
            "Changeling Outcast".to_string(),
        ]),
        CallbackEvent::PayCostToPreventEffect("Pay 1 life".to_string()),
        CallbackEvent::Reveal(vec![
            "Alpha".to_string(),
            "Beta".to_string(),
            "Gamma".to_string(),
            "Delta".to_string(),
            "Epsilon".to_string(),
        ]),
        CallbackEvent::PayCostToPreventEffect("Pay 1 life".to_string()),
    ];

    assert!(
        events.len() >= 5,
        "Expected reveal/pay/reveal/pay/reorder callback chain, got {:?}",
        events
    );
    assert_eq!(&events[..4], expected.as_slice());

    match &events[4] {
        CallbackEvent::Reorder(ids) => {
            assert_eq!(ids.len(), 5, "Final reorder must receive five cards")
        }
        other => panic!("Expected final callback to be reorder, got {:?}", other),
    }

    assert!(
        !events.iter().any(|e| matches!(e, CallbackEvent::ChooseSingle(_))),
        "Final Vault branch should not surface single-card hidden selection in this engine path: {:?}",
        events
    );
}

#[test]
fn lim_duls_vault_can_repeat_five_times_for_five_life() {
    let (game, p0, events) = run_lim_duls_vault(vec![true, true, true, true, true, false]);

    assert_eq!(
        game.player(p0).life,
        15,
        "Vault should charge 5 life after five accepted repeats"
    );

    let pay_events = events
        .iter()
        .filter(|event| matches!(event, CallbackEvent::PayCostToPreventEffect(_)))
        .count();
    let reveal_events = events
        .iter()
        .filter(|event| matches!(event, CallbackEvent::Reveal(_)))
        .count();

    assert_eq!(
        pay_events, 6,
        "Expected one pay prompt per look, including the final decline"
    );
    assert_eq!(
        reveal_events, 6,
        "Expected one reveal callback per look across five repeats"
    );
    assert!(
        matches!(events.last(), Some(CallbackEvent::Reorder(ids)) if ids.len() == 5),
        "Final callback should still be a five-card reorder after repeated life payments: {:?}",
        events
    );
}
