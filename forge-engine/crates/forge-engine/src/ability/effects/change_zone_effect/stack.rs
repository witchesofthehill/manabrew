//! Stack removal — bouncing/exiling spells on the stack.
//!
//! Mirrors Java's `removeFromStack` (lines 1593-1649).

use forge_foundation::ZoneType;

use super::super::{emit_zone_trigger, EffectContext};
use crate::ids::PlayerId;
use crate::spellability::SpellAbility;

/// Remove a spell from the stack and move it to a destination zone.
pub(super) fn resolve_stack_removal(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    dest_zone: ZoneType,
    lib_position: &str,
    _controller: PlayerId,
) {
    let target_card = if sa.uses_targeting() {
        sa.target_chosen.target_card
    } else if let Some(src) = sa
        .trigger_source
        .filter(|&cid| ctx.game.card(cid).zone == ZoneType::Stack)
    {
        Some(src)
    } else {
        // Fallback to `Defined$ Self` (the source card) when the SA has no
        // targets and no triggering card. Java's stack-removal path defaults
        // to the host card here; without this, abilities like Avatar's
        // Wrath's `DB$ ChangeZone | Origin$ Stack | Destination$ Exile`
        // never exile the spell, leaving it to the default graveyard move.
        sa.source
            .filter(|&cid| ctx.game.card(cid).zone == ZoneType::Stack)
    };

    let Some(card_id) = target_card else { return };
    if ctx.game.card(card_id).zone != ZoneType::Stack {
        return;
    }

    // Tokens on stack cease to exist when exiled
    if dest_zone == ZoneType::Exile && ctx.game.card(card_id).is_token {
        return;
    }

    let old_zone = ctx.game.card(card_id).zone;
    let dest_owner = ctx.game.card(card_id).owner;
    ctx.move_card(card_id, dest_zone, dest_owner);

    // ExiledWith for exile
    if dest_zone == ZoneType::Exile {
        if let Some(source_id) = sa.source {
            if sa.ir.exiled_with_effect_source {
                let exile_source = ctx.game.card(source_id).effect_source.unwrap_or(source_id);
                ctx.game.card_mut(card_id).set_exiled_by(Some(exile_source));
                ctx.game.card_mut(exile_source).add_remembered_card(card_id);
            }
        }
    }

    // Library positioning
    if dest_zone == ZoneType::Library
        && (lib_position == "-1" || lib_position.eq_ignore_ascii_case("Bottom"))
    {
        ctx.game
            .reorder_card_in_zone(ZoneType::Library, dest_owner, card_id, 0);
    }

    if dest_zone == ZoneType::Library && sa.is_shuffle() {
        ctx.game
            .shuffle_zone_cards(ZoneType::Library, dest_owner, ctx.rng);
    }

    // Counters
    if let Some(ct) = sa.with_counters_type_enum() {
        let amount = crate::svar::resolve_numeric_svar(
            ctx.game,
            sa,
            crate::parsing::keys::WITH_COUNTERS_AMOUNT,
            1,
        );
        ctx.game.card_mut(card_id).add_counter(ct, amount);
    }

    // Remember/Imprint
    if sa.is_remember_changed() {
        if let Some(sid) = sa.source {
            ctx.game.card_mut(sid).add_remembered_card(card_id);
        }
    }
    if sa.is_imprint() {
        if let Some(sid) = sa.source {
            ctx.game.card_mut(sid).add_imprinted_card(card_id);
        }
    }

    emit_zone_trigger(ctx.trigger_handler, card_id, old_zone, dest_zone);
}
