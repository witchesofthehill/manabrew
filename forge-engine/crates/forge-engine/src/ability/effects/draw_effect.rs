use super::{resolve_numeric_svar, EffectContext};
use crate::ability::ability_ir::EffectIr;
use crate::ability::spell_ability_effect::get_target_players;
use crate::event::RunParams;
use crate::parsing::keys;
use crate::replacement::replacement_handler::{apply_replacements_with_agents, ReplacementEvent};
use crate::replacement::ReplacementResult;
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `DrawEffect` class extending `SpellAbilityEffect`.
#[forge_engine_macros::spell_effect(DrawEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let num = resolve_draw_amount(ctx, sa);
    let targets = get_target_players(ctx.game, sa);

    for target in targets {
        draw_for_player(ctx, sa, target, num);
    }
}

fn draw_for_player(
    ctx: &mut EffectContext,
    sa: &crate::spellability::SpellAbility,
    target: crate::ids::PlayerId,
    num: i32,
) {
    let mut actual_num = num;
    if actual_num > 0 {
        let mut event = ReplacementEvent::DrawCards {
            player: target,
            count: actual_num,
        };
        let result = apply_replacements_with_agents(ctx.game, ctx.agents, &mut event);
        if result == ReplacementResult::Skipped || result == ReplacementResult::Replaced {
            return;
        }
        if let ReplacementEvent::DrawCards { count, .. } = event {
            actual_num = count;
        }
    }

    // Mirrors Java `DrawEffect.resolve` (DrawEffect.java:60-92):
    //   final boolean upto = sa.hasParam("Upto");
    //   final boolean optional = sa.hasParam("OptionalDecider") || upto;
    //   if (optional) confirm "draw N cards?" — return on decline.
    //   if (upto)     chooseNumber(0..=N) for the actual count.
    let upto = sa.ir.upto;
    let optional = sa.ir.optional_present || sa.ir.optional_decider.is_some() || upto;
    if optional {
        let source_name = sa.source.map(|cid| ctx.game.card(cid).card_name.as_str());
        let accepted = ctx.agents[target.index()].confirm_action(
            target,
            None,
            &format!("Do you want to draw {} card(s)?", actual_num),
            &[],
            sa.source,
            Some(crate::ability::api_type::ApiType::Draw),
        );
        if !accepted {
            return;
        }
    }
    if upto {
        match ctx.agents[target.index()].choose_number(target, 0, actual_num) {
            Some(picked) => {
                actual_num = picked.clamp(0, actual_num);
                if actual_num == 0 {
                    return;
                }
            }
            None => return,
        }
    }
    // Draw cards one at a time and fire Drawn trigger after each draw.
    // This ensures `drawn_this_turn` is correct for triggers with `Number$ N`
    // (e.g. Sneaky Snacker: "When you draw your third card in a turn...").
    let remember_drawn = sa.ir.remember_drawn;
    let mut drawn: Vec<crate::ids::CardId> = Vec::new();
    for _ in 0..actual_num {
        if let Some(card_id) = ctx.game.draw_card_with_agents(target, ctx.agents) {
            drawn.push(card_id);
            // Snapshot drawn_this_turn AFTER draw_card increments it.
            // This captures the exact count at draw time for Number$ N matching.
            let drawn_snapshot = ctx.game.player(target).drawn_this_turn;
            ctx.trigger_handler.run_trigger(
                TriggerType::Drawn,
                RunParams {
                    card: Some(card_id),
                    player: Some(target),
                    drawn_this_turn_snapshot: Some(drawn_snapshot),
                    ..Default::default()
                },
                false,
            );
            // Flush/match Drawn triggers immediately so that triggers with
            // Number$ N (e.g. Sneaky Snacker "3rd card") see the correct game
            // state at draw time. Only flush if there's a Number$ Drawn trigger
            // that needs fire-time matching (to avoid disrupting other triggers).
            if ctx.trigger_handler.has_number_drawn_triggers(ctx.game) {
                ctx.trigger_handler.flush_waiting_triggers(ctx.game);
            }
        }
    }

    // `RememberDrawn$ True` — attach each drawn card to the source card's
    // remembered list (e.g. Mystic Remora, Dark Confidant variants).
    if remember_drawn {
        if let Some(source_id) = sa.source {
            let card_mut = ctx.game.card_mut(source_id);
            for cid in &drawn {
                card_mut.add_remembered_card(*cid);
            }
        }
    }
}

fn resolve_draw_amount(ctx: &EffectContext, sa: &SpellAbility) -> i32 {
    if let Some(EffectIr::Draw(ir)) = &sa.ir.effect {
        if let Some(amount) = &ir.amount {
            let resolved = amount.resolve_for_spell_ability(ctx.game, sa, 1);
            #[cfg(debug_assertions)]
            debug_assert_eq!(
                resolved,
                resolve_numeric_svar(ctx.game, sa, keys::NUM_CARDS, 1),
                "compiled Draw amount diverged from string params"
            );
            return resolved;
        }
    }

    resolve_numeric_svar(ctx.game, sa, keys::NUM_CARDS, 1)
}
