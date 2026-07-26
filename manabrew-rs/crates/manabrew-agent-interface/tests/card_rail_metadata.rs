use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};
use manabrew_agent_interface::game_view_dto::card_to_dto;
use manabrew_engine::card::Card;
use manabrew_engine::game::GameState;
use manabrew_engine::ids::{CardId, PlayerId};
use manabrew_engine::trigger::trigger::parse_trigger;

fn make_game() -> GameState {
    GameState::new(&["Alice", "Bob"], 20)
}

fn make_card(id: CardId, name: &str, type_line: &str, keywords: Vec<&str>, zone: ZoneType) -> Card {
    let mut card = Card::new(
        id,
        name.to_string(),
        PlayerId(0),
        CardTypeLine::parse(type_line),
        ManaCost::parse(""),
        ColorSet::COLORLESS,
        None,
        None,
        keywords.into_iter().map(str::to_string).collect(),
        vec![],
    );
    card.zone = zone;
    card
}

fn add_chapter_trigger(card: &mut Card, chapter: i32) {
    let mut next_id = 0;
    let trigger = parse_trigger(
        &format!(
            "Mode$ CounterAdded | Chapter$ {chapter} | CounterType$ LORE | CounterAmount$ EQ{chapter} | Execute$ Chapter{chapter}"
        ),
        &mut next_id,
    )
    .expect("chapter trigger");
    card.triggers.push(trigger);
}

#[test]
fn visible_battlefield_rails_are_populated_from_live_state() {
    let mut game = make_game();

    let mut saga = make_card(
        CardId(0),
        "Rail Saga",
        "Enchantment Saga",
        vec![],
        ZoneType::Battlefield,
    );
    add_chapter_trigger(&mut saga, 3);
    let saga_id = game.create_card(saga);

    let mut class_card = make_card(
        CardId(1),
        "Rail Class",
        "Enchantment Class",
        vec![],
        ZoneType::Battlefield,
    );
    class_card.set_class_level(2);
    let class_id = game.create_card(class_card);

    let saga_dto = card_to_dto(&game, saga_id);
    assert_eq!(saga_dto.final_chapter, Some(3));
    assert_eq!(saga_dto.class_level, None);

    let class_dto = card_to_dto(&game, class_id);
    assert_eq!(class_dto.final_chapter, None);
    assert_eq!(class_dto.class_level, Some(2));
}

#[test]
fn negative_rails_stay_hidden_for_nonmatching_or_unsupported_cards() {
    let mut game = make_game();

    let face_down_saga = game.create_card({
        let mut card = make_card(
            CardId(0),
            "Hidden Saga",
            "Enchantment Saga",
            vec![],
            ZoneType::Battlefield,
        );
        add_chapter_trigger(&mut card, 3);
        card.face_down = true;
        card
    });
    let mut read_ahead_saga = make_card(
        CardId(1),
        "Read Ahead Saga",
        "Enchantment Saga",
        vec!["Read ahead"],
        ZoneType::Battlefield,
    );
    add_chapter_trigger(&mut read_ahead_saga, 3);
    let read_ahead_saga = game.create_card(read_ahead_saga);
    assert_eq!(card_to_dto(&game, read_ahead_saga).final_chapter, Some(3));
    let mut nonbattlefield_saga = make_card(
        CardId(2),
        "Hand Saga",
        "Enchantment Saga",
        vec![],
        ZoneType::Hand,
    );
    add_chapter_trigger(&mut nonbattlefield_saga, 3);
    let nonbattlefield_saga = game.create_card(nonbattlefield_saga);
    let nonbattlefield_class = game.create_card({
        let mut card = make_card(
            CardId(3),
            "Hand Class",
            "Enchantment Class",
            vec![],
            ZoneType::Hand,
        );
        card.set_class_level(3);
        card
    });
    let generic_level = game.create_card({
        let mut card = make_card(
            CardId(4),
            "Level Counter",
            "Creature",
            vec![],
            ZoneType::Battlefield,
        );
        card.set_class_level(4);
        card
    });

    for id in [
        face_down_saga,
        nonbattlefield_saga,
        nonbattlefield_class,
        generic_level,
    ] {
        let dto = card_to_dto(&game, id);
        assert_eq!(dto.final_chapter, None);
        assert_eq!(dto.class_level, None);
    }
}
