use forge_foundation::ZoneType;

use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::player::player_factory_util::{
    add_replacement_effect, add_static_ability, new_player_effect_card,
};
use crate::trigger::handler::TriggerHandler;

impl GameState {
    pub fn player_register_commander(&mut self, player: PlayerId, commander: CardId) {
        if !self.player(player).commanders.contains(&commander) {
            self.player_mut(player).commanders.push(commander);
        }
        self.card_mut(commander).is_commander = true;
        self.card_mut(commander).move_to_command_zone = false;
        let count = self
            .player(player)
            .commander_casts
            .get(&commander.0)
            .copied()
            .unwrap_or(0);
        self.card_mut(commander).commander_cast_count = count;
    }

    pub fn player_remove_commander(&mut self, player: PlayerId, commander: CardId) {
        self.player_mut(player)
            .commanders
            .retain(|&id| id != commander);
        self.player_mut(player).commander_casts.remove(&commander.0);
        self.player_mut(player)
            .commander_damage_received
            .remove(&commander.0);
        self.card_mut(commander).is_commander = false;
        self.card_mut(commander).move_to_command_zone = false;
        self.card_mut(commander).commander_cast_count = 0;
    }

    pub fn player_reset_commander_state(&mut self, player: PlayerId) {
        let commanders = self.player(player).commanders.clone();
        for commander in commanders {
            self.card_mut(commander).is_commander = false;
            self.card_mut(commander).move_to_command_zone = false;
            self.card_mut(commander).commander_cast_count = 0;
        }
        self.player_mut(player).commanders.clear();
        self.player_mut(player).commander_casts.clear();
        self.player_mut(player).commander_damage_received.clear();
        self.player_remove_commander_effect(player);
    }

    pub fn player_registered_commanders(&self, player: PlayerId) -> &[CardId] {
        &self.player(player).commanders
    }

    pub fn player_is_commander(&self, player: PlayerId, card: CardId) -> bool {
        self.player(player).commanders.contains(&card) || self.card(card).is_commander
    }

    pub fn player_commander_cast_count(&self, player: PlayerId, commander: CardId) -> u32 {
        if let Some(v) = self.player(player).commander_casts.get(&commander.0) {
            *v
        } else {
            self.card(commander).commander_cast_count
        }
    }

    pub fn player_commander_tax(&self, player: PlayerId, commander: CardId) -> i32 {
        (self.player_commander_cast_count(player, commander) as i32) * 2
    }

    pub fn player_total_commander_casts(&self, player: PlayerId) -> u32 {
        self.player(player).commander_casts.values().copied().sum()
    }

    pub fn player_increment_commander_cast(&mut self, player: PlayerId, commander: CardId) {
        let next = self.player_commander_cast_count(player, commander) + 1;
        self.player_mut(player)
            .commander_casts
            .insert(commander.0, next);
        self.card_mut(commander).commander_cast_count = next;
    }

    pub fn player_commander_color_identity(&self, player: PlayerId) -> Vec<String> {
        let mut colors = Vec::new();
        for &commander in self.player_registered_commanders(player) {
            for color in self.card(commander).color_identity.iter() {
                let name = color.long_name();
                let mut chars = name.chars();
                let Some(first) = chars.next() else {
                    continue;
                };
                let formatted = first.to_uppercase().collect::<String>() + chars.as_str();
                if !colors.contains(&formatted) {
                    colors.push(formatted);
                }
            }
        }
        colors
    }

    pub fn player_create_commander_effect(
        &mut self,
        player: PlayerId,
        _trigger_handler: Option<&mut TriggerHandler>,
    ) -> Option<CardId> {
        if self.player(player).commanders.is_empty() {
            self.player_remove_commander_effect(player);
            return None;
        }
        if let Some(effect_id) = self.player(player).commander_effect_card {
            return Some(effect_id);
        }

        let mut effect = new_player_effect_card(player, "Commander Effect", None);
        add_replacement_effect(
            &mut effect,
            "R$ Event$ Moved | ActiveZones$ Command | ValidCard$ Card.IsCommander+YouOwn | Secondary$ True | Optional$ True | OptionalDecider$ You | CommanderMoveReplacement$ True | Destination$ Hand,Library | NewDestination$ Command | Description$ If a commander would be put into its owner's hand or library from anywhere, its owner may put it into the command zone instead.",
        );
        add_static_ability(
            &mut effect,
            "S$ Mode$ Continuous | EffectZone$ Command | MayPlay$ True | Affected$ Card.IsCommander+YouOwn | AffectedZone$ Command",
        );

        let effect_id = self.create_card(effect);
        self.move_card(effect_id, ZoneType::Command, player);
        self.player_mut(player).commander_effect_card = Some(effect_id);
        Some(effect_id)
    }

    pub fn player_set_commander_replacement_suppressed(
        &mut self,
        player: PlayerId,
        suppressed: bool,
    ) {
        let Some(effect_id) = self.player(player).commander_effect_card else {
            return;
        };
        for replacement in &mut self.card_mut(effect_id).replacement_effects {
            replacement.suppressed = suppressed;
        }
    }

    pub fn player_remove_commander_effect(&mut self, player: PlayerId) {
        let Some(effect_id) = self.player(player).commander_effect_card else {
            return;
        };
        if self.card(effect_id).zone == ZoneType::Command {
            self.remove_card_from_zone(ZoneType::Command, player, effect_id);
        }
        self.card_mut(effect_id).zone = ZoneType::None;
        self.player_mut(player).commander_effect_card = None;
    }

    pub fn initialize_player_commanders_from_registered(
        &mut self,
        player: PlayerId,
        registered: &crate::player::RegisteredPlayer,
        trigger_handler: Option<&mut TriggerHandler>,
    ) {
        self.player_reset_commander_state(player);
        if registered.commanders.is_empty() {
            return;
        }
        let command_cards: Vec<CardId> = self.cards_in_zone(ZoneType::Command, player).to_vec();
        for commander_name in &registered.commanders {
            if let Some(card_id) = command_cards
                .iter()
                .copied()
                .find(|&cid| self.card(cid).card_name == *commander_name)
            {
                self.player_register_commander(player, card_id);
            }
        }
        self.player_create_commander_effect(player, trigger_handler);
    }
}
