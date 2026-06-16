use serde::{Deserialize, Serialize};

use crate::ids::PlayerId;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RegisteredPlayerVariant {
    Archenemy,
    ArchenemyRumble,
    Commander,
    Oathbreaker,
    TinyLeaders,
    Brawl,
    Planechase,
    Vanguard,
    MomirBasic,
    MoJhoSto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisteredPlayer {
    pub id: Option<PlayerId>,
    pub name: String,
    pub original_deck: Vec<String>,
    pub current_deck: Vec<String>,
    pub starting_life: i32,
    pub starting_hand: i32,
    pub max_hand_size: i32,
    pub mana_shards: i32,
    pub team_number: i32,
    pub cards_on_battlefield: Vec<String>,
    pub extra_cards_on_battlefield: Vec<String>,
    pub extra_cards_in_command_zone: Vec<String>,
    pub schemes: Vec<String>,
    pub planes: Vec<String>,
    pub conspiracies: Vec<String>,
    pub attractions: Vec<String>,
    pub contraptions: Vec<String>,
    pub commanders: Vec<String>,
    pub vanguard_avatars: Vec<String>,
    pub planeswalker: Option<String>,
    pub random_foil: bool,
    pub enable_etb_counters_effect: bool,
    pub commander_damage_enabled: bool,
}

impl RegisteredPlayer {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            id: None,
            name: name.into(),
            original_deck: Vec::new(),
            current_deck: Vec::new(),
            starting_life: 20,
            starting_hand: 7,
            max_hand_size: 7,
            mana_shards: 0,
            team_number: -1,
            cards_on_battlefield: Vec::new(),
            extra_cards_on_battlefield: Vec::new(),
            extra_cards_in_command_zone: Vec::new(),
            schemes: Vec::new(),
            planes: Vec::new(),
            conspiracies: Vec::new(),
            attractions: Vec::new(),
            contraptions: Vec::new(),
            commanders: Vec::new(),
            vanguard_avatars: Vec::new(),
            planeswalker: None,
            random_foil: false,
            enable_etb_counters_effect: false,
            commander_damage_enabled: true,
        }
    }

    pub fn for_commander(name: impl Into<String>, commanders: Vec<String>) -> Self {
        let mut rp = Self::new(name);
        rp.starting_life = 40;
        rp.commanders = commanders;
        rp
    }

    pub fn has_enable_etb_counters_effect(&self) -> bool {
        self.enable_etb_counters_effect
    }

    pub fn cards_on_battlefield(&self) -> impl Iterator<Item = &String> {
        self.cards_on_battlefield
            .iter()
            .chain(self.extra_cards_on_battlefield.iter())
    }

    pub fn command_zone_cards(&self) -> impl Iterator<Item = &String> {
        self.extra_cards_in_command_zone
            .iter()
            .chain(self.commanders.iter())
    }

    pub fn add_extra_cards_on_battlefield<I>(&mut self, cards: I)
    where
        I: IntoIterator<Item = String>,
    {
        self.extra_cards_on_battlefield.extend(cards);
    }

    pub fn add_extra_cards_in_command_zone<I>(&mut self, cards: I)
    where
        I: IntoIterator<Item = String>,
    {
        self.extra_cards_in_command_zone.extend(cards);
    }

    pub fn assign_conspiracies<I>(&mut self, cards: I)
    where
        I: IntoIterator<Item = String>,
    {
        self.conspiracies = cards.into_iter().collect();
    }

    pub fn for_variants(
        name: impl Into<String>,
        commanders: Vec<String>,
        schemes: Vec<String>,
        planes: Vec<String>,
        vanguard_avatars: Vec<String>,
    ) -> Self {
        let mut rp = Self::new(name);
        if !commanders.is_empty() {
            rp.apply_variants(&[RegisteredPlayerVariant::Commander], false, &commanders);
        }
        rp.schemes = schemes;
        rp.planes = planes;
        rp.assign_vanguard_avatar(vanguard_avatars);
        rp
    }

    pub fn for_variant_set(
        name: impl Into<String>,
        variants: &[RegisteredPlayerVariant],
        commanders: Vec<String>,
        schemes: Vec<String>,
        player_is_archenemy: bool,
        planes: Vec<String>,
        vanguard_avatars: Vec<String>,
    ) -> Self {
        let mut rp = Self::new(name);
        rp.apply_variants(variants, player_is_archenemy, &commanders);
        rp.schemes = if variants.contains(&RegisteredPlayerVariant::Archenemy)
            || variants.contains(&RegisteredPlayerVariant::ArchenemyRumble)
        {
            schemes
        } else {
            Vec::new()
        };
        if variants.contains(&RegisteredPlayerVariant::Planechase) {
            rp.planes = planes;
        }
        if variants.iter().any(|variant| {
            matches!(
                variant,
                RegisteredPlayerVariant::Vanguard
                    | RegisteredPlayerVariant::MomirBasic
                    | RegisteredPlayerVariant::MoJhoSto
            )
        }) {
            rp.assign_vanguard_avatar(vanguard_avatars);
        }
        rp
    }

    pub fn apply_variants(
        &mut self,
        variants: &[RegisteredPlayerVariant],
        player_is_archenemy: bool,
        commanders: &[String],
    ) {
        self.commander_damage_enabled = true;
        for variant in variants {
            match variant {
                RegisteredPlayerVariant::Archenemy if player_is_archenemy => {
                    self.starting_life = 40;
                }
                RegisteredPlayerVariant::ArchenemyRumble => {
                    self.starting_life = 40;
                }
                RegisteredPlayerVariant::Commander => {
                    self.commanders = commanders.to_vec();
                    self.starting_life += 20;
                }
                RegisteredPlayerVariant::Oathbreaker => {
                    self.commanders = commanders.to_vec();
                    self.commander_damage_enabled = false;
                }
                RegisteredPlayerVariant::TinyLeaders => {
                    self.commanders = commanders.to_vec();
                    self.starting_life += 5;
                    self.commander_damage_enabled = false;
                }
                RegisteredPlayerVariant::Brawl => {
                    self.commanders = commanders.to_vec();
                    self.starting_life += 10;
                    self.commander_damage_enabled = false;
                }
                RegisteredPlayerVariant::Planechase
                | RegisteredPlayerVariant::Vanguard
                | RegisteredPlayerVariant::MomirBasic
                | RegisteredPlayerVariant::MoJhoSto
                | RegisteredPlayerVariant::Archenemy => {}
            }
        }
    }

    pub fn assign_commander<I>(&mut self, commanders: I)
    where
        I: IntoIterator<Item = String>,
    {
        self.commanders = commanders.into_iter().collect();
    }

    pub fn assign_vanguard_avatar<I>(&mut self, avatars: I)
    where
        I: IntoIterator<Item = String>,
    {
        self.vanguard_avatars = avatars.into_iter().collect();
        if !self.vanguard_avatars.is_empty() {
            self.starting_life += self.vanguard_avatars.len() as i32;
            self.starting_hand += self.vanguard_avatars.len() as i32;
            self.max_hand_size = self.max_hand_size.max(self.starting_hand);
        }
    }

    pub fn restore_deck(&mut self) {
        self.current_deck = self.original_deck.clone();
    }

    pub fn use_random_foil(&mut self, value: bool) {
        self.random_foil = value;
    }

    pub fn set_cards_on_battlefield<I>(&mut self, cards: I)
    where
        I: IntoIterator<Item = String>,
    {
        self.cards_on_battlefield = cards.into_iter().collect();
    }

    pub fn set_schemes<I>(&mut self, cards: I)
    where
        I: IntoIterator<Item = String>,
    {
        self.schemes = cards.into_iter().collect();
    }

    pub fn set_planes<I>(&mut self, cards: I)
    where
        I: IntoIterator<Item = String>,
    {
        self.planes = cards.into_iter().collect();
    }

    pub fn set_attractions<I>(&mut self, cards: I)
    where
        I: IntoIterator<Item = String>,
    {
        self.attractions = cards.into_iter().collect();
    }

    pub fn set_contraptions<I>(&mut self, cards: I)
    where
        I: IntoIterator<Item = String>,
    {
        self.contraptions = cards.into_iter().collect();
    }
}

#[cfg(test)]
mod tests {
    use super::{RegisteredPlayer, RegisteredPlayerVariant};

    #[test]
    fn variant_set_applies_commander_family_life_rules() {
        let rp = RegisteredPlayer::for_variant_set(
            "Alice",
            &[
                RegisteredPlayerVariant::Commander,
                RegisteredPlayerVariant::Planechase,
            ],
            vec!["A".to_string()],
            vec![],
            false,
            vec!["Plane".to_string()],
            vec![],
        );
        assert_eq!(rp.starting_life, 40);
        assert_eq!(rp.commanders, vec!["A".to_string()]);
        assert_eq!(rp.planes, vec!["Plane".to_string()]);
        assert!(rp.commander_damage_enabled);
    }

    #[test]
    fn oathbreaker_style_variants_disable_commander_damage_loss() {
        for variant in [
            RegisteredPlayerVariant::Oathbreaker,
            RegisteredPlayerVariant::TinyLeaders,
            RegisteredPlayerVariant::Brawl,
        ] {
            let rp = RegisteredPlayer::for_variant_set(
                "Alice",
                &[variant],
                vec!["Commander".to_string()],
                vec![],
                false,
                vec![],
                vec![],
            );
            assert!(!rp.commander_damage_enabled);
            assert_eq!(rp.commanders, vec!["Commander".to_string()]);
        }
    }
}
