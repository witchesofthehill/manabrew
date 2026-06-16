//! London Mulligan implementation.
//!
//! Mirrors the Java mulligan package at
//! `forge/forge-game/src/main/java/forge/game/mulligan/`.
//!
//! After libraries are shuffled and opening hands are drawn, each player
//! (starting from the player who goes first) decides whether to keep or
//! mulligan.  On a mulligan the hand is shuffled back and a fresh 7 cards
//! are drawn.  When a player finally keeps, they put N cards from hand on
//! the bottom of their library, where N is the number of mulligans taken.
//!
//! ## Java parity divergence
//!
//! Java's `MulliganService.runPlayerMulligans()` prompts each player
//! sequentially (one blocking call per player per round). This Rust port
//! fans out all non-kept players' prompts per round and collects the
//! responses in parallel, then applies keep/mulligan decisions in turn
//! order. The put-back prompts after all players have kept are also
//! fanned out.
//!
//! Observable game state is identical (decisions still apply in turn
//! order; mulligans don't interact). The divergence is purely in prompt
//! timing, so networked multiplayer clients can respond simultaneously
//! instead of waiting in queue.

use crate::agent::PlayerAgent;
use crate::game::GameState;
use crate::game_log::GameLog;
use crate::game_log_entry_type::GameLogEntryType;
use crate::ids::{CardId, PlayerId};
use crate::mana::ManaPool;
use forge_foundation::ZoneType;

const STARTING_HAND_SIZE: usize = 7;

/// Run the London Mulligan procedure for every player in the game.
///
/// Players act in turn order beginning with `first_player`.  Each round,
/// every player who has not yet kept is asked whether to keep or mulligan.
/// The loop ends once all players have kept.
pub fn run_london_mulligans(
    game: &mut GameState,
    agents: &mut [Box<dyn PlayerAgent>],
    rng: &mut impl rand::Rng,
    first_player: PlayerId,
    mana_pools: &[ManaPool],
    game_log: &GameLog,
) {
    let ordered = mulligan_order(&game.player_order, first_player);
    let player_count = ordered.len();
    let mut mulligan_count = vec![0u32; player_count];
    let mut has_kept = vec![false; player_count];

    // Per round: fan out prompts to every non-kept player, collect all
    // responses, then apply decisions in turn order. See module docs for
    // the Java parity divergence this introduces.
    loop {
        if has_kept.iter().all(|&k| k) {
            break;
        }

        let active: Vec<(usize, PlayerId, Vec<CardId>)> = (0..player_count)
            .filter(|i| !has_kept[*i])
            .map(|i| {
                let pid = ordered[i];
                let hand = game.cards_in_zone(ZoneType::Hand, pid).to_vec();
                (i, pid, hand)
            })
            .collect();

        // Phase 1: snapshot + fire prompts for every active player.
        for (i, pid, hand) in &active {
            agents[pid.index()].snapshot_state(game, mana_pools);
            if !hand.is_empty() {
                agents[pid.index()].mulligan_decision_send(*pid, hand, mulligan_count[*i]);
            }
        }

        // Phase 2: collect responses.  Prompts are already in flight so
        // remote clients can respond concurrently.
        let decisions: Vec<bool> = active
            .iter()
            .map(|(i, pid, hand)| {
                if hand.is_empty() {
                    true
                } else {
                    agents[pid.index()].mulligan_decision_recv(*pid, hand, mulligan_count[*i])
                }
            })
            .collect();

        // Phase 3: apply in turn order.
        for ((i, pid, _), keep) in active.iter().zip(decisions.iter()) {
            if *keep {
                has_kept[*i] = true;
            } else {
                perform_mulligan(game, *pid, rng, game_log);
                mulligan_count[*i] += 1;
            }
        }
    }

    run_put_back_phase(
        game,
        agents,
        &ordered,
        &mulligan_count,
        mana_pools,
        game_log,
    );
}

/// After all players have kept, fan out put-back prompts in parallel and
/// apply the results in turn order.
fn run_put_back_phase(
    game: &mut GameState,
    agents: &mut [Box<dyn PlayerAgent>],
    ordered: &[PlayerId],
    mulligan_count: &[u32],
    mana_pools: &[ManaPool],
    game_log: &GameLog,
) {
    struct PutBackJob {
        player: PlayerId,
        hand: Vec<CardId>,
        count: usize,
    }

    let jobs: Vec<PutBackJob> = ordered
        .iter()
        .enumerate()
        .filter_map(|(i, &pid)| {
            let count = mulligan_count[i] as usize;
            if count == 0 {
                return None;
            }
            agents[pid.index()].snapshot_state(game, mana_pools);
            let hand = game.cards_in_zone(ZoneType::Hand, pid).to_vec();
            agents[pid.index()].choose_cards_to_bottom_send(pid, &hand, count);
            Some(PutBackJob {
                player: pid,
                hand,
                count,
            })
        })
        .collect();

    for job in jobs {
        let picks = agents[job.player.index()]
            .choose_cards_to_bottom_recv(job.player, &job.hand, job.count);
        for &card_id in &picks {
            game.put_on_bottom_of_library(card_id, job.player);
        }
    }

    for &pid in ordered {
        let final_size = game.cards_in_zone(ZoneType::Hand, pid).len();
        game_log.log(
            GameLogEntryType::Mulligan,
            1,
            format!(
                "{} keeps hand ({} card{})",
                game.player(pid).name,
                final_size,
                if final_size == 1 { "" } else { "s" },
            ),
        );
    }
}

/// Shuffle the player's hand back into their library, then draw a fresh 7.
fn perform_mulligan(
    game: &mut GameState,
    player: PlayerId,
    rng: &mut impl rand::Rng,
    game_log: &GameLog,
) {
    let hand: Vec<_> = game.cards_in_zone(ZoneType::Hand, player).to_vec();
    for card_id in hand {
        game.move_card(card_id, ZoneType::Library, player);
    }
    game.shuffle_library(player, rng);
    game.draw_cards(player, STARTING_HAND_SIZE);

    game_log.log(
        GameLogEntryType::Mulligan,
        1,
        format!("{} mulligans", game.player(player).name),
    );
}

/// Rotate `player_order` so that `first_player` is at the front.
fn mulligan_order(player_order: &[PlayerId], first_player: PlayerId) -> Vec<PlayerId> {
    let offset = player_order
        .iter()
        .position(|&p| p == first_player)
        .unwrap_or(0);
    let len = player_order.len();
    (0..len).map(|i| player_order[(offset + i) % len]).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::{PlayerAgent, TargetChoice};
    use crate::card::Card;
    use crate::combat::DefenderId;
    use crate::game::GameState;
    use crate::ids::{CardId, PlayerId};
    use crate::mana::ManaPool;
    use crate::player::actions::PlayerAction;
    use crate::spellability::SpellAbility;
    use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};
    use rand::SeedableRng;

    struct TestAgent {
        mulligans_to_take: u32,
        bottom_picks: Option<Vec<CardId>>,
    }

    impl TestAgent {
        fn keep() -> Self {
            TestAgent {
                mulligans_to_take: 0,
                bottom_picks: None,
            }
        }

        fn mulligan(times: u32) -> Self {
            TestAgent {
                mulligans_to_take: times,
                bottom_picks: None,
            }
        }
    }

    impl PlayerAgent for TestAgent {
        fn mulligan_decision(
            &mut self,
            _player: PlayerId,
            _hand: &[CardId],
            mulligan_count: u32,
        ) -> bool {
            mulligan_count >= self.mulligans_to_take
        }

        fn choose_cards_to_bottom(
            &mut self,
            _player: PlayerId,
            hand: &[CardId],
            count: usize,
        ) -> Vec<CardId> {
            if let Some(ref picks) = self.bottom_picks {
                picks.clone()
            } else {
                hand.iter().copied().take(count).collect()
            }
        }

        fn choose_action(
            &mut self,
            player: PlayerId,
            action_space: Option<&crate::agent::PriorityActionSpace>,
            request_action_space: &mut dyn FnMut() -> crate::agent::PriorityActionSpace,
        ) -> PlayerAction {
            PlayerAction::PassPriority
        }

        fn choose_attackers(
            &mut self,
            _: PlayerId,
            _: &[CardId],
            _: &[DefenderId],
        ) -> Vec<(CardId, DefenderId)> {
            vec![]
        }

        fn choose_blockers(
            &mut self,
            _: PlayerId,
            _: &[CardId],
            _: &[CardId],
            _: Option<usize>,
        ) -> Vec<(CardId, CardId)> {
            vec![]
        }

        fn choose_target_player(
            &mut self,
            _: PlayerId,
            v: &[PlayerId],
            _sa: Option<&crate::spellability::SpellAbility>,
        ) -> Option<PlayerId> {
            v.first().copied()
        }

        fn choose_target_card(
            &mut self,
            _: PlayerId,
            v: &[CardId],
            _sa: Option<&crate::spellability::SpellAbility>,
        ) -> Option<CardId> {
            v.first().copied()
        }

        fn choose_target_any(
            &mut self,
            _: PlayerId,
            _: &[PlayerId],
            _: &[CardId],
            _sa: Option<&crate::spellability::SpellAbility>,
        ) -> TargetChoice {
            TargetChoice::None
        }

        fn choose_land_or_spell(&mut self, _: PlayerId) -> Option<bool> {
            None
        }

        fn choose_targets_for(
            &mut self,
            _sa: &mut SpellAbility,
            _game: &GameState,
            _mana_pools: &[ManaPool],
        ) -> bool {
            false
        }
    }

    fn filler_card(owner: PlayerId) -> Card {
        Card::new(
            CardId(0),
            "Filler".to_string(),
            owner,
            CardTypeLine::parse("Creature"),
            ManaCost::no_cost(),
            ColorSet::COLORLESS,
            Some(1),
            Some(1),
            vec![],
            vec![],
        )
    }

    fn setup_game_with_libraries(deck_size: usize) -> (GameState, rand::rngs::StdRng) {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);
        for _ in 0..deck_size {
            let c0 = game.create_card(filler_card(p0));
            game.add_card_to_zone(ZoneType::Library, p0, c0);
            game.cards[c0.index()].zone = ZoneType::Library;

            let c1 = game.create_card(filler_card(p1));
            game.add_card_to_zone(ZoneType::Library, p1, c1);
            game.cards[c1.index()].zone = ZoneType::Library;
        }
        let rng = rand::rngs::StdRng::seed_from_u64(42);
        (game, rng)
    }

    #[test]
    fn keep_immediately_preserves_seven_card_hand() {
        let (mut game, mut rng) = setup_game_with_libraries(40);
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);

        game.shuffle_library(p0, &mut rng);
        game.shuffle_library(p1, &mut rng);
        game.draw_cards(p0, 7);
        game.draw_cards(p1, 7);

        let mut agents: Vec<Box<dyn PlayerAgent>> =
            vec![Box::new(TestAgent::keep()), Box::new(TestAgent::keep())];
        let pools = vec![ManaPool::new(), ManaPool::new()];
        let log = GameLog::new();

        run_london_mulligans(&mut game, &mut agents, &mut rng, p0, &pools, &log);

        assert_eq!(game.cards_in_zone(ZoneType::Hand, p0).len(), 7);
        assert_eq!(game.cards_in_zone(ZoneType::Hand, p1).len(), 7);
    }

    #[test]
    fn one_mulligan_leaves_six_cards() {
        let (mut game, mut rng) = setup_game_with_libraries(40);
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);

        game.shuffle_library(p0, &mut rng);
        game.shuffle_library(p1, &mut rng);
        game.draw_cards(p0, 7);
        game.draw_cards(p1, 7);

        let mut agents: Vec<Box<dyn PlayerAgent>> = vec![
            Box::new(TestAgent::mulligan(1)),
            Box::new(TestAgent::keep()),
        ];
        let pools = vec![ManaPool::new(), ManaPool::new()];
        let log = GameLog::new();

        run_london_mulligans(&mut game, &mut agents, &mut rng, p0, &pools, &log);

        assert_eq!(game.cards_in_zone(ZoneType::Hand, p0).len(), 6);
        assert_eq!(game.cards_in_zone(ZoneType::Hand, p1).len(), 7);
    }

    #[test]
    fn two_mulligans_leaves_five_cards() {
        let (mut game, mut rng) = setup_game_with_libraries(40);
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);

        game.shuffle_library(p0, &mut rng);
        game.shuffle_library(p1, &mut rng);
        game.draw_cards(p0, 7);
        game.draw_cards(p1, 7);

        let mut agents: Vec<Box<dyn PlayerAgent>> = vec![
            Box::new(TestAgent::mulligan(2)),
            Box::new(TestAgent::keep()),
        ];
        let pools = vec![ManaPool::new(), ManaPool::new()];
        let log = GameLog::new();

        run_london_mulligans(&mut game, &mut agents, &mut rng, p0, &pools, &log);

        assert_eq!(game.cards_in_zone(ZoneType::Hand, p0).len(), 5);
        assert_eq!(game.cards_in_zone(ZoneType::Hand, p1).len(), 7);
    }

    #[test]
    fn both_players_can_mulligan_independently() {
        let (mut game, mut rng) = setup_game_with_libraries(40);
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);

        game.shuffle_library(p0, &mut rng);
        game.shuffle_library(p1, &mut rng);
        game.draw_cards(p0, 7);
        game.draw_cards(p1, 7);

        let mut agents: Vec<Box<dyn PlayerAgent>> = vec![
            Box::new(TestAgent::mulligan(1)),
            Box::new(TestAgent::mulligan(2)),
        ];
        let pools = vec![ManaPool::new(), ManaPool::new()];
        let log = GameLog::new();

        run_london_mulligans(&mut game, &mut agents, &mut rng, p0, &pools, &log);

        assert_eq!(game.cards_in_zone(ZoneType::Hand, p0).len(), 6);
        assert_eq!(game.cards_in_zone(ZoneType::Hand, p1).len(), 5);
    }

    #[test]
    fn mulligan_order_rotates_correctly() {
        let order = vec![PlayerId(0), PlayerId(1), PlayerId(2)];
        assert_eq!(
            mulligan_order(&order, PlayerId(1)),
            vec![PlayerId(1), PlayerId(2), PlayerId(0)]
        );
        assert_eq!(
            mulligan_order(&order, PlayerId(0)),
            vec![PlayerId(0), PlayerId(1), PlayerId(2)]
        );
    }
}
