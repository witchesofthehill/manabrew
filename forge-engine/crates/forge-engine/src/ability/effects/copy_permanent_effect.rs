use forge_foundation::color::ColorSet;
use forge_foundation::ZoneType;

use super::token_effect_base::{TokenCreateTable, TokenEffectBase, TOKEN_EFFECT_BASE};
use super::EffectContext;
use crate::card::card_zone_table::CardZoneTable;
use crate::card::Card;
use crate::ids::CardId;
use crate::spellability::SpellAbility;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `CopyPermanentEffect` class extending `SpellAbilityEffect`.
#[forge_engine_macros::spell_effect(CopyPermanentEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let amount = super::resolve_numeric_svar(ctx.game, sa, "NumCopies", 1).max(0) as usize;
    let controllers = resolve_copy_controllers(ctx, sa);
    if controllers.is_empty() {
        return;
    }

    let mut token_table = TokenCreateTable::default();
    for controller in controllers {
        if !ctx.game.player(controller).is_alive() {
            continue;
        }

        let originals = resolve_originals(ctx, sa, controller);
        for original_id in originals {
            if ctx.game.card(original_id).type_line.is_instant()
                || ctx.game.card(original_id).type_line.is_sorcery()
            {
                continue;
            }
            if sa.ir.defined_text.is_none()
                && sa.ir.choices.is_none()
                && ctx.game.card(original_id).zone != ZoneType::Battlefield
            {
                continue;
            }

            if let Some(for_each) = sa.ir.for_each_text.as_deref() {
                let players = crate::ability::ability_utils::resolve_defined_players_with_sa(
                    for_each,
                    sa,
                    sa.activating_player,
                    ctx.game,
                );
                for player in players {
                    let mut proto = get_proto_type(sa, ctx.game.card(original_id), controller);
                    proto.copied_permanent = Some(original_id);
                    proto.add_remembered_player(player);
                    token_table.put(controller, proto, amount);
                }
            } else {
                let mut proto = get_proto_type(sa, ctx.game.card(original_id), controller);
                proto.copied_permanent = Some(original_id);
                token_table.put(controller, proto, amount);
            }
        }
    }

    if token_table.is_empty() {
        return;
    }

    let mut trigger_list = CardZoneTable::default();
    let result = TOKEN_EFFECT_BASE.make_token_table(ctx, token_table, true, &mut trigger_list, sa);
    if !result.created.is_empty() {
        trigger_list.trigger_changes_zone_all(ctx.trigger_handler, ctx.game, Some(sa));
    }
}

/// Build the in-memory copy of `original` that a Copy/Embalm/Eternalize effect
/// will place onto the battlefield. Mirrors Java
/// `CopyPermanentEffect.getProtoType(SpellAbility, Card, Player)`.
///
/// Returned `Card` carries a placeholder `CardId(0)`; callers must invoke
/// `GameState::create_card` to receive the real id. Mana-cost strip,
/// `SetColor`, `AddTypes`, `SetPower/Toughness`, and `AddKeywords` are applied
/// here. Shared token lifecycle params such as `PumpKeywords` are applied by
/// `TokenEffectBase` after the token receives its real id.
pub fn get_proto_type(sa: &SpellAbility, original: &Card, new_owner: crate::ids::PlayerId) -> Card {
    let mut copy = Card::new(
        CardId(0),
        original.card_name.clone(),
        new_owner,
        original.type_line.clone(),
        original.mana_cost.clone(),
        original.color,
        original.base_power,
        original.base_toughness,
        original.keywords.as_string_list(),
        original.abilities.clone(),
    );
    copy.set_triggers(original.copiable_triggers());
    copy.set_svars_map(original.svars.clone());
    copy.set_static_abilities(original.static_abilities.clone());
    copy.set_replacement_effects(original.copiable_replacement_effects());
    copy.set_perpetual(original, false);
    copy.initial_loyalty = original.initial_loyalty.clone();
    copy.set_code = original.set_code.clone();
    // Copies are tokens for zone-change purposes (cease to exist off battlefield).
    copy.set_is_token(true);

    // Apply SetColor$ (e.g. Embalm sets color to White).
    if let Some(set_color) = sa.ir.set_color.as_deref() {
        copy.set_color(ColorSet::from_names(set_color));
    }

    // Apply AddTypes$ (e.g. Embalm adds "Zombie").
    if let Some(add_types) = sa.ir.add_types.as_deref() {
        for t in add_types.split(" & ") {
            let t = t.trim();
            if !t.is_empty() {
                copy.add_type(t);
            }
        }
    }

    // Apply SetPower$/SetToughness$ (e.g. Eternalize sets to 4/4).
    if let Some(p) = sa
        .ir
        .set_power
        .as_deref()
        .and_then(|value| value.parse().ok())
    {
        copy.set_base_power(Some(p));
    }
    if let Some(t) = sa
        .ir
        .set_toughness
        .as_deref()
        .and_then(|value| value.parse().ok())
    {
        copy.set_base_toughness(Some(t));
    }

    // PumpKeywords$ are NOT applied at the proto stage. Mirrors Java
    // `TokenEffectBase.java:179-182`, which applies them post-creation via
    // `addChangedCardKeywords` + `addPumpUntil` so they expire per
    // `PumpDuration$`. Applying them as intrinsic here would make e.g.
    // Ashling's "Haste until end of turn" persist forever.
    // The Rust mirror lives in `token_effect_base.rs::create_single_token`.

    // Apply AddKeywords$ (e.g. additional keywords on the copy).
    if let Some(add_kws) = sa.ir.add_keywords.as_deref() {
        for kw in add_kws.split(" & ") {
            let kw = kw.trim();
            if !kw.is_empty() {
                copy.add_intrinsic_keyword(kw);
            }
        }
    }

    // Strip mana cost for Embalm/Eternalize copies (they have no mana cost).
    if sa
        .ir
        .set_mana_cost
        .as_deref()
        .is_some_and(|v| v == "0" || v.is_empty())
    {
        copy.set_mana_cost(forge_foundation::mana::ManaCost::no_cost());
    }

    copy
}

fn resolve_copy_controllers(ctx: &EffectContext, sa: &SpellAbility) -> Vec<crate::ids::PlayerId> {
    if let Some(controller) = sa.ir.controller_text.as_deref() {
        let players = crate::ability::ability_utils::resolve_defined_players_with_sa(
            controller,
            sa,
            sa.activating_player,
            ctx.game,
        );
        if !players.is_empty() {
            return players;
        }
    }
    vec![sa.activating_player]
}

fn resolve_originals(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    controller: crate::ids::PlayerId,
) -> Vec<CardId> {
    if let Some(choices) = sa.ir.choices.as_deref() {
        let candidates: Vec<CardId> = ctx
            .game
            .cards
            .iter()
            .filter(|card| card.zone == ZoneType::Battlefield)
            .map(|card| card.id)
            .filter(|&card_id| {
                let Some(source_id) = sa.source else {
                    return false;
                };
                crate::card::valid_filter::matches_valid(
                    choices,
                    Some(ctx.game.card(card_id)),
                    None,
                    ctx.game.card(source_id),
                    sa.activating_player,
                )
            })
            .collect();
        if candidates.is_empty() {
            return Vec::new();
        }

        let chooser = sa
            .ir
            .chooser
            .as_deref()
            .and_then(|defined| {
                crate::ability::ability_utils::resolve_defined_players_with_sa(
                    defined,
                    sa,
                    sa.activating_player,
                    ctx.game,
                )
                .into_iter()
                .next()
            })
            .unwrap_or(sa.activating_player);
        ctx.agents[chooser.index()].snapshot_state(ctx.game, ctx.mana_pools);
        return ctx.agents[chooser.index()]
            .choose_single_card_for_zone_change(
                ctx.game,
                chooser,
                &candidates,
                "Choose a card",
                false,
            )
            .into_iter()
            .collect();
    }

    if let Some(defined) = sa.defined() {
        match defined {
            "Self" => return sa.source.into_iter().collect(),
            "ParentTarget" => return sa.target_chosen.target_card.into_iter().collect(),
            "TriggeredCard" | "TriggeredCardLKICopy" | "TriggeredSacrificedCard" => {
                return sa
                    .get_triggering_card(crate::ability::AbilityKey::Card)
                    .into_iter()
                    .collect();
            }
            _ => {
                return crate::ability::ability_utils::get_defined_cards(
                    ctx.game,
                    sa.source,
                    defined,
                    Some(controller),
                );
            }
        }
    }

    // Check Defined$ parameter first.
    // Fall back to targeting.
    sa.target_chosen.target_card.into_iter().collect()
}
