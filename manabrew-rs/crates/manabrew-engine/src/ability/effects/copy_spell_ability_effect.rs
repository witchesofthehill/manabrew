use super::EffectContext;
use crate::event::RunParams;
use crate::replacement::replacement_handler::{apply_replacements, ReplacementEvent};
use crate::replacement::ReplacementResult;
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

/// Configure the spell ability during construction.
/// Mirrors Java `CopySpellAbilityEffect.buildSpellAbility` — sets the target zone
/// to Stack so the ability targets spells on the stack.
pub fn build_spell_ability(sa: &mut SpellAbility) {
    if sa.uses_targeting() {
        if let Some(ref mut tr) = sa.target_restrictions {
            tr.tgt_zone = vec![forge_foundation::ZoneType::Stack];
        }
    }
}

/// `SP$ CopySpellAbility` — copy the top spell on the stack.
///
/// Mirrors Java's `CopySpellAbilityEffect.java` (basic version).
/// Creates a clone of the topmost spell on the stack with the same targets.
/// Full retargeting support deferred.
///
/// # Card script examples
/// ```text
/// A:SP$ CopySpellAbility | Defined$ TopStack
/// A:SP$ CopySpellAbility | Defined$ TriggeredSpellAbility
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `CopySpellAbilityEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(CopySpellAbilityEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;

    // Run CopySpell replacement effects before copying.
    let mut event = ReplacementEvent::CopySpell {
        player: controller,
        count: 1,
    };
    let result = apply_replacements(ctx.game, &mut event);
    if result == ReplacementResult::Skipped || result == ReplacementResult::Replaced {
        return;
    }

    let original = if let Some(defined) = sa.defined() {
        crate::ability::ability_utils::get_defined_spell_abilities(defined, sa, ctx.game)
            .into_iter()
            .next()
    } else {
        let stack_entries: Vec<_> = ctx.game.stack.iter().collect();
        stack_entries.iter().rev().find_map(|entry| {
            if Some(entry.id) != sa.ir.stack_id {
                Some(entry.spell_ability.clone())
            } else {
                None
            }
        })
    };

    let original = match original {
        Some(spell) => spell,
        None => return,
    };
    if crate::card::card_factory::spell_ability_cant_be_copied(&ctx.game.cards, &original) {
        return;
    }

    // Clone the spell ability with same targets using CardFactory parity helper.
    let copy = crate::card::card_factory::copy_spell_ability(&original, controller);

    // Push the copy onto the stack (it will resolve like a normal spell)
    let copy_entry = crate::spellability::StackEntry {
        id: 0, // will be assigned by push()
        spell_ability: copy,
        is_pending_cast: false,
        is_creature_spell: original.is_spell
            && original
                .source
                .is_some_and(|cid| ctx.game.card(cid).is_creature()),
        is_permanent_spell: original.is_spell
            && original
                .source
                .is_some_and(|cid| ctx.game.card(cid).is_permanent()),
        cast_from_zone: None,
        optional_trigger_decider: None,
        optional_trigger_description: None,
        optional_trigger_source_name: None,
    };

    let trigger_sa = copy_entry.spell_ability.clone();
    ctx.game.stack.push(copy_entry);
    if let Some(source_id) = trigger_sa.source {
        ctx.trigger_handler.run_trigger(
            TriggerType::SpellCopied,
            RunParams {
                spell_card: Some(source_id),
                spell_controller: Some(controller),
                source_sa: Some(trigger_sa.clone()),
                ..Default::default()
            },
            false,
        );
        super::emit_targeting_triggers(ctx, source_id, &trigger_sa);
    }
}
