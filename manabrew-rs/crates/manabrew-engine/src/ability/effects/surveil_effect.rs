use forge_foundation::ZoneType;

use super::{emit_zone_trigger, resolve_defined_player, resolve_numeric_svar, EffectContext};
use crate::event::RunParams;
use crate::trigger::TriggerType;

/// Mirrors Java's `SurveilEffect.java`.
///
/// `SP$ Surveil | Amount$ N`
/// Lets the activating player look at the top N cards of their library,
/// then put any number of them into their graveyard; the rest go on top in any order.
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `SurveilEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(SurveilEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let num = resolve_numeric_svar(ctx.game, sa, "Amount", 1).max(0) as usize;

    let target = sa
        .defined()
        .and_then(|d| resolve_defined_player(d, sa.activating_player, ctx.game))
        .unwrap_or(sa.activating_player);

    if sa.ir.optional {
        let source_name = sa.source.map(|cid| ctx.game.card(cid).card_name.as_str());
        let accepted = ctx.agents[target.index()].confirm_action(
            target,
            None,
            "Do you want to surveil?",
            &[],
            sa.source,
            Some(crate::ability::api_type::ApiType::Surveil),
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

    // Take top N cards off the library (last `count` elements = top of library).
    let mut top_n = ctx
        .game
        .take_top_cards_from_zone(ZoneType::Library, target, count);
    // Reverse to match Java's `getTopXCardsFromLibrary` top-to-bottom iteration order.
    top_n.reverse();

    // Ask the agent which cards to send to the graveyard.
    let gy_ids = ctx.agents[target.index()].choose_surveil(ctx.game, target, &top_n);

    let graveyard: Vec<_> = gy_ids.into_iter().filter(|id| top_n.contains(id)).collect();
    let keep_top: Vec<_> = top_n
        .iter()
        .copied()
        .filter(|id| !graveyard.contains(id))
        .collect();

    // Move chosen cards to graveyard.
    for &id in &graveyard {
        ctx.move_card(id, ZoneType::Graveyard, target);
        emit_zone_trigger(
            ctx.trigger_handler,
            id,
            ZoneType::Library,
            ZoneType::Graveyard,
        );
    }

    // `keep_top` is in top-to-bottom order, so iterate in reverse to restore
    // the correct library order when appending to our bottom-to-top vec.
    for &id in keep_top.iter().rev() {
        ctx.game.add_card_to_zone(ZoneType::Library, target, id);
    }

    // Fire Surveil trigger
    ctx.trigger_handler.run_trigger(
        TriggerType::Surveil,
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

    /// Agent that puts all surveiled cards into graveyard.
    struct GraveyardAllAgent;
    impl PlayerAgent for GraveyardAllAgent {
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
        fn choose_surveil(
            &mut self,
            _game: &GameState,
            _player: PlayerId,
            cards: &[CardId],
        ) -> Vec<CardId> {
            cards.to_vec() // send all to graveyard
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
    fn surveil_sends_chosen_to_graveyard() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);

        let a = make_land(&mut game, p0);
        let b = make_land(&mut game, p0);
        let c = make_land(&mut game, p0);
        game.replace_zone_cards(ZoneType::Library, p0, vec![a, b, c]);

        // Surveil 2: sees top 2 (b, c). GraveyardAllAgent puts both in GY.
        let sa = SpellAbility::new_simple(None, p0, "SP$ Surveil | Amount$ 2");
        let mut trigger_handler = TriggerHandler::new();
        let mut agents: Vec<Box<dyn PlayerAgent>> =
            vec![Box::new(GraveyardAllAgent), Box::new(PassAgent)];
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

        super::SurveilEffect::resolve(&mut ctx, &sa);

        assert_eq!(ctx.game.cards_in_zone(ZoneType::Library, p0).len(), 1);
        assert_eq!(ctx.game.cards_in_zone(ZoneType::Graveyard, p0).len(), 2);
    }

    #[test]
    fn surveil_keep_all_on_top_with_pass_agent() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);

        let a = make_land(&mut game, p0);
        let b = make_land(&mut game, p0);
        game.replace_zone_cards(ZoneType::Library, p0, vec![a, b]);

        let sa = SpellAbility::new_simple(None, p0, "SP$ Surveil | Amount$ 2");
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

        super::SurveilEffect::resolve(&mut ctx, &sa);

        // PassAgent returns empty graveyard list, all stay on library.
        let lib = ctx.game.cards_in_zone(ZoneType::Library, p0);
        assert_eq!(lib.len(), 2);
        assert_eq!(ctx.game.cards_in_zone(ZoneType::Graveyard, p0).len(), 0);
    }
}
