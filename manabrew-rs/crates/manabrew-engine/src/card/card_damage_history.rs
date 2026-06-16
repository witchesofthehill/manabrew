use crate::ids::{CardId, PlayerId};

/// Minimal game-entity discriminator for damage/attack tracking.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TrackedEntity {
    Player(PlayerId),
    Card(CardId),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DamageInstance {
    pub amount: i32,
    pub is_combat: bool,
    pub source: Option<CardId>,
    pub target: Option<TrackedEntity>,
}

/// Tracks damage-related history for a card across the game.
///
/// Mirrors Java Forge's `CardDamageHistory` class, which records per-combat
/// and per-turn damage events for use by triggered abilities and combat logic.
#[derive(Debug, Clone, Default)]
pub struct CardDamageHistory {
    /// Total number of times this creature has attacked across the entire game.
    pub attacks_this_game: i32,
    /// If this creature attacked this combat: 1 + number of other attackers, else 0.
    pub creature_attacked_this_combat: i32,
    /// Whether this creature blocked during the current combat.
    pub creature_blocked_this_combat: bool,
    /// Whether this creature was blocked during the current combat.
    pub creature_got_blocked_this_combat: bool,
    /// Defender entities this card attacked this turn.
    pub attacked_this_turn: Vec<TrackedEntity>,
    /// Whether this card attacked a battle this turn.
    pub attacked_battle_this_turn: bool,
    /// Players this card attacked on their previous turn.
    pub creature_attacked_last_turn_of: Vec<PlayerId>,
    /// Players this card has not attacked since their last upkeep.
    pub not_attacked_since_last_upkeep_of: Vec<PlayerId>,
    /// Players this card has not blocked since their last upkeep.
    pub not_blocked_since_last_upkeep_of: Vec<PlayerId>,
    /// Players this card has not been blocked by since their last upkeep.
    pub not_been_blocked_since_last_upkeep_of: Vec<PlayerId>,
    /// Damage dealt by this creature this turn.
    pub damage_done_this_turn: Vec<DamageInstance>,
}

impl CardDamageHistory {
    /// Record that this creature is attacking alongside `num_others` other attackers.
    pub fn record_attack(&mut self, num_others: i32) {
        self.attacks_this_game += 1;
        self.creature_attacked_this_combat = 1 + num_others;
    }

    /// Java parity: set attack info and optional defender tracking.
    pub fn set_creature_attacked_this_combat(
        &mut self,
        defender: Option<TrackedEntity>,
        num_other_attackers: i32,
        defender_is_battle: bool,
    ) {
        self.creature_attacked_this_combat = 1 + num_other_attackers;
        if let Some(d) = defender {
            self.attacks_this_game += 1;
            self.attacked_this_turn.push(d);
            if defender_is_battle {
                self.attacked_battle_this_turn = true;
            }
        }
    }

    /// Record that this creature is blocking.
    pub fn record_block(&mut self) {
        self.creature_blocked_this_combat = true;
    }

    /// Record that this creature (as an attacker) was blocked.
    pub fn record_got_blocked(&mut self) {
        self.creature_got_blocked_this_combat = true;
    }

    /// Record damage dealt by this creature.
    pub fn record_damage(&mut self, amount: i32, is_combat: bool) {
        self.damage_done_this_turn.push(DamageInstance {
            amount,
            is_combat,
            source: None,
            target: None,
        });
    }

    /// Java parity: register a full damage instance with LKI-like source/target ids.
    pub fn register_damage(
        &mut self,
        damage: i32,
        is_combat: bool,
        source_lki: Option<CardId>,
        target: TrackedEntity,
    ) {
        if damage <= 0 {
            return;
        }
        self.damage_done_this_turn.push(DamageInstance {
            amount: damage,
            is_combat,
            source: source_lki,
            target: Some(target),
        });
    }

    pub fn has_attacked_this_turn(&self, entity: TrackedEntity) -> bool {
        self.attacked_this_turn.contains(&entity)
    }

    pub fn has_attacked_battle_this_turn(&self) -> bool {
        self.attacked_battle_this_turn
    }

    pub fn set_not_attacked_since_last_upkeep_of(&mut self, player: PlayerId) {
        self.not_attacked_since_last_upkeep_of.push(player);
    }

    pub fn clear_not_attacked_since_last_upkeep_of(&mut self) {
        self.not_attacked_since_last_upkeep_of.clear();
    }

    pub fn has_attacked_since_last_upkeep_of(&self, player: PlayerId) -> bool {
        !self.not_attacked_since_last_upkeep_of.contains(&player)
    }

    pub fn set_not_blocked_since_last_upkeep_of(&mut self, player: PlayerId) {
        self.not_blocked_since_last_upkeep_of.push(player);
    }

    pub fn clear_not_blocked_since_last_upkeep_of(&mut self) {
        self.not_blocked_since_last_upkeep_of.clear();
    }

    pub fn has_blocked_since_last_upkeep_of(&self, player: PlayerId) -> bool {
        !self.not_blocked_since_last_upkeep_of.contains(&player)
    }

    pub fn set_not_been_blocked_since_last_upkeep_of(&mut self, player: PlayerId) {
        self.not_been_blocked_since_last_upkeep_of.push(player);
    }

    pub fn clear_not_been_blocked_since_last_upkeep_of(&mut self) {
        self.not_been_blocked_since_last_upkeep_of.clear();
    }

    pub fn has_been_blocked_since_last_upkeep_of(&self, player: PlayerId) -> bool {
        !self.not_been_blocked_since_last_upkeep_of.contains(&player)
    }

    /// Reset per-combat fields at end of combat.
    pub fn end_combat(&mut self) {
        self.creature_attacked_this_combat = 0;
        self.creature_blocked_this_combat = false;
        self.creature_got_blocked_this_combat = false;
    }

    /// Reset per-turn fields at start of a new turn.
    pub fn new_turn(&mut self) {
        self.attacked_this_turn.clear();
        self.attacked_battle_this_turn = false;
        self.damage_done_this_turn.clear();
    }
}

/// Temporary compatibility alias for existing call sites.
pub type DamageHistory = CardDamageHistory;
