use super::*;
use crate::agent::notification::GameNotification;

impl GameLoop {
    pub(crate) fn notify_phase_changed(
        &mut self,
        game: &GameState,
        agents: &mut [Box<dyn PlayerAgent>],
    ) {
        for agent in agents.iter_mut() {
            agent.snapshot_state(game, &self.mana_pools);
            agent.notify(GameNotification::PhaseChanged {
                phase: game.turn.phase,
            });
        }
    }

    pub(crate) fn notify_priority_changed(
        &mut self,
        game: &GameState,
        agents: &mut [Box<dyn PlayerAgent>],
        priority_player: crate::ids::PlayerId,
    ) {
        for agent in agents.iter_mut() {
            {
                let _perf_scope = crate::perf::ParamsLookupScopeGuard::enter(
                    crate::perf::ParamsLookupScope::PrioritySnapshot,
                );
                crate::perf::increment_priority_snapshot();
                agent.snapshot_state(game, &self.mana_pools);
            }
            agent.notify(GameNotification::PriorityChanged {
                player: priority_player,
            });
        }
    }

    pub(crate) fn notify_state_changed(
        &mut self,
        game: &GameState,
        agents: &mut [Box<dyn PlayerAgent>],
    ) {
        for agent in agents.iter_mut() {
            agent.snapshot_state(game, &self.mana_pools);
            agent.notify(GameNotification::StateChanged);
        }
    }

    pub(crate) fn state_fingerprint(&self, game: &GameState) -> u64 {
        let mut hasher = DefaultHasher::new();

        hasher.write_u32(game.turn.turn_number);
        hasher.write_u32(game.turn.active_player.0);
        hasher.write_u8(game.turn.phase as u8);
        // NOTE: priority_player is deliberately excluded from the fingerprint.
        // Priority changes are already notified via notify_priority_changed(),
        // so including it here would cause with_shared_state_mutation() to emit
        // duplicate notify_state_changed() snapshots every time priority_player
        // is assigned, breaking parity with Java.
        hasher.write_u8(game.game_over as u8);
        hasher.write_u32(game.winner.map(|p| p.0).unwrap_or(u32::MAX));
        hasher.write_u8(game.prevent_all_combat_damage as u8);
        hasher.write_usize(game.extra_turns.len());

        for p in &game.players {
            hasher.write_u32(p.id.0);
            hasher.write_i32(p.life);
            hasher.write_i32(p.poison_counters);
            hasher.write_i32(p.lands_played_this_turn);
            hasher.write_i32(p.spells_cast_this_turn);
            hasher.write_usize(p.cards_cast_this_turn.len());
            for cid in &p.cards_cast_this_turn {
                hasher.write_u32(cid.0);
            }
            hasher.write_i32(p.drawn_this_turn);
        }

        for pool in &self.mana_pools {
            hasher.write_i32(pool.white());
            hasher.write_i32(pool.blue());
            hasher.write_i32(pool.black());
            hasher.write_i32(pool.red());
            hasher.write_i32(pool.green());
            hasher.write_i32(pool.colorless());
        }

        for c in &game.cards {
            hasher.write_u32(c.id.0);
            hasher.write_u32(c.owner.0);
            hasher.write_u32(c.controller.0);
            hasher.write_u8(c.zone as u8);
            hasher.write_u8(c.tapped as u8);
            hasher.write_u8(c.summoning_sick as u8);
            hasher.write_i32(c.damage);
            hasher.write_i32(c.power_modifier);
            hasher.write_i32(c.toughness_modifier);
            hasher.write_u8(c.has_deathtouch_damage as u8);
            hasher.write_u8(c.is_token as u8);
            hasher.write_u8(c.is_commander as u8);
            hasher.write_u32(c.commander_cast_count);
        }

        for entry in game.stack.iter() {
            hasher.write_u32(entry.id);
            hasher.write_u32(entry.spell_ability.activating_player.0);
            hasher.write_u8(entry.is_creature_spell as u8);
            hasher.write_u8(entry.is_permanent_spell as u8);
            hasher.write_u32(entry.spell_ability.source.map(|s| s.0).unwrap_or(u32::MAX));
            hasher.write(entry.spell_ability.ability_text.as_bytes());
        }

        let mut zone_rows: Vec<String> = game
            .iter_zones()
            .map(|(k, z)| {
                let ids = z
                    .cards
                    .iter()
                    .map(|c| c.0.to_string())
                    .collect::<Vec<_>>()
                    .join(",");
                format!("{:?}:{}:{ids}", k.zone_type, k.owner.0)
            })
            .collect();
        zone_rows.sort_unstable();
        for row in zone_rows {
            hasher.write(row.as_bytes());
        }

        hasher.write_u32(
            self.combat
                .attacking_player
                .map(|p| p.0)
                .unwrap_or(u32::MAX),
        );
        hasher.write_u32(
            self.combat
                .defending_player
                .map(|p| p.0)
                .unwrap_or(u32::MAX),
        );
        for (attacker, defender) in &self.combat.attackers {
            hasher.write_u32(attacker.0);
            match defender {
                crate::combat::DefenderId::Player(pid) => hasher.write_u32(pid.0),
                crate::combat::DefenderId::Permanent(cid) => hasher.write_u32(cid.0),
            }
        }
        for (blocker, attacker) in &self.combat.blockers {
            hasher.write_u32(blocker.0);
            hasher.write_u32(attacker.0);
        }

        hasher.finish()
    }

    pub(crate) fn with_shared_state_mutation<R>(
        &mut self,
        game: &mut GameState,
        agents: &mut [Box<dyn PlayerAgent>],
        f: impl FnOnce(&mut Self, &mut GameState, &mut [Box<dyn PlayerAgent>]) -> R,
    ) -> R {
        let before = self.state_fingerprint(game);
        let out = f(self, game, agents);
        let after = self.state_fingerprint(game);
        if before != after {
            self.notify_state_changed(game, agents);
        }
        out
    }

    pub(crate) fn set_phase(
        &mut self,
        game: &mut GameState,
        agents: &mut [Box<dyn PlayerAgent>],
        phase: PhaseType,
    ) {
        self.invalidate_all_mana_undo();
        // Clear mana pools at each phase/step transition, retaining persistent,
        // combat mana, and UnspentMana static colors (MTG rule 500.4).
        // Scan for UnspentMana statics (Omnath, Leyline Tyrant, Upwelling, etc.)
        let num_players = self.mana_pools.len();
        for pidx in 0..num_players {
            let player_id = crate::ids::PlayerId(pidx as u32);
            let keep_colors = compute_unspent_mana_colors(game, player_id);
            let cleared = self.mana_pools[pidx].clear_pool_with_keep(phase, keep_colors);
            // Mana burn: if player has ManaBurn static, lose life equal to cleared mana
            if cleared > 0 && has_mana_burn(game, player_id) {
                game.player_lose_life(player_id, cleared as i32);
            }
        }
        game.turn.phase = phase;
        self.log_phase_begin(phase);
        self.notify_phase_changed(game, agents);
    }
}

/// Scan battlefield for UnspentMana statics and return a bitmask of mana colors
/// that the given player should keep. Mirrors Java's `StaticAbilityUnspentMana.getManaToKeep()`.
fn compute_unspent_mana_colors(game: &GameState, player: crate::ids::PlayerId) -> u16 {
    crate::staticability::static_ability_unspent_mana::get_mana_to_keep(game, player)
        .into_iter()
        .fold(0u16, |mask, atom| mask | atom)
}

/// Check if a player has mana burn (from ManaBurn static ability like Yurlok of Scorch Thrash).
/// Mirrors Java's `StaticAbilityUnspentMana.hasManaBurn()`.
fn has_mana_burn(game: &GameState, player: crate::ids::PlayerId) -> bool {
    crate::staticability::static_ability_unspent_mana::has_mana_burn(game, player)
}
