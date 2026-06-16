use super::*;

#[derive(Debug, Clone)]
pub(crate) struct ManaUndoRecord {
    player: PlayerId,
    source: CardId,
    snapshot: GameSnapshot,
}

impl GameLoop {
    fn ensure_mana_undo_slots(&mut self, player: PlayerId) {
        let needed = player.index() + 1;
        while self.mana_undo_stacks.len() < needed {
            self.mana_undo_stacks.push(Vec::new());
        }
    }

    pub(crate) fn invalidate_mana_undo_for_player(&mut self, player: PlayerId) {
        self.ensure_mana_undo_slots(player);
        self.mana_undo_stacks[player.index()].clear();
    }

    pub(crate) fn invalidate_all_mana_undo(&mut self) {
        for stack in &mut self.mana_undo_stacks {
            stack.clear();
        }
    }

    pub(crate) fn mark_mana_undo_disqualified(&mut self) {
        self.mana_undo_disqualified = true;
    }

    pub(crate) fn begin_mana_undo_action(
        &mut self,
        game: &GameState,
        player: PlayerId,
        source: CardId,
    ) -> ManaUndoRecord {
        self.ensure_mana_undo_slots(player);
        self.mana_undo_disqualified = false;
        ManaUndoRecord {
            player,
            source,
            snapshot: self.make_snapshot(game, true),
        }
    }

    pub(crate) fn begin_mana_undo_action_with_mana_slice(
        &mut self,
        game: &GameState,
        mana_pools: &[ManaPool],
        player: PlayerId,
        source: CardId,
    ) -> ManaUndoRecord {
        self.ensure_mana_undo_slots(player);
        self.mana_undo_disqualified = false;
        ManaUndoRecord {
            player,
            source,
            snapshot: GameSnapshot::capture(
                game,
                mana_pools,
                &self.combat,
                &self.trigger_handler,
                true,
            ),
        }
    }

    pub(crate) fn finish_mana_undo_action(
        &mut self,
        record: ManaUndoRecord,
        produced_mana_count: usize,
    ) {
        if produced_mana_count == 0 || self.mana_undo_disqualified {
            self.invalidate_mana_undo_for_player(record.player);
            self.mana_undo_disqualified = false;
            return;
        }
        self.ensure_mana_undo_slots(record.player);
        self.mana_undo_stacks[record.player.index()].push(record);
        self.mana_undo_disqualified = false;
    }

    pub(crate) fn undoable_mana_sources(&self, player: PlayerId) -> Vec<CardId> {
        self.mana_undo_stacks
            .get(player.index())
            .and_then(|stack| stack.last())
            .map(|record| vec![record.source])
            .unwrap_or_default()
    }

    pub(crate) fn undo_mana_action(
        &mut self,
        game: &mut GameState,
        player: PlayerId,
        source: CardId,
    ) -> bool {
        self.ensure_mana_undo_slots(player);
        let Some(record) = self.mana_undo_stacks[player.index()].last().cloned() else {
            return false;
        };
        if record.player != player || record.source != source {
            return false;
        }
        self.mana_undo_stacks[player.index()].pop();
        self.restore_snapshot(game, &record.snapshot);
        true
    }

    pub(crate) fn undo_mana_action_with_mana_slice(
        &mut self,
        game: &mut GameState,
        mana_pools: &mut [ManaPool],
        player: PlayerId,
        source: CardId,
    ) -> bool {
        self.ensure_mana_undo_slots(player);
        let Some(record) = self.mana_undo_stacks[player.index()].last().cloned() else {
            return false;
        };
        if record.player != player || record.source != source {
            return false;
        }
        self.mana_undo_stacks[player.index()].pop();
        record.snapshot.restore_game_state_with_mana_slice(
            game,
            mana_pools,
            &mut self.combat,
            &mut self.trigger_handler,
        );
        true
    }
}
