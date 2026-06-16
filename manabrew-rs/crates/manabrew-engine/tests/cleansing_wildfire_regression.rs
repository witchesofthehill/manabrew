use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};
use manabrew_engine::ability::ability_factory::build_spell_ability;
use manabrew_engine::agent::{PassAgent, PlayOption, PlayerAgent, TargetChoice};
use manabrew_engine::card::CardInstance;
use manabrew_engine::combat::DefenderId;
use manabrew_engine::game::GameState;
use manabrew_engine::game_loop::GameLoop;
use manabrew_engine::ids::{CardId, PlayerId};
use manabrew_engine::player::actions::PlayerAction;
use manabrew_engine::spellability::StackEntry;

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

fn make_cleansing_wildfire(owner: PlayerId) -> CardInstance {
    let mut card = CardInstance::new(
        CardId(0),
        "Cleansing Wildfire".to_string(),
        owner,
        CardTypeLine::parse("Sorcery"),
        ManaCost::parse("1 R"),
        ColorSet::RED,
        None,
        None,
        vec![],
        vec![
            "SP$ Destroy | ValidTgts$ Land | SubAbility$ DBChange | SpellDescription$ Destroy target land. Its controller may search their library for a basic land card, put it onto the battlefield tapped, then shuffle.".to_string(),
        ],
    );
    card.svars.insert(
        "DBChange".to_string(),
        "DB$ ChangeZone | Origin$ Library | Destination$ Battlefield | ChangeType$ Land.Basic | ChangeTypeDesc$ basic land | Tapped$ True | ChangeNum$ 1 | DefinedPlayer$ TargetedController | ShuffleNonMandatory$ True".to_string(),
    );
    card
}

struct AcceptSearchAgent;

impl PlayerAgent for AcceptSearchAgent {
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
        _: Option<&manabrew_engine::spellability::SpellAbility>,
    ) -> Option<PlayerId> {
        valid.first().copied()
    }

    fn choose_target_card(
        &mut self,
        _: PlayerId,
        valid: &[CardId],
        _: Option<&manabrew_engine::spellability::SpellAbility>,
    ) -> Option<CardId> {
        valid.first().copied()
    }

    fn choose_target_any(
        &mut self,
        _: PlayerId,
        valid_players: &[PlayerId],
        valid_cards: &[CardId],
        _: Option<&manabrew_engine::spellability::SpellAbility>,
    ) -> TargetChoice {
        if let Some(&pid) = valid_players.first() {
            TargetChoice::Player(pid)
        } else if let Some(&cid) = valid_cards.first() {
            TargetChoice::Card(cid)
        } else {
            TargetChoice::None
        }
    }

    fn confirm_action(
        &mut self,
        _: PlayerId,
        _: Option<&str>,
        _: &str,
        _: &[String],
        _: Option<&str>,
        _: Option<manabrew_engine::ability::api_type::ApiType>,
    ) -> bool {
        true
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

#[test]
fn cleansing_wildfire_subability_uses_parent_targeted_controller_for_search() {
    let mut game = GameState::new(&["Alice", "Bob"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    let alice_mountain = game.create_card(make_mountain(p0));
    game.move_card(alice_mountain, ZoneType::Battlefield, p0);
    let alice_second_mountain = game.create_card(make_mountain(p0));
    game.move_card(alice_second_mountain, ZoneType::Battlefield, p0);
    let alice_forest = game.create_card(make_forest(p0));
    game.move_card(alice_forest, ZoneType::Library, p0);

    let bob_mountain = game.create_card(make_mountain(p1));
    game.move_card(bob_mountain, ZoneType::Battlefield, p1);

    let wildfire = game.create_card(make_cleansing_wildfire(p0));
    game.move_card(wildfire, ZoneType::Stack, p0);

    let mut sa = build_spell_ability(
        &game,
        wildfire,
        "SP$ Destroy | ValidTgts$ Land | SubAbility$ DBChange | SpellDescription$ Destroy target land. Its controller may search their library for a basic land card, put it onto the battlefield tapped, then shuffle.",
        p0,
    );
    sa.target_chosen.target_card = Some(alice_mountain);

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

    let mut agents: Vec<Box<dyn PlayerAgent>> =
        vec![Box::new(AcceptSearchAgent), Box::new(PassAgent)];
    let mut game_loop = GameLoop::new(2);
    game_loop.resolve_stack(&mut game, &mut agents);

    assert_eq!(
        game.card(alice_mountain).zone,
        ZoneType::Graveyard,
        "Cleansing Wildfire should destroy the targeted land"
    );
    assert_eq!(
        game.card(alice_forest).zone,
        ZoneType::Battlefield,
        "The search sub-ability should still find Alice's basic land using the parent targeted controller"
    );
    assert!(
        game.card(alice_forest).tapped,
        "The searched basic land should enter tapped"
    );
}
