use forge_foundation::ZoneType;

use super::EffectContext;
use crate::ability::ability_ir::DefinedRef;
use crate::card::card_util;
use crate::spellability::SpellAbility;

/// Return the list of qualities a `SP$ Protection | Gains$ Choice` ability can
/// choose from. Mirrors Java `ProtectEffect.getProtectionList(SpellAbility)`.
///
/// When `Choices$` contains `AnyColor`, expands to the five MTG colors. When
/// `Choices$` contains `CardType`, Java expands to every card type — not yet
/// implemented here (no `CardType::all()` enumerator). Everything else is a
/// comma-separated list.
pub fn get_protection_list(sa: &SpellAbility) -> Vec<String> {
    let gains = sa.ir.gains.as_deref().unwrap_or("");
    if gains != "Choice" && !gains.contains("chosen color") {
        return gains
            .split(',')
            .map(|c| c.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
    }

    let mut out = Vec::new();
    let choices = sa.ir.choices.as_deref().unwrap_or("");
    let mut choices_mut = choices.to_string();
    if choices_mut.contains("AnyColor") {
        out.extend(
            ["White", "Blue", "Black", "Red", "Green"]
                .iter()
                .map(|s| s.to_string()),
        );
        choices_mut = choices_mut.replace("AnyColor,", "").replace("AnyColor", "");
    }
    let trimmed = choices_mut.trim().trim_end_matches(',');
    if !trimmed.is_empty() {
        out.extend(
            trimmed
                .split(',')
                .map(|c| c.trim().to_string())
                .filter(|s| !s.is_empty()),
        );
    }
    if out.is_empty() {
        out = ["White", "Blue", "Black", "Red", "Green"]
            .iter()
            .map(|s| s.to_string())
            .collect();
    }
    out
}

/// End-of-turn revert for Protection. Mirrors the `GameCommand.run()` in Java
/// `ProtectEffect` that removes the granted protection keyword when the
/// effect duration expires.
pub fn run(game: &mut crate::game::GameState, card_id: crate::ids::CardId, keyword: &str) {
    if game.card(card_id).zone == ZoneType::Battlefield {
        game.card_mut(card_id).pump_keywords.remove(keyword);
    }
}

/// `SP$ Protection` — grant protection from a quality to a permanent.
///
/// Mirrors Java's `ProtectEffect.java`.
/// - `Gains$` — the protection keyword to grant (e.g. "Protection from chosen color").
/// - `Choices$` — if present, player chooses what to protect from.
///
/// # Card script examples
/// ```text
/// A:SP$ Protection | Gains$ Protection from chosen color | Choices$ White,Blue,Black,Red,Green
/// A:SP$ Protection | Gains$ Protection from red
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ProtectEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ProtectEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;

    // Determine target
    let target = sa
        .target_chosen
        .target_card
        .or_else(|| match sa.defined_ref() {
            Some(DefinedRef::SelfCard) => sa.source,
            Some(DefinedRef::ParentTarget) => ctx.parent_target_card,
            _ => sa.source,
        });

    let gains = sa.ir.gains.clone().unwrap_or_default();

    // Mirrors Java ProtectEffect: `isChoice = sa.getParam("Gains").contains("Choice")`
    // Handles both `Gains$ Choice` (Gods Willing) and `Gains$ Protection from chosen color`.
    let is_choice = gains.contains("Choice") || gains.contains("chosen color");

    let mut targets = target.into_iter().collect::<Vec<_>>();
    targets.extend(card_util::get_radiance(ctx.game, sa).iter().copied());
    targets.retain(|&id| ctx.game.card(id).zone == ZoneType::Battlefield);
    targets.sort_unstable_by_key(|cid| cid.0);
    targets.dedup();
    if targets.is_empty() {
        return;
    }

    if is_choice {
        let choices = get_protection_list(sa);
        let chosen = ctx.agents[controller.index()].choose_color(controller, &choices);
        if let Some(color) = chosen {
            let prot_kw = format!("Protection from {}", color.to_lowercase());
            for card_id in targets {
                ctx.game.card_mut(card_id).add_pump_keyword(&prot_kw);
            }
        }
    } else {
        // Static protection grant
        for card_id in targets {
            ctx.game.card_mut(card_id).add_pump_keyword(&gains);
        }
    }
}
