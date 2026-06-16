//! AbilityUtils — utility functions for ability resolution.
//!
//! Mirrors Java's `AbilityUtils.java`.
//! This is the single source of truth for helper functions used across effects.
//! The `effects::helpers` module re-exports everything from here for backward
//! compatibility.

use forge_foundation::{ColorSet, ZoneType};

use crate::ability::AbilityKey;
use crate::card::filter_constants as fc;
use crate::card::{valid_filter, Card, CounterType};
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::parsing::{cached_compiled_selector, CompiledSelector};
use crate::spellability::SpellAbility;

fn push_unique_player(players: &mut Vec<PlayerId>, player: PlayerId) {
    if !players.contains(&player) {
        players.push(player);
    }
}

fn targeted_spell_abilities(sa: &SpellAbility, game: &GameState) -> Vec<SpellAbility> {
    let mut spells = Vec::new();
    if let Some(stack_id) = sa.target_chosen.target_stack_entry {
        if let Some(entry) = game.stack.find_by_id(stack_id) {
            unique_push_spell(&mut spells, entry.spell_ability.clone());
        }
    }
    spells
}

fn targeted_controller_players(sa: &SpellAbility, game: &GameState) -> Vec<PlayerId> {
    let mut players = Vec::new();
    if let Some(cid) = sa.target_chosen.target_card {
        push_unique_player(&mut players, game.card(cid).controller);
    }
    for spell in targeted_spell_abilities(sa, game) {
        push_unique_player(&mut players, spell.activating_player);
    }
    players
}

fn targeted_owner_players(sa: &SpellAbility, game: &GameState) -> Vec<PlayerId> {
    let mut players = Vec::new();
    if let Some(cid) = sa.target_chosen.target_card {
        push_unique_player(&mut players, game.card(cid).owner);
    }
    for spell in targeted_spell_abilities(sa, game) {
        if let Some(source) = spell.source {
            push_unique_player(&mut players, game.card(source).owner);
        }
    }
    players
}

fn add_players_from_remembered(
    players: &mut Vec<PlayerId>,
    game: &GameState,
    card_id: CardId,
    def: &str,
    skip_remembered: bool,
) {
    let remembered_players = game.card(card_id).remembered_players.clone();
    for player in remembered_players {
        if def.ends_with("Opponents") {
            push_unique_player(players, game.opponent_of(player));
        } else {
            push_unique_player(players, player);
        }
    }

    let remembered_cards = game.card(card_id).remembered_cards.clone();
    for remembered_card in remembered_cards {
        if def.ends_with("Controller") {
            push_unique_player(players, game.card(remembered_card).controller);
        } else if def.ends_with("Owner") {
            push_unique_player(players, game.card(remembered_card).owner);
        } else if def.ends_with("Remembered") && !skip_remembered {
            add_players_from_remembered(players, game, remembered_card, def, true);
        }
    }
}

fn remembered_players_for_def(def: &str, sa: &SpellAbility, game: &GameState) -> Vec<PlayerId> {
    let mut players = Vec::new();
    if let Some(source) = sa.source {
        add_players_from_remembered(&mut players, game, source, def, false);
    }
    players
}

fn unique_push_spell(spells: &mut Vec<SpellAbility>, spell: SpellAbility) {
    let spell_source = spell.source;
    let spell_api = spell.api;
    let spell_text = spell.ability_text.clone();
    let spell_target = spell.target_chosen.target_stack_entry;
    if spells.iter().any(|existing| {
        existing.source == spell_source
            && existing.api == spell_api
            && existing.ability_text == spell_text
            && existing.target_chosen.target_stack_entry == spell_target
    }) {
        return;
    }
    spells.push(spell);
}

// ── Defined$ Card Resolution ─────────────────────────────────────────

/// Static (non-prefix) `Defined$` tokens that refer to a set of cards.
/// Prefix-based tokens (`Triggered*`, `ValidGraveyard <filter>`, ...) stay as
/// separate branches below since strum can't match open-ended suffixes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum_macros::EnumString)]
#[strum(ascii_case_insensitive)]
pub enum DefinedCardToken {
    #[strum(serialize = "Self", serialize = "CARDNAME")]
    SelfCard,
    Remembered,
    #[strum(
        serialize = "Enchanted",
        serialize = "Equipped",
        serialize = "AttachedTo"
    )]
    Attached,
    EnchantedBy,
    Imprinted,
    #[strum(serialize = "TopOfLibrary", serialize = "OfLibrary")]
    TopOfLibrary,
    TopOfGraveyard,
    Tapped,
    Untapped,
}

/// Resolve `Defined$` strings to a list of card IDs.
/// Mirrors Java's `AbilityUtils.getDefinedCards()`.
pub fn get_defined_cards(
    game: &GameState,
    host_card: Option<CardId>,
    defined: &str,
    activating_player: Option<PlayerId>,
) -> Vec<CardId> {
    if let Ok(token) = defined.parse::<DefinedCardToken>() {
        return resolve_defined_card_token(token, game, host_card, activating_player);
    }
    // Prefix-based tokens.
    if let Some(rest) = defined.strip_prefix("ValidGraveyard") {
        let filter = rest.trim();
        let player = activating_player.unwrap_or_else(|| {
            host_card
                .map(|c| game.card(c).controller)
                .unwrap_or(PlayerId(0))
        });
        return game
            .cards_in_zone(ZoneType::Graveyard, player)
            .iter()
            .copied()
            .filter(|&cid| {
                if filter.is_empty() {
                    true
                } else if let Some(source_id) = host_card {
                    matches_valid_cards_for_source(game, source_id, game.card(cid), None, filter)
                } else {
                    matches_valid_cards(game.card(cid), filter, player)
                }
            })
            .collect();
    }
    // `Discarded` / `Sacrificed` live on the SA (`discarded_cost_cards` +
    // per-cost paid slots), not the host card, so they're resolved by the
    // SA-aware path `spell_ability_effect::resolve_defined_cards_for_sa`.
    Vec::new()
}

fn resolve_defined_card_token(
    token: DefinedCardToken,
    game: &GameState,
    host_card: Option<CardId>,
    activating_player: Option<PlayerId>,
) -> Vec<CardId> {
    match token {
        DefinedCardToken::SelfCard => host_card.into_iter().collect(),
        DefinedCardToken::Remembered => host_card
            .map(|src| game.card(src).remembered_cards.clone())
            .unwrap_or_default(),
        DefinedCardToken::Attached => host_card
            .and_then(|src| game.card(src).attached_to)
            .into_iter()
            .collect(),
        DefinedCardToken::EnchantedBy => host_card
            .into_iter()
            .flat_map(|src| {
                game.cards
                    .iter()
                    .filter_map(move |c| {
                        (c.attached_to == Some(src) && c.type_line.has_subtype("Aura"))
                            .then_some(c.id)
                    })
                    .collect::<Vec<_>>()
            })
            .collect(),
        DefinedCardToken::Imprinted => host_card
            .map(|src| game.card(src).imprinted_cards.clone())
            .unwrap_or_default(),
        DefinedCardToken::TopOfLibrary => activating_player
            .and_then(|pid| game.cards_in_zone(ZoneType::Library, pid).last().copied())
            .into_iter()
            .collect(),
        DefinedCardToken::TopOfGraveyard => activating_player
            .and_then(|pid| game.cards_in_zone(ZoneType::Graveyard, pid).last().copied())
            .into_iter()
            .collect(),
        DefinedCardToken::Tapped => activating_player
            .map(|pid| filter_battlefield(game, pid, |c| c.tapped))
            .unwrap_or_default(),
        DefinedCardToken::Untapped => activating_player
            .map(|pid| filter_battlefield(game, pid, |c| !c.tapped))
            .unwrap_or_default(),
    }
}

/// Return battlefield cards matching `pred`, for every player in turn order.
/// Helper for `Tapped` / `Untapped` defined tokens.
fn filter_battlefield(
    game: &GameState,
    _starter: PlayerId,
    pred: impl Fn(&Card) -> bool,
) -> Vec<CardId> {
    let mut out = Vec::new();
    for &pid in &game.player_order {
        for &cid in game.cards_in_zone(ZoneType::Battlefield, pid) {
            if pred(game.card(cid)) {
                out.push(cid);
            }
        }
    }
    out
}

/// Resolve `Defined$` strings to a list of player IDs.
/// Mirrors Java's `AbilityUtils.getDefinedPlayers()`.
pub fn get_defined_players(
    game: &GameState,
    _host_card: Option<CardId>,
    defined: &str,
    activating_player: Option<PlayerId>,
) -> Vec<PlayerId> {
    if let Some(player) = activating_player {
        resolve_defined_players(defined, player, game)
    } else {
        Vec::new()
    }
}

/// Calculate a numeric amount from a parameter string.
/// Handles simple integers and "X" references.
///
/// For the full implementation with SVar support, use
/// `svar::resolve_numeric_svar()`.
pub fn calculate_amount(value: &str) -> i32 {
    value.parse::<i32>().unwrap_or(0)
}

// ── Parameter Parsing ────────────────────────────────────────────────

/// Parse a numeric parameter from an ability string (e.g. "NumAtt$ 3" → 3).
pub fn parse_param(ability: &str, prefix: &str) -> Option<i32> {
    for part in ability.split('|') {
        let part = part.trim();
        if let Some(val) = part.strip_prefix(prefix) {
            if let Ok(n) = val.trim().parse::<i32>() {
                return Some(n);
            }
        }
    }
    None
}

/// Parse NumDmg$ value from an ability string.
pub fn parse_num_dmg(ability: &str) -> i32 {
    parse_param(ability, "NumDmg$ ").unwrap_or(0)
}

// ── Defined$ Player Resolution ───────────────────────────────────────

/// Resolve a Defined$ parameter to a player ID.
/// Mirrors Java's AbilityUtils.getDefinedPlayers().
///
/// Handles both bare names ("Opponent") and prefixed forms ("Player.Opponent")
/// used by cards like Guttersnipe: `Defined$ Player.Opponent`.
/// Static (non-prefix) `Defined$` tokens that point at a single player.
/// Does not include SA-context tokens (`Remembered`, `TriggeredPlayer`, etc.)
/// — those live in `resolve_defined_player_with_sa`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum_macros::EnumString)]
#[strum(ascii_case_insensitive)]
pub enum DefinedPlayerToken {
    You,
    #[strum(serialize = "Opponent", serialize = "OpponentCtrl")]
    Opponent,
    #[strum(
        serialize = "DefendingPlayer",
        serialize = "TriggeredDefendingPlayer",
        serialize = "TriggeredDefender"
    )]
    DefendingPlayer,
}

pub fn resolve_defined_player(
    defined: &str,
    controller: PlayerId,
    game: &GameState,
) -> Option<PlayerId> {
    // Strip "Player." prefix if present (e.g. "Player.Opponent" → "Opponent")
    let key = defined.strip_prefix("Player.").unwrap_or(defined);
    let token = key.parse::<DefinedPlayerToken>().ok()?;
    Some(match token {
        DefinedPlayerToken::You => controller,
        DefinedPlayerToken::Opponent | DefinedPlayerToken::DefendingPlayer => {
            game.opponent_of(controller)
        }
    })
}

/// Resolve a Defined$ parameter to a player ID with spell/trigger context.
/// Mirrors Java's Triggered* player resolution for trigger SVar chains.
pub fn resolve_defined_player_with_sa(
    defined: &str,
    sa: &SpellAbility,
    controller: PlayerId,
    game: &GameState,
) -> Option<PlayerId> {
    fn parse_player_object(sa: &SpellAbility, key: AbilityKey) -> Option<PlayerId> {
        sa.get_triggering_players(key).into_iter().next()
    }

    fn triggered_controller(
        sa: &SpellAbility,
        game: &GameState,
        key: AbilityKey,
    ) -> Option<PlayerId> {
        // Try card parsing first — trigger object values are typically CardIds,
        // and parse_player_object would misinterpret a CardId as a PlayerId.
        sa.get_triggering_cards(key)
            .into_iter()
            .next()
            .map(|cid| game.card(cid).controller)
            .or_else(|| parse_player_object(sa, key))
    }

    fn triggered_owner(sa: &SpellAbility, game: &GameState, key: AbilityKey) -> Option<PlayerId> {
        sa.get_triggering_cards(key)
            .into_iter()
            .next()
            .map(|cid| game.card(cid).owner)
    }

    let key = defined.strip_prefix("Player.").unwrap_or(defined);
    if let Some(rest) = key.strip_prefix("Non") {
        return game.alive_players().into_iter().find(|pid| {
            !resolve_defined_players_with_sa(rest, sa, controller, game).contains(pid)
        });
    }
    match key {
        _ if key.starts_with("Remembered") => {
            remembered_players_for_def(key, sa, game).into_iter().next()
        }
        "TriggeredPlayer" | "Targeted" | "TargetedPlayer" => sa
            .target_chosen
            .all_target_players()
            .into_iter()
            .next()
            .or_else(|| parse_player_object(sa, AbilityKey::Player)),
        "ParentTarget" => sa.target_chosen.all_target_players().into_iter().next(),
        "ThisTargetedPlayer" => sa.target_chosen.all_target_players().into_iter().next(),
        "TargetedOrController" => sa
            .target_chosen
            .all_target_players()
            .into_iter()
            .next()
            .or_else(|| targeted_controller_players(sa, game).into_iter().next()),
        "TriggeredTarget" | "TriggeredTargets" => {
            if let Some(player) = parse_player_object(sa, AbilityKey::TargetPlayer) {
                Some(player)
            } else if let Some(card) = sa
                .get_triggering_cards(AbilityKey::TargetCard)
                .into_iter()
                .next()
            {
                Some(game.card(card).controller)
            } else {
                // "Target" is ambiguous — it holds either a CardId or a PlayerId.
                // Try cards first to avoid misinterpreting a CardId as a PlayerId.
                sa.get_triggering_cards(AbilityKey::Target)
                    .into_iter()
                    .next()
                    .map(|cid| game.card(cid).controller)
                    .or_else(|| parse_player_object(sa, AbilityKey::Target))
            }
        }
        "TriggeredTargetController" | "TriggeredTargetsController" => {
            if let Some(card) = sa
                .get_triggering_cards(AbilityKey::TargetCard)
                .into_iter()
                .next()
            {
                Some(game.card(card).controller)
            } else if let Some(player) = parse_player_object(sa, AbilityKey::TargetPlayer) {
                Some(player)
            } else {
                sa.get_triggering_cards(AbilityKey::Target)
                    .into_iter()
                    .next()
                    .map(|cid| game.card(cid).controller)
                    .or_else(|| parse_player_object(sa, AbilityKey::Target))
            }
        }
        "TriggeredAttackedTarget" => parse_player_object(sa, AbilityKey::AttackedTarget),
        "TriggeredDefender" => parse_player_object(sa, AbilityKey::Defender)
            .or_else(|| parse_player_object(sa, AbilityKey::AttackedTarget))
            .or_else(|| parse_player_object(sa, AbilityKey::DefendingPlayer)),
        "TriggeredAttackingPlayer" => parse_player_object(sa, AbilityKey::AttackingPlayer),
        "TriggeredActivator" => parse_player_object(sa, AbilityKey::Activator),
        "TriggeredOpponentVotedDiff" => parse_player_object(sa, AbilityKey::OpponentVotedDiff),
        "TriggeredOpponentVotedSame" => parse_player_object(sa, AbilityKey::OpponentVotedSame),
        "TriggeredCardController" => triggered_controller(sa, game, AbilityKey::Card),
        "TriggeredCardOwner" => triggered_owner(sa, game, AbilityKey::Card),
        "ReplacedCardController" => triggered_controller(sa, game, AbilityKey::ReplacedCard)
            .or_else(|| triggered_controller(sa, game, AbilityKey::Card)),
        "ReplacedCardOwner" => triggered_owner(sa, game, AbilityKey::ReplacedCard)
            .or_else(|| triggered_owner(sa, game, AbilityKey::Card)),
        "TriggeredSourceController" => triggered_controller(sa, game, AbilityKey::Source),
        "TriggeredSourceSAController" => sa
            .get_triggering_spell_ability("SourceSA")
            .map(|cause_sa| cause_sa.activating_player),
        "TriggeredPlayerController" => triggered_controller(sa, game, AbilityKey::Player),
        "DefendingPlayer" | "TriggeredDefendingPlayer" => sa
            .target_chosen
            .target_player
            .or_else(|| Some(game.opponent_of(controller))),
        "TriggeredController" => sa
            .trigger_source
            .map(|cid| game.card(cid).controller)
            .or(sa.target_chosen.target_player),
        "TargetedController" | "ThisTargetedController" | "ParentTargetedController" => {
            targeted_controller_players(sa, game).into_iter().next()
        }
        "TargetedOwner" | "ThisTargetedOwner" => {
            targeted_owner_players(sa, game).into_iter().next()
        }
        _ => resolve_defined_player(key, controller, game),
    }
}

/// Resolve a Defined$ parameter to a list of player IDs with spell/trigger context.
pub fn resolve_defined_players_with_sa(
    defined: &str,
    sa: &SpellAbility,
    controller: PlayerId,
    game: &GameState,
) -> Vec<PlayerId> {
    let key = defined.strip_prefix("Player.").unwrap_or(defined);
    if key.contains(" & ") {
        let mut players = Vec::new();
        for part in key
            .split(" & ")
            .map(str::trim)
            .filter(|part| !part.is_empty())
        {
            for pid in resolve_defined_players_with_sa(part, sa, controller, game) {
                push_unique_player(&mut players, pid);
            }
        }
        return players;
    }
    if let Some(rest) = key.strip_prefix("Non") {
        let excluded = resolve_defined_players_with_sa(rest, sa, controller, game);
        return game
            .alive_players()
            .into_iter()
            .filter(|pid| !excluded.contains(pid))
            .collect();
    }
    match key {
        "Player" | "Players" => game.alive_players(),
        // Player payload of a delayed trigger's remembered objects (e.g. Arcane
        // Denial's `RememberObjects$ RememberedController` records the
        // controller of the countered spell at registration; the spawned
        // delayed-trigger SA reads it here via `Defined$ DelayTriggerRemembered`).
        "DelayTriggerRemembered" | "TriggerRemembered" => {
            let mut players = Vec::new();
            for value in &sa.trigger_remembered {
                match value {
                    crate::event::AbilityValue::Player(pid) => {
                        push_unique_player(&mut players, *pid)
                    }
                    crate::event::AbilityValue::Players(list) => {
                        for pid in list {
                            push_unique_player(&mut players, *pid);
                        }
                    }
                    _ => {}
                }
            }
            players
        }
        _ if key.starts_with("Remembered") => remembered_players_for_def(key, sa, game),
        "TriggeredPlayer" | "Targeted" | "TargetedPlayer" => {
            let mut players = Vec::new();
            for player in sa.target_chosen.all_target_players() {
                push_unique_player(&mut players, player);
            }
            for player in sa.get_triggering_players(AbilityKey::Player) {
                push_unique_player(&mut players, player);
            }
            players
        }
        "ParentTarget" => sa.target_chosen.all_target_players(),
        "ThisTargetedPlayer" => sa.target_chosen.all_target_players(),
        "TargetedOrController" => {
            let mut players = sa.target_chosen.all_target_players();
            for player in targeted_controller_players(sa, game) {
                push_unique_player(&mut players, player);
            }
            players
        }
        "TargetedController" | "ThisTargetedController" | "ParentTargetedController" => {
            targeted_controller_players(sa, game)
        }
        "TargetedOwner" | "ThisTargetedOwner" => targeted_owner_players(sa, game),
        "TriggeredTarget" | "TriggeredTargets" => {
            let mut players = Vec::new();
            let target_players = sa.get_triggering_players(AbilityKey::TargetPlayer);
            let target_cards = sa.get_triggering_cards(AbilityKey::TargetCard);
            if !target_players.is_empty() {
                for player in target_players {
                    push_unique_player(&mut players, player);
                }
            } else if !target_cards.is_empty() {
                for cid in target_cards {
                    push_unique_player(&mut players, game.card(cid).controller);
                }
            } else {
                // "Target" is ambiguous — it holds either a CardId or a PlayerId.
                // Try cards first; only fall back to players if no cards matched.
                let target_cards_fallback = sa.get_triggering_cards(AbilityKey::Target);
                if !target_cards_fallback.is_empty() {
                    for cid in target_cards_fallback {
                        push_unique_player(&mut players, game.card(cid).controller);
                    }
                } else {
                    for player in sa.get_triggering_players(AbilityKey::Target) {
                        push_unique_player(&mut players, player);
                    }
                }
            }
            players
        }
        "TriggeredTargetController" | "TriggeredTargetsController" => {
            let mut players = Vec::new();
            let target_players = sa.get_triggering_players(AbilityKey::TargetPlayer);
            let target_cards = sa.get_triggering_cards(AbilityKey::TargetCard);
            if !target_cards.is_empty() {
                for cid in target_cards {
                    push_unique_player(&mut players, game.card(cid).controller);
                }
            } else if !target_players.is_empty() {
                for player in target_players {
                    push_unique_player(&mut players, player);
                }
            } else {
                // "Target" is ambiguous — try cards first, then players.
                let target_cards_fallback = sa.get_triggering_cards(AbilityKey::Target);
                if !target_cards_fallback.is_empty() {
                    for cid in target_cards_fallback {
                        push_unique_player(&mut players, game.card(cid).controller);
                    }
                } else {
                    for player in sa.get_triggering_players(AbilityKey::Target) {
                        push_unique_player(&mut players, player);
                    }
                }
            }
            players
        }
        "TriggeredAttackedTarget" => sa.get_triggering_players(AbilityKey::AttackedTarget),
        "TriggeredDefender" => {
            let mut players = sa.get_triggering_players(AbilityKey::Defender);
            for pid in sa.get_triggering_players(AbilityKey::AttackedTarget) {
                push_unique_player(&mut players, pid);
            }
            for pid in sa.get_triggering_players(AbilityKey::DefendingPlayer) {
                push_unique_player(&mut players, pid);
            }
            players
        }
        "TriggeredAttackedTargetAndYou" => {
            let mut players = sa.get_triggering_players(AbilityKey::AttackedTarget);
            push_unique_player(&mut players, controller);
            players
        }
        "TriggeredAttackingPlayer" => sa.get_triggering_players(AbilityKey::AttackingPlayer),
        "TriggeredActivator" => sa.get_triggering_players(AbilityKey::Activator),
        "TriggeredOpponentVotedDiff" => sa.get_triggering_players(AbilityKey::OpponentVotedDiff),
        "TriggeredOpponentVotedSame" => sa.get_triggering_players(AbilityKey::OpponentVotedSame),
        "TriggeredCardController" => sa
            .get_triggering_cards(AbilityKey::Card)
            .into_iter()
            .map(|cid| game.card(cid).controller)
            .collect(),
        "TriggeredCardOwner" => sa
            .get_triggering_cards(AbilityKey::Card)
            .into_iter()
            .map(|cid| game.card(cid).owner)
            .collect(),
        "ReplacedCardController" => {
            let replaced = sa.get_triggering_cards(AbilityKey::ReplacedCard);
            let cards = if replaced.is_empty() {
                sa.get_triggering_cards(AbilityKey::Card)
            } else {
                replaced
            };
            cards
                .into_iter()
                .map(|cid| game.card(cid).controller)
                .collect()
        }
        "ReplacedCardOwner" => {
            let replaced = sa.get_triggering_cards(AbilityKey::ReplacedCard);
            let cards = if replaced.is_empty() {
                sa.get_triggering_cards(AbilityKey::Card)
            } else {
                replaced
            };
            cards.into_iter().map(|cid| game.card(cid).owner).collect()
        }
        "TriggeredSourceController" => sa
            .get_triggering_cards(AbilityKey::Source)
            .into_iter()
            .map(|cid| game.card(cid).controller)
            .collect(),
        "TriggeredSourceSAController" => sa
            .get_triggering_spell_ability("SourceSA")
            .map(|cause_sa| vec![cause_sa.activating_player])
            .unwrap_or_default(),
        "TriggeredPlayerController" => {
            let mut players = sa.get_triggering_players(AbilityKey::Player);
            for cid in sa.get_triggering_cards(AbilityKey::Player) {
                push_unique_player(&mut players, game.card(cid).controller);
            }
            players
        }
        "DefendingPlayer" | "TriggeredDefendingPlayer" => {
            let mut players: Vec<_> = sa.target_chosen.target_player.into_iter().collect();
            let defending = game.opponent_of(controller);
            push_unique_player(&mut players, defending);
            players
        }
        _ => resolve_defined_players(key, controller, game),
    }
}

/// Resolve a `Defined$` parameter to spell abilities.
/// Mirrors Java `AbilityUtils.getDefinedSpellAbilities(Card, String, CardTraitBase)`
/// (AbilityUtils.java:1202).
pub fn get_defined_spell_abilities(
    defined: &str,
    sa: &SpellAbility,
    game: &GameState,
) -> Vec<SpellAbility> {
    let key = defined.trim();
    let mut spells = Vec::new();

    match key {
        // Self — the SA itself (Java L1214).
        "Self" => unique_push_spell(&mut spells, sa.clone()),

        // Parent — the root of the sub-ability chain (Java L1216).
        // The Rust engine doesn't thread a back-pointer to the parent, so the
        // best-effort resolution returns `sa` itself (root == current for
        // non-nested calls). Nested sub-ability nodes that need the root must
        // carry `parent_target_card` through `EffectContext` (already done for
        // targets); proper Parent-SA threading is deferred until SAs own a
        // parent handle.
        "Parent" => unique_push_spell(&mut spells, sa.clone()),

        // Remembered — cards remembered by the host contribute their SAs; any
        // SpellAbility objects directly in the remembered list are added too.
        // The Rust `Card::remembered_cards` only stores CardIds, so the "spell
        // ability remembered" branch is unreachable here (Java L1222–L1226).
        "Remembered" => {
            if let Some(host_id) = sa.source {
                let remembered = game.card(host_id).remembered_cards.clone();
                for cid in remembered {
                    for ab_text in game.card(cid).abilities.iter() {
                        let built = crate::spellability::build_spell_ability_from_host_card(
                            game.card(cid),
                            ab_text,
                            sa.activating_player,
                        );
                        unique_push_spell(&mut spells, built);
                    }
                }
            }
        }

        // Imprinted — mirrors Java L1227–L1230.
        "Imprinted" => {
            if let Some(host_id) = sa.source {
                let imprinted = game.card(host_id).imprinted_cards.clone();
                for cid in imprinted {
                    for ab_text in game.card(cid).abilities.iter() {
                        let built = crate::spellability::build_spell_ability_from_host_card(
                            game.card(cid),
                            ab_text,
                            sa.activating_player,
                        );
                        unique_push_spell(&mut spells, built);
                    }
                }
            }
        }

        // EffectSource — the SA that created an effect card (Java L1231–L1234).
        // Tracked via `Card::effect_source`; best we can do without
        // `Card::effect_source_ability` is project to the first ability on the
        // source card — matches Java behavior when the source has exactly one
        // SA, which is the common case for command-zone effects.
        "EffectSource" => {
            if let Some(host_id) = sa.source {
                if let Some(effect_src) = game.card(host_id).effect_source {
                    let src_card = game.card(effect_src);
                    if let Some(ab_text) = src_card.abilities.first() {
                        let built = crate::spellability::build_spell_ability_from_host_card(
                            src_card,
                            ab_text,
                            sa.activating_player,
                        );
                        unique_push_spell(&mut spells, built);
                    }
                }
            }
        }

        // SourceFirstSpell — stack entry whose host matches this SA's source
        // (Java L1235–L1239).
        "SourceFirstSpell" => {
            if let Some(host_id) = sa.source {
                if let Some(entry) = game
                    .stack
                    .iter()
                    .find(|e| e.spell_ability.source == Some(host_id))
                {
                    unique_push_spell(&mut spells, entry.spell_ability.clone());
                }
            }
        }

        "TriggeredSpellAbility" => {
            for trigger_key in ["SpellAbility", "SourceSA", "Cause", "AbilityMana"] {
                if let Some(spell) = sa.get_triggering_spell_ability(trigger_key) {
                    unique_push_spell(&mut spells, spell.clone());
                }
            }
        }
        "SpellTargeted" | "ThisTargeted" => {
            if let Some(stack_id) = sa.target_chosen.target_stack_entry {
                if let Some(entry) = game.stack.find_by_id(stack_id) {
                    unique_push_spell(&mut spells, entry.spell_ability.clone());
                }
            }
        }
        "SourceSA" | "SpellAbility" | "AbilityMana" | "Cause" | "StackSa" => {
            if let Some(spell) = sa.get_triggering_spell_ability(key) {
                unique_push_spell(&mut spells, spell.clone());
            }
        }
        "TopStack" => {
            if let Some(spell) = game.stack.peek_ability() {
                unique_push_spell(&mut spells, spell.clone());
            }
        }
        _ => {
            // Triggered<Key> — pull a SpellAbility from the triggering-objects
            // map by AbilityKey name (Java L1240–L1247).
            if let Some(trigger_key) = key.strip_prefix("Triggered") {
                if let Some(spell) = sa.get_triggering_spell_ability(trigger_key) {
                    unique_push_spell(&mut spells, spell.clone());
                }
            }
        }
    }

    spells
}

/// Resolve a Defined$ parameter to a list of player IDs.
/// Supports "You", "Opponent", "Each"/"All"/"Player" (all alive players).
/// Mirrors Java's AbilityUtils.getDefinedPlayers() for multi-player resolution.
pub fn resolve_defined_players(
    defined: &str,
    controller: PlayerId,
    game: &GameState,
) -> Vec<PlayerId> {
    if defined.contains(" & ") {
        let mut players = Vec::new();
        for part in defined
            .split(" & ")
            .map(str::trim)
            .filter(|part| !part.is_empty())
        {
            for pid in resolve_defined_players(part, controller, game) {
                if !players.contains(&pid) {
                    players.push(pid);
                }
            }
        }
        return players;
    }
    if let Some(rest) = defined.strip_prefix("Non") {
        let excluded = resolve_defined_players(rest, controller, game);
        return game
            .alive_players()
            .into_iter()
            .filter(|pid| !excluded.contains(pid))
            .collect();
    }
    match defined {
        "You" => vec![controller],
        "Opponent" | "OpponentCtrl" => vec![game.opponent_of(controller)],
        "DefendingPlayer" | "TriggeredDefendingPlayer" | "TriggeredDefender" => {
            vec![game.opponent_of(controller)]
        }
        "Each" | "All" | "Player" => game.alive_players(),
        _ => {
            // Fall back to single-player resolution
            if let Some(pid) = resolve_defined_player(defined, controller, game) {
                vec![pid]
            } else {
                vec![controller]
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use forge_foundation::{CardTypeLine, ColorSet, ManaCost};

    use crate::card::Card;
    use crate::ids::{CardId, PlayerId};

    fn make_card(
        game: &mut GameState,
        owner: PlayerId,
        controller: PlayerId,
        name: &str,
    ) -> CardId {
        let mut card = Card::new(
            CardId(0),
            name.to_string(),
            owner,
            CardTypeLine::parse("Creature"),
            ManaCost::parse("1"),
            ColorSet::COLORLESS,
            Some(1),
            Some(1),
            vec![],
            vec![],
        );
        card.controller = controller;
        game.create_card(card)
    }

    #[test]
    fn targeted_controller_ignores_player_targets() {
        let game = GameState::new(&["P0", "P1"], 20);
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);

        let mut sa = SpellAbility::new_simple(None, p0, "DB$ Discard");
        sa.target_chosen.target_player = Some(p1);

        assert_eq!(
            resolve_defined_player_with_sa("TargetedController", &sa, p0, &game),
            None
        );
        assert!(resolve_defined_players_with_sa("TargetedController", &sa, p0, &game).is_empty());
        assert_eq!(
            resolve_defined_players_with_sa("TargetedOrController", &sa, p0, &game),
            vec![p1]
        );
    }

    #[test]
    fn targeted_controller_and_owner_use_targeted_card_only() {
        let mut game = GameState::new(&["P0", "P1"], 20);
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);
        let target = make_card(&mut game, p0, p1, "Borrowed Bear");

        let mut sa = SpellAbility::new_simple(None, p0, "DB$ Draw");
        sa.target_chosen.target_card = Some(target);

        assert_eq!(
            resolve_defined_player_with_sa("TargetedController", &sa, p0, &game),
            Some(p1)
        );
        assert_eq!(
            resolve_defined_player_with_sa("TargetedOwner", &sa, p0, &game),
            Some(p0)
        );
        assert_eq!(
            resolve_defined_players_with_sa("TargetedController", &sa, p0, &game),
            vec![p1]
        );
        assert_eq!(
            resolve_defined_players_with_sa("TargetedOwner", &sa, p0, &game),
            vec![p0]
        );
    }

    #[test]
    fn this_targeted_player_stays_on_current_sa_targets() {
        let game = GameState::new(&["P0", "P1"], 20);
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);

        let mut sa = SpellAbility::new_simple(None, p0, "DB$ Token");
        sa.target_chosen.target_player = Some(p1);

        assert_eq!(
            resolve_defined_players_with_sa("ThisTargetedPlayer", &sa, p0, &game),
            vec![p1]
        );
    }
}

// ── Counter Type Parsing ─────────────────────────────────────────────

/// Parse a counter type string to CounterType enum (case-insensitive).
/// Unknown types produce `CounterType::Named(UPPER)` instead of silently
/// falling back to P1P1, so cards like Stocking the Pantry get the correct
/// SUPPLY counters.
pub fn parse_counter_type(s: &str) -> CounterType {
    crate::card::counter_type::parse_counter_type(s)
}

// ── Zone Type Parsing ────────────────────────────────────────────────

/// Parse a zone name string to ZoneType.
pub fn parse_zone_type(s: &str) -> Option<ZoneType> {
    let s = s.trim();
    if s.eq_ignore_ascii_case("Deck") {
        Some(ZoneType::Library)
    } else {
        ZoneType::from_str_compat(s)
    }
}

// ── ValidCards$ Matching ─────────────────────────────────────────────

/// Full ValidCards$ filter matching with controller and keyword qualifier support.
///
/// This is the preferred function for mass effects (DestroyAll, DamageAll, etc.)
/// because it handles `YouCtrl`, `OppCtrl`, `withFlying` / `withoutFlying`,
/// and color (`nonBlack`)
/// qualifiers in addition to card types.
///
/// `activating_player` is the player who cast/activated the ability; used to
/// resolve `YouCtrl` / `OppCtrl` qualifiers.
///
/// Mirrors Java's `CardLists.getValidCards()` + `CardProperty.cardHasProperty()`.
pub fn matches_valid_cards(card: &Card, filter: &str, activating_player: PlayerId) -> bool {
    if filter.is_empty() || filter == fc::CARD {
        return true;
    }

    // Comma-separated = OR conditions (e.g. "Creature.attacking Opponent, Creature.attacking Planeswalker.OppCtrl")
    if filter.contains(", ") {
        return filter
            .split(", ")
            .any(|part| matches_valid_cards_single(card, part.trim(), activating_player));
    }

    matches_valid_cards_single(card, filter, activating_player)
}

pub fn matches_valid_cards_selector_opt(
    selector: Option<&CompiledSelector>,
    card: &Card,
    activating_player: PlayerId,
) -> bool {
    selector.is_none_or(|selector| {
        selector.alternatives.iter().any(|alternative| {
            matches_valid_cards_single(card, &alternative.raw, activating_player)
        })
    })
}

pub fn matches_valid_cards_for_sa(
    game: &GameState,
    sa: &SpellAbility,
    card: &Card,
    selector: Option<&CompiledSelector>,
    default_filter: &str,
) -> bool {
    match (selector, sa.source) {
        (Some(selector), Some(source_id)) => valid_filter::matches_valid_card_selector_in_game(
            selector,
            card,
            game.card(source_id),
            game,
        ),
        (Some(selector), None) => {
            matches_valid_cards_selector_opt(Some(selector), card, sa.activating_player)
        }
        (None, Some(source_id)) => valid_filter::matches_valid_card_selector_in_game(
            &cached_compiled_selector(default_filter),
            card,
            game.card(source_id),
            game,
        ),
        (None, None) => matches_valid_cards(card, default_filter, sa.activating_player),
    }
}

pub fn matches_valid_cards_for_source(
    game: &GameState,
    source_id: CardId,
    card: &Card,
    selector: Option<&CompiledSelector>,
    default_filter: &str,
) -> bool {
    let source = game.card(source_id);
    let parsed;
    let selector = match selector {
        Some(selector) => selector,
        None => {
            parsed = cached_compiled_selector(default_filter);
            &parsed
        }
    };
    valid_filter::matches_valid_card_selector_in_game(selector, card, source, game)
}

fn matches_valid_cards_single(card: &Card, filter: &str, activating_player: PlayerId) -> bool {
    let parts: Vec<&str> = filter.split('.').collect();
    let type_part = parts[0];

    // ── Type check ──────────────────────────────────────────────────────────
    let type_matches = match type_part {
        fc::CREATURE => card.is_creature(),
        fc::LAND => card.is_land(),
        fc::ARTIFACT => card
            .type_line
            .core_types
            .iter()
            .any(|t| t.name().eq_ignore_ascii_case(fc::ARTIFACT)),
        fc::ENCHANTMENT => card
            .type_line
            .core_types
            .iter()
            .any(|t| t.name().eq_ignore_ascii_case(fc::ENCHANTMENT)),
        fc::PLANESWALKER => card
            .type_line
            .core_types
            .iter()
            .any(|t| t.name().eq_ignore_ascii_case(fc::PLANESWALKER)),
        fc::INSTANT => card
            .type_line
            .core_types
            .iter()
            .any(|t| t.name().eq_ignore_ascii_case(fc::INSTANT)),
        fc::SORCERY => card
            .type_line
            .core_types
            .iter()
            .any(|t| t.name().eq_ignore_ascii_case(fc::SORCERY)),
        fc::PERMANENT | fc::CARD => true,
        _ => true, // Unknown type — match everything
    };
    if !type_matches {
        return false;
    }

    // ── Qualifier checks (dot-separated after the type) ─────────────────────
    // Handle compound "+" syntax (e.g. "YouCtrl+nonBlack", "Self+kicked")
    for &qualifier in &parts[1..] {
        let sub_parts: Vec<&str> = qualifier.split('+').collect();
        for sub in &sub_parts {
            if !matches_valid_cards_qualifier(card, sub, activating_player) {
                return false;
            }
        }
    }
    true
}

fn matches_valid_cards_qualifier(
    card: &Card,
    qualifier: &str,
    activating_player: PlayerId,
) -> bool {
    match qualifier {
        fc::YOU_CTRL => card.controller == activating_player,
        fc::OPP_CTRL => card.controller != activating_player,
        fc::BASIC => card.type_line.is_basic(),
        fc::KICKED => card.kicked,
        fc::WITH_FLYING => {
            card.keywords.contains_string_ignore_case("Flying")
                || card.granted_keywords.contains_string_ignore_case("Flying")
        }
        _ => {
            if let Some(keyword) = qualifier.strip_prefix("without") {
                return keyword.is_empty() || !card.has_keyword(keyword);
            }
            if let Some(keyword) = qualifier.strip_prefix("with") {
                return !keyword.is_empty() && card.has_keyword(keyword);
            }
            // "attacking Opponent" / "attacking Planeswalker" — space-separated combat qualifier
            if let Some(target) = qualifier.strip_prefix("attacking ") {
                let attacking = card.attacking_player;
                match target {
                    "Opponent" => match attacking {
                        Some(def) => def != activating_player,
                        None => false,
                    },
                    // "attacking Planeswalker" — only true if attacking a planeswalker (not a player).
                    // Currently combat only tracks player targets, so this is always false.
                    "Planeswalker" => false,
                    _ => attacking.is_some(), // any attack target
                }
            }
            // Type negations ("nonLand", "nonland", "nonCreature", etc.) and
            // color filters ("nonBlack", "nonRed", etc.).
            else {
                let lower = qualifier.to_ascii_lowercase();
                if let Some(rest) = lower.strip_prefix("non") {
                    match rest {
                        "land" => !card.is_land(),
                        "creature" => !card.is_creature(),
                        "artifact" => !card.type_line.is_artifact(),
                        "enchantment" => !card.type_line.is_enchantment(),
                        "planeswalker" => !card.type_line.is_planeswalker(),
                        "token" => !card.is_token,
                        "basic" => !card.type_line.is_basic(),
                        _ => {
                            let excluded = ColorSet::from_names(rest);
                            !card.color.shares_color_with(excluded)
                        }
                    }
                } else {
                    // Unknown qualifier — match everything (forward-compatible)
                    true
                }
            }
        }
    }
}

// ── ChangeType$ Matching ─────────────────────────────────────────────

/// Check if a card matches a ChangeType$ / ValidCards$ filter string.
///
/// `source_chosen_colors` should be the `chosen_colors` from the source card
/// of the spell/ability (for `ChosenColor` qualifier support). Pass `&[]` when
/// no source card context is available.
pub fn matches_change_type(
    card: &Card,
    change_type: &str,
    source_chosen_colors: &[String],
) -> bool {
    if change_type.is_empty() {
        return true;
    }

    // Handle semicolon-separated alternatives (OR).
    // E.g. "Artifact;Creature" means Artifact OR Creature.
    // Mirrors Java's CardLists.getValidCards() which splits on "," and ";".
    if change_type.contains(';') {
        return change_type
            .split(';')
            .any(|alt| matches_change_type(card, alt.trim(), source_chosen_colors));
    }

    // Handle comma-separated alternatives (OR).
    // E.g. "Artifact,Creature" means Artifact OR Creature.
    if change_type.contains(',') {
        return change_type
            .split(',')
            .any(|alt| matches_change_type(card, alt.trim(), source_chosen_colors));
    }

    // Forge separates qualifiers with '.' for the first qualifier after the
    // type and '+' for additional qualifiers (e.g. "Card.Red+Other"). Split
    // on both so every qualifier is visited individually.
    let parts: Vec<&str> = change_type.split(['.', '+']).collect();
    let type_part = parts[0];

    let type_matches = match type_part {
        fc::LAND => card.is_land(),
        fc::CREATURE => card.is_creature(),
        fc::ARTIFACT => card.type_line.is_artifact(),
        fc::ENCHANTMENT => card.type_line.is_enchantment(),
        fc::INSTANT => card.type_line.is_instant(),
        fc::SORCERY => card.type_line.is_sorcery(),
        fc::PLANESWALKER => card.type_line.is_planeswalker(),
        fc::PERMANENT => card.is_permanent(),
        fc::CARD => true,
        // Support land-subtype selectors used in tutor scripts
        // (e.g. "Forest.Basic", "Plains.Basic").
        "Plains" | "Island" | "Swamp" | "Mountain" | "Forest" => card
            .type_line
            .subtypes
            .iter()
            .any(|st| st.eq_ignore_ascii_case(type_part)),
        _ => card.has_subtype(type_part),
    };

    if !type_matches {
        return false;
    }

    for &qualifier in &parts[1..] {
        match qualifier {
            q if q.starts_with("named") => {
                let expected = q[5..].replace(';', ",").replace('_', " ");
                if !card.card_name.eq_ignore_ascii_case(&expected) {
                    return false;
                }
            }
            fc::BASIC => {
                if !card.type_line.is_basic() {
                    return false;
                }
            }
            fc::NON_LAND => {
                if card.is_land() {
                    return false;
                }
            }
            fc::ATTACKING => {
                if card.attacking_player.is_none() {
                    return false;
                }
            }
            "Red" => {
                if !card.color.has_red() {
                    return false;
                }
            }
            "White" => {
                if !card.color.has_white() {
                    return false;
                }
            }
            "Blue" => {
                if !card.color.has_blue() {
                    return false;
                }
            }
            "Black" => {
                if !card.color.has_black() {
                    return false;
                }
            }
            "Green" => {
                if !card.color.has_green() {
                    return false;
                }
            }
            "Colorless" => {
                if !card.color.is_colorless() {
                    return false;
                }
            }
            // "Other" means "other than the source" and is enforced by callers
            // that have source context; treat as a no-op here.
            "Other" => {}
            // Controller/owner qualifiers require game state that this helper
            // doesn't carry. Callers that actually need to enforce them pass
            // the correct zone + player to e.g. `cards_in_zone`, so we accept
            // them as no-ops here rather than treating them as subtypes and
            // failing every match.
            "YouCtrl" | "YouControl" | "You" | "YouOwn" | "OppCtrl" | "OpponentCtrl" | "OppOwn"
            | "OpponentOwn" | "Opponent" => {}
            // Token / nonToken qualifiers.
            "Token" => {
                if !card.is_token {
                    return false;
                }
            }
            "nonToken" => {
                if card.is_token {
                    return false;
                }
            }
            // Supertype qualifiers beyond Basic (Basic is handled above).
            "Legendary" => {
                if !card.type_line.is_legendary() {
                    return false;
                }
            }
            "nonLegendary" => {
                if card.type_line.is_legendary() {
                    return false;
                }
            }
            "Snow" => {
                if !card.type_line.is_snow() {
                    return false;
                }
            }
            "nonBasic" => {
                if card.type_line.is_basic() {
                    return false;
                }
            }
            "nonCreature" => {
                if card.is_creature() {
                    return false;
                }
            }
            "nonArtifact" => {
                if card.type_line.is_artifact() {
                    return false;
                }
            }
            "nonEnchantment" => {
                if card.type_line.is_enchantment() {
                    return false;
                }
            }
            // Generic cmc comparators:
            //   cmcEQ<N>, cmcLE<N>, cmcGE<N>, cmcLT<N>, cmcGT<N>
            // where <N> may be a literal integer or an SVar name (e.g. X, Y).
            // When <N> is a literal we enforce it. When <N> references an SVar
            // we lack context in this helper and accept as permissive (the
            // caller that resolves the SVar is responsible for filtering).
            q if q.starts_with("cmc") && q.len() > 5 => {
                let op = &q[3..5];
                let rest = &q[5..];
                let mana_value = card.mana_value();
                let pass = if let Ok(n) = rest.parse::<i32>() {
                    match op {
                        "EQ" => mana_value == n,
                        "LE" => mana_value <= n,
                        "GE" => mana_value >= n,
                        "LT" => mana_value < n,
                        "GT" => mana_value > n,
                        _ => true,
                    }
                } else {
                    true
                };
                if !pass {
                    return false;
                }
            }
            q if q.starts_with("power") && q.len() > 7 => {
                if !matches_numeric_qualifier(card.power(), &q[5..]) {
                    return false;
                }
            }
            q if q.starts_with("toughness") && q.len() > 11 => {
                if !matches_numeric_qualifier(card.toughness(), &q[9..]) {
                    return false;
                }
            }
            "ChosenColor" => {
                if source_chosen_colors.is_empty() {
                    return false;
                }
                let mut chosen_set = ColorSet::COLORLESS;
                for name in source_chosen_colors {
                    chosen_set = chosen_set.union(ColorSet::from_names(name));
                }
                if !card.color.shares_color_with(chosen_set) {
                    return false;
                }
            }
            // Fallback: treat unknown qualifiers as subtype checks. Java's
            // CardPredicates does the same — `Card.Elemental` filters by
            // the Elemental subtype. Changeling creatures are every creature
            // type, so a changeling creature passes any creature-type check.
            // Generic `non<Subtype>` is handled here so Sunderflock's
            // `Creature.nonElemental` bounce filter rejects Elementals without
            // needing an explicit arm per subtype.
            other => {
                if let Some(stripped) = other.strip_prefix("non") {
                    let is_creature_type = !stripped.is_empty();
                    if !is_creature_type {
                        return false;
                    }
                    let has_sub = card.type_line.has_subtype(stripped);
                    let changeling_match = card.is_creature() && card.has_keyword("Changeling");
                    if has_sub || changeling_match {
                        return false;
                    }
                    continue;
                }
                let has_sub = card.type_line.has_subtype(other);
                let changeling_match = card.is_creature() && card.has_keyword("Changeling");
                if !has_sub && !changeling_match {
                    return false;
                }
            }
        }
    }

    true
}

fn matches_numeric_qualifier(actual: i32, comparison: &str) -> bool {
    if comparison.len() < 3 {
        return true;
    }
    let op = &comparison[..2];
    let rest = &comparison[2..];
    if let Ok(expected) = rest.parse::<i32>() {
        match op {
            "EQ" => actual == expected,
            "LE" => actual <= expected,
            "GE" => actual >= expected,
            "LT" => actual < expected,
            "GT" => actual > expected,
            "NE" => actual != expected,
            _ => true,
        }
    } else {
        true
    }
}

// ── X-count and math helpers ────────────────────────────────────────

/// Evaluate an X-count expression on a card.
/// Mirrors Java's `AbilityUtils.xCount(Card c, String s, CardTraitBase ctb)`.
///
/// Delegates to the SVar resolution system which already handles Count$,
/// Number$, SVar$, and most sub-expressions.
pub fn x_count(game: &GameState, card_id: CardId, expr: &str, sa: &SpellAbility) -> i32 {
    let controller = game.card(card_id).controller;
    // Check for Number$ prefix
    if let Some(rest) = expr.strip_prefix("Number$") {
        let parts: Vec<&str> = rest.split('/').collect();
        let base = parts[0].trim().parse::<i32>().unwrap_or(0);
        let operators = parts.get(1).copied().unwrap_or("");
        return do_x_math(base, operators);
    }

    // Strip Count$ prefix if present
    let stripped = expr.strip_prefix("Count$").unwrap_or(expr);

    // Handle SVar$ indirection
    if let Some(svar_name) = stripped.strip_prefix("SVar$") {
        if let Some(svar_val) = game.card(card_id).get_s_var(svar_name.trim()) {
            let val = svar_val;
            return x_count(game, card_id, val, sa);
        }
        return 0;
    }

    // Delegate to the full SVar resolution system
    let full_expr = if expr.starts_with("Count$") || expr.starts_with("Number$") {
        expr.to_string()
    } else {
        format!("Count${}", expr)
    };
    crate::svar::resolve_count_svar_for_sa(&full_expr, game, card_id, controller, sa)
}

/// Apply arithmetic operators to a base value.
/// Mirrors Java's `AbilityUtils.doXMath(int num, String operators, Card c, CardTraitBase ctb)`.
///
/// Delegates to the existing `svar::do_x_math` which already implements all operators
/// (Plus, Minus, NMinus, Twice, Thrice, HalfUp, HalfDown, Negative, Times, Abs,
/// LimitMax, LimitMin, DivideEvenlyUp, DivideEvenlyDown).
pub fn do_x_math(num: i32, operators: &str) -> i32 {
    if operators.is_empty() || operators == "none" {
        return num;
    }
    // The svar module's do_x_math is private, but we replicate its logic here.
    let parts: Vec<&str> = operators.split('.').collect();
    let op = parts.first().copied().unwrap_or("");
    let secondary = parts
        .get(1)
        .and_then(|s| s.parse::<i32>().ok())
        .unwrap_or(0);

    if op.contains("Plus") {
        num + secondary
    } else if op.contains("NMinus") {
        secondary - num
    } else if op.contains("Minus") {
        num - secondary
    } else if op.contains("Twice") {
        num * 2
    } else if op.contains("Thrice") {
        num * 3
    } else if op.contains("HalfUp") {
        ((num as f64) / 2.0).ceil() as i32
    } else if op.contains("HalfDown") {
        ((num as f64) / 2.0).floor() as i32
    } else if op.contains("ThirdUp") {
        ((num as f64) / 3.0).ceil() as i32
    } else if op.contains("ThirdDown") {
        ((num as f64) / 3.0).floor() as i32
    } else if op.contains("Negative") {
        -num
    } else if op.contains("Times") {
        num * secondary
    } else if op.contains("DivideEvenlyUp") {
        if secondary == 0 {
            0
        } else {
            num / secondary + i32::from(num % secondary != 0)
        }
    } else if op.contains("DivideEvenlyDown") {
        if secondary == 0 {
            0
        } else {
            num / secondary
        }
    } else if op.contains("Abs") {
        num.abs()
    } else if op.contains("LimitMax") {
        num.min(secondary)
    } else if op.contains("LimitMin") {
        num.max(secondary)
    } else {
        num
    }
}

/// Evaluate player-based X-count expressions.
/// Mirrors Java's `AbilityUtils.playerXCount(List<Player>, String, Card, CardTraitBase)`.
///
/// Sums a property across a list of players. Common properties:
/// - `LifeTotal`, `Poison`, `CardsInHand`, `DomainCount`, etc.
pub fn player_x_count(
    game: &GameState,
    players: &[PlayerId],
    expr: &str,
    source_id: CardId,
    sa: &SpellAbility,
) -> i32 {
    let parts: Vec<&str> = expr.split('/').collect();
    let property = parts[0].trim();
    let operators = parts.get(1).copied().unwrap_or("");

    let base: i32 = players
        .iter()
        .map(|&pid| player_x_property(game, pid, property, source_id, sa))
        .sum();

    do_x_math(base, operators)
}

/// Get a numeric property for a single player.
/// Mirrors Java's `AbilityUtils.playerXProperty(Player, String, Card, CardTraitBase)`.
pub fn player_x_property(
    game: &GameState,
    player: PlayerId,
    property: &str,
    _source_id: CardId,
    _sa: &SpellAbility,
) -> i32 {
    let p = game.player(player);
    match property {
        "LifeTotal" => p.life,
        "Poison" | "PoisonCounters" => p.poison_counters,
        "CardsInHand" => game.cards_in_zone(ZoneType::Hand, player).len() as i32,
        "CardsInLibrary" => game.cards_in_zone(ZoneType::Library, player).len() as i32,
        "CardsInGraveyard" | "GraveyardSize" => {
            game.cards_in_zone(ZoneType::Graveyard, player).len() as i32
        }
        "StartingLife" => p.starting_life,
        "LandsPlayedThisTurn" => p.lands_played_this_turn,
        "DiscardedThisTurn" | "NumDiscardedThisTurn" => p.discarded_this_turn,
        "NumRollsThisTurn" | "DiceRolledThisTurn" => p.num_rolls_this_turn,
        "AttractionsVisitedThisTurn" => p.attractions_visited_this_turn,
        "DomainCount" => {
            // Count distinct basic land types among lands the player controls
            let lands = game.cards_in_zone(ZoneType::Battlefield, player);
            let mut types = std::collections::HashSet::new();
            for &cid in lands {
                let card = game.card(cid);
                if !card.is_land() {
                    continue;
                }
                for subtype in &card.type_line.subtypes {
                    let lower = subtype.to_ascii_lowercase();
                    if matches!(
                        lower.as_str(),
                        "plains" | "island" | "swamp" | "mountain" | "forest"
                    ) {
                        types.insert(lower);
                    }
                }
            }
            types.len() as i32
        }
        "NumCreaturesYouCtrl" | "CreatureCount" => game
            .cards_in_zone(ZoneType::Battlefield, player)
            .iter()
            .filter(|&&cid| game.card(cid).is_creature())
            .count() as i32,
        _ => 0,
    }
}

/// Evaluate object-based X-count expressions.
/// Mirrors Java's `AbilityUtils.objectXCount(List<?>, String, Card, CardTraitBase)`.
///
/// Counts or sums properties across a list of card IDs.
pub fn object_x_count(game: &GameState, objects: &[CardId], expr: &str) -> i32 {
    let parts: Vec<&str> = expr.split('/').collect();
    let property = parts[0].trim();
    let operators = parts.get(1).copied().unwrap_or("");

    let base: i32 = match property {
        "Amount" | "Count" => objects.len() as i32,
        "TotalPower" => objects.iter().map(|&cid| game.card(cid).power()).sum(),
        "TotalToughness" => objects.iter().map(|&cid| game.card(cid).toughness()).sum(),
        "TotalCMC" | "TotalManaValue" => {
            objects.iter().map(|&cid| game.card(cid).mana_value()).sum()
        }
        "SumPower" => objects.iter().map(|&cid| game.card(cid).power()).sum(),
        _ => objects.len() as i32,
    };

    do_x_math(base, operators)
}

// ── Remembering and Paid helpers ─────────────────────────────────────

/// Handle remembering targets/objects after a spell resolves.
/// Mirrors Java's `AbilityUtils.handleRemembering(SpellAbility)`.
///
/// If the SA has `RememberTargets$`, stores the targeted card(s) in the
/// host card's remembered_cards list.
pub fn handle_remembering(game: &mut GameState, sa: &SpellAbility) {
    let host_id = match sa.source {
        Some(id) => id,
        None => return,
    };

    if sa.ir.remember_targets && sa.uses_targeting() {
        if sa.ir.forget_other_targets {
            game.card_mut(host_id).clear_remembered();
        }
        if let Some(target_card) = sa.target_chosen.target_card {
            game.card_mut(host_id).add_remembered_card(target_card);
        }
        if let Some(target_player) = sa.target_chosen.target_player {
            game.card_mut(host_id).add_remembered_player(target_player);
        }
        // Counter-style targets: the target is a stack entry (a SpellAbility),
        // and Java's `host.addRemembered(sa.getTargets())` records the source
        // card of that ability so `RememberObjects$ RememberedController` can
        // later resolve to the original spell's controller (e.g. Arcane Denial).
        if let Some(stack_id) = sa.target_chosen.target_stack_entry {
            if let Some(entry) = game.stack.find_by_id(stack_id) {
                if let Some(source) = entry.spell_ability.source {
                    game.card_mut(host_id).add_remembered_card(source);
                }
            }
        }
    }

    // RememberCostMana — store the mana colors used to pay
    // In the Rust engine this is simplified since we don't track individual mana objects.
    // We store a count in remembered_cmc.
    if sa.ir.remember_cost_mana {
        game.card_mut(host_id).clear_remembered();
    }
}

/// Handle paid-list counting for X-count expressions.
/// Mirrors Java's `AbilityUtils.handlePaid(Iterable<Card>, String, Card, CardTraitBase)`.
///
/// Evaluates properties of cards that were paid as costs (e.g. sacrificed, discarded).
pub fn handle_paid(
    game: &GameState,
    paid_cards: &[CardId],
    property: &str,
    _source_id: CardId,
) -> i32 {
    if paid_cards.is_empty() {
        return 0;
    }

    match property {
        "Amount" | "Count" => paid_cards.len() as i32,
        "CardPower" => paid_cards
            .iter()
            .map(|&cid| {
                let card = game.card(cid);
                card.lki_power.unwrap_or_else(|| card.power())
            })
            .sum(),
        "CardBasePower" => paid_cards
            .iter()
            .map(|&cid| game.card(cid).base_power.unwrap_or(0))
            .sum(),
        "CardToughness" => paid_cards
            .iter()
            .map(|&cid| {
                let card = game.card(cid);
                card.lki_toughness.unwrap_or_else(|| card.toughness())
            })
            .sum(),
        "CardSumPT" => paid_cards
            .iter()
            .map(|&cid| {
                let card = game.card(cid);
                card.lki_power.unwrap_or_else(|| card.power())
                    + card.lki_toughness.unwrap_or_else(|| card.toughness())
            })
            .sum(),
        "CardManaCost" | "ManaCost" => paid_cards
            .iter()
            .map(|&cid| game.card(cid).mana_value())
            .sum(),
        "TotalPower" | "SumPower" => paid_cards
            .iter()
            .map(|&cid| {
                let card = game.card(cid);
                card.lki_power.unwrap_or(card.base_power.unwrap_or(0))
            })
            .sum(),
        "TotalToughness" | "SumToughness" => paid_cards
            .iter()
            .map(|&cid| {
                let card = game.card(cid);
                card.lki_toughness
                    .unwrap_or(card.base_toughness.unwrap_or(0))
            })
            .sum(),
        "TotalCMC" | "SumCMC" => paid_cards
            .iter()
            .map(|&cid| game.card(cid).mana_value())
            .sum(),
        _ if property.starts_with("Valid ") => {
            let filter = property.strip_prefix("Valid ").unwrap_or("");
            paid_cards
                .iter()
                .filter(|&&cid| matches_change_type(game.card(cid), filter, &[]))
                .count() as i32
        }
        _ => paid_cards.len() as i32,
    }
}

// ── Type Counting helpers ────────────────────────────────────────────

/// Count distinct card types among a list of cards.
/// Mirrors Java's `AbilityUtils.countCardTypesFromList(Iterable<Card>, boolean)`.
///
/// If `permanent_types` is true, only counts types that are permanent types
/// (Artifact, Creature, Enchantment, Land, Planeswalker).
pub fn count_card_types_from_list(
    game: &GameState,
    cards: &[CardId],
    permanent_types: bool,
) -> i32 {
    let mut types = std::collections::HashSet::new();
    for &cid in cards {
        let card = game.card(cid);
        for ct in &card.type_line.core_types {
            types.insert(ct.name().to_string());
        }
    }
    if permanent_types {
        types
            .iter()
            .filter(|t| {
                matches!(
                    t.as_str(),
                    "Artifact"
                        | "Creature"
                        | "Enchantment"
                        | "Land"
                        | "Planeswalker"
                        | "Battle"
                        | "Kindred"
                )
            })
            .count() as i32
    } else {
        types.len() as i32
    }
}

/// Count distinct supertypes among a list of cards.
/// Mirrors Java's `AbilityUtils.countSuperTypesFromList(Iterable<Card>)`.
pub fn count_super_types_from_list(game: &GameState, cards: &[CardId]) -> i32 {
    let mut types = std::collections::HashSet::new();
    for &cid in cards {
        let card = game.card(cid);
        for st in &card.type_line.supertypes {
            types.insert(*st);
        }
    }
    types.len() as i32
}

/// Count distinct subtypes among a list of cards.
/// Mirrors Java's `AbilityUtils.countSubTypesFromList(Iterable<Card>)`.
pub fn count_sub_types_from_list(game: &GameState, cards: &[CardId]) -> i32 {
    let mut types = std::collections::HashSet::new();
    for &cid in cards {
        let card = game.card(cid);
        for subtype in &card.type_line.subtypes {
            types.insert(subtype.clone());
        }
    }
    types.len() as i32
}

// ── UnlessCost ───────────────────────────────────────────────────────

/// Calculate the cost for an UnlessCost$ clause.
/// Mirrors Java's `AbilityUtils.calculateUnlessCost(SpellAbility, String, boolean)`.
///
/// Parses the UnlessCost$ string and returns a Cost object that the opponent
/// may choose to pay to prevent the effect.
pub fn calculate_unless_cost(
    game: &GameState,
    sa: &SpellAbility,
    unless_cost: &str,
) -> Option<crate::cost::Cost> {
    if unless_cost.is_empty() {
        return None;
    }

    // Handle "ChosenNumber" — mana cost equal to the chosen number
    if unless_cost == "ChosenNumber" {
        if let Some(source_id) = sa.source {
            let chosen = game.card(source_id).chosen_number.unwrap_or(0);
            let mana_str = chosen.to_string();
            return Some(crate::cost::parse_cost(&mana_str));
        }
        return None;
    }

    // Handle SVar reference — look up the SVar, calculate its amount
    if let Some(source_id) = sa.source {
        if let Some(svar_val) = game.card(source_id).get_s_var(unless_cost.trim()) {
            if !svar_val.is_empty() && unless_cost != "X" {
                let amount = crate::svar::resolve_count_svar_for_sa(
                    svar_val,
                    game,
                    source_id,
                    sa.activating_player,
                    sa,
                );
                let mana_str = amount.to_string();
                return Some(crate::cost::parse_cost(&mana_str));
            }
        }
    }

    // Default: parse the cost string directly
    Some(crate::cost::parse_cost(unless_cost))
}

// ── Filter by Type ───────────────────────────────────────────────────

/// Filter a list of card IDs by a type/valid-cards expression.
/// Mirrors Java's `AbilityUtils.filterListByType(CardCollectionView, String, SpellAbility)`.
///
/// Handles Triggered*, Targeted*, Remembered* prefixes that redirect
/// the source card for validation, then applies standard valid-cards matching.
pub fn filter_list_by_type(
    game: &GameState,
    cards: &[CardId],
    filter_type: &str,
    sa: &SpellAbility,
) -> Vec<CardId> {
    if filter_type.is_empty() {
        return cards.to_vec();
    }

    // Handle Triggered prefix — resolve to a trigger card, then adjust filter
    let (effective_source, effective_filter) = if filter_type.starts_with("Triggered") {
        // Look up the triggered card object
        let trigger_card = sa
            .get_triggering_card(AbilityKey::Card)
            .or_else(|| sa.get_triggering_card(AbilityKey::Object))
            .or_else(|| sa.get_triggering_card(AbilityKey::Attacker))
            .or_else(|| sa.get_triggering_card(AbilityKey::Blocker));

        match trigger_card {
            Some(cid) => {
                let adjusted = filter_type
                    .replace("TriggeredCard", "Card")
                    .replace("TriggeredObject", "Card")
                    .replace("TriggeredAttacker", "Card")
                    .replace("TriggeredBlocker", "Card")
                    .replace("Triggered", "Card");
                (Some(cid), adjusted)
            }
            None => return Vec::new(),
        }
    } else if filter_type.starts_with("Targeted") {
        // Use the targeted card as the source
        match sa.target_chosen.target_card {
            Some(cid) => {
                let adjusted = filter_type
                    .replace("TargetedCard", "Card")
                    .replace("Targeted", "Card");
                (Some(cid), adjusted)
            }
            None => return Vec::new(),
        }
    } else if filter_type.starts_with("Remembered") {
        // Use the first remembered card as the source
        let source_id = sa.source.unwrap_or(CardId(0));
        let remembered = &game.card(source_id).remembered_cards;
        match remembered.first() {
            Some(&cid) => {
                let adjusted = filter_type.replace("Remembered", "Card");
                (Some(cid), adjusted)
            }
            None => return Vec::new(),
        }
    } else {
        (sa.source, filter_type.to_string())
    };

    let selector = cached_compiled_selector(&effective_filter);
    cards
        .iter()
        .copied()
        .filter(|&cid| {
            let card = game.card(cid);
            // If the filter mentions "Self", it means the card being tested is the source
            if effective_filter.contains(".Self") {
                if let Some(src) = effective_source {
                    return cid == src;
                }
            }
            if let Some(source_id) = effective_source {
                matches_valid_cards_for_source(
                    game,
                    source_id,
                    card,
                    Some(&selector),
                    &effective_filter,
                )
            } else {
                matches_valid_cards(card, &effective_filter, sa.activating_player)
            }
        })
        .collect()
}

// ── Mana Color Conversion ────────────────────────────────────────────

/// Apply mana color conversion rules to a mana conversion matrix.
/// Mirrors Java's `AbilityUtils.applyManaColorConversion(ManaConversionMatrix, String)`.
///
/// Parses conversion strings like "White->Any", "nonGreen<-Black", etc.
/// In the Rust engine, we represent the conversion as a map from source color
/// to allowed replacement colors. The actual ManaConversionMatrix is stored
/// on the player; this function modifies it in place.
///
/// Format: "SourceColor->TargetColor" (additive) or "SourceColor<-TargetColor" (restrictive)
/// Multiple pairs separated by spaces.
pub fn apply_mana_color_conversion(
    conversions: &mut std::collections::HashMap<String, Vec<String>>,
    conversion_str: &str,
) {
    for pair in conversion_str.split_whitespace() {
        let (additive, sides) = if pair.contains("->") {
            (true, pair.split("->").collect::<Vec<_>>())
        } else if pair.contains("<-") {
            (false, pair.split("<-").collect::<Vec<_>>())
        } else {
            continue;
        };

        if sides.len() != 2 {
            continue;
        }

        let source_spec = sides[0];
        let target = sides[1].to_string();

        let source_colors: Vec<String> = if source_spec == "AnyColor" {
            vec!["W", "U", "B", "R", "G"]
                .into_iter()
                .map(String::from)
                .collect()
        } else if source_spec == "AnyType" {
            vec!["W", "U", "B", "R", "G", "C"]
                .into_iter()
                .map(String::from)
                .collect()
        } else if let Some(excluded) = source_spec.strip_prefix("non") {
            vec!["W", "U", "B", "R", "G"]
                .into_iter()
                .filter(|c| !c.eq_ignore_ascii_case(excluded))
                .map(String::from)
                .collect()
        } else {
            vec![source_spec.to_string()]
        };

        for source in source_colors {
            if additive {
                conversions.entry(source).or_default().push(target.clone());
            } else {
                // Restrictive: only allow this replacement
                conversions.insert(source, vec![target.clone()]);
            }
        }
    }
}

// ── Text Change Effects ──────────────────────────────────────────────

/// Apply text change effects from a card's SVars to a string.
/// Mirrors Java's `AbilityUtils.applyTextChangeEffects(String, boolean, Map, Map)`.
///
/// Text change data is stored in SVars with `TextColor:` and `TextType:` prefixes.
/// `is_descriptive` is preserved for parity but the Rust engine does direct replacement.
pub fn apply_text_change_effects(
    def: &str,
    is_descriptive: bool,
    color_map: &std::collections::BTreeMap<String, String>,
    type_map: &std::collections::BTreeMap<String, String>,
) -> String {
    if def.is_empty() {
        return def.to_string();
    }

    let mut replaced = def.to_string();

    // Apply color changes
    for (key, value) in color_map {
        if key == "Any" {
            for color in &["white", "blue", "black", "red", "green"] {
                let cap = capitalize(color);
                if value.eq_ignore_ascii_case(color) {
                    continue; // Don't replace color with itself
                }
                replaced = replaced.replace(color, &value.to_lowercase());
                replaced = replaced.replace(&cap, &capitalize(value));
            }
        } else {
            replaced = replaced.replace(&key.to_lowercase(), &value.to_lowercase());
            replaced = replaced.replace(key, value);
        }
    }

    // Apply type changes
    for (key, value) in type_map {
        if is_descriptive {
            // Also replace plural forms
            let plural_key = pluralize_type(key);
            let plural_value = pluralize_type(value);
            replaced = replaced.replace(&plural_key, &plural_value);
        }
        replaced = replaced.replace(key, value);
    }

    replaced
}

/// Extract color and type change maps from a Card's SVars.
/// Text changes are stored as SVars with `TextColor:` and `TextType:` prefixes.
fn extract_text_change_maps(
    card: &Card,
) -> (
    std::collections::BTreeMap<String, String>,
    std::collections::BTreeMap<String, String>,
) {
    let mut color_map = std::collections::BTreeMap::new();
    let mut type_map = std::collections::BTreeMap::new();
    for (key, value) in &card.svars {
        if let Some(from) = key.strip_prefix("TextColor:") {
            color_map.insert(from.to_string(), value.clone());
        } else if let Some(from) = key.strip_prefix("TextType:") {
            type_map.insert(from.to_string(), value.clone());
        }
    }
    (color_map, type_map)
}

/// Apply ability text change effects (for non-descriptive ability text).
/// Mirrors Java's `AbilityUtils.applyAbilityTextChangeEffects(String, CardTraitBase)`.
pub fn apply_ability_text_change_effects(def: &str, card: &Card) -> String {
    let (color_map, type_map) = extract_text_change_maps(card);
    apply_text_change_effects(def, false, &color_map, &type_map)
}

/// Apply keyword text change effects.
/// Mirrors Java's `AbilityUtils.applyKeywordTextChangeEffects(String, Card)`.
pub fn apply_keyword_text_change_effects(kw: &str, card: &Card) -> String {
    let (color_map, type_map) = extract_text_change_maps(card);
    apply_text_change_effects(kw, false, &color_map, &type_map)
}

/// Apply description text change effects (includes strikethrough in Java UI;
/// in the Rust engine we just do the replacement).
/// Mirrors Java's `AbilityUtils.applyDescriptionTextChangeEffects(String, CardTraitBase)`.
pub fn apply_description_text_change_effects(def: &str, card: &Card) -> String {
    let (color_map, type_map) = extract_text_change_maps(card);
    apply_text_change_effects(def, true, &color_map, &type_map)
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(c) => c.to_uppercase().to_string() + chars.as_str(),
    }
}

fn pluralize_type(type_name: &str) -> String {
    if type_name.ends_with('s') {
        type_name.to_string()
    } else if let Some(stem) = type_name.strip_suffix('y') {
        format!("{stem}ies")
    } else {
        format!("{type_name}s")
    }
}

// ── Splice ───────────────────────────────────────────────────────────

/// Add splice effects to a spell ability.
/// Mirrors Java's `AbilityUtils.addSpliceEffects(SpellAbility)`.
///
/// Checks the casting player's hand for cards with "Splice onto <type>"
/// keyword, and if any match the spell being cast, offers the player a
/// chance to splice them. Spliced card abilities are appended as sub-abilities.
///
/// Returns the (potentially modified) spell ability.
pub fn add_splice_effects(
    game: &GameState,
    sa: SpellAbility,
    _agents: &mut [Box<dyn crate::agent::PlayerAgent>],
) -> SpellAbility {
    let source_id = match sa.source {
        Some(id) => id,
        None => return sa,
    };
    let source = game.card(source_id);
    let player = sa.activating_player;

    // Only spells can be spliced onto; copies can't
    if !sa.is_spell || sa.is_copy {
        return sa;
    }

    let hand = game.cards_in_zone(ZoneType::Hand, player);
    if hand.is_empty() {
        return sa;
    }

    // Find cards in hand with Splice keyword that match the source spell type
    let splice_candidates: Vec<CardId> = hand
        .iter()
        .copied()
        .filter(|&cid| {
            if cid == source_id {
                return false;
            }
            let card = game.card(cid);
            // Check if card has a "Splice onto" keyword matching the source spell type
            if let Some(splice_rest) = card.keywords.find_with_prefix("Splice onto ") {
                let splice_type = splice_rest
                    .strip_prefix("Splice onto ")
                    .unwrap_or("")
                    .split(' ')
                    .next()
                    .unwrap_or("");
                source
                    .type_line
                    .core_types
                    .iter()
                    .any(|ct| ct.name().eq_ignore_ascii_case(splice_type))
                    || splice_type.eq_ignore_ascii_case("instant") && source.type_line.is_instant()
                    || splice_type.eq_ignore_ascii_case("arcane")
                        && source
                            .type_line
                            .subtypes
                            .iter()
                            .any(|s| s.eq_ignore_ascii_case("Arcane"))
            } else {
                false
            }
        })
        .collect();

    if splice_candidates.is_empty() {
        return sa;
    }

    // For now, the agent system doesn't have a splice choice method.
    // Return the SA unchanged — splice is a rare mechanic and will be
    // fully wired when the agent interface is extended.
    sa
}

/// Add a single splice effect from a card onto a spell ability.
/// Mirrors Java's `AbilityUtils.addSpliceEffect(SpellAbility, Card)`.
///
/// Appends the first spell ability of the spliced card as a sub-ability
/// at the end of the SA chain, and adds the splice cost to the total cost.
pub fn add_splice_effect(sa: &mut SpellAbility, game: &GameState, splice_card_id: CardId) {
    let splice_card = game.card(splice_card_id);

    // Find the first ability text on the splice card
    let first_ability = match splice_card.abilities.first() {
        Some(text) => text.clone(),
        None => return,
    };

    // Build a sub-ability from the splice card's first ability
    let mut sub_sa = crate::spellability::build_spell_ability(
        game,
        splice_card_id,
        &first_ability,
        sa.activating_player,
    );
    sub_sa.source = sa.source; // Use the host card as source
    sub_sa.activating_player = sa.activating_player;

    // Append at the end of the sub-ability chain
    let mut slot = &mut sa.sub_ability;
    loop {
        match slot {
            Some(node) => slot = &mut node.sub_ability,
            None => {
                *slot = Some(Box::new(sub_sa));
                break;
            }
        }
    }

    // Track that this card was spliced
    sa.spliced_cards.push(splice_card_id);

    // Update description
    let name = splice_card.card_name.clone();
    if !sa.description.is_empty() {
        sa.description
            .push_str(&format!(" (Splicing {} onto it)", name));
    }
}

// ── Defined$ convenience overloads ───────────────────────────────────

/// Resolve a `Defined$` expression to a combined list of the targeted
/// `GameObject`s — cards + players + spell abilities.
/// Mirrors Java `AbilityUtils.getDefinedObjects(Card, String, CardTraitBase)`.
///
/// The three sub-resolvers are surfaced separately via their native Rust enums
/// rather than a shared `GameObject` trait object, so this helper returns a
/// tuple instead of Java's `FCollection<GameObject>`.
#[allow(clippy::type_complexity)]
pub fn get_defined_objects(
    defined: &str,
    sa: &SpellAbility,
    game: &GameState,
) -> (Vec<PlayerId>, Vec<CardId>, Vec<SpellAbility>) {
    let d = if defined.is_empty() { "Self" } else { defined };
    (
        resolve_defined_players_with_sa(d, sa, sa.activating_player, game),
        get_defined_cards(game, sa.source, d, Some(sa.activating_player)),
        get_defined_spell_abilities(d, sa, game),
    )
}

/// Resolve a `Defined$` expression to a combined player + card list.
/// Mirrors Java `AbilityUtils.getDefinedEntities(Card, String, CardTraitBase)`.
pub fn get_defined_entities(
    defined: &str,
    sa: &SpellAbility,
    game: &GameState,
) -> (Vec<PlayerId>, Vec<CardId>) {
    let d = if defined.is_empty() { "Self" } else { defined };
    (
        resolve_defined_players_with_sa(d, sa, sa.activating_player, game),
        get_defined_cards(game, sa.source, d, Some(sa.activating_player)),
    )
}

/// Collect the basic spell abilities that a Play$ effect could cast from
/// `tgt_card`. Mirrors Java `AbilityUtils.getBasicSpellsFromPlayEffect(Card, Player)`.
///
/// "Basic" means the non-alternative cost variants — the Rust engine has no
/// `Spell` wrapper analogue yet, so we synthesize fresh `SpellAbility` objects
/// from the target card's ability text, filtering to spells / land abilities
/// the way Java does in `collectSpellsForPlayEffect`.
pub fn get_basic_spells_from_play_effect(
    game: &GameState,
    tgt_card: CardId,
    controller: PlayerId,
) -> Vec<SpellAbility> {
    get_spells_from_play_effect(game, tgt_card, controller, false)
}

/// Full variant of `getBasicSpellsFromPlayEffect` — when `with_alt_cost` is
/// `true`, alternative-cost (flashback/overload/…) variants are included.
/// Mirrors Java `AbilityUtils.getSpellsFromPlayEffect(Card, Player, CardStateName, boolean)`.
///
/// Alt-cost expansion depends on `GameActionUtil.getAlternativeCosts`, which
/// is not ported yet — the `with_alt_cost=true` branch currently degrades to
/// the basic list. Revisit once alt-cost collection is available.
pub fn get_spells_from_play_effect(
    game: &GameState,
    tgt_card: CardId,
    controller: PlayerId,
    _with_alt_cost: bool,
) -> Vec<SpellAbility> {
    let card = game.card(tgt_card);
    let mut out = Vec::new();
    for ab_text in &card.abilities {
        let params = crate::parsing::Params::from_raw(ab_text);
        let record = crate::ability::ability_factory::AbilityRecordType::from_params(&params);
        let is_spell = matches!(
            record,
            Some(crate::ability::ability_factory::AbilityRecordType::Spell)
        );
        if !is_spell && !card.type_line.is_land() {
            continue;
        }
        let built =
            crate::spellability::build_spell_ability_from_host_card(card, ab_text, controller);
        out.push(built);
    }
    out
}

/// Read an SVar from the SA's host, applying in-flight text-change effects
/// when the SA is intrinsic — mirrors Java `AbilityUtils.getSVar(CardTraitBase, String)`.
pub fn get_s_var(sa: &SpellAbility, game: &GameState, svar_name: &str) -> Option<String> {
    let host_id = sa.source?;
    let raw = game.card(host_id).get_s_var(svar_name)?.to_string();
    if !sa.is_intrinsic() || raw.is_empty() {
        return Some(raw);
    }
    // Text-change effects are applied at Card state time; no additional
    // rewrite needed here (see `apply_description_text_change_effects` for the
    // description path). Mirrors Java's behavior when no active text changes
    // match the SVar value.
    Some(raw)
}

/// Returns `true` when a trait can't be linked to the cast-SA of `card` because
/// the trait originates from a different physical host (transformed / melded /
/// adventure-cast situations).
///
/// Mirrors Java `AbilityUtils.isUnlinkedFromCastSA(CardTraitBase, Card)`.
pub fn is_unlinked_from_cast_sa(sa: &SpellAbility, card: &Card) -> bool {
    if !sa.is_intrinsic() {
        return false;
    }
    if sa.source != Some(card.id) {
        return false;
    }
    // Java: getHostCard() vs cast_sa.getOriginalHost()/getHostCard() — if the
    // trait's original host disagrees with the cast-SA's host, the trait is
    // unlinked (e.g. intrinsic ability granted by a transformed face whose
    // cast-SA belongs to the front face).
    let trait_host = sa.original_host.or(sa.source);
    let Some(cast) = card.cast_sa.as_deref() else {
        return false;
    };
    let cast_host = cast.original_host.or(cast.source);
    match (trait_host, cast_host) {
        (Some(t), Some(c)) => t != c,
        _ => false,
    }
}

// ── Resolve ──────────────────────────────────────────────────────────

/// Top-level ability resolution entry point.
/// Mirrors Java's `AbilityUtils.resolve(SpellAbility)`.
///
/// In the Rust engine, resolution is handled by the effect dispatch system
/// in `effects::resolve_effect`. This function serves as the structural parity
/// entry point that the scanner expects to find.
pub fn resolve(ctx: &mut crate::ability::effects::EffectContext, sa: &SpellAbility) {
    crate::ability::effects::resolve_effect(ctx, sa);
}
