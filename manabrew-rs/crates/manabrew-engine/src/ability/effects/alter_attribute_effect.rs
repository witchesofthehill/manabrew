//! AlterAttribute — change a creature's attribute (Plotted, Suspected, etc.).
//! Ported from Java's AlterAttributeEffect: toggles various card attributes
//! like Plotted, Harnessed, Solved, Suspected, Saddled, Commander.

use forge_foundation::ZoneType;

use super::EffectContext;
use crate::ability::ability_ir::DefinedRef;
use crate::event::RunParams;
use crate::ids::CardId;
use crate::trigger::TriggerType;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `AlterAttributeEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(AlterAttributeEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let activate = sa.ir.alter_attribute_activate;
    let attributes = &sa.ir.alter_attribute_attributes;

    let targets: Vec<CardId> = if let Some(target) = sa.target_chosen.target_card {
        vec![target]
    } else if let Some(source) = sa.source {
        if let Some(def) = sa.defined_ref() {
            if matches!(def, DefinedRef::SelfCard) {
                vec![source]
            } else {
                ctx.game.card(source).remembered_cards.clone()
            }
        } else {
            vec![source]
        }
    } else {
        return;
    };

    for card_id in targets {
        if ctx.game.card(card_id).zone == ZoneType::None {
            continue;
        }

        for attr in attributes {
            match attr.as_str() {
                "Harnessed" => {
                    let val = if activate { "True" } else { "False" };
                    ctx.game.card_mut(card_id).set_s_var("Harnessed", val);
                }
                "Plotted" => {
                    let val = if activate { "True" } else { "False" };
                    ctx.game.card_mut(card_id).set_s_var("Plotted", val);
                }
                "Solve" | "Solved" => {
                    let val = if activate { "True" } else { "False" };
                    ctx.game.card_mut(card_id).set_s_var("Solved", val);
                    if activate {
                        ctx.trigger_handler.run_trigger(
                            TriggerType::CaseSolved,
                            RunParams {
                                card: Some(card_id),
                                player: Some(sa.activating_player),
                                ..Default::default()
                            },
                            false,
                        );
                    }
                }
                "Suspect" | "Suspected" => {
                    if activate {
                        // Suspected creatures have menace and can't block
                        if !ctx.game.card(card_id).keywords.contains_string("Menace") {
                            ctx.game.card_mut(card_id).add_intrinsic_keyword("Menace");
                        }
                        ctx.game.card_mut(card_id).set_s_var("Suspected", "True");
                    } else {
                        ctx.game
                            .card_mut(card_id)
                            .remove_intrinsic_keyword("Menace");
                        ctx.game.card_mut(card_id).remove_s_var("Suspected");
                    }
                }
                "Saddle" | "Saddled" => {
                    let first_time = !ctx.game.card(card_id).has_s_var("SaddledBy");
                    let val = if activate { "True" } else { "False" };
                    ctx.game.card_mut(card_id).set_s_var("Saddled", val);
                    if activate {
                        if let Some(source) = sa.source {
                            ctx.game.card_mut(card_id).add_saddled_by_this_turn(source);
                        }
                        ctx.trigger_handler.run_trigger(
                            TriggerType::BecomesSaddled,
                            RunParams {
                                card: Some(card_id),
                                player: Some(sa.activating_player),
                                first_time: Some(first_time),
                                ..Default::default()
                            },
                            false,
                        );
                    }
                }
                "Commander" => {
                    let val = if activate { "True" } else { "False" };
                    ctx.game.card_mut(card_id).set_s_var("IsCommander", val);
                }
                _ => {}
            }

            if sa.ir.remember_altered {
                if let Some(source) = sa.source {
                    ctx.game.card_mut(source).add_remembered_card(card_id);
                }
            }
        }
    }
}
