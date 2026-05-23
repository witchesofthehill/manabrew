//! Replacement effect parsing and types.
//!
//! Mirrors the Java Forge `forge/game/replacement/` package, specifically
//! `ReplacementEffect.java`.
//!
//! Card scripts encode replacement effects as `R$`-prefixed lines, e.g.:
//! ```text
//! R$ Event$ DamageDone | ActiveZones$ Battlefield | ValidCard$ Card.Self | Prevent$ True | Description$ Prevent all damage dealt to ~.
//! R$ Event$ Draw | ValidPlayer$ You | Description$ Skip your draw step.
//! R$ Event$ Moved | Destination$ Graveyard | Origin$ Battlefield | ValidCard$ Card.Self | Description$ If ~ would die, exile it instead.
//! R$ Event$ Destroy | ValidCard$ Card.Self | Description$ ~ is indestructible.
//! ```

use forge_foundation::{PhaseType, ZoneType};
use serde::{Deserialize, Serialize};

use crate::ability::ability_factory::build_spell_ability;
use crate::ability::AbilityKey;
use crate::card::valid_filter::CardTraitRequirementsIr;
use crate::card::Card;
use crate::card_trait_base::{CardTrait, CardTraitBase, CardTraitIrOwner};
use crate::core::HasSVars;
use crate::game::GameState;
use crate::game_loop::trigger_replacement_base::TriggerReplacementBase;
use crate::ids::{CardId, PlayerId};
use crate::parsing::{keys, CompiledSelector, Params};
pub use crate::player::GameLossReason;

use super::replacement_handler::ReplacementEvent;
use crate::spellability::SpellAbility;

// Re-export so existing `use crate::replacement::replacement_effect::{ReplacementType, ReplacementLayer}`
// paths keep working.
pub use super::replacement_layer::ReplacementLayer;
pub use super::replacement_type::ReplacementType;

// ── ReplacementEffect ─────────────────────────────────────────────────────────

/// A parsed replacement effect from an `R$` line in a card script.
///
/// Reference: Java `ReplacementEffect.java` in `forge/game/replacement/`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplacementEffect {
    /// Shared trait base (host card, sVars, text-changes, map params).
    /// Mirrors Java `ReplacementEffect extends TriggerReplacementBase extends CardTraitBase`.
    /// Currently default-initialized by the parser; card factory population is
    /// a follow-up parity task so that `matches_valid_param` picks up
    /// `Invert*` entries from `map_params`.
    ///
    /// Boxed because `CardState` holds five inline `Option<ReplacementEffect>`
    /// fields (`loyalty_rep`, `defense_rep`, `saga_rep`, `adventure_rep`,
    /// `omen_rep`) and `TriggerReplacementBase → CardTraitBase` contains an
    /// `Option<CardState>`, which would otherwise form an infinite-sized
    /// type. `Trigger` does not need this because `CardState` only owns
    /// triggers via `Vec` (heap indirection already).
    #[serde(skip, default)]
    pub base: Box<TriggerReplacementBase>,
    /// The event type this effect intercepts.
    pub event: ReplacementType,
    /// The CR 616 layer this effect belongs to.
    pub layer: ReplacementLayer,
    /// Typed runtime view of lowered replacement semantics.
    pub ir: ReplacementEffectIr,
    /// Zones where this effect is active. Empty = active everywhere.
    /// Parsed from `ActiveZones$` parameter.
    /// TODO(java-parity): collapse into `base.valid_host_zones`.
    pub active_zones: Vec<ZoneType>,
    /// Temporary suppression flag used by effects like commander replacement.
    #[serde(default)]
    pub suppressed: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ReplacementEffectIr {
    #[serde(skip, default)]
    pub card_trait_requirements: CardTraitRequirementsIr,
    pub replace_with: Option<String>,
    pub description_text: Option<String>,
    pub player_turn_text: Option<String>,
    pub new_destination_text: Option<String>,
    pub new_destination_zone: Option<ZoneType>,
    pub origin_text: Option<String>,
    pub origin_zone: Option<ZoneType>,
    pub destination_text: Option<String>,
    pub destination_zone: Option<ZoneType>,
    pub exclude_destination_text: Option<String>,
    pub valid_card_text: Option<String>,
    pub valid_card_selector: Option<CompiledSelector>,
    pub valid_player_text: Option<String>,
    pub valid_player_selector: Option<CompiledSelector>,
    pub valid_target_selector: Option<CompiledSelector>,
    pub valid_source_selector: Option<CompiledSelector>,
    pub valid_activator_text: Option<String>,
    pub valid_step_turn_to_controller_text: Option<String>,
    pub valid_explorer_text: Option<String>,
    pub valid_counter_type_text: Option<String>,
    pub valid_lose_reason_text: Option<String>,
    pub valid_sides_text: Option<String>,
    pub active_phases: Vec<PhaseType>,
    pub amount_text: Option<String>,
    pub damage_amount_text: Option<String>,
    pub result_text: Option<String>,
    pub number_text: Option<String>,
    pub dredge_amount: Option<usize>,
    pub skip: bool,
    pub prevent: bool,
    pub optional: bool,
    pub effect_only: bool,
    pub discard: Option<bool>,
    pub flashback_cast: Option<bool>,
    pub harmonize_cast: Option<bool>,
    pub not_first_card_in_draw_step: bool,
    pub exiled_with_effect_source: bool,
    pub is_combat: Option<bool>,
    pub is_damage: Option<bool>,
    pub max_speed: Option<bool>,
    pub replacement_result: Option<String>,
    pub optional_decider_text: Option<String>,
    pub replace_mana_text: Option<String>,
    pub replace_type_text: Option<String>,
    pub replace_color_text: Option<String>,
    pub replace_only_text: Option<String>,
    pub replace_amount_text: Option<String>,
    pub valid_lki_text: Option<String>,
    pub counter_map: bool,
    pub replace_with_chain: Option<ReplacementChainIr>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ReplacementChainIr {
    ReplaceToken {
        token_type: Option<String>,
        amount_expr: Option<String>,
    },
    ReplaceCounter {
        amount_expr: String,
    },
    ReplaceEffect {
        var_name: Option<String>,
        var_type: Option<String>,
        var_key: Option<String>,
        var_value: Option<String>,
        sub_ability: Option<Box<ReplacementChainIr>>,
    },
}

impl CardTrait for ReplacementEffect {
    fn base(&self) -> &CardTraitBase {
        &self.base.card_trait_base
    }
}

impl CardTraitIrOwner for ReplacementEffect {
    type Ir = ReplacementEffectIr;

    fn ir(&self) -> &Self::Ir {
        &self.ir
    }

    fn card_trait_requirements(&self) -> &CardTraitRequirementsIr {
        &self.ir.card_trait_requirements
    }
}

impl ReplacementEffect {
    /// Attach the host card id on the embedded trait base. Mirrors Java's
    /// inherited `CardTraitBase.setHostCard(host)` — called from the
    /// `ReplacementEffect` constructor (`ReplacementEffect.java:107`) so
    /// a freshly-constructed effect is always host-bound.
    ///
    /// In Rust the parser builds an unbound effect first (parser doesn't
    /// have a `Card` handle) and every insertion site
    /// (`card_state::add_replacement_effect`, keyword grants, factory
    /// helpers) routes through this method to bind the host. After this
    /// call, `CardTrait` machinery can stop threading explicit `host: &Card`
    /// args. `TriggerReplacementBase::set_host_card` also propagates the
    /// host into any cached overriding ability.
    pub fn set_host_card(&mut self, host: &Card) {
        self.ir.replace_with_chain = self
            .replace_with()
            .and_then(|svar_name| host.get_svar(svar_name))
            .and_then(|raw| parse_replacement_chain(raw, host));
        self.base.set_host_card_id(host.id);
    }
}

impl ReplacementEffect {
    pub fn new(
        event: ReplacementType,
        layer: ReplacementLayer,
        params: Params,
        active_zones: Vec<ZoneType>,
    ) -> Self {
        let mut effect = Self {
            base: Box::new(TriggerReplacementBase::default()),
            event,
            layer,
            ir: ReplacementEffectIr::from_params(&params),
            active_zones,
            suppressed: false,
        };
        effect.sync_trait_base_params(&params);
        effect
    }

    pub fn replace_with(&self) -> Option<&str> {
        self.ir.replace_with.as_deref()
    }

    pub fn has_skip(&self) -> bool {
        self.ir.skip
    }

    pub fn prevents(&self) -> bool {
        self.ir.prevent
    }

    pub fn matches_phase(&self, phase: PhaseType) -> bool {
        self.ir.active_phases.is_empty() || self.ir.active_phases.contains(&phase)
    }

    fn sync_trait_base_params(&mut self, params: &Params) {
        let map = params
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        self.base.card_trait_base.set_map_params(map);
    }

    /// Returns `true` if this effect is active while the source card is in `zone`.
    ///
    /// An empty `active_zones` list means the effect is always active (mirrors
    /// Java `zonesCheck()` returning `true` when `activeZones` is empty).
    pub fn active_in_zone(&self, zone: ZoneType) -> bool {
        !self.suppressed && (self.active_zones.is_empty() || self.active_zones.contains(&zone))
    }

    /// Human-readable description. Mirrors Java `ReplacementEffect.getDescription()`.
    ///
    /// - Suppressed or missing `Description$` → empty string.
    /// - Applies text-change effects carried on the trait (Glamerdye / Crystal
    ///   Spray word-swaps).
    /// - Substitutes `CARDNAME` and `NICKNAME` with the host's name.
    /// - Substitutes `EFFECTSOURCE` with the card that created this host via
    ///   `effect_source` (token makers, emblems, etc.).
    /// - For `DamageDone` replacements whose overriding `SpellAbility` uses
    ///   `AB$ ReplaceDamage` / `AB$ ReplaceSplitDamage`, appends
    ///   `"Shields remain: N"` when the `Amount$` / `VarName$` SVar resolves
    ///   to `Number$<n>`. Only fires when the SA is already cached on the
    ///   base (matches Java's `getOverridingAbility()` not `ensureAbility()`).
    ///
    /// Multi-locale translation is UI-layer and intentionally skipped.
    pub fn description(&self, host: &Card, game: &GameState) -> String {
        if self.suppressed || self.base.card_trait_base.is_suppressed() {
            return String::new();
        }
        let Some(raw) = self.ir.description_text.as_deref() else {
            return String::new();
        };
        let mut desc =
            crate::ability::ability_utils::apply_description_text_change_effects(raw, host);
        desc = desc.replace("CARDNAME", &host.card_name);
        // Nickname localization isn't ported; fall back to the card name
        // (matches `spell_ability_effect::tokenize_description`).
        desc = desc.replace("NICKNAME", &host.card_name);
        if desc.contains("EFFECTSOURCE") {
            let source_name = host
                .effect_source
                .map(|id| game.card(id).card_name.clone())
                .unwrap_or_else(|| host.card_name.clone());
            desc = desc.replace("EFFECTSOURCE", &source_name);
        }

        // DamageDone shield-remaining appendix (Java L228-253).
        if self.event == ReplacementType::DamageDone {
            if let Some(rep_sa) = self.base.get_overriding_ability() {
                desc = append_shield_remaining(desc, rep_sa, host);
            }
        }

        desc
    }

    /// Always `false`. Java's `ReplacementEffect.hasRun` is a per-effect flag
    /// used mainly during `otherChoices` resolution (Java gap #2 here). Our
    /// per-event chain uses `ReplacementHandler.has_run` instead, and a new
    /// handler is constructed by `apply_replacements` per event — so stale
    /// run-marks never leak across events. Revisit when `otherChoices` lands
    /// (a nested choice flow is the only path that needs the per-effect flag).
    pub fn has_run(&self) -> bool {
        false
    }

    /// Check requirements for this replacement effect against the current game state.
    pub fn requirements_check(&self, game: &GameState, source: &Card) -> bool {
        if self.suppressed || self.base.card_trait_base.is_suppressed() {
            return false;
        }

        if let Some(pt) = self.ir.player_turn_text.as_deref() {
            if pt == "True" {
                if game.active_player() != source.controller {
                    return false;
                }
            } else {
                let players = crate::ability::ability_utils::resolve_defined_players(
                    pt,
                    source.controller,
                    game,
                );
                if !players.contains(&game.active_player()) {
                    return false;
                }
            }
        }

        // ActivePhases$ — current phase must be in the listed phases.
        if !self.matches_phase(game.turn.phase) {
            return false;
        }

        self.meets_card_trait_requirements(game, source, source)
    }

    /// Clone this replacement effect. Since `ReplacementEffect` derives `Clone`,
    /// this delegates to `self.clone()`.
    ///
    /// Mirrors Java `ReplacementEffect.copy()`.
    pub fn copy(&self) -> Self {
        self.clone()
    }

    /// Mirrors Java `ReplacementEffect.ensureAbility()`:
    ///
    /// 1. If an overriding `SpellAbility` is already cached on the base, return
    ///    a clone of it.
    /// 2. Otherwise, if `ReplaceWith$` is set, look up the named SVar on the
    ///    host card, parse it via `AbilityFactory.getAbility()` (the Rust
    ///    equivalent is `build_spell_ability`), and return the built ability.
    ///
    /// This variant does NOT cache the built ability (const receiver). Use
    /// `ensure_ability_mut` to lazily cache on the base, matching Java's
    /// `setOverridingAbility(sa)` call inside `ensureAbility`.
    pub fn ensure_ability(
        &self,
        game: &GameState,
        host_card: CardId,
        activating_player: PlayerId,
    ) -> Option<SpellAbility> {
        if let Some(overriding) = self.base.get_overriding_ability() {
            return Some(overriding.clone());
        }
        let svar_name = self.replace_with()?;
        let host = game.card(host_card);
        let script = host.get_svar(svar_name)?;
        Some(build_spell_ability(
            game,
            host_card,
            script,
            activating_player,
        ))
    }

    /// Mirrors Java `ReplacementEffect.ensureAbility()` including the cache
    /// write (Java calls `setOverridingAbility(sa)` on first build). Returns
    /// a mutable reference to the cached ability so callers can mutate
    /// trigger payloads before resolution.
    pub fn ensure_ability_mut(
        &mut self,
        game: &GameState,
        host_card: CardId,
        activating_player: PlayerId,
    ) -> Option<&mut SpellAbility> {
        if self.base.get_overriding_ability().is_none() {
            let ability = self.ensure_ability(game, host_card, activating_player)?;
            // Store directly. The built ability is already host-bound by
            // `build_spell_ability`.
            self.base.overriding_ability = Some(ability);
        }
        self.base.overriding_ability.as_mut()
    }

    /// Filter for ETB replacement events. Mirrors Java
    /// `ReplacementEffect.canReplaceETB(runParams)` (L321-345).
    ///
    /// Returns `false` (skip) when the effect targets things OTHER than itself
    /// (`ValidCard$` is not `Card.Self`-prefixed) AND the affected card IS
    /// the host card — i.e. the effect would be replacing its own ETB.
    /// Otherwise returns `true`.
    ///
    /// Not yet ported: Java's second guard reads `AbilityKey.LastStateBattlefield`
    /// to also skip when the host wasn't on the battlefield before this
    /// Moved event. Rust doesn't snapshot the previous battlefield state for
    /// replacement resolution, so that branch is omitted. Effects whose host
    /// just entered may still slip through in narrow nested ETB scenarios.
    pub fn can_replace_etb(&self, source: &Card, affected: &Card) -> bool {
        let targets_self_only = self
            .ir
            .valid_card_text
            .as_deref()
            .map(|v| v.starts_with("Card.Self"))
            .unwrap_or(false);
        if !targets_self_only && source.id == affected.id {
            return false;
        }
        true
    }

    /// Mirrors Java `ReplacementEffect.setReplacingObjects(runParams, sa)`.
    /// Java's base method is an empty default overridden by each concrete
    /// subclass (`ReplaceMoved`, `ReplaceDamage`, `ReplaceAddCounter`, …).
    /// Rust has no subclasses; the match on `self.event` fills the same role
    /// by dispatching per event type inline.
    ///
    /// The sub-ability walk is a Rust-ism — Java's resolver inherits the
    /// triggering/replacing maps from the parent SA automatically, while the
    /// Rust `SpellAbility` resolver reads directly from each node. Writing
    /// to every node keeps `Defined$ ReplacedCard`-style lookups working
    /// inside `SubAbility$` chains (Rust stores these under
    /// `sa.trigger_objects`; Java keeps `replacingObjects` separate).
    ///
    /// Scope note: today this only runs on event paths that actually build a
    /// `SpellAbility` and resolve it through the SA resolver — currently just
    /// `replace_moved::execute`. Other handlers mutate events inline via
    /// `execute_replace_effect_chain` and bypass this hook. Migrate those
    /// paths first before adding their cases here.
    pub fn set_replacing_objects(
        &self,
        event: &ReplacementEvent,
        sa: &mut crate::spellability::SpellAbility,
    ) {
        let mut current = Some(sa);
        while let Some(node) = current {
            match event {
                ReplacementEvent::Moved {
                    card,
                    origin,
                    destination,
                    ..
                } => {
                    let card_csv = card.0.to_string();
                    // Java `ReplaceMoved.setReplacingObjects`: Card + (NewCard,
                    // CardLKI, Cause, LastStateBattlefield, LastStateGraveyard,
                    // CounterTable, CounterMap). Rust's `ReplacementEvent::Moved`
                    // only carries card + zones; the other keys aren't tracked
                    // on the event today.
                    node.set_triggering_object(AbilityKey::Card, card_csv.as_str());
                    node.set_triggering_object(AbilityKey::ReplacedCard, card_csv.as_str());
                    node.set_triggering_object(AbilityKey::Affected, card_csv.as_str());
                    node.set_triggering_object(
                        AbilityKey::Origin,
                        format!("{:?}", origin).as_str(),
                    );
                    node.set_triggering_object(
                        AbilityKey::Destination,
                        format!("{:?}", destination).as_str(),
                    );
                }
                ReplacementEvent::DamageToCard {
                    target,
                    amount,
                    source,
                    ..
                } => {
                    // Java `ReplaceDamage.setReplacingObjects`: DamageAmount,
                    // Target (from Affected), Source (from DamageSource).
                    let target_csv = target.0.to_string();
                    node.set_triggering_object(AbilityKey::Target, target_csv.as_str());
                    node.set_triggering_object(AbilityKey::Affected, target_csv.as_str());
                    node.set_triggering_object(
                        AbilityKey::DamageAmount,
                        amount.to_string().as_str(),
                    );
                    if let Some(src) = source {
                        let src_csv = src.0.to_string();
                        node.set_triggering_object(AbilityKey::Source, src_csv.as_str());
                        node.set_triggering_object(AbilityKey::DamageSource, src_csv.as_str());
                    }
                }
                ReplacementEvent::DamageToPlayer {
                    target,
                    amount,
                    source,
                    ..
                } => {
                    node.set_triggering_object(
                        AbilityKey::DamageAmount,
                        amount.to_string().as_str(),
                    );
                    if let Some(src) = source {
                        let src_csv = src.0.to_string();
                        node.set_triggering_object(AbilityKey::Source, src_csv.as_str());
                        node.set_triggering_object(AbilityKey::DamageSource, src_csv.as_str());
                    }
                    node.set_triggering_object(
                        AbilityKey::TriggeredPlayer,
                        target.index().to_string().as_str(),
                    );
                }
                ReplacementEvent::Destroy { target } => {
                    // Java `ReplaceDestroy.setReplacingObjects`: Card, Cause.
                    let target_csv = target.0.to_string();
                    node.set_triggering_object(AbilityKey::Card, target_csv.as_str());
                    node.set_triggering_object(AbilityKey::Affected, target_csv.as_str());
                }
                ReplacementEvent::AddCounter {
                    target,
                    counter_type,
                    count,
                    ..
                } => {
                    // Java `ReplaceAddCounter.setReplacingObjects`: CounterMap,
                    // Card/Player (polymorphic on Affected), Object.
                    let target_csv = target.0.to_string();
                    node.set_triggering_object(AbilityKey::Card, target_csv.as_str());
                    node.set_triggering_object(AbilityKey::Affected, target_csv.as_str());
                    node.set_triggering_object(AbilityKey::Object, target_csv.as_str());
                    node.set_triggering_object(
                        AbilityKey::CounterMap,
                        format!("{:?}:{}", counter_type, count).as_str(),
                    );
                }
                ReplacementEvent::Draw {
                    player,
                    extra_draws,
                    ..
                } => {
                    // Java `ReplaceDraw.setReplacingObjects`: Player (from
                    // Affected) + Cause + Source (from cause.getHostCard()).
                    let pid = player.index().to_string();
                    node.set_triggering_object(AbilityKey::TriggeredPlayer, pid.as_str());
                    node.set_triggering_object(AbilityKey::Affected, pid.as_str());
                    node.set_triggering_object(AbilityKey::Num, extra_draws.to_string().as_str());
                }
                ReplacementEvent::DrawCards { player, count } => {
                    // Java `ReplaceDrawCards.setReplacingObjects`: Player + Num.
                    let pid = player.index().to_string();
                    node.set_triggering_object(AbilityKey::TriggeredPlayer, pid.as_str());
                    node.set_triggering_object(AbilityKey::Affected, pid.as_str());
                    node.set_triggering_object(AbilityKey::Num, count.to_string().as_str());
                }
                ReplacementEvent::CreateToken { player, count, .. } => {
                    // Java `ReplaceToken.setReplacingObjects`: TokenNum, Token,
                    // Cause, Player.
                    let pid = player.index().to_string();
                    node.set_triggering_object(AbilityKey::TriggeredPlayer, pid.as_str());
                    node.set_triggering_object(AbilityKey::Affected, pid.as_str());
                    node.set_triggering_object(AbilityKey::TokenNum, count.to_string().as_str());
                }
                ReplacementEvent::GainLife { player, amount }
                | ReplacementEvent::PayLife { player, amount }
                | ReplacementEvent::LifeReduced { player, amount, .. } => {
                    let pid = player.index().to_string();
                    node.set_triggering_object(AbilityKey::TriggeredPlayer, pid.as_str());
                    node.set_triggering_object(AbilityKey::Affected, pid.as_str());
                    node.set_triggering_object(AbilityKey::LifeAmount, amount.to_string().as_str());
                }
                ReplacementEvent::Mill { player, count }
                | ReplacementEvent::Scry { player, count }
                | ReplacementEvent::Proliferate { player, count }
                | ReplacementEvent::CopySpell { player, count } => {
                    let pid = player.index().to_string();
                    node.set_triggering_object(AbilityKey::TriggeredPlayer, pid.as_str());
                    node.set_triggering_object(AbilityKey::Affected, pid.as_str());
                    node.set_triggering_object(AbilityKey::Num, count.to_string().as_str());
                }
                ReplacementEvent::BeginTurn { player }
                | ReplacementEvent::BeginPhase { player, .. }
                | ReplacementEvent::DeclareBlocker { player }
                | ReplacementEvent::RollPlanarDice { player }
                | ReplacementEvent::PlanarDiceResult { player }
                | ReplacementEvent::LoseMana { player }
                | ReplacementEvent::GameLoss { player, .. }
                | ReplacementEvent::GameWin { player }
                | ReplacementEvent::Cascade { player }
                | ReplacementEvent::Learn { player }
                | ReplacementEvent::Planeswalk { player }
                | ReplacementEvent::SetInMotion { player }
                | ReplacementEvent::AssembleContraption { player } => {
                    let pid = player.index().to_string();
                    node.set_triggering_object(AbilityKey::TriggeredPlayer, pid.as_str());
                    node.set_triggering_object(AbilityKey::Affected, pid.as_str());
                }
                ReplacementEvent::Counter { card }
                | ReplacementEvent::Tap { card }
                | ReplacementEvent::Untap { card, .. }
                | ReplacementEvent::Explore { card }
                | ReplacementEvent::Transform { card }
                | ReplacementEvent::TurnFaceUp { card }
                | ReplacementEvent::AssignDealDamage { card } => {
                    let csv = card.0.to_string();
                    node.set_triggering_object(AbilityKey::Card, csv.as_str());
                    node.set_triggering_object(AbilityKey::Affected, csv.as_str());
                }
                ReplacementEvent::DealtDamage {
                    target,
                    amount,
                    source,
                } => {
                    let target_csv = target.0.to_string();
                    node.set_triggering_object(AbilityKey::Target, target_csv.as_str());
                    node.set_triggering_object(AbilityKey::Affected, target_csv.as_str());
                    node.set_triggering_object(
                        AbilityKey::DamageAmount,
                        amount.to_string().as_str(),
                    );
                    if let Some(src) = source {
                        node.set_triggering_object(
                            AbilityKey::DamageSource,
                            src.0.to_string().as_str(),
                        );
                    }
                }
                ReplacementEvent::RemoveCounter {
                    target,
                    counter_type,
                    count,
                } => {
                    let target_csv = target.0.to_string();
                    node.set_triggering_object(AbilityKey::Card, target_csv.as_str());
                    node.set_triggering_object(
                        AbilityKey::CounterMap,
                        format!("{:?}:{}", counter_type, count).as_str(),
                    );
                }
                ReplacementEvent::Attached { card, target } => {
                    node.set_triggering_object(AbilityKey::Card, card.0.to_string().as_str());
                    node.set_triggering_object(AbilityKey::Target, target.0.to_string().as_str());
                    node.set_triggering_object(AbilityKey::Affected, target.0.to_string().as_str());
                }
                ReplacementEvent::ProduceMana {
                    source,
                    activator,
                    mana,
                } => {
                    node.set_triggering_object(AbilityKey::Source, source.0.to_string().as_str());
                    node.set_triggering_object(AbilityKey::Card, source.0.to_string().as_str());
                    node.set_triggering_object(
                        AbilityKey::TriggeredPlayer,
                        activator.index().to_string().as_str(),
                    );
                    node.set_triggering_object(AbilityKey::Produced, mana.as_str());
                }
                ReplacementEvent::RollDice {
                    player,
                    sides,
                    number,
                    ..
                } => {
                    node.set_triggering_object(
                        AbilityKey::TriggeredPlayer,
                        player.index().to_string().as_str(),
                    );
                    node.set_triggering_object(AbilityKey::Num, number.to_string().as_str());
                    node.set_triggering_object(AbilityKey::Sides, sides.to_string().as_str());
                }
            }
            current = node.get_sub_ability_mut();
        }
    }

    /// Check if this effect's event type matches the given event.
    ///
    /// For `AddCounter`, also matches `Moved` events when the effect handles
    /// counter-on-move (i.e. has a `CounterMap` interaction).
    ///
    /// Mirrors Java `ReplacementEffect.modeCheck()`.
    pub fn mode_check(&self, event: &ReplacementType) -> bool {
        if self.event == *event {
            return true;
        }
        // AddCounter effects can also intercept Moved events when they
        // involve a counter map (e.g. moving counters with the card).
        if self.event == ReplacementType::AddCounter && *event == ReplacementType::Moved {
            return self.ir.counter_map;
        }
        false
    }
}

impl ReplacementEffectIr {
    fn from_params(params: &Params) -> Self {
        Self {
            card_trait_requirements: CardTraitRequirementsIr::from_key_values(
                params.iter(),
                params.selector_untracked(keys::IS_PRESENT).cloned(),
                params.selector_untracked("IsPresent2").cloned(),
            ),
            replace_with: params.get(keys::REPLACE_WITH).map(str::to_string),
            description_text: params.get(keys::DESCRIPTION).map(str::to_string),
            player_turn_text: params.get(keys::PLAYER_TURN).map(str::to_string),
            new_destination_text: params.get(keys::NEW_DESTINATION).map(str::to_string),
            new_destination_zone: parsed_zone_type(params.get(keys::NEW_DESTINATION)),
            origin_text: params.get(keys::ORIGIN).map(str::to_string),
            origin_zone: parsed_zone_type(params.get(keys::ORIGIN)),
            destination_text: params.get(keys::DESTINATION).map(str::to_string),
            destination_zone: parsed_zone_type(params.get(keys::DESTINATION)),
            exclude_destination_text: params.get("ExcludeDestination").map(str::to_string),
            valid_card_text: params.get(keys::VALID_CARD).map(str::to_string),
            valid_card_selector: params.selector_cloned(keys::VALID_CARD),
            valid_player_text: params.get(keys::VALID_PLAYER).map(str::to_string),
            valid_player_selector: params.selector_cloned(keys::VALID_PLAYER),
            valid_target_selector: params.selector_cloned(keys::VALID_TARGET),
            valid_source_selector: params.selector_cloned(keys::VALID_SOURCE),
            valid_activator_text: params.get(keys::VALID_ACTIVATOR).map(str::to_string),
            valid_step_turn_to_controller_text: params
                .get("ValidStepTurnToController")
                .map(str::to_string),
            valid_explorer_text: params.get(keys::VALID_EXPLORER).map(str::to_string),
            valid_counter_type_text: params.get(keys::VALID_COUNTER_TYPE).map(str::to_string),
            valid_lose_reason_text: params.get(keys::VALID_LOSE_REASON).map(str::to_string),
            valid_sides_text: params.get(keys::VALID_SIDES).map(str::to_string),
            active_phases: parsed_phase_types(
                params
                    .get(keys::PHASE)
                    .or_else(|| params.get(keys::ACTIVE_PHASES)),
            ),
            amount_text: params.get(keys::AMOUNT).map(str::to_string),
            damage_amount_text: params.get(keys::DAMAGE_AMOUNT).map(str::to_string),
            result_text: params.get(keys::RESULT).map(str::to_string),
            number_text: params.get(keys::NUMBER).map(str::to_string),
            dredge_amount: params.get("DredgeAmount").and_then(|s| s.parse().ok()),
            skip: params.has(keys::SKIP),
            prevent: parsed_true(params.get(keys::PREVENT)),
            optional: parsed_true(params.get(keys::OPTIONAL)),
            effect_only: parsed_true(params.get("EffectOnly")),
            discard: parsed_bool(params.get("Discard")),
            flashback_cast: parsed_bool(params.get("FlashbackCast")),
            harmonize_cast: parsed_bool(params.get("HarmonizeCast")),
            not_first_card_in_draw_step: parsed_true(params.get("NotFirstCardInDrawStep")),
            exiled_with_effect_source: params.has("ExiledWithEffectSource"),
            is_combat: parsed_bool(params.get(keys::IS_COMBAT)),
            is_damage: parsed_bool(params.get(keys::IS_DAMAGE)),
            max_speed: parsed_bool(params.get("MaxSpeed")),
            replacement_result: params.get("ReplacementResult").map(str::to_string),
            optional_decider_text: params.get(keys::OPTIONAL_DECIDER).map(str::to_string),
            replace_mana_text: params.get(keys::REPLACE_MANA).map(str::to_string),
            replace_type_text: params.get(keys::REPLACE_TYPE).map(str::to_string),
            replace_color_text: params.get(keys::REPLACE_COLOR).map(str::to_string),
            replace_only_text: params.get(keys::REPLACE_ONLY).map(str::to_string),
            replace_amount_text: params.get(keys::REPLACE_AMOUNT).map(str::to_string),
            valid_lki_text: params.get("ValidLKI").map(str::to_string),
            counter_map: params.get("CounterMap").is_some(),
            replace_with_chain: None,
        }
    }
}

/// Append "Shields remain: N" when a `ReplaceDamage` / `ReplaceSplitDamage`
/// ability's `Amount$` / `VarName$` resolves to a `Number$<n>` SVar.
///
/// Mirrors Java `ReplacementEffect.getDescription()` lines 228-253. Returns
/// the description unchanged when the ability api / params / SVar shape
/// doesn't match (Java silently skips).
fn append_shield_remaining(mut desc: String, rep_sa: &SpellAbility, host: &Card) -> String {
    use crate::ability::api_type::ApiType;

    let api = match rep_sa.api {
        Some(a) => a,
        None => return desc,
    };

    let (param_value, default_one) = match api {
        ApiType::ReplaceDamage => match rep_sa.ir.amount.as_deref() {
            Some(v) => (v.to_string(), false),
            None => return desc,
        },
        ApiType::ReplaceSplitDamage => (
            rep_sa
                .ir
                .var_name_text
                .clone()
                .unwrap_or_else(|| "1".to_string()),
            true,
        ),
        _ => return desc,
    };

    // Java: if numeric, skip (the raw number already appears in text elsewhere).
    // ReplaceSplitDamage with the default "1" renders as "Shields remain: 1".
    if param_value.chars().all(|c| c.is_ascii_digit()) {
        if default_one && param_value == "1" {
            desc.push_str(" \nShields remain: 1");
        }
        return desc;
    }

    // Non-numeric → resolve as SVar on host, expect "Number$<value>".
    if let Some(resolved) = host.get_svar(&param_value) {
        if let Some(rest) = resolved.strip_prefix("Number$") {
            desc.push_str(" \nShields remain: ");
            desc.push_str(rest);
        }
    }
    desc
}

// ── Helper filter functions ───────────────────────────────────────────────────
//
// `matches_valid_card` / `matches_valid_player` used to live here as free
// functions. They are now default methods on `CardTrait` (see
// `card_trait_base.rs`) so every subclass — `Trigger`, `ReplacementEffect`,
// and future `StaticAbility`/`SpellAbility` — gets the same API without
// per-module wrappers.

/// Check if a zone name string matches `zone`.
pub fn zone_matches(expr: &str, zone: ZoneType) -> bool {
    expr.split(',').any(|part| match part.trim() {
        "Battlefield" => zone == ZoneType::Battlefield,
        "Graveyard" => zone == ZoneType::Graveyard,
        "Hand" => zone == ZoneType::Hand,
        "Library" => zone == ZoneType::Library,
        "Exile" => zone == ZoneType::Exile,
        "Command" => zone == ZoneType::Command,
        "Stack" => zone == ZoneType::Stack,
        _ => false,
    })
}

// ── Parser ────────────────────────────────────────────────────────────────────

/// Parse an `R$` (or `R:`) replacement-effect line from a card script.
///
/// Returns `None` if the line does not start with the `R$` / `R:` prefix or
/// has no recognisable `Event$` param.
///
/// # Format
///
/// ```text
/// R$ Event$ DamageDone | ActiveZones$ Battlefield | ValidCard$ Card.Self | Prevent$ True | Description$ Prevent all damage.
/// R$ Event$ Draw | ValidPlayer$ You | Description$ Skip your draw step.
/// R$ Event$ Moved | Destination$ Graveyard | Origin$ Battlefield | ValidCard$ Card.Self
/// ```
///
/// Reference: Java `ReplacementEffect.java` in `forge/game/replacement/`.
pub fn parse_replacement_effect(raw: &str) -> Option<ReplacementEffect> {
    let trimmed = raw.trim();
    // Accept "R$ ..." / "R: ..." discriminator prefixes (used in card files),
    // AND bare "Event$ … | …" bodies (used by `EffectEffect`'s
    // `ReplacementEffects$` SVar lookups, which Java parses without a
    // discriminator via `ReplacementHandler.parseReplacement(svarText, …)`).
    let body = if let Some(rest) = trimmed.strip_prefix("R$ ") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("R:") {
        rest.trim_start()
    } else {
        trimmed
    };

    // Parse "|"-separated "Key$ Value" pairs.
    let params = Params::from_raw(body);

    let event = match params.get(keys::EVENT) {
        Some(s) => ReplacementType::smart_value_of(s),
        None => return None,
    };

    // Parse the layer (defaults to Other if not specified).
    let layer = params
        .get(keys::LAYER)
        .and_then(ReplacementLayer::smart_value_of)
        .unwrap_or(ReplacementLayer::Other);

    // Parse ActiveZones$ (comma- or space-separated list of zone names).
    let active_zones = params
        .get(keys::ACTIVE_ZONES)
        .map(parse_zone_list)
        .unwrap_or_default();

    Some(ReplacementEffect::new(event, layer, params, active_zones))
}

/// Parse a comma- or space-separated zone list string into `ZoneType` values.
pub(super) fn parse_zone_list(s: &str) -> Vec<ZoneType> {
    s.split([',', ' '])
        .filter_map(|tok| match tok.trim() {
            "Battlefield" => Some(ZoneType::Battlefield),
            "Graveyard" => Some(ZoneType::Graveyard),
            "Hand" => Some(ZoneType::Hand),
            "Library" => Some(ZoneType::Library),
            "Exile" => Some(ZoneType::Exile),
            "Command" => Some(ZoneType::Command),
            _ => None,
        })
        .collect()
}

fn parsed_zone_type(value: Option<&str>) -> Option<ZoneType> {
    match value? {
        "Battlefield" => Some(ZoneType::Battlefield),
        "Graveyard" => Some(ZoneType::Graveyard),
        "Hand" => Some(ZoneType::Hand),
        "Library" => Some(ZoneType::Library),
        "Exile" => Some(ZoneType::Exile),
        "Command" => Some(ZoneType::Command),
        "Stack" => Some(ZoneType::Stack),
        _ => None,
    }
}

pub(crate) fn parse_replacement_chain(
    raw: &str,
    svars: &impl HasSVars,
) -> Option<ReplacementChainIr> {
    let params = Params::from_raw(raw);
    let db = params.get(keys::DB)?;
    match db {
        "ReplaceToken" => Some(ReplacementChainIr::ReplaceToken {
            token_type: params.get("Type").map(str::to_string),
            amount_expr: params.get("Amount").map(str::to_string),
        }),
        "ReplaceCounter" => Some(ReplacementChainIr::ReplaceCounter {
            amount_expr: params.get("Amount")?.to_string(),
        }),
        "ReplaceEffect" => {
            let sub_ability = params
                .get(keys::SUB_ABILITY)
                .and_then(|name| svars.get_svar(name))
                .and_then(|sub_raw| parse_replacement_chain(sub_raw, svars))
                .map(Box::new);
            Some(ReplacementChainIr::ReplaceEffect {
                var_name: params.get("VarName").map(str::to_string),
                var_type: params.get("VarType").map(str::to_string),
                var_key: params.get("VarKey").map(str::to_string),
                var_value: params.get("VarValue").map(str::to_string),
                sub_ability,
            })
        }
        _ => None,
    }
}

pub(crate) fn resolve_replace_with_chain(
    effect: &ReplacementEffect,
    source_card: &Card,
) -> Option<ReplacementChainIr> {
    effect.ir.replace_with_chain.clone().or_else(|| {
        effect
            .replace_with()
            .and_then(|svar_name| source_card.get_svar(svar_name))
            .and_then(|raw| parse_replacement_chain(raw, source_card))
    })
}

fn parsed_phase_types(value: Option<&str>) -> Vec<PhaseType> {
    value
        .into_iter()
        .flat_map(|raw| raw.split(','))
        .filter_map(|phase| PhaseType::from_script_name(phase.trim()))
        .collect()
}

fn parsed_true(value: Option<&str>) -> bool {
    matches!(value, Some("True") | Some("true"))
}

fn parsed_bool(value: Option<&str>) -> Option<bool> {
    value.map(|raw| matches!(raw, "True" | "true"))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Parser tests ──────────────────────────────────────────────────────

    #[test]
    fn parse_damage_prevention() {
        let raw = "R$ Event$ DamageDone | ActiveZones$ Battlefield | ValidCard$ Card.Self | Prevent$ True | Description$ Prevent all damage dealt to ~.";
        let re = parse_replacement_effect(raw).expect("should parse");
        assert_eq!(re.event, ReplacementType::DamageDone);
        assert_eq!(re.layer, ReplacementLayer::Other);
        assert!(re.ir.prevent);
        assert_eq!(re.active_zones, vec![ZoneType::Battlefield]);
    }

    #[test]
    fn parse_draw_skip() {
        let raw = "R$ Event$ Draw | ValidPlayer$ You | Description$ Skip your draw step.";
        let re = parse_replacement_effect(raw).expect("should parse");
        assert_eq!(re.event, ReplacementType::Draw);
        assert_eq!(re.ir.valid_player_text.as_deref(), Some("You"));
        assert!(re.active_zones.is_empty());
    }

    #[test]
    fn parse_destroy_replacement() {
        let raw = "R$ Event$ Destroy | ValidCard$ Card.Self | Description$ ~ is indestructible.";
        let re = parse_replacement_effect(raw).expect("should parse");
        assert_eq!(re.event, ReplacementType::Destroy);
        assert_eq!(re.ir.valid_card_text.as_deref(), Some("Card.Self"));
    }

    #[test]
    fn parse_moved_exile_instead() {
        let raw = "R$ Event$ Moved | Destination$ Graveyard | Origin$ Battlefield | ValidCard$ Card.Self | NewDestination$ Exile | Description$ If ~ would die, exile it instead.";
        let re = parse_replacement_effect(raw).expect("should parse");
        assert_eq!(re.event, ReplacementType::Moved);
        assert_eq!(re.ir.destination_text.as_deref(), Some("Graveyard"));
        assert_eq!(re.ir.origin_text.as_deref(), Some("Battlefield"));
        assert_eq!(re.ir.new_destination_text.as_deref(), Some("Exile"));
    }

    #[test]
    fn parse_cant_happen_layer() {
        let raw = "R$ Event$ Destroy | Layer$ CantHappen | ValidCard$ Card.Self";
        let re = parse_replacement_effect(raw).expect("should parse");
        assert_eq!(re.layer, ReplacementLayer::CantHappen);
    }

    #[test]
    fn parse_r_colon_prefix() {
        let raw = "R: Event$ Draw | ValidPlayer$ You";
        let re = parse_replacement_effect(raw).expect("should parse R: prefix");
        assert_eq!(re.event, ReplacementType::Draw);
    }

    #[test]
    fn non_replacement_line_returns_none() {
        assert!(parse_replacement_effect("AB$ Mana | Cost$ T | Produced$ G").is_none());
        assert!(
            parse_replacement_effect("S$ Mode$ Continuous | Affected$ Creature.YouControl")
                .is_none()
        );
        assert!(parse_replacement_effect("").is_none());
    }

    // ── active_in_zone tests ──────────────────────────────────────────────

    #[test]
    fn active_in_zone_empty_means_always() {
        let raw = "R$ Event$ Draw | ValidPlayer$ You";
        let re = parse_replacement_effect(raw).unwrap();
        // Empty active_zones → active in all zones.
        assert!(re.active_in_zone(ZoneType::Battlefield));
        assert!(re.active_in_zone(ZoneType::Hand));
        assert!(re.active_in_zone(ZoneType::Graveyard));
    }

    #[test]
    fn active_in_zone_respects_active_zones() {
        let raw = "R$ Event$ DamageDone | ActiveZones$ Battlefield | Prevent$ True";
        let re = parse_replacement_effect(raw).unwrap();
        assert!(re.active_in_zone(ZoneType::Battlefield));
        assert!(!re.active_in_zone(ZoneType::Graveyard));
        assert!(!re.active_in_zone(ZoneType::Hand));
    }

    // ── New ReplacementType variant parsing tests ─────────────────────────

    #[test]
    fn parse_all_new_event_types() {
        for (event_str, expected) in [
            ("Tap", ReplacementType::Tap),
            ("Untap", ReplacementType::Untap),
            ("Mill", ReplacementType::Mill),
            ("Scry", ReplacementType::Scry),
            ("Explore", ReplacementType::Explore),
            ("Cascade", ReplacementType::Cascade),
            ("Learn", ReplacementType::Learn),
            ("Proliferate", ReplacementType::Proliferate),
            ("Transform", ReplacementType::Transform),
            ("TurnFaceUp", ReplacementType::TurnFaceUp),
            ("RollDice", ReplacementType::RollDice),
        ] {
            let raw = format!("R$ Event$ {event_str} | Description$ test");
            let re = parse_replacement_effect(&raw).expect(&format!("should parse {event_str}"));
            assert_eq!(re.event, expected, "failed for {event_str}");
        }
    }
}
