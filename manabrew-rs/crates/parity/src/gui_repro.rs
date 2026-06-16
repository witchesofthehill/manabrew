//! Headless reproductions of Java harness/UI controller choice behavior.
//!
//! Source references:
//! - forge-harness/src/main/java/forge/harness/DeterministicController.java
//! - forge-harness/src/main/java/forge/harness/GuiRepro.java

use crate::choice_space;
use crate::java_random::JavaRandom;
use crate::parity_log;
use crate::protocol::ChoiceLogEntry;

fn rng_log(name: &str, choices: Option<usize>, outcome: String, rng: &JavaRandom) {
    parity_log::log(ChoiceLogEntry {
        name: name.to_string(),
        choices,
        outcome,
        rng_call_count: Some(rng.call_count),
    });
}

/// Mirrors Java ChoiceSpace.pickIntInRange(min, max, rng): inclusive range.
pub fn pick_int_in_range(min: i32, max: i32, rng: &mut JavaRandom) -> i32 {
    if max <= min {
        rng_log(
            &format!("pick_int_in_range[{min} to {max}]"),
            None,
            min.to_string(),
            rng,
        );
        min
    } else {
        let span = max as i64 - min as i64 + 1;
        let val = if span <= i32::MAX as i64 {
            min + rng.next_int(span as i32)
        } else {
            let candidate = min as i64 + rng.next_int(i32::MAX) as i64;
            candidate.min(max as i64) as i32
        };
        rng_log(
            &format!("pick_int_in_range [{min} to {max}]"),
            None,
            val.to_string(),
            rng,
        );
        val
    }
}

/// Mirrors DeterministicController.chooseColor / chooseColorAllowColorless.
///
/// Parity note: Java's `chooseColor` only emits a `pick_index` RNG log plus
/// the top-level `choose_color` callback. Do not add an extra `rng_log` here,
/// or the nested trace will contain a duplicate `choose_color[N]` line that
/// Java never produces.
pub fn choose_color(valid_colors: &[String], rng: &mut JavaRandom) -> Option<String> {
    if valid_colors.is_empty() {
        return None;
    }
    let idx = choice_space::pick_index(valid_colors.len(), rng);
    valid_colors.get(idx).cloned()
}

/// Mirrors DeterministicController.chooseCounterType.
///
/// Java implementation: `ChoiceSpace.pickOne(options, rng)` followed by an
/// `onCallback("choose_counter_type", ..., String.valueOf(options.size()))`.
/// `pickOne` consumes RNG even when there is one option (logs `pick_one[1]`),
/// so Rust must call `choice_space::pick_one` to keep entropy aligned.
pub fn choose_counter_type(valid_types: &[String], rng: &mut JavaRandom) -> Option<String> {
    if valid_types.is_empty() {
        return None;
    }
    // Use indices so we can leverage `pick_one` directly without cloning strings.
    let indices: Vec<usize> = (0..valid_types.len()).collect();
    let idx = choice_space::pick_one(&indices, rng)?;
    valid_types.get(idx).cloned()
}

/// Mirrors DeterministicController.chooseColors.
pub fn choose_colors(
    valid_colors: &[String],
    min: usize,
    max: usize,
    rng: &mut JavaRandom,
) -> Vec<String> {
    if valid_colors.is_empty() {
        rng_log("choose_colors", Some(0), format!("[] [{min}-{max}]"), rng);
        return Vec::new();
    }
    let mut pool = valid_colors.to_vec();
    let count = pick_count(min, max, pool.len(), rng);
    let mut chosen = Vec::new();
    for _ in 0..count {
        if pool.is_empty() {
            break;
        }
        let idx = choice_space::pick_index(pool.len(), rng);
        chosen.push(pool.remove(idx));
    }
    rng_log(
        "choose_colors",
        Some(valid_colors.len()),
        format!("{chosen:?} [{min}-{max}]"),
        rng,
    );
    chosen
}

/// Mirrors DeterministicController.chooseSomeType.
///
/// Parity note: Java's `chooseSomeType` only emits a `pick_index` inner log
/// followed by the top-level `choose_type` callback. Do not add an extra
/// `rng_log` here, or the nested trace duplicates the outer callback line.
pub fn choose_type(valid_types: &[String], rng: &mut JavaRandom) -> Option<String> {
    if valid_types.is_empty() {
        return None;
    }
    let mut sorted = valid_types.to_vec();
    sorted.sort();
    let idx = choice_space::pick_index(sorted.len(), rng);
    sorted.get(idx).cloned()
}

/// Mirrors DeterministicController.chooseCardName(List<ICardFace>, ...).
pub fn choose_card_name(valid_names: &[String], rng: &mut JavaRandom) -> Option<String> {
    if valid_names.is_empty() {
        return None;
    }
    let idx = choice_space::pick_index(valid_names.len(), rng);
    let chosen = valid_names.get(idx).cloned();
    rng_log(
        "choose_card_name",
        Some(valid_names.len()),
        format!("{chosen:?}"),
        rng,
    );
    chosen
}

/// Mirrors DeterministicController.chooseNumber(min, max).
pub fn choose_number(min: i32, max: i32, rng: &mut JavaRandom) -> i32 {
    pick_int_in_range(min, max, rng)
}

/// Mirrors Java ChoiceSpace.pickBool.
pub fn pick_bool(rng: &mut JavaRandom) -> bool {
    let val = rng.next_int(2) == 1;
    rng_log("pick_bool", Some(2), val.to_string(), rng);
    val
}

/// Mirrors Java ChoiceSpace.pickCount(min, max, available, rng).
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

/// Mirrors Java ChoiceSpace.pickManyCards for generic slices.
pub fn pick_many_unique<T: Copy>(
    options: &[T],
    min: usize,
    max: usize,
    rng: &mut JavaRandom,
) -> Vec<T> {
    let mut pool = options.to_vec();
    let count = pick_count(min, max, pool.len(), rng);
    let mut out = Vec::with_capacity(count);
    for _ in 0..count {
        if pool.is_empty() {
            break;
        }
        let idx = choice_space::pick_index(pool.len(), rng);
        out.push(pool.remove(idx));
    }
    let len = options.len();
    let picked = out.len();
    rng_log(
        &format!("pick_many_unique [{min} to {max}]"),
        Some(len),
        format!("picked {picked}"),
        rng,
    );
    out
}

/// Mirrors Java ChoiceSpace.shuffleCopy.
pub fn shuffle_copy<T: Copy>(options: &[T], rng: &mut JavaRandom) -> Vec<T> {
    let mut out = options.to_vec();
    let len = out.len();
    if len <= 1 {
        return out;
    }
    for i in (1..len).rev() {
        let j = rng.next_int((i + 1) as i32) as usize;
        out.swap(i, j);
    }
    rng_log("shuffle_copy", Some(len), "done".into(), rng);
    out
}
