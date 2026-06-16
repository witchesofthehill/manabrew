use forge_foundation::{PhaseType, ZoneType};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

use crate::ability::AbilityKey;
use crate::card::card_damage_map::CardDamageMap;
use crate::card::card_zone_table::CardZoneTable;
use crate::ids::{CardId, PlayerId};
use strum_macros::Display;

// `TriggerType` was moved to `crate::trigger::trigger_type`. Nothing in this
// module references it directly — callers must use `crate::trigger::TriggerType`.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZoneChangeRecord {
    pub origin: ZoneType,
    pub destination: ZoneType,
    pub card: CardId,
}

#[derive(Debug, Clone, Serialize, Deserialize, Display)]
#[allow(clippy::large_enum_variant)]
pub enum AbilityValue {
    Card(CardId),
    Player(PlayerId),
    Cards(Vec<CardId>),
    Players(Vec<PlayerId>),
    VoteMap(Vec<(String, Vec<PlayerId>)>),
    SpellAbility(crate::spellability::SpellAbility),
    CardZoneTable(CardZoneTable),
    DamageMap(CardDamageMap),
    CounterMap(BTreeMap<String, i32>),
    String(String),
    Int(i32),
    Bool(bool),
    Zone(ZoneType),
    Phase(PhaseType),
}

impl Default for AbilityValue {
    fn default() -> Self {
        AbilityValue::String(String::new())
    }
}

impl AbilityValue {
    pub fn as_str(&self) -> &str {
        match self {
            AbilityValue::String(value) => value.as_str(),
            _ => "",
        }
    }
}

impl std::ops::Deref for AbilityValue {
    type Target = str;

    fn deref(&self) -> &Self::Target {
        self.as_str()
    }
}

impl From<CardId> for AbilityValue {
    fn from(value: CardId) -> Self {
        AbilityValue::Card(value)
    }
}

impl From<PlayerId> for AbilityValue {
    fn from(value: PlayerId) -> Self {
        AbilityValue::Player(value)
    }
}

impl From<Vec<CardId>> for AbilityValue {
    fn from(value: Vec<CardId>) -> Self {
        AbilityValue::Cards(value)
    }
}

impl From<Vec<PlayerId>> for AbilityValue {
    fn from(value: Vec<PlayerId>) -> Self {
        AbilityValue::Players(value)
    }
}

impl From<Vec<(String, Vec<PlayerId>)>> for AbilityValue {
    fn from(value: Vec<(String, Vec<PlayerId>)>) -> Self {
        AbilityValue::VoteMap(value)
    }
}

impl From<crate::spellability::SpellAbility> for AbilityValue {
    fn from(value: crate::spellability::SpellAbility) -> Self {
        AbilityValue::SpellAbility(value)
    }
}

impl From<CardZoneTable> for AbilityValue {
    fn from(value: CardZoneTable) -> Self {
        AbilityValue::CardZoneTable(value)
    }
}

impl From<CardDamageMap> for AbilityValue {
    fn from(value: CardDamageMap) -> Self {
        AbilityValue::DamageMap(value)
    }
}

impl From<BTreeMap<String, i32>> for AbilityValue {
    fn from(value: BTreeMap<String, i32>) -> Self {
        AbilityValue::CounterMap(value)
    }
}

impl From<String> for AbilityValue {
    fn from(value: String) -> Self {
        AbilityValue::String(value)
    }
}

impl From<&str> for AbilityValue {
    fn from(value: &str) -> Self {
        AbilityValue::String(value.to_string())
    }
}

impl From<&String> for AbilityValue {
    fn from(value: &String) -> Self {
        AbilityValue::String(value.clone())
    }
}

impl From<i32> for AbilityValue {
    fn from(value: i32) -> Self {
        AbilityValue::Int(value)
    }
}

impl From<bool> for AbilityValue {
    fn from(value: bool) -> Self {
        AbilityValue::Bool(value)
    }
}

impl From<ZoneType> for AbilityValue {
    fn from(value: ZoneType) -> Self {
        AbilityValue::Zone(value)
    }
}

impl From<PhaseType> for AbilityValue {
    fn from(value: PhaseType) -> Self {
        AbilityValue::Phase(value)
    }
}

/// Typed event parameter keys — mirrors Java AbilityKey enum.
/// In Java this is Map<AbilityKey, Object>. In Rust we use a struct
/// because Rust has no Object type (justified deviation).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RunParams {
    pub card: Option<CardId>,
    pub card_lki: Option<CardId>,
    /// Additional card collection payload used by many Java triggers (AbilityKey.Cards).
    pub cards: Option<Vec<CardId>>,
    /// Batched zone-change payload used by Java's CardZoneTable triggers.
    pub zone_changes: Option<Vec<ZoneChangeRecord>>,
    /// Java-style `CardZoneTable` object payload for batch zone-change triggers.
    pub change_zone_table: Option<CardZoneTable>,
    pub origin: Option<ZoneType>,
    pub destination: Option<ZoneType>,
    /// CSV destination payload used by TriggerAbilityTriggered for batch triggers.
    pub destinations: Option<String>,
    /// Java AbilityKey.Activator.
    pub activator: Option<PlayerId>,
    pub cause_player: Option<PlayerId>,
    pub player: Option<PlayerId>,
    pub phase: Option<PhaseType>,
    pub damage_source: Option<CardId>,
    pub damage_target_player: Option<PlayerId>,
    pub damage_target_card: Option<CardId>,
    /// Java AbilityKey.Target payload split by target type.
    pub target_player: Option<PlayerId>,
    pub target_card: Option<CardId>,
    pub damage_amount: Option<i32>,
    pub is_combat_damage: Option<bool>,
    /// Java AbilityKey.FirstTime marker.
    pub first_time: Option<bool>,
    /// Java AbilityKey.Fizzle marker.
    pub fizzle: Option<bool>,
    /// Java AbilityKey.Valiant marker.
    pub valiant: Option<bool>,
    pub attacker: Option<CardId>,
    /// Java AbilityKey.Attacked split by entity type.
    pub attacked_player: Option<PlayerId>,
    pub attacked_card: Option<CardId>,
    /// Java AbilityKey.OtherAttackers.
    pub other_attacker_ids: Option<Vec<CardId>>,
    /// Java AbilityKey.Defenders split by entity type.
    pub defenders_player_ids: Option<Vec<PlayerId>>,
    pub defenders_card_ids: Option<Vec<CardId>>,
    /// Java AbilityKey.AttackingPlayer.
    pub attacking_player: Option<PlayerId>,
    pub defending_player: Option<PlayerId>,
    pub spell_card: Option<CardId>,
    pub spell_controller: Option<PlayerId>,
    /// Second card involved (e.g. second creature in a Fight trigger).
    pub card2: Option<CardId>,
    /// Java AbilityKey.Explored.
    pub explored: Option<CardId>,
    /// SpellAbility that was countered
    pub spell_ability: Option<crate::spellability::SpellAbility>,
    /// Java AbilityKey.SourceSA.
    pub source_sa: Option<crate::spellability::SpellAbility>,
    /// Java AbilityKey.AbilityMana.
    pub ability_mana: Option<crate::spellability::SpellAbility>,
    /// Cause of the event (e.g. counterspell)
    pub cause: Option<crate::spellability::SpellAbility>,
    /// Java AbilityKey.Causer payload.
    pub causer: Option<CardId>,
    /// Java AbilityKey.Produced.
    pub produced: Option<String>,
    /// Java AbilityKey.Mode.
    pub mode: Option<String>,
    /// Java AbilityKey.Num.
    pub num: Option<i32>,
    /// Java AbilityKey.Number.
    pub number: Option<i32>,
    // ── New fields (issue #19) ──
    /// Blocking creature (for Blocks trigger).
    pub blocker: Option<CardId>,
    /// Attacker being blocked (for Blocks trigger).
    pub blocked_attacker: Option<CardId>,
    /// Life amount gained or lost (for LifeGained/LifeLost triggers).
    pub life_amount: Option<i32>,
    /// Counter type name (for CounterAdded/CounterRemoved triggers).
    pub counter_type: Option<String>,
    /// Number of counters added/removed.
    pub counter_amount: Option<i32>,
    // ── New fields (issue #54) ──
    /// Batch of attacker IDs (for AttackersDeclared).
    pub attacker_ids: Option<Vec<CardId>>,
    /// Batch of blocker IDs (for BlockersDeclared).
    pub blocker_ids: Option<Vec<CardId>>,
    /// Original controller before a control change.
    pub original_controller: Option<PlayerId>,
    /// Cumulative mana expend amount (for ManaExpend trigger).
    pub mana_expend_amount: Option<i32>,
    /// Enlisted card (for TriggerType::Enlisted).
    pub enlisted: Option<CardId>,
    /// The spell/ability card that caused the event (for BecomesTarget — the targeting spell).
    pub cause_card: Option<CardId>,
    /// Coin-flip outcome (true = win/heads).
    pub coin_flip_won: Option<bool>,
    /// Rolled die result (modified).
    pub die_result: Option<i32>,
    /// Batch of rolled die results (for RolledDieOnce aggregate triggers).
    pub die_results: Option<Vec<i32>>,
    /// Rolled die natural result before modifiers.
    pub natural_result: Option<i32>,
    /// Number of sides on the rolled die.
    pub die_sides: Option<i32>,
    /// Number of attackers declared this combat (for Exalted `Alone$ True` check).
    pub num_attackers: Option<usize>,
    /// The creature that was exploited (for Exploited trigger).
    pub exploited_card: Option<CardId>,
    /// LKI +1/+1 counter count on a card that just left the battlefield.
    /// Used by Modular triggers to know how many counters to move.
    pub lki_p1p1_counters: Option<i32>,
    /// LKI power on a card that just left the battlefield.
    /// Used for TriggeredCard$CardPower without depending on mutable card state.
    pub lki_power: Option<i32>,
    /// LKI toughness on a card that just left the battlefield.
    /// Used for TriggeredCard$CardToughness without depending on mutable card state.
    pub lki_toughness: Option<i32>,
    /// Whether cumulative upkeep was paid (for PayCumulativeUpkeep trigger).
    pub cumulative_upkeep_paid: Option<bool>,
    /// Whether echo was paid (for PayEcho trigger).
    pub echo_paid: Option<bool>,
    /// Gained class level value.
    pub class_level: Option<i32>,
    /// Room name payload for room-enter triggers.
    pub room_name: Option<String>,
    /// Cards that crewed/saddled another card.
    pub crew_cards: Option<Vec<CardId>>,
    /// Championed card payload.
    pub championed_card: Option<CardId>,
    /// Generic source card payload for triggers like Mentored.
    pub source_card: Option<CardId>,
    /// Generic source player payload for triggers like CounterPlayerAddedAll.
    pub source_player: Option<PlayerId>,
    /// Generic object card payload for triggers like CounterTypeAddedAll.
    pub object_card: Option<CardId>,
    /// Generic object player payload for triggers like CounterTypeAddedAll.
    pub object_player: Option<PlayerId>,
    /// Counter type -> amount map payload.
    pub counter_map: Option<BTreeMap<String, i32>>,
    /// Java AbilityKey.DamageMap.
    pub damage_map: Option<CardDamageMap>,
    /// Clash outcome.
    pub clash_won: Option<bool>,
    /// Card state name payload (for door/room state specific checks).
    pub card_state_name: Option<String>,
    /// Snapshot of drawn_this_turn at the time a Drawn event fires.
    /// Used by `Number$ N` triggers to compare against the exact draw count
    /// at fire time (not at deferred match time).
    pub drawn_this_turn_snapshot: Option<i32>,
    /// Players for whom this was the first relevant event this turn.
    pub first_time_players: Option<Vec<PlayerId>>,
    /// Java AbilityKey.AllVotes.
    pub all_votes: Option<Vec<(String, Vec<PlayerId>)>>,
    /// Java AbilityKey.DiscardedBefore.
    pub discarded_before: Option<Vec<CardId>>,
    /// Java AbilityKey.RolledToVisitAttractions.
    pub rolled_to_visit_attractions: Option<bool>,
}

impl RunParams {
    pub fn add_common_trigger_objects(&self, sa: &mut crate::spellability::SpellAbility) {
        if let Some(card_id) = self.card {
            sa.set_triggering_object(crate::ability::AbilityKey::Card, card_id.0.to_string());
            sa.set_triggering_object(crate::ability::AbilityKey::NewCard, card_id.0.to_string());
        }
        if let Some(card_id) = self.card_lki {
            sa.set_triggering_object(crate::ability::AbilityKey::CardLKI, card_id.0.to_string());
        }
        if let Some(player_id) = self.activator.or(self.cause_player) {
            sa.set_triggering_object(
                crate::ability::AbilityKey::Activator,
                player_id.0.to_string(),
            );
        }
        if let Some(player_id) = self.player {
            sa.set_triggering_object(crate::ability::AbilityKey::Player, player_id.0.to_string());
        }
        if let Some(player_id) = self.attacking_player {
            sa.set_triggering_object(
                crate::ability::AbilityKey::AttackingPlayer,
                player_id.0.to_string(),
            );
        }
        if let Some(player_id) = self.defending_player {
            sa.set_triggering_object(
                crate::ability::AbilityKey::DefendingPlayer,
                player_id.0.to_string(),
            );
        }
        if let Some(card_id) = self.causer.or(self.cause_card) {
            sa.set_triggering_object(crate::ability::AbilityKey::Causer, card_id.0.to_string());
        }
        if let Some(card_id) = self.source_card.or(self.spell_card) {
            sa.set_triggering_object(crate::ability::AbilityKey::Source, card_id.0.to_string());
        }
        if let Some(card_id) = self.attacker {
            sa.set_triggering_object(crate::ability::AbilityKey::Attacker, card_id.0.to_string());
        }
        if let Some(card_id) = self.blocker {
            sa.set_triggering_object(crate::ability::AbilityKey::Blocker, card_id.0.to_string());
        }
        if let Some(card_id) = self.attacked_card {
            sa.set_triggering_object(crate::ability::AbilityKey::Attacked, card_id.0.to_string());
        }
        if let Some(player_id) = self.attacked_player {
            sa.set_triggering_object(
                crate::ability::AbilityKey::AttackedTarget,
                player_id.0.to_string(),
            );
        }
        if let Some(card_id) = self.target_card {
            let value = card_id.0.to_string();
            sa.set_triggering_object(crate::ability::AbilityKey::Target, &value);
            sa.set_triggering_object(crate::ability::AbilityKey::TargetCard, &value);
        }
        if let Some(player_id) = self.target_player {
            let value = player_id.0.to_string();
            sa.set_triggering_object(crate::ability::AbilityKey::Target, &value);
            sa.set_triggering_object(crate::ability::AbilityKey::TargetPlayer, &value);
        }
        if self.target_player.is_none() {
            if let Some(player_id) = self.damage_target_player {
                let value = player_id.0.to_string();
                sa.set_triggering_object(crate::ability::AbilityKey::Target, &value);
                sa.set_triggering_object(crate::ability::AbilityKey::TargetPlayer, &value);
            }
        }
        if self.target_card.is_none() {
            if let Some(card_id) = self.damage_target_card {
                let value = card_id.0.to_string();
                sa.set_triggering_object(crate::ability::AbilityKey::Target, &value);
                sa.set_triggering_object(crate::ability::AbilityKey::TargetCard, &value);
            }
        }
        if let Some(card_id) = self.explored {
            sa.set_triggering_object(crate::ability::AbilityKey::Explored, card_id.0.to_string());
        }
        if let Some(cards) = self.cards.as_deref() {
            let csv = cards
                .iter()
                .map(|card_id| card_id.0.to_string())
                .collect::<Vec<_>>()
                .join(",");
            if !csv.is_empty() {
                sa.set_triggering_object(crate::ability::AbilityKey::Cards, &csv);
            }
        }
        if let Some(cards) = self.attacker_ids.as_deref() {
            let csv = cards
                .iter()
                .map(|card_id| card_id.0.to_string())
                .collect::<Vec<_>>()
                .join(",");
            if !csv.is_empty() {
                sa.set_triggering_object(crate::ability::AbilityKey::Attackers, &csv);
            }
        }
        if let Some(value) = self.life_amount {
            sa.set_triggering_object(crate::ability::AbilityKey::LifeAmount, value.to_string());
        }
        if let Some(value) = self.natural_result {
            sa.set_triggering_object(crate::ability::AbilityKey::NaturalResult, value.to_string());
        }
        if let Some(value) = self.card_state_name.as_deref() {
            sa.set_triggering_object(crate::ability::AbilityKey::CardState, value);
        }
        if let Some(value) = self.room_name.as_deref() {
            sa.set_triggering_object(crate::ability::AbilityKey::RoomName, value);
        }
        if let Some(value) = self.spell_ability.as_ref() {
            sa.set_triggering_spell_ability("SpellAbility", value.clone());
        }
        if let Some(value) = self.source_sa.as_ref() {
            sa.set_triggering_spell_ability("SourceSA", value.clone());
        }
        if let Some(value) = self.ability_mana.as_ref() {
            sa.set_triggering_spell_ability("AbilityMana", value.clone());
        }
        if let Some(value) = self.cause.as_ref() {
            sa.set_triggering_spell_ability("Cause", value.clone());
        }
        if let Some(results) = self.die_results.as_deref() {
            let csv = results
                .iter()
                .map(i32::to_string)
                .collect::<Vec<_>>()
                .join(",");
            if !csv.is_empty() {
                sa.set_triggering_object(crate::ability::AbilityKey::Result, &csv);
            }
        } else if let Some(value) = self.die_result {
            sa.set_triggering_object(crate::ability::AbilityKey::Result, value.to_string());
        }
        if let Some(value) = self.die_sides {
            sa.set_triggering_object(crate::ability::AbilityKey::Sides, value.to_string());
        }
        if let Some(value) = self.number {
            sa.set_triggering_object(crate::ability::AbilityKey::Number, value.to_string());
        }
    }

    pub fn get_value(&self, key: AbilityKey) -> Option<AbilityValue> {
        use AbilityKey::*;
        match key {
            AbilityMana => self.ability_mana.clone().map(AbilityValue::SpellAbility),
            AllVotes => self.all_votes.clone().map(AbilityValue::VoteMap),
            Activator => self
                .activator
                .or(self.cause_player)
                .map(AbilityValue::Player),
            Amount => self
                .cards
                .as_ref()
                .map(|cards| AbilityValue::Int(cards.len() as i32))
                .or_else(|| self.counter_amount.map(AbilityValue::Int))
                .or_else(|| self.damage_amount.map(AbilityValue::Int))
                .or_else(|| self.life_amount.map(AbilityValue::Int)),
            Attacked => self
                .attacked_card
                .map(AbilityValue::Card)
                .or_else(|| self.attacked_player.map(AbilityValue::Player)),
            Attacker => self.attacker.map(AbilityValue::Card),
            Attackers => self.attacker_ids.clone().map(AbilityValue::Cards),
            AttackingPlayer => self
                .attacking_player
                .or(self.spell_controller)
                .map(AbilityValue::Player),
            Blocker => self.blocker.map(AbilityValue::Card),
            Blockers => self.blocker_ids.clone().map(AbilityValue::Cards),
            Card => self.card.map(AbilityValue::Card),
            CardState => self.card_state_name.clone().map(AbilityValue::String),
            Cards => self
                .change_zone_table
                .clone()
                .map(AbilityValue::CardZoneTable)
                .or_else(|| self.cards.clone().map(AbilityValue::Cards)),
            CardLKI => self.card_lki.map(AbilityValue::Card),
            Causer => self
                .causer
                .map(AbilityValue::Card)
                .or_else(|| self.cause_card.map(AbilityValue::Card))
                .or_else(|| {
                    self.cause
                        .as_ref()
                        .and_then(|sa| sa.source)
                        .map(AbilityValue::Card)
                }),
            Cause => self
                .cause
                .clone()
                .map(AbilityValue::SpellAbility)
                .or_else(|| self.cause_card.map(AbilityValue::Card))
                .or_else(|| self.cards.clone().map(AbilityValue::Cards)),
            Championed => self.championed_card.map(AbilityValue::Card),
            ClassLevel => self.class_level.map(AbilityValue::Int),
            CounterAmount | CounterNum | NewCounterAmount => {
                self.counter_amount.map(AbilityValue::Int)
            }
            CounterMap => self.counter_map.clone().map(AbilityValue::CounterMap),
            CounterType => self.counter_type.clone().map(AbilityValue::String),
            Crew => self.crew_cards.clone().map(AbilityValue::Cards),
            CumulativeUpkeepPaid => self.cumulative_upkeep_paid.map(AbilityValue::Bool),
            DamageAmount | LifeGained | LifeAmount | Num | Number | PreventedAmount => self
                .damage_amount
                .or(self.life_amount)
                .or(self.num)
                .or(self.number)
                .or(self.drawn_this_turn_snapshot)
                .map(AbilityValue::Int),
            DamageMap => self.damage_map.clone().map(AbilityValue::DamageMap),
            DamageSource => self.damage_source.map(AbilityValue::Card),
            DamageTarget | Target => self
                .damage_target_card
                .map(AbilityValue::Card)
                .or_else(|| self.damage_target_player.map(AbilityValue::Player))
                .or_else(|| self.target_card.map(AbilityValue::Card))
                .or_else(|| self.target_player.map(AbilityValue::Player)),
            Defenders => self
                .defenders_card_ids
                .clone()
                .map(AbilityValue::Cards)
                .or_else(|| self.defenders_player_ids.clone().map(AbilityValue::Players)),
            DefendingPlayer => self.defending_player.map(AbilityValue::Player),
            Destination => self
                .destinations
                .clone()
                .map(AbilityValue::String)
                .or_else(|| self.destination.map(AbilityValue::Zone)),
            EchoPaid => self.echo_paid.map(AbilityValue::Bool),
            Enlisted => self.enlisted.map(AbilityValue::Card),
            Exploited => self.exploited_card.map(AbilityValue::Card),
            Explored => self.explored.map(AbilityValue::Card),
            Explorer => self.card.map(AbilityValue::Card),
            FirstTime => self
                .first_time_players
                .clone()
                .map(AbilityValue::Players)
                .or_else(|| self.first_time.map(AbilityValue::Bool)),
            Fizzle => self.fizzle.map(AbilityValue::Bool),
            IsCombat | IsCombatDamage => self.is_combat_damage.map(AbilityValue::Bool),
            LastStateBattlefield => self
                .change_zone_table
                .as_ref()
                .map(|table| AbilityValue::Cards(table.last_state_battlefield().to_vec())),
            LastStateGraveyard => self
                .change_zone_table
                .as_ref()
                .map(|table| AbilityValue::Cards(table.last_state_graveyard().to_vec())),
            Mana | Produced => self.produced.clone().map(AbilityValue::String),
            Mode => self.mode.clone().map(AbilityValue::String),
            NewCard => self.card2.map(AbilityValue::Card),
            Object => self
                .object_card
                .map(AbilityValue::Card)
                .or_else(|| self.object_player.map(AbilityValue::Player))
                .or_else(|| self.card.map(AbilityValue::Card)),
            OtherAttackers => self.other_attacker_ids.clone().map(AbilityValue::Cards),
            Origin => self.origin.map(AbilityValue::Zone),
            OriginalController => self.original_controller.map(AbilityValue::Player),
            Phase => self.phase.map(AbilityValue::Phase),
            Player => self.player.map(AbilityValue::Player),
            Result | Won => self
                .coin_flip_won
                .map(AbilityValue::Bool)
                .or_else(|| self.clash_won.map(AbilityValue::Bool))
                .or_else(|| self.mode.clone().map(AbilityValue::String))
                .or_else(|| self.die_result.map(AbilityValue::Int)),
            NaturalResult => self.natural_result.map(AbilityValue::Int),
            RoomName => self.room_name.clone().map(AbilityValue::String),
            RolledToVisitAttractions => self.rolled_to_visit_attractions.map(AbilityValue::Bool),
            Scheme => self.card.map(AbilityValue::Card),
            Sides => self.die_sides.map(AbilityValue::Int),
            Source => self
                .source_card
                .map(AbilityValue::Card)
                .or_else(|| self.source_player.map(AbilityValue::Player))
                .or_else(|| self.spell_card.map(AbilityValue::Card)),
            SourceSA | SpellAbility | StackSa => self
                .source_sa
                .clone()
                .or_else(|| self.spell_ability.clone())
                .map(AbilityValue::SpellAbility),
            Valiant => self.valiant.map(AbilityValue::Bool),
            InternalTriggerTable => self
                .change_zone_table
                .clone()
                .map(AbilityValue::CardZoneTable),
            _ => None,
        }
    }

    pub fn as_ability_map(&self) -> HashMap<AbilityKey, AbilityValue> {
        crate::ability::ability_key::all_ability_keys()
            .iter()
            .filter_map(|key| self.get_value(*key).map(|value| (*key, value)))
            .collect()
    }

    /// Java-parity alias for `Map<AbilityKey, Object>.get(...)`.
    pub fn get(&self, key: AbilityKey) -> Option<AbilityValue> {
        self.get_value(key)
    }

    /// Get a card ID from run-params by AbilityKey.
    /// Provides a generic accessor so code can use `AbilityKey` enum values
    /// to pull data from the typed struct.
    pub fn get_card(&self, key: crate::ability::AbilityKey) -> Option<CardId> {
        match self.get_value(key) {
            Some(AbilityValue::Card(card)) => Some(card),
            _ => None,
        }
    }

    /// Get a player ID from run-params by AbilityKey.
    pub fn get_player(&self, key: crate::ability::AbilityKey) -> Option<PlayerId> {
        match self.get_value(key) {
            Some(AbilityValue::Player(player)) => Some(player),
            _ => None,
        }
    }

    /// Get an integer amount from run-params by AbilityKey.
    pub fn get_amount(&self, key: crate::ability::AbilityKey) -> Option<i32> {
        match self.get_value(key) {
            Some(AbilityValue::Int(value)) => Some(value),
            _ => None,
        }
    }

    /// Get a bool marker by AbilityKey.
    pub fn get_bool(&self, key: crate::ability::AbilityKey) -> Option<bool> {
        use crate::ability::AbilityKey;
        match key {
            AbilityKey::IsCombatDamage => self.is_combat_damage,
            AbilityKey::FirstTime => self.first_time,
            AbilityKey::Valiant => self.valiant,
            _ => None,
        }
    }

    /// Get a SpellAbility by AbilityKey.
    pub fn get_spell_ability(
        &self,
        key: crate::ability::AbilityKey,
    ) -> Option<&crate::spellability::SpellAbility> {
        use crate::ability::AbilityKey;
        match key {
            AbilityKey::SpellAbility => self.spell_ability.as_ref(),
            AbilityKey::SourceSA => self.source_sa.as_ref(),
            AbilityKey::AbilityMana => self.ability_mana.as_ref(),
            AbilityKey::Cause => self.cause.as_ref(),
            _ => None,
        }
    }

    /// Get a card list by AbilityKey.
    pub fn get_cards(&self, key: crate::ability::AbilityKey) -> Option<&[CardId]> {
        use crate::ability::AbilityKey;
        match key {
            AbilityKey::Cards => self.cards.as_deref(),
            AbilityKey::DamageTargets => self.cards.as_deref(),
            AbilityKey::Attackers => self.attacker_ids.as_deref(),
            AbilityKey::Blockers => self.blocker_ids.as_deref(),
            AbilityKey::OtherAttackers => self.other_attacker_ids.as_deref(),
            AbilityKey::Defenders => self.defenders_card_ids.as_deref(),
            _ => None,
        }
    }

    /// Get a string payload by AbilityKey.
    pub fn get_string(&self, key: crate::ability::AbilityKey) -> Option<&str> {
        use crate::ability::AbilityKey;
        match key {
            AbilityKey::Produced => self.produced.as_deref(),
            AbilityKey::Mode => self.mode.as_deref(),
            _ => None,
        }
    }
}
