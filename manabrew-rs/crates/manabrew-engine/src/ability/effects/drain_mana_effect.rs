use super::{resolve_defined_players, EffectContext};
use crate::ability::ability_ir::DefinedRef;
use crate::replacement::replacement_handler::{apply_replacements, ReplacementEvent};
use crate::replacement::ReplacementResult;

/// Mirrors Java's `DrainManaEffect` for "lose all unspent mana" effects.
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `DrainManaEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(DrainManaEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;
    let defined = sa
        .ir
        .defined
        .as_ref()
        .and_then(|defined| defined.refs.first())
        .unwrap_or(&DefinedRef::You)
        .as_legacy_str();

    let mut drained_total = 0i32;
    // Collect drained mana colors for DrainMana transfer
    let mut drained_mana: Vec<u16> = Vec::new();

    let targets = resolve_defined_players(defined, controller, ctx.game);
    for pid in &targets {
        if !ctx.game.player(*pid).is_alive() {
            continue;
        }
        // Run LoseMana replacement effects before draining mana.
        let mut event = ReplacementEvent::LoseMana { player: *pid };
        let result = apply_replacements(ctx.game, &mut event);
        if result == ReplacementResult::Skipped || result == ReplacementResult::Replaced {
            continue;
        }
        let pool = &mut ctx.mana_pools[pid.index()];
        let amount = pool.total_mana();
        if amount <= 0 {
            continue;
        }
        // Collect colors before draining (for color-preserving transfer)
        drained_mana.extend(pool.mana_colors());
        drained_total += amount;

        // Mana burn: if player has ManaBurn static, lose life equal to drained mana
        if crate::staticability::static_ability_unspent_mana::has_mana_burn(ctx.game, *pid) {
            ctx.game.player_lose_life(*pid, amount);
        }

        pool.reset_pool();
    }

    if sa.ir.drain_mana && drained_total > 0 {
        // Preserve original colors (mirrors Java behavior)
        for &color in &drained_mana {
            ctx.mana_pools[controller.index()].add_mana(crate::mana::Mana::simple(color));
        }
    }

    if sa.ir.remember_drained_mana {
        if let Some(source_id) = sa.source {
            ctx.game
                .card_mut(source_id)
                .remembered_cmc
                .push(drained_total);
        }
    }
}
