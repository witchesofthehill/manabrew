//! SpellAbilityEffect — base trait and utility free functions for effects.
//!
//! Mirrors Java's `SpellAbilityEffect.java`.
//! In Java this is an abstract class with many protected static helpers;
//! in Rust we keep the trait for interface parity and provide the utility
//! methods as free functions that take `(&GameState, &SpellAbility)`.

use crate::ability::ability_ir::{DefinedExpr, DefinedRef};
use crate::ability::api_type::ApiType;
use crate::ability::AbilityKey;
use crate::agent::PlayerAgent;
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::parsing::keys;
use crate::player::player_factory_util::add_replacement_effect;
use crate::spellability::SpellAbility;
use crate::spellability::{AbilityDuration, ReplaceDyingCondition};

use super::ability_factory::AbilityRecordType;
use super::ability_utils;
use super::effects::EffectContext;

/// Base trait for all spell ability effect implementations.
///
/// Mirrors Java's abstract `SpellAbilityEffect` class.
/// Each effect type provides a `resolve` implementation that performs
/// the actual game-state mutation.
/// Every effect is a stateless unit struct, so all methods are associated
/// functions (no `self`). The trait is therefore not object-safe — runtime
/// dispatch through `dyn SpellAbilityEffect` is intentionally unsupported;
/// dispatch happens via the `effect_dispatch!` macro at compile time.
pub trait SpellAbilityEffect {
    /// Resolve this effect for the given spell ability.
    fn resolve(ctx: &mut EffectContext, sa: &SpellAbility);

    /// Return the stack description for this effect.
    /// Defaults to the spell ability's own description.
    fn get_stack_description(sa: &SpellAbility) -> String {
        sa.ability_text.clone()
    }

    /// Build/configure the spell ability after construction.
    /// Default is a no-op; some effects override this to add parameters.
    fn build_spell_ability(_sa: &mut SpellAbility) {}

    /// Tokenize a description string, replacing CARDNAME with the card's name.
    /// Mirrors Java's `SpellAbilityEffect.tokenizeString(SpellAbility, String)`.
    fn tokenize_string(game: &GameState, sa: &SpellAbility, desc: &str) -> String {
        tokenize_string(game, sa, desc)
    }

    /// Add a "forget on moved" trigger for remembered cards.
    /// Mirrors Java's `SpellAbilityEffect.addForgetOnMovedTrigger(SpellAbility, Card, String)`.
    fn add_forget_on_moved_trigger(
        game: &mut GameState,
        host_id: CardId,
        remembered_card_id: CardId,
    ) {
        add_forget_on_moved_trigger(game, host_id, remembered_card_id)
    }

    /// Create a temporary effect card in the command zone.
    /// Mirrors Java's `SpellAbilityEffect.createEffect(SpellAbility, Player, String, String)`.
    fn create_effect(game: &mut GameState, sa: &SpellAbility, name: &str, image: &str) -> CardId {
        create_effect(game, sa, name, image)
    }

    /// Run the effect (resolve entry point).
    /// Mirrors Java's `SpellAbilityEffect.run(SpellAbility)`.
    fn run(ctx: &mut super::effects::EffectContext, sa: &SpellAbility) {
        run(ctx, sa)
    }

    /// Track which card exiled another card, for "exile until" effects.
    /// Mirrors Java's `SpellAbilityEffect.handleExiledWith(SpellAbility, Card)`.
    fn handle_exiled_with(game: &mut GameState, sa: &SpellAbility, exiled_card_id: CardId) {
        handle_exiled_with(game, sa, exiled_card_id)
    }

    /// Execute the exile-with command.
    /// Mirrors Java's `SpellAbilityEffect.exileEffectCommand(Game, SpellAbility, Card)`.
    fn exile_effect_command(
        game: &mut GameState,
        trigger_handler: &mut crate::trigger::handler::TriggerHandler,
        sa: &SpellAbility,
        card_id: CardId,
    ) {
        exile_effect_command(game, trigger_handler, sa, card_id)
    }

    /// Full stack-description with sub-ability concatenation.
    /// Mirrors Java `SpellAbilityEffect.getStackDescriptionWithSubs(Map, SpellAbility)`.
    fn get_stack_description_with_subs(game: &GameState, sa: &SpellAbility) -> String {
        let fallback = Self::get_stack_description(sa);
        get_stack_description_with_subs(game, sa, &fallback)
    }

    /// Resolve a replacement chooser when the original lost the game (CR 800.4g).
    /// Mirrors Java `SpellAbilityEffect.getNewChooser(SpellAbility, Player)`.
    fn get_new_chooser(
        game: &GameState,
        agents: &mut [Box<dyn PlayerAgent>],
        sa: &SpellAbility,
        loser: PlayerId,
    ) -> Option<PlayerId> {
        get_new_chooser(game, agents, sa, loser)
    }
}

// ── Utility free functions mirroring Java's SpellAbilityEffect helpers ──

/// Get target cards for a spell ability.
/// If the SA uses targeting, returns the chosen target card(s).
/// Otherwise, resolves the `Defined$` parameter (defaulting to "Self").
///
/// Mirrors Java's `SpellAbilityEffect.getTargetCards(sa)`.
pub fn get_target_cards(game: &GameState, sa: &SpellAbility) -> Vec<CardId> {
    get_cards(game, sa, false, "Defined")
}

/// Get defined cards, falling back to targeted cards if no `Defined$` param.
///
/// Mirrors Java's `SpellAbilityEffect.getDefinedCardsOrTargeted(sa)`.
pub fn get_defined_cards_or_targeted(game: &GameState, sa: &SpellAbility) -> Vec<CardId> {
    get_cards(game, sa, true, "Defined")
}

/// Get defined cards with a custom param name, falling back to targeted.
///
/// Mirrors Java's `SpellAbilityEffect.getDefinedCardsOrTargeted(sa, definedParam)`.
pub fn get_defined_cards_or_targeted_param(
    game: &GameState,
    sa: &SpellAbility,
    defined_param: &str,
) -> Vec<CardId> {
    get_cards(game, sa, true, defined_param)
}

/// Core card resolution logic — shared by getTargetCards and getDefinedCardsOrTargeted.
/// Mirrors Java's private `SpellAbilityEffect.getCards(definedFirst, definedParam, sa)`.
fn get_cards(
    game: &GameState,
    sa: &SpellAbility,
    defined_first: bool,
    defined_param: &str,
) -> Vec<CardId> {
    let ir_defined = ir_defined_param(sa, defined_param);
    let has_defined = ir_defined.is_some_and(|defined| defined.is_some());
    let use_targets = sa.uses_targeting() && (!defined_first || !has_defined);

    if use_targets {
        // Return targeted card(s)
        sa.target_chosen.target_card.into_iter().collect()
    } else {
        // Resolve Defined$ (or default to "Self")
        let defined = ir_defined;
        let mut result = Vec::new();
        if let Some(Some(defined)) = defined {
            for d in &defined.refs {
                let cards = resolve_defined_cards_for_sa_ref(game, sa, d);
                result.extend(cards);
            }
        } else {
            result.extend(resolve_defined_cards_for_sa(game, sa, "Self"));
        }
        result
    }
}

/// Get target players for a spell ability.
/// If the SA uses targeting, returns the chosen target player(s).
/// Otherwise, resolves the `Defined$` parameter (defaulting to "You").
///
/// Mirrors Java's `SpellAbilityEffect.getTargetPlayers(sa)`.
pub fn get_target_players(game: &GameState, sa: &SpellAbility) -> Vec<PlayerId> {
    get_players(game, sa, false, "Defined")
}

/// Get defined players, falling back to targeted players if no `Defined$` param.
///
/// Mirrors Java's `SpellAbilityEffect.getDefinedPlayersOrTargeted(sa)`.
pub fn get_defined_players_or_targeted(game: &GameState, sa: &SpellAbility) -> Vec<PlayerId> {
    get_players(game, sa, true, "Defined")
}

/// Core player resolution logic.
/// Mirrors Java's private `SpellAbilityEffect.getPlayers(definedFirst, definedParam, sa)`.
fn get_players(
    game: &GameState,
    sa: &SpellAbility,
    defined_first: bool,
    defined_param: &str,
) -> Vec<PlayerId> {
    fn unique_push(players: &mut Vec<PlayerId>, player: PlayerId) {
        if !players.contains(&player) {
            players.push(player);
        }
    }

    fn ordered_players(game: &GameState, starter: PlayerId) -> Vec<PlayerId> {
        let Some(offset) = game.player_order.iter().position(|&pid| pid == starter) else {
            return game.player_order.clone();
        };

        (0..game.player_order.len())
            .map(|idx| game.player_order[(offset + idx) % game.player_order.len()])
            .collect()
    }

    fn sort_in_turn_order(game: &GameState, sa: &SpellAbility, players: &mut [PlayerId]) {
        let starter = sa
            .ir
            .starting_with
            .as_deref()
            .and_then(|defined| {
                ability_utils::resolve_defined_players_with_sa(
                    defined,
                    sa,
                    sa.activating_player,
                    game,
                )
                .into_iter()
                .next()
            })
            .unwrap_or(game.turn.active_player);
        let ordered = ordered_players(game, starter);

        players.sort_by_key(|pid| {
            ordered
                .iter()
                .position(|ordered_pid| ordered_pid == pid)
                .unwrap_or(usize::MAX)
        });
    }

    let ir_defined = ir_defined_param(sa, defined_param);
    let has_defined = ir_defined.is_some_and(|defined| defined.is_some());
    let use_targets = sa.uses_targeting() && (!defined_first || !has_defined);

    if use_targets {
        let mut result = sa.target_chosen.all_target_players();
        sort_in_turn_order(game, sa, &mut result);
        result
    } else {
        let mut result = Vec::new();
        if let Some(Some(defined)) = ir_defined {
            for d in &defined.refs {
                let players = ability_utils::resolve_defined_players_with_sa(
                    d.as_legacy_str(),
                    sa,
                    sa.activating_player,
                    game,
                );
                for player in players {
                    unique_push(&mut result, player);
                }
            }
        } else {
            for player in ability_utils::resolve_defined_players_with_sa(
                "You",
                sa,
                sa.activating_player,
                game,
            ) {
                unique_push(&mut result, player);
            }
        }
        sort_in_turn_order(game, sa, &mut result);
        result
    }
}

fn ir_defined_param<'a>(
    sa: &'a SpellAbility,
    defined_param: &str,
) -> Option<Option<&'a DefinedExpr>> {
    if defined_param == keys::DEFINED {
        Some(sa.ir.defined.as_ref())
    } else if defined_param == keys::DEFINED_PLAYER {
        Some(sa.ir.defined_player.as_ref())
    } else {
        None
    }
}

fn resolve_defined_cards_for_sa_ref(
    game: &GameState,
    sa: &SpellAbility,
    defined: &DefinedRef,
) -> Vec<CardId> {
    resolve_defined_cards_for_sa_ref_inner(game, sa, defined)
}

/// Resolve a `Defined$` string to card IDs in the context of a spell ability.
/// Handles SA-specific defined values like "Targeted", "ParentTarget",
/// "TriggeredCard", etc., in addition to the base AbilityUtils definitions.
fn resolve_defined_cards_for_sa(game: &GameState, sa: &SpellAbility, defined: &str) -> Vec<CardId> {
    let defined_ref = DefinedRef::parse(defined);
    resolve_defined_cards_for_sa_ref_inner(game, sa, &defined_ref)
}

fn resolve_defined_cards_for_sa_ref_inner(
    game: &GameState,
    sa: &SpellAbility,
    defined: &DefinedRef,
) -> Vec<CardId> {
    match defined {
        DefinedRef::SelfCard => {
            if sa.is_trigger {
                if let (Some(source), Some(created_at)) =
                    (sa.trigger_source, sa.trigger_source_zone_timestamp)
                {
                    let current = game.card(source);
                    if current.zone_timestamp != created_at {
                        return Vec::new();
                    }
                }
            }
            sa.source.into_iter().collect()
        }
        DefinedRef::Targeted | DefinedRef::TargetedCard | DefinedRef::ThisTargetedCard => {
            sa.target_chosen.target_card.into_iter().collect()
        }
        DefinedRef::TriggeredTargetLkiCopy => triggered_target_lki_cards(sa),
        DefinedRef::TriggeredCard | DefinedRef::TriggeredCardLkiCopy => {
            let cards = sa.get_triggering_cards(AbilityKey::Card);
            if cards.is_empty() {
                sa.trigger_source.into_iter().collect()
            } else {
                cards
            }
        }
        DefinedRef::ReplacedCard | DefinedRef::ReplacedCardLki => {
            let cards = sa.get_triggering_cards(AbilityKey::ReplacedCard);
            if cards.is_empty() {
                sa.get_triggering_cards(AbilityKey::Card)
            } else {
                cards
            }
        }
        DefinedRef::TriggeredNewCard | DefinedRef::TriggeredNewCardLkiCopy => {
            let cards = sa.get_triggering_cards(AbilityKey::NewCard);
            if cards.is_empty() {
                sa.trigger_source.into_iter().collect()
            } else {
                cards
            }
        }
        DefinedRef::TriggeredAttackers => sa.get_triggering_cards(AbilityKey::Attackers),
        DefinedRef::TriggeredAttacker => sa.get_triggering_cards(AbilityKey::Attacker),
        DefinedRef::TriggeredBlocker => sa.get_triggering_cards(AbilityKey::Blocker),
        DefinedRef::Explorer => sa.get_triggering_cards(AbilityKey::Explorer),
        DefinedRef::Explored => sa.get_triggering_cards(AbilityKey::Explored),
        // Cards paid during cost — Java reads `SA.paidHash`; Rust stores the
        // discarded slot on `discarded_cost_cards`, sacrificed slot on
        // `GameState.last_sacrificed_card`.
        DefinedRef::Discarded => sa.discarded_cost_cards.clone(),
        DefinedRef::Sacrificed => game.last_sacrificed_card.into_iter().collect(),
        _ => ability_utils::get_defined_cards(
            game,
            sa.source,
            defined.as_legacy_str(),
            Some(sa.activating_player),
        ),
    }
}

fn triggering_cards_from_key(sa: &SpellAbility, key: AbilityKey) -> Vec<CardId> {
    let cards = sa.get_triggering_cards(key);
    if !cards.is_empty() {
        return cards;
    }
    sa.get_triggering_object(key)
        .and_then(|raw| raw.parse::<u32>().ok())
        .map(CardId)
        .into_iter()
        .collect()
}

fn triggered_target_lki_cards(sa: &SpellAbility) -> Vec<CardId> {
    let target_cards = triggering_cards_from_key(sa, AbilityKey::TargetCard);
    if !target_cards.is_empty() {
        return target_cards;
    }
    if sa.get_triggering_player(AbilityKey::TargetPlayer).is_some() {
        return Vec::new();
    }
    triggering_cards_from_key(sa, AbilityKey::Target)
}

// ── SpellAbilityEffect utility functions ────────────────────────────

/// Tokenize a description string, replacing CARDNAME with the actual card name
/// and NICKNAME with a short version.
/// Mirrors Java's `SpellAbilityEffect.tokenizeString(SpellAbility, String)`.
pub fn tokenize_string(game: &GameState, sa: &SpellAbility, desc: &str) -> String {
    let card_name = sa
        .source
        .map(|cid| game.card(cid).card_name.clone())
        .unwrap_or_else(|| "CARDNAME".to_string());

    let mut result = desc.to_string();
    result = result.replace("CARDNAME", &card_name);
    result = result.replace("NICKNAME", &card_name);

    // Replace DAMAGE with the NumDmg parameter if present
    if let Some(num_dmg) = sa.ir.num_dmg_text.as_deref() {
        result = result.replace("DAMAGE", num_dmg);
    }

    // Replace AMOUNT with relevant numeric parameter
    if let Some(amount) = sa.ir.amount.as_deref().or(sa.ir.num_cards_text.as_deref()) {
        result = result.replace("AMOUNT", amount);
    }

    result
}

/// Add a "forget on moved" trigger to a card — when the card changes zones,
/// it is removed from its host's remembered list.
/// Mirrors Java's `SpellAbilityEffect.addForgetOnMovedTrigger(SpellAbility, Card, String)`.
pub fn add_forget_on_moved_trigger(
    game: &mut GameState,
    host_id: CardId,
    remembered_card_id: CardId,
) {
    // In the Rust engine, zone-change cleanup of remembered cards is handled
    // centrally in the zone-move logic. This function marks the card with a
    // flag so the zone-move system knows to clean up.
    // Store a SVar on the card so the zone-move system knows which host to clean up
    game.card_mut(remembered_card_id)
        .set_s_var("ForgetOnZoneChangeHost", host_id.0.to_string());
}

/// Create a temporary "effect" card in the command zone.
/// Mirrors Java's `SpellAbilityEffect.createEffect(SpellAbility, Player, String, String)`.
///
/// Effect cards are invisible game objects that hold continuous effects,
/// delayed triggers, and other state that persists beyond a single resolution.
/// They are placed in the Command zone and cleaned up when their effect ends.
pub fn create_effect(game: &mut GameState, sa: &SpellAbility, name: &str, _image: &str) -> CardId {
    use forge_foundation::{CardTypeLine, ColorSet, ManaCost};

    let owner = sa.activating_player;
    let source_name = sa
        .source
        .map(|cid| game.card(cid).card_name.clone())
        .unwrap_or_default();

    let effect_name = if name.is_empty() {
        format!("{} Effect", source_name)
    } else {
        name.to_string()
    };

    let effect_card = crate::card::Card::new(
        CardId(0), // will be assigned by create_card
        effect_name,
        owner,
        CardTypeLine::parse("Effect"),
        ManaCost::parse(""),
        ColorSet::COLORLESS,
        None,
        None,
        vec![],
        vec![],
    );

    let effect_id = game.create_card(effect_card);
    game.move_card(effect_id, forge_foundation::ZoneType::Command, owner);

    // Java passes `image` for UI; Rust tracks provenance via `effect_source` instead.
    if let Some(source_id) = sa.source {
        game.card_mut(effect_id).effect_source = Some(source_id);
        let source_svars = game.card(source_id).svars.clone();
        game.card_mut(effect_id).set_svars_map(source_svars);
    }

    // Mark as an effect card (not a "real" card) via SVar
    game.card_mut(effect_id).set_s_var("IsEffectCard", "True");

    effect_id
}

/// Run/resolve a spell ability effect (the main entry point for effect dispatch).
/// Mirrors Java's `SpellAbilityEffect.run(SpellAbility)` which calls resolve().
///
/// In the Rust engine this delegates to the effect dispatch system.
pub fn run(ctx: &mut super::effects::EffectContext, sa: &SpellAbility) {
    super::effects::resolve_effect(ctx, sa);
}

/// Track which card exiled another card, for "exile until" effects.
/// Mirrors Java's `SpellAbilityEffect.handleExiledWith(SpellAbility, Card)`.
///
/// Sets the `exiled_with` field on the exiled card and adds it to the
/// source card's imprinted list.
pub fn handle_exiled_with(game: &mut GameState, sa: &SpellAbility, exiled_card_id: CardId) {
    let source_id = match sa.source {
        Some(id) => id,
        None => return,
    };

    game.card_mut(exiled_card_id).set_exiled_by(Some(source_id));
    game.card_mut(source_id).add_imprinted_card(exiled_card_id);
}

/// Execute the "exile with" command — exile a card and track the exile source.
/// Mirrors Java's `SpellAbilityEffect.exileEffectCommand(Game, SpellAbility, Card)`.
///
/// Moves the card to exile, sets up the exiled_with tracking, and optionally
/// adds it to the source's remembered list.
pub fn exile_effect_command(
    game: &mut GameState,
    trigger_handler: &mut crate::trigger::handler::TriggerHandler,
    sa: &SpellAbility,
    card_id: CardId,
) {
    let owner = game.card(card_id).owner;
    let old_zone = game.card(card_id).zone;

    // Move the card to exile
    game.move_card(card_id, forge_foundation::ZoneType::Exile, owner);

    // Register zone triggers
    trigger_handler.register_active_trigger(game, card_id);
    super::effects::zone_triggers::emit_zone_trigger(
        trigger_handler,
        card_id,
        old_zone,
        forge_foundation::ZoneType::Exile,
    );

    // Set up the exiled_with relationship
    handle_exiled_with(game, sa, card_id);

    // Remember the exiled card if requested
    if sa.ir.remember_exiled {
        if let Some(source_id) = sa.source {
            game.card_mut(source_id).add_remembered_card(card_id);
        }
    }
}

/// Render the stack description for a SpellAbility, including sub-ability text.
/// Mirrors Java `SpellAbilityEffect.getStackDescriptionWithSubs(Map, SpellAbility)`.
///
/// `stack_desc_fallback` supplies the `getStackDescription(sa)` hook (per-effect
/// overrides) when the SA has no `StackDescription$` param. Pass the SA's own
/// `description` field for the default behavior.
pub fn get_stack_description_with_subs(
    game: &GameState,
    sa: &SpellAbility,
    stack_desc_fallback: &str,
) -> String {
    let mut sb = String::new();

    let is_permanent_api = matches!(
        sa.api,
        Some(ApiType::PermanentCreature) | Some(ApiType::PermanentNoncreature)
    );
    let is_sub = matches!(sa.record_type, AbilityRecordType::SubAbility);

    if !is_permanent_api {
        if !is_sub {
            if let Some(src_id) = sa.source {
                sb.push_str(&game.card(src_id).card_name);
                sb.push_str(" -");
            }
        }
        sb.push(' ');
    }

    // Own description
    if let Some(raw_stack_desc) = sa.ir.stack_description_text.as_deref() {
        let (stack_desc, reps): (&str, Option<Vec<(String, String)>>) =
            if let Some(rest) = raw_stack_desc.strip_prefix("REP") {
                let pairs = rest
                    .trim_start()
                    .split(" & ")
                    .filter_map(|s| {
                        s.split_once('_')
                            .map(|(a, b)| (a.to_string(), b.to_string()))
                    })
                    .collect();
                ("SpellDescription", Some(pairs))
            } else {
                (raw_stack_desc, None)
            };

        if stack_desc.eq_ignore_ascii_case("SpellDescription") {
            if let Some(raw_sdesc) = sa.ir.spell_description_text.as_deref() {
                let mut spell_desc = raw_sdesc.replace(",,,,,,", " ").replace(",,,", " ");
                // Strip reminder text `(...)`.
                if let (Some(l), Some(r)) = (spell_desc.find(" ("), spell_desc.find(')')) {
                    if r > l {
                        let reminder = spell_desc[l..=r].to_string();
                        spell_desc = spell_desc.replacen(&reminder, "", 1);
                    }
                }
                if let Some(replacements) = &reps {
                    for (from, to) in replacements {
                        if let Some(idx) = spell_desc.find(from) {
                            spell_desc.replace_range(idx..idx + from.len(), to);
                        }
                    }
                    sb.push_str(&tokenize_string(game, sa, &spell_desc));
                } else {
                    sb.push_str(&spell_desc);
                }
            }
            if reps.is_none() && has_any_target(sa) {
                sb.push_str(" (Targeting: ");
                sb.push_str(&join_targets(game, sa));
                sb.push(')');
            }
        } else if !stack_desc.eq_ignore_ascii_case("None") {
            sb.push_str(&tokenize_string(game, sa, stack_desc));
        }
    } else {
        let cond_desc = sa.ir.condition_description_text.as_deref();
        let after_desc = sa.ir.after_description_text.as_deref();
        let base_desc = stack_desc_fallback.to_string();
        if let Some(cd) = cond_desc {
            sb.push_str(cd);
            sb.push(' ');
            if cd.ends_with(',') {
                // Uncapitalize first letter of base_desc (mirrors Java StringUtils.uncapitalize).
                let mut chars = base_desc.chars();
                if let Some(c) = chars.next() {
                    sb.extend(c.to_lowercase());
                    sb.push_str(chars.as_str());
                }
            } else {
                sb.push_str(&base_desc);
            }
        } else {
            sb.push_str(&base_desc);
        }
        if let Some(ad) = after_desc {
            sb.push(' ');
            sb.push_str(ad);
        }
    }

    // Sub-ability chain (Java: `sa.getSubAbility().getStackDescription()`).
    // Permanent spells intentionally skip sub-description.
    if !is_permanent_api {
        if let Some(sub) = sa.sub_ability.as_deref() {
            let sub_fallback = sub.description.clone();
            sb.push_str(&get_stack_description_with_subs(game, sub, &sub_fallback));
        }
    }

    // Announce/X value suffix.
    if let Some(svar) = sa.ir.announce_text.as_deref() {
        let amount = calculate_amount_for_sa(game, sa, svar);
        sb.push_str(&format!(" ({svar}={amount})"));
    } else if sa.cost_has_mana_x() {
        sb.push_str(&format!(" (X={})", sa.x_mana_cost_paid));
    }

    // CARDNAME / NICKNAME substitution (already handled by tokenize_string for
    // the REP-path, but cover the non-tokenized paths too).
    if let Some(src_id) = sa.source {
        let name = game.card(src_id).card_name.clone();
        sb = sb.replace("CARDNAME", &name);
        sb = sb.replace("NICKNAME", &name);
    }

    sb
}

fn has_any_target(sa: &SpellAbility) -> bool {
    !sa.target_chosen.all_target_cards().is_empty()
        || !sa.target_chosen.all_target_players().is_empty()
}

fn join_targets(game: &GameState, sa: &SpellAbility) -> String {
    let mut names = Vec::new();
    for cid in sa.target_chosen.all_target_cards() {
        names.push(game.card(cid).card_name.clone());
    }
    for pid in sa.target_chosen.all_target_players() {
        names.push(format!("P{}", pid.index()));
    }
    names.join(", ")
}

fn calculate_amount_for_sa(game: &GameState, sa: &SpellAbility, svar: &str) -> i32 {
    if let Ok(n) = svar.parse::<i32>() {
        return n;
    }
    let Some(src) = sa.source else {
        return 0;
    };
    if sa.ir.semantic_numeric_params.contains_key(svar) {
        return crate::svar::resolve_numeric_svar(game, sa, svar, 0);
    }
    let Some(expr) = game.card(src).get_s_var(svar) else {
        return 0;
    };
    crate::svar::resolve_count_svar_for_sa(expr, game, src, sa.activating_player, sa)
}

/// Ask the activator's controller to pick a replacement chooser when the
/// original chooser has lost the game mid-effect (CR 800.4g).
///
/// Mirrors Java `SpellAbilityEffect.getNewChooser(SpellAbility, Player)`.
pub fn get_new_chooser(
    game: &GameState,
    agents: &mut [Box<dyn PlayerAgent>],
    sa: &SpellAbility,
    loser: PlayerId,
) -> Option<PlayerId> {
    let activator = sa.activating_player;
    let loser_is_opponent = loser != activator;
    let options: Vec<PlayerId> = game
        .alive_players()
        .into_iter()
        .filter(|&pid| pid != activator)
        .filter(|&pid| {
            if loser_is_opponent {
                // opponents of activator
                pid != activator
            } else {
                // all other players
                true
            }
        })
        .collect();

    if options.is_empty() {
        return None;
    }
    agents[activator.index()].choose_target_player(activator, &options, Some(sa))
}

/// `AtEOT$ <action>` — delayed-trigger action token.
/// Mirrors Java's `SpellAbilityEffect.registerDelayedTrigger` `location` arg.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum_macros::EnumString, Default)]
#[strum(ascii_case_insensitive)]
pub enum AtEotAction {
    /// Owner sacrifices the remembered card (Controller$ You).
    #[default]
    Sacrifice,
    /// Controller sacrifices (no Controller$ override).
    SacrificeCtrl,
    Destroy,
    Exile,
    Hand,
    Library,
}

impl AtEotAction {
    /// SVar payload registered on the delayed trigger.
    pub fn execute_svar(self) -> &'static str {
        match self {
            AtEotAction::Sacrifice => {
                "DB$ SacrificeAll | Defined$ DelayTriggerRememberedLKI | Controller$ You"
            }
            AtEotAction::SacrificeCtrl => "DB$ SacrificeAll | Defined$ DelayTriggerRememberedLKI",
            AtEotAction::Exile => {
                "DB$ ChangeZone | Defined$ DelayTriggerRememberedLKI | Origin$ Battlefield | \
                 Destination$ Exile"
            }
            AtEotAction::Hand => {
                "DB$ ChangeZone | Defined$ DelayTriggerRememberedLKI | Origin$ Battlefield | \
                 Destination$ Hand"
            }
            AtEotAction::Library => {
                "DB$ ChangeZone | Defined$ DelayTriggerRememberedLKI | Origin$ Battlefield | \
                 Destination$ Library | Shuffle$ True"
            }
            AtEotAction::Destroy => "DB$ Destroy | Defined$ DelayTriggerRememberedLKI",
        }
    }
}

/// Register a delayed trigger that fires at end of turn and performs `action`
/// on `remembered` cards. Mirrors Java
/// `SpellAbilityEffect.registerDelayedTrigger(sa, location, iterable)`.
///
/// `action` parses via `AtEotAction::from_str` — unknown tokens default to
/// `Sacrifice` (matches Java when the call site passes an unrecognized tag).
pub fn register_at_eot(
    trigger_handler: &mut crate::trigger::handler::TriggerHandler,
    game: &crate::game::GameState,
    sa: &SpellAbility,
    action: &str,
    remembered: Vec<CardId>,
) {
    if remembered.is_empty() {
        return;
    }
    let action = action.parse::<AtEotAction>().unwrap_or_default();
    let execute_svar = action.execute_svar().to_string();
    trigger_handler.register_delayed_trigger(crate::trigger::handler::DelayedTrigger {
        mode: crate::trigger::TriggerType::Phase,
        trigger_mode: Box::new(crate::trigger::trigger_phase::TriggerPhase {
            phases: vec![forge_foundation::PhaseType::EndOfTurn],
            valid_player: None,
        }) as Box<dyn crate::trigger::TriggerBehavior>,
        params: crate::parsing::Params::default(),
        execute_svar,
        controller: sa.activating_player,
        source_card: sa.source.unwrap_or(remembered[0]),
        created_turn: game.turn.turn_number,
        created_phase: game.turn.phase,
        target_card: None,
        remembered_amount: 0,
        remembered_cards: remembered.clone(),
        remembered_players: Vec::new(),
        remembered_lki_cards: remembered,
        sort_after_active: false,
        trigger_order: None,
    });
}

pub fn add_self_trigger_at_eot(
    trigger_handler: &mut crate::trigger::handler::TriggerHandler,
    game: &mut crate::game::GameState,
    location: &str,
    card_id: CardId,
) {
    let mut player = "";
    let mut action = location;
    let mut whose = " the ";
    if let Some((prefix, suffix)) = location.split_once('_') {
        player = prefix;
        action = suffix;
        if player.eq_ignore_ascii_case("You") {
            whose = " your next ";
        }
    }

    let mut trigger_raw = format!(
        "Mode$ Phase | Phase$ End of Turn | TriggerZones$ Battlefield | TriggerDescription$ At the beginning of{}end step, {} CARDNAME.",
        whose,
        action.to_ascii_lowercase()
    );
    if !player.is_empty() {
        trigger_raw.push_str(" | Player$ ");
        trigger_raw.push_str(player);
    }

    let Some(mut trigger) = trigger_handler.parse_trigger(&trigger_raw) else {
        return;
    };

    let effect = match action {
        "Sacrifice" => "DB$ Sacrifice | SacValid$ Self",
        "Exile" => "DB$ ChangeZone | Origin$ Battlefield | Destination$ Exile | Defined$ Self",
        _ => "",
    };
    if !effect.is_empty() {
        trigger.execute = "EndOfTurnLeavePlay".to_string();
        game.card_mut(card_id)
            .set_s_var("EndOfTurnLeavePlay", effect);
    }
    game.card_mut(card_id).add_trigger(trigger);
}

/// Validate a `Duration$` param against the host card's current state.
/// Mirrors Java's `SpellAbilityEffect.checkValidDuration(String, SpellAbility)`.
///
/// Returns `true` when the duration is either absent or its prerequisites
/// (host in play, tapped, controlled by activator, ...) are still satisfied
/// at resolution time.
pub fn check_valid_duration(
    game: &GameState,
    sa: &SpellAbility,
    duration: Option<&AbilityDuration>,
) -> bool {
    let Some(duration) = duration else {
        return true;
    };
    let Some(host_id) = sa.source else {
        return true;
    };
    let host = game.card(host_id);
    let in_play_or_stack = matches!(
        host.zone,
        forge_foundation::ZoneType::Battlefield | forge_foundation::ZoneType::Stack
    );

    if duration.needs_host_in_play_or_stack() && !in_play_or_stack {
        return false;
    }
    if duration.needs_host_not_phased_out() && host.phased_out {
        return false;
    }
    if duration.needs_host_control() && host.controller != sa.activating_player {
        return false;
    }
    if duration.needs_host_tapped() && !host.tapped {
        return false;
    }
    if duration.needs_targeted_card_tapped() {
        if let Some(tgt_id) = sa.target_chosen.target_card {
            let tgt = game.card(tgt_id);
            if !tgt.tapped || tgt.phased_out {
                return false;
            }
        }
    }
    true
}

/// Set up the "replace dying" replacement effect for cards that should
/// be exiled instead of dying this turn.
///
/// Mirrors Java's `SpellAbilityEffect.replaceDying(sa)`.
pub fn replace_dying(game: &mut GameState, sa: &SpellAbility) -> Vec<CardId> {
    if sa.ir.replace_dying_defined.is_none() && sa.ir.replace_dying_valid.is_none() {
        return Vec::new();
    }

    // Check condition (currently only Kicked)
    if let Some(cond) = sa.ir.replace_dying_condition.as_ref() {
        if matches!(cond, ReplaceDyingCondition::Kicked) && !sa.kicked {
            return Vec::new();
        }
    }

    let cards = if let Some(defined) = sa.ir.replace_dying_defined_text.as_deref() {
        let cards = resolve_defined_cards_for_sa(game, sa, defined);
        if cards.is_empty() {
            return Vec::new();
        }
        cards
    } else {
        Vec::new()
    };

    let effect_name = sa
        .source
        .map(|source_id| format!("{}'s Effect", game.card(source_id).card_name))
        .unwrap_or_else(|| "Effect".to_string());
    let effect_id = create_effect(game, sa, &effect_name, "");
    {
        let effect = game.card_mut(effect_id);
        effect.add_remembered_cards(cards.iter().copied());
        effect.set_forget_on_moved_origin(Some(forge_foundation::ZoneType::Battlefield));
        effect.set_exile_when_no_remembered(true);
        effect.set_temp_effect_until_eot(true);
    }

    let valid = sa
        .ir
        .replace_dying_valid
        .as_deref()
        .unwrap_or("Card.IsRemembered");
    let zone = sa.ir.replace_dying_zone_text.as_deref().unwrap_or("Exile");
    let mut replacement_raw = format!(
        "R$ Event$ Moved | ValidLKI$ {} | Origin$ Battlefield | Destination$ Graveyard | NewDestination$ {} | Description$ If that permanent would die this turn, exile it instead.",
        valid, zone
    );
    if sa.ir.replace_dying_exiled_with {
        replacement_raw.push_str(" | ExiledWithEffectSource$ True");
    }

    let effect = game.card_mut(effect_id);
    add_replacement_effect(effect, &replacement_raw);

    cards
}
