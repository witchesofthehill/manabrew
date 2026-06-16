use manabrew_engine::combat::DefenderId;
use manabrew_engine::ids::CardId;

use crate::choice_space;
use crate::java_random::JavaRandom;

pub fn pick_attackers(
    available: &[CardId],
    possible_defenders: &[DefenderId],
    rng: &mut JavaRandom,
) -> Vec<(CardId, DefenderId)> {
    if possible_defenders.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    for &id in available {
        if choice_space::pick_bool(rng) {
            // Match Java DeterministicController: when an attacker is chosen,
            // pick a defender via rng.nextInt(defenders.size()).
            // This intentionally consumes RNG even when defenders.len() == 1.
            let idx = choice_space::pick_index(possible_defenders.len(), rng);
            out.push((id, possible_defenders[idx]));
        }
    }
    out
}

pub fn pick_blockers(
    attackers: &[CardId],
    available_blockers: &[CardId],
    rng: &mut JavaRandom,
) -> Vec<(CardId, CardId)> {
    if attackers.is_empty() || available_blockers.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    for &blocker in available_blockers {
        let choice = choice_space::pick_index_with_pass(attackers.len(), rng);
        if choice > 0 && choice <= attackers.len() {
            out.push((blocker, attackers[choice - 1]));
        }
    }
    out
}

pub fn pick_single_blocker_target(attackers: &[CardId], rng: &mut JavaRandom) -> Option<CardId> {
    let choice = choice_space::pick_index_with_pass(attackers.len(), rng);
    if choice == 0 || choice > attackers.len() {
        None
    } else {
        Some(attackers[choice - 1])
    }
}
