//! Demo: play a game with trigger cards and narrate what happens.

use std::collections::BTreeMap;

use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};
use manabrew_engine::agent::{PlayCardMode, PlayOption, PlayerAgent, TargetChoice};
use manabrew_engine::card::CardInstance;
use manabrew_engine::combat::DefenderId;
use manabrew_engine::game::GameState;
use manabrew_engine::game_loop::GameLoop;
use manabrew_engine::ids::{CardId, PlayerId};
use manabrew_engine::player::actions::PlayerAction;
use manabrew_engine::trigger::parse_trigger;
use rand::SeedableRng;

// ── Card constructors ────────────────────────────────────────────────

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

fn make_lightning_bolt(owner: PlayerId) -> CardInstance {
    CardInstance::new(CardId(0), "Lightning Bolt".to_string(), owner,
        CardTypeLine::parse("Instant"),
        ManaCost::parse("R"), ColorSet::RED, None, None, vec![],
        vec!["SP$ DealDamage | ValidTgts$ Any | NumDmg$ 3 | SpellDescription$ CARDNAME deals 3 damage to any target.".to_string()])
}

fn make_shock(owner: PlayerId) -> CardInstance {
    CardInstance::new(CardId(0), "Shock".to_string(), owner,
        CardTypeLine::parse("Instant"),
        ManaCost::parse("R"), ColorSet::RED, None, None, vec![],
        vec!["SP$ DealDamage | ValidTgts$ Any | NumDmg$ 2 | SpellDescription$ CARDNAME deals 2 damage to any target.".to_string()])
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

#[allow(dead_code)]
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
        "Sulfuric Vortex".to_string(),
        owner,
        CardTypeLine::parse("Creature - Spirit"),
        ManaCost::parse("1 R"),
        ColorSet::RED,
        Some(0),
        Some(1),
        vec![],
        vec![],
    );
    card.triggers = vec![trigger];
    card.svars = svars;
    card
}

// ── Verbose AI Agent ─────────────────────────────────────────────────

struct VerboseAgent {
    name: String,
}

impl VerboseAgent {
    fn new(name: &str) -> Self {
        VerboseAgent {
            name: name.to_string(),
        }
    }
}

impl PlayerAgent for VerboseAgent {
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
        if let Some(&pid) = p.first() {
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
    fn notify(&mut self, msg: manabrew_engine::agent::notification::GameNotification) {
        println!("    [{}] {:?}", self.name, msg);
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

// ── Helpers ──────────────────────────────────────────────────────────

fn print_board(game: &GameState, p0: PlayerId, p1: PlayerId) {
    let p0s = game.player(p0);
    let p1s = game.player(p1);

    let bf0: Vec<String> = game
        .cards_in_zone(ZoneType::Battlefield, p0)
        .iter()
        .map(|&cid| {
            let c = game.card(cid);
            if c.is_creature() {
                let trigs = if c.triggers.is_empty() {
                    String::new()
                } else {
                    format!(" *TRIGGER*")
                };
                format!("{} {}/{}{}", c.card_name, c.power(), c.toughness(), trigs)
            } else {
                c.card_name.clone()
            }
        })
        .collect();
    let bf1: Vec<String> = game
        .cards_in_zone(ZoneType::Battlefield, p1)
        .iter()
        .map(|&cid| {
            let c = game.card(cid);
            if c.is_creature() {
                let trigs = if c.triggers.is_empty() {
                    String::new()
                } else {
                    format!(" *TRIGGER*")
                };
                format!("{} {}/{}{}", c.card_name, c.power(), c.toughness(), trigs)
            } else {
                c.card_name.clone()
            }
        })
        .collect();

    println!("  ┌─────────────────────────────────────────────────┐");
    println!(
        "  │ {} (Life: {}, Hand: {}, Lib: {})",
        p0s.name,
        p0s.life,
        game.zone(ZoneType::Hand, p0).len(),
        game.zone(ZoneType::Library, p0).len()
    );
    if !bf0.is_empty() {
        println!("  │   BF: {}", bf0.join(", "));
    }
    println!("  │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─");
    println!(
        "  │ {} (Life: {}, Hand: {}, Lib: {})",
        p1s.name,
        p1s.life,
        game.zone(ZoneType::Hand, p1).len(),
        game.zone(ZoneType::Library, p1).len()
    );
    if !bf1.is_empty() {
        println!("  │   BF: {}", bf1.join(", "));
    }
    println!("  └─────────────────────────────────────────────────┘");
}

// ── The Demo ─────────────────────────────────────────────────────────

#[test]
#[ignore = "Verbose interactive demo is unstable under the current explicit priority/mana flow"]
fn trigger_demo_game() {
    println!();
    println!("═══════════════════════════════════════════════════════");
    println!("  FORGE ENGINE — Triggered Abilities Demo");
    println!("═══════════════════════════════════════════════════════");
    println!();

    let mut game = GameState::new(&["Alice (Red+Triggers)", "Bob (Green+Triggers)"], 20);
    let p0 = PlayerId(0);
    let p1 = PlayerId(1);

    // ── Alice's deck: Mountains, Bolts, Shocks, Guttersnipe, Sulfuric Vortex ──
    // Stack order: bottom → top (last added = drawn first)
    for _ in 0..8 {
        let c = game.create_card(make_mountain(p0));
        game.move_card(c, ZoneType::Library, p0);
    }
    for _ in 0..3 {
        let c = game.create_card(make_lightning_bolt(p0));
        game.move_card(c, ZoneType::Library, p0);
    }
    for _ in 0..3 {
        let c = game.create_card(make_shock(p0));
        game.move_card(c, ZoneType::Library, p0);
    }
    for _ in 0..2 {
        let c = game.create_card(make_guttersnipe(p0));
        game.move_card(c, ZoneType::Library, p0);
    }
    for _ in 0..2 {
        let c = game.create_card(make_upkeep_pinger(p0));
        game.move_card(c, ZoneType::Library, p0);
    }

    // ── Bob's deck: Forests, Plains, Bears, Soul Wardens, Mulldrifter ──
    for _ in 0..7 {
        let c = game.create_card(make_forest(p1));
        game.move_card(c, ZoneType::Library, p1);
    }
    for _ in 0..4 {
        let c = game.create_card(make_plains(p1));
        game.move_card(c, ZoneType::Library, p1);
    }
    for _ in 0..3 {
        let c = game.create_card(make_grizzly_bears(p1));
        game.move_card(c, ZoneType::Library, p1);
    }
    for _ in 0..3 {
        let c = game.create_card(make_soul_warden(p1));
        game.move_card(c, ZoneType::Library, p1);
    }

    println!("  Alice's deck: 8 Mountains, 3 Lightning Bolt, 3 Shock,");
    println!("                2 Guttersnipe, 2 Sulfuric Vortex");
    println!("  Bob's deck:   7 Forests, 4 Plains, 3 Grizzly Bears,");
    println!("                3 Soul Warden");
    println!();

    let mut game_loop = GameLoop::new(2);
    let mut rng = rand::rngs::StdRng::seed_from_u64(12345);

    let mut agents: Vec<Box<dyn PlayerAgent>> = vec![
        Box::new(VerboseAgent::new("Alice")),
        Box::new(VerboseAgent::new("Bob")),
    ];

    game_loop.setup(&mut game, &mut agents, &mut rng);

    println!("  Opening hands drawn (7 cards each).");
    println!();

    // Play up to 15 turns
    let max_turns = 15;
    while !game.game_over && game.turn.turn_number <= max_turns {
        let active = game.active_player();
        let name = game.player(active).name.clone();

        println!("──── Turn {} ({}) ────", game.turn.turn_number, name);

        let life_before_0 = game.player(p0).life;
        let life_before_1 = game.player(p1).life;

        game_loop.run_turn(&mut game, &mut agents, &mut rng);

        // Report life changes
        let life_after_0 = game.player(p0).life;
        let life_after_1 = game.player(p1).life;
        if life_after_0 != life_before_0 {
            let diff = life_after_0 - life_before_0;
            if diff > 0 {
                println!("    >> Alice gained {} life (now {})", diff, life_after_0);
            } else {
                println!("    >> Alice took {} damage (now {})", -diff, life_after_0);
            }
        }
        if life_after_1 != life_before_1 {
            let diff = life_after_1 - life_before_1;
            if diff > 0 {
                println!("    >> Bob gained {} life (now {})", diff, life_after_1);
            } else {
                println!("    >> Bob took {} damage (now {})", -diff, life_after_1);
            }
        }

        print_board(&game, p0, p1);
        println!();

        if game.game_over {
            break;
        }
    }

    // Final result
    println!("═══════════════════════════════════════════════════════");
    if let Some(winner) = game.winner {
        println!(
            "  WINNER: {} on turn {}!",
            game.player(winner).name,
            game.turn.turn_number
        );
    } else {
        println!("  Game reached turn limit ({} turns).", max_turns);
    }
    println!(
        "  Final life: Alice = {}, Bob = {}",
        game.player(p0).life,
        game.player(p1).life
    );
    println!("═══════════════════════════════════════════════════════");
}
