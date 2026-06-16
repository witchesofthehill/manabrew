use forge_foundation::ZoneType;

use super::EffectContext;
use crate::ability::ability_ir::DefinedRef;
use crate::event::{AbilityValue, RunParams};
use crate::trigger::TriggerType;

/// Resolve `SP$ Phases` — phase permanents in or out.
///
/// Mirrors Java `PhasesEffect.java`.
/// Toggles or sets `card.phased_out` on target cards. Phased-out permanents
/// are treated as not on the battlefield for game purposes.
///
/// # Card script examples
/// ```text
/// A:SP$ Phases | ValidTgts$ Creature | TgtPrompt$ Select target creature
/// A:SP$ Phases | Defined$ Self | PhaseInOrOut$ Out
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `PhasesEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(PhasesEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let phase_mode = sa.ir.phase_in_or_out_text.as_deref().unwrap_or("Out");

    // Defined$ DelayTriggerRememberedLKI / Remembered — phase the cards
    // remembered by the parent delayed trigger (e.g. Teferi's Veil's
    // "creature phases out at end of combat" queues the attacker's LKI).
    match sa.defined_ref() {
        Some(
            DefinedRef::DelayTriggerRememberedLki
            | DefinedRef::DelayTriggerRemembered
            | DefinedRef::Remembered,
        ) => {
            let ids: Vec<crate::ids::CardId> = sa
                .trigger_remembered
                .iter()
                .filter_map(|v| match v {
                    AbilityValue::Card(cid) => Some(*cid),
                    _ => None,
                })
                .collect();
            for cid in ids {
                if ctx.game.card(cid).zone == ZoneType::Battlefield {
                    apply_phase(ctx, cid, phase_mode);
                }
            }
            return;
        }
        _ => {}
    }

    // Targeted: use the chosen target card.
    if let Some(target_card) = sa.target_chosen.target_card {
        if ctx.game.card(target_card).zone == ZoneType::Battlefield {
            apply_phase(ctx, target_card, phase_mode);
        }
        return;
    }

    // Defined$ Self — phase the source card.
    if let Some(source) = sa.source {
        if ctx.game.card(source).zone == ZoneType::Battlefield {
            apply_phase(ctx, source, phase_mode);
        }
    }
}

fn apply_phase(ctx: &mut EffectContext, card_id: crate::ids::CardId, mode: &str) {
    match mode {
        "In" => {
            if ctx.game.card(card_id).phased_out {
                ctx.game.card_mut(card_id).set_phased_out(false);
                ctx.trigger_handler.run_trigger(
                    TriggerType::PhasedIn,
                    RunParams {
                        card: Some(card_id),
                        ..Default::default()
                    },
                    false,
                );
            }
        }
        _ => {
            if !ctx.game.card(card_id).phased_out {
                ctx.game.card_mut(card_id).set_phased_out(true);
                ctx.trigger_handler.run_trigger(
                    TriggerType::PhasedOut,
                    RunParams {
                        card: Some(card_id),
                        ..Default::default()
                    },
                    false,
                );
            }
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
    fn phase_out_target() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);
        let c1 = make_creature(&mut game, p0);
        game.move_card(c1, ZoneType::Battlefield, p0);
        assert!(!game.card(c1).phased_out);

        let mut sa = SpellAbility::new_simple(None, p0, "SP$ Phases | PhaseInOrOut$ Out");
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
        super::PhasesEffect::resolve(&mut ctx, &sa);

        assert!(ctx.game.card(c1).phased_out);
    }

    #[test]
    fn phase_in_target() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);
        let c1 = make_creature(&mut game, p0);
        game.move_card(c1, ZoneType::Battlefield, p0);
        game.card_mut(c1).set_phased_out(true);

        let mut sa = SpellAbility::new_simple(None, p0, "SP$ Phases | PhaseInOrOut$ In");
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
        super::PhasesEffect::resolve(&mut ctx, &sa);

        assert!(!ctx.game.card(c1).phased_out);
    }
}
