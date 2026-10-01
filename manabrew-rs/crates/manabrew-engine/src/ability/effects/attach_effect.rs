use forge_foundation::ZoneType;

use super::EffectContext;
use crate::ability::ability_ir::DefinedRef;
use crate::agent::types::GameEntity;
use crate::event::AbilityValue;
use crate::ids::CardId;
use crate::player::player_controller::PlayerController;
use crate::replacement::replacement_handler::{apply_replacements, ReplacementEvent};
use crate::replacement::ReplacementResult;

/// SP$ Attach / AB$ Attach — attach Equipment/Aura to target creature.
///
/// Mirrors Java's `AttachEffect.resolve()`: the cards attached are
/// `Object$` when present (e.g. Dáin Ironfoot's Axe token via
/// `DelayTriggerRememberedLKI`, Thorin's targeted Equipment via
/// `ParentTarget`), otherwise the source card itself.
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `AttachEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(AttachEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let source_id = match sa.source {
        Some(s) => s,
        None => return,
    };
    // Java: `Object$` names the attachments; otherwise the source is attached.
    let attachments: Vec<CardId> = match sa.ir.object_text.as_deref() {
        Some(object) => resolve_attach_objects(ctx, sa, source_id, object),
        None => vec![source_id],
    };
    if attachments.is_empty() {
        return;
    }
    let chooser = sa
        .chooser()
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

    let mut candidates: Vec<GameEntity> = Vec::new();
    if let Some(target_card) = sa.target_chosen.target_card {
        candidates.push(GameEntity::Card(target_card));
    }
    if let Some(target_player) = sa.target_chosen.target_player {
        candidates.push(GameEntity::Player(target_player));
    }
    if candidates.is_empty() {
        if let Some(defined) = sa.defined() {
            candidates.extend(
                crate::ability::ability_utils::get_defined_cards(
                    ctx.game,
                    Some(source_id),
                    defined,
                    Some(sa.activating_player),
                )
                .into_iter()
                .map(GameEntity::Card),
            );
            candidates.extend(
                crate::ability::ability_utils::resolve_defined_players_with_sa(
                    defined,
                    sa,
                    sa.activating_player,
                    ctx.game,
                )
                .into_iter()
                .map(GameEntity::Player),
            );
        }
    }
    if candidates.is_empty() {
        return;
    }
    let chosen = {
        let agent = ctx.agents[chooser.index()].as_mut();
        let mut controller = PlayerController::new(ctx.game, chooser, agent);
        controller.snapshot_state(ctx.mana_pools);
        controller.choose_single_entity_for_effect(&candidates)
    };
    let chosen = match chosen {
        Some(chosen) => chosen,
        None => return,
    };
    let target = match chosen {
        GameEntity::Card(c) => c,
        GameEntity::Player(_) => return,
    };

    for aura_id in attachments {
        attach_one(ctx, sa, source_id, aura_id, target);
    }
}

fn attach_one(
    ctx: &mut EffectContext,
    sa: &crate::spellability::SpellAbility,
    source_id: CardId,
    aura_id: CardId,
    target: CardId,
) {
    // Both must be on the battlefield
    if ctx.game.card(aura_id).zone != ZoneType::Battlefield
        || ctx.game.card(target).zone != ZoneType::Battlefield
    {
        return;
    }
    if crate::staticability::static_ability_cant_attach::cant_attach(
        &ctx.game.cards,
        ctx.game.card(aura_id),
        ctx.game.card(target),
        false,
    ) {
        return;
    }

    // Run Attached replacement effects before attaching.
    let mut event = ReplacementEvent::Attached {
        card: aura_id,
        target,
    };
    let result = apply_replacements(ctx.game, &mut event);
    if result == ReplacementResult::Skipped || result == ReplacementResult::Replaced {
        return;
    }

    ctx.game.attach_to(aura_id, target);

    // Java: `RememberAttached$` remembers each attachment that actually
    // attached (Thorin, Mountain-king's "when one or more Equipment become
    // attached this way" checks this).
    if sa.ir.remember_attached && ctx.game.card(aura_id).attached_to == Some(target) {
        ctx.game.card_mut(source_id).add_remembered_card(aura_id);
    }

    // Fire Attached trigger
    ctx.trigger_handler.run_trigger(
        crate::trigger::TriggerType::Attached,
        crate::event::RunParams {
            card: Some(aura_id),
            ..Default::default()
        },
        false,
    );
}

/// Resolve `Object$` to the cards to attach, in the resolving SA's context.
/// Mirrors `AbilityUtils.getDefinedCards(source, sa.getParam("Object"), sa)`.
fn resolve_attach_objects(
    ctx: &EffectContext,
    sa: &crate::spellability::SpellAbility,
    source_id: CardId,
    object: &str,
) -> Vec<CardId> {
    match DefinedRef::parse(object) {
        DefinedRef::SelfCard => vec![source_id],
        DefinedRef::ParentTarget | DefinedRef::ParentTargeted => {
            ctx.parent_target_card.into_iter().collect()
        }
        DefinedRef::Targeted | DefinedRef::TargetedCard | DefinedRef::ThisTargetedCard => {
            sa.target_chosen.target_card.into_iter().collect()
        }
        DefinedRef::DelayTriggerRememberedLki
        | DefinedRef::DelayTriggerRemembered
        | DefinedRef::TriggerRemembered => {
            let mut cards: Vec<CardId> = Vec::new();
            for value in &sa.trigger_remembered {
                if let AbilityValue::Card(cid) = value {
                    if !cards.contains(cid) {
                        cards.push(*cid);
                    }
                }
            }
            cards
        }
        DefinedRef::Remembered => ctx.game.card(source_id).remembered_cards.clone(),
        _ => crate::ability::ability_utils::get_defined_cards(
            ctx.game,
            Some(source_id),
            object,
            Some(sa.activating_player),
        ),
    }
}
