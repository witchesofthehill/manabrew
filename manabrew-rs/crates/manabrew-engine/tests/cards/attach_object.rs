//! `DB$ Attach | Object$ …` must attach the named object, not the source card.
//!
//! Regression for Dáin Ironfoot (`Object$ DelayTriggerRememberedLKI`, via an
//! ImmediateTrigger) and Thorin, Mountain-king (`Object$ ParentTarget`), which
//! used to attach the legendary creature itself. Mirrors Java's
//! `AttachEffect.resolve()`, which only attaches the host when `Object$` is
//! absent.

use forge_carddb::parse_card_script;
use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};
use manabrew_engine::ability::ability_factory::build_spell_ability;
use manabrew_engine::agent::{PassAgent, PlayerAgent, TargetChoice};
use manabrew_engine::card::CardInstance;
use manabrew_engine::combat::DefenderId;
use manabrew_engine::game::GameState;
use manabrew_engine::game_loop::GameLoop;
use manabrew_engine::ids::{CardId, PlayerId};
use manabrew_engine::player::actions::PlayerAction;
use manabrew_engine::spellability::{SpellAbility, StackEntry};

/// Passes priority but picks the first legal target, so the "when you do"
/// trigger gets a creature to attach to.
struct TargetingPassAgent;

impl PlayerAgent for TargetingPassAgent {
    fn mulligan_decision(&mut self, _: PlayerId, _: &[CardId], _: u32) -> bool {
        true
    }

    fn choose_action(
        &mut self,
        _player: PlayerId,
        _action_space: Option<&manabrew_engine::agent::PriorityActionSpace>,
        _request_action_space: &mut dyn FnMut() -> manabrew_engine::agent::PriorityActionSpace,
    ) -> PlayerAction {
        PlayerAction::PassPriority
    }

    fn choose_land_or_spell(&mut self, _: PlayerId) -> Option<bool> {
        None
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
        _: Option<&SpellAbility>,
    ) -> Option<PlayerId> {
        valid.first().copied()
    }

    fn choose_target_card(
        &mut self,
        _: PlayerId,
        valid: &[CardId],
        _: Option<&SpellAbility>,
    ) -> Option<CardId> {
        valid.first().copied()
    }

    fn choose_target_any(
        &mut self,
        _: PlayerId,
        _: &[PlayerId],
        valid_cards: &[CardId],
        _: Option<&SpellAbility>,
    ) -> TargetChoice {
        valid_cards
            .first()
            .map_or(TargetChoice::None, |&cid| TargetChoice::Card(cid))
    }

    fn choose_targets_for(
        &mut self,
        sa: &mut SpellAbility,
        game: &GameState,
        mana_pools: &[manabrew_engine::mana::ManaPool],
    ) -> bool {
        manabrew_engine::spellability::choose_targets_by_kind(self, sa, game, mana_pools)
    }
}

fn make_bear(owner: PlayerId) -> CardInstance {
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

fn make_equipment(owner: PlayerId) -> CardInstance {
    CardInstance::new(
        CardId(0),
        "Axe".to_string(),
        owner,
        CardTypeLine::parse("Artifact - Equipment"),
        ManaCost::parse("0"),
        ColorSet::COLORLESS,
        None,
        None,
        vec![],
        vec![],
    )
}

fn put_on_battlefield(game: &mut GameState, card: CardInstance, owner: PlayerId) -> CardId {
    let id = game.create_card(card);
    game.move_card(id, ZoneType::Battlefield, owner);
    id
}

fn push_trigger(game: &mut GameState, sa: SpellAbility) {
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

/// Resolve the stack, then let any immediate/delayed triggers go on the stack
/// and resolve too.
fn run(game: &mut GameState) {
    let mut agents: Vec<Box<dyn PlayerAgent>> =
        vec![Box::new(TargetingPassAgent), Box::new(PassAgent)];
    let mut game_loop = GameLoop::new(2);
    game_loop.resolve_stack(game, &mut agents);
    for _ in 0..4 {
        game_loop.step_with_priority(game, &mut agents, true);
        game_loop.resolve_stack(game, &mut agents);
    }
}

/// Full trigger resolution recurses deeply in debug builds; give the test the
/// same headroom the parity runner uses.
fn with_big_stack(f: impl FnOnce() + Send + 'static) {
    std::thread::Builder::new()
        .stack_size(16 * 1024 * 1024)
        .spawn(f)
        .expect("spawn test thread")
        .join()
        .expect("test thread panicked");
}

#[test]
fn dain_ironfoot_attaches_the_remembered_axe_not_dain() {
    with_big_stack(dain_ironfoot_body);
}

#[test]
fn thorin_attaches_the_targeted_equipment_not_thorin() {
    with_big_stack(thorin_body);
}

fn dain_ironfoot_body() {
    let rules = parse_card_script(include_str!(
        "../../../../../forge/forge-gui/res/cardsfolder/d/dain_ironfoot.txt"
    ))
    .expect("Dáin script should parse");
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);

    let dain = put_on_battlefield(&mut game, CardInstance::from_rules(&rules, p0), p0);
    let axe = put_on_battlefield(&mut game, make_equipment(p0), p0);
    let _bear = put_on_battlefield(&mut game, make_bear(p0), p0);

    // State after `DB$ Token | RememberOriginalTokens$ True`: Dáin remembers
    // the Axe. Resolve the rest of the real chain from there:
    // ImmediateTrigger (RememberObjects$ Remembered) -> Cleanup, then the
    // "when you do" TrigAttach with Object$ DelayTriggerRememberedLKI.
    game.card_mut(dain).add_remembered_card(axe);
    let text = game
        .card(dain)
        .get_s_var("DBImmediateTrig")
        .expect("DBImmediateTrig svar")
        .to_string();
    let mut sa = build_spell_ability(&game, dain, &text, p0);
    sa.is_trigger = true;
    push_trigger(&mut game, sa);

    run(&mut game);

    assert_eq!(
        game.card(dain).attached_to,
        None,
        "Dáin must not be attached to anything"
    );
    assert!(
        game.card(axe).attached_to.is_some(),
        "the Axe token should be attached to a creature"
    );
}

fn thorin_body() {
    let rules = parse_card_script(include_str!(
        "../../../../../forge/forge-gui/res/cardsfolder/t/thorin_mountain_king.txt"
    ))
    .expect("Thorin script should parse");
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);

    let thorin = put_on_battlefield(&mut game, CardInstance::from_rules(&rules, p0), p0);
    let axe = put_on_battlefield(&mut game, make_equipment(p0), p0);
    let bear = put_on_battlefield(&mut game, make_bear(p0), p0);

    // Thorin's ETB: Pump targets the Axe, DBAttach (Object$ ParentTarget)
    // targets the bear.
    let text = game
        .card(thorin)
        .get_s_var("TrigPump")
        .expect("TrigPump svar")
        .to_string();
    let mut sa = build_spell_ability(&game, thorin, &text, p0);
    sa.is_trigger = true;
    sa.target_chosen.target_card = Some(axe);
    sa.get_sub_ability_mut()
        .expect("DBAttach sub-ability")
        .target_chosen
        .target_card = Some(bear);
    push_trigger(&mut game, sa);

    run(&mut game);

    assert_eq!(
        game.card(thorin).attached_to,
        None,
        "Thorin must not be attached to anything"
    );
    assert_eq!(
        game.card(axe).attached_to,
        Some(bear),
        "the targeted Axe should be attached to the targeted creature"
    );
}
