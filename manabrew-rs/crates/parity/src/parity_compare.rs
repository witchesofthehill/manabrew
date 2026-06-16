use crate::comparator;
use crate::java_bridge::JavaMatchupData;
use crate::protocol::{
    Divergence, GameTrace, MatchupResult, MatchupStatus, ParityLogEntry, StateSnapshot,
};
use crate::runner::RunConfig;

struct CompareOutcome {
    first_divergence: Option<Divergence>,
    compared_until: usize,
    diverge_rust_idx: Option<usize>,
    diverge_java_idx: Option<usize>,
}

const RESYNC_WINDOW: usize = 8;

pub fn compare_matchup(
    config: &RunConfig,
    rust_trace: &GameTrace,
    java_data: &JavaMatchupData,
) -> MatchupResult {
    let rust_snapshots = rust_trace.snapshot_vec();
    let java_snapshots = java_data.snapshot_vec();
    let outcome = compare_snapshots(config, &rust_snapshots, &java_snapshots, false);
    build_matchup_result(
        config,
        &rust_snapshots,
        &java_snapshots,
        rust_trace.log.clone(),
        java_data.log.clone(),
        rust_snapshots
            .last()
            .and_then(|s| if s.game_over { Some(s.turn) } else { None }),
        outcome,
    )
}

pub fn compare_matchup_partial(
    config: &RunConfig,
    rust_trace: &GameTrace,
    java_log: &[ParityLogEntry],
) -> Option<MatchupResult> {
    compare_matchup_partial_logs(config, &rust_trace.log, java_log)
}

pub fn compare_matchup_partial_logs(
    config: &RunConfig,
    rust_log: &[ParityLogEntry],
    java_log: &[ParityLogEntry],
) -> Option<MatchupResult> {
    let rust_snapshots_all: Vec<StateSnapshot> = rust_log
        .iter()
        .filter_map(|entry| entry.as_snapshot().cloned())
        .collect();
    let java_snapshots_all: Vec<StateSnapshot> = java_log
        .iter()
        .filter_map(|entry| entry.as_snapshot().cloned())
        .collect();
    let shared_len = rust_snapshots_all.len().min(java_snapshots_all.len());
    if shared_len == 0 {
        return None;
    }
    let rust_snapshots = &rust_snapshots_all[..shared_len];
    let java_snapshots = &java_snapshots_all[..shared_len];
    let outcome = compare_snapshots(config, rust_snapshots, java_snapshots, false);
    outcome.first_divergence.as_ref()?;
    if config.loose_parity {
        let rust_idx = outcome.diverge_rust_idx?;
        let java_idx = outcome.diverge_java_idx?;
        let stable_rust = rust_snapshots_all.len().saturating_sub(rust_idx + 1) >= RESYNC_WINDOW;
        let stable_java = java_snapshots_all.len().saturating_sub(java_idx + 1) >= RESYNC_WINDOW;
        if !stable_rust || !stable_java {
            return None;
        }
    }
    Some(build_matchup_result(
        config,
        rust_snapshots,
        java_snapshots,
        rust_log.to_vec(),
        java_log.to_vec(),
        rust_snapshots
            .last()
            .and_then(|s| if s.game_over { Some(s.turn) } else { None }),
        outcome,
    ))
}

fn build_matchup_result(
    config: &RunConfig,
    rust_snapshots: &[StateSnapshot],
    java_snapshots: &[StateSnapshot],
    rust_log: Vec<ParityLogEntry>,
    java_log: Vec<ParityLogEntry>,
    finished_turn: Option<u32>,
    outcome: CompareOutcome,
) -> MatchupResult {
    let divergence_count = usize::from(outcome.first_divergence.is_some());
    let status = if outcome.first_divergence.is_none() {
        MatchupStatus::Pass
    } else {
        MatchupStatus::Fail
    };
    let guard_abort_turn = guard_abort_turn(&rust_log).or_else(|| guard_abort_turn(&java_log));

    MatchupResult {
        deck1: config.deck1.clone(),
        deck2: config.deck2.clone(),
        seed: config.seed,
        status,
        snapshots_compared: outcome.compared_until,
        divergence_count,
        rust_snapshot: outcome.first_divergence.as_ref().and_then(|_| {
            let idx = outcome.diverge_rust_idx.unwrap_or_else(|| {
                outcome
                    .compared_until
                    .saturating_sub(1)
                    .min(rust_snapshots.len().saturating_sub(1))
            });
            rust_snapshots.get(idx).cloned()
        }),
        java_snapshot: outcome.first_divergence.as_ref().and_then(|_| {
            let idx = outcome.diverge_java_idx.unwrap_or_else(|| {
                outcome
                    .compared_until
                    .saturating_sub(1)
                    .min(java_snapshots.len().saturating_sub(1))
            });
            java_snapshots.get(idx).cloned()
        }),
        first_divergence: outcome.first_divergence,
        error_message: None,
        skip_reason: guard_abort_turn.map(|turn| format!("ABORTED AT TURN {turn}")),
        covered_cards: vec![],
        rust_log,
        java_log,
        finished_turn,
    }
}

fn guard_abort_turn(log: &[ParityLogEntry]) -> Option<u32> {
    log.iter().find_map(|entry| match entry {
        ParityLogEntry::Decision(decision) if decision.kind == "$PARITY_GUARD" => {
            Some(decision.turn)
        }
        _ => None,
    })
}

fn compare_snapshots(
    config: &RunConfig,
    rust_snapshots: &[StateSnapshot],
    java_snapshots: &[StateSnapshot],
    allow_incomplete_java_tail: bool,
) -> CompareOutcome {
    let mut first_divergence: Option<Divergence> = None;
    let mut compared_until = rust_snapshots.len().max(java_snapshots.len());
    let mut rust_idx = 0usize;
    let mut java_idx = 0usize;
    let mut compared_index = 0usize;
    let mut diverge_rust_idx: Option<usize> = None;
    let mut diverge_java_idx: Option<usize> = None;

    while rust_idx < rust_snapshots.len() || java_idx < java_snapshots.len() {
        match (rust_snapshots.get(rust_idx), java_snapshots.get(java_idx)) {
            (Some(rs), Some(js)) => {
                let divs = comparator::compare(compared_index, rs, js);
                if divs.is_empty() {
                    rust_idx += 1;
                    java_idx += 1;
                    compared_index += 1;
                    continue;
                }

                if config.loose_parity {
                    if let Some((next_rust_idx, next_java_idx)) = find_deep_resync(
                        rust_snapshots,
                        java_snapshots,
                        rust_idx,
                        java_idx,
                        compared_index,
                    ) {
                        rust_idx = next_rust_idx;
                        java_idx = next_java_idx;
                        continue;
                    }
                }

                first_divergence = divs.into_iter().next();
                compared_until = compared_index + 1;
                diverge_rust_idx = Some(rust_idx);
                diverge_java_idx = Some(java_idx);
                break;
            }
            (Some(rs), None) => {
                if allow_incomplete_java_tail {
                    compared_until = compared_index;
                    break;
                }
                first_divergence = Some(Divergence {
                    snapshot_index: compared_index,
                    turn: rs.turn,
                    phase: rs.phase.clone(),
                    field: "snapshot.exists".into(),
                    rust_value: "present".into(),
                    java_value: "missing".into(),
                });
                compared_until = compared_index + 1;
                diverge_rust_idx = Some(rust_idx);
                break;
            }
            (None, Some(js)) => {
                if allow_incomplete_java_tail {
                    compared_until = compared_index;
                    break;
                }
                first_divergence = Some(Divergence {
                    snapshot_index: compared_index,
                    turn: js.turn,
                    phase: js.phase.clone(),
                    field: "snapshot.exists".into(),
                    rust_value: "missing".into(),
                    java_value: "present".into(),
                });
                compared_until = compared_index + 1;
                diverge_java_idx = Some(java_idx);
                break;
            }
            (None, None) => {
                compared_until = compared_index;
                break;
            }
        }
    }

    CompareOutcome {
        first_divergence,
        compared_until,
        diverge_rust_idx,
        diverge_java_idx,
    }
}

pub fn extract_investigation_window<'a>(
    rust_log: &'a [ParityLogEntry],
    java_log: &'a [ParityLogEntry],
    divergent_snapshot: usize,
) -> (&'a [ParityLogEntry], &'a [ParityLogEntry]) {
    fn find_snapshot_range(log: &[ParityLogEntry], snap_idx: usize) -> (usize, usize) {
        let mut count = 0usize;
        let mut start = 0usize;
        let mut end = log.len();
        for (i, entry) in log.iter().enumerate() {
            if entry.as_snapshot().is_some() {
                if count == snap_idx {
                    end = i + 1;
                    break;
                }
                count += 1;
                start = i + 1;
            }
        }
        if snap_idx > 0 && start > 0 {
            let mut s = start - 1;
            while s > 0 {
                if log[s].as_snapshot().is_some() {
                    start = s;
                    break;
                }
                s -= 1;
            }
            if s == 0 && log[0].as_snapshot().is_some() {
                start = 0;
            }
        }
        (start, end)
    }

    let (rs, re) = find_snapshot_range(rust_log, divergent_snapshot);
    let (js, je) = find_snapshot_range(java_log, divergent_snapshot);
    (&rust_log[rs..re], &java_log[js..je])
}

fn find_deep_resync(
    rust_snapshots: &[StateSnapshot],
    java_snapshots: &[StateSnapshot],
    rust_idx: usize,
    java_idx: usize,
    compared_index: usize,
) -> Option<(usize, usize)> {
    let mut best: Option<(usize, usize)> = None;
    for rust_skip in 0..=RESYNC_WINDOW {
        for java_skip in 0..=RESYNC_WINDOW {
            if rust_skip == 0 && java_skip == 0 {
                continue;
            }
            let Some(rs) = rust_snapshots.get(rust_idx + rust_skip) else {
                continue;
            };
            let Some(js) = java_snapshots.get(java_idx + java_skip) else {
                continue;
            };
            if comparator::compare(compared_index, rs, js).is_empty() {
                let candidate = (rust_idx + rust_skip, java_idx + java_skip);
                match best {
                    None => best = Some(candidate),
                    Some(current) => {
                        let current_skips = (current.0 - rust_idx, current.1 - java_idx);
                        let candidate_skips = (rust_skip, java_skip);
                        let current_score = (
                            current_skips.0 + current_skips.1,
                            current_skips.0.max(current_skips.1),
                        );
                        let candidate_score = (
                            candidate_skips.0 + candidate_skips.1,
                            candidate_skips.0.max(candidate_skips.1),
                        );
                        if candidate_score < current_score {
                            best = Some(candidate);
                        }
                    }
                }
            }
        }
    }

    best
}
