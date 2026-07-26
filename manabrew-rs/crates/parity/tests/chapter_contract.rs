use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::thread;

use forge_carddb::parse_card_script;
use forge_foundation::ZoneType;
use manabrew_engine::ability::effects::counters_put_all_effect::CountersPutAllEffect;
use manabrew_engine::ability::effects::counters_put_effect::CountersPutEffect;
use manabrew_engine::ability::effects::move_counter_effect::MoveCounterEffect;
use manabrew_engine::ability::effects::EffectContext;
use manabrew_engine::ability::spell_ability_effect::SpellAbilityEffect;
use manabrew_engine::agent::{PassAgent, PlayerAgent, PriorityActionSpace, TargetChoice};
use manabrew_engine::card::{Card, CounterType};
use manabrew_engine::combat::DefenderId;
use manabrew_engine::event::RunParams;
use manabrew_engine::game::GameState;
use manabrew_engine::game_loop::GameLoop;
use manabrew_engine::game_rng::ThreadRngAdapter;
use manabrew_engine::ids::{CardId, PlayerId};
use manabrew_engine::mana::ManaPool;
use manabrew_engine::player::actions::PlayerAction;
use manabrew_engine::spellability::{build_spell_ability_for_card_cast, SpellAbility, StackEntry};
use manabrew_engine::trigger::handler::TriggerHandler;
use manabrew_engine::trigger::TriggerType;
use parity::runtime::PARITY_THREAD_STACK_SIZE;
use rand::{rngs::StdRng, SeedableRng};

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .expect("workspace root resolves")
}

fn card_from_script(path: &str) -> Card {
    card_from_script_for_player(path, PlayerId(0))
}

fn card_from_script_for_player(path: &str, player: PlayerId) -> Card {
    let path = workspace_root().join(path);
    let script = fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!("read {}: {error}", path.display());
    });
    let rules = parse_card_script(&script).unwrap_or_else(|error| {
        panic!("parse {}: {error}", path.display());
    });
    Card::from_rules(&rules, player)
}

fn pass_agents() -> Vec<Box<dyn PlayerAgent>> {
    vec![Box::new(PassAgent), Box::new(PassAgent)]
}

struct ChooseMaximumAgent;

impl PlayerAgent for ChooseMaximumAgent {
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
        _player: PlayerId,
        _action_space: Option<&PriorityActionSpace>,
        _request_action_space: &mut dyn FnMut() -> PriorityActionSpace,
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

    fn choose_targets_for(
        &mut self,
        _sa: &mut SpellAbility,
        _game: &GameState,
        _mana_pools: &[ManaPool],
    ) -> bool {
        true
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
    ) -> TargetChoice {
        if let Some(&player) = valid_players.first() {
            TargetChoice::Player(player)
        } else if let Some(&card) = valid_cards.first() {
            TargetChoice::Card(card)
        } else {
            TargetChoice::None
        }
    }

    fn choose_land_or_spell(&mut self, _player: PlayerId) -> Option<bool> {
        None
    }

    fn choose_number(
        &mut self,
        _player: PlayerId,
        _source: Option<manabrew_engine::ids::CardId>,
        _title: &str,
        _description: Option<&str>,
        _min: i32,
        max: i32,
    ) -> Option<i32> {
        Some(max)
    }
}

fn stack_entry(spell_ability: SpellAbility, is_permanent_spell: bool) -> StackEntry {
    StackEntry {
        id: 1,
        spell_ability,
        is_pending_cast: false,
        is_creature_spell: false,
        is_permanent_spell,
        cast_from_zone: Some(ZoneType::Hand),
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    }
}

fn resolve_permanent(game: &mut GameState, card: manabrew_engine::ids::CardId) {
    game.move_card(card, ZoneType::Stack, PlayerId(0));
    let spell = build_spell_ability_for_card_cast(game, card, PlayerId(0));
    game.stack.push(stack_entry(spell, true));

    let mut game_loop = GameLoop::new(2);
    let mut agents = pass_agents();
    game_loop.resolve_stack(game, &mut agents);
}

fn history_on_battlefield() -> (GameState, manabrew_engine::ids::CardId) {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let history = game.create_card(card_from_script(
        "forge/forge-gui/res/cardsfolder/h/history_of_benalia.txt",
    ));
    resolve_permanent(&mut game, history);

    (game, history)
}

fn saga_lifecycle_probe(type_line: &str, keywords: &str, replacement: &str) -> Card {
    let rules = parse_card_script(&format!(
        "Name:Saga Lifecycle Probe\nTypes:{type_line}\n{keywords}\nSVar:ChapterOne:DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ 1{replacement}"
    ))
    .expect("Saga lifecycle probe parses structurally");

    Card::from_rules(&rules, PlayerId(0))
}

fn chapter_probe() -> Card {
    let rules = parse_card_script(
        "Name:Chapter Probe\nTypes:Enchantment Saga\nSVar:ChapterOne:DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ 1\nSVar:ChapterTwo:DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ 10\nSVar:ChapterThree:DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ 100\nT:Mode$ CounterAdded | ValidCard$ Card.Self | TriggerZones$ Battlefield | Chapter$ 1 | CounterType$ LORE | CounterAmount$ EQ1 | Execute$ ChapterOne\nT:Mode$ CounterAdded | ValidCard$ Card.Self | TriggerZones$ Battlefield | Chapter$ 2 | CounterType$ LORE | CounterAmount$ EQ2 | Execute$ ChapterTwo\nT:Mode$ CounterAdded | ValidCard$ Card.Self | TriggerZones$ Battlefield | Chapter$ 3 | CounterType$ LORE | CounterAmount$ EQ3 | Execute$ ChapterThree",
    )
    .expect("Chapter probe parses structurally");

    Card::from_rules(&rules, PlayerId(0))
}

fn chapter_probe_with_static_ability(static_ability: &str) -> Card {
    let rules = parse_card_script(&format!(
        "Name:Chapter Probe\nTypes:Enchantment Saga\n{static_ability}SVar:ChapterOne:DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ 1\nSVar:ChapterTwo:DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ 10\nSVar:ChapterThree:DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ 100\nT:Mode$ CounterAdded | ValidCard$ Card.Self | TriggerZones$ Battlefield | Chapter$ 1 | CounterType$ LORE | CounterAmount$ EQ1 | Execute$ ChapterOne\nT:Mode$ CounterAdded | ValidCard$ Card.Self | TriggerZones$ Battlefield | Chapter$ 2 | CounterType$ LORE | CounterAmount$ EQ2 | Execute$ ChapterTwo\nT:Mode$ CounterAdded | ValidCard$ Card.Self | TriggerZones$ Battlefield | Chapter$ 3 | CounterType$ LORE | CounterAmount$ EQ3 | Execute$ ChapterThree",
    ))
    .expect("Chapter probe parses structurally");

    Card::from_rules(&rules, PlayerId(0))
}

fn final_chapter_saga() -> (
    GameState,
    manabrew_engine::ids::CardId,
    TriggerHandler,
    PlayerId,
) {
    let player = PlayerId(0);
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let saga = game.create_card(chapter_probe());
    resolve_permanent(&mut game, saga);
    game.card_mut(saga).add_counter(&CounterType::Lore, 2);

    let mut trigger_handler = TriggerHandler::new();
    trigger_handler.register_active_trigger(&game, saga);

    (game, saga, trigger_handler, player)
}

fn queue_final_chapter_trigger(
    trigger_handler: &mut TriggerHandler,
    saga: manabrew_engine::ids::CardId,
    player: PlayerId,
) {
    trigger_handler.run_trigger(
        TriggerType::CounterAdded,
        RunParams {
            card: Some(saga),
            player: Some(player),
            counter_type: Some("Lore".to_string()),
            counter_amount: Some(3),
            ..Default::default()
        },
        false,
    );
}

fn counter_event_probe(double_counters: bool) -> Card {
    let replacement = if double_counters {
        "\nR:Event$ AddCounter | ActiveZones$ Battlefield | ValidCard$ Card.Self+inZoneBattlefield | EffectOnly$ True | ReplaceWith$ DoubleCounters"
    } else {
        ""
    };
    counter_event_probe_with_rules(replacement, "")
}

fn counter_event_probe_with_rules(replacement: &str, static_ability: &str) -> Card {
    let rules = parse_card_script(&format!(
        "Name:Counter Event Probe\nTypes:Creature\nSVar:AtOne:DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ 1\nSVar:AtTwo:DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ 2\nSVar:AtThree:DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ 3\nSVar:AtFour:DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ 4\nSVar:AtFive:DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ 5\nSVar:Once:DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ 100\nT:Mode$ CounterAdded | ValidCard$ Card.Self | TriggerZones$ Battlefield | CounterType$ LORE | CounterAmount$ EQ1 | Execute$ AtOne\nT:Mode$ CounterAdded | ValidCard$ Card.Self | TriggerZones$ Battlefield | CounterType$ LORE | CounterAmount$ EQ2 | Execute$ AtTwo\nT:Mode$ CounterAdded | ValidCard$ Card.Self | TriggerZones$ Battlefield | CounterType$ LORE | CounterAmount$ EQ3 | Execute$ AtThree\nT:Mode$ CounterAdded | ValidCard$ Card.Self | TriggerZones$ Battlefield | CounterType$ LORE | CounterAmount$ EQ4 | Execute$ AtFour\nT:Mode$ CounterAdded | ValidCard$ Card.Self | TriggerZones$ Battlefield | CounterType$ LORE | CounterAmount$ EQ5 | Execute$ AtFive\nT:Mode$ CounterAddedOnce | ValidCard$ Card.Self | TriggerZones$ Battlefield | CounterType$ LORE | Execute$ Once{static_ability}{replacement}"
    ))
    .expect("counter event probe parses structurally");

    Card::from_rules(&rules, PlayerId(0))
}

fn resolve_put_counter(
    game: &mut GameState,
    trigger_handler: &mut TriggerHandler,
    ability: &SpellAbility,
) {
    resolve_effect::<CountersPutEffect>(game, trigger_handler, ability);
}

fn resolve_effect<E: SpellAbilityEffect>(
    game: &mut GameState,
    trigger_handler: &mut TriggerHandler,
    ability: &SpellAbility,
) {
    let mut agents = pass_agents();
    let mut mana_pools = vec![ManaPool::default(), ManaPool::default()];
    let token_templates = HashMap::new();
    let token_art_variants = HashMap::new();
    let token_fallback = HashMap::new();
    let edition_dates = HashMap::new();
    let mut rng = ThreadRngAdapter;
    let mut ctx = EffectContext {
        game,
        combat: None,
        agents: &mut agents,
        trigger_handler,
        token_templates: &token_templates,
        token_art_variants: &token_art_variants,
        token_fallback: &token_fallback,
        edition_dates: &edition_dates,
        mana_pools: &mut mana_pools,
        parent_target_card: None,
        rng: &mut rng,
    };

    E::resolve(&mut ctx, ability);
}

fn counter_added_once_amounts(
    pending: &[manabrew_engine::trigger::handler::PendingTrigger],
) -> Vec<String> {
    pending
        .iter()
        .filter_map(|trigger| {
            trigger
                .entry
                .spell_ability
                .get_triggering_object(manabrew_engine::ability::AbilityKey::Amount)
                .map(str::to_string)
        })
        .collect()
}

fn set_lore_total(game: &mut GameState, card: manabrew_engine::ids::CardId, total: i32) {
    let current = game.card(card).counter_count(&CounterType::Lore);
    game.card_mut(card)
        .remove_counter(&CounterType::Lore, current);
    game.card_mut(card).add_counter(&CounterType::Lore, total);
}

#[test]
fn fixture_cards_construct_from_current_forge_scripts() {
    let history = card_from_script("forge/forge-gui/res/cardsfolder/h/history_of_benalia.txt");
    let phasing = card_from_script("forge/forge-gui/res/cardsfolder/t/the_phasing_of_zhalfir.txt");

    assert_eq!(history.card_name, "History of Benalia");
    assert_eq!(phasing.card_name, "The Phasing of Zhalfir");
}

#[test]
fn history_of_benalia_lowers_ordered_cumulative_chapter_triggers() {
    let history = card_from_script("forge/forge-gui/res/cardsfolder/h/history_of_benalia.txt");
    let chapters: Vec<_> = history
        .triggers
        .iter()
        .filter(|trigger| trigger.is_chapter())
        .collect();

    assert_eq!(
        chapters.len(),
        3,
        "History of Benalia must lower all chapters"
    );
    assert_eq!(
        chapters
            .iter()
            .map(|trigger| trigger.get_chapter())
            .collect::<Vec<_>>(),
        vec![Some(1), Some(2), Some(3)],
        "Chapter triggers must match each resulting cumulative Lore total"
    );
    assert!(
        chapters
            .iter()
            .all(|trigger| trigger.kind == TriggerType::CounterAdded),
        "Chapter triggers must observe Lore CounterAdded events"
    );
    assert_eq!(chapters[0].description, chapters[1].description);
    assert!(chapters[0].description.starts_with("I, II — "));
    assert!(!chapters[0].base.card_trait_base.is_secondary());
    assert!(chapters[1].base.card_trait_base.is_secondary());
    assert!(!chapters[2].base.card_trait_base.is_secondary());
    assert_eq!(history.get_final_chapter_nr(), 3);
    assert!(chapters[2].is_last_chapter(&history));
    assert!(chapters[2].get_overriding_ability().is_none());
}

#[test]
fn chapter_triggers_follow_printed_triggers_in_registration_order() {
    let rules = parse_card_script(
        "Name:Chapter Order Probe\nTypes:Enchantment Saga\nK:Chapter:1:ChapterOne\nSVar:ChapterOne:DB$ Draw | Defined$ You | NumCards$ 1\nT:Mode$ ChangesZone | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ PrintedTrigger",
    )
    .expect("Chapter order probe parses structurally");
    let card = Card::from_rules(&rules, PlayerId(0));
    let printed_trigger = card
        .triggers
        .iter()
        .find(|trigger| !trigger.is_chapter())
        .expect("Chapter order probe has a printed trigger");
    let chapter_trigger = card
        .triggers
        .iter()
        .find(|trigger| trigger.is_chapter())
        .expect("Chapter order probe has a Chapter trigger");

    assert!(printed_trigger.id < chapter_trigger.id);
}

#[test]
fn chapter_helpers_and_svars_follow_live_chapter_triggers() {
    let player = PlayerId(0);
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let saga = game.create_card(card_from_script(
        "forge/forge-gui/res/cardsfolder/h/history_of_benalia.txt",
    ));
    let last_chapter = game.card(saga).triggers[2].clone();
    let last_chapter_ability =
        last_chapter.build_triggered_spell_ability(&game, saga, player, 2, &Default::default());
    let counter_ability = SpellAbility::new_simple(
        Some(saga),
        player,
        "DB$ PutCounter | Defined$ Self | CounterType$ LORE | CounterNum$ Count$FinalChapterNr",
    );

    assert!(game.card(saga).has_chapter());
    assert_eq!(game.card(saga).get_final_chapter_nr(), 3);
    assert!(last_chapter.is_last_chapter(game.card(saga)));
    assert!(last_chapter_ability.is_last_chapter(&game));
    assert_eq!(
        manabrew_engine::svar::resolve_numeric_svar(&game, &counter_ability, "CounterNum", 0,),
        3
    );

    game.card_mut(saga).triggers.pop();

    assert_eq!(game.card(saga).get_final_chapter_nr(), 2);
    assert!(!last_chapter.is_last_chapter(game.card(saga)));
    assert!(!last_chapter_ability.is_last_chapter(&game));
    assert_eq!(
        manabrew_engine::svar::resolve_numeric_svar(&game, &counter_ability, "CounterNum", 0,),
        2
    );
}

#[test]
fn chapter_trigger_resolves_the_current_host_svar() {
    let player = PlayerId(0);
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let saga = game.create_card(card_from_script(
        "forge/forge-gui/res/cardsfolder/h/history_of_benalia.txt",
    ));
    game.card_mut(saga).set_s_var(
        "DBToken",
        "DB$ Draw | Defined$ You | NumCards$ 1 | SpellDescription$ Draw a card.",
    );
    let chapter = game.card(saga).triggers[0].clone();
    let ability =
        chapter.build_triggered_spell_ability(&game, saga, player, 0, &Default::default());

    assert_eq!(
        ability.api,
        Some(manabrew_engine::ability::api_type::ApiType::Draw)
    );
}

#[test]
fn chapter_count_and_ability_list_mismatch_is_rejected() {
    let rules = parse_card_script(
        "Name:Malformed Chapter\nManaCost:1 W\nTypes:Enchantment Saga\nK:Chapter:3:DBOne,DBTwo\nSVar:DBOne:DB$ PumpAll | ValidCards$ Card.Self\nSVar:DBTwo:DB$ PumpAll | ValidCards$ Card.Self",
    )
    .expect("malformed Chapter fixture parses structurally");

    let result = std::panic::catch_unwind(|| Card::from_rules(&rules, PlayerId(0)));

    assert!(
        result.is_err(),
        "Chapter count/list mismatch must be rejected"
    );
}

#[test]
fn intrinsic_read_ahead_saga_lowers_chapter_triggers() {
    let phasing = card_from_script("forge/forge-gui/res/cardsfolder/t/the_phasing_of_zhalfir.txt");

    assert!(phasing
        .visit_keywords()
        .iter()
        .any(|keyword| keyword == "Read ahead"));
    let chapters: Vec<_> = phasing
        .triggers
        .iter()
        .filter_map(|trigger| trigger.get_chapter())
        .collect();
    assert_eq!(chapters, vec![1, 2, 3]);
    assert_eq!(phasing.get_final_chapter_nr(), 3);
    let read_ahead = phasing
        .replacement_effects
        .iter()
        .find(|replacement| {
            replacement
                .base
                .get_overriding_ability()
                .is_some_and(|ability| ability.ir.up_to)
        })
        .expect("Read ahead ETB replacement");
    let ability = read_ahead
        .base
        .get_overriding_ability()
        .expect("Read ahead counter ability");
    assert_eq!(ability.ir.counter_type_text.as_deref(), Some("LORE"));
    assert_eq!(
        ability.ir.counter_num_text.as_deref(),
        Some("Count$FinalChapterNr")
    );
}

#[test]
fn standard_saga_gets_lore_when_its_permanent_spell_resolves() {
    let (game, history) = history_on_battlefield();

    assert_eq!(game.card(history).zone, ZoneType::Battlefield);
    assert_eq!(
        game.card(history).counter_count(&CounterType::Lore),
        1,
        "a standard Saga enters with one Lore counter"
    );
}

#[test]
fn standard_saga_gets_lore_on_each_battlefield_entry() {
    let player = PlayerId(0);
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let history = game.create_card(chapter_probe());

    game.move_card(history, ZoneType::Battlefield, player);
    assert_eq!(game.card(history).counter_count(&CounterType::Lore), 1);

    game.move_card(history, ZoneType::Graveyard, player);
    game.move_card(history, ZoneType::Battlefield, player);
    assert_eq!(game.card(history).counter_count(&CounterType::Lore), 1);
}

#[test]
fn saga_token_gets_lore_on_battlefield_entry() {
    let player = PlayerId(0);
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let mut token = chapter_probe();
    token.is_token = true;
    let saga = game.create_card(token);

    game.move_card(saga, ZoneType::Battlefield, player);

    assert_eq!(game.card(saga).counter_count(&CounterType::Lore), 1);
}

#[test]
fn standard_saga_advances_at_its_controllers_precombat_main() {
    thread::scope(|scope| {
        let handle = thread::Builder::new()
            .name("standard_saga_advances_at_its_controllers_precombat_main".to_string())
            .stack_size(PARITY_THREAD_STACK_SIZE)
            .spawn_scoped(scope, || {
                let player = PlayerId(0);
                let mut game = GameState::new(&["Alice", "Bob"], 20);
                let history = game.create_card(chapter_probe());
                resolve_permanent(&mut game, history);
                set_lore_total(&mut game, history, 1);

                let mut game_loop = GameLoop::new(2);
                game_loop
                    .trigger_handler
                    .register_active_trigger(&game, history);
                let mut agents = pass_agents();
                let mut rng = StdRng::seed_from_u64(42);
                game.turn.active_player = player;
                game.turn.priority_player = player;
                game_loop.run_turn(&mut game, &mut agents, &mut rng);

                assert_eq!(
                    game.card(history).counter_count(&CounterType::Lore),
                    2,
                    "a Saga with its ETB Lore counter advances once at its controller's precombat main"
                );
            })
            .expect("failed to spawn precombat saga test thread");

        if let Err(panic) = handle.join() {
            std::panic::resume_unwind(panic);
        }
    });
}

#[test]
fn saga_etb_lore_uses_the_replacement_aware_counter_seam() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let saga = game.create_card(saga_lifecycle_probe(
        "Enchantment Saga",
        "K:Chapter:1:ChapterOne",
        "\nR:Event$ AddCounter | ActiveZones$ Battlefield | ValidCard$ Card.Self+inZoneBattlefield | EffectOnly$ True | ReplaceWith$ DoubleCounters",
    ));

    resolve_permanent(&mut game, saga);

    assert_eq!(game.card(saga).counter_count(&CounterType::Lore), 2);
}

#[test]
fn saga_etb_lore_respects_counter_prevention() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let saga = game.create_card(saga_lifecycle_probe(
        "Enchantment Saga",
        "K:Chapter:1:ChapterOne",
        "\nR:Event$ AddCounter | ActiveZones$ Battlefield | ValidCard$ Card.Self+inZoneBattlefield | EffectOnly$ True",
    ));

    resolve_permanent(&mut game, saga);

    assert_eq!(game.card(saga).counter_count(&CounterType::Lore), 0);
}

#[test]
fn automatic_saga_lore_requires_saga_and_structured_chapter_identity() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let non_saga_chapter = game.create_card(saga_lifecycle_probe(
        "Enchantment",
        "K:Chapter:1:ChapterOne",
        "",
    ));
    let saga_without_chapter = game.create_card(saga_lifecycle_probe("Enchantment Saga", "", ""));

    resolve_permanent(&mut game, non_saga_chapter);
    resolve_permanent(&mut game, saga_without_chapter);

    assert_eq!(
        game.card(non_saga_chapter)
            .counter_count(&CounterType::Lore),
        0
    );
    assert_eq!(
        game.card(saga_without_chapter)
            .counter_count(&CounterType::Lore),
        0
    );
}

#[test]
fn read_ahead_starts_at_the_chosen_chapter() {
    thread::scope(|scope| {
        let handle = thread::Builder::new()
            .name("read_ahead_starts_at_the_chosen_chapter".to_string())
            .stack_size(PARITY_THREAD_STACK_SIZE)
            .spawn_scoped(scope, || {
                let mut game = GameState::new(&["Alice", "Bob"], 20);
                let read_ahead = game.create_card(card_from_script(
                    "forge/forge-gui/res/cardsfolder/t/the_phasing_of_zhalfir.txt",
                ));
                game.move_card(read_ahead, ZoneType::Stack, PlayerId(0));
                let spell = build_spell_ability_for_card_cast(&game, read_ahead, PlayerId(0));
                game.stack.push(stack_entry(spell, true));

                let mut game_loop = GameLoop::new(2);
                let mut agents: Vec<Box<dyn PlayerAgent>> =
                    vec![Box::new(ChooseMaximumAgent), Box::new(PassAgent)];
                game_loop.resolve_stack(&mut game, &mut agents);

                assert_eq!(game.card(read_ahead).counter_count(&CounterType::Lore), 3);
                let pending = game_loop.trigger_handler.run_waiting_triggers(&game);
                assert_eq!(pending.len(), 1);
                let trigger_id = pending[0]
                    .entry
                    .spell_ability
                    .source_trigger_id
                    .expect("chapter trigger id");
                let chapter = game
                    .card(read_ahead)
                    .triggers
                    .iter()
                    .find(|trigger| trigger.id == trigger_id)
                    .and_then(|trigger| trigger.get_chapter());
                assert_eq!(chapter, Some(3));
            })
            .expect("failed to spawn Read ahead test thread");

        if let Err(panic) = handle.join() {
            std::panic::resume_unwind(panic);
        }
    });
}

#[test]
fn final_chapter_saga_waiting_trigger_stays_on_battlefield() {
    let (mut game, saga, mut trigger_handler, _player) = final_chapter_saga();
    queue_final_chapter_trigger(&mut trigger_handler, saga, PlayerId(0));
    let mut agents = pass_agents();

    assert!(!game
        .check_state_based_actions_with_trigger_agents(Some(&mut trigger_handler), &mut agents,));
    assert_eq!(game.card(saga).zone, ZoneType::Battlefield);
    assert_eq!(trigger_handler.waiting_trigger_count(), 1);
}

#[test]
fn final_chapter_saga_on_stack_stays_on_battlefield() {
    thread::scope(|scope| {
        let handle = thread::Builder::new()
            .name("final_chapter_saga_on_stack_stays_on_battlefield".to_string())
            .stack_size(PARITY_THREAD_STACK_SIZE)
            .spawn_scoped(scope, || {
                let (mut game, saga, mut trigger_handler, _player) = final_chapter_saga();
                queue_final_chapter_trigger(&mut trigger_handler, saga, PlayerId(0));
                let pending = trigger_handler.run_waiting_triggers(&game);
                game.stack
                    .push(pending.into_iter().next().expect("chapter pending").entry);
                let mut agents = pass_agents();

                assert!(!game.check_state_based_actions_with_trigger_agents(
                    Some(&mut trigger_handler),
                    &mut agents,
                ));
                assert_eq!(game.card(saga).zone, ZoneType::Battlefield);
                assert_eq!(game.stack.len(), 1);
            })
            .expect("spawn saga stack test thread");
        handle
            .join()
            .expect("final_chapter_saga_on_stack_stays_on_battlefield panicked");
    });
}

#[test]
fn final_chapter_saga_resolving_then_clearing_sacrifices_on_next_sba() {
    thread::scope(|scope| {
        let handle = thread::Builder::new()
            .name("final_chapter_saga_resolving_then_clearing_sacrifices_on_next_sba".to_string())
            .stack_size(PARITY_THREAD_STACK_SIZE)
            .spawn_scoped(scope, || {
                let (mut game, saga, mut trigger_handler, _player) = final_chapter_saga();
                queue_final_chapter_trigger(&mut trigger_handler, saga, PlayerId(0));
                let pending = trigger_handler.run_waiting_triggers(&game);
                game.stack
                    .push(pending.into_iter().next().expect("chapter pending").entry);
                let _resolving = game.stack.resolve_stack().expect("chapter resolves");
                let mut agents = pass_agents();

                assert!(!game.check_state_based_actions_with_trigger_agents(
                    Some(&mut trigger_handler),
                    &mut agents,
                ));
                game.stack.finish_resolving();
                let mut agents = pass_agents();

                assert!(game.check_state_based_actions_with_trigger_agents(
                    Some(&mut trigger_handler),
                    &mut agents,
                ));
                assert_eq!(game.card(saga).zone, ZoneType::Graveyard);
            })
            .expect("spawn saga sba test thread");
        handle
            .join()
            .expect("final_chapter_saga_resolving_then_clearing_sacrifices_on_next_sba panicked");
    });
}

#[test]
fn final_chapter_saga_cannot_sacrifice_stays_on_battlefield() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let saga = game.create_card(chapter_probe_with_static_ability(
        "\nS:Mode$ CantSacrifice | ValidCard$ Card.Self\n",
    ));
    resolve_permanent(&mut game, saga);
    set_lore_total(&mut game, saga, 3);

    let mut trigger_handler = TriggerHandler::new();
    trigger_handler.register_active_trigger(&game, saga);
    let mut agents = pass_agents();

    assert!(!game
        .check_state_based_actions_with_trigger_agents(Some(&mut trigger_handler), &mut agents,));
    assert_eq!(game.card(saga).zone, ZoneType::Battlefield);
}

#[test]
fn unrelated_source_spell_does_not_block_final_saga_sacrifice() {
    let (mut game, saga, mut trigger_handler, _player) = final_chapter_saga();
    let unrelated = SpellAbility::new_simple(
        Some(saga),
        PlayerId(0),
        "DB$ Draw | Defined$ You | NumCards$ 1",
    );
    game.stack.push(stack_entry(unrelated, false));
    let mut agents = pass_agents();

    assert!(game
        .check_state_based_actions_with_trigger_agents(Some(&mut trigger_handler), &mut agents,));
    assert_eq!(game.card(saga).zone, ZoneType::Graveyard);
}

#[test]
fn multi_lore_addition_observes_cumulative_chapter_totals_in_order() {
    let player = PlayerId(0);
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let saga = game.create_card(chapter_probe());
    resolve_permanent(&mut game, saga);
    set_lore_total(&mut game, saga, 1);

    let ability = SpellAbility::new_simple(
        Some(saga),
        player,
        "DB$ PutCounter | Defined$ Self | CounterType$ LORE | CounterNum$ 2",
    );

    let mut game_loop = GameLoop::new(2);
    game_loop
        .trigger_handler
        .register_active_trigger(&game, saga);
    let mut agents = pass_agents();
    resolve_put_counter(&mut game, &mut game_loop.trigger_handler, &ability);
    game_loop.trigger_handler.process_waiting_triggers(
        &game_loop.mana_pools,
        &mut game,
        &mut agents,
    );
    while !game.stack.is_empty() {
        game_loop.resolve_stack(&mut game, &mut agents);
        game_loop.trigger_handler.process_waiting_triggers(
            &game_loop.mana_pools,
            &mut game,
            &mut agents,
        );
    }

    assert_eq!(
        game.card(saga).counter_count(&CounterType::P1P1),
        110,
        "a two-Lore addition from total one must observe Chapter totals two then three"
    );
}

#[test]
fn counter_added_uses_cumulative_totals_and_counter_added_once_uses_the_delta() {
    let player = PlayerId(0);
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let probe = game.create_card(counter_event_probe(false));
    game.move_card(probe, ZoneType::Battlefield, player);
    game.card_mut(probe).add_counter(&CounterType::Lore, 1);

    let mut trigger_handler = TriggerHandler::new();
    trigger_handler.register_active_trigger(&game, probe);
    let ability = SpellAbility::new_simple(
        Some(probe),
        player,
        "DB$ PutCounter | Defined$ Self | CounterType$ LORE | CounterNum$ 2",
    );
    resolve_put_counter(&mut game, &mut trigger_handler, &ability);
    let pending = trigger_handler.run_waiting_triggers(&game);

    assert_eq!(game.card(probe).counter_count(&CounterType::Lore), 3);
    assert_eq!(pending.len(), 3);
    assert_eq!(counter_added_once_amounts(&pending), vec!["2"]);
}

#[test]
fn counter_added_uses_post_replacement_cumulative_totals() {
    let player = PlayerId(0);
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let probe = game.create_card(counter_event_probe(true));
    game.move_card(probe, ZoneType::Battlefield, player);
    game.card_mut(probe).add_counter(&CounterType::Lore, 1);

    let mut trigger_handler = TriggerHandler::new();
    trigger_handler.register_active_trigger(&game, probe);
    let ability = SpellAbility::new_simple(
        Some(probe),
        player,
        "DB$ PutCounter | Defined$ Self | CounterType$ LORE | CounterNum$ 2",
    );
    resolve_put_counter(&mut game, &mut trigger_handler, &ability);
    let pending = trigger_handler.run_waiting_triggers(&game);

    assert_eq!(game.card(probe).counter_count(&CounterType::Lore), 5);
    assert_eq!(pending.len(), 5);
    assert_eq!(counter_added_once_amounts(&pending), vec!["4"]);
}

#[test]
fn counters_put_all_uses_post_replacement_counter_totals() {
    let player = PlayerId(0);
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let probe = game.create_card(counter_event_probe(true));
    game.move_card(probe, ZoneType::Battlefield, player);
    game.card_mut(probe).add_counter(&CounterType::Lore, 1);

    let mut trigger_handler = TriggerHandler::new();
    trigger_handler.register_active_trigger(&game, probe);
    let ability = SpellAbility::new_simple(
        Some(probe),
        player,
        "DB$ PutCounterAll | ValidCards$ Creature | CounterType$ LORE | CounterNum$ 2",
    );
    resolve_effect::<CountersPutAllEffect>(&mut game, &mut trigger_handler, &ability);
    let pending = trigger_handler.run_waiting_triggers(&game);

    assert_eq!(game.card(probe).counter_count(&CounterType::Lore), 5);
    assert_eq!(pending.len(), 5);
    assert_eq!(counter_added_once_amounts(&pending), vec!["4"]);
}

#[test]
fn move_counter_keeps_the_requested_source_delta_after_destination_replacement() {
    let player = PlayerId(0);
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let source = game.create_card(counter_event_probe(false));
    let destination = game.create_card(counter_event_probe(true));
    game.move_card(source, ZoneType::Battlefield, player);
    game.move_card(destination, ZoneType::Battlefield, player);
    game.card_mut(source).add_counter(&CounterType::Lore, 2);
    game.card_mut(destination)
        .add_counter(&CounterType::Lore, 1);

    let mut trigger_handler = TriggerHandler::new();
    trigger_handler.register_active_trigger(&game, destination);
    let mut ability = SpellAbility::new_simple(
        Some(source),
        player,
        "DB$ MoveCounter | Source$ Self | Defined$ Targeted | CounterType$ LORE | CounterNum$ 2",
    );
    ability.target_chosen.target_card = Some(destination);
    resolve_effect::<MoveCounterEffect>(&mut game, &mut trigger_handler, &ability);
    let pending = trigger_handler.run_waiting_triggers(&game);

    assert_eq!(game.card(source).counter_count(&CounterType::Lore), 0);
    assert_eq!(game.card(destination).counter_count(&CounterType::Lore), 5);
    assert_eq!(pending.len(), 5);
    assert_eq!(counter_added_once_amounts(&pending), vec!["4"]);
}

#[test]
fn counter_added_prevention_leaves_counters_and_events_unchanged() {
    let player = PlayerId(0);
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let probe = game.create_card(counter_event_probe_with_rules(
        "\nR:Event$ AddCounter | ActiveZones$ Battlefield | ValidCard$ Card.Self+inZoneBattlefield | EffectOnly$ True",
        "",
    ));
    game.move_card(probe, ZoneType::Battlefield, player);
    game.card_mut(probe).add_counter(&CounterType::Lore, 1);

    let mut trigger_handler = TriggerHandler::new();
    trigger_handler.register_active_trigger(&game, probe);
    let ability = SpellAbility::new_simple(
        Some(probe),
        player,
        "DB$ PutCounter | Defined$ Self | CounterType$ LORE | CounterNum$ 2",
    );
    resolve_put_counter(&mut game, &mut trigger_handler, &ability);

    assert_eq!(game.card(probe).counter_count(&CounterType::Lore), 1);
    assert_eq!(trigger_handler.waiting_trigger_count(), 0);
}

#[test]
fn counter_added_clamps_doubled_replacement_to_max_counter() {
    let player = PlayerId(0);
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let probe = game.create_card(counter_event_probe_with_rules(
        "\nR:Event$ AddCounter | ActiveZones$ Battlefield | ValidCard$ Card.Self+inZoneBattlefield | EffectOnly$ True | ReplaceWith$ DoubleCounters",
        "\nS:Mode$ MaxCounter | ValidCard$ Card.Self | CounterType$ LORE | MaxNum$ 3",
    ));
    game.move_card(probe, ZoneType::Battlefield, player);
    game.card_mut(probe).add_counter(&CounterType::Lore, 1);

    let mut trigger_handler = TriggerHandler::new();
    trigger_handler.register_active_trigger(&game, probe);
    let ability = SpellAbility::new_simple(
        Some(probe),
        player,
        "DB$ PutCounter | Defined$ Self | CounterType$ LORE | CounterNum$ 2",
    );
    resolve_put_counter(&mut game, &mut trigger_handler, &ability);
    let pending = trigger_handler.run_waiting_triggers(&game);

    assert_eq!(game.card(probe).counter_count(&CounterType::Lore), 3);
    assert_eq!(pending.len(), 3);
    assert_eq!(counter_added_once_amounts(&pending), vec!["2"]);
}

#[test]
fn move_counter_removes_source_when_destination_replacement_prevents_placement() {
    let player = PlayerId(0);
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let source = game.create_card(counter_event_probe(false));
    let destination = game.create_card(counter_event_probe_with_rules(
        "\nR:Event$ AddCounter | ActiveZones$ Battlefield | ValidCard$ Card.Self+inZoneBattlefield | EffectOnly$ True",
        "",
    ));
    game.move_card(source, ZoneType::Battlefield, player);
    game.move_card(destination, ZoneType::Battlefield, player);
    game.card_mut(source).add_counter(&CounterType::Lore, 2);
    game.card_mut(destination)
        .add_counter(&CounterType::Lore, 1);

    let mut trigger_handler = TriggerHandler::new();
    let mut ability = SpellAbility::new_simple(
        Some(source),
        player,
        "DB$ MoveCounter | Source$ Self | Defined$ Targeted | CounterType$ LORE | CounterNum$ 2",
    );
    ability.target_chosen.target_card = Some(destination);
    resolve_effect::<MoveCounterEffect>(&mut game, &mut trigger_handler, &ability);

    assert_eq!(game.card(source).counter_count(&CounterType::Lore), 0);
    assert_eq!(game.card(destination).counter_count(&CounterType::Lore), 1);
}

#[test]
fn counter_added_does_not_emit_for_zero_placement() {
    let player = PlayerId(0);
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let probe = game.create_card(counter_event_probe(false));
    game.move_card(probe, ZoneType::Battlefield, player);

    let mut trigger_handler = TriggerHandler::new();
    trigger_handler.register_active_trigger(&game, probe);
    let ability = SpellAbility::new_simple(
        Some(probe),
        player,
        "DB$ PutCounter | Defined$ Self | CounterType$ LORE | CounterNum$ 0",
    );
    resolve_put_counter(&mut game, &mut trigger_handler, &ability);

    assert_eq!(trigger_handler.waiting_trigger_count(), 0);
}

#[test]
fn counter_added_ignores_counter_amount_when_the_event_omits_it() {
    let player = PlayerId(0);
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let probe = game.create_card(counter_event_probe(false));
    game.move_card(probe, ZoneType::Battlefield, player);

    let mut trigger_handler = TriggerHandler::new();
    trigger_handler.register_active_trigger(&game, probe);
    let matched = trigger_handler.get_active_trigger(
        &game,
        TriggerType::CounterAdded,
        &RunParams {
            card: Some(probe),
            counter_type: Some("Lore".to_string()),
            ..Default::default()
        },
    );

    assert_eq!(matched.len(), 5);
}

#[test]
fn counter_added_rejects_malformed_counter_amount() {
    let rules = parse_card_script(
        "Name:Malformed Counter Amount\nTypes:Enchantment\nSVar:Probe:DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ 1\nT:Mode$ CounterAdded | ValidCard$ Card.Self | TriggerZones$ Battlefield | CounterType$ LORE | CounterAmount$ BAD | Execute$ Probe",
    )
    .expect("malformed counter amount fixture parses structurally");
    let player = PlayerId(0);
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let probe = game.create_card(Card::from_rules(&rules, player));
    game.move_card(probe, ZoneType::Battlefield, player);

    let mut trigger_handler = TriggerHandler::new();
    trigger_handler.register_active_trigger(&game, probe);
    let matched = trigger_handler.get_active_trigger(
        &game,
        TriggerType::CounterAdded,
        &RunParams {
            card: Some(probe),
            counter_type: Some("Lore".to_string()),
            counter_amount: Some(1),
            ..Default::default()
        },
    );

    assert!(matched.is_empty());
}
