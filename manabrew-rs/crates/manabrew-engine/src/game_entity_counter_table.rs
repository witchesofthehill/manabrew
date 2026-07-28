use std::collections::BTreeMap;

use crate::agent::{GameEntity, PlayerAgent};
use crate::card::CounterType;
use crate::event::{CounterTableEntry, RunParams};
use crate::game::GameState;
use crate::ids::PlayerId;
use crate::replacement::replacement_handler::{
    apply_replacements, apply_replacements_with_agents, CounterMapValue, ReplacementEvent,
};
use crate::replacement::ReplacementResult;
use crate::spellability::SpellAbility;
use crate::trigger::{TriggerHandler, TriggerType};

#[derive(Debug, Clone)]
struct CounterCell {
    source: Option<PlayerId>,
    object: GameEntity,
    counters: BTreeMap<CounterType, i32>,
}

#[derive(Debug, Clone, Default)]
pub struct GameEntityCounterTable {
    cells: Vec<CounterCell>,
}

impl GameEntityCounterTable {
    pub fn from_counter_map(
        object: GameEntity,
        counter_map: Vec<CounterMapValue>,
    ) -> GameEntityCounterTable {
        let mut table = GameEntityCounterTable::default();
        for entry in counter_map {
            for (counter_type, amount) in entry.counters {
                table.put(entry.source, object, counter_type, amount);
            }
        }
        table
    }

    pub fn put(
        &mut self,
        source: Option<PlayerId>,
        object: GameEntity,
        counter_type: CounterType,
        amount: i32,
    ) {
        if amount <= 0 {
            return;
        }
        if let Some(cell) = self
            .cells
            .iter_mut()
            .find(|cell| cell.source == source && cell.object == object)
        {
            *cell.counters.entry(counter_type).or_default() += amount;
        } else {
            self.cells.push(CounterCell {
                source,
                object,
                counters: BTreeMap::from([(counter_type, amount)]),
            });
        }
    }

    pub fn is_empty(&self) -> bool {
        self.cells.is_empty()
    }

    fn total_values(&self) -> i32 {
        self.cells
            .iter()
            .flat_map(|cell| cell.counters.values())
            .sum()
    }

    pub fn get(
        &self,
        source: Option<PlayerId>,
        object: GameEntity,
        counter_type: &CounterType,
    ) -> i32 {
        self.cells
            .iter()
            .find(|cell| cell.source == source && cell.object == object)
            .and_then(|cell| cell.counters.get(counter_type))
            .copied()
            .unwrap_or(0)
    }

    pub fn counters(game: &GameState, object: GameEntity) -> Vec<(CounterType, i32)> {
        match object {
            GameEntity::Card(card) => game
                .card(card)
                .counters
                .iter()
                .filter(|(_, amount)| **amount > 0)
                .map(|(counter_type, amount)| (counter_type.clone(), *amount))
                .collect(),
            GameEntity::Player(player) => {
                let player = game.player(player);
                [
                    (CounterType::Poison, player.poison_counters),
                    (
                        CounterType::Named("ENERGY".to_string()),
                        player.energy_counters,
                    ),
                    (
                        CounterType::Named("RAD".to_string()),
                        player.radiation_counters,
                    ),
                ]
                .into_iter()
                .filter(|(_, amount)| *amount > 0)
                .collect()
            }
        }
    }

    pub fn replace_counter_effect(
        &self,
        game: &mut GameState,
        trigger_handler: Option<&mut TriggerHandler>,
        agents: Option<&mut [Box<dyn PlayerAgent>]>,
        cause: Option<&SpellAbility>,
        is_effect: bool,
        params: RunParams,
    ) -> GameEntityCounterTable {
        self.apply_counter_effect(
            game,
            trigger_handler,
            agents,
            cause,
            is_effect,
            params,
            false,
        )
    }

    pub fn apply_replaced_counter_effect(
        &self,
        game: &mut GameState,
        trigger_handler: Option<&mut TriggerHandler>,
        cause: Option<&SpellAbility>,
        params: RunParams,
    ) -> GameEntityCounterTable {
        self.apply_counter_effect(game, trigger_handler, None, cause, true, params, true)
    }

    fn apply_counter_effect(
        &self,
        game: &mut GameState,
        mut trigger_handler: Option<&mut TriggerHandler>,
        mut agents: Option<&mut [Box<dyn PlayerAgent>]>,
        cause: Option<&SpellAbility>,
        is_effect: bool,
        params: RunParams,
        already_replaced: bool,
    ) -> GameEntityCounterTable {
        let remember_amount = self.total_values();
        let mut result = GameEntityCounterTable::default();
        let mut remembered_objects = Vec::new();
        let mut objects = Vec::new();
        for cell in &self.cells {
            if !objects.contains(&cell.object) {
                objects.push(cell.object);
            }
        }

        for object in objects {
            let first_time = matches!(object, GameEntity::Card(_))
                && game.counter_added_this_turn(object, None) == 0;
            let counter_map: Vec<_> = self
                .cells
                .iter()
                .filter(|cell| cell.object == object)
                .map(|cell| CounterMapValue {
                    source: cell.source,
                    counters: cell.counters.clone(),
                })
                .collect();
            let Some((source, counter_type, count)) = counter_map.iter().find_map(|entry| {
                entry
                    .counters
                    .iter()
                    .next()
                    .map(|(counter_type, amount)| (entry.source, counter_type.clone(), *amount))
            }) else {
                continue;
            };
            let mut event = ReplacementEvent::AddCounter {
                target: object,
                source,
                counter_type,
                count,
                counter_map,
                after_replacement_static_abilities: Vec::new(),
                cause: cause.cloned().map(Box::new),
                is_effect,
            };
            let replacement_result = if already_replaced {
                ReplacementResult::NotReplaced
            } else {
                match agents.as_deref_mut() {
                    Some(agents) => apply_replacements_with_agents(game, agents, &mut event),
                    None => apply_replacements(game, &mut event),
                }
            };
            if matches!(
                replacement_result,
                ReplacementResult::NotReplaced | ReplacementResult::Updated
            ) {
                let ReplacementEvent::AddCounter {
                    counter_map,
                    after_replacement_static_abilities,
                    ..
                } = event
                else {
                    continue;
                };
                for entry in counter_map {
                    for (counter_type, count) in entry.counters {
                        let count = match (object, cause.and_then(|cause| cause.ir.max_from_effect))
                        {
                            (GameEntity::Card(card), Some(max)) => {
                                (max - game.card(card).counter_count(&counter_type)).clamp(0, count)
                            }
                            _ => count,
                        };
                        let added = add_counter_internal(
                            game,
                            trigger_handler.as_deref_mut(),
                            object,
                            entry.source,
                            &counter_type,
                            count,
                            cause,
                            params.clone(),
                        );
                        if added > 0 {
                            result.put(entry.source, object, counter_type, added);
                            if cause.is_some_and(|cause| cause.ir.remember_put)
                                && !remembered_objects.contains(&object)
                            {
                                remembered_objects.push(object);
                            }
                        }
                    }
                }
                for (source, static_abilities) in after_replacement_static_abilities {
                    crate::replacement::replace_add_counter::apply_after_replacement_static_abilities(
                        game,
                        source,
                        static_abilities,
                    );
                }
            }
            if result.cells.iter().any(|cell| cell.object == object) {
                if let Some(handler) = trigger_handler.as_deref_mut() {
                    handler.run_trigger(
                        TriggerType::CounterTypeAddedAll,
                        object_params(
                            object,
                            RunParams {
                                first_time: Some(first_time),
                                ..Default::default()
                            },
                        ),
                        false,
                    );
                }
            }
        }

        if let Some(source) = cause.and_then(|cause| cause.source) {
            for object in remembered_objects {
                match object {
                    GameEntity::Card(card) => game.card_mut(source).add_remembered_card(card),
                    GameEntity::Player(player) => {
                        game.card_mut(source).add_remembered_player(player)
                    }
                }
            }
            if cause.is_some_and(|cause| cause.ir.remember_amount) && remember_amount > 0 {
                game.card_mut(source).add_remembered_cmc(remember_amount);
            }
        }

        if let Some(handler) = trigger_handler {
            result.trigger_counters_put_all(handler);
        }
        result
    }

    fn trigger_counters_put_all(&self, trigger_handler: &mut TriggerHandler) {
        if self.is_empty() {
            return;
        }
        for cell in &self.cells {
            let counter_map = counter_map(&cell.counters);
            trigger_handler.run_trigger(
                TriggerType::CounterPlayerAddedAll,
                object_params(
                    cell.object,
                    RunParams {
                        source_player: cell.source,
                        counter_amount: Some(cell.counters.values().sum()),
                        counter_map: Some(counter_map),
                        ..Default::default()
                    },
                ),
                false,
            );
        }
        trigger_handler.run_trigger(
            TriggerType::CounterAddedAll,
            RunParams {
                counter_table: Some(self.entries()),
                ..Default::default()
            },
            false,
        );
    }

    fn entries(&self) -> Vec<CounterTableEntry> {
        self.cells
            .iter()
            .map(|cell| CounterTableEntry {
                source: cell.source,
                object_card: match cell.object {
                    GameEntity::Card(card) => Some(card),
                    GameEntity::Player(_) => None,
                },
                object_player: match cell.object {
                    GameEntity::Player(player) => Some(player),
                    GameEntity::Card(_) => None,
                },
                counters: counter_map(&cell.counters),
            })
            .collect()
    }
}

fn add_counter_internal(
    game: &mut GameState,
    trigger_handler: Option<&mut TriggerHandler>,
    object: GameEntity,
    source: Option<PlayerId>,
    counter_type: &CounterType,
    amount: i32,
    cause: Option<&SpellAbility>,
    mut params: RunParams,
) -> i32 {
    if amount <= 0 || !can_receive_counter(game, object, counter_type) {
        return 0;
    }
    let old_value = counter_count(game, object, counter_type);
    let amount = match object {
        GameEntity::Card(card) => {
            if let Some(max) = crate::staticability::static_ability_max_counter::max_counter(
                &game.cards,
                game.card(card),
                counter_type,
            ) {
                (max - old_value).clamp(0, amount)
            } else {
                amount
            }
        }
        GameEntity::Player(_) => amount,
    };
    if amount <= 0 {
        return 0;
    }

    let first_time = game.counter_added_this_turn(object, Some(counter_type)) == 0;
    match object {
        GameEntity::Card(card) => game
            .card_mut(card)
            .add_counter_internal(counter_type, amount),
        GameEntity::Player(player) => add_player_counter(game, player, counter_type, amount),
    }
    let new_value = counter_count(game, object, counter_type);
    let added = new_value - old_value;
    if added <= 0 {
        return 0;
    }
    game.record_counter_added(object, counter_type, added);

    if let Some(trigger_handler) = trigger_handler {
        params = object_params(object, params);
        params.source_player = source;
        params.cause = cause.cloned();
        params.counter_type = Some(counter_type.to_string());
        for counter_amount in (old_value + 1)..=new_value {
            params.counter_amount = Some(counter_amount);
            trigger_handler.run_trigger(TriggerType::CounterAdded, params.clone(), false);
        }
        params.counter_amount = Some(added);
        params.first_time = match object {
            GameEntity::Card(_) => Some(first_time),
            GameEntity::Player(_) => None,
        };
        trigger_handler.run_trigger(TriggerType::CounterAddedOnce, params, false);
    }
    added
}

fn can_receive_counter(game: &GameState, object: GameEntity, counter_type: &CounterType) -> bool {
    match object {
        GameEntity::Card(card) => {
            !game.card(card).phased_out
                && !crate::staticability::static_ability_cant_put_counter::any_cant_put_counter_on_card(
                    &game.cards,
                    game.card(card),
                    counter_type,
                )
        }
        GameEntity::Player(player) => {
            !game.player(player).has_lost
                && !crate::staticability::static_ability_cant_put_counter::any_cant_put_counter_on_player(
                    &game.cards,
                    player,
                    counter_type,
                )
        }
    }
}

fn counter_count(game: &GameState, object: GameEntity, counter_type: &CounterType) -> i32 {
    match object {
        GameEntity::Card(card) => game.card(card).counter_count(counter_type),
        GameEntity::Player(player) => match counter_type {
            CounterType::Poison => game.player(player).poison_counters,
            CounterType::Named(name) if name == "ENERGY" => game.player(player).energy_counters,
            CounterType::Named(name) if name == "RAD" => game.player(player).radiation_counters,
            _ => 0,
        },
    }
}

fn add_player_counter(
    game: &mut GameState,
    player: PlayerId,
    counter_type: &CounterType,
    amount: i32,
) {
    match counter_type {
        CounterType::Poison => game.player_add_poison(player, amount),
        CounterType::Named(name) if name == "ENERGY" => game.player_add_energy(player, amount),
        CounterType::Named(name) if name == "RAD" => {
            game.player_mut(player).radiation_counters += amount;
        }
        _ => {}
    }
}

fn object_params(object: GameEntity, mut params: RunParams) -> RunParams {
    match object {
        GameEntity::Card(card) => {
            params.card = Some(card);
            params.object_card = Some(card);
        }
        GameEntity::Player(player) => {
            params.player = Some(player);
            params.object_player = Some(player);
        }
    }
    params
}

fn counter_map(counters: &BTreeMap<CounterType, i32>) -> BTreeMap<String, i32> {
    counters
        .iter()
        .map(|(counter_type, amount)| (counter_type.to_string(), *amount))
        .collect()
}
