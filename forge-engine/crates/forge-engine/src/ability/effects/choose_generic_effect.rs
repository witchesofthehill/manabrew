//! ChooseGeneric effect — generic modal choice.

use super::EffectContext;
use crate::ability::spell_ability_effect::get_defined_players_or_targeted;
use crate::spellability::{build_spell_ability, SpellAbility};

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ChooseGenericEffect` class extending `SpellAbilityEffect`.
#[forge_engine_macros::spell_effect(ChooseGenericEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let source_id = match sa.source {
        Some(id) => id,
        None => return,
    };

    let player = sa.activating_player;

    // Collect SVar names for each choice — mirrors Java's
    // sa.getAdditionalAbilityList("Choices")
    let choices_str = sa.ir.choices.clone().unwrap_or_default();
    if choices_str.is_empty() {
        return;
    }
    let choice_svars: Vec<&str> = choices_str.split(',').map(|s| s.trim()).collect();

    // Resolve SVar names to ability text from the source card
    let svars = ctx.game.card(source_id).svars.clone();
    let choice_texts: Vec<String> = choice_svars
        .iter()
        .filter_map(|svar| svars.get(*svar).cloned())
        .collect();

    if choice_texts.is_empty() {
        return;
    }

    let amount = sa
        .ir
        .amount
        .as_deref()
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(1);
    let temp_remember = sa.ir.temp_remember;
    let choosers = get_defined_players_or_targeted(ctx.game, sa);
    for chooser in choosers {
        let mut abilities: Vec<SpellAbility> = choice_texts
            .iter()
            .map(|text| {
                let mut choice_sa = build_spell_ability(ctx.game, source_id, text, player);
                choice_sa.source = Some(source_id);
                choice_sa.trigger_remembered_amount = sa.trigger_remembered_amount;
                choice_sa
            })
            .collect();

        if let Some(n_str) = sa.ir.num_random_choices.as_deref() {
            let n = crate::ability::ability_utils::calculate_amount(n_str) as usize;
            while abilities.len() > n {
                let idx = ctx.rng.next_int(abilities.len() as i32) as usize;
                abilities.remove(idx);
            }
        }

        abilities.retain(|choice_sa| {
            if let Some(unless_cost_str) = choice_sa.ir.unless_cost.as_deref() {
                let cost = crate::cost::parse_cost(unless_cost_str);
                crate::cost::can_pay_with_ability(
                    &cost,
                    ctx.game,
                    &ctx.mana_pools[chooser.index()],
                    source_id,
                    chooser,
                    Some(choice_sa),
                )
            } else {
                true
            }
        });

        let mut chosen_sas: Vec<SpellAbility>;

        if sa.ir.at_random {
            chosen_sas = Vec::new();
            for _ in 0..amount.min(abilities.len()) {
                if abilities.is_empty() {
                    break;
                }
                let idx = ctx.rng.next_int(abilities.len() as i32) as usize;
                chosen_sas.push(abilities.remove(idx));
            }

            if sa.ir.at_random_text.as_deref() == Some("Urza") {
                let mut i = 0;
                while i < chosen_sas.len() {
                    if !chosen_sas[i].uses_targeting() {
                        i += 1;
                    } else if chosen_sas[i]
                        .target_restrictions
                        .as_ref()
                        .map(|tr| tr.has_candidates(ctx.game, chooser, Some(source_id)))
                        .unwrap_or(false)
                    {
                        ctx.agents[chooser.index()].choose_targets_for(
                            &mut chosen_sas[i],
                            ctx.game,
                            ctx.mana_pools,
                        );
                        i += 1;
                    } else if !abilities.is_empty() {
                        let idx = ctx.rng.next_int(abilities.len() as i32) as usize;
                        chosen_sas[i] = abilities.remove(idx);
                    } else {
                        i += 1;
                    }
                }
            }
        } else if !abilities.is_empty() {
            ctx.agents[chooser.index()].snapshot_state(ctx.game, ctx.mana_pools);
            let chosen_indices = ctx.agents[chooser.index()]
                .choose_spell_abilities_for_effect(chooser, &abilities, amount);

            chosen_sas = chosen_indices
                .into_iter()
                .filter_map(|i| abilities.get(i).cloned())
                .collect();
        } else {
            chosen_sas = Vec::new();
        }

        // Mirrors Java's ChooseGenericEffect: TempRemember$ Chooser swaps
        // host.remembered_players with [chooser] for the duration of the
        // chosen sub-ability's resolution, then restores. Sub-SVars like
        // "Defined$ Remembered" / "UnlessPayer$ Remembered" then correctly
        // resolve to the opponent who made the choice.
        let prior_remembered_players = if temp_remember {
            let prior = ctx.game.card(source_id).remembered_players.clone();
            let card = ctx.game.card_mut(source_id);
            card.remembered_players.clear();
            card.add_remembered_player(chooser);
            Some(prior)
        } else {
            None
        };

        if !chosen_sas.is_empty() {
            for chosen_sa in chosen_sas {
                super::resolve_effect_chain_with_parent(
                    ctx,
                    chosen_sa,
                    sa.target_chosen.target_card,
                    sa.target_chosen.target_player,
                );
                if ctx.game.game_over {
                    break;
                }
            }
        } else if let Some(fallback_name) = sa.ir.fallback_ability.as_deref() {
            if let Some(fallback_text) = svars.get(fallback_name) {
                let mut fallback_sa =
                    build_spell_ability(ctx.game, source_id, fallback_text, player);
                fallback_sa.source = Some(source_id);
                super::resolve_effect(ctx, &fallback_sa);
            }
        }

        if let Some(prior) = prior_remembered_players {
            let card = ctx.game.card_mut(source_id);
            card.remembered_players = prior;
        }

        if ctx.game.game_over {
            break;
        }
    }
}
