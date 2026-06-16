//! ChangeZoneResolve effect — resolves accumulated zone changes.
//!
//! Mirrors Java's `ChangeZoneResolveEffect.java`.
//! Triggers zone-change events for all cards that moved during
//! a batched zone-change operation.

use super::EffectContext;

/// Resolve accumulated zone change triggers.
/// In practice this is handled by the zone-change bookkeeping in the engine;
/// this effect serves as the explicit resolution point matching Java's pattern.
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ChangeZoneResolveEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ChangeZoneResolveEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    if let Some(table) = sa.change_zone_table.as_ref() {
        table.trigger_changes_zone_all(ctx.trigger_handler, ctx.game, Some(sa));
        return;
    }
    if let Some(table) = ctx.game.pending_change_zone_table.clone() {
        table.trigger_changes_zone_all(ctx.trigger_handler, ctx.game, Some(sa));
        ctx.game.clear_pending_change_zone_table();
    }
}

#[cfg(test)]
mod tests {
    use crate::ability::spell_ability_effect::SpellAbilityEffect;
    use std::collections::HashMap;

    use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};

    use crate::ability::effects::change_zone_effect;
    use crate::ability::effects::EffectContext;
    use crate::agent::{PassAgent, PlayerAgent};
    use crate::card::Card;
    use crate::game::GameState;
    use crate::ids::{CardId, PlayerId};
    use crate::mana::ManaPool;
    use crate::spellability::SpellAbility;
    use crate::trigger::handler::TriggerHandler;

    #[test]
    fn change_zone_resolve_clears_pending_table() {
        let mut game = GameState::new(&["A", "B"], 20);
        let p0 = PlayerId(0);
        let c = Card::new(
            CardId(0),
            "X".to_string(),
            p0,
            CardTypeLine::parse("Creature"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            Some(1),
            Some(1),
            vec![],
            vec![],
        );
        let cid = game.create_card(c);
        game.ensure_pending_change_zone_table();
        game.move_card(cid, ZoneType::Battlefield, p0);

        let sa = SpellAbility::new_simple(Some(cid), p0, "DB$ ChangeZoneResolve");
        let mut th = TriggerHandler::new();
        let mut agents: Vec<Box<dyn PlayerAgent>> = vec![Box::new(PassAgent), Box::new(PassAgent)];
        let mut pools = vec![ManaPool::default(), ManaPool::default()];
        let templates = HashMap::new();
        let templates_variants = HashMap::new();
        let token_fallback = HashMap::new();
        let edition_dates: HashMap<String, String> = HashMap::new();
        let mut rng = crate::game_rng::ThreadRngAdapter;
        let mut ctx = EffectContext {
            game: &mut game,
            combat: None,
            agents: &mut agents,
            trigger_handler: &mut th,
            token_templates: &templates,
            token_art_variants: &templates_variants,
            token_fallback: &token_fallback,
            edition_dates: &edition_dates,
            mana_pools: &mut pools,
            parent_target_card: None,
            rng: &mut rng,
        };

        super::ChangeZoneResolveEffect::resolve(&mut ctx, &sa);
        assert!(ctx.game.pending_change_zone_table.is_none());
    }
}
