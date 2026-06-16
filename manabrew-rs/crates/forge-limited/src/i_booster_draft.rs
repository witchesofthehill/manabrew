use crate::draft_pack::DraftPack;
use crate::limited_player::LimitedPlayer;

pub trait IBoosterDraft {
    fn round(&self) -> u32;
    fn total_rounds(&self) -> u32;
    fn current_pack_for_human(&self) -> Option<&DraftPack>;
    fn has_next_choice(&self) -> bool;
    fn is_round_over(&self) -> bool;
    fn human_player(&self) -> &LimitedPlayer;
    fn opposing_players(&self) -> &[LimitedPlayer];
    fn all_players(&self) -> Vec<&LimitedPlayer> {
        let mut v = vec![self.human_player()];
        v.extend(self.opposing_players().iter());
        v
    }
    fn is_pile_draft(&self) -> bool {
        false
    }
}
