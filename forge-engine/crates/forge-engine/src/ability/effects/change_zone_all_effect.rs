use forge_foundation::ZoneType;

use super::{emit_zone_trigger, matches_change_type, EffectContext};
use crate::ids::{CardId, PlayerId};

fn matches_change_zone_all_filter(
    cid: CardId,
    game: &crate::game::GameState,
    filter: &str,
    source_chosen_colors: &[String],
    effective_target: Option<CardId>,
) -> bool {
    if filter.trim().is_empty() {
        return true;
    }

    // Forge uses comma-separated OR clauses in ChangeType$.
    for clause in filter.split(',') {
        let clause = clause.trim();
        if clause.is_empty() {
            continue;
        }

        let mut clause_ok = true;
        let targeted = effective_target;

        // "+" means AND within a clause.
        for term in clause.split('+') {
            let term = term.trim();
            if term.is_empty() {
                continue;
            }

            if term.eq_ignore_ascii_case("NotDefinedTargeted") {
                if let Some(t) = targeted {
                    if cid == t {
                        clause_ok = false;
                        break;
                    }
                } else {
                    clause_ok = false;
                    break;
                }
                continue;
            }

            if term.eq_ignore_ascii_case("TargetedCard.Self") {
                if targeted != Some(cid) {
                    clause_ok = false;
                    break;
                }
                continue;
            }

            if term.starts_with("sharesNameWith") {
                let arg = term
                    .strip_prefix("sharesNameWith")
                    .unwrap_or("")
                    .trim_start();
                if arg.eq_ignore_ascii_case("Targeted") {
                    if let Some(t) = targeted {
                        if game.card(cid).card_name != game.card(t).card_name {
                            clause_ok = false;
                            break;
                        }
                    } else {
                        clause_ok = false;
                        break;
                    }
                    continue;
                }
            }

            if term.starts_with("ControlledBy") {
                let arg = term.strip_prefix("ControlledBy").unwrap_or("").trim_start();
                if arg.eq_ignore_ascii_case("TargetedController") {
                    if let Some(t) = targeted {
                        if game.card(cid).controller != game.card(t).controller {
                            clause_ok = false;
                            break;
                        }
                    } else {
                        clause_ok = false;
                        break;
                    }
                    continue;
                }
            }

            if !matches_change_type(game.card(cid), term, source_chosen_colors) {
                clause_ok = false;
                break;
            }
        }

        if clause_ok {
            return true;
        }
    }

    false
}

/// Configure the spell ability during construction.
/// Mirrors Java `ChangeZoneAllEffect.buildSpellAbility` — calls
/// `adjustChangeZoneTarget` to set the target zone to the origin zone.
pub fn build_spell_ability(sa: &mut crate::spellability::SpellAbility) {
    // If the SA has an Origin$ parameter and uses targeting, set the
    // target restriction zone to the origin zone so that targeting
    // looks in the correct zone (not just Battlefield).
    if let Some(zone) = sa.origin_zone() {
        if let Some(ref mut tr) = sa.target_restrictions {
            if !tr.can_tgt_player() {
                tr.tgt_zone = vec![zone];
            }
        }
    }
}

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ChangeZoneAllEffect` class extending `SpellAbilityEffect`.
#[forge_engine_macros::spell_effect(ChangeZoneAllEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let Some(origin_zone) = sa
        .origin_zone()
        .or_else(|| sa.origin().is_none().then_some(ZoneType::Battlefield))
    else {
        return;
    };
    let Some(dest_zone) = sa
        .destination_zone()
        .or_else(|| sa.destination().is_none().then_some(ZoneType::Graveyard))
    else {
        return;
    };
    // Forge uses ChangeType$ as the primary filter for ChangeZoneAll; fall back to ValidCards$.
    let valid_cards_filter = sa
        .change_type()
        .or(sa.ir.valid_cards_text.as_deref())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "Card".to_string());
    let tapped = sa.ir.tapped;

    // Resolve source card's chosen_colors for ChosenColor qualifier support.
    let source_chosen_colors: Vec<String> = sa
        .source
        .map(|src| ctx.game.card(src).chosen_colors.clone())
        .unwrap_or_default();

    // Propagate the parent SA's chosen target for sub-ability chains like Deputy of Detention
    // (TrigExile Pump → DBChangeZoneAll): the ChangeZoneAll SA itself has no ValidTgts$,
    // so we fall back to ctx.parent_target_card set by the parent Pump SA.
    let effective_target = sa.target_chosen.target_card.or(ctx.parent_target_card);

    // For Duration$ UntilHostLeavesPlay, track the source card so we can return
    // exiled permanents when the source leaves the battlefield (e.g. Deputy of Detention).
    let until_host_leaves = sa.ir.duration.as_ref().is_some_and(|duration| {
        matches!(
            duration,
            crate::spellability::AbilityDuration::UntilHostLeavesPlay
                | crate::spellability::AbilityDuration::UntilHostLeavesPlayOrEot
        )
    });
    let exile_source = if until_host_leaves { sa.source } else { None };

    {
        // Restrict to the targeted/defined player when set; otherwise every player.
        let player_ids: Vec<PlayerId> = if let Some(pid) = sa.target_chosen.target_player {
            vec![pid]
        } else if let Some(defined) = sa.ir.defined_text.as_deref() {
            let resolved = crate::ability::ability_utils::resolve_defined_players_with_sa(
                defined,
                sa,
                sa.activating_player,
                ctx.game,
            );
            if resolved.is_empty() {
                ctx.game.player_order.clone()
            } else {
                resolved
            }
        } else {
            ctx.game.player_order.clone()
        };
        let mut to_move: Vec<(CardId, PlayerId)> = Vec::new();

        for &pid in &player_ids {
            let zone_cards = ctx.game.cards_in_zone(origin_zone, pid).to_vec();
            for cid in zone_cards {
                if matches_change_zone_all_filter(
                    cid,
                    ctx.game,
                    &valid_cards_filter,
                    &source_chosen_colors,
                    effective_target,
                ) {
                    let dest_owner = if dest_zone == ZoneType::Battlefield {
                        sa.activating_player
                    } else {
                        ctx.game.card(cid).owner
                    };
                    to_move.push((cid, dest_owner));
                }
            }
        }

        if dest_zone == ZoneType::Library && to_move.len() > 1 && sa.ir.random_order {
            let mut cards = to_move.iter().map(|(cid, _)| *cid).collect::<Vec<_>>();
            ctx.rng.shuffle_cards(&mut cards);
            let mut ordered = Vec::with_capacity(to_move.len());
            for cid in cards {
                if let Some((_, owner)) = to_move.iter().find(|(card_id, _)| *card_id == cid) {
                    ordered.push((cid, *owner));
                }
            }
            to_move = ordered;
        }

        let mut moved_to_library: Vec<(CardId, PlayerId)> = Vec::new();
        for (card_id, dest_owner) in to_move {
            if ctx.game.card(card_id).zone != origin_zone {
                continue; // already moved
            }
            let old_zone = ctx.game.card(card_id).zone;
            ctx.move_card(card_id, dest_zone, dest_owner);
            if dest_zone == ZoneType::Library {
                moved_to_library.push((card_id, dest_owner));
            }
            // Mark cards exiled by a UntilHostLeavesPlay effect so they can return
            // when the source leaves the battlefield.
            if dest_zone == ZoneType::Exile {
                if let Some(src_id) = exile_source {
                    ctx.game.card_mut(card_id).set_exiled_by(Some(src_id));
                }
            }
            if dest_zone == ZoneType::Battlefield {
                if tapped {
                    ctx.game.tap(card_id);
                }
                ctx.trigger_handler
                    .register_active_trigger(ctx.game, card_id);
            }
            emit_zone_trigger(ctx.trigger_handler, card_id, old_zone, dest_zone);
        }

        if dest_zone == ZoneType::Library && sa.library_position() == Some("-1") {
            for &pid in &player_ids {
                let cards = moved_to_library
                    .iter()
                    .filter_map(|(cid, owner)| (*owner == pid).then_some(*cid))
                    .collect::<Vec<_>>();
                if !cards.is_empty() {
                    ctx.game
                        .move_cards_to_zone_bottom(ZoneType::Library, pid, &cards);
                }
            }
        }

        // Handle Shuffle$ (e.g. Nihil Spellbomb shuffles the target player's library).
        if sa.ir.shuffle_raw.is_some() {
            for &pid in &player_ids {
                ctx.game.shuffle_zone_cards(ZoneType::Library, pid, ctx.rng);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::matches_change_zone_all_filter;
    use crate::card::Card;
    use crate::game::GameState;
    use crate::ids::{CardId, PlayerId};
    use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};

    #[test]
    fn deputy_filter_only_hits_targeted_name_group() {
        let mut game = GameState::new(&["A", "B"], 20);
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);

        let make = |name: &str, owner: PlayerId, type_line: &str| {
            Card::new(
                CardId(0),
                name.to_string(),
                owner,
                CardTypeLine::parse(type_line),
                ManaCost::no_cost(),
                ColorSet::COLORLESS,
                None,
                None,
                vec![],
                vec![],
            )
        };

        let t1 = game.create_card(make("Token Engine", p1, "Artifact"));
        let t2 = game.create_card(make("Token Engine", p1, "Artifact"));
        let opp_land = game.create_card(make("Island", p1, "Land Island"));
        let my_land = game.create_card(make("Forest", p0, "Land Forest"));

        game.move_card(t1, ZoneType::Battlefield, p1);
        game.move_card(t2, ZoneType::Battlefield, p1);
        game.move_card(opp_land, ZoneType::Battlefield, p1);
        game.move_card(my_land, ZoneType::Battlefield, p0);

        let filter = "TargetedCard.Self,Permanent.nonLand+NotDefinedTargeted+sharesNameWith Targeted+ControlledBy TargetedController";

        assert!(matches_change_zone_all_filter(
            t1,
            &game,
            filter,
            &[],
            Some(t1)
        ));
        assert!(matches_change_zone_all_filter(
            t2,
            &game,
            filter,
            &[],
            Some(t1)
        ));
        assert!(!matches_change_zone_all_filter(
            opp_land,
            &game,
            filter,
            &[],
            Some(t1)
        ));
        assert!(!matches_change_zone_all_filter(
            my_land,
            &game,
            filter,
            &[],
            Some(t1)
        ));
    }
}
