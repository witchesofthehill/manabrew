use rand::seq::SliceRandom;

use crate::ability::ability_utils;
use crate::card::valid_filter;
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::parsing::cached_compiled_selector;
use crate::spellability::SpellAbility;

/// Port of common `CardLists` utilities used by card filtering/counting code.
pub struct CardLists;

impl CardLists {
    pub fn filter_toughness(
        game: &GameState,
        cards: &[CardId],
        at_least_toughness: i32,
    ) -> Vec<CardId> {
        cards
            .iter()
            .copied()
            .filter(|&cid| game.card(cid).toughness() <= at_least_toughness)
            .collect()
    }

    pub fn filter_power(game: &GameState, cards: &[CardId], at_least_power: i32) -> Vec<CardId> {
        cards
            .iter()
            .copied()
            .filter(|&cid| game.card(cid).power() >= at_least_power)
            .collect()
    }

    pub fn filter_le_power(
        game: &GameState,
        cards: &[CardId],
        less_than_power: i32,
    ) -> Vec<CardId> {
        cards
            .iter()
            .copied()
            .filter(|&cid| game.card(cid).power() <= less_than_power)
            .collect()
    }

    pub fn filter_any_counters(
        game: &GameState,
        cards: &[CardId],
        at_least_counters: i32,
    ) -> Vec<CardId> {
        cards
            .iter()
            .copied()
            .filter(|&cid| {
                game.card(cid).counters.values().copied().sum::<i32>() >= at_least_counters
            })
            .collect()
    }

    pub fn sort_by_cmc_desc(game: &GameState, list: &mut [CardId]) {
        list.sort_by_key(|&cid| -game.card(cid).mana_value());
    }

    pub fn sort_by_toughness_asc(game: &GameState, list: &mut [CardId]) {
        list.sort_by_key(|&cid| game.card(cid).toughness());
    }

    pub fn sort_by_toughness_desc(game: &GameState, list: &mut [CardId]) {
        list.sort_by_key(|&cid| -game.card(cid).toughness());
    }

    pub fn sort_by_power_asc(game: &GameState, list: &mut [CardId]) {
        list.sort_by_key(|&cid| game.card(cid).power());
    }

    pub fn sort_by_power_desc(game: &GameState, list: &mut [CardId]) {
        list.sort_by_key(|&cid| -game.card(cid).power());
    }

    pub fn shuffle(list: &mut [CardId]) {
        let mut rng = rand::thread_rng();
        list.shuffle(&mut rng);
    }

    pub fn filter_controlled_by(
        game: &GameState,
        cards: &[CardId],
        player: PlayerId,
    ) -> Vec<CardId> {
        cards
            .iter()
            .copied()
            .filter(|&cid| game.card(cid).controller == player)
            .collect()
    }

    pub fn filter_controlled_by_as_list(
        game: &GameState,
        cards: &[CardId],
        players: &[PlayerId],
    ) -> Vec<CardId> {
        cards
            .iter()
            .copied()
            .filter(|&cid| players.contains(&game.card(cid).controller))
            .collect()
    }

    pub fn can_subsequently_target(
        game: &GameState,
        cards: &[CardId],
        source: &SpellAbility,
    ) -> Vec<CardId> {
        let targets = source.get_targets();
        if targets.target_card.is_none()
            && targets.target_player.is_none()
            && targets.target_stack_entry.is_none()
        {
            return cards.to_vec();
        }
        cards
            .iter()
            .copied()
            .filter(|&cid| {
                let player = source.targeting_player.unwrap_or(source.activating_player);
                crate::spellability::target_restrictions::can_be_targeted_by_sa(
                    game, cid, player, source,
                )
            })
            .collect()
    }

    pub fn test(game: &GameState, card: CardId, source: &SpellAbility) -> bool {
        let player = source.targeting_player.unwrap_or(source.activating_player);
        crate::spellability::target_restrictions::can_be_targeted_by_sa(game, card, player, source)
    }

    pub fn filter(
        _game: &GameState,
        cards: &[CardId],
        filt: impl Fn(CardId) -> bool,
    ) -> Vec<CardId> {
        cards.iter().copied().filter(|&cid| filt(cid)).collect()
    }

    pub fn filter_as_list(
        game: &GameState,
        cards: &[CardId],
        restriction: &str,
        source_controller: PlayerId,
    ) -> Vec<CardId> {
        cards
            .iter()
            .copied()
            .filter(|&cid| {
                ability_utils::matches_valid_cards(game.card(cid), restriction, source_controller)
            })
            .collect()
    }

    pub fn count(
        game: &GameState,
        cards: &[CardId],
        restriction: &str,
        source_controller: PlayerId,
    ) -> usize {
        Self::filter_as_list(game, cards, restriction, source_controller).len()
    }

    pub fn filter_as_list_with_source(
        game: &GameState,
        cards: &[CardId],
        restriction: &str,
        source: CardId,
    ) -> Vec<CardId> {
        let selector = cached_compiled_selector(restriction);
        cards
            .iter()
            .copied()
            .filter(|&cid| {
                valid_filter::matches_valid_card_selector_in_game(
                    &selector,
                    game.card(cid),
                    game.card(source),
                    game,
                )
            })
            .collect()
    }

    pub fn count_with_source(
        game: &GameState,
        cards: &[CardId],
        restriction: &str,
        source: CardId,
    ) -> usize {
        Self::filter_as_list_with_source(game, cards, restriction, source).len()
    }

    pub fn cmc_can_sum_to(sum: i32, cards: &[CardId], game: &GameState) -> bool {
        let mut nums = Vec::new();
        for &cid in cards {
            let cmc = game.card(cid).mana_value();
            if cmc == sum {
                return true;
            }
            if cmc < sum {
                nums.push(cmc);
            }
        }
        if nums.is_empty() {
            return false;
        }
        nums.sort_unstable();
        Self::subset_sum(&nums, sum)
    }

    fn subset_sum(nums: &[i32], sum: i32) -> bool {
        if sum == 0 {
            return true;
        }
        if nums.is_empty() || sum < 0 {
            return false;
        }
        let (last, rest) = nums.split_last().expect("split_last on non-empty slice");
        if *last > sum {
            return Self::subset_sum(rest, sum);
        }
        Self::subset_sum(rest, sum) || Self::subset_sum(rest, sum - *last)
    }
}
