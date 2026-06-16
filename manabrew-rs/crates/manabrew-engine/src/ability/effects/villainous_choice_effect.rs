//! VillainousChoice effect — opponent chooses which punishment to receive.
//!
//! Ported 1:1 from Java's `VillainousChoiceEffect.java`.
//! Each target/defined player chooses one of the Choices sub-abilities
//! to resolve against them. The opponent picks their punishment.

use super::EffectContext;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `VillainousChoiceEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(VillainousChoiceEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;

    // Get choices (sub-ability names from Choices$ param)
    let choice_names: Vec<String> = sa
        .ir
        .choices
        .as_deref()
        .map(|s| s.split(',').map(|c| c.trim().to_string()).collect())
        .unwrap_or_default();

    if choice_names.is_empty() {
        return;
    }

    let players = if let Some(def) = sa.defined_player() {
        super::resolve_defined_players(def, controller, ctx.game)
    } else {
        vec![ctx.game.opponent_of(controller)]
    };

    for pid in players {
        if ctx.game.player(pid).has_lost {
            continue;
        }

        // Player chooses which ability resolves (opponent picks their punishment)
        ctx.agents[pid.index()].snapshot_state(ctx.game, ctx.mana_pools);
        let chose_first = ctx.agents[pid.index()].confirm_action(
            pid,
            Some("VillainousChoice"),
            &format!("Choose: {}", choice_names.join(" or ")),
            &choice_names,
            None,
            None,
        );

        // The chosen sub-ability is resolved via the SA's sub-ability chain.
        // Store the choice index for the parent resolution system.
        if let Some(source_id) = sa.source {
            let choice_idx = if chose_first {
                0
            } else {
                1.min(choice_names.len() - 1)
            };
            ctx.game
                .card_mut(source_id)
                .add_remembered_cmc(choice_idx as i32);
            ctx.game.card_mut(source_id).add_remembered_player(pid);
        }
    }
}
