use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::player::player_predicates;
use forge_foundation::ZoneType;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PlayerCollection(pub Vec<PlayerId>);

impl IntoIterator for PlayerCollection {
    type Item = PlayerId;
    type IntoIter = std::vec::IntoIter<PlayerId>;

    fn into_iter(self) -> Self::IntoIter {
        self.0.into_iter()
    }
}

impl<'a> IntoIterator for &'a PlayerCollection {
    type Item = &'a PlayerId;
    type IntoIter = std::slice::Iter<'a, PlayerId>;

    fn into_iter(self) -> Self::IntoIter {
        self.0.iter()
    }
}

impl PlayerCollection {
    pub fn new(players: Vec<PlayerId>) -> Self {
        Self(players)
    }

    pub fn alive(game: &GameState) -> Self {
        Self(game.alive_players())
    }

    pub fn opponents_of(game: &GameState, player: PlayerId) -> Self {
        Self(
            game.player_order
                .iter()
                .copied()
                .filter(|&pid| player_predicates::is_opponent_of(game, player, pid))
                .collect(),
        )
    }

    pub fn teammates_of(game: &GameState, player: PlayerId) -> Self {
        Self(
            game.player_order
                .iter()
                .copied()
                .filter(|&pid| player_predicates::same_team(game, player, pid))
                .collect(),
        )
    }

    pub fn contains(&self, player: PlayerId) -> bool {
        self.0.contains(&player)
    }

    pub fn cards_in(&self, game: &GameState, zone: ZoneType) -> Vec<CardId> {
        self.0
            .iter()
            .flat_map(|&pid| game.cards_in_zone(zone, pid).iter().copied())
            .collect()
    }

    pub fn cards_in_zones(
        &self,
        game: &GameState,
        zones: impl IntoIterator<Item = ZoneType>,
    ) -> Vec<CardId> {
        zones
            .into_iter()
            .flat_map(|zone| self.cards_in(game, zone))
            .collect()
    }

    pub fn creatures_in_play(&self, game: &GameState) -> Vec<CardId> {
        self.cards_in(game, ZoneType::Battlefield)
            .into_iter()
            .filter(|&cid| game.card(cid).is_creature())
            .collect()
    }

    pub fn filter<F>(&self, predicate: F) -> Self
    where
        F: Fn(PlayerId) -> bool,
    {
        Self(
            self.0
                .iter()
                .copied()
                .filter(|&pid| predicate(pid))
                .collect(),
        )
    }

    pub fn min<F>(&self, score: F) -> Option<PlayerId>
    where
        F: Fn(PlayerId) -> i32,
    {
        self.0.iter().copied().min_by_key(|&pid| score(pid))
    }

    pub fn max<F>(&self, score: F) -> Option<PlayerId>
    where
        F: Fn(PlayerId) -> i32,
    {
        self.0.iter().copied().max_by_key(|&pid| score(pid))
    }

    pub fn sum<F>(&self, score: F) -> i32
    where
        F: Fn(PlayerId) -> i32,
    {
        self.0.iter().copied().map(score).sum()
    }
}
