use crate::limited_deck_builder::LimitedDeck;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GauntletKind {
    Sealed,
    BoosterDraft,
}

#[derive(Debug, Clone)]
pub struct GauntletMini {
    pub kind: GauntletKind,
    pub rounds: u32,
    pub current_round: u32,
    pub wins: u32,
    pub losses: u32,
    pub human_deck: LimitedDeck,
    pub ai_decks: Vec<LimitedDeck>,
    pub completed: bool,
}

impl GauntletMini {
    pub fn new(
        kind: GauntletKind,
        requested_rounds: u32,
        human_deck: LimitedDeck,
        ai_decks: Vec<LimitedDeck>,
    ) -> Result<Self, String> {
        if ai_decks.is_empty() {
            return Err("gauntlet needs at least one AI deck".into());
        }
        let rounds = requested_rounds.min(ai_decks.len() as u32).max(1);
        Ok(Self {
            kind,
            rounds,
            current_round: 1,
            wins: 0,
            losses: 0,
            human_deck,
            ai_decks,
            completed: false,
        })
    }

    pub fn reset_current_round(&mut self) {
        self.wins = 0;
        self.losses = 0;
        self.current_round = 1;
        self.completed = false;
    }

    pub fn current_opponent(&self) -> Option<&LimitedDeck> {
        if self.completed {
            return None;
        }
        self.ai_decks.get((self.current_round - 1) as usize)
    }

    pub fn is_final_round(&self) -> bool {
        self.current_round >= self.rounds
    }

    pub fn add_win(&mut self) {
        self.wins += 1;
    }

    pub fn add_loss(&mut self) {
        self.losses += 1;
    }

    pub fn next_round(&mut self) -> bool {
        if self.current_round >= self.rounds {
            self.completed = true;
            return false;
        }
        self.current_round += 1;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn deck(name: &str) -> LimitedDeck {
        LimitedDeck {
            name: name.into(),
            main: Vec::new(),
            sideboard: Vec::new(),
        }
    }

    #[test]
    fn new_clamps_rounds_to_ai_pool_size() {
        let g = GauntletMini::new(
            GauntletKind::Sealed,
            10,
            deck("human"),
            vec![deck("ai-1"), deck("ai-2")],
        )
        .unwrap();
        assert_eq!(g.rounds, 2);
        assert_eq!(g.current_round, 1);
        assert!(!g.completed);
    }

    #[test]
    fn rejects_empty_ai_pool() {
        let err = GauntletMini::new(GauntletKind::Sealed, 3, deck("human"), Vec::new());
        assert!(err.is_err());
    }

    #[test]
    fn next_round_marks_complete_at_end() {
        let mut g = GauntletMini::new(
            GauntletKind::Sealed,
            2,
            deck("human"),
            vec![deck("ai-1"), deck("ai-2")],
        )
        .unwrap();
        assert!(g.next_round());
        assert_eq!(g.current_round, 2);
        assert!(g.is_final_round());
        assert!(!g.next_round());
        assert!(g.completed);
        assert!(g.current_opponent().is_none());
    }

    #[test]
    fn add_win_loss_track_independently() {
        let mut g = GauntletMini::new(
            GauntletKind::Sealed,
            3,
            deck("human"),
            vec![deck("ai-1"), deck("ai-2"), deck("ai-3")],
        )
        .unwrap();
        g.add_win();
        g.add_win();
        g.add_loss();
        assert_eq!(g.wins, 2);
        assert_eq!(g.losses, 1);
    }
}
