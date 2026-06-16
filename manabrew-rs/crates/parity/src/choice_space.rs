use crate::java_random::JavaRandom;
use crate::parity_log;
use crate::protocol::ChoiceLogEntry;
use std::cmp::Ordering;

fn rng_log(name: &str, choices: Option<usize>, outcome: String, rng: &JavaRandom) {
    parity_log::log(ChoiceLogEntry {
        name: name.to_string(),
        choices,
        outcome,
        rng_call_count: Some(rng.call_count),
    });
}

// ── Choice functions ──────────────────────────────────────────────

pub fn pick_bool(rng: &mut JavaRandom) -> bool {
    let idx = pick_index_inner(2, rng);
    let result = idx == 1;
    rng_log("pick_bool", Some(2), result.to_string(), rng);
    result
}

pub fn pick_one<T: Copy>(options: &[T], rng: &mut JavaRandom) -> Option<T> {
    if options.is_empty() {
        return None;
    }
    let idx = pick_index_inner(options.len(), rng);
    rng_log("pick_one", Some(options.len()), format!("idx={idx}"), rng);
    Some(options[idx])
}

/// Pick index in [0, size). Does not consume RNG when size <= 1.
pub fn pick_index(size: usize, rng: &mut JavaRandom) -> usize {
    let idx = pick_index_inner(size, rng);
    rng_log("pick_index", Some(size), format!("idx={idx}"), rng);
    idx
}

/// Core index draw without logging. Used internally by wrappers (`pick_bool`,
/// `pick_one`, ...) so they emit only their own callback line — Java's
/// `ChoiceSpace.pickOne` likewise logs a single entry per call.
fn pick_index_inner(size: usize, rng: &mut JavaRandom) -> usize {
    if size <= 1 {
        return 0;
    }
    rng.next_int(size as i32) as usize
}

/// Pick index in [0, size] where size is PASS.
pub fn pick_index_with_pass(size: usize, rng: &mut JavaRandom) -> usize {
    let idx = rng.next_int((size + 1) as i32) as usize;
    let outcome = if idx >= size {
        "PASS".into()
    } else {
        format!("idx={idx}")
    };
    rng_log("pick_index_with_pass", Some(size), outcome, rng);
    idx
}

pub fn pick_weighted_index_with_pass(
    size: usize,
    action_weight: usize,
    rng: &mut JavaRandom,
) -> usize {
    let safe_size = size;
    let safe_weight = action_weight.max(1);
    let total = safe_size.saturating_mul(safe_weight).saturating_add(1);
    let roll = pick_index(total, rng);
    let idx = if roll >= safe_size.saturating_mul(safe_weight) {
        safe_size
    } else {
        roll / safe_weight
    };
    let outcome = if idx >= safe_size {
        "PASS".into()
    } else {
        format!("idx={idx}")
    };
    rng_log(
        &format!("pick_weighted w={safe_weight}"),
        Some(safe_size),
        outcome,
        rng,
    );
    idx
}

pub fn sort_native<T: Clone>(native: &[T], mut cmp: impl FnMut(&T, &T) -> Ordering) -> Vec<T> {
    let mut out = native.to_vec();
    out.sort_by(|a, b| cmp(a, b));
    out
}

pub fn pick_count(min: usize, max: usize, available: usize, rng: &mut JavaRandom) -> usize {
    let hi = max.min(available);
    let lo = min.min(hi);
    let count = lo
        + if hi > lo {
            rng.next_int((hi - lo + 1) as i32) as usize
        } else {
            0
        };
    rng_log(
        &format!("pick_count [{min}-{max}]"),
        Some(available),
        count.to_string(),
        rng,
    );
    count
}

pub fn pick_many_unique<T: Copy>(
    options: &[T],
    min: usize,
    max: usize,
    rng: &mut JavaRandom,
) -> Vec<T> {
    let mut pool = options.to_vec();
    let count = pick_count(min, max, pool.len(), rng);
    let mut out = Vec::new();
    for _ in 0..count {
        if pool.is_empty() {
            break;
        }
        let idx = pick_index(pool.len(), rng);
        out.push(pool.remove(idx));
    }
    let len = options.len();
    let picked = out.len();
    rng_log(
        &format!("pick_many_unique [{min}-{max}]"),
        Some(len),
        format!("picked {picked}"),
        rng,
    );
    out
}
