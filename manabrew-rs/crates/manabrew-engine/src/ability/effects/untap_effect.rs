use forge_foundation::ZoneType;

use super::{resolve_numeric_svar, EffectContext};
use crate::ability::ability_ir::DefinedRef;
use crate::card::card_util;
use crate::event::RunParams;
use crate::ids::CardId;
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

/// Resolve `SP$ Untap` — untap target permanent(s).
///
/// Mirrors Java `UntapEffect.java`.
///
/// # Card script examples
/// ```text
/// A:SP$ Untap | ValidTgts$ Creature | TgtPrompt$ Select target creature to untap
/// A:SP$ Untap | Defined$ Self
/// A:SP$ Untap | Defined$ Self | ETB$ True
/// DB$ Untap | Defined$ ParentTarget
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `UntapEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(UntapEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;
    let etb = sa.ir.etb;

    let mut targets = if sa.ir.untap_up_to {
        choose_untap_type_targets(ctx, sa, controller)
    } else {
        resolve_untap_targets(ctx, sa)
    };
    targets.extend(card_util::get_radiance(ctx.game, sa).iter().copied());
    targets.sort_unstable_by_key(|cid| cid.0);
    targets.dedup();

    for card_id in targets {
        if ctx.game.card(card_id).zone == ZoneType::Battlefield {
            untap_card(ctx, card_id, controller, etb);
        }
    }
}

/// Resolve target cards for untap: explicit target, or `Defined$ Self`,
/// `Defined$ ParentTarget`, or `Defined$ Remembered` (cards remembered by the
/// source — e.g. Fabled Passage's conditional untap of the fetched land).
fn resolve_untap_targets(ctx: &EffectContext, sa: &SpellAbility) -> Vec<CardId> {
    if let Some(c) = sa.target_chosen.target_card {
        return vec![c];
    }
    match sa
        .ir
        .defined
        .as_ref()
        .and_then(|defined| defined.refs.first())
    {
        None | Some(DefinedRef::SelfCard) => sa.source.into_iter().collect(),
        Some(DefinedRef::ParentTarget) => ctx.parent_target_card.into_iter().collect(),
        Some(DefinedRef::Remembered) => sa
            .source
            .map(|sid| ctx.game.card(sid).remembered_cards.clone())
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

fn choose_untap_type_targets(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    controller: crate::ids::PlayerId,
) -> Vec<CardId> {
    let Some(untap_type) = sa.ir.untap_type.as_deref() else {
        return Vec::new();
    };

    // Java parity: `UntapType$ Land` permits ANY land (e.g. Frantic Search).
    // Only narrow to the activator's permanents when the filter explicitly
    // calls that out (`Land.YouCtrl`, `Creature.YouCtrl`, etc.). Otherwise
    // sweep every battlefield permanent so opponent-controlled lands stay
    // selectable.
    let valid_filter = untap_type.to_string();
    let scope_to_controller = valid_filter.contains("YouCtrl");
    let valid_selector = crate::parsing::cached_compiled_selector(&valid_filter);
    let candidates: Vec<CardId> = if scope_to_controller {
        ctx.game
            .cards_in_zone(ZoneType::Battlefield, controller)
            .iter()
            .copied()
            .collect()
    } else {
        ctx.game.cards_in_all_zones(ZoneType::Battlefield).collect()
    };
    let valid: Vec<CardId> = candidates
        .into_iter()
        .filter(|&card_id| {
            // Only tapped permanents are meaningful untap targets — Java's
            // `UntapEffect.untapTargetList` filters by `isTapped()` before
            // offering choices.
            ctx.game.card(card_id).tapped
                && super::matches_valid_cards_for_sa(
                    ctx.game,
                    sa,
                    ctx.game.card(card_id),
                    Some(&valid_selector),
                    &valid_filter,
                )
        })
        .collect();
    if valid.is_empty() {
        return Vec::new();
    }

    let amount = resolve_numeric_svar(ctx.game, sa, "Amount", valid.len() as i32).max(0) as usize;
    let max = amount.min(valid.len());
    let min = if sa.ir.untap_up_to { 0 } else { max };
    ctx.agents[controller.index()].choose_cards_for_effect(controller, &valid, min, max)
}

fn untap_card(
    ctx: &mut EffectContext,
    card_id: CardId,
    controller: crate::ids::PlayerId,
    etb: bool,
) {
    if etb {
        // ETB: directly set untapped without firing trigger
        ctx.game.card_mut(card_id).set_tapped(false);
    } else {
        let untapped = ctx.game.untap(card_id);
        if untapped {
            ctx.trigger_handler.run_trigger(
                TriggerType::Untaps,
                RunParams {
                    card: Some(card_id),
                    player: Some(controller),
                    ..Default::default()
                },
                false,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::ability::spell_ability_effect::SpellAbilityEffect;
    use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};
    use std::collections::HashMap;

    use crate::ability::effects::EffectContext;
    use crate::agent::PassAgent;
    use crate::card::Card;
    use crate::game::GameState;
    use crate::ids::{CardId, PlayerId};
    use crate::mana::ManaPool;
    use crate::spellability::SpellAbility;
    use crate::trigger::handler::TriggerHandler;

    fn make_creature(game: &mut GameState, owner: PlayerId) -> CardId {
        let c = Card::new(
            CardId(0),
            "Bear".into(),
            owner,
            CardTypeLine::parse("Creature - Bear"),
            ManaCost::parse("1 G"),
            ColorSet::GREEN,
            Some(2),
            Some(2),
            vec![],
            vec![],
        );
        game.create_card(c)
    }

    #[test]
    fn untap_effect_untaps_target() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);
        let c1 = make_creature(&mut game, p0);
        game.move_card(c1, ZoneType::Battlefield, p0);
        game.tap(c1);
        assert!(game.card(c1).tapped);

        let mut sa = SpellAbility::new_simple(None, p0, "SP$ Untap | ValidTgts$ Creature");
        sa.target_chosen.target_card = Some(c1);

        let mut th = TriggerHandler::new();
        let mut agents: Vec<Box<dyn crate::agent::PlayerAgent>> =
            vec![Box::new(PassAgent), Box::new(PassAgent)];
        let mut mp = vec![ManaPool::default(), ManaPool::default()];
        let templates = HashMap::new();
        let templates_variants = HashMap::new();
        let token_fallback = HashMap::new();
        let edition_dates: HashMap<String, String> = HashMap::new();
        let mut rng_adapter = crate::game_rng::ThreadRngAdapter;
        let mut ctx = EffectContext {
            game: &mut game,
            combat: None,
            agents: &mut agents,
            trigger_handler: &mut th,
            token_templates: &templates,
            token_art_variants: &templates_variants,
            token_fallback: &token_fallback,
            edition_dates: &edition_dates,
            mana_pools: &mut mp,
            parent_target_card: None,
            rng: &mut rng_adapter,
        };
        super::UntapEffect::resolve(&mut ctx, &sa);

        assert!(!ctx.game.card(c1).tapped);
    }
}
