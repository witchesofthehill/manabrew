use crate::gauntlet_mini::GauntletMini;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GauntletOutcome {
    MatchInProgress,
    AdvanceToNextRound { next_round_index: u32 },
    WonTournament,
    LostRound,
}

pub struct LimitedWinLoseController;

impl LimitedWinLoseController {
    pub fn record_outcome(
        gauntlet: &mut GauntletMini,
        won_game: bool,
        match_over: bool,
        match_won: bool,
    ) -> GauntletOutcome {
        if won_game {
            gauntlet.add_win();
        } else {
            gauntlet.add_loss();
        }
        if !match_over {
            return GauntletOutcome::MatchInProgress;
        }
        if match_won {
            if gauntlet.current_round < gauntlet.rounds {
                GauntletOutcome::AdvanceToNextRound {
                    next_round_index: gauntlet.current_round + 1,
                }
            } else {
                gauntlet.completed = true;
                GauntletOutcome::WonTournament
            }
        } else {
            gauntlet.completed = true;
            GauntletOutcome::LostRound
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gauntlet_mini::GauntletKind;
    use crate::limited_deck_builder::LimitedDeck;

    fn deck(name: &str) -> LimitedDeck {
        LimitedDeck {
            name: name.into(),
            main: Vec::new(),
            sideboard: Vec::new(),
        }
    }

    #[test]
    fn winning_first_round_advances() {
        let mut g = GauntletMini::new(
            GauntletKind::Sealed,
            3,
            deck("you"),
            vec![deck("a"), deck("b"), deck("c")],
        )
        .unwrap();
        let out = LimitedWinLoseController::record_outcome(&mut g, true, true, true);
        assert_eq!(
            out,
            GauntletOutcome::AdvanceToNextRound {
                next_round_index: 2
            }
        );
        assert_eq!(g.wins, 1);
        assert!(!g.completed);
    }

    #[test]
    fn winning_final_round_wins_tournament() {
        let mut g =
            GauntletMini::new(GauntletKind::Sealed, 1, deck("you"), vec![deck("only-ai")]).unwrap();
        let out = LimitedWinLoseController::record_outcome(&mut g, true, true, true);
        assert_eq!(out, GauntletOutcome::WonTournament);
        assert!(g.completed);
    }

    #[test]
    fn losing_match_ends_gauntlet() {
        let mut g = GauntletMini::new(
            GauntletKind::Sealed,
            3,
            deck("you"),
            vec![deck("a"), deck("b"), deck("c")],
        )
        .unwrap();
        let out = LimitedWinLoseController::record_outcome(&mut g, false, true, false);
        assert_eq!(out, GauntletOutcome::LostRound);
        assert!(g.completed);
        assert_eq!(g.losses, 1);
    }

    #[test]
    fn mid_match_game_keeps_match_in_progress() {
        let mut g = GauntletMini::new(
            GauntletKind::Sealed,
            3,
            deck("you"),
            vec![deck("a"), deck("b"), deck("c")],
        )
        .unwrap();
        let out = LimitedWinLoseController::record_outcome(&mut g, true, false, false);
        assert_eq!(out, GauntletOutcome::MatchInProgress);
        assert!(!g.completed);
    }
}
