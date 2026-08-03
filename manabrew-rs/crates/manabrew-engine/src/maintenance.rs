use std::collections::HashMap;

use forge_foundation::ZoneType;

use crate::card::counter_type::CounterType;
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MaintenanceEdit {
    SetLife {
        player: PlayerId,
        life: i32,
    },
    SetPoison {
        player: PlayerId,
        poison: i32,
    },
    AddCardCounter {
        card: CardId,
        counter: CounterType,
        amount: i32,
    },
    SetTapped {
        card: CardId,
        tapped: bool,
    },
    MoveCard {
        card: CardId,
        zone: ZoneType,
        owner: PlayerId,
    },
    SetZone {
        player: PlayerId,
        zone: ZoneType,
        card_names: Vec<String>,
    },
}

impl GameState {
    pub fn apply_maintenance_edit(&mut self, edit: &MaintenanceEdit) {
        match edit {
            MaintenanceEdit::SetLife { player, life } => {
                self.player_mut(*player).life = *life;
            }
            MaintenanceEdit::SetPoison { player, poison } => {
                self.player_mut(*player).poison_counters = *poison;
            }
            MaintenanceEdit::AddCardCounter {
                card,
                counter,
                amount,
            } => {
                self.card_mut(*card).add_counter(counter, *amount);
            }
            MaintenanceEdit::SetTapped { card, tapped } => {
                self.card_mut(*card).set_tapped(*tapped);
            }
            MaintenanceEdit::MoveCard { card, zone, owner } => {
                self.move_card(*card, *zone, *owner);
            }
            MaintenanceEdit::SetZone {
                player,
                zone,
                card_names,
            } => {
                self.set_zone_contents(*player, *zone, card_names);
            }
        }
        self.check_state_based_actions();
    }

    fn set_zone_contents(&mut self, player: PlayerId, zone: ZoneType, target_names: &[String]) {
        let mut needed: HashMap<String, i32> = HashMap::new();
        for name in target_names {
            *needed.entry(name.clone()).or_default() += 1;
        }

        for cid in self.cards_in_zone(zone, player).to_vec() {
            let name = self.card(cid).card_name.clone();
            match needed.get_mut(&name) {
                Some(count) if *count > 0 => *count -= 1,
                _ => {
                    if zone != ZoneType::Library {
                        self.move_card(cid, ZoneType::Library, player);
                    }
                }
            }
        }

        let sources = [
            ZoneType::Library,
            ZoneType::Hand,
            ZoneType::Graveyard,
            ZoneType::Exile,
            ZoneType::Command,
            ZoneType::Battlefield,
        ];
        let deficit: Vec<(String, i32)> =
            needed.into_iter().filter(|(_, count)| *count > 0).collect();
        for (name, count) in deficit {
            for _ in 0..count {
                let Some(cid) = self.find_owned_card_by_name(player, &name, zone, &sources) else {
                    break;
                };
                self.move_card(cid, zone, player);
            }
        }
    }

    fn find_owned_card_by_name(
        &self,
        player: PlayerId,
        name: &str,
        exclude: ZoneType,
        sources: &[ZoneType],
    ) -> Option<CardId> {
        for &source in sources {
            if source == exclude {
                continue;
            }
            if let Some(&cid) = self
                .cards_in_zone(source, player)
                .iter()
                .find(|&&cid| self.card(cid).card_name == name)
            {
                return Some(cid);
            }
        }
        None
    }
}
