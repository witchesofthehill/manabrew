//! Port of Java `forge.game.CardTraitBase`.
//!
//! Base data for Triggers, ReplacementEffects and StaticAbilities.
//!
//! Notes on Java → Rust divergence:
//! * `sVars` uses `HashMap` (not `TreeMap`) because the `HasSVars` trait
//!   is keyed on `HashMap`.
//! * Java uses runtime `Object` dispatch in `matchesValid`. Rust replicates
//!   the argument-type dispatch via the `MatchValidTarget` enum, and the
//!   `this instanceof Trigger` self-type dispatch via the `CardTrait` trait
//!   with a `resolve_source_player` hook that subclasses override.
//! * `Card` does not implement `ITranslatable`; `get_host_name` returns a
//!   `HostName` enum. The `Card`-branch is pending that impl.

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};

use forge_foundation::CardStateName;

use crate::ability::ability_utils::apply_text_change_effects;
use crate::card::card_state::CardState;
use crate::card::valid_filter::{self, CardTraitRequirementsIr};
use crate::card::Card;
use crate::core::{HasSVars, Identifiable};
use crate::event::AbilityValue;
use crate::game::GameState;
use crate::game_object::GameObject;
use crate::ids::{CardId, PlayerId};
use crate::keyword::keyword_instance::Keyword;
use crate::keyword::keyword_interface::KeywordInterface;
use crate::parsing::CompiledSelector;
use crate::player::GameLossReason;

// Keys of descriptive (text) parameters.
const DESCRIPTIVE_KEYS: &[&str] = &[
    "Description",
    "SpellDescription",
    "StackDescription",
    "TriggerDescription",
    "ChangeTypeDesc",
    "ValidTgtsDesc",
];

// Keys that should not be changed.
const NO_CHANGE_KEYS: &[&str] = &[
    "TokenScript",
    "NewName",
    "DefinedName",
    "ChooseFromList",
    "AddAbility",
];

/// Target of `matches_valid`. Mirrors Java's `Object` dispatch.
pub enum MatchValidTarget<'a> {
    Card(&'a Card),
    Player(PlayerId),
    GameObj(&'a dyn GameObject),
    Iter(&'a [MatchValidTarget<'a>]),
    Str(&'a str),
    LossReason(GameLossReason),
    // TODO(port): PlanarDice — planechase not implemented.
    PlanarDice,
}

/// Result of `get_host_name`. Mirrors Java's `ITranslatable` return type.
///
/// The `Card` branch is pending `impl ITranslatable for Card`.
pub enum HostName<'a> {
    State(CardStateName),
    Card(&'a Card),
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct CardTraitBase {
    id: i32,
    #[serde(skip)]
    host_card_id: Option<CardId>,
    #[serde(skip)]
    card_state_name: Option<CardStateName>,
    #[serde(skip)]
    keyword: Option<KeywordInterface>,

    original_map_params: HashMap<String, String>,
    map_params: HashMap<String, String>,

    intrinsic: bool,
    suppressed: bool,

    svars: HashMap<String, String>,

    intrinsic_changed_text_colors: HashMap<String, String>,
    intrinsic_changed_text_types: HashMap<String, String>,
    changed_text_colors: HashMap<String, String>,
    changed_text_types: HashMap<String, String>,
}

impl Clone for CardTraitBase {
    fn clone(&self) -> Self {
        Self {
            id: self.id,
            host_card_id: self.host_card_id,
            card_state_name: self.card_state_name,
            keyword: None,
            original_map_params: self.original_map_params.clone(),
            map_params: self.map_params.clone(),
            intrinsic: self.intrinsic,
            suppressed: self.suppressed,
            svars: self.svars.clone(),
            intrinsic_changed_text_colors: self.intrinsic_changed_text_colors.clone(),
            intrinsic_changed_text_types: self.intrinsic_changed_text_types.clone(),
            changed_text_colors: self.changed_text_colors.clone(),
            changed_text_types: self.changed_text_types.clone(),
        }
    }
}

impl CardTraitBase {
    pub fn set_id(&mut self, id: i32) {
        self.id = id;
    }

    // ── mapParams accessors ─────────────────────────────────────────

    pub fn get_map_params(&self) -> &HashMap<String, String> {
        &self.map_params
    }

    pub fn get_param_or_default<'a>(&'a self, key: &str, default: &'a str) -> &'a str {
        self.map_params
            .get(key)
            .map(String::as_str)
            .unwrap_or(default)
    }

    pub fn get_param(&self, key: &str) -> Option<&str> {
        self.map_params.get(key).map(String::as_str)
    }

    pub fn get_original_param(&self, key: &str) -> Option<&str> {
        self.original_map_params.get(key).map(String::as_str)
    }

    pub fn has_param(&self, key: &str) -> bool {
        self.map_params.contains_key(key)
    }

    pub fn put_param(&mut self, key: String, value: String) -> Option<String> {
        self.map_params.insert(key, value)
    }

    pub fn remove_param(&mut self, key: &str) {
        self.map_params.remove(key);
    }

    pub fn get_original_map_params(&self) -> &HashMap<String, String> {
        &self.original_map_params
    }

    /// Initialize `map_params` and `original_map_params` from a source map.
    /// Java sets these directly in each subclass constructor; Rust exposes a setter.
    pub fn set_map_params(&mut self, params: HashMap<String, String>) {
        self.original_map_params = params.clone();
        self.map_params = params;
    }

    // ── intrinsic ───────────────────────────────────────────────────

    pub fn is_intrinsic(&self) -> bool {
        self.intrinsic
    }

    pub fn set_intrinsic(&mut self, i: bool) {
        self.intrinsic = i;
    }

    // ── host card ───────────────────────────────────────────────────

    pub fn host_card_id(&self) -> CardId {
        self.host_card_id
            .expect("CardTraitBase host_card_id must be bound before use")
    }

    pub fn set_host_card_id(&mut self, id: CardId) {
        self.host_card_id = Some(id);
    }

    pub fn host_card<'a>(&self, game: &'a GameState) -> &'a Card {
        game.card(self.host_card_id())
    }

    pub fn host_controller(&self, game: &GameState) -> PlayerId {
        self.host_card(game).controller
    }

    // ── keyword ─────────────────────────────────────────────────────

    pub fn is_keyword(&self, kw: Keyword) -> bool {
        self.keyword
            .as_ref()
            .map(|current| current.get_keyword() == kw)
            .unwrap_or(false)
    }

    pub fn get_keyword(&self) -> Option<&KeywordInterface> {
        self.keyword.as_ref()
    }

    pub fn set_keyword(&mut self, kw: KeywordInterface) {
        self.keyword = Some(kw);
    }

    pub fn is_embalm(&self) -> bool {
        self.is_keyword(Keyword::Embalm)
    }

    pub fn is_eternalize(&self) -> bool {
        self.is_keyword(Keyword::Eternalize)
    }

    // ── structural classifiers ──────────────────────────────────────

    pub fn is_secondary(&self) -> bool {
        self.get_param_or_default("Secondary", "False") == "True"
    }

    pub fn is_class_ability(&self) -> bool {
        self.has_param("ClassLevel")
    }

    pub fn is_class_level_n_ability(&self, level: i32) -> bool {
        let raw = self.get_param_or_default("ClassLevel", "0");
        let numeric = if raw.chars().all(|c| c.is_ascii_digit()) {
            raw
        } else {
            // Java does substring(2); used for ranges like "2-3" or "2+".
            &raw[2..]
        };
        numeric.parse::<i32>().map(|n| n == level).unwrap_or(false)
    }

    /// Overridden by `SpellAbility`. Base returns false.
    pub fn is_mana_ability(&self) -> bool {
        false
    }

    // ── matches_valid ───────────────────────────────────────────────

    /// Resolution worker for `Valid$` expressions with an explicit source
    /// player. All `CardTrait` dispatch funnels through here; the trait
    /// methods only decide *which* player to pass (see
    /// `CardTrait::resolve_source_player`).
    pub fn matches_valid_with_player(
        &self,
        target: &MatchValidTarget<'_>,
        valids: &[&str],
        src_card: &Card,
        src_player: PlayerId,
    ) -> bool {
        match target {
            MatchValidTarget::Card(card) => {
                let selector = crate::parsing::cached_compiled_selector(&valids.join(","));
                valid_filter::matches_valid_card_selector(&selector, card, src_card)
            }
            MatchValidTarget::Player(player) => {
                valid_filter::matches_valid_player(&valids.join(","), *player, src_player)
            }
            MatchValidTarget::GameObj(obj) => {
                let owned: Vec<String> = valids.iter().map(|s| s.to_string()).collect();
                obj.is_valid(&owned, src_player, src_card, self)
            }
            MatchValidTarget::Iter(items) => items
                .iter()
                .any(|item| self.matches_valid_with_player(item, valids, src_card, src_player)),
            MatchValidTarget::Str(s) => valids.contains(s),
            MatchValidTarget::LossReason(reason) => valids.iter().any(|v| {
                GameLossReason::smart_value_of(v)
                    .map(|parsed| parsed == *reason)
                    .unwrap_or(false)
            }),
            MatchValidTarget::PlanarDice => {
                unimplemented!("port: PlanarDice — planechase not implemented")
            }
        }
    }

    pub fn matches_compiled_valid_with_player(
        &self,
        target: &MatchValidTarget<'_>,
        selector: &CompiledSelector,
        src_card: &Card,
        src_player: PlayerId,
    ) -> bool {
        match target {
            MatchValidTarget::Card(card) => {
                valid_filter::matches_valid_card_selector(selector, card, src_card)
            }
            MatchValidTarget::Player(player) => {
                valid_filter::matches_valid_player_selector(selector, *player, src_player)
            }
            MatchValidTarget::GameObj(obj) => {
                let owned: Vec<String> = selector
                    .alternatives
                    .iter()
                    .map(|alternative| alternative.raw.clone())
                    .collect();
                obj.is_valid(&owned, src_player, src_card, self)
            }
            MatchValidTarget::Iter(items) => items.iter().any(|item| {
                self.matches_compiled_valid_with_player(item, selector, src_card, src_player)
            }),
            MatchValidTarget::Str(s) => selector
                .alternatives
                .iter()
                .any(|alternative| alternative.raw == *s),
            MatchValidTarget::LossReason(reason) => {
                selector.alternatives.iter().any(|alternative| {
                    GameLossReason::smart_value_of(&alternative.raw)
                        .map(|parsed| parsed == *reason)
                        .unwrap_or(false)
                })
            }
            MatchValidTarget::PlanarDice => {
                unimplemented!("port: PlanarDice — planechase not implemented")
            }
        }
    }

    // ── suppressed ──────────────────────────────────────────────────

    pub fn set_suppressed(&mut self, supp: bool) {
        self.suppressed = supp;
    }

    pub fn is_suppressed(&self) -> bool {
        self.suppressed
    }

    // ── CardView ────────────────────────────────────────────────────

    /// TODO(port): `CardView` / `IHasCardView` not ported.
    pub fn get_card_view(&self) -> ! {
        unimplemented!("port: CardView — UI layer, not in Rust engine")
    }

    // ── SVar fallback / lookup ──────────────────────────────────────

    /// Ordered SVar fallback chain: keyword-static.
    /// Mirrors Java's chained `getSVar` walk in `CardTraitBase`.
    fn get_svar_fallback(&self, name: Option<&str>) -> Vec<&dyn HasSVars> {
        let mut result: Vec<&dyn HasSVars> = Vec::new();

        if let Some(kw) = self.keyword.as_ref() {
            if let Some(st) = kw.get_static() {
                // Only add when the keyword has part of the SVar in its original string.
                let include = match name {
                    None => true,
                    Some(n) => kw.get_original().contains(n),
                };
                if include {
                    result.push(st);
                }
            }
        }
        result
    }

    fn find_svar(&self, name: &str) -> Option<&dyn HasSVars> {
        self.get_svar_fallback(Some(name))
            .into_iter()
            .find(|src| HasSVars::has_svar(*src, name))
    }

    pub fn get_svar_int(&self, name: &str) -> Option<i32> {
        let value = HasSVars::get_svar(self, name)?;
        value.parse::<i32>().ok()
    }

    /// Merged SVar map across keyword-static → self.
    /// Local `svars` override fallbacks, matching Java `getSVars()` at line 613.
    pub fn get_all_svars(&self) -> HashMap<String, String> {
        let mut res: HashMap<String, String> = HashMap::new();
        for src in self.get_svar_fallback(None) {
            for (k, v) in HasSVars::get_svars(src) {
                res.insert(k.clone(), v.clone());
            }
        }
        for (k, v) in &self.svars {
            res.insert(k.clone(), v.clone());
        }
        res
    }

    // ── card state / host name ─────────────────────────────────────

    pub fn set_card_state(&mut self, state: &CardState) {
        self.card_state_name = Some(state.get_state_name());
        for (key, value) in HasSVars::get_svars(state) {
            self.svars
                .entry(key.clone())
                .or_insert_with(|| value.clone());
        }
    }

    pub fn get_card_state_name(&self) -> Option<CardStateName> {
        self.card_state_name
    }

    /// Mirrors `getHostName(CardTraitBase node)`.
    ///
    /// Returns the alternate card-state view when the node is intrinsic and
    /// its state differs from the host's current state; otherwise the host.
    pub fn get_host_name<'a>(
        &'a self,
        game: &'a GameState,
        node: &'a CardTraitBase,
    ) -> HostName<'a> {
        if node.is_intrinsic() {
            // TODO(port): needs `Card::get_current_state_name()` for the
            // comparison. For now assume the state differs when present
            // and the host has no way to report its current state.
            if let Some(_state_name) = node.card_state_name {
                unimplemented!(
                    "port: Card::get_current_state_name — required by CardTraitBase::get_host_name"
                );
            }
        }
        HostName::Card(node.host_card(game))
    }

    pub fn is_copied_trait(&self) -> bool {
        false
    }

    // ── changed text ────────────────────────────────────────────────

    pub fn get_changed_text_colors(&self) -> HashMap<String, String> {
        combine_changed_map(
            &self.intrinsic_changed_text_colors,
            &self.changed_text_colors,
        )
    }

    pub fn get_changed_text_types(&self) -> HashMap<String, String> {
        combine_changed_map(&self.intrinsic_changed_text_types, &self.changed_text_types)
    }

    /// Rust-only helper: flatten changed-text color + type maps into
    /// `(from, to)` pairs. Consumed by `SpellAbility::apply_text_changes` to
    /// push the same changes down into the trait's overriding ability.
    pub fn changed_text_pairs(&self) -> Vec<(String, String)> {
        self.changed_text_colors
            .iter()
            .chain(self.changed_text_types.iter())
            .map(|(from, to)| (from.clone(), to.clone()))
            .collect()
    }

    pub fn change_text_intrinsic(
        &mut self,
        color_map: HashMap<String, String>,
        type_map: HashMap<String, String>,
    ) {
        self.intrinsic_changed_text_colors = color_map.clone();
        self.intrinsic_changed_text_types = type_map.clone();

        let color_tree: BTreeMap<String, String> = color_map.into_iter().collect();
        let type_tree: BTreeMap<String, String> = type_map.into_iter().collect();

        let keys: Vec<String> = self.map_params.keys().cloned().collect();
        for key in keys {
            let Some(value) = self.original_map_params.get(&key).cloned() else {
                continue;
            };
            let new_value = if NO_CHANGE_KEYS.contains(&key.as_str()) {
                continue;
            } else if DESCRIPTIVE_KEYS.contains(&key.as_str()) {
                Some(apply_text_change_effects(
                    &value,
                    true,
                    &color_tree,
                    &type_tree,
                ))
            } else if self.svars.contains_key(&value) {
                // Don't change literal SVar names.
                continue;
            } else {
                Some(apply_text_change_effects(
                    &value,
                    false,
                    &color_tree,
                    &type_tree,
                ))
            };

            if let Some(nv) = new_value {
                self.map_params.insert(key, nv);
            }
        }
        // Overwrite originalMapParams — mirrors Java line 708.
        self.original_map_params = self.map_params.clone();
    }

    pub fn change_text(&mut self) {
        // TODO(port): needs `Card::get_changed_text_color_words()` and
        // `Card::get_changed_text_type_words()`. The engine currently stores
        // text changes as SVars on the card (see
        // `ability_utils::extract_text_change_maps`), which differs from
        // Java's model. Resolve when Card exposes these accessors.
        unimplemented!(
            "port: Card::get_changed_text_color_words / _type_words — \
             required by CardTraitBase::change_text"
        );
    }

    // ── copy ────────────────────────────────────────────────────────

    pub fn copy_helper(&self, copy: &mut CardTraitBase, host: Card) {
        self.copy_helper_with_text(copy, host, false);
    }

    pub fn copy_helper_with_text(
        &self,
        copy: &mut CardTraitBase,
        host: Card,
        keep_text_changes: bool,
    ) {
        copy.original_map_params = self.original_map_params.clone();
        copy.map_params = if keep_text_changes {
            self.map_params.clone()
        } else {
            self.original_map_params.clone()
        };
        copy.set_svars(self.svars.clone());
        copy.card_state_name = self.card_state_name;
        // Mirrors Java copyHelper: assign host directly instead of using set_host_card.
        copy.host_card_id = Some(host.id);
        copy.keyword = self.keyword.clone();
    }

    // ── trigger remembered ──────────────────────────────────────────

    /// Java dispatches on `this instanceof SpellAbility` / `Trigger`. In Rust
    /// `CardTraitBase` is the concrete base; subclasses expose their own
    /// `get_trigger_remembered` and should be called directly. Base returns
    /// empty, matching Java's final `return ImmutableList.of()`.
    pub fn get_trigger_remembered(&self) -> Vec<AbilityValue> {
        Vec::new()
    }
}

/// Combine an intrinsic change map with a non-intrinsic one. Mirrors
/// Java's private `_combineChangedMap`.
fn combine_changed_map(
    input: &HashMap<String, String>,
    output: &HashMap<String, String>,
) -> HashMap<String, String> {
    if input.is_empty() {
        return output.clone();
    }
    if output.is_empty() {
        return input.clone();
    }
    let mut result = output.clone();
    for (k, v) in input {
        let replacement = output.get(v).cloned().unwrap_or_else(|| v.clone());
        result.insert(k.clone(), replacement);
    }
    result
}

impl Identifiable for CardTraitBase {
    fn id(&self) -> i32 {
        self.id
    }
}

impl HasSVars for CardTraitBase {
    fn get_svar(&self, name: &str) -> Option<&str> {
        if let Some(v) = self.svars.get(name) {
            return Some(v.as_str());
        }
        // Java returns "" when fallback also misses; Rust returns None to keep
        // the Option type signature. Callers that need Java parity can
        // `.unwrap_or("")`.
        //
        // The fallback must return an `&str` tied to `self`; we re-walk
        // the chain inline (rather than reusing `get_svar_fallback`) so the
        // borrow scope survives the outer `Option<&str>` return.
        if let Some(kw) = self.keyword.as_ref() {
            if let Some(st) = kw.get_static() {
                if kw.get_original().contains(name) {
                    if let Some(v) = HasSVars::get_svar(st, name) {
                        return Some(v);
                    }
                }
            }
        }
        None
    }

    fn has_svar(&self, name: &str) -> bool {
        self.svars.contains_key(name) || self.find_svar(name).is_some()
    }

    fn set_svar(&mut self, name: String, value: String) {
        self.svars.insert(name, value);
    }

    fn set_svars(&mut self, new_svars: HashMap<String, String>) {
        self.svars = new_svars;
    }

    fn get_svars(&self) -> &HashMap<String, String> {
        &self.svars
    }

    fn remove_svar(&mut self, var: &str) {
        self.svars.remove(var);
    }
}

impl GameObject for CardTraitBase {}

/// Polymorphic facade over `CardTraitBase` — the Rust stand-in for Java's
/// inheritance chain where `Trigger`, `ReplacementEffect`, and `StaticAbility`
/// extend `CardTraitBase`. Because Rust structs have no virtual methods, the
/// `this instanceof Trigger` self-type dispatch in Java's `matchesValid` is
/// expressed here as the `resolve_source_player` hook: the default returns
/// `src_card.controller`, and `Trigger` overrides it to consult its spawning
/// ability's activating player.
pub trait CardTrait {
    /// Borrow the underlying `CardTraitBase`. Implementors own a
    /// `CardTraitBase` (directly or transitively) and return a reference.
    fn base(&self) -> &CardTraitBase;

    /// Resolves the player whose perspective is used for `Valid$` expressions.
    /// Default matches Java's base behavior (source card's controller).
    /// `Trigger` overrides — mirrors `this instanceof Trigger` in Java
    /// `CardTraitBase.matchesValid(Object, String[], Card)` at line 214.
    fn resolve_source_player(&self, src_card: &Card) -> PlayerId {
        src_card.controller
    }

    /// Mirrors `matchesValid(Object, String[], Card)`.
    fn matches_valid(
        &self,
        target: &MatchValidTarget<'_>,
        valids: &[&str],
        src_card: Option<&Card>,
    ) -> bool {
        let Some(src) = src_card else {
            return false;
        };
        let player = self.resolve_source_player(src);
        self.base()
            .matches_valid_with_player(target, valids, src, player)
    }

    fn matches_compiled_valid(
        &self,
        target: &MatchValidTarget<'_>,
        selector: &CompiledSelector,
        src_card: Option<&Card>,
    ) -> bool {
        let Some(src) = src_card else {
            return false;
        };
        let player = self.resolve_source_player(src);
        self.base()
            .matches_compiled_valid_with_player(target, selector, src, player)
    }

    fn matches_valid_param(
        &self,
        param: &str,
        target: &MatchValidTarget<'_>,
        src_card: Option<&Card>,
    ) -> bool {
        let b = self.base();
        let invert_key = format!("Invert{}", param);
        let invert = b.has_param(&invert_key);
        if b.has_param(param) {
            let raw = b.get_param(param).unwrap_or("");
            let parts: Vec<&str> = raw.split(',').collect();
            if !self.matches_valid(target, &parts, src_card) {
                return invert;
            }
        }
        !invert
    }

    /// Ergonomic comma-separated-expression wrapper over `matches_valid` for
    /// card targets. Mirrors Java's `matchesValid(Object, String[], Card)`
    /// call pattern where `valids` is often a single comma-separated string
    /// (e.g. `"Creature.YouCtrl,Artifact"`).
    fn matches_valid_card(&self, expr: &str, card: &Card, source: &Card) -> bool {
        let parts: Vec<&str> = expr.split(',').collect();
        self.matches_valid(&MatchValidTarget::Card(card), &parts, Some(source))
    }

    fn matches_compiled_valid_card(
        &self,
        selector: &CompiledSelector,
        card: &Card,
        source: &Card,
    ) -> bool {
        self.matches_compiled_valid(&MatchValidTarget::Card(card), selector, Some(source))
    }

    /// Ergonomic comma-separated-expression wrapper over `matches_valid` for
    /// player targets.
    fn matches_valid_player(&self, expr: &str, player: PlayerId, source: &Card) -> bool {
        let parts: Vec<&str> = expr.split(',').collect();
        self.matches_valid(&MatchValidTarget::Player(player), &parts, Some(source))
    }

    fn matches_compiled_valid_player(
        &self,
        selector: &CompiledSelector,
        player: PlayerId,
        source: &Card,
    ) -> bool {
        self.matches_compiled_valid(&MatchValidTarget::Player(player), selector, Some(source))
    }
}

impl CardTrait for CardTraitBase {
    fn base(&self) -> &CardTraitBase {
        self
    }
}

/// Runtime objects that have a lowered card-trait IR.
///
/// This is the Rust equivalent of Java subclasses inheriting common
/// `CardTraitBase` behavior while carrying their own concrete data. It is not
/// limited to `CardTrait` implementors because `SpellAbility` also owns a
/// lowered IR in Rust.
///
/// The associated type keeps each owner tied to its specific IR (`TriggerIr`,
/// `StaticAbilityIr`, `ReplacementEffectIr`, `SpellAbilityIr`, ...). The
/// requirement view is exposed directly here so shared checks only need this
/// one trait.
pub trait CardTraitIrOwner {
    type Ir;

    fn ir(&self) -> &Self::Ir;

    fn card_trait_requirements(&self) -> &CardTraitRequirementsIr;

    fn meets_card_trait_requirements(
        &self,
        game: &GameState,
        source: &Card,
        svar_source: &dyn HasSVars,
    ) -> bool {
        self.card_trait_requirements()
            .meets(game, source, svar_source)
    }
}
