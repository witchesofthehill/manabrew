use forge_foundation::ZoneType;

use super::EffectContext;
use crate::ability::spell_ability_effect::get_target_cards;
use crate::event::RunParams;
use crate::ids::CardId;
use crate::trigger::TriggerType;

/// Resolve `SP$ Tap` — tap target permanent(s).
///
/// Mirrors Java `TapEffect.java`.
///
/// # Card script examples
/// ```text
/// A:SP$ Tap | ValidTgts$ Creature | TgtPrompt$ Select target creature to tap
/// A:SP$ Tap | Defined$ Self
/// A:SP$ Tap | Defined$ Self | ETB$ True
/// A:SP$ Tap | ValidTgts$ Creature | RememberTapped$ True
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `TapEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(TapEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;
    let etb = sa.ir.etb;
    let remember_tapped = sa.ir.remember_tapped;
    let always_remember = sa.ir.always_remember;

    // Mirrors Java TapEffect.getTargetCards(sa), including non-targeting
    // Defined$ cases like ReplacedCard and defaulting to Self.
    for target_card in get_target_cards(ctx.game, sa) {
        tap_card(
            ctx,
            target_card,
            controller,
            etb,
            remember_tapped,
            always_remember,
            sa.source,
        );
    }
}

fn tap_card(
    ctx: &mut EffectContext,
    card_id: CardId,
    controller: crate::ids::PlayerId,
    etb: bool,
    remember_tapped: bool,
    always_remember: bool,
    source: Option<CardId>,
) {
    if etb {
        // Java parity: ETB tap effects mark the card tapped even if the move
        // replacement is executing before the card is physically on the battlefield.
        ctx.game.card_mut(card_id).set_tapped(true);
        return;
    }

    if ctx.game.card(card_id).zone != ZoneType::Battlefield {
        return;
    }

    let was_untapped = !ctx.game.card(card_id).tapped;
    let tapped = ctx.game.tap(card_id);
    if tapped {
        ctx.trigger_handler.run_trigger(
            TriggerType::Taps,
            RunParams {
                card: Some(card_id),
                player: Some(controller),
                ..Default::default()
            },
            false,
        );
    }

    // RememberTapped / AlwaysRemember
    if (remember_tapped && was_untapped) || always_remember {
        if let Some(src) = source {
            ctx.game.card_mut(src).add_remembered_card(card_id);
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
    fn tap_effect_taps_target() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);
        let c1 = make_creature(&mut game, p0);
        game.move_card(c1, ZoneType::Battlefield, p0);
        assert!(!game.card(c1).tapped);

        let mut sa = SpellAbility::new_simple(None, p0, "SP$ Tap | ValidTgts$ Creature");
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
        super::TapEffect::resolve(&mut ctx, &sa);

        assert!(ctx.game.card(c1).tapped);
    }
}
