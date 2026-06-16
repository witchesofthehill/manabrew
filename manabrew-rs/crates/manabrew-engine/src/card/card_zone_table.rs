//! Zone-change aggregation table (Java parity: `CardZoneTable`).

use std::collections::HashMap;

use forge_foundation::ZoneType;
use serde::{Deserialize, Serialize};

use crate::card::valid_filter;
use crate::event::{RunParams, ZoneChangeRecord};
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::parsing::CompiledSelector;
use crate::spellability::SpellAbility;
use crate::trigger::TriggerHandler;
use crate::trigger::TriggerType;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CardZoneTable {
    data: HashMap<(ZoneType, ZoneType), Vec<CardId>>,
    created_tokens: Vec<CardId>,
    first_time_token_creators: Vec<PlayerId>,
    last_state_battlefield: Vec<CardId>,
    last_state_graveyard: Vec<CardId>,
}

impl CardZoneTable {
    /// Java parity: special put that appends cards to an origin->destination bucket.
    pub fn put(&mut self, origin: Option<ZoneType>, destination: Option<ZoneType>, card: CardId) {
        let from = origin.unwrap_or(ZoneType::None);
        let to = destination.unwrap_or(ZoneType::None);
        self.data.entry((from, to)).or_default().push(card);
    }

    pub fn trigger_changes_zone_all(
        &self,
        trigger_handler: &mut TriggerHandler,
        game: &GameState,
        cause: Option<&SpellAbility>,
    ) {
        if !self.created_tokens.is_empty() {
            trigger_handler.run_trigger(
                TriggerType::TokenCreatedOnce,
                RunParams {
                    cards: Some(self.created_tokens.clone()),
                    first_time_players: if self.first_time_token_creators.is_empty() {
                        None
                    } else {
                        Some(self.first_time_token_creators.clone())
                    },
                    ..Default::default()
                },
                false,
            );
        }
        if !self.data.is_empty() {
            let table = self.with_last_state(game);
            for &card_id in table.last_state_battlefield() {
                trigger_handler.register_active_ltb_trigger(game, card_id);
            }
            trigger_handler.run_trigger(
                TriggerType::ChangesZoneAll,
                RunParams {
                    cards: Some(table.all_cards()),
                    zone_changes: Some(table.zone_changes()),
                    change_zone_table: Some(table),
                    cause: cause.cloned(),
                    ..Default::default()
                },
                false,
            );
        }
    }

    pub fn filter_cards(
        &self,
        game: &GameState,
        origin: Option<&[ZoneType]>,
        destination: Option<&[ZoneType]>,
        valid: Option<&CompiledSelector>,
        source: CardId,
        source_controller: PlayerId,
    ) -> Vec<CardId> {
        let mut out = Vec::new();
        for (&(from, to), cards) in &self.data {
            if let Some(origins) = origin {
                if !origins.contains(&from) {
                    continue;
                }
            }
            if let Some(destinations) = destination {
                if !destinations.contains(&to) {
                    continue;
                }
            }
            out.extend(cards.iter().copied());
        }
        if let Some(filter) = valid {
            out.retain(|&cid| {
                valid_filter::matches_valid_card_selector_in_game(
                    filter,
                    game.card(cid),
                    game.card(source),
                    game,
                )
            });
        }
        let _ = source_controller;
        out
    }

    pub fn all_cards(&self) -> Vec<CardId> {
        self.data.values().flat_map(|v| v.iter().copied()).collect()
    }

    pub fn zone_changes(&self) -> Vec<ZoneChangeRecord> {
        let mut out = Vec::new();
        for (&(origin, destination), cards) in &self.data {
            for &card in cards {
                out.push(ZoneChangeRecord {
                    origin,
                    destination,
                    card,
                });
            }
        }
        out
    }

    pub fn add_token(&mut self, card: CardId, owner: PlayerId, first_time: bool) {
        self.created_tokens.push(card);
        if first_time && !self.first_time_token_creators.contains(&owner) {
            self.first_time_token_creators.push(owner);
        }
    }

    pub fn last_state_battlefield(&self) -> &[CardId] {
        &self.last_state_battlefield
    }

    pub fn last_state_graveyard(&self) -> &[CardId] {
        &self.last_state_graveyard
    }

    fn with_last_state(&self, game: &GameState) -> Self {
        let mut table = self.clone();
        table.last_state_battlefield = game.pre_sba_battlefield.clone();
        table.last_state_graveyard = game.cards_in_all_zones(ZoneType::Graveyard).collect();
        table
    }
}
