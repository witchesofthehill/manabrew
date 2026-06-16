//! Venture effect — venture into the dungeon.
//!
//! Ported from Java's `VentureEffect.java`.
//! Venture into the dungeon: If you're not in a dungeon, choose one.
//! Move to the next room and trigger its room ability.
//!
//! Dungeon state is tracked via svars on a dungeon card in the Command zone:
//! - "CurrentRoom" → room name (empty = not started)
//! - "DungeonName" → dungeon identifier
//! The three standard dungeons are:
//! - Dungeon of the Mad Mage (7 rooms)
//! - Lost Mine of Phandelver (4 rooms + branches)
//! - Tomb of Annihilation (4 rooms + branches)
//! Plus Undercity from Baldur's Gate.

use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};

use super::EffectContext;
use crate::card::Card;
use crate::event::RunParams;
use crate::ids::{CardId, PlayerId};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

/// Standard dungeon definitions: (name, rooms in order, last room name)
/// For dungeons with branches, we list the linear path (agent auto-chooses).
const DUNGEONS: &[(&str, &[&str])] = &[
    (
        "Dungeon of the Mad Mage",
        &[
            "Yawning Portal",
            "Dungeon Level",
            "Goblin Bazaar",
            "Twisted Caverns",
            "Lost Level",
            "Runestone Caverns",
            "Mad Wizard's Lair",
        ],
    ),
    (
        "Lost Mine of Phandelver",
        &[
            "Cave Entrance",
            "Goblin Lair",
            "Mine Tunnels",
            "Temple of Dumathoin",
        ],
    ),
    (
        "Tomb of Annihilation",
        &[
            "Trapped Entry",
            "Veils of Fear",
            "Sandfall Cell",
            "Cradle of the Death God",
        ],
    ),
    (
        "Undercity",
        &[
            "Secret Entrance",
            "Forge",
            "Lost Well",
            "Throne of the Dead Three",
        ],
    ),
];

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `VentureEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(VentureEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;
    let players = if let Some(def) = sa.defined_player() {
        super::resolve_defined_players(def, controller, ctx.game)
    } else if let Some(target_player) = sa.target_chosen.target_player {
        vec![target_player]
    } else {
        vec![controller]
    };

    for pid in players {
        if ctx.game.player(pid).has_lost {
            continue;
        }
        venture_into_dungeon(ctx, sa, pid);
    }
}

fn venture_into_dungeon(ctx: &mut EffectContext, sa: &SpellAbility, player: PlayerId) {
    // Step 1: Find current dungeon in command zone
    let current_dungeon = find_current_dungeon(ctx, player);

    let dungeon_id = match current_dungeon {
        Some((id, room, dungeon_name)) => {
            // Check if dungeon is in last room — if so, complete it and start new
            let rooms = get_dungeon_rooms(&dungeon_name);
            if let Some(rooms) = rooms {
                if !room.is_empty() && rooms.last().is_some_and(|last| *last == room) {
                    // Complete the dungeon
                    complete_dungeon(ctx, player, id);
                    // Start a new dungeon
                    create_dungeon(ctx, sa, player)
                } else {
                    // Continue current dungeon
                    id
                }
            } else {
                id
            }
        }
        None => {
            // No active dungeon — create one
            create_dungeon(ctx, sa, player)
        }
    };

    // Step 2: Advance to next room
    let dungeon_name = ctx
        .game
        .card(dungeon_id)
        .svars
        .get("DungeonName")
        .cloned()
        .unwrap_or_default();
    let current_room = ctx
        .game
        .card(dungeon_id)
        .svars
        .get("CurrentRoom")
        .cloned()
        .unwrap_or_default();

    let rooms = get_dungeon_rooms(&dungeon_name);
    let next_room = if let Some(rooms) = rooms {
        if current_room.is_empty() {
            // Enter first room
            rooms.first().map(|s| s.to_string())
        } else {
            // Find current room index and advance
            let idx = rooms.iter().position(|r| *r == current_room);
            match idx {
                Some(i) if i + 1 < rooms.len() => Some(rooms[i + 1].to_string()),
                _ => None, // Already in last room
            }
        }
    } else {
        None
    };

    if let Some(next) = next_room {
        ctx.game
            .card_mut(dungeon_id)
            .svars
            .insert("CurrentRoom".to_string(), next.clone());

        // Fire RoomEntered trigger
        ctx.trigger_handler.run_trigger(
            TriggerType::RoomEntered,
            RunParams {
                card: Some(dungeon_id),
                player: Some(player),
                room_name: Some(next),
                ..Default::default()
            },
            false,
        );
    }
}

fn find_current_dungeon(ctx: &EffectContext, player: PlayerId) -> Option<(CardId, String, String)> {
    ctx.game
        .cards
        .iter()
        .find(|c| {
            c.zone == ZoneType::Command && c.owner == player && c.svars.contains_key("DungeonName")
        })
        .map(|c| {
            let room = c.svars.get("CurrentRoom").cloned().unwrap_or_default();
            let name = c.svars.get("DungeonName").cloned().unwrap_or_default();
            (c.id, room, name)
        })
}

fn create_dungeon(ctx: &mut EffectContext, sa: &SpellAbility, player: PlayerId) -> CardId {
    // Choose dungeon — if sa specifies one, use it; otherwise auto-choose
    let dungeon_name = sa.ir.dungeon_text.clone().unwrap_or_else(|| {
        // Auto-choose first dungeon (agent would pick in full implementation)
        let idx = ctx.rng.next_int(DUNGEONS.len() as i32) as usize % DUNGEONS.len();
        DUNGEONS[idx].0.to_string()
    });

    let mut card = Card::new(
        CardId(0),
        dungeon_name.clone(),
        player,
        CardTypeLine::parse("Dungeon"),
        ManaCost::parse(""),
        ColorSet::COLORLESS,
        None,
        None,
        vec![],
        vec![],
    );
    card.set_controller(player);
    card.set_s_var("DungeonName", dungeon_name);
    card.set_s_var("CurrentRoom", String::new());

    let id = ctx.game.create_card(card);
    ctx.move_card(id, ZoneType::Command, player);
    ctx.trigger_handler.register_active_trigger(ctx.game, id);

    id
}

fn complete_dungeon(ctx: &mut EffectContext, player: PlayerId, dungeon_id: CardId) {
    // Move completed dungeon out of command zone
    let old_zone = ctx.game.card(dungeon_id).zone;
    ctx.move_card(dungeon_id, ZoneType::Exile, player);
    super::emit_zone_trigger(ctx.trigger_handler, dungeon_id, old_zone, ZoneType::Exile);

    // Fire dungeon completed trigger
    ctx.trigger_handler.run_trigger(
        TriggerType::DungeonCompleted,
        RunParams {
            card: Some(dungeon_id),
            player: Some(player),
            ..Default::default()
        },
        false,
    );
}

fn get_dungeon_rooms(name: &str) -> Option<&'static [&'static str]> {
    DUNGEONS
        .iter()
        .find(|(n, _)| *n == name)
        .map(|(_, rooms)| *rooms)
}
