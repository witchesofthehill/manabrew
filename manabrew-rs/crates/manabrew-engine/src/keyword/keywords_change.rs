//! Tracks keyword additions and removals.
//!
//! Ported from Java's `KeywordsChange.java` in `forge/game/keyword/`.

use super::keyword_collection::KeywordCollection;
use super::keyword_instance::KeywordInstanceData;
use super::trait_keywords_change::KeywordsChange as IKeywordsChange;

/// Tracks a set of keyword changes (additions and removals).
/// Mirrors Java's `KeywordsChange` class.
#[derive(Debug, Clone, Default)]
pub struct KeywordsChange {
    /// Keywords to add.
    pub keywords: KeywordCollection,
    /// Keywords to remove by original string.
    pub remove_keywords: Vec<String>,
    /// Keywords to remove by instance.
    pub remove_keyword_instances: Vec<KeywordInstanceData>,
    /// Whether to remove all existing keywords.
    pub remove_all_keywords: bool,
}

impl KeywordsChange {
    /// Create a new keywords change.
    pub fn new(
        keyword_list: Option<Vec<KeywordInstanceData>>,
        remove_keyword_list: Option<Vec<String>>,
        remove_all: bool,
    ) -> Self {
        let mut keywords = KeywordCollection::new();
        if let Some(list) = keyword_list {
            for inst in list {
                keywords.insert(inst);
            }
        }

        let remove_keywords = remove_keyword_list.unwrap_or_default();

        Self {
            keywords,
            remove_keywords,
            remove_keyword_instances: Vec::new(),
            remove_all_keywords: remove_all,
        }
    }

    /// Get the keywords to add.
    pub fn get_keywords(&self) -> Vec<&KeywordInstanceData> {
        self.keywords.get_values()
    }

    /// Get the keywords to remove by string.
    pub fn get_remove_keywords(&self) -> &[String] {
        &self.remove_keywords
    }

    /// Whether to remove all keywords.
    pub fn is_remove_all_keywords(&self) -> bool {
        self.remove_all_keywords
    }

    /// Whether this change has no effect.
    pub fn is_empty(&self) -> bool {
        !self.remove_all_keywords
            && self.keywords.is_empty()
            && self.remove_keywords.is_empty()
            && self.remove_keyword_instances.is_empty()
    }

    /// Create a deep copy of this keywords change.
    /// Mirrors Java's `KeywordsChange.copy(Card, boolean)`.
    pub fn copy(&self) -> Self {
        self.clone()
    }

    /// Apply spell abilities from all keywords in this change to a card.
    /// Mirrors Java's `KeywordsChange.applySpellAbility(List)`.
    pub fn apply_spell_ability(&self, card: &mut crate::card::Card) {
        for inst in self.keywords.get_values() {
            // Add the original keyword string as a spell ability reference
            // so the card knows about abilities granted by keywords.
            card.abilities.push(inst.original.clone());
        }
    }

    /// Apply triggers from all keywords in this change to a card.
    /// Mirrors Java's `KeywordsChange.applyTrigger(List)`.
    pub fn apply_trigger(&self, card: &mut crate::card::Card) {
        // Keyword-based triggers are applied when KeywordInstance trait objects
        // are created; this delegates to each keyword's trigger definitions.
        // At this level we ensure the keyword collection is synced.
        for inst in self.keywords.get_values() {
            // Parse trigger definitions embedded in keyword strings if present
            let kw_str = &inst.original;
            if kw_str.contains("Trigger") {
                let mut next_id = card.triggers.len() as u32;
                if let Some(trigger) = crate::trigger::trigger::parse_trigger(kw_str, &mut next_id)
                {
                    card.add_trigger(trigger);
                }
            }
        }
    }

    /// Apply replacement effects from all keywords in this change to a card.
    /// Mirrors Java's `KeywordsChange.applyReplacementEffect(List)`.
    pub fn apply_replacement_effect(&self, card: &mut crate::card::Card) {
        for inst in self.keywords.get_values() {
            let kw_str = &inst.original;
            if kw_str.contains("Replacement")
                || kw_str.starts_with("R$ ")
                || kw_str.starts_with("R:")
            {
                if let Some(repl) =
                    crate::replacement::replacement_effect::parse_replacement_effect(kw_str)
                {
                    card.add_replacement_effect(repl);
                }
            }
        }
    }

    /// Apply static abilities from all keywords in this change to a card.
    /// Mirrors Java's `KeywordsChange.applyStaticAbility(List)`.
    pub fn apply_static_ability(&self, card: &mut crate::card::Card) {
        for inst in self.keywords.get_values() {
            let kw_str = &inst.original;
            if kw_str.starts_with("S$ ") || kw_str.starts_with("S:") {
                if let Some(sa) = crate::staticability::static_ability::parse_static_ability(kw_str)
                {
                    card.static_abilities.push(sa);
                }
            }
        }
    }

    /// Apply all keyword changes (additions and removals) to a card's keyword collection.
    /// Mirrors Java's `KeywordsChange.applyKeywords(KeywordCollection)`.
    #[allow(dead_code)]
    pub fn apply_keywords(&self, card: &mut crate::card::Card) {
        if self.remove_all_keywords {
            card.keywords.clear();
        } else {
            let strs: Vec<&str> = self.remove_keywords.iter().map(|s| s.as_str()).collect();
            card.keywords.remove_strings(strs);
        }

        for inst in &self.remove_keyword_instances {
            card.keywords.remove(&inst.original);
        }

        for inst in self.keywords.get_values() {
            card.keywords.insert(inst.clone());
        }
    }

    /// Check if any keyword in this change has traits (triggers, abilities, etc.).
    /// Mirrors Java's `KeywordsChange.hasTraits()`.
    pub fn has_traits(&self) -> bool {
        // At the KeywordsChange level, keywords that carry traits are those
        // with complex definitions (containing separators like "|" or "T$ " etc).
        for inst in self.keywords.get_values() {
            let s = &inst.original;
            if s.contains("| ") || s.contains("T$ ") || s.contains("S$ ") || s.contains("R$ ") {
                return true;
            }
        }
        false
    }
}

impl IKeywordsChange for KeywordsChange {
    fn apply_keywords(&self, list: &mut KeywordCollection) {
        if self.remove_all_keywords {
            list.clear();
        } else {
            let strs: Vec<&str> = self.remove_keywords.iter().map(|s| s.as_str()).collect();
            list.remove_strings(strs);
        }

        // Remove specific instances
        for inst in &self.remove_keyword_instances {
            list.remove(&inst.original);
        }

        // Add new keywords
        for inst in self.keywords.get_values() {
            list.insert(inst.clone());
        }
    }

    fn copy(&self) -> Box<dyn IKeywordsChange> {
        Box::new(self.clone())
    }
}
