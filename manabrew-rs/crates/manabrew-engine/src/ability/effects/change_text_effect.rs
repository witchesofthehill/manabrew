//! ChangeText effect — modify text on a card (color words, land types, etc.)
//!
//! Ported from Java's `ChangeTextEffect.java`.

use super::EffectContext;
use crate::game::TypeRegistry;
use crate::ids::{CardId, PlayerId};
use crate::spellability::{AbilityDuration, SpellAbility};

const COLORS: [&str; 5] = ["White", "Blue", "Black", "Red", "Green"];
const BASIC_LAND_TYPES: [&str; 5] = ["Plains", "Island", "Swamp", "Mountain", "Forest"];
const NO_PRIOR_TEXT_CHANGE: &str = "__forge_no_prior_text_change__";

/// End-of-turn revert for temporary text changes.
///
/// Java stores text changes with a timestamp and removes the timestamped entries
/// at end of turn. Rust stores the active substitutions as card SVars with
/// `TextColor:` / `TextType:` prefixes, plus `TextColorEOT:` / `TextTypeEOT:`
/// markers containing the previous value to restore.
pub fn run(game: &mut crate::game::GameState, card_id: CardId) {
    restore_text_changes(game, card_id, "TextColor:", "TextColorEOT:");
    restore_text_changes(game, card_id, "TextType:", "TextTypeEOT:");
}

#[manabrew_engine_macros::spell_effect(ChangeTextEffect)]
fn resolve(ctx: &mut EffectContext, sa: &SpellAbility) {
    let color_change = sa
        .ir
        .change_color_word_text
        .as_deref()
        .and_then(|raw| resolve_color_word_change(ctx, sa, raw));
    let type_change = sa
        .ir
        .change_type_word_text
        .as_deref()
        .and_then(|raw| resolve_type_word_change(ctx, sa, raw));

    if color_change.is_none() && type_change.is_none() {
        return;
    }

    let permanent = matches!(sa.ir.duration, Some(AbilityDuration::Permanent));
    let targets = resolve_target_cards(ctx, sa);
    for target in targets {
        if let Some((from, to)) = color_change.as_ref() {
            if !permanent {
                mark_eot_text_change(ctx.game, target, "TextColor:", "TextColorEOT:", from);
            }
            ctx.game
                .card_mut(target)
                .add_changed_text_color_word(from, to);
        }
        if let Some((from, to)) = type_change.as_ref() {
            if !permanent {
                mark_eot_text_change(ctx.game, target, "TextType:", "TextTypeEOT:", from);
            }
            ctx.game
                .card_mut(target)
                .add_changed_text_type_word(from, to);
        }
    }
}

fn resolve_color_word_change(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    raw: &str,
) -> Option<(String, String)> {
    let (from_raw, to_raw) = split_word_change(raw)?;
    let controller = sa.activating_player;

    let from = if from_raw == "Choose" {
        choose_color(ctx, controller, COLORS.iter().copied())
    } else {
        Some(from_raw.to_string())
    }?;

    let to = if to_raw == "Choose" {
        let choices = COLORS
            .iter()
            .copied()
            .filter(|color| !color.eq_ignore_ascii_case(&from));
        choose_color(ctx, controller, choices)
    } else {
        Some(to_raw.to_string())
    }?;

    Some((from, to))
}

fn resolve_type_word_change(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    raw: &str,
) -> Option<(String, String)> {
    let (from_raw, to_raw) = split_word_change(raw)?;
    let controller = sa.activating_player;

    let from = match from_raw {
        "ChooseBasicLandType" => choose_type(ctx, controller, "basic land", basic_land_types()),
        "ChooseCreatureType" => choose_type(ctx, controller, "Creature", creature_types()),
        _ => Some(from_raw.to_string()),
    }?;

    let to = if to_raw.starts_with("Choose") {
        let mut valid_types = match to_raw {
            "ChooseBasicLandType" => basic_land_types(),
            "ChooseCreatureType" => creature_types(),
            _ => Vec::new(),
        };
        let mut forbidden = forbidden_new_types(sa);
        forbidden.push(from.clone());
        valid_types.retain(|ty| {
            !forbidden
                .iter()
                .any(|forbid| forbid.eq_ignore_ascii_case(ty))
        });
        choose_type(
            ctx,
            controller,
            if to_raw == "ChooseBasicLandType" {
                "basic land"
            } else {
                "Creature"
            },
            valid_types,
        )
    } else {
        Some(to_raw.to_string())
    }?;

    Some((from, to))
}

fn split_word_change(raw: &str) -> Option<(&str, &str)> {
    let mut parts = raw.split_whitespace();
    let from = parts.next()?;
    let to = parts.next()?;
    Some((from, to))
}

fn choose_color<'a>(
    ctx: &mut EffectContext,
    player: PlayerId,
    colors: impl IntoIterator<Item = &'a str>,
) -> Option<String> {
    let choices = colors.into_iter().map(str::to_string).collect::<Vec<_>>();
    if choices.is_empty() {
        return None;
    }
    ctx.agents[player.index()].choose_color(player, &choices)
}

fn choose_type(
    ctx: &mut EffectContext,
    player: PlayerId,
    type_category: &str,
    valid_types: Vec<String>,
) -> Option<String> {
    if valid_types.is_empty() {
        return None;
    }
    ctx.agents[player.index()].choose_type(player, type_category, &valid_types)
}

fn basic_land_types() -> Vec<String> {
    BASIC_LAND_TYPES.iter().map(|ty| ty.to_string()).collect()
}

fn creature_types() -> Vec<String> {
    TypeRegistry::creature_types().to_vec()
}

fn forbidden_new_types(sa: &SpellAbility) -> Vec<String> {
    sa.ir
        .forbidden_new_types_text
        .as_deref()
        .unwrap_or("")
        .split(',')
        .map(str::trim)
        .filter(|ty| !ty.is_empty())
        .map(str::to_string)
        .collect()
}

fn resolve_target_cards(ctx: &EffectContext, sa: &SpellAbility) -> Vec<CardId> {
    let mut targets =
        crate::ability::spell_ability_effect::get_defined_cards_or_targeted(ctx.game, sa);

    if let Some(stack_id) = sa.target_chosen.target_stack_entry {
        if let Some(source) = ctx
            .game
            .stack
            .find_by_id(stack_id)
            .and_then(|entry| entry.spell_ability.source)
        {
            targets.push(source);
        }
    }

    targets.sort_unstable_by_key(|id| id.0);
    targets.dedup();
    targets
}

fn mark_eot_text_change(
    game: &mut crate::game::GameState,
    card_id: CardId,
    active_prefix: &str,
    marker_prefix: &str,
    from: &str,
) {
    let active_key = format!("{active_prefix}{from}");
    let marker_key = format!("{marker_prefix}{from}");
    if game.card(card_id).svars.contains_key(&marker_key) {
        return;
    }

    let previous = game
        .card(card_id)
        .svars
        .get(&active_key)
        .cloned()
        .unwrap_or_else(|| NO_PRIOR_TEXT_CHANGE.to_string());
    game.card_mut(card_id).set_s_var(marker_key, previous);
}

fn restore_text_changes(
    game: &mut crate::game::GameState,
    card_id: CardId,
    active_prefix: &str,
    marker_prefix: &str,
) {
    let markers = game
        .card(card_id)
        .svars
        .iter()
        .filter_map(|(key, value)| {
            key.strip_prefix(marker_prefix)
                .map(|from| (from.to_string(), value.clone()))
        })
        .collect::<Vec<_>>();

    for (from, previous) in markers {
        let active_key = format!("{active_prefix}{from}");
        let marker_key = format!("{marker_prefix}{from}");
        game.card_mut(card_id).remove_s_var(&marker_key);
        if previous == NO_PRIOR_TEXT_CHANGE {
            game.card_mut(card_id).remove_s_var(&active_key);
        } else {
            game.card_mut(card_id).set_s_var(active_key, previous);
        }
    }
}
