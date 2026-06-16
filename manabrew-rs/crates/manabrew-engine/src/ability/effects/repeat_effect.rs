//! Repeat effect — execute a sub-ability loop.
//!
//! Mirrors the Java `RepeatEffect` behavior for the common repeat cases:
//! run the configured sub-ability at least once, then continue while the
//! repeat conditions still hold.

use super::EffectContext;
use crate::ability::ability_ir::DefinedRef;
use crate::parsing::compare::compare_expr;
use crate::spellability::{build_spell_ability, SpellAbility};

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `RepeatEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(RepeatEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let Some(source_id) = sa.source else {
        return;
    };
    let Some(sub_svar_name) = sa.ir.repeat_sub_ability.clone() else {
        return;
    };
    let Some(sub_text) = ctx
        .game
        .card(source_id)
        .get_s_var(&sub_svar_name)
        .map(str::to_string)
    else {
        return;
    };

    let max_repeat = sa
        .ir
        .max_repeat
        .as_ref()
        .map(|_| super::resolve_numeric_svar(ctx.game, sa, "MaxRepeat", 0).max(0));
    if max_repeat == Some(0) {
        return;
    }

    let mut count = 0i32;
    loop {
        let mut sub_sa = build_spell_ability(ctx.game, source_id, &sub_text, sa.activating_player);
        // Propagate parent targets so `Defined$ Targeted` in the sub-ability
        // resolves to the parent's chosen target (e.g. Tyrant of Discord's
        // Repeat calls a DBSac sub whose `Defined$ Targeted` must point to the
        // opponent the parent spell targeted).
        if sub_sa.target_chosen.target_card.is_none() {
            sub_sa.target_chosen.target_card = sa.target_chosen.target_card;
        }
        if sub_sa.target_chosen.target_player.is_none() {
            sub_sa.target_chosen.target_player = sa.target_chosen.target_player;
        }
        resolve_sub_chain(ctx, sub_sa);
        count += 1;

        if ctx.game.game_over {
            break;
        }
        if max_repeat.is_some_and(|max| count >= max) {
            break;
        }
        let should_continue = check_repeat_conditions(ctx, sa);
        if !should_continue {
            break;
        }
    }

    if let Some(sub_sa) = sa.sub_ability.as_deref() {
        resolve_sub_chain(ctx, sub_sa.clone());
    }
}

fn check_repeat_conditions(ctx: &mut EffectContext, sa: &SpellAbility) -> bool {
    if sa.ir.repeat_check_svar {
        let svar_value = super::resolve_numeric_svar(ctx.game, sa, "RepeatCheckSVar", 0);
        let compare = sa.ir.repeat_svar_compare.as_deref().unwrap_or("GE1");
        if !compare_expr(svar_value, compare) {
            return false;
        }
    }

    if let (Some(defined), Some(present), Some(compare)) = (
        sa.ir.repeat_defined.as_deref(),
        sa.ir.repeat_present.as_deref(),
        sa.ir.repeat_compare.as_deref(),
    ) {
        let Some(source_id) = sa.source else {
            return false;
        };
        let source = ctx.game.card(source_id);
        let defined_ref = DefinedRef::parse(defined);
        let cards: Vec<_> = if matches!(defined_ref, DefinedRef::Imprinted) {
            source.imprinted_cards.clone()
        } else if matches!(defined_ref, DefinedRef::Remembered) {
            source.remembered_cards.clone()
        } else {
            Vec::new()
        };

        let present_count = if present.eq_ignore_ascii_case("Card.sharesNameWith Remembered") {
            let remembered_names: std::collections::HashSet<String> = source
                .remembered_cards
                .iter()
                .map(|&cid| ctx.game.card(cid).card_name.clone())
                .collect();
            cards
                .into_iter()
                .filter(|&cid| remembered_names.contains(&ctx.game.card(cid).card_name))
                .count() as i32
        } else {
            let selector = crate::parsing::cached_compiled_selector(present);
            cards
                .into_iter()
                .filter(|&cid| {
                    super::matches_valid_cards_for_sa(
                        ctx.game,
                        sa,
                        ctx.game.card(cid),
                        Some(&selector),
                        present,
                    )
                })
                .count() as i32
        };

        if !compare_expr(present_count, compare) {
            return false;
        }
    }

    if sa.ir.repeat_optional {
        let decider = sa
            .ir
            .repeat_optional_decider
            .as_deref()
            .and_then(|defined| {
                crate::ability::ability_utils::resolve_defined_players_with_sa(
                    defined,
                    sa,
                    sa.activating_player,
                    ctx.game,
                )
                .into_iter()
                .next()
            })
            .unwrap_or(sa.activating_player);
        return ctx.agents[decider.index()].confirm_action(
            decider,
            Some("Repeat"),
            "Do you want to repeat this process again?",
            &[],
            sa.source,
            sa.api,
        );
    }

    true
}

fn resolve_sub_chain(ctx: &mut EffectContext, initial: SpellAbility) {
    let parent_target_card = initial.target_chosen.target_card;
    let parent_target_player = initial.target_chosen.target_player;
    let mut cur_opt: Option<SpellAbility> = Some(initial);
    while let Some(mut cur_sa) = cur_opt {
        if cur_sa.target_chosen.target_card.is_none() {
            cur_sa.target_chosen.target_card = parent_target_card;
        }
        if cur_sa.target_chosen.target_player.is_none() {
            cur_sa.target_chosen.target_player = parent_target_player;
        }
        super::resolve_effect(ctx, &cur_sa);
        cur_opt = if super::sub_ability_handled_internally(&cur_sa) {
            None
        } else {
            cur_sa.sub_ability.map(|b| *b)
        };
        if ctx.game.game_over {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ability::spell_ability_effect::SpellAbilityEffect;
    use crate::agent::{PlayOption, PlayerAgent, TargetChoice};
    use crate::card::Card;
    use crate::combat::DefenderId;
    use crate::game::GameState;
    use crate::ids::{CardId, PlayerId};
    use crate::mana::ManaPool;
    use crate::player::actions::PlayerAction;
    use crate::trigger::handler::TriggerHandler;
    use forge_foundation::{CardTypeLine, ColorSet, ManaCost};

    struct RepeatAgent {
        confirmations: Vec<bool>,
    }

    impl PlayerAgent for RepeatAgent {
        fn mulligan_decision(&mut self, _: PlayerId, _: &[CardId], _: u32) -> bool {
            true
        }
        fn choose_action(
            &mut self,
            player: PlayerId,
            action_space: Option<&crate::agent::PriorityActionSpace>,
            request_action_space: &mut dyn FnMut() -> crate::agent::PriorityActionSpace,
        ) -> PlayerAction {
            PlayerAction::PassPriority
        }
        fn choose_land_or_spell(&mut self, _: PlayerId) -> Option<bool> {
            None
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
            valid: &[PlayerId],
            _: Option<&SpellAbility>,
        ) -> Option<PlayerId> {
            valid.first().copied()
        }
        fn choose_target_card(
            &mut self,
            _: PlayerId,
            valid: &[CardId],
            _: Option<&SpellAbility>,
        ) -> Option<CardId> {
            valid.first().copied()
        }
        fn choose_target_any(
            &mut self,
            _: PlayerId,
            valid_players: &[PlayerId],
            valid_cards: &[CardId],
            _: Option<&SpellAbility>,
        ) -> TargetChoice {
            if let Some(&pid) = valid_players.first() {
                TargetChoice::Player(pid)
            } else if let Some(&cid) = valid_cards.first() {
                TargetChoice::Card(cid)
            } else {
                TargetChoice::None
            }
        }
        fn choose_targets_for(
            &mut self,
            _: &mut SpellAbility,
            _: &GameState,
            _: &[ManaPool],
        ) -> bool {
            true
        }
        fn confirm_action(
            &mut self,
            _: PlayerId,
            _: Option<&str>,
            _: &str,
            _: &[String],
            _: Option<crate::ids::CardId>,
            _: Option<crate::ability::api_type::ApiType>,
        ) -> bool {
            if self.confirmations.is_empty() {
                false
            } else {
                self.confirmations.remove(0)
            }
        }
    }

    #[test]
    fn repeat_optional_executes_until_declined() {
        let mut game = GameState::new(&["P1", "P2"], 20);
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);
        let source = game.create_card(Card::new(
            CardId(0),
            "Repeat Source".into(),
            p0,
            CardTypeLine::parse("Instant"),
            ManaCost::parse("1 B"),
            ColorSet::BLACK,
            None,
            None,
            vec![],
            vec![],
        ));
        game.card_mut(source).svars.insert(
            "Loop".to_string(),
            "DB$ LoseLife | Defined$ Opponent | LifeAmount$ 1".to_string(),
        );

        let sa = build_spell_ability(
            &game,
            source,
            "SP$ Repeat | RepeatSubAbility$ Loop | RepeatOptional$ True",
            p0,
        );

        let mut agents: Vec<Box<dyn PlayerAgent>> = vec![
            Box::new(RepeatAgent {
                confirmations: vec![true, false],
            }),
            Box::new(RepeatAgent {
                confirmations: vec![],
            }),
        ];
        let mut pools = vec![ManaPool::new(), ManaPool::new()];
        let mut trigger_handler = TriggerHandler::default();
        let mut rng = crate::game_rng::ThreadRngAdapter;
        let start_life = game.player(p1).life;

        RepeatEffect::resolve(
            &mut EffectContext {
                game: &mut game,
                combat: None,
                agents: &mut agents,
                trigger_handler: &mut trigger_handler,
                token_templates: &Default::default(),
                token_art_variants: &Default::default(),
                token_fallback: &Default::default(),
                edition_dates: &Default::default(),
                mana_pools: &mut pools,
                parent_target_card: None,
                rng: &mut rng,
            },
            &sa,
        );

        assert_eq!(game.player(p1).life, start_life - 2);
    }

    #[test]
    fn repeat_executes_parent_subability_after_loop() {
        let mut game = GameState::new(&["P1", "P2"], 20);
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);
        let source = game.create_card(Card::new(
            CardId(0),
            "Repeat Source".into(),
            p0,
            CardTypeLine::parse("Instant"),
            ManaCost::parse("1 B"),
            ColorSet::BLACK,
            None,
            None,
            vec![],
            vec![],
        ));
        game.card_mut(source).svars.insert(
            "Loop".to_string(),
            "DB$ LoseLife | Defined$ Opponent | LifeAmount$ 1".to_string(),
        );
        game.card_mut(source).svars.insert(
            "After".to_string(),
            "DB$ LoseLife | Defined$ Opponent | LifeAmount$ 3".to_string(),
        );

        let sa = build_spell_ability(
            &game,
            source,
            "SP$ Repeat | RepeatSubAbility$ Loop | MaxRepeat$ 1 | SubAbility$ After",
            p0,
        );

        let mut agents: Vec<Box<dyn PlayerAgent>> = vec![
            Box::new(RepeatAgent {
                confirmations: vec![],
            }),
            Box::new(RepeatAgent {
                confirmations: vec![],
            }),
        ];
        let mut pools = vec![ManaPool::new(), ManaPool::new()];
        let mut trigger_handler = TriggerHandler::default();
        let mut rng = crate::game_rng::ThreadRngAdapter;
        let start_life = game.player(p1).life;

        RepeatEffect::resolve(
            &mut EffectContext {
                game: &mut game,
                combat: None,
                agents: &mut agents,
                trigger_handler: &mut trigger_handler,
                token_templates: &Default::default(),
                token_art_variants: &Default::default(),
                token_fallback: &Default::default(),
                edition_dates: &Default::default(),
                mana_pools: &mut pools,
                parent_target_card: None,
                rng: &mut rng,
            },
            &sa,
        );

        assert_eq!(game.player(p1).life, start_life - 4);
    }
}
