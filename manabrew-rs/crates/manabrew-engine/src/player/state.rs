use std::collections::{BTreeSet, HashMap};

use serde::{Deserialize, Serialize};

use crate::ids::{CardId, PlayerId};

use super::player_outcome::PlayerOutcome;
use super::player_statistics::PlayerStatistics;

/// Mutable game-state for a single player.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerState {
    pub id: PlayerId,
    pub name: String,

    pub life: i32,
    pub starting_life: i32,
    pub life_started_this_turn_with: i32,
    pub life_gained_this_turn: i32,
    pub life_gained_by_team_this_turn: i32,
    pub life_gained_times_this_turn: i32,
    pub life_lost_this_turn: i32,
    pub life_lost_last_turn: i32,

    pub poison_counters: i32,

    pub lands_played_this_turn: i32,
    pub lands_played_last_turn: i32,
    pub max_land_plays_per_turn: i32,
    pub spells_cast_this_turn: i32,
    pub spells_cast_last_turn: i32,
    pub spells_cast_this_game: i32,
    pub cards_cast_this_turn: Vec<CardId>,

    pub max_hand_size: i32,
    pub starting_hand_size: i32,
    pub unlimited_hand_size: bool,

    pub drawn_this_turn: i32,
    pub drawn_last_turn: i32,
    pub drawn_this_draw_step: i32,
    pub tried_to_draw_from_empty_library: bool,
    pub num_cards_in_hand_started_this_turn_with: i32,

    pub has_lost: bool,
    pub has_won: bool,
    pub has_conceded: bool,
    pub outcome: Option<PlayerOutcome>,

    pub commander_damage_received: HashMap<u32, i32>,
    pub commanders: Vec<CardId>,
    pub commander_casts: HashMap<u32, u32>,
    pub commander_damage_enabled: bool,

    pub skip_turns: i32,
    pub skip_next_draw: bool,
    pub skip_next_combat: bool,
    pub skip_next_untap: bool,

    pub damage_prevention: i32,

    pub energy_counters: i32,
    // NOT IMPLEMENTED: experience counters (Commander sets — Meren, Mizzix,
    // …) and ticket counters (Unfinity stickers). Neither is tracked on
    // `PlayerState` yet; the DTO + UI `PlayerPanel` will surface them as
    // badges once a field is added here and plumbed through
    // `game_view_dto::PlayerDto`.
    pub mana_shards: i32,

    pub mana_expended_this_turn: i32,
    pub surveilled_this_turn: i32,
    pub tokens_created_this_turn: i32,
    pub foretold_this_turn: i32,
    pub investigated_this_turn: i32,
    pub ventured_this_turn: i32,
    pub sacrificed_this_turn: i32,
    pub library_searched_this_turn: i32,

    pub controlled_by: Option<PlayerId>,
    pub team_number: i32,
    pub unlimited_land_plays: bool,

    pub has_city_blessing: bool,
    pub ring_level: i32,
    pub speed: i32,
    pub speed_effect_card: Option<CardId>,
    pub commander_effect_card: Option<CardId>,
    pub monarch_effect_card: Option<CardId>,
    pub initiative_effect_card: Option<CardId>,
    pub blessing_effect_card: Option<CardId>,
    pub radiation_effect_card: Option<CardId>,
    pub ring_effect_card: Option<CardId>,
    pub contraption_sprocket_effect_card: Option<CardId>,
    pub keyword_effect_card: Option<CardId>,
    pub planar_dice_effect_card: Option<CardId>,
    pub companion_effect_card: Option<CardId>,
    pub discarded_this_turn: i32,
    pub explored_this_turn: i32,
    pub assigned_damage_this_turn: i32,
    pub assigned_combat_damage_this_turn: i32,
    pub opponents_assigned_damage_this_turn: i32,
    pub attacked_players_this_turn: Vec<PlayerId>,
    pub attacked_players_last_turn: Vec<PlayerId>,
    pub attacked_players_this_combat: Vec<PlayerId>,
    pub been_dealt_combat_damage_since_last_turn: bool,
    pub attractions_visited_this_turn: i32,
    pub num_flips_this_turn: i32,
    pub num_rolls_this_turn: i32,
    pub dice_rolls_this_turn: Vec<i32>,
    pub ring_bearer: Option<CardId>,
    pub radiation_counters: i32,
    pub permanents_left_battlefield_this_turn: i32,
    pub lands_entered_battlefield_this_turn: i32,
    pub permanents_put_into_graveyard_this_turn: i32,
    pub completed_dungeons: Vec<CardId>,
    pub notes: HashMap<String, Vec<String>>,
    pub noted_num: HashMap<String, i32>,
    pub tapped_land_for_mana_this_turn: bool,
    pub committed_crime_this_turn: i32,
    pub changed_keywords: Vec<String>,
    #[serde(default)]
    pub keywords_until_my_next_turn: Vec<String>,
    #[serde(default)]
    pub keywords_until_end_of_turn: Vec<String>,
    pub maingame_card_mapping: HashMap<CardId, CardId>,
    pub controlled_while_searching: BTreeSet<PlayerId>,
    pub avatar_index: i32,
    pub sleeve_index: i32,
    pub crank_counter: i32,
    pub additional_votes: HashMap<i64, i32>,
    pub additional_optional_votes: HashMap<i64, i32>,
    pub control_votes: BTreeSet<i64>,
    pub additional_villainous_choices: HashMap<i64, i32>,
    pub declares_attackers: BTreeSet<PlayerId>,
    pub declares_blockers: BTreeSet<PlayerId>,
    pub elemental_bend_triggers: BTreeSet<String>,
    pub inbound_tokens: Vec<CardId>,
    pub planeswalked_to_this_turn: Vec<CardId>,
    pub lost_ownership: Vec<CardId>,
    pub gained_ownership: Vec<CardId>,
    pub paid_for_stack: Vec<crate::spellability::SpellAbility>,
    pub devotion_mod: i32,
    pub draft_notes: HashMap<String, String>,
    pub statistics: PlayerStatistics,
}

impl PlayerState {
    pub fn new(id: PlayerId, name: String, starting_life: i32) -> Self {
        PlayerState {
            id,
            name,
            life: starting_life,
            starting_life,
            life_started_this_turn_with: starting_life,
            life_gained_this_turn: 0,
            life_gained_by_team_this_turn: 0,
            life_gained_times_this_turn: 0,
            life_lost_this_turn: 0,
            life_lost_last_turn: 0,
            poison_counters: 0,
            lands_played_this_turn: 0,
            lands_played_last_turn: 0,
            max_land_plays_per_turn: 1,
            spells_cast_this_turn: 0,
            spells_cast_last_turn: 0,
            spells_cast_this_game: 0,
            cards_cast_this_turn: Vec::new(),
            max_hand_size: 7,
            starting_hand_size: 7,
            unlimited_hand_size: false,
            drawn_this_turn: 0,
            drawn_last_turn: 0,
            drawn_this_draw_step: 0,
            tried_to_draw_from_empty_library: false,
            num_cards_in_hand_started_this_turn_with: 0,
            has_lost: false,
            has_won: false,
            has_conceded: false,
            outcome: None,
            commander_damage_received: HashMap::new(),
            commanders: Vec::new(),
            commander_casts: HashMap::new(),
            commander_damage_enabled: true,
            skip_turns: 0,
            skip_next_draw: false,
            skip_next_combat: false,
            skip_next_untap: false,
            damage_prevention: 0,
            energy_counters: 0,
            mana_shards: 0,
            mana_expended_this_turn: 0,
            surveilled_this_turn: 0,
            tokens_created_this_turn: 0,
            foretold_this_turn: 0,
            investigated_this_turn: 0,
            ventured_this_turn: 0,
            sacrificed_this_turn: 0,
            library_searched_this_turn: 0,
            controlled_by: None,
            team_number: -1,
            unlimited_land_plays: false,
            has_city_blessing: false,
            ring_level: 0,
            speed: 0,
            speed_effect_card: None,
            commander_effect_card: None,
            monarch_effect_card: None,
            initiative_effect_card: None,
            blessing_effect_card: None,
            radiation_effect_card: None,
            ring_effect_card: None,
            contraption_sprocket_effect_card: None,
            keyword_effect_card: None,
            planar_dice_effect_card: None,
            companion_effect_card: None,
            discarded_this_turn: 0,
            explored_this_turn: 0,
            assigned_damage_this_turn: 0,
            assigned_combat_damage_this_turn: 0,
            opponents_assigned_damage_this_turn: 0,
            attacked_players_this_turn: Vec::new(),
            attacked_players_last_turn: Vec::new(),
            attacked_players_this_combat: Vec::new(),
            been_dealt_combat_damage_since_last_turn: false,
            attractions_visited_this_turn: 0,
            num_flips_this_turn: 0,
            num_rolls_this_turn: 0,
            dice_rolls_this_turn: Vec::new(),
            ring_bearer: None,
            radiation_counters: 0,
            permanents_left_battlefield_this_turn: 0,
            lands_entered_battlefield_this_turn: 0,
            permanents_put_into_graveyard_this_turn: 0,
            completed_dungeons: Vec::new(),
            notes: HashMap::new(),
            noted_num: HashMap::new(),
            tapped_land_for_mana_this_turn: false,
            committed_crime_this_turn: 0,
            changed_keywords: Vec::new(),
            keywords_until_my_next_turn: Vec::new(),
            keywords_until_end_of_turn: Vec::new(),
            maingame_card_mapping: HashMap::new(),
            controlled_while_searching: BTreeSet::new(),
            avatar_index: 0,
            sleeve_index: 0,
            crank_counter: 3,
            additional_votes: HashMap::new(),
            additional_optional_votes: HashMap::new(),
            control_votes: BTreeSet::new(),
            additional_villainous_choices: HashMap::new(),
            declares_attackers: BTreeSet::new(),
            declares_blockers: BTreeSet::new(),
            elemental_bend_triggers: BTreeSet::new(),
            inbound_tokens: Vec::new(),
            planeswalked_to_this_turn: Vec::new(),
            lost_ownership: Vec::new(),
            gained_ownership: Vec::new(),
            paid_for_stack: Vec::new(),
            devotion_mod: 0,
            draft_notes: HashMap::new(),
            statistics: PlayerStatistics {
                opening_hand_size: 7,
                ..PlayerStatistics::default()
            },
        }
    }

    pub fn gain_life(&mut self, amount: i32) {
        if amount <= 0 {
            return;
        }
        self.life += amount;
        self.life_gained_this_turn += amount;
        self.life_gained_times_this_turn += 1;
    }

    pub fn lose_life(&mut self, amount: i32) {
        if amount <= 0 {
            return;
        }
        self.life -= amount;
        self.life_lost_this_turn += amount;
    }

    pub fn set_life(&mut self, amount: i32) -> i32 {
        let diff = amount - self.life;
        self.life = amount;
        if diff > 0 {
            self.life_gained_this_turn += diff;
            self.life_gained_times_this_turn += 1;
        } else if diff < 0 {
            self.life_lost_this_turn += diff.abs();
        }
        diff
    }

    pub fn deal_damage(&mut self, amount: i32) {
        if amount > 0 {
            self.lose_life(amount);
        }
    }

    pub fn can_play_land(&self) -> bool {
        self.lands_played_this_turn < self.max_land_plays_per_turn
    }

    pub fn is_alive(&self) -> bool {
        !self.has_lost && !self.has_conceded
    }

    pub fn has_outcome(&self) -> bool {
        self.outcome.is_some()
    }

    pub fn mark_lost(&mut self, outcome: PlayerOutcome) {
        self.has_lost = true;
        self.has_won = false;
        self.has_conceded = matches!(outcome, PlayerOutcome::Conceded);
        self.outcome = Some(outcome.clone());
        self.statistics.set_outcome(Some(outcome));
    }

    pub fn mark_won(&mut self, outcome: PlayerOutcome) {
        self.has_won = true;
        self.has_lost = false;
        self.has_conceded = false;
        self.outcome = Some(outcome.clone());
        self.statistics.set_outcome(Some(outcome));
    }

    pub fn clear_outcome(&mut self) {
        self.has_lost = false;
        self.has_won = false;
        self.has_conceded = false;
        self.outcome = None;
        self.statistics.set_outcome(None);
    }

    pub fn reset_for_restart(&mut self) {
        self.life = self.starting_life;
        self.life_started_this_turn_with = self.starting_life;
        self.life_gained_this_turn = 0;
        self.life_gained_by_team_this_turn = 0;
        self.life_gained_times_this_turn = 0;
        self.life_lost_this_turn = 0;
        self.life_lost_last_turn = 0;
        self.poison_counters = 0;
        self.lands_played_this_turn = 0;
        self.lands_played_last_turn = 0;
        self.max_land_plays_per_turn = 1;
        self.spells_cast_this_turn = 0;
        self.spells_cast_last_turn = 0;
        self.spells_cast_this_game = 0;
        self.cards_cast_this_turn.clear();
        self.max_hand_size = 7;
        self.starting_hand_size = 7;
        self.unlimited_hand_size = false;
        self.drawn_this_turn = 0;
        self.drawn_last_turn = 0;
        self.drawn_this_draw_step = 0;
        self.tried_to_draw_from_empty_library = false;
        self.num_cards_in_hand_started_this_turn_with = 0;
        self.clear_outcome();
        self.commander_damage_received.clear();
        self.commanders.clear();
        self.commander_casts.clear();
        self.skip_turns = 0;
        self.skip_next_draw = false;
        self.skip_next_combat = false;
        self.skip_next_untap = false;
        self.damage_prevention = 0;
        self.energy_counters = 0;
        self.mana_shards = 0;
        self.mana_expended_this_turn = 0;
        self.surveilled_this_turn = 0;
        self.tokens_created_this_turn = 0;
        self.foretold_this_turn = 0;
        self.investigated_this_turn = 0;
        self.ventured_this_turn = 0;
        self.sacrificed_this_turn = 0;
        self.library_searched_this_turn = 0;
        self.controlled_by = None;
        self.unlimited_land_plays = false;
        self.has_city_blessing = false;
        self.ring_level = 0;
        self.speed = 0;
        self.speed_effect_card = None;
        self.commander_effect_card = None;
        self.monarch_effect_card = None;
        self.initiative_effect_card = None;
        self.blessing_effect_card = None;
        self.radiation_effect_card = None;
        self.ring_effect_card = None;
        self.contraption_sprocket_effect_card = None;
        self.keyword_effect_card = None;
        self.planar_dice_effect_card = None;
        self.companion_effect_card = None;
        self.discarded_this_turn = 0;
        self.explored_this_turn = 0;
        self.assigned_damage_this_turn = 0;
        self.assigned_combat_damage_this_turn = 0;
        self.opponents_assigned_damage_this_turn = 0;
        self.attacked_players_this_turn.clear();
        self.attacked_players_last_turn.clear();
        self.attacked_players_this_combat.clear();
        self.been_dealt_combat_damage_since_last_turn = false;
        self.attractions_visited_this_turn = 0;
        self.num_flips_this_turn = 0;
        self.num_rolls_this_turn = 0;
        self.dice_rolls_this_turn.clear();
        self.ring_bearer = None;
        self.radiation_counters = 0;
        self.permanents_left_battlefield_this_turn = 0;
        self.lands_entered_battlefield_this_turn = 0;
        self.permanents_put_into_graveyard_this_turn = 0;
        self.completed_dungeons.clear();
        self.notes.clear();
        self.noted_num.clear();
        self.tapped_land_for_mana_this_turn = false;
        self.committed_crime_this_turn = 0;
        self.changed_keywords.clear();
        self.maingame_card_mapping.clear();
        self.controlled_while_searching.clear();
        self.avatar_index = 0;
        self.sleeve_index = 0;
        self.crank_counter = 3;
        self.additional_votes.clear();
        self.additional_optional_votes.clear();
        self.control_votes.clear();
        self.additional_villainous_choices.clear();
        self.declares_attackers.clear();
        self.declares_blockers.clear();
        self.elemental_bend_triggers.clear();
        self.inbound_tokens.clear();
        self.planeswalked_to_this_turn.clear();
        self.lost_ownership.clear();
        self.gained_ownership.clear();
        self.paid_for_stack.clear();
        self.devotion_mod = 0;
        self.draft_notes.clear();
        self.statistics = PlayerStatistics::default();
    }

    pub fn new_turn(&mut self) {
        self.statistics.next_turn();
        self.lands_played_last_turn = self.lands_played_this_turn;
        self.lands_played_this_turn = 0;
        self.spells_cast_last_turn = self.spells_cast_this_turn;
        self.spells_cast_this_turn = 0;
        self.cards_cast_this_turn.clear();
        self.life_started_this_turn_with = self.life;
        self.life_lost_last_turn = self.life_lost_this_turn;
        self.life_gained_this_turn = 0;
        self.life_gained_by_team_this_turn = 0;
        self.life_gained_times_this_turn = 0;
        self.life_lost_this_turn = 0;
        self.drawn_last_turn = self.drawn_this_turn;
        self.drawn_this_turn = 0;
        self.drawn_this_draw_step = 0;
        self.mana_expended_this_turn = 0;
        self.surveilled_this_turn = 0;
        self.tokens_created_this_turn = 0;
        self.foretold_this_turn = 0;
        self.investigated_this_turn = 0;
        self.ventured_this_turn = 0;
        self.sacrificed_this_turn = 0;
        self.library_searched_this_turn = 0;
        self.discarded_this_turn = 0;
        self.explored_this_turn = 0;
        self.assigned_damage_this_turn = 0;
        self.assigned_combat_damage_this_turn = 0;
        self.opponents_assigned_damage_this_turn = 0;
        self.attacked_players_last_turn = self.attacked_players_this_turn.clone();
        self.attacked_players_this_turn.clear();
        self.attacked_players_this_combat.clear();
        self.been_dealt_combat_damage_since_last_turn = false;
        self.attractions_visited_this_turn = 0;
        self.num_flips_this_turn = 0;
        self.num_rolls_this_turn = 0;
        self.dice_rolls_this_turn.clear();
        self.permanents_left_battlefield_this_turn = 0;
        self.lands_entered_battlefield_this_turn = 0;
        self.permanents_put_into_graveyard_this_turn = 0;
        self.tapped_land_for_mana_this_turn = false;
        self.committed_crime_this_turn = 0;
        self.elemental_bend_triggers.clear();
        self.planeswalked_to_this_turn.clear();
        self.statistics.clear_turn_cache();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn player_life() {
        let mut p = PlayerState::new(PlayerId(0), "Alice".to_string(), 20);
        assert_eq!(p.life, 20);
        p.deal_damage(3);
        assert_eq!(p.life, 17);
        p.gain_life(2);
        assert_eq!(p.life, 19);
    }

    #[test]
    fn land_plays() {
        let mut p = PlayerState::new(PlayerId(0), "Alice".to_string(), 20);
        assert!(p.can_play_land());
        p.lands_played_this_turn = 1;
        assert!(!p.can_play_land());
    }
}
