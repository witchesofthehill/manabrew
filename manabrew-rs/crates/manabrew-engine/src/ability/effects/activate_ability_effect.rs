use super::{resolve_defined_players, EffectContext};

/// Mirrors Java's `ActivateAbilityEffect` for the common `ManaAbility$ True`
/// case used by cards like Pygmy Hippo.
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ActivateAbilityEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ActivateAbilityEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;
    let defined = sa.defined().unwrap_or("You");
    let only_mana = sa.ir.mana_ability;
    let type_filter = sa.ir.type_filter.as_deref().unwrap_or("Card");

    let players = resolve_defined_players(defined, controller, ctx.game);
    for pid in players {
        if !ctx.game.player(pid).is_alive() {
            continue;
        }
        let battlefield = ctx
            .game
            .cards_in_zone(forge_foundation::ZoneType::Battlefield, pid);
        let card_ids: Vec<crate::ids::CardId> = battlefield.to_vec();
        for cid in card_ids {
            let (is_land, is_tapped, chosen_colors, produced_ir, has_tap_cost) = {
                let card = ctx.game.card(cid);
                if type_filter.eq_ignore_ascii_case("Land") && !card.is_land() {
                    continue;
                }
                if !type_filter.eq_ignore_ascii_case("Land")
                    && !type_filter.eq_ignore_ascii_case("Card")
                {
                    continue;
                }
                if card.tapped {
                    continue;
                }

                // Java lets controller choose one ability per card. For parity with
                // current engine scope, resolve the first legal mana ability.
                let maybe_mana_ab = card.activated_abilities.iter().find(|ab| {
                    (!only_mana || ab.is_mana_ability) && ab.ability_kind.as_str() == "Mana"
                });
                let Some(mana_ab) = maybe_mana_ab else {
                    continue;
                };

                (
                    card.is_land(),
                    card.tapped,
                    card.chosen_colors.clone(),
                    mana_ab.produced_ir.clone(),
                    mana_ab.cost.has_tap,
                )
            };

            if type_filter.eq_ignore_ascii_case("Land") && !is_land {
                continue;
            }
            if is_tapped {
                continue;
            }
            if has_tap_cost {
                ctx.game.tap(cid);
            }

            if let Some(produced_ir) = produced_ir.as_ref() {
                let atoms = produced_ir.to_atoms(&chosen_colors);
                if let Some(atom) = atoms.first().copied() {
                    ctx.mana_pools[pid.index()].add(atom, 1);
                }
            }
        }
    }
}
