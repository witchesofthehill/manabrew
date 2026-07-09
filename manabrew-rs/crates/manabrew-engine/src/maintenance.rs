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
        }
        self.check_state_based_actions();
    }
}
