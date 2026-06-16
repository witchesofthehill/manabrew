use std::collections::HashMap;

use crate::game::GameState;
use crate::keyword::keyword_instance::Keyword;
use crate::spellability::alternative_cost::AlternativeCost;
use crate::spellability::SpellAbility;
use crate::trigger::trigger::Trigger;

/// Minimal wrapped ability shim for trigger parity.
/// Full Java parity (revalidation at resolve-time) will be implemented here.
#[derive(Debug, Clone)]
pub struct WrappedAbility {
    pub wrapped: SpellAbility,
    /// The trigger that created this wrapped ability.
    /// Used by `get_stack_description` and similar methods.
    pub trigger: Option<Trigger>,
    additional_ability_lists: HashMap<String, Vec<String>>,
}

impl WrappedAbility {
    pub fn new(wrapped: SpellAbility) -> Self {
        Self {
            wrapped,
            trigger: None,
            additional_ability_lists: HashMap::new(),
        }
    }

    pub fn with_trigger(wrapped: SpellAbility, trigger: Trigger) -> Self {
        Self {
            wrapped,
            trigger: Some(trigger),
            additional_ability_lists: HashMap::new(),
        }
    }

    pub fn has_param(&self, key: &str) -> bool {
        self.get_param(key).is_some() || self.wrapped.has_additional_ability(key)
    }

    pub fn add_cost_to_hash_list(&mut self, cost_key: &str, value: String) {
        self.wrapped
            .paid_hash
            .entry(cost_key.to_string())
            .or_default()
            .push(value);
    }

    pub fn reset_paid_hash(&mut self) {
        self.wrapped.paid_hash.clear();
    }

    pub fn has_triggering_object(&self, key: &str) -> bool {
        self.wrapped.has_triggering_object(key)
    }

    pub fn reset_triggering_objects(&mut self) {
        self.wrapped.trigger_objects.clear();
    }

    pub fn can_play(&self) -> bool {
        true
    }

    pub fn copy(&self) -> Self {
        self.clone()
    }

    pub fn yield_key(&self) -> String {
        if !self.wrapped.stack_description.is_empty() {
            self.wrapped.stack_description.clone()
        } else if !self.wrapped.description.is_empty() {
            self.wrapped.description.clone()
        } else {
            self.wrapped.ability_text.clone()
        }
    }

    pub fn to_unsuppressed_string(&self) -> String {
        self.yield_key()
    }

    pub fn has_s_var(&self, game: &GameState, key: &str) -> bool {
        self.wrapped
            .source
            .map(|cid| game.card(cid).svars.contains_key(key))
            .unwrap_or(false)
    }

    pub fn reset_once_resolved(&mut self) {
        // Placeholder for Java parity; Rust currently tracks resolve state elsewhere.
    }

    pub fn uses_targeting(&self) -> bool {
        self.wrapped.uses_targeting()
    }

    pub fn has_additional_ability(&self, key: &str) -> bool {
        self.wrapped.has_additional_ability(key)
            || self.additional_ability_lists.contains_key(key)
            || self.get_param(key).is_some()
    }

    pub fn reset_targets(&mut self) {
        self.wrapped.clear_targets();
    }

    pub fn resolve(&self) -> bool {
        true
    }

    // ── Delegating methods (Java WrappedAbility parity) ──────────────────

    /// Mirrors Java's `WrappedAbility.getParam(String)`.
    /// Delegates to `sa.getParam(key)`.
    pub fn get_param(&self, key: &str) -> Option<&str> {
        if self.wrapped.param_is_true(key) {
            Some("True")
        } else {
            self.wrapped.param_value(key)
        }
    }

    /// Mirrors Java's `WrappedAbility.getParamOrDefault(String, String)`.
    /// Delegates to `sa.getParamOrDefault(key, defaultValue)`.
    pub fn get_param_or_default<'a>(&'a self, key: &str, default: &'a str) -> &'a str {
        self.get_param(key).unwrap_or(default)
    }

    /// Mirrors Java's `WrappedAbility.setPaidHash(...)`.
    /// Replaces the paid hash wholesale.
    pub fn set_paid_hash(&mut self, hash: HashMap<String, Vec<String>>) {
        self.wrapped.paid_hash = hash;
    }

    /// Mirrors Java's `WrappedAbility.getPaidList(String, boolean)`.
    /// Returns the list of paid cost values for the given key.
    /// The `_intrinsic` flag is unused in Rust (Java uses it to pick column
    /// from a `TreeBasedTable`; Rust flattens into a single `Vec`).
    pub fn get_paid_list(&self, key: &str, _intrinsic: bool) -> Vec<String> {
        self.wrapped.paid_hash.get(key).cloned().unwrap_or_default()
    }

    /// Mirrors Java's `WrappedAbility.setTriggeringObjects(Map)`.
    /// Replaces all triggering objects wholesale.
    pub fn set_triggering_objects(&mut self, objects: HashMap<String, String>) {
        self.wrapped.trigger_objects.clear();
        for (key, value) in objects {
            self.wrapped.set_triggering_object(&key, value);
        }
    }

    /// Mirrors Java's `WrappedAbility.setTriggeringObject(AbilityKey, Object)`.
    /// Sets a single triggering object by key.
    pub fn set_triggering_object(&mut self, key: &str, value: String) {
        self.wrapped.set_triggering_object(key, value);
    }

    /// Mirrors Java's `WrappedAbility.getTriggeringObject(AbilityKey)`.
    /// Delegates to `sa.getTriggeringObject(key)`.
    pub fn get_triggering_object(&self, key: &str) -> Option<&str> {
        self.wrapped.get_triggering_object(key)
    }

    /// Mirrors Java's `WrappedAbility.getStackDescription(boolean)`.
    ///
    /// Simplified version: returns the trigger description (with ABILITY
    /// replacement) plus important stack objects, if a trigger is available.
    /// Falls back to the inner SpellAbility's stack_description.
    pub fn get_stack_description(&self, game: &GameState) -> String {
        if let Some(ref trigger) = self.trigger {
            let source = self.wrapped.source.unwrap_or(crate::ids::CardId(0));
            let player = self.wrapped.activating_player;
            let base = trigger.replace_ability_text(&trigger.description, game, source, player);
            let important = trigger
                .mode
                .get_important_stack_objects(trigger, &self.wrapped);
            let mut sb = base;
            if !important.is_empty() {
                sb.push_str(" [");
                sb.push_str(&important);
                sb.push(']');
            }
            sb
        } else if !self.wrapped.stack_description.is_empty() {
            self.wrapped.stack_description.clone()
        } else {
            self.wrapped.description.clone()
        }
    }

    /// Mirrors Java's `WrappedAbility.getSVar(String)`.
    /// Looks up an SVar on the source card.
    pub fn get_s_var(&self, game: &GameState, name: &str) -> Option<String> {
        self.wrapped
            .source
            .and_then(|cid| game.card(cid).get_s_var(name).map(str::to_string))
    }

    /// Mirrors Java's `WrappedAbility.getSVarInt(String)`.
    /// Returns the SVar parsed as an integer, or `None` if absent/unparseable.
    pub fn get_s_var_int(&self, game: &GameState, name: &str) -> Option<i32> {
        self.get_s_var(game, name)
            .and_then(|v| v.parse::<i32>().ok())
    }

    /// Mirrors Java's `WrappedAbility.setSVar(String, String)`.
    /// Sets an SVar on the source card.
    pub fn set_s_var(&self, game: &mut GameState, name: &str, value: &str) {
        if let Some(cid) = self.wrapped.source {
            game.card_mut(cid).set_s_var(name, value);
        }
    }

    /// Mirrors Java's `WrappedAbility.getAdditionalAbility(String)`.
    /// In Java this returns a SpellAbility parsed from the named param;
    /// in Rust we return the raw param value which callers can parse.
    pub fn get_additional_ability(&self, key: &str) -> Option<&str> {
        self.get_param(key)
    }

    /// Mirrors Java's `WrappedAbility.getAdditionalAbilityList(String)`.
    /// Returns the param value split by `&` (the Java list separator for
    /// additional ability lists in card scripts).
    pub fn get_additional_ability_list(&self, name: &str) -> Vec<String> {
        if let Some(list) = self.additional_ability_lists.get(name) {
            return list.clone();
        }
        self.get_param(name)
            .map(|v| v.split('&').map(|s| s.trim().to_string()).collect())
            .unwrap_or_default()
    }

    /// Mirrors Java's `WrappedAbility.setAdditionalAbilityList(String, List)`.
    /// Stores the list as an `&`-joined param value.
    pub fn set_additional_ability_list(&mut self, name: &str, list: Vec<String>) {
        self.additional_ability_lists.insert(name.to_string(), list);
    }

    /// Mirrors Java's `WrappedAbility.isAlternativeCost(AlternativeCost)`.
    /// Checks whether this ability was cast using the given alternative cost.
    pub fn is_alternative_cost(&self, ac: AlternativeCost) -> bool {
        self.wrapped.alt_cost == Some(ac)
    }

    /// Mirrors Java's `WrappedAbility.isKeyword(Keyword)`.
    /// Checks whether this ability's params contain a `Keyword$` entry
    /// matching the given keyword.
    pub fn is_keyword(&self, kw: Keyword) -> bool {
        self.wrapped
            .param_value("Keyword")
            .map(|v| {
                let kw_str = format!("{:?}", kw);
                v.eq_ignore_ascii_case(&kw_str)
            })
            .unwrap_or(false)
    }
}
