//! Extracts a normalized [`StateSnapshot`] from a [`GameState`].
//!
//! The snapshot uses only card names (not engine-internal IDs) and sorts all
//! lists alphabetically so that two independently-running engines can be
//! compared field-by-field.

use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

use forge_foundation::ZoneType;
use manabrew_engine::card::CounterType;
use manabrew_engine::game::GameState;
use manabrew_engine::ids::PlayerId;

use crate::protocol::{CardSnapshot, PlayerSnapshot, StateSnapshot};

pub fn snapshot_game(game: &GameState) -> StateSnapshot {
    let mut players = Vec::new();
    for player in &game.players {
        players.push(snapshot_player(game, player.id));
    }

    let mut stack: Vec<String> = game
        .stack
        .iter()
        .map(|entry| {
            if let Some(source) = entry.spell_ability.source {
                game.card(source).card_name.clone()
            } else {
                entry.spell_ability.ability_text.clone()
            }
        })
        .collect();
    stack.sort();

    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    StateSnapshot {
        turn: game.turn.turn_number,
        phase: format!("{:?}", game.turn.phase),
        active_player: game.turn.active_player.0,
        priority_player: game.turn.priority_player.0,
        game_over: game.game_over,
        winner: game.winner.map(|p| p.0),
        players: normalize_turn_start_players(players, game.turn.active_player),
        stack,
        timestamp_ms,
    }
}

fn normalize_turn_start_players(
    mut players: Vec<PlayerSnapshot>,
    active_player: PlayerId,
) -> Vec<PlayerSnapshot> {
    for player in &mut players {
        if player.index != active_player.0 {
            player.lands_played = 0;
        }
    }
    players
}

fn snapshot_player(game: &GameState, pid: PlayerId) -> PlayerSnapshot {
    let player = game.player(pid);

    // Battlefield cards with full details. Match Java's
    // `Player.getCardsIn(ZoneType.Battlefield)` which defaults to
    // `filterOutPhasedOut = true` — phased-out permanents are omitted from
    // snapshots (they're "treated as though they don't exist" per CR 702.26).
    let bf_cards = game.cards_in_zone(ZoneType::Battlefield, pid);
    let mut battlefield: Vec<CardSnapshot> = bf_cards
        .iter()
        .filter(|&&cid| !game.card(cid).phased_out)
        .map(|&cid| {
            let card = game.card(cid);
            let counters = snapshot_counters(card);
            CardSnapshot {
                name: if card.face_down {
                    String::new()
                } else {
                    card.card_name.clone()
                },
                tapped: card.tapped,
                power: if card.is_creature() {
                    Some(card.power())
                } else {
                    None
                },
                toughness: if card.is_creature() {
                    Some(card.toughness())
                } else {
                    None
                },
                damage: card.damage,
                summoning_sick: card.summoning_sick && !card.has_haste(),
                counters,
                controller: card.controller.0,
            }
        })
        .collect();
    battlefield.sort_by(|a, b| {
        a.name
            .cmp(&b.name)
            .then_with(|| a.power.cmp(&b.power))
            .then_with(|| a.toughness.cmp(&b.toughness))
            .then_with(|| {
                // Compare counters using Java TreeMap.toString() format so sort
                // order matches Java's `Comparator.comparing(... counters.toString())`.
                // Java format: "{key1=val1, key2=val2}" (BTreeMap order, comma-space separated).
                let a_str = counters_to_java_string(&a.counters);
                let b_str = counters_to_java_string(&b.counters);
                a_str.cmp(&b_str)
            })
            .then_with(|| a.tapped.cmp(&b.tapped))
            .then_with(|| a.damage.cmp(&b.damage))
            .then_with(|| a.summoning_sick.cmp(&b.summoning_sick))
            .then_with(|| a.controller.cmp(&b.controller))
    });

    // Other zones: use full_name (combined "A // B" for split/room cards)
    // to match Java's getName() which returns the combined name in non-battlefield zones.
    let mut graveyard: Vec<String> = game
        .cards_in_zone(ZoneType::Graveyard, pid)
        .iter()
        .map(|&cid| game.card(cid).full_name.clone())
        .collect();
    graveyard.sort();

    let mut hand: Vec<String> = game
        .cards_in_zone(ZoneType::Hand, pid)
        .iter()
        .map(|&cid| game.card(cid).full_name.clone())
        .collect();
    hand.sort();

    let mut exile: Vec<String> = game
        .cards_in_zone(ZoneType::Exile, pid)
        .iter()
        .map(|&cid| game.card(cid).full_name.clone())
        .collect();
    exile.sort();

    let library_size = game.zone(ZoneType::Library, pid).len();
    // Library is a Vec with top-of-library at the END (push/pop). Capture
    // only the single top card: drawing mismatches are the earliest signal
    // of a silent library divergence, while deeper ordering differences
    // commonly stem from independent shuffle trajectories that don't
    // actually affect gameplay until another card is drawn.
    let library_top: Vec<String> = game
        .cards_in_zone(ZoneType::Library, pid)
        .iter()
        .rev()
        .take(10)
        .map(|&cid| game.card(cid).full_name.clone())
        .collect();

    PlayerSnapshot {
        name: player.name.clone(),
        index: pid.0,
        life: player.life,
        poison: player.poison_counters,
        lands_played: player.lands_played_this_turn,
        has_lost: player.has_lost,
        has_won: player.has_won,
        battlefield,
        graveyard,
        hand,
        exile,
        library_size,
        library_top,
    }
}

/// Format a counter map as Java's `TreeMap.toString()`, e.g. `"{-1/-1=1, +1/+1=2}"` or `"{}"`.
/// BTreeMap iteration is already sorted by key, matching Java's TreeMap.
fn counters_to_java_string(counters: &BTreeMap<String, i32>) -> String {
    if counters.is_empty() {
        return "{}".to_string();
    }
    let entries: Vec<String> = counters
        .iter()
        .map(|(k, v)| format!("{}={}", k, v))
        .collect();
    format!("{{{}}}", entries.join(", "))
}

/// Convert counter map to sorted string-keyed map for deterministic comparison.
fn snapshot_counters(card: &manabrew_engine::card::CardInstance) -> BTreeMap<String, i32> {
    let mut map = BTreeMap::new();
    for (ct, &count) in &card.counters {
        if count > 0 {
            let name = counter_type_name(ct);
            map.insert(name, count);
        }
    }
    map
}

fn counter_type_name(ct: &CounterType) -> String {
    match ct {
        CounterType::P1P1 => "+1/+1".into(),
        CounterType::M1M1 => "-1/-1".into(),
        CounterType::Loyalty => "loyalty".into(),
        CounterType::Charge => "charge".into(),
        CounterType::Quest => "quest".into(),
        CounterType::Study => "study".into(),
        CounterType::Age => "age".into(),
        CounterType::Fade => "fade".into(),
        CounterType::Time => "time".into(),
        CounterType::Depletion => "depletion".into(),
        CounterType::Storage => "storage".into(),
        CounterType::Mining => "mining".into(),
        CounterType::Brick => "brick".into(),
        CounterType::Level => "level".into(),
        CounterType::Lore => "lore".into(),
        CounterType::Page => "page".into(),
        CounterType::Dream => "dream".into(),
        CounterType::Poison => "poison".into(),
        CounterType::Named(name) => name.to_lowercase(),
    }
}
