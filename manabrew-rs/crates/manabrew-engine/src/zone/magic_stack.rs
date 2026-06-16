//! MagicStack — the game stack for spells and abilities.
//!
//! Mirrors Java's `MagicStack.java` from `forge.game.zone`.
//! Spells and abilities are pushed onto the stack and resolve LIFO.

use forge_foundation::ZoneType;
use serde::{Deserialize, Serialize};

use crate::ids::{CardId, PlayerId};
use crate::spellability::SpellAbility;

// ── StackEntry (mirrors Java's SpellAbilityStackInstance) ────────────

/// An entry on the game stack (spell or ability waiting to resolve).
/// Mirrors Java's `SpellAbilityStackInstance` which wraps a `SpellAbility`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StackEntry {
    pub id: u32,
    /// The spell ability with its full sub-ability chain and targets.
    pub spell_ability: SpellAbility,
    /// True while a spell has been announced and moved to the stack, but its
    /// modes/targets/costs/payment have not finished yet. Pending entries are
    /// visible for casting prompts but must never resolve or receive priority.
    #[serde(default)]
    pub is_pending_cast: bool,
    /// Whether this is a creature spell (goes to battlefield on resolve).
    pub is_creature_spell: bool,
    /// Whether this is a non-creature permanent spell.
    pub is_permanent_spell: bool,
    /// The zone the spell was cast from (for Flashback exile-on-resolve).
    pub cast_from_zone: Option<ZoneType>,
    /// If this is an optional trigger, the player who decides whether to
    /// accept or decline.  Mirrors Java's WrappedAbility `decider` field.
    #[serde(default)]
    pub optional_trigger_decider: Option<PlayerId>,
    /// Description text shown to the deciding player for optional triggers.
    #[serde(default)]
    pub optional_trigger_description: Option<String>,
    /// Source card name for optional trigger prompts.
    #[serde(default)]
    pub optional_trigger_source_name: Option<String>,
}

impl StackEntry {
    /// Get the next unique ID for a stack entry.
    /// Mirrors Java's `SpellAbilityStackInstance.nextId()`.
    pub fn next_id() -> u64 {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(1);
        COUNTER.fetch_add(1, Ordering::Relaxed)
    }

    /// Update a target card in this stack entry's spell ability.
    /// Mirrors Java's `SpellAbilityStackInstance.updateTarget(Card, Card)`.
    pub fn update_target(&mut self, old: CardId, new: CardId) {
        self.spell_ability.update_target(old, new);
    }

    /// Set a triggering object on this stack entry's spell ability.
    /// Mirrors Java's `SpellAbilityStackInstance.setTriggeringObject(String, Object)`.
    pub fn set_triggering_object<K: crate::spellability::TriggerKeyInput>(
        &mut self,
        key: K,
        value: &str,
    ) {
        self.spell_ability.set_triggering_object(key, value);
    }

    /// Update a triggering object in this stack entry's spell ability.
    /// Mirrors Java's `SpellAbilityStackInstance.updateTriggeringObject(String, Object)`.
    pub fn update_triggering_object<K: crate::spellability::TriggerKeyInput>(
        &mut self,
        key: K,
        value: &str,
    ) {
        self.spell_ability.update_triggering_object(key, value);
    }
}

/// The game stack. Spells and abilities are added to the top and resolve LIFO.
/// Mirrors Java's `MagicStack` class.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MagicStack {
    entries: Vec<StackEntry>,
    next_id: u32,

    /// Whether the stack is frozen (during declare attackers/blockers).
    /// While frozen, new non-mana abilities are queued in `frozen_stack`.
    #[serde(default)]
    frozen: bool,

    /// Entries queued while the stack is frozen (combat declarations).
    #[serde(default)]
    frozen_stack: Vec<StackEntry>,

    /// Whether the stack is currently resolving an entry.
    #[serde(default)]
    resolving: bool,

    /// The card currently being resolved (if any).
    #[serde(default)]
    cur_resolving_card: Option<CardId>,

    /// Short-lived LKI cache of entries that were removed from the stack
    /// during the current resolution cycle (e.g. by Counter effects). Used
    /// by `find_by_id` so sub-abilities like An Offer You Can't Refuse's
    /// "its controller creates two Treasure tokens" can still look up the
    /// countered spell's controller after it's left the stack.
    #[serde(default, skip)]
    recently_removed: Vec<StackEntry>,

    /// Cards (by ID) of spells cast this turn — for storm count, etc.
    #[serde(default)]
    this_turn_cast: Vec<CardId>,

    /// Cards cast last turn (rotated from this_turn_cast on turn change).
    #[serde(default)]
    last_turn_cast: Vec<CardId>,

    /// Abilities activated this turn.
    #[serde(default)]
    this_turn_activated: Vec<CardId>,

    /// Maximum distinct sources that have been on the stack simultaneously.
    #[serde(default)]
    max_distinct_sources: usize,

    /// Undo stack — tracks undoable spell abilities and their owner.
    #[serde(default)]
    undo_stack: Vec<UndoEntry>,

    /// Player who owns the current undo stack.
    #[serde(default)]
    undo_stack_owner: Option<PlayerId>,

    /// Simultaneous stack entries waiting to be added (triggers that fire
    /// at the same time and need ordering by the active player).
    #[serde(default)]
    simultaneous_entries: Vec<StackEntry>,

    /// Cast commands keyed by card name — callbacks to run when a spell resolves.
    #[serde(default)]
    cast_commands: std::collections::HashMap<String, Vec<String>>,
}

/// An undo entry tracking a spell that can be undone.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UndoEntry {
    pub source_card: Option<CardId>,
    pub activating_player: PlayerId,
}

impl MagicStack {
    pub fn new() -> Self {
        MagicStack {
            entries: Vec::new(),
            next_id: 0,
            frozen: false,
            frozen_stack: Vec::new(),
            resolving: false,
            cur_resolving_card: None,
            this_turn_cast: Vec::new(),
            last_turn_cast: Vec::new(),
            this_turn_activated: Vec::new(),
            max_distinct_sources: 0,
            undo_stack: Vec::new(),
            undo_stack_owner: None,
            simultaneous_entries: Vec::new(),
            cast_commands: std::collections::HashMap::new(),
            recently_removed: Vec::new(),
        }
    }

    pub fn push(&mut self, mut entry: StackEntry) -> u32 {
        let id = self.next_id;
        self.next_id += 1;
        entry.is_pending_cast = false;
        entry.id = id;
        self.entries.push(entry);
        self.update_max_distinct_sources();
        id
    }

    pub fn begin_pending_cast(&mut self, mut entry: StackEntry) -> u32 {
        let id = self.next_id;
        self.next_id += 1;
        entry.id = id;
        entry.is_pending_cast = true;
        self.entries.push(entry);
        self.update_max_distinct_sources();
        id
    }

    pub fn complete_pending_cast(&mut self, id: u32, mut entry: StackEntry) -> Option<&StackEntry> {
        let pending = self
            .entries
            .iter_mut()
            .find(|existing| existing.id == id && existing.is_pending_cast)?;
        entry.id = id;
        entry.is_pending_cast = false;
        *pending = entry;
        self.update_max_distinct_sources();
        self.entries.iter().find(|existing| existing.id == id)
    }

    pub fn remove_pending_cast(&mut self, id: u32) -> Option<StackEntry> {
        let index = self
            .entries
            .iter()
            .position(|entry| entry.id == id && entry.is_pending_cast)?;
        let entry = self.entries.remove(index);
        self.update_max_distinct_sources();
        Some(entry)
    }

    fn update_max_distinct_sources(&mut self) {
        let distinct: std::collections::HashSet<_> = self
            .entries
            .iter()
            .filter_map(|e| e.spell_ability.source)
            .collect();
        if distinct.len() > self.max_distinct_sources {
            self.max_distinct_sources = distinct.len();
        }
    }

    pub fn pop(&mut self) -> Option<StackEntry> {
        self.entries.pop()
    }

    pub fn peek(&self) -> Option<&StackEntry> {
        self.entries.last()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn iter(&self) -> impl Iterator<Item = &StackEntry> {
        self.entries.iter()
    }

    pub fn iter_mut(&mut self) -> impl Iterator<Item = &mut StackEntry> {
        self.entries.iter_mut()
    }

    /// Find a stack entry by ID without removing it. Also searches the
    /// short-lived LKI cache populated by Counter effects so that follow-up
    /// sub-abilities can still resolve `Defined$ TargetedController` after
    /// the target spell has been pulled off the stack.
    pub fn find_by_id(&self, id: u32) -> Option<&StackEntry> {
        self.entries
            .iter()
            .find(|e| e.id == id)
            .or_else(|| self.recently_removed.iter().find(|e| e.id == id))
    }

    /// Remove and return the stack entry with the given ID (for Counter effects).
    /// The removed entry is kept in a short-lived LKI cache so follow-up
    /// sub-abilities can still observe its metadata (see `find_by_id`).
    pub fn remove_by_id(&mut self, id: u32) -> Option<StackEntry> {
        if let Some(pos) = self.entries.iter().position(|e| e.id == id) {
            let entry = self.entries.remove(pos);
            self.recently_removed.push(entry.clone());
            Some(entry)
        } else {
            None
        }
    }

    /// Clear the LKI cache of recently-removed entries. Called at the end of
    /// each stack-resolution cycle so the cache doesn't leak state.
    pub fn clear_recently_removed(&mut self) {
        self.recently_removed.clear();
    }

    /// Find a stack entry by its source card ID (for Ward — finding the targeting spell).
    pub fn find_by_source_card(&self, card_id: CardId) -> Option<&StackEntry> {
        self.entries
            .iter()
            .find(|e| e.spell_ability.source == Some(card_id))
    }

    /// Number of items on the stack. Mirrors Java's `MagicStack.size()`.
    pub fn size(&self) -> usize {
        self.entries.len()
    }

    /// Add a stack entry. Mirrors Java's `MagicStack.add()`.
    pub fn add(&mut self, entry: StackEntry) -> u32 {
        self.push(entry)
    }

    /// Remove a specific entry by ID. Mirrors Java's `MagicStack.remove()`.
    pub fn remove(&mut self, id: u32) -> Option<StackEntry> {
        self.remove_by_id(id)
    }

    /// Clear all entries from the stack. Mirrors Java's underlying `clear()`.
    pub fn clear(&mut self) {
        self.entries.clear();
    }

    /// Reset the stack completely. Mirrors Java's `MagicStack.reset()`.
    pub fn reset(&mut self) {
        self.entries.clear();
        self.next_id = 0;
        self.frozen = false;
        self.frozen_stack.clear();
        self.resolving = false;
        self.cur_resolving_card = None;
        self.last_turn_cast.clear();
        self.this_turn_cast.clear();
        self.simultaneous_entries.clear();
        self.undo_stack.clear();
        self.undo_stack_owner = None;
        self.cast_commands.clear();
    }

    /// Peek at the top ability. Mirrors Java's `MagicStack.peekAbility()`.
    pub fn peek_ability(&self) -> Option<&SpellAbility> {
        self.entries.last().map(|e| &e.spell_ability)
    }

    /// Check if any entry has the given source card.
    /// Mirrors Java's `MagicStack.hasSourceOnStack()`.
    pub fn has_source_on_stack(&self, card_id: CardId) -> bool {
        self.entries
            .iter()
            .any(|e| e.spell_ability.source == Some(card_id))
    }

    /// Check if the top entry has legal targeting (at least one target chosen).
    /// Mirrors Java's `MagicStack.hasLegalTargeting()`.
    pub fn has_legal_targeting(&self) -> bool {
        match self.entries.last() {
            Some(entry) => {
                let tc = &entry.spell_ability.target_chosen;
                // No targeting required = always legal
                if entry.spell_ability.target_restrictions.is_none() {
                    return true;
                }
                // Has at least one target chosen
                tc.target_card.is_some()
                    || tc.target_player.is_some()
                    || tc.target_stack_entry.is_some()
            }
            None => false,
        }
    }

    /// Remove all entries controlled by the given player.
    /// Mirrors Java's `MagicStack.removeInstancesControlledBy()`.
    pub fn remove_instances_controlled_by(&mut self, player: PlayerId) {
        self.entries
            .retain(|e| e.spell_ability.activating_player != player);
    }

    /// Forward iterator. Mirrors Java's `MagicStack.iterator()`.
    pub fn iterator(&self) -> impl Iterator<Item = &StackEntry> {
        self.entries.iter()
    }

    /// Reverse iterator (top to bottom). Mirrors Java's `MagicStack.reverseIterator()`.
    pub fn reverse_iterator(&self) -> impl Iterator<Item = &StackEntry> {
        self.entries.iter().rev()
    }

    // ── Frozen stack (for declare attackers/blockers) ────────────────

    /// Whether the stack is currently frozen.
    pub fn is_frozen(&self) -> bool {
        self.frozen
    }

    /// Freeze the stack. While frozen, new entries go to the frozen queue.
    /// Mirrors Java's `MagicStack.freezeStack()`.
    pub fn freeze_stack(&mut self) {
        self.frozen = true;
    }

    /// Add an entry and unfreeze, flushing any queued frozen entries.
    /// Mirrors Java's `MagicStack.addAndUnfreeze()`.
    pub fn add_and_unfreeze(&mut self, entry: StackEntry) -> u32 {
        let id = self.push(entry);
        self.unfreeze_stack();
        id
    }

    /// Unfreeze the stack and flush all frozen entries onto the real stack.
    /// Mirrors Java's `MagicStack.unfreezeStack()`.
    pub fn unfreeze_stack(&mut self) {
        self.frozen = false;
        // Move frozen entries onto the real stack
        let frozen = std::mem::take(&mut self.frozen_stack);
        for entry in frozen.into_iter().rev() {
            self.push(entry);
        }
    }

    /// Clear all frozen entries without processing them.
    /// Mirrors Java's `MagicStack.clearFrozen()`.
    pub fn clear_frozen(&mut self) {
        self.frozen = false;
        self.frozen_stack.clear();
    }

    // ── Resolution state ─────────────────────────────────────────────

    /// Whether the stack is currently resolving.
    pub fn is_resolving(&self) -> bool {
        self.resolving
    }

    pub fn set_resolving(&mut self, resolving: bool) {
        self.resolving = resolving;
    }

    pub fn set_cur_resolving_card(&mut self, card: Option<CardId>) {
        self.cur_resolving_card = card;
    }

    pub fn cur_resolving_card(&self) -> Option<CardId> {
        self.cur_resolving_card
    }

    // ── Undo stack ───────────────────────────────────────────────────

    /// Check if undo is available for the given player.
    /// Mirrors Java's `MagicStack.canUndo()`.
    pub fn can_undo(&self, player: PlayerId) -> bool {
        self.undo_stack_owner == Some(player) && !self.undo_stack.is_empty()
    }

    /// Undo the last undoable action. Returns true if successful.
    /// Mirrors Java's `MagicStack.undo()`.
    pub fn undo(&mut self) -> bool {
        if self.undo_stack.is_empty() {
            return false;
        }
        self.undo_stack.pop();
        if self.undo_stack.is_empty() {
            self.undo_stack_owner = None;
        }
        true
    }

    /// Clear the undo stack entirely.
    /// Mirrors Java's `MagicStack.clearUndoStack()`.
    pub fn clear_undo_stack(&mut self) {
        self.undo_stack.clear();
        self.undo_stack_owner = None;
    }

    /// Remove undo entries whose source matches the given card.
    /// Mirrors Java's `MagicStack.filterUndoStackByHost()`.
    pub fn filter_undo_stack_by_host(&mut self, card_id: CardId) {
        self.undo_stack.retain(|e| e.source_card != Some(card_id));
        if self.undo_stack.is_empty() {
            self.undo_stack_owner = None;
        }
    }

    /// Record an undoable action on the undo stack.
    pub fn record_undoable(&mut self, source: Option<CardId>, player: PlayerId) {
        self.undo_stack_owner = Some(player);
        self.undo_stack.push(UndoEntry {
            source_card: source,
            activating_player: player,
        });
    }

    // ── Simultaneous stack entries (triggers) ────────────────────────

    /// Check if there are simultaneous stack entries waiting to be added.
    /// Mirrors Java's `MagicStack.hasSimultaneousStackEntries()`.
    pub fn has_simultaneous_stack_entries(&self) -> bool {
        !self.simultaneous_entries.is_empty()
    }

    /// Clear all simultaneous stack entries.
    /// Mirrors Java's `MagicStack.clearSimultaneousStack()`.
    pub fn clear_simultaneous_stack(&mut self) {
        self.simultaneous_entries.clear();
    }

    /// Queue a simultaneous stack entry (trigger) for later addition.
    /// Mirrors Java's `MagicStack.addSimultaneousStackEntry()`.
    pub fn add_simultaneous_stack_entry(&mut self, entry: StackEntry) {
        self.simultaneous_entries.push(entry);
    }

    /// Move all queued simultaneous entries onto the real stack.
    /// Returns true if any were added.
    /// Mirrors Java's `MagicStack.addAllTriggeredAbilitiesToStack()`.
    pub fn add_all_triggered_abilities_to_stack(&mut self) -> bool {
        if self.simultaneous_entries.is_empty() {
            return false;
        }
        let entries = std::mem::take(&mut self.simultaneous_entries);
        for entry in entries {
            self.push(entry);
        }
        true
    }

    /// Check if there's a state trigger waiting in the simultaneous queue.
    /// Mirrors Java's `MagicStack.hasStateTrigger()`.
    pub fn has_state_trigger(&self) -> bool {
        self.simultaneous_entries
            .iter()
            .any(|e| e.spell_ability.is_trigger)
    }

    /// Check if a specific trigger id already exists in pending/active stack entries.
    /// Mirrors Java's `MagicStack.hasStateTrigger(triggerId)` behavior.
    pub fn has_state_trigger_id(&self, trigger_id: u32) -> bool {
        let matches = |e: &StackEntry| {
            e.spell_ability.is_trigger && e.spell_ability.source_trigger_id == Some(trigger_id)
        };
        self.entries.iter().any(matches)
            || self.frozen_stack.iter().any(matches)
            || self.simultaneous_entries.iter().any(matches)
    }

    // ── Cast commands ────────────────────────────────────────────────

    /// Register a command to run when a spell with the given key resolves.
    /// Mirrors Java's `MagicStack.addCastCommand()`.
    pub fn add_cast_command(&mut self, key: &str, command: String) {
        self.cast_commands
            .entry(key.to_string())
            .or_default()
            .push(command);
    }

    /// Take and return any cast commands registered for the given key.
    pub fn take_cast_commands(&mut self, key: &str) -> Vec<String> {
        self.cast_commands.remove(key).unwrap_or_default()
    }

    // ── Stack resolution ─────────────────────────────────────────────

    /// Pop the top entry and begin resolution.
    /// Sets `resolving` state and tracks the resolving card.
    /// The actual effect resolution is driven by `GameLoop::resolve_stack()`
    /// which calls this to get the entry, then resolves it with full game context.
    /// Mirrors Java's `MagicStack.resolveStack()`.
    pub fn resolve_stack(&mut self) -> Option<StackEntry> {
        if self
            .entries
            .last()
            .map(|entry| entry.is_pending_cast)
            .unwrap_or(false)
        {
            return None;
        }
        let entry = self.entries.pop()?;
        self.resolving = true;
        self.cur_resolving_card = entry.spell_ability.source;
        Some(entry)
    }

    /// Mark resolution as complete.
    pub fn finish_resolving(&mut self) {
        self.resolving = false;
        self.cur_resolving_card = None;
    }

    // ── Turn tracking ────────────────────────────────────────────────

    /// Called when a new turn begins. Rotates cast/activated tracking.
    /// Mirrors Java's `MagicStack.onNextTurn()`.
    pub fn on_next_turn(&mut self) {
        self.last_turn_cast = std::mem::take(&mut self.this_turn_cast);
        self.this_turn_activated.clear();
    }

    /// Record that a spell was cast this turn (for storm count, etc.).
    pub fn record_spell_cast(&mut self, card_id: CardId) {
        self.this_turn_cast.push(card_id);
    }

    /// Get the number of spells cast this turn (storm count).
    pub fn spells_cast_this_turn(&self) -> usize {
        self.this_turn_cast.len()
    }

    /// Get the list of spells cast this turn.
    pub fn get_spells_cast_this_turn(&self) -> &[CardId] {
        &self.this_turn_cast
    }

    /// Get the list of spells cast last turn.
    pub fn get_spells_cast_last_turn(&self) -> &[CardId] {
        &self.last_turn_cast
    }

    /// Track an ability activation this turn.
    /// Mirrors Java's `MagicStack.addAbilityActivatedThisTurn()`.
    pub fn add_ability_activated_this_turn(&mut self, sa: &SpellAbility) {
        if let Some(source) = sa.source {
            self.this_turn_activated.push(source);
        }
    }

    /// Reset max distinct sources counter.
    /// Mirrors Java's `MagicStack.resetMaxDistinctSources()`.
    pub fn reset_max_distinct_sources(&mut self) {
        self.max_distinct_sources = 0;
    }

    /// Get the max distinct sources seen on the stack this turn.
    pub fn get_max_distinct_sources(&self) -> usize {
        self.max_distinct_sources
    }

    /// Find a stack entry whose spell ability ID matches the given stack entry ID.
    /// Mirrors Java's `MagicStack.getInstanceMatchingSpellAbilityID()`.
    pub fn get_instance_matching_spell_ability_id(&self, id: u32) -> Option<&StackEntry> {
        self.entries.iter().find(|si| si.id == id)
    }

    /// Find a spell on the stack whose host card matches the given card.
    /// Returns the spell ability if found.
    /// Mirrors Java's `MagicStack.getSpellMatchingHost()`.
    pub fn get_spell_matching_host(&self, host: CardId) -> Option<&SpellAbility> {
        for si in &self.entries {
            if si.spell_ability.is_spell && si.spell_ability.source == Some(host) {
                return Some(&si.spell_ability);
            }
        }
        None
    }
}

impl Default for MagicStack {
    fn default() -> Self {
        Self::new()
    }
}
