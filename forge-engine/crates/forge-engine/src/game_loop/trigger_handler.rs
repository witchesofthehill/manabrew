use super::*;

impl GameLoop {
    pub(crate) fn process_triggers(
        &mut self,
        game: &mut GameState,
        agents: &mut [Box<dyn PlayerAgent>],
    ) {
        let _perf_scope = crate::perf::ParamsLookupScopeGuard::enter(
            crate::perf::ParamsLookupScope::PriorityTrigger,
        );
        let pushed = self
            .trigger_handler
            .process_waiting_triggers(&self.mana_pools, game, agents);
        if !pushed.is_empty() {
            self.invalidate_all_mana_undo();
        }
        for log in pushed {
            self.log_stack_push(&log.source_name, &log.player_name);
            if std::env::var("FORGE_TRIGGER_TRACE").is_ok() {
                eprintln!(
                    "[trigger-trace] T{} PUSHED {} optional={} api={} cause_card={:?} affected={:?}",
                    game.turn.turn_number,
                    log.source_name,
                    log.optional,
                    log.trigger_api,
                    log.cause_card_name.as_deref().unwrap_or("?"),
                    log.affected_card_name.as_deref().unwrap_or("?"),
                );
            }
        }
    }
}
