//! Combat-side helpers shared by effect resolvers.
//!
//! Mirrors Java's `SpellAbilityEffect.addToCombat` + defender-selection logic
//! used by `AttachEffect`, `AnimateEffect`, and `SetStateEffect`.

use forge_foundation::CoreType;

use crate::combat::DefenderId;
use crate::ids::{CardId, PlayerId};
use crate::spellability::SpellAbility;

use super::effect_context::EffectContext;

pub(super) fn choose_defender(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    controller: PlayerId,
    defenders: &[DefenderId],
) -> Option<DefenderId> {
    if defenders.is_empty() {
        return None;
    }
    if defenders.len() == 1 {
        return Some(defenders[0]);
    }

    let valid_players: Vec<PlayerId> = defenders.iter().filter_map(|d| d.as_player()).collect();
    let valid_cards: Vec<CardId> = defenders
        .iter()
        .filter_map(|d| match d {
            DefenderId::Permanent(cid) => Some(*cid),
            DefenderId::Player(_) => None,
        })
        .collect();
    ctx.agents[controller.index()].snapshot_state(ctx.game, ctx.mana_pools);
    Some(
        match ctx.agents[controller.index()].choose_target_any(
            controller,
            &valid_players,
            &valid_cards,
            Some(sa),
        ) {
            crate::agent::TargetChoice::Player(pid) => DefenderId::Player(pid),
            crate::agent::TargetChoice::Card(cid) => DefenderId::Permanent(cid),
            _ => defenders[0],
        },
    )
}

pub(super) fn resolve_attack_defenders(
    ctx: &EffectContext,
    sa: &SpellAbility,
    card_id: CardId,
    attacking_param: &str,
) -> Vec<DefenderId> {
    let controller = ctx.game.card(card_id).controller;
    let possible = crate::combat::get_possible_defenders(ctx.game, controller);
    if attacking_param.eq_ignore_ascii_case("True") {
        return possible;
    }

    if attacking_param.eq_ignore_ascii_case("TriggeredDefender") {
        let mut defenders = Vec::new();
        if let Some(pid) = sa.get_triggering_player(crate::ability::AbilityKey::Defender) {
            defenders.push(DefenderId::Player(pid));
        }
        if defenders.is_empty() {
            if let Some(cid) = sa.get_triggering_card(crate::ability::AbilityKey::Defender) {
                defenders.push(DefenderId::Permanent(cid));
            }
        }
        if defenders.is_empty() {
            if let Some(pid) = sa.get_triggering_player(crate::ability::AbilityKey::DefendingPlayer)
            {
                defenders.push(DefenderId::Player(pid));
            }
        }
        if defenders.is_empty() {
            if let Some(pid) = sa.get_triggering_player(crate::ability::AbilityKey::AttackedTarget)
            {
                defenders.push(DefenderId::Player(pid));
            }
        }
        if defenders.is_empty() {
            defenders.extend(
                sa.get_triggering_cards(crate::ability::AbilityKey::Attacked)
                    .into_iter()
                    .map(DefenderId::Permanent),
            );
        }
        defenders.retain(|defender| possible.contains(defender));
        return defenders;
    }

    let mut defenders: Vec<DefenderId> =
        crate::ability::ability_utils::resolve_defined_players_with_sa(
            attacking_param,
            sa,
            sa.activating_player,
            ctx.game,
        )
        .into_iter()
        .map(DefenderId::Player)
        .collect();

    if defenders.is_empty() {
        defenders.extend(
            sa.trigger_objects
                .get(&crate::ability::AbilityKey::Attacked)
                .into_iter()
                .flat_map(|value| value.split(','))
                .filter_map(|part| part.trim().parse::<u32>().ok())
                .map(CardId)
                .map(DefenderId::Permanent),
        );
    }

    defenders.retain(|defender| possible.contains(defender));
    defenders
}

pub(crate) fn add_to_combat(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    card_id: CardId,
    attacking_param: &str,
) -> bool {
    if !ctx.game.turn.is_combat() || !ctx.game.card(card_id).is_creature() {
        return false;
    }

    let controller = ctx.game.card(card_id).controller;

    let attacking = match attacking_param {
        crate::parsing::keys::ATTACKING => sa.ir.attacking_text.as_deref(),
        crate::parsing::keys::NINJUTSU => sa.ir.ninjutsu_text.as_deref(),
        crate::parsing::keys::TOKEN_ATTACKING => sa.ir.token_attacking_text.as_deref(),
        _ => None,
    };
    let Some(attacking) = attacking else {
        return false;
    };
    let defenders = resolve_attack_defenders(ctx, sa, card_id, attacking);
    let Some(defender) = choose_defender(ctx, sa, controller, &defenders) else {
        return false;
    };

    let Some(combat) = ctx.combat.as_deref_mut() else {
        return false;
    };
    let Some(attacking_player) = combat.attacking_player else {
        return false;
    };
    if attacking_player != controller {
        return false;
    }

    if combat
        .attackers
        .iter()
        .any(|&(attacker, current)| attacker == card_id && current == defender)
    {
        return false;
    }

    combat.remove_from_combat(card_id, ctx.game);
    combat.add_attacker(card_id, defender);

    let defending_player = defender.controlling_player(ctx.game);
    let tracked_defender = match defender {
        DefenderId::Player(pid) => crate::card::card_damage_history::TrackedEntity::Player(pid),
        DefenderId::Permanent(cid) => crate::card::card_damage_history::TrackedEntity::Card(cid),
    };
    let num_other_attackers = combat.attackers.len().saturating_sub(1) as i32;
    let defender_is_battle = matches!(
        defender,
        DefenderId::Permanent(cid) if ctx.game.card(cid).type_line.core_types.contains(&CoreType::Battle)
    );

    let card = ctx.game.card_mut(card_id);
    card.set_attacking_player(defending_player);
    card.mark_attacked_this_turn();
    card.damage_history.set_creature_attacked_this_combat(
        Some(tracked_defender),
        num_other_attackers,
        defender_is_battle,
    );
    true
}
