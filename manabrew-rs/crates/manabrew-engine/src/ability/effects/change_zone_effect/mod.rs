//! ChangeZone effect — moves cards between zones.
//!
//! Ported from Java's `ChangeZoneEffect.java`. Sub-modules:
//! - [`helpers`] — matching, pre/post move, destination resolution, search restrictions
//! - [`known`] — known-origin resolve (Battlefield, Graveyard, targeted cards)
//! - [`hidden`] — hidden-origin resolve (Library/Hand searches)
//! - [`search`] — search sub-routines (single, multi, each, random, player choice)
//! - [`stack`] — stack removal (bouncing/exiling spells)
//! - [`move_cards`] — shared move + post-processing logic

pub(super) mod helpers;
mod hidden;
mod known;
pub(super) mod move_cards;
pub(super) mod search;
mod stack;

use forge_foundation::ZoneType;

use super::EffectContext;
use crate::spellability::SpellAbility;

/// Struct form so this directory-module effect can participate in the
/// `SpellAbilityEffect` trait hierarchy alongside the single-file effects.
#[manabrew_engine_macros::spell_effect(ChangeZoneEffect)]
fn resolve(ctx: &mut EffectContext, sa: &SpellAbility) {
    resolve(ctx, sa);
}

/// Configure the spell ability during construction.
/// Mirrors Java `ChangeZoneEffect.buildSpellAbility` — calls
/// `adjustChangeZoneTarget` to set the target zone to the origin zone.
pub fn build_spell_ability(sa: &mut SpellAbility) {
    if let Some(zone) = sa.origin_zone() {
        if let Some(ref mut tr) = sa.target_restrictions {
            if !tr.can_tgt_player() {
                tr.tgt_zone = vec![zone];
            }
        }
    }
}

/// Top-level resolve dispatcher — mirrors Java's `resolve()` which splits on
/// `sa.isHidden()` into hidden-origin (library search) vs known-origin paths.
pub fn resolve(ctx: &mut EffectContext, sa: &SpellAbility) {
    let dest_zone = match sa.destination_zone() {
        Some(z) => z,
        None => return,
    };

    // Multi-origin: Origin$ can be comma-separated (e.g. "Library,Graveyard")
    let origins: Vec<ZoneType> = sa.origin_zones();

    if origins.is_empty() {
        // `Origin$ All` — Java's `ZoneType.listValueOf("All")` is empty and
        // `ZoneType.isHidden(origin)` returns true for that case. Resolve
        // the SA's `Defined$` (or targets) to concrete cards, then dispatch
        // the known-origin path once per zone they currently occupy.
        // `NoShuffle` because this is not a library search (CR 701.18).
        let is_origin_all = sa.origin().is_some_and(|o| o.eq_ignore_ascii_case("All"));
        if !is_origin_all {
            return;
        }
        let defined_cards =
            crate::ability::spell_ability_effect::get_defined_cards_or_targeted(ctx.game, sa);
        if defined_cards.is_empty() {
            return;
        }
        let mut zones: Vec<ZoneType> = Vec::new();
        for cid in &defined_cards {
            let zone = ctx.game.card(*cid).zone;
            if !zones.contains(&zone) {
                zones.push(zone);
            }
        }
        let mut sa_no_shuffle = sa.clone();
        sa_no_shuffle.ir.no_shuffle = true;
        for zone in zones {
            known::resolve_known_origin(ctx, &sa_no_shuffle, zone, dest_zone);
        }
        return;
    }

    let primary_origin = origins[0];

    // Java parity: sa.isHidden() && !sa.isNinjutsu() → hidden path
    if (primary_origin.is_hidden() || sa.is_hidden()) && !sa.ir.ninjutsu {
        hidden::resolve_hidden_origin(ctx, sa, primary_origin, dest_zone);
    } else {
        known::resolve_known_origin(ctx, sa, primary_origin, dest_zone);
    }
}
