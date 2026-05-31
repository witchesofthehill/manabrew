//! Replacement effect dispatcher.
//!
//! Mirrors the Java Forge `ReplacementHandler.java` in
//! `forge/game/replacement/`.
//!
//! The entry point is [`apply_replacements`], which accepts a mutable
//! [`ReplacementEvent`] and iterates through the five CR 616 layers
//! (CantHappen → Control → Copy → Transform → Other), applying the first
//! matching effect in each layer.

use std::collections::{HashMap, HashSet};

use forge_foundation::{PhaseType, ZoneType};

use crate::card::Card;
use crate::card::CounterType;
use crate::card_trait_base::CardTrait;
use crate::game::GameState;
use crate::game_rng::GameRng;
use crate::ids::{CardId, PlayerId};
use crate::mana::ManaPool;
use crate::replacement::replacement_effect::{
    resolve_replace_with_chain, GameLossReason, ReplacementChainIr, ReplacementEffect,
};
use crate::replacement::replacement_layer::ReplacementLayer;
use crate::replacement::replacement_result::ReplacementResult;
use crate::replacement::replacement_type::ReplacementType;
use crate::trigger::TriggerHandler;

// ── ReplacementEvent ──────────────────────────────────────────────────────────

/// A game event that may be subject to one or more replacement effects.
///
/// Each variant carries the mutable parameters of the event so that a
/// replacement effect can modify them (e.g. reduce damage to 0, redirect a
/// zone move, etc.).
///
/// Mirrors the `runParams` map passed to `ReplacementHandler.run()` in Java,
/// but typed for safety.
#[derive(Debug, Clone)]
pub enum ReplacementEvent {
    /// A card is being drawn by a player.
    /// `extra_draws` is incremented by replacements (e.g. Alhammarret's Archive DrawTwo).
    /// `is_first_in_draw_step` is true for the first draw in the draw step (not extra draws).
    Draw {
        player: PlayerId,
        extra_draws: i32,
        is_first_in_draw_step: bool,
    },

    /// Damage is being dealt to a permanent.
    DamageToCard {
        target: CardId,
        amount: i32,
        /// The card dealing the damage, if known.
        source: Option<CardId>,
        /// Whether this is combat damage.
        is_combat: bool,
    },

    /// Damage is being dealt to a player.
    DamageToPlayer {
        target: PlayerId,
        amount: i32,
        /// The card dealing the damage, if known.
        source: Option<CardId>,
        /// Whether this is combat damage.
        is_combat: bool,
    },

    /// A permanent is being destroyed (lethal damage or destroy effect).
    Destroy { target: CardId },

    /// A card is moving between zones.
    Moved {
        card: CardId,
        origin: ZoneType,
        destination: ZoneType,
        /// True when this move originates from a discard action.
        /// Mirrors Java's `AbilityKey.Discard` in replacement params.
        is_discard: bool,
    },

    /// A player is gaining life.
    GainLife { player: PlayerId, amount: i32 },

    /// Token(s) are being created.
    /// `is_effect` is `true` when created by a spell/ability effect, `false` for game rules.
    CreateToken {
        player: PlayerId,
        count: i32,
        is_effect: bool,
    },

    /// Counter(s) are being added to a permanent.
    /// `is_effect` is `true` when placed by a spell/ability, `false` for ETB keywords/game rules.
    AddCounter {
        target: CardId,
        counter_type: CounterType,
        count: i32,
        is_effect: bool,
    },

    /// A player is losing the game.
    GameLoss {
        player: PlayerId,
        reason: GameLossReason,
    },

    /// A player is winning the game.
    GameWin { player: PlayerId },

    /// A spell is being countered.
    Counter { card: CardId },

    /// Mana is being produced (for doublers like Mirari's Wake, Nyxbloom Ancient).
    /// `mana` is the produced mana string (e.g. "G" or "U U") that may be modified.
    ProduceMana {
        source: CardId,
        activator: PlayerId,
        mana: String,
    },

    /// A permanent is being tapped.
    Tap { card: CardId },

    /// A permanent is being untapped.
    Untap {
        card: CardId,
        player: Option<PlayerId>,
    },

    /// Life is being reduced (distinct from damage).
    LifeReduced {
        player: PlayerId,
        amount: i32,
        is_damage: bool,
    },

    /// Counter(s) are being removed from a permanent.
    RemoveCounter {
        target: CardId,
        counter_type: CounterType,
        count: i32,
    },

    /// Damage has been dealt (post-damage).
    DealtDamage {
        target: CardId,
        amount: i32,
        source: Option<CardId>,
    },

    /// Multiple cards are being drawn.
    DrawCards { player: PlayerId, count: i32 },

    /// Cards are being milled.
    Mill { player: PlayerId, count: i32 },

    /// Life is being paid as a cost.
    PayLife { player: PlayerId, amount: i32 },

    /// A player is scrying.
    Scry { player: PlayerId, count: i32 },

    /// An aura/equipment is being attached.
    Attached { card: CardId, target: CardId },

    /// A phase is beginning.
    BeginPhase {
        player: PlayerId,
        phase: forge_foundation::PhaseType,
    },

    /// A turn is beginning.
    BeginTurn { player: PlayerId },

    /// A creature is exploring.
    Explore { card: CardId },

    /// Blockers are being declared.
    DeclareBlocker { player: PlayerId },

    /// Damage is being assigned before dealing.
    AssignDealDamage { card: CardId },

    /// A DFC is transforming.
    Transform { card: CardId },

    /// A face-down card is turning face up.
    TurnFaceUp { card: CardId },

    /// A spell is being copied.
    CopySpell { player: PlayerId, count: i32 },

    /// A player is proliferating.
    Proliferate { player: PlayerId, count: i32 },

    /// Cascade is triggering.
    Cascade { player: PlayerId },

    /// A player is learning.
    Learn { player: PlayerId },

    /// Mana is being lost.
    LoseMana { player: PlayerId },

    /// Dice are being rolled.
    RollDice {
        player: PlayerId,
        sides: i32,
        number: i32,
        ignore: i32,
        ignore_chosen: HashMap<PlayerId, i32>,
        dice_pt_exchanges: HashSet<CardId>,
    },

    /// The planar die is being rolled.
    RollPlanarDice { player: PlayerId },

    /// A planar dice result is being applied.
    PlanarDiceResult { player: PlayerId },

    /// A player is planeswalking.
    Planeswalk { player: PlayerId },

    /// A scheme is being set in motion.
    SetInMotion { player: PlayerId },

    /// A contraption is being assembled.
    AssembleContraption { player: PlayerId },
}

// ── ReplacementHandler struct ─────────────────────────────────────────────────

use crate::agent::PlayerAgent;

pub struct ReplacementRuntime<'a> {
    pub trigger_handler: &'a mut TriggerHandler,
    pub token_templates: &'a HashMap<String, Card>,
    pub token_art_variants: &'a HashMap<(String, String), usize>,
    pub token_fallback: &'a HashMap<String, String>,
    pub edition_dates: &'a HashMap<String, String>,
    pub mana_pools: &'a mut Vec<ManaPool>,
    pub rng: &'a mut dyn GameRng,
}

/// Struct-based replacement handler with loop prevention and optional agent access.
///
/// Mirrors Java `ReplacementHandler` class. The `has_run` set prevents infinite
/// loops when effects re-trigger themselves.
///
/// Usage:
/// - `ReplacementHandler::new().run(game, Some(agents), event)` — with agent choice
/// - `apply_replacements(game, event)` — free function wrapper (no agent, auto-selects first)
pub struct ReplacementHandler {
    /// Tracks (card_id, layer, effect_index) tuples that have already been applied
    /// during this handler invocation, to prevent infinite re-application.
    has_run: HashSet<(CardId, ReplacementLayer, usize)>,
}

impl Default for ReplacementHandler {
    fn default() -> Self {
        Self::new()
    }
}

impl ReplacementHandler {
    pub fn new() -> Self {
        Self {
            has_run: HashSet::new(),
        }
    }

    /// Apply all applicable replacement effects to a game event.
    ///
    /// Processes effects in CR 616 layer order:
    /// CantHappen → Control → Copy → Transform → Other.
    ///
    /// When `agents` is `Some` and multiple effects match in the same layer,
    /// the affected player's agent is asked to choose via
    /// `choose_single_replacement_effect()`.
    ///
    /// Mirrors Java `ReplacementHandler.run(ReplacementType, Map<AbilityKey,Object>)`.
    pub fn run(
        &mut self,
        game: &mut GameState,
        mut agents: Option<&mut [Box<dyn PlayerAgent>]>,
        mut runtime: Option<&mut ReplacementRuntime<'_>>,
        event: &mut ReplacementEvent,
    ) -> ReplacementResult {
        for layer in [
            ReplacementLayer::CantHappen,
            ReplacementLayer::Control,
            ReplacementLayer::Copy,
            ReplacementLayer::Transform,
            ReplacementLayer::Other,
        ] {
            let result = self.run_layer(
                game,
                agents.as_deref_mut(),
                runtime.as_deref_mut(),
                event,
                layer,
            );
            match result {
                ReplacementResult::NotReplaced => continue,
                ReplacementResult::Updated => {
                    // Java preserves Updated unless a later replacement fully
                    // replaces the event during the re-run.
                    return match self.run(game, agents, runtime, event) {
                        ReplacementResult::NotReplaced | ReplacementResult::Updated => {
                            ReplacementResult::Updated
                        }
                        other => other,
                    };
                }
                other => return other,
            }
        }
        ReplacementResult::NotReplaced
    }

    /// Apply one CR 616 layer of replacement effects.
    fn run_layer(
        &mut self,
        game: &mut GameState,
        mut agents: Option<&mut [Box<dyn PlayerAgent>]>,
        mut runtime: Option<&mut ReplacementRuntime<'_>>,
        event: &mut ReplacementEvent,
        layer: ReplacementLayer,
    ) -> ReplacementResult {
        let effects = collect_effects(game, event, layer);
        let mut declined_effects: HashSet<(CardId, usize)> = HashSet::new();

        if effects.is_empty() {
            return ReplacementResult::NotReplaced;
        }

        loop {
            let eligible: Vec<_> = effects
                .iter()
                .filter(|(card_id, _re, effect_idx)| {
                    !self.has_run.contains(&(*card_id, layer, *effect_idx))
                        && !declined_effects.contains(&(*card_id, *effect_idx))
                })
                .cloned()
                .collect();

            if eligible.is_empty() {
                return ReplacementResult::NotReplaced;
            }

            let chosen_idx = if !eligible.is_empty() && layer != ReplacementLayer::CantHappen {
                if let Some(agents) = agents.as_deref_mut() {
                    let descriptions: Vec<String> = eligible
                        .iter()
                        .map(|(card_id, re, _)| {
                            let host = game.card(*card_id);
                            let card_name = &host.card_name;
                            let desc = re.description(host, game);
                            format!("{card_name}: {desc}")
                        })
                        .collect();

                    let affected_player = affected_player_for_event(event, game);
                    let agent = &mut agents[affected_player.index()];
                    agent
                        .choose_single_replacement_effect(affected_player, &descriptions)
                        .min(eligible.len() - 1)
                } else {
                    0
                }
            } else {
                0
            };

            let (source_card_id, ref effect, effect_idx) = eligible[chosen_idx];
            self.has_run.insert((source_card_id, layer, effect_idx));
            let result = execute_effect(
                game,
                source_card_id,
                effect,
                event,
                agents.as_deref_mut(),
                runtime.as_deref_mut(),
            );
            if result == ReplacementResult::NotReplaced {
                self.has_run.remove(&(source_card_id, layer, effect_idx));
                declined_effects.insert((source_card_id, effect_idx));
                continue;
            }
            return result;
        }
    }
}

/// Determine which player is "affected" by the event (for choosing among effects).
fn affected_player_for_event(event: &ReplacementEvent, game: &GameState) -> PlayerId {
    match event {
        ReplacementEvent::Draw { player, .. } => *player,
        ReplacementEvent::DamageToCard { target, .. } => game.cards[target.index()].controller,
        ReplacementEvent::DamageToPlayer { target, .. } => *target,
        ReplacementEvent::Destroy { target } => game.cards[target.index()].controller,
        ReplacementEvent::Moved { card, .. } => game.cards[card.index()].controller,
        ReplacementEvent::GainLife { player, .. } => *player,
        ReplacementEvent::CreateToken { player, .. } => *player,
        ReplacementEvent::AddCounter { target, .. } => game.cards[target.index()].controller,
        ReplacementEvent::GameLoss { player, .. } => *player,
        ReplacementEvent::GameWin { player } => *player,
        ReplacementEvent::Counter { card } => game.cards[card.index()].controller,
        ReplacementEvent::ProduceMana { activator, .. } => *activator,
        ReplacementEvent::Tap { card } => game.cards[card.index()].controller,
        ReplacementEvent::Untap { card, .. } => game.cards[card.index()].controller,
        ReplacementEvent::LifeReduced { player, .. } => *player,
        ReplacementEvent::RemoveCounter { target, .. } => game.cards[target.index()].controller,
        ReplacementEvent::DealtDamage { target, .. } => game.cards[target.index()].controller,
        ReplacementEvent::DrawCards { player, .. } => *player,
        ReplacementEvent::Mill { player, .. } => *player,
        ReplacementEvent::PayLife { player, .. } => *player,
        ReplacementEvent::Scry { player, .. } => *player,
        ReplacementEvent::Attached { card, .. } => game.cards[card.index()].controller,
        ReplacementEvent::BeginPhase { player, .. } => *player,
        ReplacementEvent::BeginTurn { player } => *player,
        ReplacementEvent::Explore { card } => game.cards[card.index()].controller,
        ReplacementEvent::DeclareBlocker { player } => *player,
        ReplacementEvent::AssignDealDamage { card } => game.cards[card.index()].controller,
        ReplacementEvent::Transform { card } => game.cards[card.index()].controller,
        ReplacementEvent::TurnFaceUp { card } => game.cards[card.index()].controller,
        ReplacementEvent::CopySpell { player, .. } => *player,
        ReplacementEvent::Proliferate { player, .. } => *player,
        ReplacementEvent::Cascade { player } => *player,
        ReplacementEvent::Learn { player } => *player,
        ReplacementEvent::LoseMana { player } => *player,
        ReplacementEvent::RollDice { player, .. } => *player,
        ReplacementEvent::RollPlanarDice { player } => *player,
        ReplacementEvent::PlanarDiceResult { player } => *player,
        ReplacementEvent::Planeswalk { player } => *player,
        ReplacementEvent::SetInMotion { player } => *player,
        ReplacementEvent::AssembleContraption { player } => *player,
    }
}

// ── Public free-function API (backward compatibility) ─────────────────────────

/// Apply all applicable replacement effects to a game event.
///
/// Free function wrapper — auto-selects first effect (no agent prompt).
/// Used by callers that don't have access to agents (e.g. `action.rs`).
///
/// Mirrors Java `ReplacementHandler.run(ReplacementType, Map<AbilityKey,Object>)`.
pub fn apply_replacements(game: &mut GameState, event: &mut ReplacementEvent) -> ReplacementResult {
    let mut handler = ReplacementHandler::new();
    handler.run(game, None, None, event)
}

/// Apply Moved replacement effects (Rest in Peace, Leyline of the Void) for a card
/// being moved to the Graveyard. Uses agents for proper RNG consumption when
/// multiple effects apply. Returns the final destination zone.
///
/// If `dest` is not `Graveyard`, returns `dest` unchanged (no replacement needed).
pub fn apply_moved_replacement(
    game: &mut GameState,
    card_id: CardId,
    dest: ZoneType,
    agents: Option<&mut [Box<dyn crate::agent::PlayerAgent>]>,
) -> ZoneType {
    if dest != ZoneType::Graveyard {
        return dest;
    }
    let src_zone = game.cards[card_id.index()].zone;
    let mut event = ReplacementEvent::Moved {
        card: card_id,
        origin: src_zone,
        destination: ZoneType::Graveyard,
        is_discard: false,
    };
    let mut handler = ReplacementHandler::new();
    handler.run(game, agents, None, &mut event);
    if let ReplacementEvent::Moved { destination, .. } = event {
        destination
    } else {
        ZoneType::Graveyard
    }
}

pub fn apply_replacements_with_agents(
    game: &mut GameState,
    agents: &mut [Box<dyn PlayerAgent>],
    event: &mut ReplacementEvent,
) -> ReplacementResult {
    let mut handler = ReplacementHandler::new();
    handler.run(game, Some(agents), None, event)
}

pub fn apply_replacements_with_agents_and_runtime(
    game: &mut GameState,
    agents: &mut [Box<dyn PlayerAgent>],
    runtime: &mut ReplacementRuntime<'_>,
    event: &mut ReplacementEvent,
) -> ReplacementResult {
    let mut handler = ReplacementHandler::new();
    handler.run(game, Some(agents), Some(runtime), event)
}

pub(crate) fn replacement_event_amount(event: &ReplacementEvent) -> Option<i32> {
    match event {
        ReplacementEvent::DamageToCard { amount, .. } => Some(*amount),
        ReplacementEvent::DamageToPlayer { amount, .. } => Some(*amount),
        ReplacementEvent::GainLife { amount, .. } => Some(*amount),
        ReplacementEvent::LifeReduced { amount, .. } => Some(*amount),
        ReplacementEvent::CreateToken { count, .. } => Some(*count),
        ReplacementEvent::AddCounter { count, .. } => Some(*count),
        ReplacementEvent::DrawCards { count, .. } => Some(*count),
        ReplacementEvent::Mill { count, .. } => Some(*count),
        ReplacementEvent::PayLife { amount, .. } => Some(*amount),
        ReplacementEvent::Scry { count, .. } => Some(*count),
        ReplacementEvent::CopySpell { count, .. } => Some(*count),
        ReplacementEvent::Proliferate { count, .. } => Some(*count),
        ReplacementEvent::RollDice { number, .. } => Some(*number),
        _ => None,
    }
}

pub(crate) fn set_replacement_event_amount(event: &mut ReplacementEvent, value: i32) -> bool {
    match event {
        ReplacementEvent::DamageToCard { amount, .. } => *amount = value.max(0),
        ReplacementEvent::DamageToPlayer { amount, .. } => *amount = value.max(0),
        ReplacementEvent::GainLife { amount, .. } => *amount = value.max(0),
        ReplacementEvent::LifeReduced { amount, .. } => *amount = value.max(0),
        ReplacementEvent::CreateToken { count, .. } => *count = value.max(0),
        ReplacementEvent::AddCounter { count, .. } => *count = value.max(0),
        ReplacementEvent::DrawCards { count, .. } => *count = value.max(0),
        ReplacementEvent::Mill { count, .. } => *count = value.max(0),
        ReplacementEvent::PayLife { amount, .. } => *amount = value.max(0),
        ReplacementEvent::Scry { count, .. } => *count = value.max(0),
        ReplacementEvent::CopySpell { count, .. } => *count = value.max(0),
        ReplacementEvent::Proliferate { count, .. } => *count = value.max(0),
        ReplacementEvent::RollDice { number, .. } => *number = value.max(0),
        _ => return false,
    }
    true
}

fn amount_after_math(mut amount: i32, ops: &str) -> i32 {
    if ops.is_empty() {
        return amount;
    }
    let parts: Vec<&str> = ops.split('.').collect();
    let op = parts.first().copied().unwrap_or("");
    let rhs = parts
        .get(1)
        .and_then(|value| value.parse::<i32>().ok())
        .unwrap_or(0);
    if op.contains("Plus") {
        amount += rhs;
    } else if op.contains("Minus") {
        amount -= rhs;
    } else if op.contains("Twice") {
        amount *= 2;
    } else if op.contains("Thrice") {
        amount *= 3;
    } else if op.contains("HalfUp") {
        amount = ((amount as f64) / 2.0).ceil() as i32;
    } else if op.contains("HalfDown") {
        amount = ((amount as f64) / 2.0).floor() as i32;
    }
    amount
}

pub(crate) fn resolve_replace_value(
    expr: &str,
    game: &GameState,
    source_card_id: CardId,
    event: &ReplacementEvent,
) -> Option<i32> {
    let expr = expr.trim();
    if let Ok(value) = expr.parse::<i32>() {
        return Some(value);
    }
    if let Some(svar) = game.card(source_card_id).svars.get(expr) {
        return resolve_replace_value(svar, game, source_card_id, event);
    }
    let rest = expr.strip_prefix("ReplaceCount$")?;
    let (field, ops) = rest.split_once('/').unwrap_or((rest, ""));
    let base = match field {
        "DamageAmount" | "LifeGained" | "Amount" | "Number" | "TokenNum" | "CounterNum" => {
            replacement_event_amount(event)?
        }
        "Ignore" => match event {
            ReplacementEvent::RollDice { ignore, .. } => *ignore,
            _ => return None,
        },
        _ => return None,
    };
    Some(amount_after_math(base, ops))
}

pub(crate) fn execute_replace_with_numeric_update(
    effect: &ReplacementEffect,
    event: &mut ReplacementEvent,
    game: &GameState,
    source_card_id: CardId,
    var_name: &str,
) -> Option<ReplacementResult> {
    let chain = resolve_replace_with_chain(effect, game.card(source_card_id))?;
    execute_replace_effect_ir(&chain, event, game, source_card_id, Some(var_name))
}

pub(crate) fn execute_replace_effect_ir(
    chain: &ReplacementChainIr,
    event: &mut ReplacementEvent,
    game: &GameState,
    source_card_id: CardId,
    required_var_name: Option<&str>,
) -> Option<ReplacementResult> {
    match chain {
        ReplacementChainIr::ReplaceToken {
            token_type,
            amount_expr,
        } => execute_replace_token_chain(
            token_type.as_deref(),
            amount_expr.as_deref(),
            event,
            game,
            source_card_id,
        ),
        ReplacementChainIr::ReplaceCounter { amount_expr } => {
            execute_replace_counter_chain(amount_expr, event, game, source_card_id)
        }
        ReplacementChainIr::ReplaceEffect {
            var_name,
            var_type,
            var_key,
            var_value,
            sub_ability,
        } => {
            let mut updated = false;
            if let Some(var_name) = var_name.as_deref() {
                if required_var_name.is_none_or(|required| required == var_name) {
                    match var_name {
                        "DicePTExchanges" => {
                            if var_type.as_deref() == Some("CardSet") {
                                if let Some(var_value) = var_value.as_deref() {
                                    if let Some(card_id) =
                                        resolve_replace_card_key(var_value, source_card_id)
                                    {
                                        if let ReplacementEvent::RollDice {
                                            dice_pt_exchanges,
                                            ..
                                        } = event
                                        {
                                            dice_pt_exchanges.insert(card_id);
                                            updated = true;
                                        }
                                    }
                                }
                            }
                        }
                        _ => {
                            if let Some(var_value) = var_value.as_deref() {
                                if let Some(value) =
                                    resolve_replace_value(var_value, game, source_card_id, event)
                                {
                                    match var_name {
                                        "Ignore" => {
                                            if let ReplacementEvent::RollDice { ignore, .. } = event
                                            {
                                                *ignore = value.max(0);
                                                updated = true;
                                            }
                                        }
                                        "IgnoreChosen" => {
                                            if var_type.as_deref() == Some("Map") {
                                                if let Some(var_key) = var_key.as_deref() {
                                                    if let Some(player) = resolve_replace_player_key(
                                                        var_key,
                                                        game,
                                                        source_card_id,
                                                        event,
                                                    ) {
                                                        if let ReplacementEvent::RollDice {
                                                            ignore_chosen,
                                                            ..
                                                        } = event
                                                        {
                                                            ignore_chosen
                                                                .insert(player, value.max(0));
                                                            updated = true;
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                        _ => {
                                            if set_replacement_event_amount(event, value) {
                                                updated = true;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if let Some(sub_ability) = sub_ability.as_deref() {
                updated |=
                    execute_replace_effect_ir(sub_ability, event, game, source_card_id, None)
                        .is_some();
            }

            updated.then_some(ReplacementResult::Updated)
        }
    }
}

/// Handle `DB$ ReplaceToken` SVars.
///
/// Mirrors Java `ReplaceTokenEffect.resolve()`.
/// - `Type$ Amount`: multiplies token count using `Amount$` param (default `Twice`).
fn execute_replace_token_chain(
    token_type: Option<&str>,
    amount_expr: Option<&str>,
    event: &mut ReplacementEvent,
    game: &GameState,
    source_card_id: CardId,
) -> Option<ReplacementResult> {
    let token_type = token_type.unwrap_or("Amount");
    match token_type {
        "Amount" => {
            // Get current count from event
            let current = replacement_event_amount(event)?;
            // Amount$ param, defaults to "Twice" per Java
            let amount_expr = amount_expr.unwrap_or("Twice");
            let new_value = do_x_math(current, amount_expr, game, source_card_id, event);
            set_replacement_event_amount(event, new_value);
            Some(ReplacementResult::Updated)
        }
        _ => {
            // Other types (AddToken, ReplaceToken, ReplaceController) not yet needed
            None
        }
    }
}

/// Handle `DB$ ReplaceCounter` SVars.
///
/// Mirrors Java `ReplaceCounterEffect.resolve()`.
/// Applies `Amount$` expression to the counter count.
fn execute_replace_counter_chain(
    amount_expr: &str,
    event: &mut ReplacementEvent,
    game: &GameState,
    source_card_id: CardId,
) -> Option<ReplacementResult> {
    // Ensure event has a valid amount before resolving
    let _current = replacement_event_amount(event)?;
    let value = resolve_replace_value(amount_expr, game, source_card_id, event)?;
    if value <= 0 {
        // Java removes the counter entry when value <= 0
        set_replacement_event_amount(event, 0);
    } else {
        set_replacement_event_amount(event, value);
    }
    Some(ReplacementResult::Updated)
}

/// Simple math evaluation mirroring Java `AbilityUtils.doXMath()`.
///
/// Handles common expressions: "Twice", "Thrice", "Half", integer literals,
/// and `Plus.N` / `Minus.N` style ops.
fn do_x_math(
    base: i32,
    expr: &str,
    game: &GameState,
    source_card_id: CardId,
    event: &ReplacementEvent,
) -> i32 {
    match expr {
        "Twice" => base * 2,
        "Thrice" => base * 3,
        "Half" => ((base as f64) / 2.0).ceil() as i32,
        _ => {
            // Try resolving as an SVar or ReplaceCount$ expression
            if let Some(val) = resolve_replace_value(expr, game, source_card_id, event) {
                val
            } else {
                base
            }
        }
    }
}

fn resolve_replace_player_key(
    expr: &str,
    game: &GameState,
    source_card_id: CardId,
    event: &ReplacementEvent,
) -> Option<PlayerId> {
    match expr.trim() {
        "You" => Some(game.card(source_card_id).controller),
        "Affected" => match event {
            ReplacementEvent::RollDice { player, .. } => Some(*player),
            _ => None,
        },
        "Opponent" => Some(game.opponent_of(game.card(source_card_id).controller)),
        _ => None,
    }
}

fn resolve_replace_card_key(expr: &str, source_card_id: CardId) -> Option<CardId> {
    match expr.trim() {
        "Self" => Some(source_card_id),
        _ => None,
    }
}

// ── Scan-parity helper functions ──────────────────────────────────────────────

/// Check if any `CantHappen`-layer replacement effect would prevent this event.
///
/// Walks all battlefield cards' replacement effects, filtering by the
/// `CantHappen` layer. Returns `true` if at least one effect matches.
///
/// Mirrors Java `ReplacementHandler.cantHappenCheck()`.
pub fn cant_happen_check(game: &GameState, event: &ReplacementEvent) -> bool {
    let effects = collect_effects(game, event, ReplacementLayer::CantHappen);
    !effects.is_empty()
}

/// Apply replacement effects specifically for damage events.
///
/// Delegates to `apply_replacements`. This is a convenience entry point
/// matching Java's batch-damage processing path in `ReplacementHandler`.
///
/// Mirrors Java `ReplacementHandler.runReplaceDamage()`.
pub fn run_replace_damage(game: &mut GameState, event: &mut ReplacementEvent) -> ReplacementResult {
    apply_replacements(game, event)
}

/// Parse a raw `R$` replacement-effect line. Re-export of
/// `replacement_effect::parse_replacement_effect` for scan parity.
///
/// Mirrors Java `ReplacementHandler.parseReplacement()`.
pub fn parse_replacement(raw: &str) -> Option<ReplacementEffect> {
    super::replacement_effect::parse_replacement_effect(raw)
}

/// Check if any `BeginPhase` replacement effect in the `Control` layer would
/// skip the given phase for the given player.
///
/// Walks all battlefield cards looking for matching `BeginPhase` effects
/// with `Layer$ Control` (or `CantHappen`) whose `ActivePhases$` includes
/// the target phase and whose `ValidPlayer$` matches the player.
///
/// Mirrors Java `ReplacementHandler.wouldPhaseBeSkipped()`.
pub fn would_phase_be_skipped(game: &GameState, player: PlayerId, phase: PhaseType) -> bool {
    for card in game.cards.iter() {
        if card.zone != ZoneType::Battlefield {
            continue;
        }
        for re in &card.replacement_effects {
            if re.event != ReplacementType::BeginPhase {
                continue;
            }
            // Must be Control or CantHappen layer to skip a phase
            if re.layer != ReplacementLayer::Control && re.layer != ReplacementLayer::CantHappen {
                continue;
            }
            // Check ActivePhases$ matches the target phase
            if !re.matches_phase(phase) {
                continue;
            }
            // Check ValidPlayer$ matches the player
            if let Some(vp) = re.ir.valid_player_selector.as_ref() {
                if !re.matches_compiled_valid_player(vp, player, card) {
                    continue;
                }
            }
            return true;
        }
    }
    false
}

/// Check if any `BeginTurn` replacement effect in the `Other` layer would
/// skip an extra turn for the given player.
///
/// Mirrors Java `ReplacementHandler.wouldExtraTurnBeSkipped()`.
pub fn would_extra_turn_be_skipped(game: &GameState, player: PlayerId) -> bool {
    for card in game.cards.iter() {
        if card.zone != ZoneType::Battlefield {
            continue;
        }
        for re in &card.replacement_effects {
            if re.event != ReplacementType::BeginTurn {
                continue;
            }
            if re.layer != ReplacementLayer::Other && re.layer != ReplacementLayer::CantHappen {
                continue;
            }
            // Check ValidPlayer$ matches the player
            if let Some(vp) = re.ir.valid_player_selector.as_ref() {
                if !re.matches_compiled_valid_player(vp, player, card) {
                    continue;
                }
            }
            return true;
        }
    }
    false
}

/// Walk all battlefield cards and collect `(card_id, effect_index)` pairs for
/// replacement effects matching the given event type and optional layer.
///
/// This is the scan-parity equivalent of Java's `ReplacementHandler.visit()`.
pub fn visit(
    game: &GameState,
    event: &ReplacementType,
    layer: Option<ReplacementLayer>,
) -> Vec<(CardId, usize)> {
    let mut result = Vec::new();
    let mut global_idx = 0usize;

    for (i, card) in game.cards.iter().enumerate() {
        let card_id = CardId(i as u32);
        for re in &card.replacement_effects {
            let current_idx = global_idx;
            global_idx += 1;

            // Layer filter
            if let Some(target_layer) = layer {
                if re.layer != target_layer {
                    continue;
                }
            }
            // Zone filter — effect must be active in the card's current zone
            if !re.active_in_zone(card.zone) {
                continue;
            }
            // Mode check — effect's event must match the requested event
            if !re.mode_check(event) {
                continue;
            }
            // has_run check (always false in our architecture)
            if re.has_run() {
                continue;
            }
            // Requirements check
            if !re.requirements_check(game, card) {
                continue;
            }

            result.push((card_id, current_idx));
        }
    }

    result
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/// Collect all `(source_card_id, effect, effect_index)` triples that apply to `event` in `layer`.
///
/// Iterates over every card in the game and checks each of its replacement
/// effects.  Only effects whose source card is in an active zone are included.
///
/// The `effect_index` is a global unique index used for `has_run` tracking.
///
/// Mirrors `ReplacementHandler.getReplacementList()`.
fn collect_effects(
    game: &GameState,
    event: &ReplacementEvent,
    layer: ReplacementLayer,
) -> Vec<(CardId, ReplacementEffect, usize)> {
    let _perf_scope =
        crate::perf::ParamsLookupScopeGuard::enter(crate::perf::ParamsLookupScope::Replacement);
    use super::{
        replace_add_counter,
        // Format/mechanic-specific replacements
        replace_assemble_contraption,
        replace_assign_deal_damage,
        replace_attached,
        replace_begin_phase,
        replace_begin_turn,
        replace_cascade,
        replace_copy_spell,
        replace_counter,
        replace_damage,
        replace_dealt_damage,
        replace_declare_blocker,
        replace_destroy,
        replace_draw,
        replace_draw_cards,
        replace_explore,
        replace_gain_life,
        replace_game_loss,
        replace_game_win,
        replace_learn,
        replace_life_reduced,
        replace_lose_mana,
        replace_mill,
        replace_moved,
        replace_pay_life,
        replace_planar_dice_result,
        replace_planeswalk,
        replace_produce_mana,
        replace_proliferate,
        replace_remove_counter,
        replace_roll_dice,
        replace_roll_planar_dice,
        replace_scry,
        replace_set_in_motion,
        replace_tap,
        replace_token,
        replace_transform,
        replace_turn_face_up,
        replace_untap,
    };

    let mut result = Vec::new();
    for (i, card) in game.cards.iter().enumerate() {
        let card_id = CardId(i as u32);

        for (effect_idx_in_card, re) in card.replacement_effects.iter().enumerate() {
            let current_idx = effect_idx_in_card;
            // Layer filter.
            if re.layer != layer {
                continue;
            }
            // Zone filter — effect is only active when host is in a valid zone.
            if !re.active_in_zone(card.zone) {
                continue;
            }
            if !re.requirements_check(game, card) {
                continue;
            }
            // Dispatch to per-type module for applicability check.
            let applies = match re.event {
                ReplacementType::DamageDone => replace_damage::can_replace(re, event, game, card),
                ReplacementType::Draw => replace_draw::can_replace(re, event, game, card),
                ReplacementType::Destroy => replace_destroy::can_replace(re, event, game, card),
                ReplacementType::Moved => replace_moved::can_replace(re, event, game, card),
                ReplacementType::GainLife => replace_gain_life::can_replace(re, event, game, card),
                ReplacementType::CreateToken => replace_token::can_replace(re, event, game, card),
                ReplacementType::AddCounter => {
                    replace_add_counter::can_replace(re, event, game, card)
                }
                ReplacementType::GameLoss => replace_game_loss::can_replace(re, event, game, card),
                ReplacementType::GameWin => replace_game_win::can_replace(re, event, game, card),
                ReplacementType::Counter => replace_counter::can_replace(re, event, game, card),
                ReplacementType::ProduceMana => {
                    replace_produce_mana::can_replace(re, event, game, card)
                }
                // Format/mechanic-specific replacements
                ReplacementType::DrawCards => {
                    replace_draw_cards::can_replace(re, event, game, card)
                }
                ReplacementType::AssembleContraption => {
                    replace_assemble_contraption::can_replace(re, event, game, card)
                }
                ReplacementType::AssignDealDamage => {
                    replace_assign_deal_damage::can_replace(re, event, game, card)
                }
                ReplacementType::Attached => replace_attached::can_replace(re, event, game, card),
                ReplacementType::BeginPhase => {
                    replace_begin_phase::can_replace(re, event, game, card)
                }
                ReplacementType::BeginTurn => {
                    replace_begin_turn::can_replace(re, event, game, card)
                }
                ReplacementType::Cascade => replace_cascade::can_replace(re, event, game, card),
                ReplacementType::CopySpell => {
                    replace_copy_spell::can_replace(re, event, game, card)
                }
                ReplacementType::DealtDamage => {
                    replace_dealt_damage::can_replace(re, event, game, card)
                }
                ReplacementType::DeclareBlocker => {
                    replace_declare_blocker::can_replace(re, event, game, card)
                }
                ReplacementType::Explore => replace_explore::can_replace(re, event, game, card),
                ReplacementType::Learn => replace_learn::can_replace(re, event, game, card),
                ReplacementType::LifeReduced => {
                    replace_life_reduced::can_replace(re, event, game, card)
                }
                ReplacementType::LoseMana => replace_lose_mana::can_replace(re, event, game, card),
                ReplacementType::Mill => replace_mill::can_replace(re, event, game, card),
                ReplacementType::PayLife => replace_pay_life::can_replace(re, event, game, card),
                ReplacementType::PlanarDiceResult => {
                    replace_planar_dice_result::can_replace(re, event, game, card)
                }
                ReplacementType::Planeswalk => {
                    replace_planeswalk::can_replace(re, event, game, card)
                }
                ReplacementType::Proliferate => {
                    replace_proliferate::can_replace(re, event, game, card)
                }
                ReplacementType::RemoveCounter => {
                    replace_remove_counter::can_replace(re, event, game, card)
                }
                ReplacementType::RollDice => replace_roll_dice::can_replace(re, event, game, card),
                ReplacementType::RollPlanarDice => {
                    replace_roll_planar_dice::can_replace(re, event, game, card)
                }
                ReplacementType::Scry => replace_scry::can_replace(re, event, game, card),
                ReplacementType::SetInMotion => {
                    replace_set_in_motion::can_replace(re, event, game, card)
                }
                ReplacementType::Tap => replace_tap::can_replace(re, event, game, card),
                ReplacementType::Transform => replace_transform::can_replace(re, event, game, card),
                ReplacementType::TurnFaceUp => {
                    replace_turn_face_up::can_replace(re, event, game, card)
                }
                ReplacementType::Untap => replace_untap::can_replace(re, event, game, card),
                ReplacementType::Other(_) => false,
            };

            if applies {
                result.push((card_id, re.clone(), current_idx));
            }
        }
    }

    result
}

/// Execute a single replacement effect, mutating the event parameters.
///
/// Dispatches to the per-type module's `execute()` function.
///
/// Mirrors `ReplacementHandler.executeReplacement()`.
fn execute_effect(
    game: &mut GameState,
    card_id: CardId,
    effect: &ReplacementEffect,
    event: &mut ReplacementEvent,
    mut agents: Option<&mut [Box<dyn PlayerAgent>]>,
    runtime: Option<&mut ReplacementRuntime<'_>>,
) -> ReplacementResult {
    use super::{
        replace_add_counter,
        // Format/mechanic-specific replacements
        replace_assemble_contraption,
        replace_assign_deal_damage,
        replace_attached,
        replace_begin_phase,
        replace_begin_turn,
        replace_cascade,
        replace_copy_spell,
        replace_counter,
        replace_damage,
        replace_dealt_damage,
        replace_declare_blocker,
        replace_destroy,
        replace_draw,
        replace_draw_cards,
        replace_explore,
        replace_gain_life,
        replace_game_loss,
        replace_game_win,
        replace_learn,
        replace_life_reduced,
        replace_lose_mana,
        replace_mill,
        replace_moved,
        replace_pay_life,
        replace_planar_dice_result,
        replace_planeswalk,
        replace_produce_mana,
        replace_proliferate,
        replace_remove_counter,
        replace_roll_dice,
        replace_roll_planar_dice,
        replace_scry,
        replace_set_in_motion,
        replace_tap,
        replace_token,
        replace_transform,
        replace_turn_face_up,
        replace_untap,
    };

    if effect.ir.optional {
        let decider = optional_decider_for_effect(effect, game, card_id, event)
            .unwrap_or_else(|| affected_player_for_event(event, game));
        let host = game.card(card_id);
        let question = replacement_question(effect, host, game, event);
        let confirmed = if let Some(agents) = agents.as_deref_mut() {
            agents[decider.index()].confirm_replacement_effect(
                decider,
                &question,
                &effect.description(host, game),
                Some(card_id),
            )
        } else {
            true
        };
        if !confirmed {
            return ReplacementResult::NotReplaced;
        }
    }

    match effect.event {
        ReplacementType::DamageDone => replace_damage::execute(effect, event, game, card_id),
        ReplacementType::Draw => replace_draw::execute(effect, event, game, card_id),
        ReplacementType::Destroy => replace_destroy::execute(effect, event, game, card_id),
        ReplacementType::Moved => {
            replace_moved::execute(effect, event, game, card_id, agents, runtime)
        }
        ReplacementType::GainLife => replace_gain_life::execute(effect, event, game, card_id),
        ReplacementType::CreateToken => replace_token::execute(effect, event, game, card_id),
        ReplacementType::AddCounter => replace_add_counter::execute(effect, event, game, card_id),
        ReplacementType::GameLoss => replace_game_loss::execute(effect, event, game, card_id),
        ReplacementType::GameWin => replace_game_win::execute(effect, event, game, card_id),
        ReplacementType::Counter => replace_counter::execute(effect, event, game, card_id),
        ReplacementType::ProduceMana => replace_produce_mana::execute(effect, event, game, card_id),
        // Format/mechanic-specific replacements
        ReplacementType::DrawCards => replace_draw_cards::execute(effect, event, game, card_id),
        ReplacementType::AssembleContraption => {
            replace_assemble_contraption::execute(effect, event, game, card_id)
        }
        ReplacementType::AssignDealDamage => {
            replace_assign_deal_damage::execute(effect, event, game, card_id)
        }
        ReplacementType::Attached => replace_attached::execute(effect, event, game, card_id),
        ReplacementType::BeginPhase => replace_begin_phase::execute(effect, event, game, card_id),
        ReplacementType::BeginTurn => replace_begin_turn::execute(effect, event, game, card_id),
        ReplacementType::Cascade => replace_cascade::execute(effect, event, game, card_id),
        ReplacementType::CopySpell => replace_copy_spell::execute(effect, event, game, card_id),
        ReplacementType::DealtDamage => replace_dealt_damage::execute(effect, event, game, card_id),
        ReplacementType::DeclareBlocker => {
            replace_declare_blocker::execute(effect, event, game, card_id)
        }
        ReplacementType::Explore => replace_explore::execute(effect, event, game, card_id),
        ReplacementType::Learn => replace_learn::execute(effect, event, game, card_id),
        ReplacementType::LifeReduced => replace_life_reduced::execute(effect, event, game, card_id),
        ReplacementType::LoseMana => replace_lose_mana::execute(effect, event, game, card_id),
        ReplacementType::Mill => replace_mill::execute(effect, event, game, card_id),
        ReplacementType::PayLife => replace_pay_life::execute(effect, event, game, card_id),
        ReplacementType::PlanarDiceResult => {
            replace_planar_dice_result::execute(effect, event, game, card_id)
        }
        ReplacementType::Planeswalk => replace_planeswalk::execute(effect, event, game, card_id),
        ReplacementType::Proliferate => replace_proliferate::execute(effect, event, game, card_id),
        ReplacementType::RemoveCounter => {
            replace_remove_counter::execute(effect, event, game, card_id)
        }
        ReplacementType::RollDice => replace_roll_dice::execute(effect, event, game, card_id),
        ReplacementType::RollPlanarDice => {
            replace_roll_planar_dice::execute(effect, event, game, card_id)
        }
        ReplacementType::Scry => replace_scry::execute(effect, event, game, card_id),
        ReplacementType::SetInMotion => {
            replace_set_in_motion::execute(effect, event, game, card_id)
        }
        ReplacementType::Tap => replace_tap::execute(effect, event, game, card_id),
        ReplacementType::Transform => replace_transform::execute(effect, event, game, card_id),
        ReplacementType::TurnFaceUp => replace_turn_face_up::execute(effect, event, game, card_id),
        ReplacementType::Untap => replace_untap::execute(effect, event, game, card_id),
        ReplacementType::Other(_) => ReplacementResult::NotReplaced,
    }
}

fn optional_decider_for_effect(
    effect: &ReplacementEffect,
    game: &GameState,
    source_card_id: CardId,
    event: &ReplacementEvent,
) -> Option<PlayerId> {
    let expr = effect.ir.optional_decider_text.as_deref()?.trim();
    match expr {
        "You" | "Controller" => Some(game.card(source_card_id).controller),
        "Owner" => Some(game.card(source_card_id).owner),
        "Affected" | "AffectedController" => Some(affected_player_for_event(event, game)),
        "Opponent" => Some(game.opponent_of(game.card(source_card_id).controller)),
        _ => None,
    }
}

fn replacement_question(
    effect: &ReplacementEffect,
    host: &crate::card::Card,
    game: &GameState,
    event: &ReplacementEvent,
) -> String {
    // `description(host, game)` already handles CARDNAME/NICKNAME + text changes.
    let desc = effect.description(host, game);
    match event {
        ReplacementEvent::Moved { card, .. } => format!(
            "Apply {} to {}?\n{}",
            host.card_name,
            game.card(*card).card_name,
            desc
        ),
        _ => format!("Apply {}?\n{}", host.card_name, desc),
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use forge_foundation::{CardTypeLine, ColorSet, ManaCost};

    use crate::agent::PlayerAgent;
    use crate::card::Card;
    use crate::ids::{CardId, PlayerId};

    // ── Test helpers ──────────────────────────────────────────────────────

    fn make_game() -> GameState {
        GameState::new(&["Alice", "Bob"], 20)
    }

    fn add_creature_with_abilities(
        game: &mut GameState,
        owner: PlayerId,
        name: &str,
        abilities: Vec<String>,
    ) -> CardId {
        let card = Card::new(
            CardId(0), // placeholder; create_card assigns real ID
            name.to_string(),
            owner,
            CardTypeLine::parse("Creature - Bear"),
            ManaCost::parse("1 G"),
            ColorSet::GREEN,
            Some(2),
            Some(2),
            vec![],
            abilities,
        );
        game.create_card(card)
    }

    fn put_on_battlefield(game: &mut GameState, card_id: CardId, owner: PlayerId) {
        game.move_card(card_id, ZoneType::Battlefield, owner);
    }

    struct ConfirmReplacementAgent {
        confirm: bool,
    }

    impl PlayerAgent for ConfirmReplacementAgent {
        fn mulligan_decision(
            &mut self,
            _player: PlayerId,
            _hand: &[CardId],
            _mulligan_count: u32,
        ) -> bool {
            true
        }

        fn choose_action(
            &mut self,
            player: PlayerId,
            action_space: Option<&crate::agent::PriorityActionSpace>,
            request_action_space: &mut dyn FnMut() -> crate::agent::PriorityActionSpace,
        ) -> crate::player::actions::PlayerAction {
            crate::player::actions::PlayerAction::PassPriority
        }

        fn choose_attackers(
            &mut self,
            _player: PlayerId,
            _available: &[CardId],
            _possible_defenders: &[crate::combat::DefenderId],
        ) -> Vec<(CardId, crate::combat::DefenderId)> {
            vec![]
        }

        fn choose_blockers(
            &mut self,
            _player: PlayerId,
            _attackers: &[CardId],
            _available_blockers: &[CardId],
            _max_blockers: Option<usize>,
        ) -> Vec<(CardId, CardId)> {
            vec![]
        }

        fn choose_target_player(
            &mut self,
            _player: PlayerId,
            valid: &[PlayerId],
            _sa: Option<&crate::spellability::SpellAbility>,
        ) -> Option<PlayerId> {
            valid.first().copied()
        }

        fn choose_target_card(
            &mut self,
            _player: PlayerId,
            valid: &[CardId],
            _sa: Option<&crate::spellability::SpellAbility>,
        ) -> Option<CardId> {
            valid.first().copied()
        }

        fn choose_target_any(
            &mut self,
            _player: PlayerId,
            valid_players: &[PlayerId],
            valid_cards: &[CardId],
            _sa: Option<&crate::spellability::SpellAbility>,
        ) -> crate::agent::TargetChoice {
            if let Some(player) = valid_players.first() {
                crate::agent::TargetChoice::Player(*player)
            } else if let Some(card) = valid_cards.first() {
                crate::agent::TargetChoice::Card(*card)
            } else {
                crate::agent::TargetChoice::None
            }
        }

        fn choose_land_or_spell(&mut self, _player: PlayerId) -> Option<bool> {
            Some(true)
        }

        fn confirm_replacement_effect(
            &mut self,
            _player: PlayerId,
            _question: &str,
            _effect_description: &str,
            _source: Option<crate::ids::CardId>,
        ) -> bool {
            self.confirm
        }

        fn choose_targets_for(
            &mut self,
            _sa: &mut crate::spellability::SpellAbility,
            _game: &GameState,
            _mana_pools: &[ManaPool],
        ) -> bool {
            false
        }
    }

    // ── Draw replacement tests ────────────────────────────────────────────

    #[test]
    fn draw_skip_for_controller() {
        let mut game = make_game();
        let alice = PlayerId(0);
        // Card with "skip your draw step" effect.
        let cid = add_creature_with_abilities(
            &mut game,
            alice,
            "SkipDraw",
            vec!["R$ Event$ Draw | ValidPlayer$ You | Prevent$ True".to_string()],
        );
        put_on_battlefield(&mut game, cid, alice);

        let mut event = ReplacementEvent::Draw {
            player: alice,
            extra_draws: 0,
            is_first_in_draw_step: false,
        };
        let result = apply_replacements(&mut game, &mut event);
        assert_eq!(result, ReplacementResult::Skipped);
    }

    #[test]
    fn draw_not_skipped_for_opponent() {
        let mut game = make_game();
        let alice = PlayerId(0);
        let bob = PlayerId(1);
        let cid = add_creature_with_abilities(
            &mut game,
            alice,
            "SkipDraw",
            vec!["R$ Event$ Draw | ValidPlayer$ You | Prevent$ True".to_string()],
        );
        put_on_battlefield(&mut game, cid, alice);

        // Bob's draw is not affected by Alice's effect.
        let mut event = ReplacementEvent::Draw {
            player: bob,
            extra_draws: 0,
            is_first_in_draw_step: false,
        };
        let result = apply_replacements(&mut game, &mut event);
        assert_eq!(result, ReplacementResult::NotReplaced);
    }

    #[test]
    fn draw_not_applied_when_card_not_on_battlefield() {
        let mut game = make_game();
        let alice = PlayerId(0);
        let cid = add_creature_with_abilities(
            &mut game,
            alice,
            "SkipDraw",
            vec![
                "R$ Event$ Draw | ActiveZones$ Battlefield | ValidPlayer$ You | Prevent$ True"
                    .to_string(),
            ],
        );
        // Card stays in hand, not battlefield.
        game.move_card(cid, ZoneType::Hand, alice);

        let mut event = ReplacementEvent::Draw {
            player: alice,
            extra_draws: 0,
            is_first_in_draw_step: false,
        };
        let result = apply_replacements(&mut game, &mut event);
        assert_eq!(result, ReplacementResult::NotReplaced);
    }

    // ── Damage prevention tests ───────────────────────────────────────────

    #[test]
    fn damage_to_player_prevented() {
        let mut game = make_game();
        let alice = PlayerId(0);
        // "Prevent all damage dealt to you."
        let cid = add_creature_with_abilities(
            &mut game,
            alice,
            "Shield",
            vec!["R$ Event$ DamageDone | ValidTarget$ Player | Prevent$ True".to_string()],
        );
        put_on_battlefield(&mut game, cid, alice);

        let mut event = ReplacementEvent::DamageToPlayer {
            target: alice,
            amount: 5,
            source: None,
            is_combat: false,
        };
        let result = apply_replacements(&mut game, &mut event);
        assert_eq!(result, ReplacementResult::Prevented);
        // Amount should be zeroed out.
        if let ReplacementEvent::DamageToPlayer { amount, .. } = event {
            assert_eq!(amount, 0);
        } else {
            panic!("unexpected event type");
        }
    }

    #[test]
    fn damage_zero_not_replaced() {
        let mut game = make_game();
        let alice = PlayerId(0);
        let cid = add_creature_with_abilities(
            &mut game,
            alice,
            "Shield",
            vec!["R$ Event$ DamageDone | ValidTarget$ Player | Prevent$ True".to_string()],
        );
        put_on_battlefield(&mut game, cid, alice);

        // Zero damage — effect should not apply.
        let mut event = ReplacementEvent::DamageToPlayer {
            target: alice,
            amount: 0,
            source: None,
            is_combat: false,
        };
        let result = apply_replacements(&mut game, &mut event);
        assert_eq!(result, ReplacementResult::NotReplaced);
    }

    #[test]
    fn damage_to_card_prevented() {
        let mut game = make_game();
        let alice = PlayerId(0);
        let shield = add_creature_with_abilities(
            &mut game,
            alice,
            "Shield",
            vec!["R$ Event$ DamageDone | ValidTarget$ Card | Prevent$ True".to_string()],
        );
        put_on_battlefield(&mut game, shield, alice);

        let target_creature = add_creature_with_abilities(&mut game, alice, "Target", vec![]);
        put_on_battlefield(&mut game, target_creature, alice);

        let mut event = ReplacementEvent::DamageToCard {
            target: target_creature,
            amount: 3,
            source: None,
            is_combat: false,
        };
        let result = apply_replacements(&mut game, &mut event);
        assert_eq!(result, ReplacementResult::Prevented);
        if let ReplacementEvent::DamageToCard { amount, .. } = event {
            assert_eq!(amount, 0);
        } else {
            panic!("unexpected event type");
        }
    }

    #[test]
    fn damage_replace_with_can_increase_amount() {
        let mut game = make_game();
        let alice = PlayerId(0);
        let bob = PlayerId(1);

        let replacer = add_creature_with_abilities(
            &mut game,
            alice,
            "Boss",
            vec![
                "R$ Event$ DamageDone | ActiveZones$ Battlefield | ValidSource$ Card.YouCtrl | ValidTarget$ Player.Opponent | ReplaceWith$ DmgPlus".to_string(),
            ],
        );
        game.card_mut(replacer).set_s_var(
            "DmgPlus",
            "DB$ ReplaceEffect | VarName$ DamageAmount | VarValue$ ReplaceCount$DamageAmount/Plus.1",
        );
        put_on_battlefield(&mut game, replacer, alice);

        let source = add_creature_with_abilities(&mut game, alice, "Source", vec![]);
        put_on_battlefield(&mut game, source, alice);

        let mut event = ReplacementEvent::DamageToPlayer {
            target: bob,
            amount: 2,
            source: Some(source),
            is_combat: false,
        };
        let _ = apply_replacements(&mut game, &mut event);
        if let ReplacementEvent::DamageToPlayer { amount, .. } = event {
            assert_eq!(amount, 3);
        } else {
            panic!("unexpected event type");
        }
    }

    #[test]
    fn damage_replace_with_respects_max_speed() {
        let mut game = make_game();
        let alice = PlayerId(0);
        let bob = PlayerId(1);
        game.player_mut(alice).speed = 4;

        let replacer = add_creature_with_abilities(
            &mut game,
            alice,
            "Far Fortune",
            vec![
                "R$ Event$ DamageDone | MaxSpeed$ True | ActiveZones$ Battlefield | ValidSource$ Card.YouCtrl | ValidTarget$ Player.Opponent | ReplaceWith$ DmgPlus".to_string(),
            ],
        );
        game.card_mut(replacer).set_s_var(
            "DmgPlus",
            "DB$ ReplaceEffect | VarName$ DamageAmount | VarValue$ ReplaceCount$DamageAmount/Plus.1",
        );
        put_on_battlefield(&mut game, replacer, alice);

        let source = add_creature_with_abilities(&mut game, alice, "Source", vec![]);
        put_on_battlefield(&mut game, source, alice);

        let mut event = ReplacementEvent::DamageToPlayer {
            target: bob,
            amount: 1,
            source: Some(source),
            is_combat: false,
        };
        let _ = apply_replacements(&mut game, &mut event);
        if let ReplacementEvent::DamageToPlayer { amount, .. } = event {
            assert_eq!(amount, 2);
        } else {
            panic!("unexpected event type");
        }
    }

    #[test]
    fn roll_dice_replace_with_updates_number_and_ignore() {
        let mut game = make_game();
        let alice = PlayerId(0);

        let replacer = add_creature_with_abilities(
            &mut game,
            alice,
            "Barbarian Class",
            vec![
                "R$ Event$ RollDice | ActiveZones$ Battlefield | ValidPlayer$ You | ReplaceWith$ PlusRoll".to_string(),
            ],
        );
        game.card_mut(replacer).set_s_var(
            "PlusRoll",
            "DB$ ReplaceEffect | VarName$ Number | VarValue$ ReplaceCount$Number/Plus.1 | SubAbility$ IgnoreLowest",
        );
        game.card_mut(replacer).set_s_var(
            "IgnoreLowest",
            "DB$ ReplaceEffect | VarName$ Ignore | VarValue$ ReplaceCount$Ignore/Plus.1",
        );
        put_on_battlefield(&mut game, replacer, alice);

        let mut event = ReplacementEvent::RollDice {
            player: alice,
            sides: 20,
            number: 1,
            ignore: 0,
            ignore_chosen: HashMap::new(),
            dice_pt_exchanges: HashSet::new(),
        };
        let result = apply_replacements(&mut game, &mut event);
        assert_eq!(result, ReplacementResult::Updated);
        if let ReplacementEvent::RollDice { number, ignore, .. } = event {
            assert_eq!(number, 2);
            assert_eq!(ignore, 1);
        } else {
            panic!("unexpected event type");
        }
    }

    #[test]
    fn roll_dice_replace_with_updates_ignore_chosen_map() {
        let mut game = make_game();
        let alice = PlayerId(0);

        let replacer = add_creature_with_abilities(
            &mut game,
            alice,
            "Bamboozling Beeble",
            vec![
                "R$ Event$ RollDice | ActiveZones$ Battlefield | ValidPlayer$ You | ReplaceWith$ RigRoll".to_string(),
            ],
        );
        game.card_mut(replacer).set_s_var(
            "RigRoll",
            "DB$ ReplaceEffect | VarName$ IgnoreChosen | VarType$ Map | VarKey$ You | VarValue$ 1",
        );
        put_on_battlefield(&mut game, replacer, alice);

        let mut event = ReplacementEvent::RollDice {
            player: alice,
            sides: 6,
            number: 2,
            ignore: 0,
            ignore_chosen: HashMap::new(),
            dice_pt_exchanges: HashSet::new(),
        };
        let result = apply_replacements(&mut game, &mut event);
        assert_eq!(result, ReplacementResult::Updated);
        if let ReplacementEvent::RollDice { ignore_chosen, .. } = event {
            assert_eq!(ignore_chosen.get(&alice), Some(&1));
        } else {
            panic!("unexpected event type");
        }
    }

    #[test]
    fn roll_dice_replace_with_updates_dice_pt_exchange_set() {
        let mut game = make_game();
        let alice = PlayerId(0);

        let replacer = add_creature_with_abilities(
            &mut game,
            alice,
            "Vedalken Squirrel-Whacker",
            vec![
                "R$ Event$ RollDice | ActiveZones$ Battlefield | ValidPlayer$ You | ValidSides$ 6 | ReplaceWith$ SwapRoll".to_string(),
            ],
        );
        game.card_mut(replacer).set_s_var(
            "SwapRoll",
            "DB$ ReplaceEffect | VarName$ DicePTExchanges | VarType$ CardSet | VarValue$ Self",
        );
        put_on_battlefield(&mut game, replacer, alice);

        let mut event = ReplacementEvent::RollDice {
            player: alice,
            sides: 6,
            number: 2,
            ignore: 0,
            ignore_chosen: HashMap::new(),
            dice_pt_exchanges: HashSet::new(),
        };
        let result = apply_replacements(&mut game, &mut event);
        assert_eq!(result, ReplacementResult::Updated);
        if let ReplacementEvent::RollDice {
            dice_pt_exchanges, ..
        } = event
        {
            assert!(dice_pt_exchanges.contains(&replacer));
        } else {
            panic!("unexpected event type");
        }
    }

    // ── Destroy replacement tests ─────────────────────────────────────────

    #[test]
    fn indestructible_destroy_replaced() {
        let mut game = make_game();
        let alice = PlayerId(0);
        // Indestructible: "If ~ would be destroyed, instead it isn't."
        let cid = add_creature_with_abilities(
            &mut game,
            alice,
            "Indestructible Bear",
            vec!["R$ Event$ Destroy | ValidCard$ Card.Self".to_string()],
        );
        put_on_battlefield(&mut game, cid, alice);

        let mut event = ReplacementEvent::Destroy { target: cid };
        let result = apply_replacements(&mut game, &mut event);
        assert_eq!(result, ReplacementResult::Replaced);
    }

    #[test]
    fn destroy_not_replaced_for_other_card() {
        let mut game = make_game();
        let alice = PlayerId(0);
        // Indestructible creature — protects only itself.
        let indestructible = add_creature_with_abilities(
            &mut game,
            alice,
            "Indestructible Bear",
            vec!["R$ Event$ Destroy | ValidCard$ Card.Self".to_string()],
        );
        let other = add_creature_with_abilities(&mut game, alice, "Mortal Bear", vec![]);
        put_on_battlefield(&mut game, indestructible, alice);
        put_on_battlefield(&mut game, other, alice);

        let mut event = ReplacementEvent::Destroy { target: other };
        let result = apply_replacements(&mut game, &mut event);
        assert_eq!(result, ReplacementResult::NotReplaced);
    }

    // ── Moved replacement tests ───────────────────────────────────────────

    #[test]
    fn moved_destination_updated_to_exile() {
        let mut game = make_game();
        let alice = PlayerId(0);
        // "If ~ would be put into a graveyard from the battlefield, exile it instead."
        let cid = add_creature_with_abilities(
            &mut game,
            alice,
            "Exile Bear",
            vec!["R$ Event$ Moved | Destination$ Graveyard | Origin$ Battlefield | ValidCard$ Card.Self | NewDestination$ Exile".to_string()],
        );
        put_on_battlefield(&mut game, cid, alice);

        let mut event = ReplacementEvent::Moved {
            card: cid,
            origin: ZoneType::Battlefield,
            destination: ZoneType::Graveyard,
            is_discard: false,
        };
        let result = apply_replacements(&mut game, &mut event);
        assert_eq!(result, ReplacementResult::Updated);
        if let ReplacementEvent::Moved { destination, .. } = event {
            assert_eq!(destination, ZoneType::Exile);
        } else {
            panic!("unexpected event type");
        }
    }

    #[test]
    fn moved_not_replaced_wrong_origin() {
        let mut game = make_game();
        let alice = PlayerId(0);
        let cid = add_creature_with_abilities(
            &mut game,
            alice,
            "Exile Bear",
            vec!["R$ Event$ Moved | Destination$ Graveyard | Origin$ Battlefield | ValidCard$ Card.Self | NewDestination$ Exile".to_string()],
        );
        put_on_battlefield(&mut game, cid, alice);

        // Card moving from Hand → Graveyard: Origin doesn't match Battlefield.
        let mut event = ReplacementEvent::Moved {
            card: cid,
            origin: ZoneType::Hand,
            destination: ZoneType::Graveyard,
            is_discard: false,
        };
        let result = apply_replacements(&mut game, &mut event);
        assert_eq!(result, ReplacementResult::NotReplaced);
    }

    #[test]
    fn declined_optional_replacement_falls_through_to_next_candidate() {
        let mut game = make_game();
        let alice = PlayerId(0);
        let cid = add_creature_with_abilities(
            &mut game,
            alice,
            "Optional Bear",
            vec![
                "R$ Event$ Moved | Destination$ Graveyard | Origin$ Battlefield | ValidCard$ Card.Self | Optional$ True | OptionalDecider$ You | NewDestination$ Command".to_string(),
                "R$ Event$ Moved | Destination$ Graveyard | Origin$ Battlefield | ValidCard$ Card.Self | NewDestination$ Exile".to_string(),
            ],
        );
        put_on_battlefield(&mut game, cid, alice);

        let mut agents: Vec<Box<dyn PlayerAgent>> = vec![
            Box::new(ConfirmReplacementAgent { confirm: false }),
            Box::new(ConfirmReplacementAgent { confirm: false }),
        ];
        let mut event = ReplacementEvent::Moved {
            card: cid,
            origin: ZoneType::Battlefield,
            destination: ZoneType::Graveyard,
            is_discard: false,
        };
        let result = apply_replacements_with_agents(&mut game, agents.as_mut_slice(), &mut event);
        assert_eq!(result, ReplacementResult::Updated);
        if let ReplacementEvent::Moved { destination, .. } = event {
            assert_eq!(destination, ZoneType::Exile);
        } else {
            panic!("unexpected event type");
        }
    }

    #[test]
    fn accepted_optional_replacement_updates_destination() {
        let mut game = make_game();
        let alice = PlayerId(0);
        let cid = add_creature_with_abilities(
            &mut game,
            alice,
            "Optional Bear",
            vec![
                "R$ Event$ Moved | Destination$ Graveyard | Origin$ Battlefield | ValidCard$ Card.Self | Optional$ True | OptionalDecider$ You | NewDestination$ Command".to_string(),
            ],
        );
        put_on_battlefield(&mut game, cid, alice);

        let mut agents: Vec<Box<dyn PlayerAgent>> = vec![
            Box::new(ConfirmReplacementAgent { confirm: true }),
            Box::new(ConfirmReplacementAgent { confirm: true }),
        ];
        let mut event = ReplacementEvent::Moved {
            card: cid,
            origin: ZoneType::Battlefield,
            destination: ZoneType::Graveyard,
            is_discard: false,
        };
        let result = apply_replacements_with_agents(&mut game, agents.as_mut_slice(), &mut event);
        assert_eq!(result, ReplacementResult::Updated);
        if let ReplacementEvent::Moved { destination, .. } = event {
            assert_eq!(destination, ZoneType::Command);
        } else {
            panic!("unexpected event type");
        }
    }

    // ── No effects test ───────────────────────────────────────────────────

    #[test]
    fn no_effects_returns_not_replaced() {
        let mut game = make_game();
        let mut event = ReplacementEvent::Draw {
            player: PlayerId(0),
            extra_draws: 0,
            is_first_in_draw_step: false,
        };
        let result = apply_replacements(&mut game, &mut event);
        assert_eq!(result, ReplacementResult::NotReplaced);
    }
}
