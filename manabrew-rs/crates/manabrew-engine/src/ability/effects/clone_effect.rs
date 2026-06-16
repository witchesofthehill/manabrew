use forge_foundation::{CardTypeLine, ColorSet, ZoneType};

use super::{matches_valid_cards_for_sa, EffectContext};
use crate::parsing::split_param_list_value;
use crate::spellability::SpellAbility;

/// `SP$ Clone` — one card becomes a copy of another.
///
/// Mirrors Java's `CloneEffect.java`.
///
/// # Params
/// - `Choices` — filter for valid clone sources (if player picks)
/// - `ChoiceZone` — zone to pick from (default Battlefield)
/// - `Defined$` — resolve defined cards as the clone source
/// - `CloneTarget` — defined cards to be cloned onto (default: source card)
/// - `PumpKeywords` — extra keywords on the copy
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `CloneEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(CloneEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let source_id = match sa.source {
        Some(id) => id,
        None => return,
    };

    let controller = sa.activating_player;

    // Step 1: Determine the clone source (what to copy FROM)
    let clone_source = resolve_clone_source(ctx, sa, controller);
    let clone_source_id = match clone_source {
        Some(id) => id,
        None => return,
    };

    // Step 2: Determine the clone target (what to copy ONTO)
    let clone_target_id = if let Some(defined) = sa.ir.clone_target.as_deref() {
        match defined {
            "Self" => source_id,
            "ParentTarget" => ctx.parent_target_card.unwrap_or(source_id),
            "Remembered" => ctx
                .game
                .card(source_id)
                .remembered_cards
                .first()
                .copied()
                .unwrap_or(source_id),
            _ => source_id,
        }
    } else {
        // Default: the source card itself (the creature entering as a clone)
        source_id
    };

    // Step 3: Copy characteristics from source → target
    let src = ctx.game.card(clone_source_id).clone();
    let duration = crate::parsing::raw_get(&sa.ability_text, crate::parsing::keys::DURATION);
    let active_animation = capture_active_animation(ctx.game.card(clone_target_id));
    if ctx.game.card(clone_target_id).clone_state.is_none() {
        let mut state = ctx.game.card(clone_target_id).capture_clone_state();
        state.expires_at_cleanup = duration.is_some() || sa.ir.duration.is_some();
        if let Some(animate_state) = ctx.game.card(clone_target_id).animate_state.as_ref() {
            state.original_type_line = animate_state.original_type_line.clone();
            state.original_base_power = animate_state.original_base_power;
            state.original_base_toughness = animate_state.original_base_toughness;
            state.original_color = animate_state.original_color;
        }
        ctx.game
            .card_mut(clone_target_id)
            .set_clone_state(Some(state));
    }
    let target = &mut ctx.game.cards[clone_target_id.index()];
    crate::card::card_copy_service::copy_copiable_characteristics(&src, target);
    target.add_clone_state();
    target.activated_abilities = src.activated_abilities.clone();
    target.static_abilities = src.static_abilities.clone();
    target.replacement_effects = src.replacement_effects.clone();
    target.ensure_crew_activated_ability();
    target.base_ability_count = target.activated_abilities.len();
    target.base_trigger_count = target.triggers.len();
    target.set_perpetual(&src, false);
    target.reset_changed_card_traits_baseline_to_current();

    // Step 4: Apply clone-state modifications from the cloning ability.
    if let Some(add_types) = sa.ir.add_types.as_deref() {
        for ty in split_param_list_value(Some(add_types), " & ") {
            ctx.game.card_mut(clone_target_id).add_type(&ty);
        }
    }

    if let Some(set_color) = sa.ir.set_color.as_deref() {
        ctx.game
            .card_mut(clone_target_id)
            .set_color(ColorSet::from_names(set_color));
    }

    if let Some(power) = sa
        .ir
        .set_power
        .as_deref()
        .and_then(|value| value.parse().ok())
    {
        ctx.game
            .card_mut(clone_target_id)
            .set_base_power(Some(power));
    }
    if let Some(toughness) = sa
        .ir
        .set_toughness
        .as_deref()
        .and_then(|value| value.parse().ok())
    {
        ctx.game
            .card_mut(clone_target_id)
            .set_base_toughness(Some(toughness));
    }

    if let Some(add_kws) = sa.ir.add_keywords.as_deref() {
        let keywords = add_kws.strip_prefix("IfNew ").unwrap_or(add_kws);
        for kw in split_param_list_value(Some(keywords), " & ") {
            ctx.game
                .card_mut(clone_target_id)
                .add_intrinsic_keyword(&kw);
        }
    }

    if let Some(animation) = active_animation {
        reapply_active_animation(ctx.game.card_mut(clone_target_id), &animation);
    }

    // Step 5: Apply PumpKeywords$ (extra temporary keywords on the copy)
    if let Some(pump_kws) = sa.ir.pump_keywords.as_deref() {
        for kw in split_param_list_value(Some(pump_kws), " & ") {
            ctx.game
                .card_mut(clone_target_id)
                .add_intrinsic_keyword(&kw);
        }
    }

    // Step 6: Re-register triggers for the cloned card
    ctx.trigger_handler
        .register_active_trigger(ctx.game, clone_target_id);
}

/// End-of-turn revert for clone effects. Mirrors the `GameCommand.run()`
/// anonymous class in Java `CloneEffect` that calls `removeCloneState`,
/// clears imprinted/remembered cards, and restores the original state.
///
/// Removes the clone stamp from the card, reverting copied characteristics
/// and restoring original remembered/imprinted state.
pub fn run(game: &mut crate::game::GameState, card_id: crate::ids::CardId) {
    if game.card(card_id).zone != ZoneType::Battlefield {
        return;
    }
    // Revert copiable characteristics by clearing clone-specific state.
    // The card's base characteristics (from the card definition) take over.
    let card = game.card_mut(card_id);
    card.remove_clone_state();
    card.imprinted_cards.clear();
    card.remembered_cards.clear();
}

/// Determine which card to copy FROM.
fn resolve_clone_source(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    controller: crate::ids::PlayerId,
) -> Option<crate::ids::CardId> {
    // Check explicit target first
    if let Some(target) = sa.target_chosen.target_card {
        return Some(target);
    }

    // Check Defined$
    if let Some(defined) = sa.defined() {
        match defined {
            "Remembered" => {
                if let Some(src) = sa.source {
                    return ctx.game.card(src).remembered_cards.first().copied();
                }
            }
            "ParentTarget" => {
                return ctx.parent_target_card;
            }
            _ => {}
        }
    }

    // Check Choices — player selects from valid cards
    if let Some(filter) = sa.ir.choices.as_deref().map(str::to_string) {
        let filter_selector = sa.ir.choices_selector.as_ref();
        let zone = sa.ir.choice_zone.unwrap_or(ZoneType::Battlefield);

        let mut valid = Vec::new();
        for &pid in &ctx.game.player_order.clone() {
            let zone_cards = ctx.game.cards_in_zone(zone, pid).to_vec();
            for cid in zone_cards {
                if matches_valid_cards_for_sa(
                    ctx.game,
                    sa,
                    ctx.game.card(cid),
                    filter_selector,
                    &filter,
                ) {
                    valid.push(cid);
                }
            }
        }

        if valid.is_empty() {
            return None;
        }

        ctx.agents[controller.index()].snapshot_state(ctx.game, ctx.mana_pools);
        let chosen =
            ctx.agents[controller.index()].choose_cards_for_effect(controller, &valid, 1, 1);
        return chosen.first().copied();
    }

    None
}

#[derive(Clone)]
struct ActiveAnimationSnapshot {
    original_type_line: CardTypeLine,
    original_color: ColorSet,
    original_base_power: Option<i32>,
    original_base_toughness: Option<i32>,
    original_keywords: Option<Vec<String>>,
    type_line: CardTypeLine,
    color: ColorSet,
    base_power: Option<i32>,
    base_toughness: Option<i32>,
    keywords: Vec<String>,
}

fn capture_active_animation(card: &crate::card::Card) -> Option<ActiveAnimationSnapshot> {
    let state = card.animate_state.as_ref()?;
    Some(ActiveAnimationSnapshot {
        original_type_line: state.original_type_line.clone(),
        original_color: state.original_color,
        original_base_power: state.original_base_power,
        original_base_toughness: state.original_base_toughness,
        original_keywords: state
            .original_keywords
            .as_ref()
            .map(|kws| kws.iter_strings().map(str::to_string).collect()),
        type_line: card.type_line.clone(),
        color: card.color,
        base_power: card.base_power,
        base_toughness: card.base_toughness,
        keywords: card.keywords.iter_strings().map(str::to_string).collect(),
    })
}

fn reapply_active_animation(card: &mut crate::card::Card, animation: &ActiveAnimationSnapshot) {
    for supertype in animation
        .type_line
        .supertypes
        .difference(&animation.original_type_line.supertypes)
    {
        card.type_line.supertypes.insert(*supertype);
    }
    for core_type in animation
        .type_line
        .core_types
        .difference(&animation.original_type_line.core_types)
    {
        card.type_line.core_types.insert(*core_type);
    }
    for subtype in &animation.type_line.subtypes {
        if animation
            .original_type_line
            .subtypes
            .iter()
            .any(|original| original.eq_ignore_ascii_case(subtype))
        {
            continue;
        }
        if !card
            .type_line
            .subtypes
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(subtype))
        {
            card.type_line.subtypes.push(subtype.clone());
        }
    }
    card.update_types();
    card.update_types_for_view();

    if animation.color != animation.original_color {
        card.color = animation.color;
    }
    if animation.base_power != animation.original_base_power {
        card.base_power = animation.base_power;
    }
    if animation.base_toughness != animation.original_base_toughness {
        card.base_toughness = animation.base_toughness;
    }

    let original_keywords = animation.original_keywords.as_deref().unwrap_or(&[]);
    for keyword in &animation.keywords {
        if original_keywords
            .iter()
            .any(|original| original.eq_ignore_ascii_case(keyword))
        {
            continue;
        }
        if !card
            .keywords
            .iter_strings()
            .any(|existing| existing.eq_ignore_ascii_case(keyword))
        {
            card.add_intrinsic_keyword(keyword);
        }
    }
}
