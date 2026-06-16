//! Card damage aggregation map.
//!
//! Mirrors the Java `CardDamageMap` behavior for accumulating damage from
//! source cards to card/player targets and emitting one-shot damage triggers.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::card::valid_filter;
use crate::event::RunParams;
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::parsing::cached_compiled_selector;
use crate::spellability::SpellAbility;
use crate::trigger::TriggerHandler;
use crate::trigger::TriggerType;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum DamageTarget {
    Card(CardId),
    Player(PlayerId),
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CardDamageMap {
    data: HashMap<CardId, HashMap<DamageTarget, i32>>,
}

impl CardDamageMap {
    /// Java parity: sum damage when the same source-target pair is inserted repeatedly.
    pub fn put(&mut self, source: CardId, target: DamageTarget, amount: i32) -> i32 {
        let by_target = self.data.entry(source).or_default();
        let prev = by_target.get(&target).copied().unwrap_or(0);
        by_target.insert(target, prev + amount);
        prev
    }

    pub fn total_amount(&self) -> i32 {
        self.data.values().flat_map(|m| m.values()).copied().sum()
    }

    pub fn entries(&self) -> Vec<(CardId, DamageTarget, i32)> {
        self.data
            .iter()
            .flat_map(|(&source, targets)| {
                targets
                    .iter()
                    .map(move |(&target, &amount)| (source, target, amount))
            })
            .collect()
    }

    /// Java parity subset of `filteredMap`.
    pub fn filtered_map(
        &self,
        game: &GameState,
        valid_source: Option<&str>,
        valid_target: Option<&str>,
        host: CardId,
    ) -> CardDamageMap {
        let host_card = game.card(host);
        let valid_source = valid_source.map(cached_compiled_selector);
        let valid_target = valid_target.map(cached_compiled_selector);
        let mut out = CardDamageMap::default();

        for (&source, targets) in &self.data {
            if let Some(valid) = valid_source.as_ref() {
                if !valid_filter::matches_valid_card_selector_in_game(
                    valid,
                    game.card(source),
                    host_card,
                    game,
                ) {
                    continue;
                }
            }

            for (&target, &amount) in targets {
                let target_ok = match (valid_target.as_ref(), target) {
                    (None, _) => true,
                    (Some(valid), DamageTarget::Card(cid)) => {
                        valid_filter::matches_valid_card_selector_in_game(
                            valid,
                            game.card(cid),
                            host_card,
                            game,
                        )
                    }
                    (Some(valid), DamageTarget::Player(pid)) => {
                        valid_filter::matches_valid_player_selector(
                            valid,
                            pid,
                            host_card.controller,
                        )
                    }
                };
                if target_ok {
                    out.put(source, target, amount);
                }
            }
        }
        out
    }

    pub fn trigger_prevent_damage(&self, trigger_handler: &mut TriggerHandler, is_combat: bool) {
        let mut by_target: HashMap<DamageTarget, i32> = HashMap::new();
        for targets in self.data.values() {
            for (&target, &amount) in targets {
                *by_target.entry(target).or_insert(0) += amount;
            }
        }

        for (target, amount) in by_target {
            if amount <= 0 {
                continue;
            }
            let params = match target {
                DamageTarget::Card(cid) => RunParams {
                    damage_target_card: Some(cid),
                    damage_amount: Some(amount),
                    is_combat_damage: Some(is_combat),
                    ..Default::default()
                },
                DamageTarget::Player(pid) => RunParams {
                    damage_target_player: Some(pid),
                    damage_amount: Some(amount),
                    is_combat_damage: Some(is_combat),
                    ..Default::default()
                },
            };
            trigger_handler.run_trigger(TriggerType::DamagePreventedOnce, params, false);
        }
    }

    pub fn trigger_damage_done_once(
        &self,
        game: &GameState,
        trigger_handler: &mut TriggerHandler,
        is_combat: bool,
    ) {
        // Source -> aggregate damage
        for (&source, targets) in &self.data {
            let sum: i32 = targets.values().copied().sum();
            if sum <= 0 {
                continue;
            }
            trigger_handler.run_trigger(
                TriggerType::DamageDealtOnce,
                RunParams {
                    damage_source: Some(source),
                    damage_amount: Some(sum),
                    is_combat_damage: Some(is_combat),
                    ..Default::default()
                },
                false,
            );
        }

        // Target -> aggregate damage
        let mut by_target: HashMap<DamageTarget, i32> = HashMap::new();
        let mut target_controllers: HashMap<DamageTarget, HashSet<PlayerId>> = HashMap::new();
        for (&source, targets) in &self.data {
            for (&target, &amount) in targets {
                *by_target.entry(target).or_insert(0) += amount;
                target_controllers
                    .entry(target)
                    .or_default()
                    .insert(game.card(source).controller);
            }
        }

        for (target, sum) in by_target {
            if sum <= 0 {
                continue;
            }

            let base = match target {
                DamageTarget::Card(cid) => RunParams {
                    damage_target_card: Some(cid),
                    damage_amount: Some(sum),
                    is_combat_damage: Some(is_combat),
                    ..Default::default()
                },
                DamageTarget::Player(pid) => RunParams {
                    damage_target_player: Some(pid),
                    damage_amount: Some(sum),
                    is_combat_damage: Some(is_combat),
                    ..Default::default()
                },
            };
            trigger_handler.run_trigger(TriggerType::DamageDoneOnce, base, false);

            if let Some(controllers) = target_controllers.get(&target) {
                for &controller in controllers {
                    let params = match target {
                        DamageTarget::Card(cid) => RunParams {
                            damage_target_card: Some(cid),
                            cause_player: Some(controller),
                            is_combat_damage: Some(is_combat),
                            ..Default::default()
                        },
                        DamageTarget::Player(pid) => RunParams {
                            damage_target_player: Some(pid),
                            cause_player: Some(controller),
                            is_combat_damage: Some(is_combat),
                            ..Default::default()
                        },
                    };
                    trigger_handler.run_trigger(TriggerType::DamageDoneOnce, params, false);
                }
            }
        }

        trigger_handler.run_trigger(
            TriggerType::DamageAll,
            RunParams {
                damage_amount: Some(self.total_amount()),
                is_combat_damage: Some(is_combat),
                ..Default::default()
            },
            false,
        );
    }

    /// Java parity subset of excess-damage trigger aggregation.
    pub fn trigger_excess_damage(
        &self,
        game: &GameState,
        trigger_handler: &mut TriggerHandler,
        is_combat: bool,
        lethal_damage: &HashMap<CardId, i32>,
        _cause: Option<&mut SpellAbility>,
    ) {
        for (&target_card, &lethal) in lethal_damage {
            let dealt: i32 = self
                .data
                .values()
                .map(|m| {
                    m.get(&DamageTarget::Card(target_card))
                        .copied()
                        .unwrap_or(0)
                })
                .sum();
            if dealt <= 0 {
                continue;
            }

            let deathtouch_threshold = if game.card(target_card).has_deathtouch_damage {
                1
            } else {
                lethal
            };
            let excess = dealt - deathtouch_threshold;
            if excess <= 0 {
                continue;
            }

            trigger_handler.run_trigger(
                TriggerType::ExcessDamage,
                RunParams {
                    damage_target_card: Some(target_card),
                    damage_amount: Some(excess),
                    is_combat_damage: Some(is_combat),
                    ..Default::default()
                },
                false,
            );
        }
    }
}
