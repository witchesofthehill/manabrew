//! Keyword interface data model.
//!
//! Ported as a concrete struct because current Rust callers store
//! `KeywordInterface` by value, unlike Java's interface-based hierarchy.

use std::collections::HashMap;

use crate::card::trait_card_trait_changes::CardTraitChanges;
use crate::core::HasSVars;
use crate::ids::CardId;
use crate::replacement::ReplacementEffect;
use crate::spellability::SpellAbility;
use crate::staticability::StaticAbility;
use crate::trigger::Trigger;

use super::keyword_instance::Keyword;

#[derive(Debug, Clone)]
pub struct KeywordInterface {
    original: String,
    keyword: Keyword,
    title: String,
    reminder_text: String,
    intrinsic: bool,
    idx: i64,
    amount: i32,
    svars: HashMap<String, String>,
    triggers: Vec<Trigger>,
    replacements: Vec<ReplacementEffect>,
    spell_abilities: Vec<SpellAbility>,
    static_abilities: Vec<StaticAbility>,
    static_ability: Option<StaticAbility>,
}

impl KeywordInterface {
    pub fn new(keyword: Keyword, original: impl Into<String>) -> Self {
        let original = original.into();
        Self {
            title: original.clone(),
            reminder_text: String::new(),
            original,
            keyword,
            intrinsic: false,
            idx: -1,
            amount: 1,
            svars: HashMap::new(),
            triggers: Vec::new(),
            replacements: Vec::new(),
            spell_abilities: Vec::new(),
            static_abilities: Vec::new(),
            static_ability: None,
        }
    }

    /// Get the original keyword string (e.g. "Flying", "Kicker:1 R").
    pub fn get_original(&self) -> &str {
        &self.original
    }

    /// Get the keyword enum variant.
    pub fn get_keyword(&self) -> Keyword {
        self.keyword
    }

    /// Get the display title for this keyword.
    pub fn get_title(&self) -> String {
        self.title.clone()
    }

    /// Get the reminder text for this keyword.
    pub fn get_reminder_text(&self) -> String {
        self.reminder_text.clone()
    }

    /// Get the numeric amount (default 1 for most keywords).
    pub fn get_amount(&self) -> i32 {
        self.amount
    }

    /// Get the amount as a string.
    pub fn get_amount_string(&self) -> String {
        self.amount.to_string()
    }

    /// Whether this keyword is intrinsic to the card.
    pub fn is_intrinsic(&self) -> bool {
        self.intrinsic
    }

    /// Set whether this keyword is intrinsic.
    pub fn set_intrinsic(&mut self, value: bool) {
        self.intrinsic = value;
    }

    /// Get the unique index for this keyword instance.
    pub fn get_idx(&self) -> i64 {
        self.idx
    }

    /// Set the unique index.
    pub fn set_idx(&mut self, i: i64) {
        self.idx = i;
    }

    pub fn set_title(&mut self, title: impl Into<String>) {
        self.title = title.into();
    }

    pub fn set_reminder_text(&mut self, reminder_text: impl Into<String>) {
        self.reminder_text = reminder_text.into();
    }

    pub fn set_amount(&mut self, amount: i32) {
        self.amount = amount;
    }

    pub fn get_static(&self) -> Option<&StaticAbility> {
        self.static_ability.as_ref()
    }

    pub fn set_static(&mut self, st: StaticAbility) {
        self.static_ability = Some(st);
    }

    pub fn has_traits(&self) -> bool {
        !self.triggers.is_empty()
            || !self.replacements.is_empty()
            || !self.spell_abilities.is_empty()
            || !self.static_abilities.is_empty()
            || self.static_ability.is_some()
    }

    pub fn add_trigger(&mut self, trg: Trigger) {
        self.triggers.push(trg);
    }

    pub fn add_replacement(&mut self, repl: ReplacementEffect) {
        self.replacements.push(repl);
    }

    pub fn add_spell_ability(&mut self, sa: SpellAbility) {
        self.spell_abilities.push(sa);
    }

    pub fn add_static_ability(&mut self, st: StaticAbility) {
        self.static_abilities.push(st);
    }

    pub fn get_triggers(&self) -> &[Trigger] {
        &self.triggers
    }

    pub fn get_replacements(&self) -> &[ReplacementEffect] {
        &self.replacements
    }

    pub fn get_abilities(&self) -> &[SpellAbility] {
        &self.spell_abilities
    }

    pub fn get_static_abilities(&self) -> &[StaticAbility] {
        &self.static_abilities
    }

    /// Whether this keyword instance is redundant given existing keywords.
    pub fn redundant(&self, _existing_keywords: &[KeywordInterface]) -> bool {
        false
    }
}

impl HasSVars for KeywordInterface {
    fn get_svar(&self, name: &str) -> Option<&str> {
        self.svars.get(name).map(String::as_str)
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

impl CardTraitChanges for KeywordInterface {
    fn apply_spell_ability(&self, mut list: Vec<SpellAbility>) -> Vec<SpellAbility> {
        list.extend(self.spell_abilities.iter().cloned());
        list
    }

    fn apply_trigger(&self, mut list: Vec<Trigger>) -> Vec<Trigger> {
        list.extend(self.triggers.iter().cloned());
        list
    }

    fn apply_replacement_effect(&self, mut list: Vec<ReplacementEffect>) -> Vec<ReplacementEffect> {
        list.extend(self.replacements.iter().cloned());
        list
    }

    fn apply_static_ability(&self, mut list: Vec<StaticAbility>) -> Vec<StaticAbility> {
        if let Some(st) = &self.static_ability {
            list.push(st.clone());
        }
        list.extend(self.static_abilities.iter().cloned());
        list
    }

    fn change_text(&mut self) {
        self.title = self.title.trim().to_string();
        self.reminder_text = self.reminder_text.trim().to_string();
    }

    fn copy(&self, _host: CardId, _lki: bool) -> Box<dyn CardTraitChanges> {
        Box::new(self.clone())
    }
}
