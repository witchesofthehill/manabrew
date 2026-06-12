use std::collections::VecDeque;

use forge_foundation::ZoneType;
use serde::{Deserialize, Serialize};

use crate::card::card_damage_map::CardDamageMap;
use crate::card::card_zone_table::CardZoneTable;
use crate::card::Card;
use crate::ids::{CardId, PlayerId};
use crate::phase::ExtraTurn;
use crate::phase::TurnState;
use crate::player::PlayerState;
use crate::spellability::MagicStack;
use crate::zone::{CostPaymentStack, Zone, ZoneKey, ZoneStore};

/// Global registry of type lists loaded from `TypeLists.txt`.
///
/// Mirrors Java's `CardType.Constant.CREATURE_TYPES` etc., populated once by
/// `FModel.loadDynamicGamedata()` → `CardType.Helper.parseTypes()`.
///
/// Call [`TypeRegistry::load`] once at startup with the contents of
/// `TypeLists.txt`. All subsequent calls to [`TypeRegistry::creature_types`]
/// return the loaded data without any per-game copying.
pub struct TypeRegistry;

static CREATURE_TYPES: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();

impl TypeRegistry {
    /// Load creature types from the raw contents of `TypeLists.txt`.
    ///
    /// Parses the `[CreatureTypes]` section. Each line is either `TypeName` or
    /// `TypeName:PluralName`; only the singular (left of `:`) is kept.
    ///
    /// Mirrors Java's `FileSection.parseSections()` + `CardType.Helper.parseTypes()`.
    ///
    /// This must be called once before any game starts. Subsequent calls are
    /// silently ignored (first write wins).
    pub fn load(type_lists_content: &str) {
        let _ = CREATURE_TYPES.set(Self::parse_creature_types(type_lists_content));
    }

    /// Return the loaded creature types.
    ///
    /// # Panics
    /// Panics if [`TypeRegistry::load`] has not been called.
    pub fn creature_types() -> &'static [String] {
        CREATURE_TYPES.get().expect(
            "TypeRegistry: creature types not loaded. \
             Call TypeRegistry::load() with the contents of TypeLists.txt before starting a game.",
        )
    }

    /// Return whether `creature_type` is a known creature subtype.
    ///
    /// Unlike [`TypeRegistry::creature_types`], this is safe to call in unit
    /// tests that haven't loaded type data yet; it simply returns `false`.
    pub fn is_creature_type(creature_type: &str) -> bool {
        CREATURE_TYPES.get().is_some_and(|types| {
            types
                .iter()
                .any(|ty| ty.eq_ignore_ascii_case(creature_type))
        })
    }

    fn parse_creature_types(content: &str) -> Vec<String> {
        let mut in_creature_section = false;
        let mut types = Vec::new();
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if line.starts_with('[') && line.ends_with(']') {
                in_creature_section = &line[1..line.len() - 1] == "CreatureTypes";
                continue;
            }
            if in_creature_section {
                // "TypeName" or "TypeName:PluralName" — keep singular only
                let singular = line.split(':').next().unwrap_or(line);
                if !singular.is_empty() {
                    types.push(singular.to_string());
                }
            }
        }
        types
    }
}

/// The complete, serializable game state.
/// All game entities live here — nothing holds references, everything uses IDs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameState {
    // Arenas
    pub cards: Vec<Card>,
    pub players: Vec<PlayerState>,

    // Zones: keyed by (ZoneType, PlayerId)
    #[serde(skip)]
    zones: ZoneStore,

    // The stack
    pub stack: MagicStack,

    /// Cost payment tracking stack — used by triggers to inspect cost payments.
    /// Mirrors Java's `Game.costPaymentStack`.
    #[serde(skip)]
    pub cost_payment_stack: CostPaymentStack,

    // Day/Night cycle (Innistrad DFC mechanic)
    pub is_night: bool,
    pub day_night_started: bool,

    // Turn/phase state
    pub turn: TurnState,

    // Player order (for turn sequence)
    pub player_order: Vec<PlayerId>,

    // Game over flag
    pub game_over: bool,
    pub winner: Option<PlayerId>,

    // Extra turns queue — players who get extra turns (issue #22, AddTurn effect).
    // After cleanup, the game pops from here instead of advancing to the next player.
    #[serde(skip)]
    pub extra_turns: VecDeque<ExtraTurn>,

    // Fog — prevent all combat damage this turn (issue #22, Fog effect).
    // Reset at end of turn cleanup.
    pub prevent_all_combat_damage: bool,

    // Monarch designation (issue #22, BecomeMonarch effect).
    pub monarch: Option<PlayerId>,

    // Initiative holder (issue #22, TakeInitiative effect).
    pub initiative_holder: Option<PlayerId>,

    // End turn requested — skip remaining phases, jump to cleanup (issue #22, EndTurn effect).
    pub end_turn_requested: bool,

    // End combat requested — skip remaining combat steps (issue #22, EndCombatPhase effect).
    pub end_combat_requested: bool,

    // Extra combat phases to insert after current combat (issue #22, AddPhase effect).
    pub extra_combat_phases: u32,

    // Next card ID counter
    next_card_id: u32,

    /// Monotonically increasing counter for zone-entry timestamps.
    /// Each time a card enters a zone, it gets the next value.
    /// Used to order same-player triggers by zone entry order,
    /// matching Java's `Zone.cardList` insertion order.
    next_zone_timestamp: u64,
    /// Monotonically increasing effect timestamp used by continuous/perpetual
    /// effect records (Java parity: `game.getNextTimestamp()`).
    next_effect_timestamp: i64,
    /// Shared damage aggregation map for Java-style `DamageMap` flows.
    /// Used across sub-ability chains and consumed by `DamageResolve`.
    #[serde(skip)]
    pub pending_damage_map: Option<CardDamageMap>,
    /// Shared prevention map paired with `pending_damage_map`.
    #[serde(skip)]
    pub pending_prevent_map: Option<CardDamageMap>,
    /// Shared zone-change aggregation table for Java-style `ChangeZoneTable` flows.
    /// Used across sub-ability chains and consumed by `ChangeZoneResolve`.
    #[serde(skip)]
    pub pending_change_zone_table: Option<CardZoneTable>,

    /// Token scripts that have already consumed game-RNG for art selection.
    /// Java's `TokenDb` caches prototypes globally, consuming RNG only on
    /// first creation. Subsequent creations of the same token type reuse the
    /// cached prototype without RNG. This set mirrors that behavior.
    #[serde(skip)]
    pub synced_token_scripts: std::collections::BTreeSet<String>,

    /// Periodic LKI snapshot of battlefield cards.
    /// Mirrors Java's `Game.lastStateBattlefield`.
    /// Updated by `copy_last_state()` at key game checkpoints.
    #[serde(skip)]
    pub last_state_battlefield: Vec<crate::lki::CardSnapshot>,

    /// Snapshot of cards on the battlefield at the start of the current SBA check.
    /// Used by `DisableTriggers` (Hushbringer) to check LKI — a creature that dies
    /// in the same batch as another creature still suppresses the other's death trigger.
    /// Mirrors Java's `LastStateBattlefield` passed through `RunParams`.
    /// Set at the start of `check_state_based_actions_with_triggers`, cleared after.
    #[serde(skip)]
    pub pre_sba_battlefield: Vec<CardId>,

    /// Last card sacrificed as a cost (for `Sacrificed$CardPower` SVar resolution).
    /// Mirrors Java's `sa.getPaidList("SacrificedCards")`.
    #[serde(skip)]
    pub last_sacrificed_card: Option<CardId>,
}

impl GameState {
    pub fn new(player_names: &[&str], starting_life: i32) -> Self {
        let mut players = Vec::new();
        let mut player_order = Vec::new();

        for (i, name) in player_names.iter().enumerate() {
            let pid = PlayerId(i as u32);
            players.push(PlayerState::new(pid, name.to_string(), starting_life));
            player_order.push(pid);
        }

        let zones = ZoneStore::new(&player_order);

        GameState {
            cards: Vec::new(),
            players,
            zones,
            stack: MagicStack::new(),
            cost_payment_stack: CostPaymentStack::new(),
            is_night: false,
            day_night_started: false,
            turn: TurnState::new(player_order[0], player_order.len() as u32),
            player_order,
            game_over: false,
            winner: None,
            extra_turns: VecDeque::new(),
            prevent_all_combat_damage: false,
            monarch: None,
            initiative_holder: None,
            end_turn_requested: false,
            end_combat_requested: false,
            extra_combat_phases: 0,
            next_card_id: 0,
            next_zone_timestamp: 0,
            next_effect_timestamp: 1,
            pending_damage_map: None,
            pending_prevent_map: None,
            pending_change_zone_table: None,
            synced_token_scripts: std::collections::BTreeSet::new(),
            last_state_battlefield: Vec::new(),
            pre_sba_battlefield: Vec::new(),
            last_sacrificed_card: None,
        }
    }

    /// Create a new card instance and return its ID. Does NOT place it in a zone.
    pub fn create_card(&mut self, mut card: Card) -> CardId {
        let id = CardId(self.next_card_id);
        self.next_card_id += 1;
        card.id = id;
        let bound_host = card.clone();
        for trigger in &mut card.triggers {
            trigger.bind_host_card_id(bound_host.id);
        }
        for static_ability in &mut card.static_abilities {
            static_ability.base.set_host_card_id(bound_host.id);
        }
        for replacement_effect in &mut card.replacement_effects {
            replacement_effect.base.set_host_card_id(bound_host.id);
        }
        self.cards.push(card);
        id
    }

    // --- Accessors ---

    pub fn card(&self, id: CardId) -> &Card {
        &self.cards[id.index()]
    }

    pub fn card_mut(&mut self, id: CardId) -> &mut Card {
        &mut self.cards[id.index()]
    }

    pub fn player(&self, id: PlayerId) -> &PlayerState {
        &self.players[id.index()]
    }

    pub fn player_mut(&mut self, id: PlayerId) -> &mut PlayerState {
        &mut self.players[id.index()]
    }

    pub fn zone(&self, zone_type: ZoneType, owner: PlayerId) -> &Zone {
        self.zones.get(zone_type, owner).expect("Zone not found")
    }

    pub fn zone_mut(&mut self, zone_type: ZoneType, owner: PlayerId) -> &mut Zone {
        self.zones
            .get_mut(zone_type, owner)
            .expect("Zone not found")
    }

    pub fn zone_store_snapshot(&self) -> ZoneStore {
        self.zones.clone()
    }

    pub fn replace_zone_store(&mut self, zones: ZoneStore) {
        self.zones = zones;
    }

    pub fn iter_zones(&self) -> impl Iterator<Item = (ZoneKey, &Zone)> {
        self.zones.iter()
    }

    pub fn cards_in_all_zones(&self, zone_type: ZoneType) -> impl Iterator<Item = CardId> + '_ {
        self.iter_zones()
            .filter(move |(key, _)| key.zone_type == zone_type)
            .flat_map(|(_, zone)| zone.cards.iter().copied())
    }

    pub fn card_zone_location(&self, card: CardId) -> Option<ZoneKey> {
        self.zones.card_location(card)
    }

    pub fn card_zone(&self, card: CardId) -> Option<ZoneType> {
        self.card_zone_location(card)
            .map(|location| location.zone_type)
    }

    pub fn card_current_zone(&self, card: CardId) -> ZoneType {
        self.card_zone(card).unwrap_or_else(|| self.card(card).zone)
    }

    pub fn card_is_in_zone(&self, card: CardId, zone: ZoneType) -> bool {
        self.card_current_zone(card) == zone
    }

    pub fn card_zone_owner(&self, card: CardId) -> Option<PlayerId> {
        self.card_zone_location(card).map(|location| location.owner)
    }

    pub fn card_zone_location_matches_card(&self, card: CardId) -> bool {
        let card_ref = self.card(card);
        match self.card_zone_location(card) {
            Some(location) => {
                location.zone_type == card_ref.zone && location.owner == card_ref.controller
            }
            None => card_ref.zone == ZoneType::None,
        }
    }

    pub fn reset_zone_turn_tracking(&mut self) {
        for zone in self.zones.values_mut() {
            zone.reset_cards_added_this_turn();
        }
    }

    pub fn reset_card_turn_tracking(&mut self) {
        for card in &mut self.cards {
            card.reset_activations_per_turn();
            card.reset_ability_resolved_this_turn();
        }
    }

    pub(crate) fn remove_card_from_zone(
        &mut self,
        zone_type: ZoneType,
        owner: PlayerId,
        card: CardId,
    ) -> bool {
        if std::env::var("FORGE_ZONE_TRACE").is_ok()
            && self.cards[card.index()].card_name == "Mind Stone"
        {
            eprintln!(
                "[zone-rust] T{} remove {:?} {} from {:?} owner={:?}",
                self.turn.turn_number,
                card,
                self.cards[card.index()].card_name,
                zone_type,
                owner
            );
        }
        self.zones.remove_card(zone_type, owner, card)
    }

    pub(crate) fn add_card_to_zone(&mut self, zone_type: ZoneType, owner: PlayerId, card: CardId) {
        if std::env::var("FORGE_ZONE_TRACE").is_ok()
            && self.cards[card.index()].card_name == "Mind Stone"
        {
            eprintln!(
                "[zone-rust] T{} add {:?} {} -> {:?} owner={:?}",
                self.turn.turn_number,
                card,
                self.cards[card.index()].card_name,
                zone_type,
                owner
            );
        }
        self.zones.add_card_to_top(zone_type, owner, card);
    }

    pub(crate) fn add_card_to_zone_bottom(
        &mut self,
        zone_type: ZoneType,
        owner: PlayerId,
        card: CardId,
    ) {
        self.zones.add_card_to_bottom(zone_type, owner, card);
    }

    pub fn take_top_card_from_zone(
        &mut self,
        zone_type: ZoneType,
        owner: PlayerId,
    ) -> Option<CardId> {
        self.zones.take_top_card(zone_type, owner)
    }

    pub fn take_top_cards_from_zone(
        &mut self,
        zone_type: ZoneType,
        owner: PlayerId,
        count: usize,
    ) -> Vec<CardId> {
        let mut cards = Vec::with_capacity(count);
        for _ in 0..count {
            let Some(card) = self.take_top_card_from_zone(zone_type, owner) else {
                break;
            };
            cards.push(card);
        }
        cards.reverse();
        cards
    }

    pub fn reorder_card_in_zone(
        &mut self,
        zone_type: ZoneType,
        owner: PlayerId,
        card: CardId,
        index: usize,
    ) {
        self.zones.reorder_card(zone_type, owner, card, index);
    }

    pub fn move_cards_to_zone_top(
        &mut self,
        zone_type: ZoneType,
        owner: PlayerId,
        cards: &[CardId],
    ) {
        self.zones.move_cards_to_top(zone_type, owner, cards);
    }

    pub fn move_cards_to_zone_bottom(
        &mut self,
        zone_type: ZoneType,
        owner: PlayerId,
        cards: &[CardId],
    ) {
        self.zones.move_cards_to_bottom(zone_type, owner, cards);
    }

    pub fn replace_zone_cards(&mut self, zone_type: ZoneType, owner: PlayerId, cards: Vec<CardId>) {
        self.zones.replace_cards(zone_type, owner, cards);
    }

    pub fn shuffle_zone_cards(
        &mut self,
        zone_type: ZoneType,
        owner: PlayerId,
        rng: &mut dyn crate::game_rng::GameRng,
    ) {
        self.zones.shuffle_cards(zone_type, owner, rng);
    }

    pub fn shuffle_zone_cards_with_rand<R: rand::Rng + ?Sized>(
        &mut self,
        zone_type: ZoneType,
        owner: PlayerId,
        rng: &mut R,
    ) {
        self.zones.shuffle_cards_with_rand(zone_type, owner, rng);
    }

    pub(crate) fn save_zone_lki(
        &mut self,
        zone_type: ZoneType,
        owner: PlayerId,
        card: CardId,
        from: ZoneType,
    ) {
        self.zones.save_lki(zone_type, owner, card, from);
    }

    pub fn active_player(&self) -> PlayerId {
        self.turn.active_player
    }

    pub fn is_day(&self) -> bool {
        self.day_night_started && !self.is_night
    }

    pub fn is_neither_day_nor_night(&self) -> bool {
        !self.day_night_started
    }

    pub fn next_player(&self, player: PlayerId) -> PlayerId {
        let current_idx = self
            .player_order
            .iter()
            .position(|&p| p == player)
            .unwrap_or(0);
        for i in 1..self.player_order.len() {
            let next_idx = (current_idx + i) % self.player_order.len();
            let next_pid = self.player_order[next_idx];
            if self.player(next_pid).is_alive() {
                return next_pid;
            }
        }
        player
    }

    /// Return the turn number of `player`'s most recent combat phase, if
    /// known. Used by `Charm$ ChoiceRestriction$ YourLastCombat`.
    ///
    /// The Rust engine doesn't yet persist last-combat timestamps per player,
    /// so this is a best-effort: it returns the current turn number iff that
    /// turn's active player is `player` and we're past the combat phase.
    /// Cards that rely on cross-turn last-combat tracking will treat the
    /// restriction as always satisfied (safer than never).
    pub fn last_combat_turn_of(&self, player: PlayerId) -> Option<i32> {
        if self.turn.active_player == player {
            Some(self.turn.turn_number as i32)
        } else {
            None
        }
    }

    pub fn opponent_of(&self, player: PlayerId) -> PlayerId {
        for &pid in &self.player_order {
            if pid != player && self.player(pid).is_alive() {
                return pid;
            }
        }
        player // no opponent found (shouldn't happen in normal games)
    }

    pub fn alive_players(&self) -> Vec<PlayerId> {
        self.player_order
            .iter()
            .filter(|&&pid| self.player(pid).is_alive())
            .copied()
            .collect()
    }

    /// Get all cards in a specific zone for a player.
    pub fn cards_in_zone(&self, zone_type: ZoneType, owner: PlayerId) -> &[CardId] {
        &self.zone(zone_type, owner).cards
    }

    /// Get all creatures on the battlefield for a player.
    pub fn creatures_on_battlefield(&self, player: PlayerId) -> Vec<CardId> {
        self.cards_in_zone(ZoneType::Battlefield, player)
            .iter()
            .filter(|&&cid| self.card(cid).is_creature())
            .copied()
            .collect()
    }

    /// Assign the next zone timestamp to a card, returning the value.
    /// Called whenever a card enters a new zone to track insertion order.
    pub fn assign_zone_timestamp(&mut self, card_id: CardId) -> u64 {
        let ts = self.next_zone_timestamp;
        self.next_zone_timestamp += 1;
        self.cards[card_id.index()].zone_timestamp = ts;
        ts
    }

    /// Return the next monotonic effect timestamp.
    pub fn next_effect_timestamp(&mut self) -> i64 {
        let ts = self.next_effect_timestamp;
        self.next_effect_timestamp = self.next_effect_timestamp.saturating_add(1);
        ts
    }

    /// Ensure shared damage/prevent maps exist for this resolution scope.
    pub fn ensure_pending_damage_maps(&mut self) {
        if self.pending_damage_map.is_none() {
            self.pending_damage_map = Some(CardDamageMap::default());
        }
        if self.pending_prevent_map.is_none() {
            self.pending_prevent_map = Some(CardDamageMap::default());
        }
    }

    /// Clear shared damage/prevent maps.
    pub fn clear_pending_damage_maps(&mut self) {
        self.pending_damage_map = None;
        self.pending_prevent_map = None;
    }

    /// Ensure a shared zone-change table exists for this resolution scope.
    pub fn ensure_pending_change_zone_table(&mut self) {
        if self.pending_change_zone_table.is_none() {
            self.pending_change_zone_table = Some(CardZoneTable::default());
        }
    }

    /// Clear the shared zone-change table.
    pub fn clear_pending_change_zone_table(&mut self) {
        self.pending_change_zone_table = None;
    }

    /// Get all lands on the battlefield for a player.
    pub fn lands_on_battlefield(&self, player: PlayerId) -> Vec<CardId> {
        self.cards_in_zone(ZoneType::Battlefield, player)
            .iter()
            .filter(|&&cid| self.card(cid).is_land())
            .copied()
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use forge_foundation::{CardTypeLine, ColorSet, ManaCost};

    #[test]
    fn create_game() {
        let game = GameState::new(&["Alice", "Bob"], 20);
        assert_eq!(game.players.len(), 2);
        assert_eq!(game.player(PlayerId(0)).name, "Alice");
        assert_eq!(game.player(PlayerId(1)).name, "Bob");
        assert_eq!(game.player(PlayerId(0)).life, 20);
        assert!(game.zone(ZoneType::Sideboard, PlayerId(0)).is_empty());
        assert!(game.zone(ZoneType::AttractionDeck, PlayerId(0)).is_empty());
        assert!(game.zone(ZoneType::ContraptionDeck, PlayerId(0)).is_empty());
    }

    #[test]
    fn create_card_and_zone() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let card = Card::new(
            CardId(0),
            "Grizzly Bears".to_string(),
            PlayerId(0),
            CardTypeLine::parse("Creature Bear"),
            ManaCost::parse("1 G"),
            ColorSet::GREEN,
            Some(2),
            Some(2),
            vec![],
            vec![],
        );
        let cid = game.create_card(card);
        game.add_card_to_zone(ZoneType::Library, PlayerId(0), cid);
        game.card_mut(cid).zone = ZoneType::Library;
        assert_eq!(game.zone(ZoneType::Library, PlayerId(0)).len(), 1);
        assert_eq!(game.card_zone(cid), Some(ZoneType::Library));
    }

    #[test]
    fn opponent_lookup() {
        let game = GameState::new(&["Alice", "Bob"], 20);
        assert_eq!(game.opponent_of(PlayerId(0)), PlayerId(1));
        assert_eq!(game.opponent_of(PlayerId(1)), PlayerId(0));
    }

    #[test]
    fn lki_snapshot_captures_battlefield_state() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);

        // Create a 3/3 creature on the battlefield
        let mut card = Card::new(
            CardId(0),
            "Grizzly Bears".to_string(),
            PlayerId(0),
            CardTypeLine::parse("Creature Bear"),
            ManaCost::parse("1 G"),
            ColorSet::GREEN,
            Some(3),
            Some(3),
            vec![],
            vec![],
        );
        card.zone = ZoneType::Battlefield;
        let cid = game.create_card(card);

        // Take LKI snapshot
        game.copy_last_state();

        // Verify snapshot captured the correct power/toughness
        let snapshot = game.get_lki_snapshot(cid).expect("snapshot should exist");
        assert_eq!(snapshot.power, 3);
        assert_eq!(snapshot.toughness, 3);
        assert_eq!(snapshot.card_name, "Grizzly Bears");

        // Move card to graveyard and verify snapshot still exists
        game.card_mut(cid).zone = ZoneType::Graveyard;
        let snapshot = game
            .get_lki_snapshot(cid)
            .expect("snapshot should still exist");
        assert_eq!(snapshot.power, 3);

        // Snapshot preserves stale entries for LKI (cards that left the battlefield).
        // This matches Java's behavior where LKI persists through resolution chains.
        game.copy_last_state();
        assert!(
            game.get_lki_snapshot(cid).is_some(),
            "stale LKI should persist"
        );
    }
}
