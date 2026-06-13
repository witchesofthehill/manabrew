//! Central parsing module for the Forge DSL.
//!
//! Mirrors Java's `FileSection.parseToMap()` + `CardTraitBase` accessor
//! methods. All pipe-delimited parameter parsing and typed access goes
//! through the [`Params`] wrapper — no code should use raw
//! `BTreeMap<String, String>` for DSL parameters.

pub mod amount;
pub mod card_script;
pub mod compare;
pub mod cost;
pub mod keys;

use std::collections::BTreeMap;
use std::sync::{Mutex, OnceLock};

use forge_foundation::ZoneType;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

pub use amount::AmountExpr;
pub use card_script::{
    parse_semantic_param_value, ParamDiagnostic, ParamDiagnosticKind, ParamEntry, ParsedCardScript,
    ParsedParams, ParsedParamsReport, ScriptAbility, ScriptAbilityRecord, ScriptDiagnostic,
    ScriptDiagnosticKind, ScriptField, ScriptLine, ScriptLineKind, ScriptParamRecord, ScriptSVar,
    ScriptSVarNumericExpression, ScriptSVarObjectRef, ScriptSVarValue, SemanticAmount,
    SemanticComparison, SemanticComparisonOperator, SemanticParam, SemanticParamValue,
    SemanticParamValueKind, SemanticProducedMana, SemanticProducedManaCombo, SemanticSelector,
    SemanticSelectorAlternative, SemanticSelectorPart, SemanticTransform,
};
pub use cost::{CostToken, CostTokenKind};

pub fn raw_has_key(raw: &str, key: &str) -> bool {
    card_script::raw_has_key(raw, key)
}

pub fn raw_has_any(raw: &str, keys: &[&str]) -> bool {
    card_script::raw_has_any(raw, keys)
}

pub fn raw_get<'a>(raw: &'a str, key: &str) -> Option<&'a str> {
    card_script::raw_get(raw, key)
}

// ── Params wrapper ──────────────────────────────────────────────────────────

/// Typed wrapper around parsed DSL parameters.
///
/// Replaces raw `BTreeMap<String, String>` everywhere. Mirrors Java's
/// `CardTraitBase.mapParams` with its `getParam`/`hasParam`/`matchesValidParam`
/// accessor methods.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CompiledSelector {
    pub alternatives: Vec<CompiledSelectorAlternative>,
    pub ir: Selector,
}

impl CompiledSelector {
    pub fn parse(raw: &str) -> Self {
        crate::perf::increment(crate::perf::Metric::SelectorParses, 1);
        match parse_semantic_param_value(keys::VALID, raw) {
            SemanticParamValue::Selector(selector) | SemanticParamValue::Reference(selector) => {
                compile_semantic_selector(&selector)
            }
            _ => CompiledSelector::from_alternatives(vec![CompiledSelectorAlternative {
                raw: raw.trim().to_string(),
                parts: vec![CompiledSelectorPart {
                    separator: None,
                    value: raw.trim().to_string(),
                }],
            }]),
        }
    }

    pub fn from_alternatives(alternatives: Vec<CompiledSelectorAlternative>) -> Self {
        let ir = lower_compiled_selector(&alternatives);
        Self { alternatives, ir }
    }

    pub fn from_raw_alternative(raw: &str) -> Self {
        Self::from_alternatives(vec![CompiledSelectorAlternative {
            raw: raw.trim().to_string(),
            parts: vec![CompiledSelectorPart {
                separator: None,
                value: raw.trim().to_string(),
            }],
        }])
    }

    pub fn is_any_of<const N: usize>(&self, values: [&str; N]) -> bool {
        self.alternatives.len() == 1
            && self.alternatives.first().is_some_and(|alternative| {
                values
                    .iter()
                    .any(|value| alternative.raw.eq_ignore_ascii_case(value))
            })
    }

    pub fn as_raw(&self) -> String {
        self.alternatives
            .iter()
            .map(|alternative| alternative.raw.as_str())
            .collect::<Vec<_>>()
            .join(",")
    }

    pub fn raw_predicates(&self) -> impl Iterator<Item = &str> {
        self.ir
            .alternatives
            .iter()
            .flat_map(|alternative| &alternative.predicates)
            .filter_map(|predicate| match predicate {
                SelectorPredicate::Raw(raw) => Some(raw.as_str()),
                _ => None,
            })
    }
}

pub fn cached_compiled_selector(raw: &str) -> CompiledSelector {
    static CACHE: OnceLock<Mutex<BTreeMap<String, CompiledSelector>>> = OnceLock::new();
    let key = raw.trim().to_string();
    if let Some(selector) = common_compiled_selector(&key) {
        return selector;
    }
    let cache = CACHE.get_or_init(|| Mutex::new(BTreeMap::new()));
    if let Some(selector) = cache
        .lock()
        .expect("selector cache poisoned")
        .get(&key)
        .cloned()
    {
        return selector;
    }
    let selector = CompiledSelector::parse(&key);
    cache
        .lock()
        .expect("selector cache poisoned")
        .insert(key, selector.clone());
    selector
}

fn common_compiled_selector(raw: &str) -> Option<CompiledSelector> {
    match raw {
        "Card.Self" => {
            static SELECTOR: OnceLock<CompiledSelector> = OnceLock::new();
            Some(
                SELECTOR
                    .get_or_init(|| selector_from_parts("Card.Self", &["Card", "Self"]))
                    .clone(),
            )
        }
        "Creature.Self" => {
            static SELECTOR: OnceLock<CompiledSelector> = OnceLock::new();
            Some(
                SELECTOR
                    .get_or_init(|| selector_from_parts("Creature.Self", &["Creature", "Self"]))
                    .clone(),
            )
        }
        "You" => {
            static SELECTOR: OnceLock<CompiledSelector> = OnceLock::new();
            Some(
                SELECTOR
                    .get_or_init(|| selector_from_parts("You", &["You"]))
                    .clone(),
            )
        }
        _ => None,
    }
}

fn selector_from_parts(raw: &str, parts: &[&str]) -> CompiledSelector {
    CompiledSelector::from_alternatives(vec![CompiledSelectorAlternative {
        raw: raw.to_string(),
        parts: parts
            .iter()
            .enumerate()
            .map(|(index, value)| CompiledSelectorPart {
                separator: (index > 0).then_some('.'),
                value: (*value).to_string(),
            })
            .collect(),
    }])
}

impl Serialize for CompiledSelector {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.as_raw())
    }
}

impl<'de> Deserialize<'de> for CompiledSelector {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Ok(Self::parse(&raw))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompiledSelectorAlternative {
    pub raw: String,
    pub parts: Vec<CompiledSelectorPart>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompiledSelectorPart {
    pub separator: Option<char>,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Selector {
    pub alternatives: Vec<SelectorAlt>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SelectorAlt {
    pub predicates: Vec<SelectorPredicate>,
}

// Selector IR: these are predicates over cards, players, or contextual game
// state. They are deliberately separate from amount/numeric expression parsing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SelectorPredicate {
    Any,
    Player,
    CardType(CardSelectorType),
    CardIdentity(CardIdentitySelector),
    CardController(ControllerSelector),
    CardOwner(ControllerSelector),
    PlayerController(ControllerSelector),
    CardSupertype(CardSupertypeSelector),
    Tapped(bool),
    StartedTurnTapped(bool),
    CameUnderControlSinceLastUpkeep,
    Zone(ZoneType),
    RememberedCard,
    TriggerRememberedCard,
    EffectSource,
    Commander,
    Legendary,
    Kicked,
    Token(bool),
    Color(CardColorSelector),
    Multicolor,
    Colorless,
    SourceColor(CardColorSelector),
    SourceColorless,
    ChosenColorSource,
    CardState(CardStateSelector),
    Context(ContextPredicate),
    Relation(RelationPredicate),
    DamagedBy,
    AttachedBy,
    WasCast {
        by_you: bool,
    },
    ChosenType,
    Keyword {
        name: String,
        present: bool,
    },
    NumericComparison {
        property: NumericSelectorProperty,
        operator: SelectorCompareOperator,
        value: SelectorNumericOperand,
    },
    NumericParity {
        property: NumericSelectorProperty,
        even: bool,
    },
    CounterComparison {
        operator: SelectorCompareOperator,
        value: SelectorNumericOperand,
        counter_type: String,
    },
    Not(Box<SelectorPredicate>),
    Raw(String),
}

// Intrinsic card/player selector predicates.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CardSelectorType {
    Card,
    Creature,
    Land,
    Instant,
    Sorcery,
    Artifact,
    Enchantment,
    Planeswalker,
    Permanent,
    Spell,
    NonLand,
    NonCreature,
    Named(String),
    Subtype(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CardSupertypeSelector {
    Basic,
    Snow,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControllerSelector {
    You,
    Opponent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CardIdentitySelector {
    Self_,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CardColorSelector {
    White,
    Blue,
    Black,
    Red,
    Green,
}

// Predicates that need match-time context beyond the candidate card itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ContextPredicate {
    Attacking(Option<TargetRef>),
    Blocking(Option<TargetRef>),
    BlockedByValidThisTurn(TargetRef),
    BlockedByValidThisTurnType(CardSelectorType),
    BlockedValidThisTurn(CardSelectorType),
    BlockingValid(CardSelectorType),
    Blocked,
    AttackedThisTurn,
    BlockingSource,
    BlockedBySource,
    WasCastFrom(CastOrigin),
    EnteredThisTurnFrom(ZoneType),
    EnteredUnder(TargetRef),
    TopLibrary,
    ExiledWithSource,
    RememberedPlayerCtrl,
    TargetedPlayerCtrl,
    ActivePlayerCtrl,
    DefenderCtrl,
    EnchantedController,
    ControlledBy(String),
    NotDefinedTargeted,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RelationPredicate {
    SharesNameWith(TargetRef),
    DoesNotShareNameWith(TargetRef),
    SharesCardTypeWith(TargetRef),
    SharesCreatureTypeWith(TargetRef),
    SharesColorWith(TargetRef),
    SharesManaValueWith(TargetRef),
    AttachedTo(TargetRef),
    AttachedToType(CardSelectorType),
    OwnedBy(TargetRef),
    OpponentOf(TargetRef),
    IsTargeting(TargetRef),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TargetRef {
    Source,
    Remembered,
    RememberedLki,
    Imprinted,
    ChosenCard,
    ChosenPlayer,
    Targeted,
    Player,
    Opponent,
    Battlefield,
    OtherYourBattlefield,
    YourGraveyard,
    TriggeredTarget,
    TriggeredPlayer,
    TriggeredCard,
    TriggeredCardController,
    TriggeredDefendingPlayer,
    TriggeredAttackedTarget,
    /// Source controller's registered commander card(s).
    /// Used by Path of Ancestry's `sharesCreatureTypeWith Commander` and
    /// similar relation predicates that compare against the player's commander.
    Commander,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CastOrigin {
    Hand,
    YourHand,
    YourHandByYou,
    TheirHand,
    Exile,
    Graveyard,
    YourGraveyard,
    YourGraveyardByYou,
    YourLibrary,
}

// Intrinsic card state predicates that do not need match-time game context.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CardStateSelector {
    FaceDown,
    Paired,
    PairedWithSource,
    Attached,
    Equipped,
    Enchanted,
    HasCounters,
    IsImprinted,
    Chosen,
    ChosenCard,
    NamedCard,
    ChosenColor,
    EnteredThisTurn,
    WasDealtDamageThisTurn,
    Historic,
    Modified,
    Saddled,
    MayPlaySource,
    Suspended,
    SingleTarget,
    PromisedGift,
    RingBearer,
}

// Numeric selector comparisons (`cmcGE3`, `powerLEX`, `counters_EQ1_P1P1`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NumericSelectorProperty {
    ManaValue,
    Power,
    Toughness,
    TargetCount,
    ManaSpent,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SelectorNumericOperand {
    Literal(i32),
    Symbol(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SelectorCompareOperator {
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum CompiledParamValue {
    Selector(CompiledSelector),
    Reference(CompiledSelector),
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Params(
    BTreeMap<String, String>,
    #[serde(skip)] BTreeMap<String, CompiledParamValue>,
);

impl Params {
    /// Parse a pipe-delimited DSL string into parameters.
    ///
    /// Handles both `Key$ Value` and `Key$Value` (no trailing space) formats.
    /// Mirrors Java's `FileSection.parseToMap()`.
    pub fn from_raw(raw: &str) -> Self {
        crate::perf::increment_params_parse();
        let params = Self::from_parsed(&ParsedParams::parse(raw));
        #[cfg(debug_assertions)]
        debug_assert_eq!(params.inner(), &legacy_parse_params(raw));
        params
    }

    /// Create owned compatibility params from a zero-copy parsed script.
    ///
    /// Duplicate keys intentionally keep Java/map compatibility: later entries
    /// overwrite earlier entries.
    pub fn from_parsed(parsed: &ParsedParams<'_>) -> Self {
        let mut map = BTreeMap::new();
        let mut compiled = BTreeMap::new();
        for entry in parsed.entries() {
            map.insert(entry.key.to_string(), entry.value.to_string());
            if let Some(value) = compile_semantic_param_value(&entry.semantic().value) {
                compiled.insert(entry.key.to_string(), value);
            }
        }
        Params(map, compiled)
    }

    /// Create from an existing map (for migration from raw BTreeMap).
    pub fn from_map(map: BTreeMap<String, String>) -> Self {
        let compiled = compile_param_map(&map);
        Params(map, compiled)
    }

    /// Access the underlying map (escape hatch for incremental migration).
    pub fn inner(&self) -> &BTreeMap<String, String> {
        &self.0
    }

    /// Consume and return the underlying map.
    pub fn into_inner(self) -> BTreeMap<String, String> {
        self.0
    }

    // ── Core accessors (mirror Java CardTraitBase) ──────────────────────

    /// Get a parameter value by key.
    /// Mirrors Java's `CardTraitBase.getParam(String)`.
    pub fn get<K: AsRef<str>>(&self, key: K) -> Option<&str> {
        crate::perf::increment_params_lookup();
        self.0.get(key.as_ref()).map(|s| s.as_str())
    }

    /// Get a parameter value or a default.
    /// Mirrors Java's `CardTraitBase.getParamOrDefault(String, String)`.
    pub fn get_or_default<'a, K: AsRef<str>>(&'a self, key: K, default: &'a str) -> &'a str {
        crate::perf::increment_params_lookup();
        self.0
            .get(key.as_ref())
            .map(|s| s.as_str())
            .unwrap_or(default)
    }

    /// Check if a parameter key exists.
    /// Mirrors Java's `CardTraitBase.hasParam(String)`.
    pub fn has<K: AsRef<str>>(&self, key: K) -> bool {
        crate::perf::increment_params_lookup();
        self.0.contains_key(key.as_ref())
    }

    /// Set a parameter value.
    /// Mirrors Java's `CardTraitBase.putParam(String, String)`.
    pub fn put(&mut self, key: String, value: String) {
        update_compiled_param(&mut self.1, &key, &value);
        self.0.insert(key, value);
    }

    /// Remove a parameter and return its value.
    /// Mirrors Java's `CardTraitBase.removeParam(String)`.
    pub fn remove<K: AsRef<str>>(&mut self, key: K) -> Option<String> {
        let key = key.as_ref();
        self.1.remove(key);
        self.0.remove(key)
    }

    /// Check if the map is empty.
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// Check whether any key exists without recording accessor instrumentation.
    ///
    /// Intended for coarse hot-path gates before a caller decides whether to
    /// perform many instrumented typed lookups.
    pub fn contains_any_key(&self, keys: &[&str]) -> bool {
        keys.iter().any(|key| self.0.contains_key(*key))
    }

    // ── Typed accessors ─────────────────────────────────────────────────

    /// Check if a boolean param is set to "True" (case-insensitive).
    /// Mirrors the common Java pattern `"True".equals(getParam(key))`.
    pub fn is_true<K: AsRef<str>>(&self, key: K) -> bool {
        crate::perf::increment_params_lookup();
        let key = key.as_ref();
        let result = self
            .0
            .get(key)
            .map(|value| match parse_semantic_param_value(key, value) {
                SemanticParamValue::Boolean(value) => value,
                _ => value.eq_ignore_ascii_case("True"),
            })
            .unwrap_or(false);
        #[cfg(debug_assertions)]
        debug_assert_eq!(
            result,
            self.0
                .get(key)
                .is_some_and(|value| value.eq_ignore_ascii_case("True")),
            "semantic boolean param {} diverged from string params",
            key
        );
        result
    }

    /// Parse a parameter as i32, returning None if absent or non-numeric.
    pub fn as_i32<K: AsRef<str>>(&self, key: K) -> Option<i32> {
        crate::perf::increment_params_lookup();
        let key = key.as_ref();
        let result = self.0.get(key).and_then(|value| semantic_i32(key, value));
        #[cfg(debug_assertions)]
        debug_assert_eq!(
            result,
            self.0.get(key).and_then(|value| value.trim().parse().ok()),
            "semantic i32 param {} diverged from string params",
            key
        );
        result
    }

    /// Parse a parameter as usize, returning None if absent or non-numeric.
    pub fn as_usize<K: AsRef<str>>(&self, key: K) -> Option<usize> {
        crate::perf::increment_params_lookup();
        let key = key.as_ref();
        let result = self
            .0
            .get(key)
            .and_then(|value| semantic_i32(key, value))
            .and_then(|value| usize::try_from(value).ok());
        #[cfg(debug_assertions)]
        debug_assert_eq!(
            result,
            self.0.get(key).and_then(|value| value.trim().parse().ok()),
            "semantic usize param {} diverged from string params",
            key
        );
        result
    }

    /// Parse a parameter as a single zone type.
    pub fn zone_type<K: AsRef<str>>(&self, key: K) -> Option<ZoneType> {
        crate::perf::increment_params_lookup();
        let key = key.as_ref();
        let result = self
            .0
            .get(key)
            .and_then(|value| semantic_zone_type(key, value));
        #[cfg(debug_assertions)]
        debug_assert_eq!(
            result,
            self.0.get(key).and_then(|value| legacy_zone_type(value)),
            "semantic zone param {} diverged from string params",
            key
        );
        result
    }

    /// Parse a parameter as a comma-separated zone list.
    pub fn zone_types<K: AsRef<str>>(&self, key: K) -> Vec<ZoneType> {
        crate::perf::increment_params_lookup();
        let key = key.as_ref();
        let result = self
            .0
            .get(key)
            .map(|value| semantic_zone_types(key, value))
            .unwrap_or_default();
        #[cfg(debug_assertions)]
        debug_assert_eq!(
            result,
            self.0
                .get(key)
                .map(|value| legacy_zone_types(value))
                .unwrap_or_default(),
            "semantic zone-list param {} diverged from string params",
            key
        );
        result
    }

    /// Get a selector-like parameter, asserting that semantic classification
    /// agrees with selector/reference usage while preserving the legacy raw
    /// string consumed by current matchers.
    pub fn selector_value<K: AsRef<str>>(&self, key: K) -> Option<&str> {
        crate::perf::increment_params_lookup();
        let key = key.as_ref();
        let value = self.0.get(key).map(String::as_str)?;
        #[cfg(debug_assertions)]
        debug_assert!(
            matches_selector_semantics(key, value),
            "semantic selector param {} classified unexpectedly: {:?}",
            key,
            parse_semantic_param_value(key, value)
        );
        Some(value)
    }

    /// Get a compiled selector-like parameter.
    pub fn selector<K: AsRef<str>>(&self, key: K) -> Option<&CompiledSelector> {
        crate::perf::increment_params_lookup();
        let key = key.as_ref();
        self.selector_untracked(key)
    }

    pub fn selector_untracked<K: AsRef<str>>(&self, key: K) -> Option<&CompiledSelector> {
        let key = key.as_ref();
        match self.1.get(key) {
            Some(CompiledParamValue::Selector(selector))
            | Some(CompiledParamValue::Reference(selector)) => Some(selector),
            None => None,
        }
    }

    /// Get an owned compiled selector-like parameter.
    ///
    /// This is used when trigger/effect structs cache a filter for repeated
    /// execution. It prefers the parser-produced IR and falls back to compiling
    /// the raw value as a selector for compatibility with less-specific
    /// historical keys like `ValidToken`.
    pub fn selector_cloned<K: AsRef<str>>(&self, key: K) -> Option<CompiledSelector> {
        crate::perf::increment_params_lookup();
        let key = key.as_ref();
        match self.1.get(key) {
            Some(CompiledParamValue::Selector(selector))
            | Some(CompiledParamValue::Reference(selector)) => Some(selector.clone()),
            None => self.0.get(key).map(|value| cached_compiled_selector(value)),
        }
    }

    pub fn selector_cloned_any(&self, keys: &[&str]) -> Option<CompiledSelector> {
        keys.iter().find_map(|key| self.selector_cloned(*key))
    }

    /// Get a reference-like parameter, asserting that semantic classification
    /// agrees with reference usage while preserving the legacy raw string.
    pub fn reference_value<K: AsRef<str>>(&self, key: K) -> Option<&str> {
        crate::perf::increment_params_lookup();
        let key = key.as_ref();
        let value = self.0.get(key).map(String::as_str)?;
        #[cfg(debug_assertions)]
        debug_assert!(
            matches_reference_semantics(key, value),
            "semantic reference param {} classified unexpectedly: {:?}",
            key,
            parse_semantic_param_value(key, value)
        );
        Some(value)
    }

    /// Get a compiled reference-like parameter.
    pub fn reference<K: AsRef<str>>(&self, key: K) -> Option<&CompiledSelector> {
        crate::perf::increment_params_lookup();
        let key = key.as_ref();
        match self.1.get(key) {
            Some(CompiledParamValue::Reference(selector))
            | Some(CompiledParamValue::Selector(selector)) => Some(selector),
            None => None,
        }
    }

    /// Get a parameter value, cloning it into an owned String.
    pub fn get_cloned(&self, key: &str) -> Option<String> {
        self.0.get(key).cloned()
    }

    /// Split a delimited parameter value into trimmed, non-empty owned parts.
    pub fn split_param_list<K: AsRef<str>>(&self, key: K, delimiter: &str) -> Vec<String> {
        split_param_list_value(self.get(key), delimiter)
    }

    /// Get a parameter value lowered through the semantic Forge DSL classifier.
    ///
    /// This borrows the stored value and falls back to `SemanticParamValue::Raw`
    /// for keys that are intentionally not classified yet.
    pub fn semantic_value<K: AsRef<str>>(&self, key: K) -> Option<SemanticParamValue<'_>> {
        crate::perf::increment_params_lookup();
        let key = key.as_ref();
        self.0
            .get(key)
            .map(|value| parse_semantic_param_value(key, value))
    }

    // ── Diagnostics ────────────────────────────────────────────────────

    /// Get a required parameter, logging a warning if missing.
    ///
    /// Use this instead of `.get()` when the parameter is expected to exist.
    /// Missing parameters are logged with context for debugging card scripts.
    pub fn require(&self, key: &str, context: &str) -> Option<&str> {
        match self.get(key) {
            Some(v) => Some(v),
            None => {
                eprintln!("[parse] missing required param '{}' in {}", key, context);
                None
            }
        }
    }

    /// Get a required parameter as an owned String, logging if missing.
    pub fn require_cloned(&self, key: &str, context: &str) -> Option<String> {
        self.require(key, context).map(|s| s.to_string())
    }

    // ── Iteration ───────────────────────────────────────────────────────

    /// Iterate over all key-value pairs.
    pub fn iter(&self) -> impl Iterator<Item = (&str, &str)> {
        self.0.iter().map(|(k, v)| (k.as_str(), v.as_str()))
    }
}

pub fn split_param_list_value(value: Option<&str>, delimiter: &str) -> Vec<String> {
    value
        .map(|value| {
            value
                .split(delimiter)
                .map(str::trim)
                .filter(|part| !part.is_empty())
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn semantic_i32(key: &str, value: &str) -> Option<i32> {
    match parse_semantic_param_value(key, value) {
        SemanticParamValue::Integer(value) => Some(value),
        SemanticParamValue::Amount(SemanticAmount::Literal(value)) => Some(value),
        _ => value.trim().parse().ok(),
    }
}

fn semantic_zone_type(key: &str, value: &str) -> Option<ZoneType> {
    match parse_semantic_param_value(key, value) {
        SemanticParamValue::ZoneList(zones) if zones.len() == 1 => {
            zones.first().and_then(|zone| legacy_zone_type(zone))
        }
        SemanticParamValue::ZoneList(_) => None,
        _ => legacy_zone_type(value),
    }
}

fn semantic_zone_types(key: &str, value: &str) -> Vec<ZoneType> {
    match parse_semantic_param_value(key, value) {
        SemanticParamValue::ZoneList(zones) => {
            zones.into_iter().filter_map(legacy_zone_type).collect()
        }
        _ => legacy_zone_types(value),
    }
}

fn legacy_zone_type(value: &str) -> Option<ZoneType> {
    let value = value.trim();
    if value.eq_ignore_ascii_case("Deck") {
        Some(ZoneType::Library)
    } else {
        ZoneType::from_str_compat(value)
    }
}

fn legacy_zone_types(value: &str) -> Vec<ZoneType> {
    value
        .split([',', ' '])
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .filter_map(legacy_zone_type)
        .collect()
}

fn compile_param_map(map: &BTreeMap<String, String>) -> BTreeMap<String, CompiledParamValue> {
    map.iter()
        .filter_map(|(key, value)| {
            compile_semantic_param_value(&parse_semantic_param_value(key, value))
                .map(|compiled| (key.clone(), compiled))
        })
        .collect()
}

fn update_compiled_param(
    compiled: &mut BTreeMap<String, CompiledParamValue>,
    key: &str,
    value: &str,
) {
    match compile_semantic_param_value(&parse_semantic_param_value(key, value)) {
        Some(value) => {
            compiled.insert(key.to_string(), value);
        }
        None => {
            compiled.remove(key);
        }
    }
}

fn compile_semantic_param_value(value: &SemanticParamValue<'_>) -> Option<CompiledParamValue> {
    match value {
        SemanticParamValue::Selector(selector) => Some(CompiledParamValue::Selector(
            compile_semantic_selector(selector),
        )),
        SemanticParamValue::Reference(selector) => Some(CompiledParamValue::Reference(
            compile_semantic_selector(selector),
        )),
        _ => None,
    }
}

fn compile_semantic_selector(selector: &SemanticSelector<'_>) -> CompiledSelector {
    let alternatives = selector
        .alternatives
        .iter()
        .map(|alternative| CompiledSelectorAlternative {
            raw: alternative.raw.to_string(),
            parts: alternative
                .parts
                .iter()
                .map(|part| CompiledSelectorPart {
                    separator: part.separator,
                    value: part.value.to_string(),
                })
                .collect(),
        })
        .collect::<Vec<_>>();
    let ir = lower_compiled_selector(&alternatives);
    CompiledSelector { alternatives, ir }
}

fn lower_compiled_selector(alternatives: &[CompiledSelectorAlternative]) -> Selector {
    Selector {
        alternatives: alternatives
            .iter()
            .map(|alternative| {
                let mut predicates: Vec<_> = alternative
                    .parts
                    .iter()
                    .enumerate()
                    .map(|(idx, part)| lower_selector_part(&part.value, idx == 0))
                    .collect();
                predicates.sort_by_key(selector_predicate_order);
                SelectorAlt { predicates }
            })
            .collect(),
    }
}

fn selector_predicate_order(predicate: &SelectorPredicate) -> u8 {
    match predicate {
        SelectorPredicate::Any
        | SelectorPredicate::CardType(_)
        | SelectorPredicate::CardSupertype(_)
        | SelectorPredicate::Zone(_)
        | SelectorPredicate::CardController(_)
        | SelectorPredicate::CardOwner(_)
        | SelectorPredicate::Tapped(_)
        | SelectorPredicate::StartedTurnTapped(_)
        | SelectorPredicate::CameUnderControlSinceLastUpkeep
        | SelectorPredicate::Token(_)
        | SelectorPredicate::Color(_)
        | SelectorPredicate::Multicolor
        | SelectorPredicate::Colorless
        | SelectorPredicate::Commander
        | SelectorPredicate::Legendary
        | SelectorPredicate::Kicked => 0,
        SelectorPredicate::CardIdentity(_) | SelectorPredicate::PlayerController(_) => 1,
        SelectorPredicate::NumericComparison { .. }
        | SelectorPredicate::NumericParity { .. }
        | SelectorPredicate::CounterComparison { .. }
        | SelectorPredicate::Keyword { .. }
        | SelectorPredicate::CardState(_)
        | SelectorPredicate::ChosenType
        | SelectorPredicate::WasCast { .. }
        | SelectorPredicate::SourceColor(_)
        | SelectorPredicate::SourceColorless
        | SelectorPredicate::ChosenColorSource => 2,
        SelectorPredicate::Context(_) => 3,
        SelectorPredicate::Relation(_) => 4,
        SelectorPredicate::RememberedCard
        | SelectorPredicate::TriggerRememberedCard
        | SelectorPredicate::EffectSource
        | SelectorPredicate::DamagedBy
        | SelectorPredicate::AttachedBy => 5,
        SelectorPredicate::Not(inner) => selector_predicate_order(inner).saturating_add(1),
        SelectorPredicate::Player => 6,
        SelectorPredicate::Raw(_) => 7,
    }
}

fn lower_selector_part(value: &str, is_first_part: bool) -> SelectorPredicate {
    let normalized = value.trim();
    if normalized.is_empty() {
        return SelectorPredicate::Raw(String::new());
    }
    let lower = normalized.to_ascii_lowercase();
    if is_first_part {
        return match lower.as_str() {
            "any" => SelectorPredicate::Any,
            "card" => SelectorPredicate::CardType(CardSelectorType::Card),
            "creature" => SelectorPredicate::CardType(CardSelectorType::Creature),
            "land" => SelectorPredicate::CardType(CardSelectorType::Land),
            "instant" => SelectorPredicate::CardType(CardSelectorType::Instant),
            "sorcery" => SelectorPredicate::CardType(CardSelectorType::Sorcery),
            "artifact" => SelectorPredicate::CardType(CardSelectorType::Artifact),
            "enchantment" => SelectorPredicate::CardType(CardSelectorType::Enchantment),
            "planeswalker" => SelectorPredicate::CardType(CardSelectorType::Planeswalker),
            "permanent" => SelectorPredicate::CardType(CardSelectorType::Permanent),
            "spell" => SelectorPredicate::CardType(CardSelectorType::Spell),
            "nonland" => SelectorPredicate::CardType(CardSelectorType::NonLand),
            "noncreature" => SelectorPredicate::CardType(CardSelectorType::NonCreature),
            "player" | "each" | "player.ingame" => SelectorPredicate::Player,
            "you" | "youctrl" => SelectorPredicate::PlayerController(ControllerSelector::You),
            "opponent" | "oppctrl" | "opponentctrl" => {
                SelectorPredicate::PlayerController(ControllerSelector::Opponent)
            }
            named if named.starts_with("named") => SelectorPredicate::CardType(
                CardSelectorType::Named(normalized[5..].trim().to_string()),
            ),
            _ => SelectorPredicate::CardType(CardSelectorType::Subtype(normalized.to_string())),
        };
    }

    if let Some(stripped) = normalized.strip_prefix('!') {
        let predicate = lower_selector_part(stripped, false);
        return SelectorPredicate::Not(Box::new(predicate));
    }

    match lower.as_str() {
        "self" | "strictlyself" => SelectorPredicate::CardIdentity(CardIdentitySelector::Self_),
        "other" | "strictlyother" => SelectorPredicate::CardIdentity(CardIdentitySelector::Other),
        "you" | "youctrl" | "youcontrol" => {
            SelectorPredicate::CardController(ControllerSelector::You)
        }
        "opponent" | "oppctrl" | "opponentctrl" => {
            SelectorPredicate::CardController(ControllerSelector::Opponent)
        }
        "chosenctrl" => SelectorPredicate::Raw(normalized.to_string()),
        "youown" => SelectorPredicate::CardOwner(ControllerSelector::You),
        "oppown" | "opponentown" => SelectorPredicate::CardOwner(ControllerSelector::Opponent),
        // Raw — runtime-resolved against the SA's target list in valid_filter.
        // (`targetedplayerctrl` already lowers to a Context predicate below.)
        "targetedplayerown" | "targetedown" | "targetedowner" => {
            SelectorPredicate::Raw(normalized.to_string())
        }
        "youdontctrl" => SelectorPredicate::Not(Box::new(SelectorPredicate::CardController(
            ControllerSelector::You,
        ))),
        "youdontown" => SelectorPredicate::Not(Box::new(SelectorPredicate::CardOwner(
            ControllerSelector::You,
        ))),
        "tapped" => SelectorPredicate::Tapped(true),
        "untapped" => SelectorPredicate::Tapped(false),
        "startedtheturntapped" => SelectorPredicate::StartedTurnTapped(true),
        "startedtheturnuntapped" => SelectorPredicate::StartedTurnTapped(false),
        "cameundercontrolsincelastupkeep" => SelectorPredicate::CameUnderControlSinceLastUpkeep,
        "inzonebattlefield" => SelectorPredicate::Zone(ZoneType::Battlefield),
        "inzonegraveyard" => SelectorPredicate::Zone(ZoneType::Graveyard),
        "inzonehand" => SelectorPredicate::Zone(ZoneType::Hand),
        "inzoneexile" => SelectorPredicate::Zone(ZoneType::Exile),
        "inzonestack" => SelectorPredicate::Zone(ZoneType::Stack),
        "isremembered" => SelectorPredicate::RememberedCard,
        "istriggerremembered" => SelectorPredicate::TriggerRememberedCard,
        "effectsource" => SelectorPredicate::EffectSource,
        "iscommander" => SelectorPredicate::Commander,
        "legendary" => SelectorPredicate::Legendary,
        "basic" => SelectorPredicate::CardSupertype(CardSupertypeSelector::Basic),
        "snow" => SelectorPredicate::CardSupertype(CardSupertypeSelector::Snow),
        "kicked" => SelectorPredicate::Kicked,
        "token" => SelectorPredicate::Token(true),
        "nontoken" => SelectorPredicate::Token(false),
        "creature" => SelectorPredicate::CardType(CardSelectorType::Creature),
        "land" => SelectorPredicate::CardType(CardSelectorType::Land),
        "instant" => SelectorPredicate::CardType(CardSelectorType::Instant),
        "sorcery" => SelectorPredicate::CardType(CardSelectorType::Sorcery),
        "artifact" => SelectorPredicate::CardType(CardSelectorType::Artifact),
        "enchantment" => SelectorPredicate::CardType(CardSelectorType::Enchantment),
        "planeswalker" => SelectorPredicate::CardType(CardSelectorType::Planeswalker),
        "permanent" => SelectorPredicate::CardType(CardSelectorType::Permanent),
        "noncreature" => SelectorPredicate::CardType(CardSelectorType::NonCreature),
        "nonland" => SelectorPredicate::CardType(CardSelectorType::NonLand),
        "time lord" => {
            SelectorPredicate::CardType(CardSelectorType::Subtype("Time Lord".to_string()))
        }
        "white" => SelectorPredicate::Color(CardColorSelector::White),
        "blue" => SelectorPredicate::Color(CardColorSelector::Blue),
        "black" => SelectorPredicate::Color(CardColorSelector::Black),
        "red" => SelectorPredicate::Color(CardColorSelector::Red),
        "green" => SelectorPredicate::Color(CardColorSelector::Green),
        "multicolor" => SelectorPredicate::Multicolor,
        "colorless" => SelectorPredicate::Colorless,
        "whitesource" => SelectorPredicate::SourceColor(CardColorSelector::White),
        "bluesource" => SelectorPredicate::SourceColor(CardColorSelector::Blue),
        "blacksource" => SelectorPredicate::SourceColor(CardColorSelector::Black),
        "redsource" => SelectorPredicate::SourceColor(CardColorSelector::Red),
        "greensource" => SelectorPredicate::SourceColor(CardColorSelector::Green),
        "colorlesssource" => SelectorPredicate::SourceColorless,
        "chosencolorsource" => SelectorPredicate::ChosenColorSource,
        "attacking" => SelectorPredicate::Context(ContextPredicate::Attacking(None)),
        "attackingyou" => {
            SelectorPredicate::Context(ContextPredicate::Attacking(Some(TargetRef::Source)))
        }
        "blocking" => SelectorPredicate::Context(ContextPredicate::Blocking(None)),
        "blocked" => SelectorPredicate::Context(ContextPredicate::Blocked),
        "attackedthisturn" => SelectorPredicate::Context(ContextPredicate::AttackedThisTurn),
        "blockingsource" => SelectorPredicate::Context(ContextPredicate::BlockingSource),
        "blockedbysource" => SelectorPredicate::Context(ContextPredicate::BlockedBySource),
        "samename" => {
            SelectorPredicate::Relation(RelationPredicate::SharesNameWith(TargetRef::Source))
        }
        "damagedby" => SelectorPredicate::DamagedBy,
        "equippedby" | "enchantedby" | "attachedby" => SelectorPredicate::AttachedBy,
        "facedown" => SelectorPredicate::CardState(CardStateSelector::FaceDown),
        "paired" => SelectorPredicate::CardState(CardStateSelector::Paired),
        "pairedwith" => SelectorPredicate::CardState(CardStateSelector::PairedWithSource),
        "attached" => SelectorPredicate::CardState(CardStateSelector::Attached),
        "equipped" => SelectorPredicate::CardState(CardStateSelector::Equipped),
        "enchanted" => SelectorPredicate::CardState(CardStateSelector::Enchanted),
        "hascounters" => SelectorPredicate::CardState(CardStateSelector::HasCounters),
        "isimprinted" => SelectorPredicate::CardState(CardStateSelector::IsImprinted),
        "chosen" => SelectorPredicate::CardState(CardStateSelector::Chosen),
        "chosencard" | "chosencardstrict" => {
            SelectorPredicate::CardState(CardStateSelector::ChosenCard)
        }
        "namedcard" => SelectorPredicate::CardState(CardStateSelector::NamedCard),
        "chosencolor" => SelectorPredicate::CardState(CardStateSelector::ChosenColor),
        "thisturnentered" => SelectorPredicate::CardState(CardStateSelector::EnteredThisTurn),
        "wasdealtdamagethisturn" => {
            SelectorPredicate::CardState(CardStateSelector::WasDealtDamageThisTurn)
        }
        "historic" => SelectorPredicate::CardState(CardStateSelector::Historic),
        "modified" => SelectorPredicate::CardState(CardStateSelector::Modified),
        "issaddled" => SelectorPredicate::CardState(CardStateSelector::Saddled),
        "mayplaysource" => SelectorPredicate::CardState(CardStateSelector::MayPlaySource),
        "exiledwithsource" => SelectorPredicate::Context(ContextPredicate::ExiledWithSource),
        "toplibrary" => SelectorPredicate::Context(ContextPredicate::TopLibrary),
        "suspended" => SelectorPredicate::CardState(CardStateSelector::Suspended),
        "singletarget" => SelectorPredicate::CardState(CardStateSelector::SingleTarget),
        "promisedgift" => SelectorPredicate::CardState(CardStateSelector::PromisedGift),
        "isringbearer" => SelectorPredicate::CardState(CardStateSelector::RingBearer),
        "wascast" => SelectorPredicate::WasCast { by_you: false },
        "wascastbyyou" => SelectorPredicate::WasCast { by_you: true },
        named if named.starts_with("named") => {
            SelectorPredicate::CardType(CardSelectorType::Named(normalized[5..].trim().to_string()))
        }
        cast_origin if cast_origin.starts_with("wascastfrom") => {
            lower_cast_origin_predicate(normalized)
                .unwrap_or_else(|| SelectorPredicate::Raw(normalized.to_string()))
        }
        "chosentype" => SelectorPredicate::ChosenType,
        "rememberedplayerctrl" => {
            SelectorPredicate::Context(ContextPredicate::RememberedPlayerCtrl)
        }
        "targetedplayerctrl" => SelectorPredicate::Context(ContextPredicate::TargetedPlayerCtrl),
        "activeplayerctrl" => SelectorPredicate::Context(ContextPredicate::ActivePlayerCtrl),
        "defenderctrl" => SelectorPredicate::Context(ContextPredicate::DefenderCtrl),
        "enchantedcontroller" => SelectorPredicate::Context(ContextPredicate::EnchantedController),
        "notdefinedtargeted" => SelectorPredicate::Context(ContextPredicate::NotDefinedTargeted),
        controlled if controlled.starts_with("controlledby ") => SelectorPredicate::Context(
            ContextPredicate::ControlledBy(normalized["ControlledBy ".len()..].trim().to_string()),
        ),
        shares if shares.starts_with("sharesnamewith") => {
            lower_relation_target_ref(normalized["sharesNameWith".len()..].trim())
                .map(|target| {
                    SelectorPredicate::Relation(RelationPredicate::SharesNameWith(target))
                })
                .unwrap_or_else(|| SelectorPredicate::Raw(normalized.to_string()))
        }
        shares if shares.starts_with("doesnotsharenamewith") => {
            lower_relation_target_ref(normalized["doesNotShareNameWith".len()..].trim())
                .map(|target| {
                    SelectorPredicate::Relation(RelationPredicate::DoesNotShareNameWith(target))
                })
                .unwrap_or_else(|| SelectorPredicate::Raw(normalized.to_string()))
        }
        shares if shares.starts_with("sharescardtypewith") => {
            lower_relation_target_ref(normalized["sharesCardTypeWith".len()..].trim())
                .map(|target| {
                    SelectorPredicate::Relation(RelationPredicate::SharesCardTypeWith(target))
                })
                .unwrap_or_else(|| SelectorPredicate::Raw(normalized.to_string()))
        }
        shares if shares.starts_with("sharescolorwith") => {
            lower_relation_target_ref(normalized["SharesColorWith".len()..].trim())
                .map(|target| {
                    SelectorPredicate::Relation(RelationPredicate::SharesColorWith(target))
                })
                .unwrap_or_else(|| SelectorPredicate::Raw(normalized.to_string()))
        }
        shares if shares.starts_with("sharescmcwith") => {
            lower_relation_target_ref(normalized["SharesCMCWith".len()..].trim())
                .map(|target| {
                    SelectorPredicate::Relation(RelationPredicate::SharesManaValueWith(target))
                })
                .unwrap_or_else(|| SelectorPredicate::Raw(normalized.to_string()))
        }
        shares if shares.starts_with("sharescreaturetypewith") => {
            lower_relation_target_ref(normalized["sharesCreatureTypeWith".len()..].trim())
                .map(|target| {
                    SelectorPredicate::Relation(RelationPredicate::SharesCreatureTypeWith(target))
                })
                .unwrap_or_else(|| SelectorPredicate::Raw(normalized.to_string()))
        }
        attacking if attacking.starts_with("attacking ") => {
            lower_relation_target_ref(normalized["attacking ".len()..].trim())
                .map(|target| SelectorPredicate::Context(ContextPredicate::Attacking(Some(target))))
                .unwrap_or_else(|| SelectorPredicate::Raw(normalized.to_string()))
        }
        blocked_by if blocked_by.starts_with("blockedbyvalidthisturn ") => {
            lower_blocked_by_valid_this_turn(normalized["blockedByValidThisTurn ".len()..].trim())
                .unwrap_or_else(|| SelectorPredicate::Raw(normalized.to_string()))
        }
        blocked if blocked.starts_with("blockedvalidthisturn ") => {
            lower_card_selector_type(normalized["blockedValidThisTurn ".len()..].trim())
                .map(|card_type| {
                    SelectorPredicate::Context(ContextPredicate::BlockedValidThisTurn(card_type))
                })
                .unwrap_or_else(|| SelectorPredicate::Raw(normalized.to_string()))
        }
        blocking_valid if blocking_valid.starts_with("blockingvalid ") => {
            lower_card_selector_type(normalized["blockingValid ".len()..].trim())
                .map(|card_type| {
                    SelectorPredicate::Context(ContextPredicate::BlockingValid(card_type))
                })
                .unwrap_or_else(|| SelectorPredicate::Raw(normalized.to_string()))
        }
        blocking if blocking.starts_with("blocking ") => {
            lower_relation_target_ref(normalized["blocking ".len()..].trim())
                .map(|target| SelectorPredicate::Context(ContextPredicate::Blocking(Some(target))))
                .unwrap_or_else(|| SelectorPredicate::Raw(normalized.to_string()))
        }
        attached if attached.starts_with("attachedto ") => {
            lower_attached_to_relation(normalized["AttachedTo ".len()..].trim())
                .unwrap_or_else(|| SelectorPredicate::Raw(normalized.to_string()))
        }
        owned if owned.starts_with("ownedby ") => {
            lower_relation_target_ref(normalized["OwnedBy ".len()..].trim())
                .map(|target| SelectorPredicate::Relation(RelationPredicate::OwnedBy(target)))
                .unwrap_or_else(|| SelectorPredicate::Raw(normalized.to_string()))
        }
        opponent if opponent.starts_with("opponentof ") => {
            lower_relation_target_ref(normalized["OpponentOf ".len()..].trim())
                .map(|target| SelectorPredicate::Relation(RelationPredicate::OpponentOf(target)))
                .unwrap_or_else(|| SelectorPredicate::Raw(normalized.to_string()))
        }
        targeting if targeting.starts_with("istargeting ") => {
            lower_relation_target_ref(normalized["IsTargeting ".len()..].trim())
                .map(|target| SelectorPredicate::Relation(RelationPredicate::IsTargeting(target)))
                .unwrap_or_else(|| SelectorPredicate::Raw(normalized.to_string()))
        }
        entered if entered.starts_with("thisturnenteredfrom_") => {
            lower_entered_from_zone(normalized["ThisTurnEnteredFrom_".len()..].trim())
                .map(|zone| SelectorPredicate::Context(ContextPredicate::EnteredThisTurnFrom(zone)))
                .unwrap_or_else(|| SelectorPredicate::Raw(normalized.to_string()))
        }
        entered if entered.starts_with("enteredunder ") => {
            lower_relation_target_ref(normalized["EnteredUnder ".len()..].trim())
                .map(|target| SelectorPredicate::Context(ContextPredicate::EnteredUnder(target)))
                .unwrap_or_else(|| SelectorPredicate::Raw(normalized.to_string()))
        }
        _ => lower_non_predicate(normalized).unwrap_or_else(|| {
            lower_keyword_predicate(normalized).unwrap_or_else(|| {
                lower_selector_comparison(normalized).unwrap_or_else(|| {
                    lower_counter_comparison(normalized).unwrap_or_else(|| {
                        lower_subtype_predicate(normalized)
                            .unwrap_or_else(|| SelectorPredicate::Raw(normalized.to_string()))
                    })
                })
            })
        }),
    }
}

fn lower_relation_target_ref(value: &str) -> Option<TargetRef> {
    if value.is_empty()
        || value.eq_ignore_ascii_case("Self")
        || value.eq_ignore_ascii_case("Source")
        || value.eq_ignore_ascii_case("You")
        || value.eq_ignore_ascii_case("YouCtrl")
    {
        Some(TargetRef::Source)
    } else if value.eq_ignore_ascii_case("Remembered") {
        Some(TargetRef::Remembered)
    } else if value.eq_ignore_ascii_case("RememberedLKI") {
        Some(TargetRef::RememberedLki)
    } else if value.eq_ignore_ascii_case("Imprinted") {
        Some(TargetRef::Imprinted)
    } else if value.eq_ignore_ascii_case("ChosenCard") {
        Some(TargetRef::ChosenCard)
    } else if value.eq_ignore_ascii_case("ChosenPlayer") {
        Some(TargetRef::ChosenPlayer)
    } else if value.eq_ignore_ascii_case("Targeted")
        || value.eq_ignore_ascii_case("TargetedPlayer")
        || value.eq_ignore_ascii_case("TargetedController")
    {
        Some(TargetRef::Targeted)
    } else if value.eq_ignore_ascii_case("Player") {
        Some(TargetRef::Player)
    } else if value.eq_ignore_ascii_case("Opponent") {
        Some(TargetRef::Opponent)
    } else if value.eq_ignore_ascii_case("Battlefield") {
        Some(TargetRef::Battlefield)
    } else if value.eq_ignore_ascii_case("OtherYourBattlefield") {
        Some(TargetRef::OtherYourBattlefield)
    } else if value.eq_ignore_ascii_case("YourGraveyard") {
        Some(TargetRef::YourGraveyard)
    } else if value.eq_ignore_ascii_case("TriggeredTarget") {
        Some(TargetRef::TriggeredTarget)
    } else if value.eq_ignore_ascii_case("TriggeredPlayer") {
        Some(TargetRef::TriggeredPlayer)
    } else if value.eq_ignore_ascii_case("TriggeredCard") {
        Some(TargetRef::TriggeredCard)
    } else if value.eq_ignore_ascii_case("TriggeredCardController") {
        Some(TargetRef::TriggeredCardController)
    } else if value.eq_ignore_ascii_case("TriggeredDefendingPlayer") {
        Some(TargetRef::TriggeredDefendingPlayer)
    } else if value.eq_ignore_ascii_case("TriggeredAttackedTarget") {
        Some(TargetRef::TriggeredAttackedTarget)
    } else if value.eq_ignore_ascii_case("Commander") {
        Some(TargetRef::Commander)
    } else {
        None
    }
}

fn lower_blocked_by_valid_this_turn(value: &str) -> Option<SelectorPredicate> {
    if let Some(target) = lower_relation_target_ref(value) {
        return Some(SelectorPredicate::Context(
            ContextPredicate::BlockedByValidThisTurn(target),
        ));
    }
    lower_card_selector_type(value).map(|card_type| {
        SelectorPredicate::Context(ContextPredicate::BlockedByValidThisTurnType(card_type))
    })
}

fn lower_card_selector_type(value: &str) -> Option<CardSelectorType> {
    match value.to_ascii_lowercase().as_str() {
        "card" => Some(CardSelectorType::Card),
        "creature" => Some(CardSelectorType::Creature),
        "land" => Some(CardSelectorType::Land),
        "artifact" => Some(CardSelectorType::Artifact),
        "enchantment" => Some(CardSelectorType::Enchantment),
        "planeswalker" => Some(CardSelectorType::Planeswalker),
        "permanent" => Some(CardSelectorType::Permanent),
        "nonland" => Some(CardSelectorType::NonLand),
        "noncreature" => Some(CardSelectorType::NonCreature),
        _ if value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '\'') =>
        {
            Some(CardSelectorType::Subtype(value.to_string()))
        }
        _ => None,
    }
}

fn lower_entered_from_zone(value: &str) -> Option<ZoneType> {
    match value.to_ascii_lowercase().as_str() {
        "battlefield" => Some(ZoneType::Battlefield),
        "graveyard" => Some(ZoneType::Graveyard),
        "library" => Some(ZoneType::Library),
        "hand" => Some(ZoneType::Hand),
        "exile" => Some(ZoneType::Exile),
        _ => None,
    }
}

fn lower_attached_to_relation(value: &str) -> Option<SelectorPredicate> {
    if let Some(target) = lower_relation_target_ref(value) {
        return Some(SelectorPredicate::Relation(RelationPredicate::AttachedTo(
            target,
        )));
    }
    let card_type = match value.to_ascii_lowercase().as_str() {
        "card" => CardSelectorType::Card,
        "creature" => CardSelectorType::Creature,
        "land" => CardSelectorType::Land,
        "artifact" => CardSelectorType::Artifact,
        "enchantment" => CardSelectorType::Enchantment,
        "permanent" => CardSelectorType::Permanent,
        _ => return None,
    };
    Some(SelectorPredicate::Relation(
        RelationPredicate::AttachedToType(card_type),
    ))
}

fn lower_cast_origin_predicate(value: &str) -> Option<SelectorPredicate> {
    let lower = value.to_ascii_lowercase();
    let origin = match lower.as_str() {
        "wascastfromhand" => CastOrigin::Hand,
        "wascastfromyourhand" => CastOrigin::YourHand,
        "wascastfromyourhandbyyou" => CastOrigin::YourHandByYou,
        "wascastfromtheirhand" => CastOrigin::TheirHand,
        "wascastfromexile" => CastOrigin::Exile,
        "wascastfromgraveyard" => CastOrigin::Graveyard,
        "wascastfromyourgraveyard" => CastOrigin::YourGraveyard,
        "wascastfromyourgraveyardbyyou" => CastOrigin::YourGraveyardByYou,
        "wascastfromyourlibrary" => CastOrigin::YourLibrary,
        _ => return None,
    };
    Some(SelectorPredicate::Context(ContextPredicate::WasCastFrom(
        origin,
    )))
}

fn lower_non_predicate(value: &str) -> Option<SelectorPredicate> {
    let lower = value.to_ascii_lowercase();
    let rest = lower.strip_prefix("non")?;
    if rest.is_empty() {
        return None;
    }
    let positive = match rest {
        "white" => SelectorPredicate::Color(CardColorSelector::White),
        "blue" => SelectorPredicate::Color(CardColorSelector::Blue),
        "black" => SelectorPredicate::Color(CardColorSelector::Black),
        "red" => SelectorPredicate::Color(CardColorSelector::Red),
        "green" => SelectorPredicate::Color(CardColorSelector::Green),
        "colorless" => SelectorPredicate::Colorless,
        "creature" => SelectorPredicate::CardType(CardSelectorType::Creature),
        "land" => SelectorPredicate::CardType(CardSelectorType::Land),
        "artifact" => SelectorPredicate::CardType(CardSelectorType::Artifact),
        "enchantment" => SelectorPredicate::CardType(CardSelectorType::Enchantment),
        "legendary" => SelectorPredicate::Legendary,
        "basic" => SelectorPredicate::CardSupertype(CardSupertypeSelector::Basic),
        "snow" => SelectorPredicate::CardSupertype(CardSupertypeSelector::Snow),
        "token" => SelectorPredicate::Token(true),
        _ => SelectorPredicate::CardType(CardSelectorType::Subtype(value[3..].to_string())),
    };
    Some(SelectorPredicate::Not(Box::new(positive)))
}

fn lower_keyword_predicate(value: &str) -> Option<SelectorPredicate> {
    let lower = value.to_ascii_lowercase();
    if lower.starts_with("without") && value.len() > 7 {
        return Some(SelectorPredicate::Keyword {
            name: value[7..].to_string(),
            present: false,
        });
    }
    if lower.starts_with("with") && value.len() > 4 {
        return Some(SelectorPredicate::Keyword {
            name: value[4..].to_string(),
            present: true,
        });
    }
    None
}

fn lower_subtype_predicate(value: &str) -> Option<SelectorPredicate> {
    let lower = value.to_ascii_lowercase();
    let structured = lower.starts_with("cmc")
        || lower.starts_with("power")
        || lower.starts_with("toughness")
        || lower.starts_with("counters_")
        || lower.starts_with("wascastfrom")
        || lower.starts_with("shares")
        || lower.starts_with("attached")
        || lower.starts_with("controlledby ")
        || lower.ends_with("source")
        || value.contains(' ')
        || value.contains('_')
        || value.contains('/');
    if structured
        || value.is_empty()
        || !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '\'')
    {
        return None;
    }
    Some(SelectorPredicate::CardType(CardSelectorType::Subtype(
        value.to_string(),
    )))
}

fn lower_selector_comparison(value: &str) -> Option<SelectorPredicate> {
    let lower = value.to_ascii_lowercase();
    let (property, rest) = if lower.starts_with("cmc") {
        (NumericSelectorProperty::ManaValue, &value[3..])
    } else if lower.starts_with("power") {
        (NumericSelectorProperty::Power, &value[5..])
    } else if lower.starts_with("toughness") {
        (NumericSelectorProperty::Toughness, &value[9..])
    } else if lower.starts_with("numtargets ") {
        (NumericSelectorProperty::TargetCount, value[11..].trim())
    } else if lower.starts_with("manaspent ") {
        (NumericSelectorProperty::ManaSpent, value[10..].trim())
    } else {
        return None;
    };
    if rest.eq_ignore_ascii_case("even") {
        return Some(SelectorPredicate::NumericParity {
            property,
            even: true,
        });
    }
    if rest.eq_ignore_ascii_case("odd") {
        return Some(SelectorPredicate::NumericParity {
            property,
            even: false,
        });
    }
    let (operator, value) = parse_selector_comparison(rest)?;
    Some(SelectorPredicate::NumericComparison {
        property,
        operator,
        value,
    })
}

fn lower_counter_comparison(value: &str) -> Option<SelectorPredicate> {
    let rest = value.strip_prefix("counters_")?;
    let operator = parse_selector_operator(rest.get(..2)?)?;
    let after_op = rest.get(2..)?;
    let split = after_op.find('_')?;
    let value = parse_selector_operand(&after_op[..split])?;
    let counter_type = after_op[split + 1..].to_string();
    Some(SelectorPredicate::CounterComparison {
        operator,
        value,
        counter_type,
    })
}

fn parse_selector_comparison(
    rest: &str,
) -> Option<(SelectorCompareOperator, SelectorNumericOperand)> {
    let operator = parse_selector_operator(rest.get(..2)?)?;
    let value = parse_selector_operand(rest.get(2..)?)?;
    Some((operator, value))
}

fn parse_selector_operand(value: &str) -> Option<SelectorNumericOperand> {
    if value.is_empty() {
        return None;
    }
    if let Ok(value) = value.parse::<i32>() {
        Some(SelectorNumericOperand::Literal(value))
    } else if value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
    {
        Some(SelectorNumericOperand::Symbol(value.to_string()))
    } else {
        None
    }
}

fn parse_selector_operator(operator: &str) -> Option<SelectorCompareOperator> {
    match operator.to_ascii_lowercase().as_str() {
        "eq" => Some(SelectorCompareOperator::Eq),
        "ne" => Some(SelectorCompareOperator::Ne),
        "lt" => Some(SelectorCompareOperator::Lt),
        "le" => Some(SelectorCompareOperator::Le),
        "gt" => Some(SelectorCompareOperator::Gt),
        "ge" => Some(SelectorCompareOperator::Ge),
        _ => None,
    }
}

#[cfg(debug_assertions)]
fn matches_selector_semantics(key: &str, value: &str) -> bool {
    matches!(
        parse_semantic_param_value(key, value),
        SemanticParamValue::Selector(_)
            | SemanticParamValue::Reference(_)
            | SemanticParamValue::SVarReference(_)
            | SemanticParamValue::DelimitedList(_)
            | SemanticParamValue::Raw(_)
    )
}

#[cfg(debug_assertions)]
fn matches_reference_semantics(key: &str, value: &str) -> bool {
    matches!(
        parse_semantic_param_value(key, value),
        SemanticParamValue::Reference(_)
            | SemanticParamValue::Selector(_)
            | SemanticParamValue::SVarReference(_)
            | SemanticParamValue::Raw(_)
    )
}

#[cfg(debug_assertions)]
fn legacy_parse_params(raw: &str) -> BTreeMap<String, String> {
    let mut map = BTreeMap::new();
    for part in raw.split('|') {
        let part = part.trim();
        if let Some(idx) = part.find("$ ") {
            let key = part[..idx].trim().to_string();
            let value = part[idx + 2..].trim().to_string();
            map.insert(key, value);
        } else if let Some(idx) = part.find('$') {
            let key = part[..idx].trim().to_string();
            let value = part[idx + 1..].trim().to_string();
            map.insert(key, value);
        }
    }
    map
}

/// Adapter: convert a parse result to Option, logging failures only when
/// the raw input looks like it was *intended* to be the given kind.
///
/// Card scripts pass all ability lines to all parsers — most `None` results
/// are intentional (e.g., an `AB$` line passed to `parse_static_ability`).
/// This function only warns when the line's prefix matches the expected kind.
///
/// ```ignore
/// .filter_map(|raw| parse_or_warn(parse_static_ability(raw), "StaticAbility", raw))
/// ```
/// Like [`parse_or_warn`], but for lines the card parser already classified
/// (`T:`/`S:`/`R:` records, stored prefix-stripped on the face): a `None`
/// here silently drops a known rule, so it always warns.
pub fn parse_classified_or_warn<T>(result: Option<T>, kind: &str, raw: &str) -> Option<T> {
    if result.is_none() {
        let preview: String = raw.trim().chars().take(100).collect();
        eprintln!("[parse] failed to parse {kind} from: {preview}");
    }
    result
}

pub fn parse_or_warn<T>(result: Option<T>, kind: &str, raw: &str) -> Option<T> {
    if result.is_none() {
        let trimmed = raw.trim();
        let should_warn = match kind {
            "StaticAbility" => trimmed.starts_with("S$") || trimmed.starts_with("S:"),
            "ReplacementEffect" => trimmed.starts_with("R$") || trimmed.starts_with("R:"),
            "Trigger" => trimmed.starts_with("T$") || trimmed.starts_with("T:"),
            "ActivatedAbility" => {
                // Only AB$ lines are activated abilities. SP$ (spell) and DB$
                // (sub-ability) lines are resolved via build_spell_ability, not
                // parse_activated_ability — their None result is intentional.
                trimmed.starts_with("AB$") || trimmed.starts_with("AB:")
            }
            _ => false,
        };
        if should_warn {
            let preview: String = trimmed.chars().take(100).collect();
            eprintln!("[parse] failed to parse {} from: {}", kind, preview);
        }
    }
    result
}

// ── Conversions for incremental migration ───────────────────────────────────

impl From<BTreeMap<String, String>> for Params {
    fn from(map: BTreeMap<String, String>) -> Self {
        Params::from_map(map)
    }
}

impl From<Params> for BTreeMap<String, String> {
    fn from(params: Params) -> Self {
        params.0
    }
}

// ── Shared DSL parsing utilities ─────────────────────────────────────────────

/// Strip a `/Times.N` multiplier suffix from a filter string.
/// Returns (filter_without_suffix, multiplier).
///
/// Used by SVar `Count$Valid` expressions and cost parsing.
/// Example: `"Enchantment.Other/Times.2"` → `("Enchantment.Other", 2)`
pub fn strip_times_multiplier(s: &str) -> (&str, i32) {
    if let Some(idx) = s.find("/Times.") {
        let mult_str = &s[idx + 7..];
        let mult = mult_str.parse::<i32>().unwrap_or(1);
        (&s[..idx], mult)
    } else {
        (s, 1)
    }
}

/// Map an "Enchant <type>" keyword value to a ValidTgts$ filter string.
/// Used by aura targeting (ability_factory) and aura SBA legality (action.rs).
///
/// Example: `"creature"` → `"Creature"`, `"land"` → `"Land"`
fn normalize_enchant_type(enchant_type: &str) -> &str {
    enchant_type
        .split_once(':')
        .map(|(kind, _)| kind)
        .unwrap_or(enchant_type)
        .trim()
}

pub fn enchant_type_to_valid_tgts(enchant_type: &str) -> String {
    let normalized = normalize_enchant_type(enchant_type).trim();
    match normalized.to_lowercase().as_str() {
        "creature" => "Creature".to_string(),
        "land" => "Land".to_string(),
        "artifact" => "Artifact".to_string(),
        "enchantment" => "Enchantment".to_string(),
        "planeswalker" => "Planeswalker".to_string(),
        "permanent" | "" => "Permanent".to_string(),
        "player" => "Player".to_string(),
        "creature or player" => "Creature,Player".to_string(),
        // Compound filters like "Creature.Legendary" pass through verbatim so
        // the targeting layer applies the full restriction rather than
        // collapsing to "Permanent" (which would let any permanent qualify).
        _ => normalized.to_string(),
    }
}

/// Build a minimal targeting params string from an Enchant keyword payload.
/// Handles special cases like `Creature.inZoneGraveyard` used by Animate Dead.
pub fn enchant_type_to_target_params(enchant_type: &str) -> String {
    let normalized = normalize_enchant_type(enchant_type);
    let lower = normalized.to_lowercase();
    if lower == "creature.inzonegraveyard" {
        return "Origin$ Graveyard | ValidTgts$ Creature".to_string();
    }
    format!("ValidTgts$ {}", enchant_type_to_valid_tgts(normalized))
}

/// Check if a card type matches an "Enchant <type>" keyword value.
/// Used by aura SBA to verify the enchant restriction is still met.
///
/// Example: `enchant_type_matches_card("creature", card)` → true if card is a creature
pub fn enchant_type_matches_card(
    enchant_type: &str,
    card: &crate::card::CardInstance,
    aura_source: Option<&crate::card::CardInstance>,
) -> bool {
    let normalized = normalize_enchant_type(enchant_type).trim();
    match normalized.to_lowercase().as_str() {
        "creature" => card.zone == ZoneType::Battlefield && card.is_creature(),
        "creature.inzonegraveyard" => card.zone == ZoneType::Graveyard && card.is_creature(),
        "land" => card.zone == ZoneType::Battlefield && card.is_land(),
        "artifact" => card.zone == ZoneType::Battlefield && card.type_line.is_artifact(),
        "enchantment" => card.zone == ZoneType::Battlefield && card.type_line.is_enchantment(),
        "planeswalker" => card.zone == ZoneType::Battlefield && card.type_line.is_planeswalker(),
        "permanent" | "" => card.zone == ZoneType::Battlefield,
        _ => {
            // Compound filters like "Creature.Legendary" or
            // "Creature.IsRemembered" — defer to the full valid-card matcher
            // using the aura as source so qualifiers that consult source
            // state (Remembered, YouCtrl, …) resolve correctly. Without an
            // aura source, fall back to using the host as its own source,
            // which is correct for source-independent filters like
            // "Creature.Legendary".
            if card.zone != ZoneType::Battlefield {
                return false;
            }
            let source = aura_source.unwrap_or(card);
            crate::card::valid_filter::matches_valid_card(normalized, card, source)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_basic_pipe_params() {
        let params = Params::from_raw("Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield");
        assert_eq!(params.get("Mode"), Some("ChangesZone"));
        assert_eq!(params.get("Origin"), Some("Any"));
        assert_eq!(params.get("Destination"), Some("Battlefield"));
    }

    #[test]
    fn parse_bare_dollar_no_space() {
        // This was a bug in the duplicated parsers — they only handled "$ "
        let params = Params::from_raw("Key$Value | Other$ Spaced");
        assert_eq!(params.get("Key"), Some("Value"));
        assert_eq!(params.get("Other"), Some("Spaced"));
    }

    #[test]
    fn is_true_case_insensitive() {
        let params = Params::from_raw("Hidden$ True | Mandatory$ true | Other$ false");
        assert!(params.is_true("Hidden"));
        assert!(params.is_true("Mandatory"));
        assert!(!params.is_true("Other"));
        assert!(!params.is_true("Missing"));
    }

    #[test]
    fn numeric_accessors() {
        let params = Params::from_raw("Amount$ 3 | Bad$ notanumber");
        assert_eq!(params.as_i32("Amount"), Some(3));
        assert_eq!(params.as_usize("Amount"), Some(3));
        assert_eq!(params.as_i32("Bad"), None);
        assert_eq!(params.as_i32("Missing"), None);
    }

    #[test]
    fn get_or_default_works() {
        let params = Params::from_raw("Mode$ Continuous");
        assert_eq!(params.get_or_default("Mode", "None"), "Continuous");
        assert_eq!(params.get_or_default("Missing", "fallback"), "fallback");
    }

    #[test]
    fn serde_roundtrip() {
        let params = Params::from_raw("Mode$ Test | Amount$ 5");
        let json = serde_json::to_string(&params).unwrap();
        let deserialized: Params = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.get("Mode"), Some("Test"));
        assert_eq!(deserialized.get("Amount"), Some("5"));
    }
}
