use forge_foundation::ZoneType;

use super::{matches_valid_cards_for_sa, EffectContext};

/// `SP$ ChooseCard` — player chooses card(s) from a filtered set in a zone.
///
/// Mirrors Java's `ChooseCardEffect.java`.
///
/// # Params
/// - `Amount` — how many cards to choose (default 1)
/// - `ChoiceZone` — zone to choose from (default Battlefield)
/// - `Choices` — ValidCards filter for eligible cards
/// - `RememberChosen` — if "True", add chosen to source's remembered_cards
///
/// Stores the chosen card(s) on the source card's `chosen_cards`.
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ChooseCardEffect` class extending `SpellAbilityEffect`.
#[forge_engine_macros::spell_effect(ChooseCardEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let source_id = match sa.source {
        Some(id) => id,
        None => return,
    };

    let amount: usize = sa
        .ir
        .amount
        .as_deref()
        .and_then(|s| s.parse().ok())
        .unwrap_or(1);

    let zone = sa.ir.choice_zone.unwrap_or(ZoneType::Battlefield);

    let filter = sa.ir.choices.clone().unwrap_or_else(|| "Card".to_string());
    let filter_selector = sa.ir.choices_selector.clone();

    let remember = sa.ir.remember_chosen;

    // Java parity (`ChooseCardEffect.java` line 63 + 101): the choosers come
    // from `Defined$`/`DefinedPlayer$` (default = activator). Each chooser
    // runs the prompt independently — needed by Ajani Nacatl Avenger's [-4]
    // ultimate where every opponent picks from their own permanents.
    let chooser_ref = sa.defined_player().or_else(|| sa.defined());
    let choosers: Vec<crate::ids::PlayerId> = if let Some(def) = chooser_ref {
        let players =
            crate::ability::effects::resolve_defined_players(def, sa.activating_player, ctx.game);
        if players.is_empty() {
            vec![sa.activating_player]
        } else {
            players
        }
    } else {
        vec![sa.activating_player]
    };

    // Collect valid cards in zone matching filter (shared base list).
    let mut base_valid: Vec<crate::ids::CardId> = Vec::new();
    for &pid in &ctx.game.player_order.clone() {
        let zone_cards = ctx.game.cards_in_zone(zone, pid).to_vec();
        for cid in zone_cards {
            if matches_valid_cards_for_sa(
                ctx.game,
                sa,
                ctx.game.card(cid),
                filter_selector.as_ref(),
                &filter,
            ) {
                base_valid.push(cid);
            }
        }
    }

    let mut all_chosen: Vec<crate::ids::CardId> = Vec::new();
    let controlled_by = sa.ir.controlled_by_player_text.as_deref().map(str::trim);
    let choose_each: Option<Vec<String>> = sa.ir.choose_each_text.as_deref().map(|s| {
        s.split('&')
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect()
    });

    for chooser in choosers {
        // `ControlledByPlayer$ Chooser` (and friends) filters the candidate
        // pool by the chooser's controlled permanents. Mirrors Java's
        // `CardLists.filterControlledBy` at line 110-116.
        let mut pool: Vec<crate::ids::CardId> = match controlled_by {
            Some("Chooser") => base_valid
                .iter()
                .copied()
                .filter(|&cid| ctx.game.card(cid).controller == chooser)
                .collect(),
            _ => base_valid.clone(),
        };

        if pool.is_empty() {
            continue;
        }

        ctx.agents[chooser.index()].snapshot_state(ctx.game, ctx.mana_pools);

        if let Some(types) = choose_each.as_ref() {
            // For each type, the chooser picks one matching card. Mirrors
            // Java `ChooseCardEffect.java:131-145`.
            for type_name in types {
                let typed: Vec<crate::ids::CardId> = pool
                    .iter()
                    .copied()
                    .filter(|&cid| {
                        let card = ctx.game.card(cid);
                        card.type_line
                            .core_types
                            .iter()
                            .any(|ct| ct.name().eq_ignore_ascii_case(type_name))
                            || card
                                .type_line
                                .subtypes
                                .iter()
                                .any(|s| s.eq_ignore_ascii_case(type_name))
                    })
                    .collect();
                if typed.is_empty() {
                    continue;
                }
                let picks =
                    ctx.agents[chooser.index()].choose_cards_for_effect(chooser, &typed, 1, 1);
                for cid in picks {
                    if !all_chosen.contains(&cid) {
                        all_chosen.push(cid);
                    }
                    pool.retain(|&p| p != cid);
                }
            }
        } else {
            let picks =
                ctx.agents[chooser.index()].choose_cards_for_effect(chooser, &pool, 1, amount);
            for cid in picks {
                if !all_chosen.contains(&cid) {
                    all_chosen.push(cid);
                }
            }
        }
    }

    if all_chosen.is_empty() {
        return;
    }

    // Store on source card
    ctx.game
        .card_mut(source_id)
        .set_chosen_cards(all_chosen.clone());

    // Optionally remember
    if remember {
        for &cid in &all_chosen {
            ctx.game.card_mut(source_id).add_remembered_card(cid);
        }
    }

    // ImprintChosen$ — `ChooseCardEffect.java:299-301`.
    if sa.ir.imprint_chosen {
        for &cid in &all_chosen {
            ctx.game.card_mut(source_id).add_imprinted_card(cid);
        }
    }
}
