//! Report generation: JSON and human-readable text summaries of parity results.

use crate::protocol::{
    CardSnapshot, Divergence, FuzzReport, GameTrace, MatchupStatus, MatrixReport, ParityReport,
    StateSnapshot,
};

const ANSI_RESET: &str = "\x1b[0m";
const ANSI_GREEN: &str = "\x1b[32m";
const ANSI_RED: &str = "\x1b[31m";
const ANSI_YELLOW: &str = "\x1b[33m";
#[allow(dead_code)]
const ANSI_BLUE: &str = "\x1b[34m";
const ANSI_ORANGE: &str = "\x1b[38;5;208m";
#[allow(dead_code)]
const ANSI_DIM: &str = "\x1b[90m";

/// Build a parity report from a Rust trace and a set of divergences.
pub fn build_report(trace: &GameTrace, divergences: Vec<Divergence>) -> ParityReport {
    let passed = divergences.is_empty();
    ParityReport {
        seed: trace.seed,
        deck1: trace.deck1.clone(),
        deck2: trace.deck2.clone(),
        total_snapshots: trace.snapshots().count(),
        divergences,
        passed,
    }
}

/// Format a parity report as a JSON string.
pub fn format_json(report: &ParityReport) -> String {
    serde_json::to_string_pretty(report).unwrap_or_else(|e| format!("{{\"error\": \"{}\"}}", e))
}

/// Format a parity report as human-readable text.
pub fn format_text(report: &ParityReport) -> String {
    format_text_with_snapshots(report, None, None)
}

/// Format a parity report, optionally including a snapshot diff at the divergence point.
pub fn format_text_with_snapshots(
    report: &ParityReport,
    rust_snapshot: Option<&StateSnapshot>,
    java_snapshot: Option<&StateSnapshot>,
) -> String {
    let mut out = String::new();

    out.push_str("=== Forge Parity Report ===\n\n");
    out.push_str(&format!("Seed:       {}\n", report.seed));
    out.push_str(&format!("Deck 1:     {}\n", report.deck1));
    out.push_str(&format!("Deck 2:     {}\n", report.deck2));
    out.push_str(&format!("Snapshots:  {}\n", report.total_snapshots));
    out.push_str(&format!(
        "Result:     {}\n\n",
        if report.passed { "PASS" } else { "FAIL" }
    ));

    if report.divergences.is_empty() {
        out.push_str("No divergences found. Engines agree on all state.\n");
    } else {
        out.push_str(&format!(
            "Found {} divergence(s):\n\n",
            report.divergences.len()
        ));
        for (i, div) in report.divergences.iter().enumerate() {
            out.push_str(&format!(
                "  {}. [T{} {}] {}\n     Rust: {}\n     Java: {}\n\n",
                i + 1,
                div.turn,
                div.phase,
                div.field,
                div.rust_value,
                div.java_value,
            ));
        }

        if let (Some(rs), Some(js)) = (rust_snapshot, java_snapshot) {
            out.push_str(&format_snapshot_diff(rs, js, "  "));
        }
    }

    out
}

/// Format a matrix report as a JSON string.
pub fn format_matrix_json(report: &MatrixReport) -> String {
    serde_json::to_string_pretty(report).unwrap_or_else(|e| format!("{{\"error\": \"{}\"}}", e))
}

/// Format a matrix report as human-readable text.
pub fn format_matrix_text(report: &MatrixReport) -> String {
    let mut out = String::new();

    out.push_str("=== Forge Parity Matrix Report ===\n\n");
    out.push_str(&format!(
        "Seeds:      {}\n",
        report
            .seeds
            .iter()
            .map(|s| s.to_string())
            .collect::<Vec<_>>()
            .join(", ")
    ));
    out.push_str(&format!("Decks:      {}\n", report.decks.join(", ")));
    out.push_str(&format!("Max turns:  {}\n\n", report.max_turns));

    // Column header
    out.push_str(&format!(
        "  {:<20} {:<20} {:<6} {:<7} {:<11} {}\n",
        "Deck1", "Deck2", "Seed", "Status", "Divergences", "Completion"
    ));
    out.push_str(&format!("  {}\n", "-".repeat(104)));

    for r in &report.results {
        let status_str = match r.status {
            MatchupStatus::Pass => format!("{ANSI_GREEN}PASS{ANSI_RESET}"),
            MatchupStatus::Skipped => format!("{ANSI_BLUE}SKIP{ANSI_RESET}"),
            MatchupStatus::Fail => format!("{ANSI_RED}FAIL{ANSI_RESET}"),
            MatchupStatus::Error => format!("{ANSI_RED}ERROR{ANSI_RESET}"),
        };
        out.push_str(&format!(
            "  {:<20} {:<20} {:<6} {:<7} {:<11} {}\n",
            r.deck1,
            r.deck2,
            r.seed,
            status_str,
            r.divergence_count,
            completion_label(
                &r.status,
                r.first_divergence.as_ref().map(|d| d.turn),
                r.finished_turn,
                report.max_turns,
                r.skip_reason.as_deref(),
            ),
        ));
    }

    // Print failure details
    let failures: Vec<_> = report
        .results
        .iter()
        .filter(|r| {
            matches!(
                r.status,
                MatchupStatus::Skipped | MatchupStatus::Fail | MatchupStatus::Error
            )
        })
        .collect();
    if !failures.is_empty() {
        out.push_str("\nNon-passing runs:\n");
        for (i, r) in failures.iter().enumerate() {
            if r.status == MatchupStatus::Skipped {
                out.push_str(&format!(
                    "  {}. {} vs {} | seed={}\n     Skipped: {}\n\n",
                    i + 1,
                    r.deck1,
                    r.deck2,
                    r.seed,
                    r.skip_reason
                        .as_deref()
                        .unwrap_or("ignored by parity_ignore.json"),
                ));
                continue;
            }
            match &r.error_message {
                Some(msg) => {
                    out.push_str(&format!(
                        "  {}. {} vs {} | seed={}\n     Error: {}\n\n",
                        i + 1,
                        r.deck1,
                        r.deck2,
                        r.seed,
                        msg
                    ));
                }
                None => {
                    if let Some(ref div) = r.first_divergence {
                        out.push_str(&format!(
                            "  {}. {} vs {} | seed={}\n     [T{} {}] {}: Rust={} Java={}\n\n",
                            i + 1,
                            r.deck1,
                            r.deck2,
                            r.seed,
                            div.turn,
                            div.phase,
                            div.field,
                            div.rust_value,
                            div.java_value,
                        ));
                        if let (Some(rs), Some(js)) = (&r.rust_snapshot, &r.java_snapshot) {
                            out.push_str(&format_snapshot_diff(rs, js, "     "));
                        }
                    } else {
                        out.push_str(&format!(
                            "  {}. {} vs {} | seed={}\n     {} divergence(s)\n\n",
                            i + 1,
                            r.deck1,
                            r.deck2,
                            r.seed,
                            r.divergence_count,
                        ));
                    }
                }
            }
        }
    }

    let evaluated_matchups = report.passed + report.failed + report.errors;
    let pass_rate = if evaluated_matchups == 0 {
        1.0
    } else {
        report.passed as f64 / evaluated_matchups as f64
    };
    let (health_color, health_label) = if (pass_rate - 1.0).abs() < f64::EPSILON {
        (ANSI_GREEN, "HEALTHY")
    } else if pass_rate > 0.70 {
        (ANSI_YELLOW, "WARNING")
    } else {
        (ANSI_RED, "CRITICAL")
    };

    let passed_col = format!("{ANSI_GREEN}{} PASS{ANSI_RESET}", report.passed);
    let skipped_col = format!("{ANSI_BLUE}{} SKIPPED{ANSI_RESET}", report.skipped);
    let failed_col = format!("{ANSI_RED}{} FAIL{ANSI_RESET}", report.failed);
    let errors_col = format!("{ANSI_RED}{} ERROR{ANSI_RESET}", report.errors);
    out.push_str(&format!(
        "\nResults: {} matchups | {} | {} | {} | {}\n",
        report.total_matchups, passed_col, skipped_col, failed_col, errors_col
    ));
    out.push_str(&format!(
        "{}Overall health: {} ({:.1}% pass rate){}\n",
        health_color,
        health_label,
        pass_rate * 100.0,
        ANSI_RESET
    ));

    // Print failed seeds for easy re-run
    let failed_seeds: Vec<String> = report
        .results
        .iter()
        .filter(|r| matches!(r.status, MatchupStatus::Fail | MatchupStatus::Error))
        .map(|r| r.seed.to_string())
        .collect();
    if !failed_seeds.is_empty() {
        out.push_str(&format!(
            "{}Failed seeds: {}{}\n",
            ANSI_RED,
            failed_seeds.join(", "),
            ANSI_RESET
        ));
    }

    out
}

/// Format a fuzz report as a JSON string.
pub fn format_fuzz_json(report: &FuzzReport) -> String {
    serde_json::to_string_pretty(report).unwrap_or_else(|e| format!("{{\"error\": \"{}\"}}", e))
}

/// Format a fuzz report as human-readable text.
pub fn format_fuzz_text(report: &FuzzReport) -> String {
    let mut out = String::new();

    out.push_str("=== Forge Parity Fuzz Report ===\n\n");
    out.push_str(&format!("Master seed:  {}\n", report.master_seed));
    out.push_str(&format!("Iterations:   {}\n", report.iterations));
    out.push_str(&format!("Max turns:    {}\n", report.max_turns));
    out.push_str(&format!(
        "Card pool:    {}/{} ({:.1}%)\n\n",
        report.pool_size,
        report.total_cards,
        if report.total_cards > 0 {
            report.pool_size as f64 / report.total_cards as f64 * 100.0
        } else {
            0.0
        },
    ));

    out.push_str(&format!(
        "Results: {} iterations | {} PASS | {} FAIL | {} ERROR\n\n",
        report.iterations, report.passed, report.failed, report.errors
    ));

    // Column header
    out.push_str(&format!(
        "  {:<6} {:<8} {:<7} {:<11} {}\n",
        "Iter", "Seed", "Status", "Divergences", "Completion"
    ));
    out.push_str(&format!("  {}\n", "-".repeat(90)));

    for r in &report.results {
        let status_str = match r.result.status {
            MatchupStatus::Pass => "PASS",
            MatchupStatus::Skipped => "SKIP",
            MatchupStatus::Fail => "FAIL",
            MatchupStatus::Error => "ERROR",
        };
        out.push_str(&format!(
            "  {:<6} {:<8} {:<7} {:<11} {}\n",
            r.iteration,
            r.game_seed,
            status_str,
            r.result.divergence_count,
            completion_label(
                &r.result.status,
                r.result.first_divergence.as_ref().map(|d| d.turn),
                r.result.finished_turn,
                report.max_turns,
                r.result.skip_reason.as_deref(),
            ),
        ));
    }

    // Print failure details
    let failures: Vec<_> = report
        .results
        .iter()
        .filter(|r| r.result.status != MatchupStatus::Pass)
        .collect();
    if !failures.is_empty() {
        out.push_str("\nFailures:\n");
        for (i, r) in failures.iter().enumerate() {
            out.push_str(&format!(
                "\n  {}. iteration={} seed={}\n",
                i + 1,
                r.iteration,
                r.game_seed
            ));
            out.push_str(&format!("     deck1: inline:{}\n", r.deck1_spec));
            out.push_str(&format!("     deck2: inline:{}\n", r.deck2_spec));

            match &r.result.error_message {
                Some(msg) => {
                    out.push_str(&format!("     Error: {}\n", msg));
                }
                None => {
                    if let Some(ref div) = r.result.first_divergence {
                        out.push_str(&format!(
                            "     [T{} {}] {}: Rust={} Java={}\n",
                            div.turn, div.phase, div.field, div.rust_value, div.java_value,
                        ));
                        if let (Some(rs), Some(js)) =
                            (&r.result.rust_snapshot, &r.result.java_snapshot)
                        {
                            out.push_str(&format_snapshot_diff(rs, js, "     "));
                        }
                    }
                }
            }
        }
    }

    out
}

fn completion_label(
    status: &MatchupStatus,
    failed_turn: Option<u32>,
    finished_turn: Option<u32>,
    max_turns: u32,
    skip_reason: Option<&str>,
) -> String {
    match status {
        MatchupStatus::Skipped => skip_reason
            .map(|reason| format!("SKIPPED: {}", reason))
            .unwrap_or_else(|| "SKIPPED".to_string()),
        MatchupStatus::Fail => failed_turn
            .map(|t| format!("FAILED AT TURN {}", t))
            .unwrap_or_else(|| "FAILED".to_string()),
        MatchupStatus::Pass => {
            if let Some(reason) = skip_reason {
                if reason.starts_with("ABORTED AT TURN ") {
                    return format!("{ANSI_YELLOW}WARN{ANSI_RESET} {reason}");
                }
            }
            finished_turn
                .map(|turn| format!("FINISHED TURN {}", turn))
                .unwrap_or_else(|| {
                    let _ = max_turns;
                    "STOPPED AT MAX".to_string()
                })
        }
        MatchupStatus::Error => "ERROR".to_string(),
    }
}

/// Render a side-by-side diff of two StateSnapshots, highlighting only the fields that differ.
fn format_snapshot_diff(rust: &StateSnapshot, java: &StateSnapshot, indent: &str) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "{indent}Snapshot diff at T{} ({}):\n",
        rust.turn, rust.phase
    ));

    fn diff_field<T: std::fmt::Display + PartialEq>(
        out: &mut String,
        indent: &str,
        name: &str,
        rust: &T,
        java: &T,
    ) {
        if rust != java {
            out.push_str(&format!(
                "{indent}  {ANSI_RED}{name}: Rust={rust}  Java={java}{ANSI_RESET}\n"
            ));
        }
    }

    diff_field(&mut out, indent, "turn", &rust.turn, &java.turn);
    diff_field(&mut out, indent, "phase", &rust.phase, &java.phase);
    diff_field(
        &mut out,
        indent,
        "active_player",
        &rust.active_player,
        &java.active_player,
    );
    diff_field(
        &mut out,
        indent,
        "game_over",
        &rust.game_over,
        &java.game_over,
    );

    let max_players = rust.players.len().max(java.players.len());
    for i in 0..max_players {
        match (rust.players.get(i), java.players.get(i)) {
            (Some(rp), Some(jp)) => {
                let label = format!("P{} {}", rp.index, rp.name);
                diff_field(
                    &mut out,
                    indent,
                    &format!("{label}.life"),
                    &rp.life,
                    &jp.life,
                );
                diff_field(
                    &mut out,
                    indent,
                    &format!("{label}.poison"),
                    &rp.poison,
                    &jp.poison,
                );
                diff_field(
                    &mut out,
                    indent,
                    &format!("{label}.has_lost"),
                    &rp.has_lost,
                    &jp.has_lost,
                );
                diff_field(
                    &mut out,
                    indent,
                    &format!("{label}.has_won"),
                    &rp.has_won,
                    &jp.has_won,
                );
                diff_field(
                    &mut out,
                    indent,
                    &format!("{label}.library_size"),
                    &rp.library_size,
                    &jp.library_size,
                );
                diff_field(
                    &mut out,
                    indent,
                    &format!("{label}.lands_played"),
                    &rp.lands_played,
                    &jp.lands_played,
                );

                let r_hand = rp.hand.join(", ");
                let j_hand = jp.hand.join(", ");
                if r_hand != j_hand {
                    out.push_str(&format!("{indent}  {ANSI_RED}{label}.hand:{ANSI_RESET}\n"));
                    out.push_str(&format!(
                        "{indent}    {ANSI_ORANGE}Rust: [{r_hand}]{ANSI_RESET}\n"
                    ));
                    out.push_str(&format!(
                        "{indent}    {ANSI_GREEN}Java: [{j_hand}]{ANSI_RESET}\n"
                    ));
                }

                let r_gy = rp.graveyard.join(", ");
                let j_gy = jp.graveyard.join(", ");
                if r_gy != j_gy {
                    out.push_str(&format!(
                        "{indent}  {ANSI_RED}{label}.graveyard:{ANSI_RESET}\n"
                    ));
                    out.push_str(&format!(
                        "{indent}    {ANSI_ORANGE}Rust: [{r_gy}]{ANSI_RESET}\n"
                    ));
                    out.push_str(&format!(
                        "{indent}    {ANSI_GREEN}Java: [{j_gy}]{ANSI_RESET}\n"
                    ));
                }

                let r_exile = rp.exile.join(", ");
                let j_exile = jp.exile.join(", ");
                if r_exile != j_exile {
                    out.push_str(&format!("{indent}  {ANSI_RED}{label}.exile:{ANSI_RESET}\n"));
                    out.push_str(&format!(
                        "{indent}    {ANSI_ORANGE}Rust: [{r_exile}]{ANSI_RESET}\n"
                    ));
                    out.push_str(&format!(
                        "{indent}    {ANSI_GREEN}Java: [{j_exile}]{ANSI_RESET}\n"
                    ));
                }

                // Battlefield card-by-card diff
                if rp.battlefield != jp.battlefield {
                    out.push_str(&format!(
                        "{indent}  {ANSI_RED}{label}.battlefield:{ANSI_RESET}\n"
                    ));
                    let r_bf: Vec<String> =
                        rp.battlefield.iter().map(format_card_snapshot).collect();
                    let j_bf: Vec<String> =
                        jp.battlefield.iter().map(format_card_snapshot).collect();
                    out.push_str(&format!(
                        "{indent}    {ANSI_ORANGE}Rust: [{}]{ANSI_RESET}\n",
                        r_bf.join(", ")
                    ));
                    out.push_str(&format!(
                        "{indent}    {ANSI_GREEN}Java: [{}]{ANSI_RESET}\n",
                        j_bf.join(", ")
                    ));
                }
            }
            (Some(rp), None) => {
                out.push_str(&format!(
                    "{indent}  {ANSI_RED}P{} {}: exists in Rust but not Java{ANSI_RESET}\n",
                    rp.index, rp.name
                ));
            }
            (None, Some(jp)) => {
                out.push_str(&format!(
                    "{indent}  {ANSI_RED}P{} {}: exists in Java but not Rust{ANSI_RESET}\n",
                    jp.index, jp.name
                ));
            }
            (None, None) => {}
        }
    }

    if rust.stack != java.stack {
        out.push_str(&format!("{indent}  {ANSI_RED}stack:{ANSI_RESET}\n"));
        out.push_str(&format!(
            "{indent}    {ANSI_ORANGE}Rust: [{}]{ANSI_RESET}\n",
            rust.stack.join(", ")
        ));
        out.push_str(&format!(
            "{indent}    {ANSI_GREEN}Java: [{}]{ANSI_RESET}\n",
            java.stack.join(", ")
        ));
    }

    out.push('\n');
    out
}

fn format_card_snapshot(c: &CardSnapshot) -> String {
    let mut s = c.name.clone();
    if c.tapped {
        s.push_str(" (T)");
    }
    if let (Some(p), Some(t)) = (c.power, c.toughness) {
        s.push_str(&format!(" {}/{}", p, t));
    }
    if c.damage > 0 {
        s.push_str(&format!(" dmg={}", c.damage));
    }
    if !c.counters.is_empty() {
        let counters: Vec<String> = c
            .counters
            .iter()
            .map(|(k, v)| format!("{}={}", k, v))
            .collect();
        s.push_str(&format!(" [{}]", counters.join(",")));
    }
    s
}

/// Format a game trace as human-readable text (Rust-only mode).
pub fn format_trace_text(trace: &GameTrace) -> String {
    let mut out = String::new();

    out.push_str("=== Forge Parity Trace (Rust-only) ===\n\n");
    out.push_str(&format!("Seed:       {}\n", trace.seed));
    out.push_str(&format!("Deck 1:     {}\n", trace.deck1));
    out.push_str(&format!("Deck 2:     {}\n", trace.deck2));
    out.push_str(&format!("Max turns:  {}\n", trace.max_turns));
    let snapshots: Vec<_> = trace.snapshots().collect();
    let decisions: Vec<_> = trace.decisions().collect();
    out.push_str(&format!("Snapshots:  {}\n\n", snapshots.len()));

    let mut decision_idx = 0usize;
    for (i, snap) in snapshots.iter().enumerate() {
        out.push_str(&format!(
            "--- Snapshot {} | Turn {} | {} | Active: P{} ---\n",
            i, snap.turn, snap.phase, snap.active_player,
        ));

        if snap.game_over {
            out.push_str(&format!(
                "  GAME OVER — winner: {}\n",
                snap.winner
                    .map(|w| format!("P{}", w))
                    .unwrap_or_else(|| "draw".into()),
            ));
        }

        for player in &snap.players {
            out.push_str(&format!(
                "  P{} {} — Life:{} Poison:{} Lost:{} Won:{}\n",
                player.index,
                player.name,
                player.life,
                player.poison,
                player.has_lost,
                player.has_won,
            ));
            if !player.battlefield.is_empty() {
                out.push_str("    Battlefield: ");
                let cards: Vec<String> = player
                    .battlefield
                    .iter()
                    .map(|c| {
                        let mut s = c.name.clone();
                        if c.tapped {
                            s.push_str(" (T)");
                        }
                        if let (Some(p), Some(t)) = (c.power, c.toughness) {
                            s.push_str(&format!(" {}/{}", p, t));
                        }
                        s
                    })
                    .collect();
                out.push_str(&cards.join(", "));
                out.push('\n');
            }
            if !player.hand.is_empty() {
                out.push_str(&format!(
                    "    Hand ({}): {}\n",
                    player.hand.len(),
                    player.hand.join(", ")
                ));
            }
            if !player.graveyard.is_empty() {
                out.push_str(&format!("    Graveyard: {}\n", player.graveyard.join(", ")));
            }
            out.push_str(&format!("    Library: {} cards\n", player.library_size));
        }

        if !snap.stack.is_empty() {
            out.push_str(&format!("  Stack: {}\n", snap.stack.join(", ")));
        }
        while decision_idx < decisions.len() {
            let d = decisions[decision_idx];
            if d.turn != snap.turn {
                break;
            }
            out.push_str(&format!(
                "  Decision[P{} {} {}]: options={:?} -> {}\n",
                d.deciding_player, d.phase, d.kind, d.options, d.choice
            ));
            decision_idx += 1;
        }
        out.push('\n');
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::StateSnapshot;

    #[test]
    fn pass_report_text() {
        let report = ParityReport {
            seed: 42,
            deck1: "red_burn".into(),
            deck2: "green_stompy".into(),
            total_snapshots: 10,
            divergences: vec![],
            passed: true,
        };
        let text = format_text(&report);
        assert!(text.contains("PASS"));
        assert!(text.contains("No divergences"));
    }

    #[test]
    fn fail_report_text() {
        let report = ParityReport {
            seed: 42,
            deck1: "red_burn".into(),
            deck2: "green_stompy".into(),
            total_snapshots: 10,
            divergences: vec![Divergence {
                snapshot_index: 3,
                turn: 2,
                phase: "Main1".into(),
                field: "players[0].life".into(),
                rust_value: "18".into(),
                java_value: "20".into(),
            }],
            passed: false,
        };
        let text = format_text(&report);
        assert!(text.contains("FAIL"));
        assert!(text.contains("players[0].life"));
    }

    #[test]
    fn trace_text_format() {
        use crate::protocol::ParityLogEntry;
        let trace = GameTrace {
            seed: 42,
            deck1: "red_burn".into(),
            deck2: "green_stompy".into(),
            max_turns: 5,
            variant: "Constructed".into(),
            commanders: vec![],
            covered_cards: vec![],
            log: vec![ParityLogEntry::Snapshot(StateSnapshot {
                turn: 1,
                phase: "Untap".into(),
                active_player: 0,
                priority_player: 0,
                game_over: false,
                winner: None,
                players: vec![],
                stack: vec![],
                timestamp_ms: 0,
            })],
        };
        let text = format_trace_text(&trace);
        assert!(text.contains("Rust-only"));
        assert!(text.contains("Snapshot 0"));
    }
}
