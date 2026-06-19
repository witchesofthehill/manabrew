use forge_foundation::ZoneType;

use super::{resolve_defined_player, resolve_numeric_svar, EffectContext};
use crate::event::RunParams;
use crate::replacement::replacement_handler::{apply_replacements, ReplacementEvent};
use crate::replacement::ReplacementResult;
use crate::trigger::TriggerType;

/// Mirrors Java's `ScryEffect.java`.
///
/// `SP$ Scry | ScryNum$ N`
/// Lets the activating player look at the top N cards of their library,
/// then put any number of them on the bottom in any order; the rest stay on top.
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ScryEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ScryEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let num = resolve_numeric_svar(ctx.game, sa, "ScryNum", 1).max(0) as usize;

    let target = sa
        .defined()
        .and_then(|d| resolve_defined_player(d, sa.activating_player, ctx.game))
        .unwrap_or(sa.activating_player);

    // Run Scry replacement effects before scrying.
    let mut event = ReplacementEvent::Scry {
        player: target,
        count: num as i32,
    };
    let result = apply_replacements(ctx.game, &mut event);
    if result == ReplacementResult::Skipped || result == ReplacementResult::Replaced {
        return;
    }
    let num = if let ReplacementEvent::Scry { count, .. } = event {
        count.max(0) as usize
    } else {
        num
    };

    if sa.ir.optional {
        let source_name = sa.source.map(|cid| ctx.game.card(cid).card_name.as_str());
        let accepted = ctx.agents[target.index()].confirm_action(
            target,
            None,
            "Do you want to scry?",
            &[],
            sa.source,
            Some(crate::ability::api_type::ApiType::Scry),
        );
        if !accepted {
            return;
        }
    }

    let lib_len = ctx.game.cards_in_zone(ZoneType::Library, target).len();
    if lib_len == 0 || num == 0 {
        return;
    }

    let count = num.min(lib_len);

    // Take top N cards off the library (index 0 = bottom, last = top).
    let mut top_n = ctx
        .game
        .take_top_cards_from_zone(ZoneType::Library, target, count);
    // Reverse to match Java's iteration order (top-to-bottom).
    // Java's `getCardsIn(Library, n)` returns cards starting from index 0 (top)
    // downward, so the deterministic agent must consume RNG in the same order.
    top_n.reverse();

    // Ask the agent to distribute the cards: piles[0] = top, piles[1] = bottom.
    let piles = ctx.agents[target.index()].choose_scry(ctx.game, target, sa.source, &top_n);
    let (top, bottom) = super::split_scry_piles(&top_n, &piles);

    // Bottom cards go under the library (preserve their order).
    for &id in &bottom {
        ctx.game
            .add_card_to_zone_bottom(ZoneType::Library, target, id);
    }
    // Top pile is ordered top-to-bottom (first = top of library); iterate in
    // reverse so the last append leaves the intended card on top.
    for &id in top.iter().rev() {
        ctx.game.add_card_to_zone(ZoneType::Library, target, id);
    }

    // Fire Scry trigger
    ctx.trigger_handler.run_trigger(
        TriggerType::Scry,
        RunParams {
            player: Some(target),
            ..Default::default()
        },
        false,
    );
}

#[cfg(test)]
mod tests {
    use crate::ability::spell_ability_effect::SpellAbilityEffect;
    use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};

    use crate::ability::effects::EffectContext;
    use crate::agent::{PassAgent, PlayerAgent};
    use crate::card::Card;
    use crate::combat::DefenderId;
    use crate::game::GameState;
    use crate::ids::{CardId, PlayerId};
    use crate::mana::ManaPool;
    use crate::spellability::SpellAbility;
    use crate::trigger::handler::TriggerHandler;
    use std::collections::HashMap;

    fn make_land(game: &mut GameState, owner: PlayerId) -> CardId {
        let c = Card::new(
            CardId(0),
            "Island".into(),
            owner,
            CardTypeLine::parse("Basic Land Island"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            None,
            None,
            vec![],
            vec![],
        );
        game.create_card(c)
    }

    /// Agent that always puts all cards on the bottom.
    struct BottomAllAgent;
    impl PlayerAgent for BottomAllAgent {
        fn mulligan_decision(&mut self, _: PlayerId, _: &[CardId], _: u32) -> bool {
            true
        }
        fn choose_action(
            &mut self,
            player: PlayerId,
            action_space: Option<&crate::agent::PriorityActionSpace>,
            request_action_space: &mut dyn FnMut() -> crate::agent::PriorityActionSpace,
        ) -> crate::player::actions::PlayerAction {
            crate::player::actions::PlayerAction::PassPriority
        }
        fn choose_attackers(
            &mut self,
            _: PlayerId,
            _: &[CardId],
            _: &[DefenderId],
        ) -> Vec<(CardId, DefenderId)> {
            vec![]
        }
        fn choose_blockers(
            &mut self,
            _: PlayerId,
            _: &[CardId],
            _: &[CardId],
            _: Option<usize>,
        ) -> Vec<(CardId, CardId)> {
            vec![]
        }
        fn choose_target_player(
            &mut self,
            _: PlayerId,
            v: &[PlayerId],
            _sa: Option<&crate::spellability::SpellAbility>,
        ) -> Option<PlayerId> {
            v.first().copied()
        }
        fn choose_target_card(
            &mut self,
            _: PlayerId,
            v: &[CardId],
            _sa: Option<&crate::spellability::SpellAbility>,
        ) -> Option<CardId> {
            v.first().copied()
        }
        fn choose_target_any(
            &mut self,
            _: PlayerId,
            vp: &[PlayerId],
            vc: &[CardId],
            _sa: Option<&crate::spellability::SpellAbility>,
        ) -> crate::agent::TargetChoice {
            vp.first()
                .copied()
                .map(crate::agent::TargetChoice::Player)
                .or_else(|| vc.first().copied().map(crate::agent::TargetChoice::Card))
                .unwrap_or(crate::agent::TargetChoice::None)
        }
        fn choose_land_or_spell(&mut self, _: PlayerId) -> Option<bool> {
            None
        }
        fn choose_scry(
            &mut self,
            _game: &GameState,
            _player: PlayerId,
            _source: Option<CardId>,
            cards: &[CardId],
        ) -> Vec<Vec<CardId>> {
            vec![vec![], cards.to_vec()] // put all on bottom
        }
        fn choose_targets_for(
            &mut self,
            _sa: &mut SpellAbility,
            _game: &GameState,
            _mana_pools: &[ManaPool],
        ) -> bool {
            false
        }
    }

    #[test]
    fn scry_puts_chosen_on_bottom() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);

        let a = make_land(&mut game, p0);
        let b = make_land(&mut game, p0);
        let c = make_land(&mut game, p0);

        // Library order (bottom to top): a, b, c  → c is on top
        game.replace_zone_cards(ZoneType::Library, p0, vec![a, b, c]);

        // Scry 2: sees [b, c] (top 2). BottomAllAgent puts both on bottom.
        let sa = SpellAbility::new_simple(None, p0, "SP$ Scry | ScryNum$ 2");
        let mut trigger_handler = TriggerHandler::new();
        let mut agents: Vec<Box<dyn PlayerAgent>> =
            vec![Box::new(BottomAllAgent), Box::new(PassAgent)];
        let mut mana_pools = vec![ManaPool::default(), ManaPool::default()];
        let token_templates = HashMap::new();
        let templates_variants: HashMap<(String, String), usize> = HashMap::new();
        let token_fallback: HashMap<String, String> = HashMap::new();
        let edition_dates: HashMap<String, String> = HashMap::new();
        let mut rng_adapter = crate::game_rng::ThreadRngAdapter;
        let mut ctx = EffectContext {
            game: &mut game,
            combat: None,
            agents: &mut agents,
            trigger_handler: &mut trigger_handler,
            token_templates: &token_templates,
            token_art_variants: &templates_variants,
            token_fallback: &token_fallback,
            edition_dates: &edition_dates,
            mana_pools: &mut mana_pools,
            parent_target_card: None,
            rng: &mut rng_adapter,
        };

        super::ScryEffect::resolve(&mut ctx, &sa);

        // Library still has all 3 cards, a is now on top (b,c went to bottom).
        let lib = ctx.game.cards_in_zone(ZoneType::Library, p0);
        assert_eq!(lib.len(), 3);
        // a was at index 0 (bottom originally); it should now be on top
        assert_eq!(*lib.last().unwrap(), a);
    }

    #[test]
    fn scry_keep_all_on_top_with_pass_agent() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);

        let a = make_land(&mut game, p0);
        let b = make_land(&mut game, p0);
        game.replace_zone_cards(ZoneType::Library, p0, vec![a, b]);

        let sa = SpellAbility::new_simple(None, p0, "SP$ Scry | ScryNum$ 2");
        let mut trigger_handler = TriggerHandler::new();
        let mut agents: Vec<Box<dyn PlayerAgent>> = vec![Box::new(PassAgent), Box::new(PassAgent)];
        let mut mana_pools = vec![ManaPool::default(), ManaPool::default()];
        let token_templates = HashMap::new();
        let templates_variants: HashMap<(String, String), usize> = HashMap::new();
        let token_fallback: HashMap<String, String> = HashMap::new();
        let edition_dates: HashMap<String, String> = HashMap::new();
        let mut rng_adapter = crate::game_rng::ThreadRngAdapter;
        let mut ctx = EffectContext {
            game: &mut game,
            combat: None,
            agents: &mut agents,
            trigger_handler: &mut trigger_handler,
            token_templates: &token_templates,
            token_art_variants: &templates_variants,
            token_fallback: &token_fallback,
            edition_dates: &edition_dates,
            mana_pools: &mut mana_pools,
            parent_target_card: None,
            rng: &mut rng_adapter,
        };

        super::ScryEffect::resolve(&mut ctx, &sa);

        // PassAgent returns empty bottom list, so all cards stay on top.
        // Order preserved: [a, b] with b still on top.
        let lib = ctx.game.cards_in_zone(ZoneType::Library, p0);
        assert_eq!(lib.len(), 2);
        assert_eq!(*lib.last().unwrap(), b);
    }
}
