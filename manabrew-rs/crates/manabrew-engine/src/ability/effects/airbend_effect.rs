//! Airbend — exile target cards, their owner may cast them for {2}.
//! Mirrors Java `AirbendEffect`: exiles each card and creates a per-card
//! Effect in the Command zone that grants `MayPlay` with an alternate
//! mana cost of `{2}`, so the owner may cast the exiled card from exile.

use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};

use super::EffectContext;
use crate::ability::ability_ir::DefinedRef;
use crate::card::Card;
use crate::ids::CardId;
use crate::staticability::parse_static_ability;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `AirbendEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(AirbendEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let parent_target = ctx.parent_target_card.or(sa.target_chosen.target_card);
    let primary_def = sa.ir.defined.as_ref().and_then(|d| d.refs.first());
    let targets: Vec<CardId> = match primary_def {
        None => {
            if let Some(target) = sa.target_chosen.target_card {
                vec![target]
            } else if let Some(source) = sa.source {
                vec![source]
            } else {
                return;
            }
        }
        Some(DefinedRef::SelfCard) => sa.source.into_iter().collect(),
        Some(DefinedRef::Remembered) => sa
            .source
            .map(|sid| ctx.game.card(sid).remembered_cards.clone())
            .unwrap_or_default(),
        Some(DefinedRef::Targeted) => sa.target_chosen.target_card.into_iter().collect(),
        Some(DefinedRef::Unsupported(raw)) if raw.starts_with("Valid ") => {
            // `Defined$ Valid <selector>` (Avatar's Wrath uses
            // `Valid Creature.NotDefinedTargeted`). Java's
            // `AirbendEffect` resolves these via `getCardsfromTargets`,
            // which delegates to `knownDetermineDefined`.
            let filter = raw.strip_prefix("Valid ").unwrap_or("").trim();
            let stripped: String = filter
                .split('.')
                .map(|seg| {
                    seg.split('+')
                        .filter(|term| !term.eq_ignore_ascii_case("NotDefinedTargeted"))
                        .collect::<Vec<_>>()
                        .join("+")
                })
                .filter(|seg| !seg.is_empty())
                .collect::<Vec<_>>()
                .join(".");
            let mut out = Vec::new();
            for &pid in &ctx.game.player_order {
                for &cid in ctx.game.cards_in_zone(ZoneType::Battlefield, pid) {
                    if filter.contains("NotDefinedTargeted")
                        && parent_target.is_some_and(|t| t == cid)
                    {
                        continue;
                    }
                    if super::matches_change_type(ctx.game.card(cid), &stripped, &[]) {
                        out.push(cid);
                    }
                }
            }
            out
        }
        _ => sa.source.into_iter().collect(),
    };

    let host_id = sa.source;
    let host_image = host_id.map(|id| ctx.game.card(id).card_name.clone());

    // Cumulative list of cards this resolution has moved into Exile and not
    // since left it. Mirrors Java `zoneMovements.filterCards(null, [Exile], …)`
    // observed from inside the per-target loop: each new effect remembers
    // every airbent card so far, so an early target ends up "remembered" by
    // every subsequently-created effect.
    let mut exiled_so_far: Vec<CardId> = Vec::new();

    for card_id in targets {
        if ctx.game.card(card_id).zone == ZoneType::None {
            continue;
        }

        // Exile the card
        let old_zone = ctx.game.card(card_id).zone;
        let owner = ctx.game.card(card_id).owner;
        ctx.move_card(card_id, ZoneType::Exile, owner);
        super::emit_zone_trigger(ctx.trigger_handler, card_id, old_zone, ZoneType::Exile);

        if ctx.game.card(card_id).is_token {
            continue;
        }
        if ctx.game.card(card_id).zone != ZoneType::Exile {
            continue;
        }

        // Java's `removeIf(Card::isToken)` mirrored above; the cumulative list
        // only collects non-token cards that ended this iteration in Exile.
        exiled_so_far.push(card_id);

        // Per-card persistent Effect in the Command zone granting
        // `MayPlay$ True | MayPlayAltManaCost$ 2` to the exiled card while
        // it's still exiled. Mirrors Java `AirbendEffect.resolve`.
        let card_name_for_effect = ctx.game.card(card_id).card_name.clone();
        let host_name = host_image.clone().unwrap_or_else(|| "Airbend".to_string());
        let effect_name = format!("{} ({})", host_name, card_name_for_effect);

        let mut effect = Card::new(
            CardId(0),
            effect_name,
            owner,
            CardTypeLine::parse("Effect"),
            ManaCost::parse("0"),
            ColorSet::COLORLESS,
            None,
            None,
            vec![],
            vec![],
        );
        effect.set_controller(owner);
        effect.set_effect_source(host_id);
        let static_text = "S$ Mode$ Continuous | MayPlay$ True | MayPlayAltManaCost$ 2 \
            | EffectZone$ Command | Affected$ Card.IsRemembered+nonLand \
            | AffectedZone$ Exile | Description$ You may cast the card.";
        if let Some(static_ab) = parse_static_ability(static_text) {
            effect.set_static_abilities(vec![static_ab]);
        }
        effect.add_remembered_cards(exiled_so_far.iter().copied());
        effect.set_forget_on_moved_origin(Some(ZoneType::Exile));

        let effect_id = ctx.game.create_card(effect);
        ctx.move_card(effect_id, ZoneType::Command, owner);
    }
}
