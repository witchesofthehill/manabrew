//! EffectEffect — mirrors Java `forge.game.ability.effects.EffectEffect`.
//!
//! Creates a temporary "effect" card in the Command zone that carries granted
//! static abilities, triggers, replacement effects, and/or spell abilities for
//! the duration specified by `Duration$` (defaults to end-of-turn).
//!
//! Parity caveats (documented, not yet ported):
//! - `Boon$`, `Image$`, `SetChosenDirection` — Card lacks the setters.
//! - `NoteCounterDefined` — no `CountersNoteEffect::noteCounters` equivalent.
//! - `RememberLKI` — snapshots via `CardCopyService::get_lki_copy` into the
//!   effect card's `remembered_lki_cards` list (in addition to the live IDs
//!   in `remembered_cards`).

use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};

use crate::card::Card;
use crate::ids::{CardId, PlayerId};
use crate::replacement::replacement_effect::parse_replacement_effect;
use crate::spellability::{build_spell_ability_from_host_card, SpellAbility};
use crate::staticability::parse_static_ability;
use crate::trigger::trigger::parse_trigger;

use super::{resolve_defined_player, resolve_defined_players, EffectContext};
use crate::ability::ability_utils;
use crate::ability::spell_ability_effect::{check_valid_duration, SpellAbilityEffect};
use crate::spellability::AbilityDuration;

/// Stateless marker type — mirrors Java's `class EffectEffect extends SpellAbilityEffect`.
pub struct EffectEffect;

impl SpellAbilityEffect for EffectEffect {
    fn resolve(ctx: &mut EffectContext, sa: &SpellAbility) {
        resolve_impl(ctx, sa);
    }
}

fn resolve_impl(ctx: &mut EffectContext, sa: &SpellAbility) {
    let Some(source_id) = sa.source else {
        return;
    };

    let duration = sa.ir.duration.as_ref();
    if !check_valid_duration(ctx.game, sa, duration) {
        return;
    }

    let (host_name, host_remembered_cards, host_remembered_players) = {
        let host = ctx.game.card(source_id);
        (
            host.card_name.clone(),
            host.remembered_cards.clone(),
            host.remembered_players.clone(),
        )
    };

    let abilities = split_csv_value(sa.ir.abilities.as_deref());
    let triggers = split_csv_value(sa.ir.triggers.as_deref());
    let static_refs = split_csv_value(sa.ir.static_abilities.as_deref());
    let replacement_refs = split_csv_value(sa.ir.replacement_effects.as_deref());

    let effect_name = resolve_effect_name(sa, &host_name);
    let effect_owner_defined = sa.ir.effect_owner_text.as_deref().unwrap_or("You");
    let mut owners = resolve_defined_players(effect_owner_defined, sa.activating_player, ctx.game);

    // `Unique$` — drop owners that already have an effect with this name in command.
    if sa.ir.unique {
        owners.retain(|pid| !player_has_effect_named(ctx, *pid, &effect_name));
    }
    if owners.is_empty() {
        return;
    }

    // Resolve remember-targets upfront (Java's `RememberObjects`/`RememberSpell`/`RememberLKI`).
    let mut remember_cards: Vec<CardId> = Vec::new();
    let mut remember_players: Vec<PlayerId> = Vec::new();
    let mut remember_lki_cards: Vec<Card> = Vec::new();
    populate_remember_lists(
        ctx,
        sa,
        &host_remembered_cards,
        &host_remembered_players,
        &mut remember_cards,
        &mut remember_players,
        &mut remember_lki_cards,
    );

    // Early exit — Java skips effect creation when forget/exile triggers would fire
    // without any remembered objects to track.
    let needs_nonempty_remember = sa.ir.forget_on_moved_text.is_some()
        || sa.ir.exile_on_moved
        || sa.ir.forget_on_phased_in
        || sa.ir.forget_counter;
    if needs_nonempty_remember
        && remember_cards.is_empty()
        && remember_players.is_empty()
        && remember_lki_cards.is_empty()
        && (sa.ir.remember_objects.is_some()
            || sa.ir.remember_spell.is_some()
            || sa.ir.remember_lki.is_some())
    {
        return;
    }

    // Pre-parse grant lists — ID collisions between players are fine because
    // `add_trigger`/`add_replacement_effect` handle deduplication per-card.
    let parsed_static_abilities = static_refs
        .iter()
        .filter_map(|svar_name| ctx.game.card(source_id).get_s_var(svar_name))
        .filter_map(|raw| {
            let mut static_ability = parse_static_ability(&format!("S$ {}", raw))?;
            static_ability.ir.active_zones = vec![ZoneType::Command];
            static_ability.ir.has_zone_keys = true;
            static_ability.base.set_intrinsic(true);
            Some(static_ability)
        })
        .collect::<Vec<_>>();

    // `Triggers$` / `ReplacementEffects$` / `Abilities$` grants need the raw SVar
    // text — gather it now so each owner's effect card gets a fresh parse.
    let trigger_svars = collect_svar_texts(ctx, source_id, &triggers);
    let replacement_svars = collect_svar_texts(ctx, source_id, &replacement_refs);
    let ability_svars = collect_svar_texts(ctx, source_id, &abilities);

    // Imprint snapshot — `ImprintCards$` defines cards to imprint on the effect.
    let imprint_cards: Vec<CardId> = sa
        .ir
        .imprint_cards
        .as_deref()
        .map(|defined| {
            ability_utils::get_defined_cards(
                ctx.game,
                sa.source,
                defined,
                Some(sa.activating_player),
            )
        })
        .unwrap_or_default();

    // Chosen state snapshot from host (Java copies these onto the effect card).
    let chosen_snapshot = ChosenSnapshot::capture(ctx.game.card(source_id));

    let chosen_number_override = sa
        .ir
        .set_chosen_number
        .as_deref()
        .map(ability_utils::calculate_amount);

    for owner in owners {
        let mut effect = Card::new(
            CardId(0),
            effect_name.clone(),
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
        effect.set_effect_source(Some(source_id));
        effect.set_static_abilities(parsed_static_abilities.clone());

        // Triggers/replacements need fresh parses per card so host binding and
        // IDs stay independent. Active zone is forced to Command (Java parity).
        for svar_text in &trigger_svars {
            let mut next_id = 1000u32;
            if let Some(mut trig) = parse_trigger(svar_text, &mut next_id) {
                trig.set_active_zone(vec![ZoneType::Command]);
                trig.set_intrinsic(true);
                effect.add_trigger(trig);
            }
        }
        for svar_text in &replacement_svars {
            if let Some(mut re) = parse_replacement_effect(svar_text) {
                re.base.set_active_zone(vec![ZoneType::Command]);
                re.base.card_trait_base.set_intrinsic(true);
                effect.add_replacement_effect(re);
            }
        }
        for ability_text in &ability_svars {
            let sa_granted = build_spell_ability_from_host_card(&effect, ability_text, owner);
            effect.add_spell_ability(&sa_granted);
        }

        // Copy SVars from host so triggers/replacements can resolve Execute$/etc.
        let host_svars = ctx.game.card(source_id).svars.clone();
        for (k, v) in host_svars {
            effect.set_s_var_if_absent(k, v);
        }

        apply_duration_flags(&mut effect, duration, source_id);
        apply_forget_on_moved_flags(&mut effect, sa);
        effect.add_remembered_cards(remember_cards.iter().copied());
        effect.add_remembered_players(remember_players.iter().copied());
        effect.remembered_lki_cards = remember_lki_cards.clone();
        for imp in &imprint_cards {
            effect.add_imprinted_card(*imp);
        }
        apply_chosen_state(&mut effect, &chosen_snapshot, chosen_number_override);
        if sa.is_intrinsic() {
            let host_clone = ctx.game.card(source_id).clone();
            effect.copy_changed_text_from(&host_clone);
        }

        let effect_id = ctx.game.create_card(effect);
        ctx.move_card(effect_id, ZoneType::Command, owner);
    }

    // `AtEOT$ <action>` — register an end-of-turn delayed trigger targeting the
    // host card (the "effect source"), not the created effect-card. Mirrors
    // Java EffectEffect → registerDelayedTrigger with the host card as target.
    if let Some(action) = sa.ir.at_eot.as_deref() {
        crate::ability::spell_ability_effect::register_at_eot(
            ctx.trigger_handler,
            ctx.game,
            sa,
            action,
            vec![source_id],
        );
    }
}

fn split_csv_value(value: Option<&str>) -> Vec<String> {
    value
        .map(|v| {
            v.split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn resolve_effect_name(sa: &SpellAbility, host_name: &str) -> String {
    if let Some(name) = sa.ir.name_text.as_deref() {
        return name.to_string();
    }
    let suffix = if sa.ir.boon { "'s Boon" } else { "'s Effect" };
    format!("{}{}", host_name, suffix)
}

fn player_has_effect_named(ctx: &EffectContext, player: PlayerId, name: &str) -> bool {
    ctx.game
        .cards_in_zone(ZoneType::Command, player)
        .iter()
        .any(|cid| ctx.game.card(*cid).card_name == name)
}

fn collect_svar_texts(ctx: &EffectContext, source_id: CardId, names: &[String]) -> Vec<String> {
    let host = ctx.game.card(source_id);
    names
        .iter()
        .filter_map(|n| host.get_s_var(n).map(str::to_string))
        .collect()
}

fn populate_remember_lists(
    ctx: &EffectContext,
    sa: &SpellAbility,
    host_remembered_cards: &[CardId],
    host_remembered_players: &[PlayerId],
    out_cards: &mut Vec<CardId>,
    out_players: &mut Vec<PlayerId>,
    out_lki_cards: &mut Vec<Card>,
) {
    if let Some(remember) = sa.ir.remember_objects.as_deref() {
        for token in remember.split(',').map(str::trim).filter(|s| !s.is_empty()) {
            match token {
                "Remembered" => {
                    out_cards.extend(host_remembered_cards.iter().copied());
                    out_players.extend(host_remembered_players.iter().copied());
                }
                "RememberedCard" => out_cards.extend(host_remembered_cards.iter().copied()),
                "RememberedPlayer" => out_players.extend(host_remembered_players.iter().copied()),
                "RememberedLKI" => {
                    for &cid in host_remembered_cards {
                        out_lki_cards.push(crate::card::card_copy_service::get_lki_copy(
                            ctx.game.card(cid),
                        ));
                    }
                }
                "Targeted" => {
                    if let Some(cid) = sa.target_chosen.target_card.or(ctx.parent_target_card) {
                        out_cards.push(cid);
                    }
                }
                "TargetedPlayer" => {
                    if let Some(pid) = sa.target_chosen.target_player {
                        out_players.push(pid);
                    }
                }
                other => {
                    // Try player resolution first, then fall through to defined-cards.
                    if let Some(pid) = resolve_defined_player(other, sa.activating_player, ctx.game)
                    {
                        out_players.push(pid);
                    } else {
                        let defined_cards = ability_utils::get_defined_cards(
                            ctx.game,
                            sa.source,
                            other,
                            Some(sa.activating_player),
                        );
                        out_cards.extend(defined_cards);
                    }
                }
            }
        }
    }

    // `RememberSpell$` — Java resolves to spell abilities; Rust snapshots the
    // source cards of those stack entries (closest approximation given we don't
    // serialize `SpellAbility` onto effect cards).
    if let Some(defined) = sa.ir.remember_spell.as_deref() {
        for token in defined.split(',').map(str::trim).filter(|s| !s.is_empty()) {
            let spells = ability_utils::get_defined_spell_abilities(token, sa, ctx.game);
            for spell in spells {
                if let Some(src) = spell.source {
                    out_cards.push(src);
                }
            }
        }
    }

    // `RememberLKI$` — snapshot the defined cards via CardCopyService so the
    // effect card sees them as they were at resolution time, even after those
    // cards leave their zone or have their stats modified.
    if let Some(defined) = sa.ir.remember_lki.as_deref() {
        for token in defined.split(',').map(str::trim).filter(|s| !s.is_empty()) {
            let cards = ability_utils::get_defined_cards(
                ctx.game,
                sa.source,
                token,
                Some(sa.activating_player),
            );
            for cid in cards {
                out_lki_cards.push(crate::card::card_copy_service::get_lki_copy(
                    ctx.game.card(cid),
                ));
            }
        }
    }
}

struct ChosenSnapshot {
    colors: Vec<String>,
    cards: Vec<CardId>,
    player: Option<PlayerId>,
    player_controller: Option<PlayerId>,
    player_revealed: bool,
    type_: Option<String>,
    type_controller: Option<PlayerId>,
    type_revealed: bool,
    type2: Option<String>,
    named_cards: Vec<String>,
    number: Option<i32>,
}

impl ChosenSnapshot {
    fn capture(host: &Card) -> Self {
        Self {
            colors: host.chosen_colors.clone(),
            cards: host.chosen_cards.clone(),
            player: host.chosen_player,
            player_controller: host.chosen_player_controller,
            player_revealed: host.chosen_player_revealed,
            type_: host.chosen_type.clone(),
            type_controller: host.chosen_type_controller,
            type_revealed: host.chosen_type_revealed,
            type2: host.chosen_type2.clone(),
            named_cards: host.named_cards.clone(),
            number: host.chosen_number,
        }
    }
}

fn apply_chosen_state(
    effect: &mut Card,
    snap: &ChosenSnapshot,
    chosen_number_override: Option<i32>,
) {
    if !snap.colors.is_empty() {
        effect.clear_chosen_colors();
        for c in &snap.colors {
            effect.add_chosen_color(c.clone());
        }
    }
    if !snap.cards.is_empty() {
        effect.set_chosen_cards(snap.cards.clone());
    }
    if snap.player.is_some() {
        effect.set_chosen_player(snap.player, snap.player_controller, snap.player_revealed);
    }
    if snap.type_.is_some() {
        effect.set_chosen_type(snap.type_.clone(), snap.type_controller, snap.type_revealed);
    }
    if let Some(t2) = &snap.type2 {
        effect.chosen_type2 = Some(t2.clone());
    }
    for name in &snap.named_cards {
        effect.add_named_card(name);
    }
    if let Some(n) = chosen_number_override.or(snap.number) {
        effect.set_chosen_number(Some(n));
    }
}

/// `Duration$` values EffectEffect recognises. Mirrors Java's string literals.
/// Unknown values fall through to `EndOfTurn` (Java default).
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum_macros::EnumString, Default)]
#[strum(ascii_case_insensitive)]
pub enum EffectDuration {
    #[default]
    EndOfTurn,
    Permanent,
    UntilHostLeavesPlay,
    UntilHostLeavesPlayOrEOT,
}

fn apply_duration_flags(effect: &mut Card, duration: Option<&AbilityDuration>, source_id: CardId) {
    let d = match duration {
        Some(AbilityDuration::UntilHostLeavesPlay) => EffectDuration::UntilHostLeavesPlay,
        Some(AbilityDuration::UntilHostLeavesPlayOrEot) => EffectDuration::UntilHostLeavesPlayOrEOT,
        Some(AbilityDuration::Unsupported(raw)) if raw.eq_ignore_ascii_case("Permanent") => {
            EffectDuration::Permanent
        }
        _ => EffectDuration::EndOfTurn,
    };
    match d {
        EffectDuration::Permanent => {}
        EffectDuration::UntilHostLeavesPlay => {
            effect.set_temp_effect_host(Some(source_id));
        }
        EffectDuration::UntilHostLeavesPlayOrEOT => {
            effect.set_temp_effect_host(Some(source_id));
            effect.set_temp_effect_until_eot(true);
        }
        EffectDuration::EndOfTurn => {
            effect.set_temp_effect_until_eot(true);
        }
    }
}

fn apply_forget_on_moved_flags(effect: &mut Card, sa: &SpellAbility) {
    if let Some(zone) = sa.ir.forget_on_moved_zone {
        effect.set_forget_on_moved_origin(Some(zone));
        // Java forget flow exiles effect when no remembered objects remain.
        effect.set_exile_when_no_remembered(true);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ability::effects::EffectContext;
    use crate::ability::spell_ability_effect::SpellAbilityEffect;
    use crate::agent::{PassAgent, PlayerAgent};
    use crate::card::Card;
    use crate::game::GameState;
    use crate::ids::{CardId, PlayerId};
    use crate::mana::ManaPool;
    use crate::spellability::SpellAbility;
    use crate::trigger::handler::TriggerHandler;

    #[test]
    fn effect_adds_command_static_for_cast_with_flash() {
        let mut game = GameState::new(&["P0", "P1"], 20);
        let p0 = PlayerId(0);

        let mut host = Card::new(
            CardId(0),
            "Winding Canyons".to_string(),
            p0,
            CardTypeLine::parse("Land"),
            ManaCost::parse("0"),
            ColorSet::COLORLESS,
            None,
            None,
            vec![],
            vec![],
        );
        host.set_s_var(
            "GiveFlash",
            "Mode$ CastWithFlash | ValidCard$ Creature | ValidSA$ Spell | Caster$ You",
        );
        let host_id = game.create_card(host);
        game.move_card(host_id, ZoneType::Battlefield, p0);

        let mut sa = SpellAbility::new_simple(
            Some(host_id),
            p0,
            "AB$ Effect | StaticAbilities$ GiveFlash | SpellDescription$ test",
        );
        sa.is_activated = true;

        let mut agents: Vec<Box<dyn PlayerAgent>> = vec![Box::new(PassAgent), Box::new(PassAgent)];
        let mut trigger_handler = TriggerHandler::new();
        let token_templates = std::collections::HashMap::new();
        let templates_variants: std::collections::HashMap<(String, String), usize> =
            std::collections::HashMap::new();
        let token_fallback: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();
        let edition_dates: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();
        let mut mana_pools = vec![ManaPool::new(), ManaPool::new()];
        let mut rng_adapter = crate::game_rng::ThreadRngAdapter;
        let mut ctx = EffectContext {
            game: &mut game,
            combat: None,
            agents: &mut agents,
            trigger_handler: &mut trigger_handler,
            token_templates: &token_templates,
            token_art_variants: &templates_variants,
            token_fallback: &token_fallback,
            edition_dates: &edition_dates,
            mana_pools: &mut mana_pools,
            parent_target_card: None,
            rng: &mut rng_adapter,
        };
        EffectEffect::resolve(&mut ctx, &sa);

        let command_cards = ctx.game.cards_in_zone(ZoneType::Command, p0).to_vec();
        assert_eq!(command_cards.len(), 1);
        let effect = ctx.game.card(command_cards[0]);
        assert!(effect.temp_effect_until_eot);
        assert_eq!(effect.effect_source, Some(host_id));

        let mut spell_abilities = Vec::new();
        spell_abilities.push("SP$ Permanent | Cost$ 1 G".to_string());
        let fake_creature = Card::new(
            CardId(999),
            "Bear".to_string(),
            p0,
            CardTypeLine::parse("Creature - Bear"),
            ManaCost::parse("1 G"),
            ColorSet::GREEN,
            Some(2),
            Some(2),
            vec![],
            vec![],
        );
        assert!(
            crate::staticability::static_ability_cast_with_flash::any_with_flash(
                &ctx.game.cards,
                &fake_creature,
                p0,
                &spell_abilities
            )
        );
    }
}
