use std::collections::BTreeMap;

use manabrew_protocol::game::{CardDto, GameViewDto, PlayerDto};

pub struct FieldDiff {
    pub path: String,
    pub rust: String,
    pub trace: String,
    pub library_dependent: bool,
}

pub fn diff_views(rust: &GameViewDto, trace: &GameViewDto) -> Vec<FieldDiff> {
    let mut diffs = Vec::new();

    scalar(&mut diffs, "turn", rust.turn, trace.turn);
    scalar(&mut diffs, "step", &rust.step, &trace.step);
    scalar(
        &mut diffs,
        "activePlayerId",
        &rust.active_player_id,
        &trace.active_player_id,
    );
    scalar(
        &mut diffs,
        "priorityPlayerId",
        &rust.priority_player_id,
        &trace.priority_player_id,
    );
    scalar(&mut diffs, "gameOver", rust.game_over, trace.game_over);
    scalar_opt(&mut diffs, "monarchId", &rust.monarch_id, &trace.monarch_id);
    scalar_opt(
        &mut diffs,
        "initiativeHolderId",
        &rust.initiative_holder_id,
        &trace.initiative_holder_id,
    );

    for trace_player in &trace.players {
        let Some(rust_player) = rust.player(&trace_player.id) else {
            diffs.push(FieldDiff {
                path: format!("players[{}]", trace_player.id),
                rust: "<absent>".into(),
                trace: "<present>".into(),
                library_dependent: false,
            });
            continue;
        };
        diff_player(&mut diffs, rust_player, trace_player);
    }

    diff_zone(
        &mut diffs,
        "battlefield",
        &rust.battlefield,
        &trace.battlefield,
        false,
    );

    diffs
}

fn diff_player(diffs: &mut Vec<FieldDiff>, rust: &PlayerDto, trace: &PlayerDto) {
    let p = &trace.id;
    scalar(diffs, &format!("players[{p}].life"), rust.life, trace.life);
    scalar(
        diffs,
        &format!("players[{p}].poison"),
        rust.poison,
        trace.poison,
    );
    if rust.library_count != trace.library_count {
        diffs.push(FieldDiff {
            path: format!("players[{p}].libraryCount"),
            rust: rust.library_count.to_string(),
            trace: trace.library_count.to_string(),
            library_dependent: true,
        });
    }
    scalar(
        diffs,
        &format!("players[{p}].energyCounters"),
        rust.energy_counters,
        trace.energy_counters,
    );
    scalar(
        diffs,
        &format!("players[{p}].experienceCounters"),
        rust.experience_counters,
        trace.experience_counters,
    );
    scalar(
        diffs,
        &format!("players[{p}].radiationCounters"),
        rust.radiation_counters,
        trace.radiation_counters,
    );
    scalar(
        diffs,
        &format!("players[{p}].ringLevel"),
        rust.ring_level,
        trace.ring_level,
    );
    scalar(
        diffs,
        &format!("players[{p}].speed"),
        rust.speed,
        trace.speed,
    );

    diff_zone(diffs, &format!("players[{p}].hand"), &rust.hand, &trace.hand, true);
    diff_zone(
        diffs,
        &format!("players[{p}].graveyard"),
        &rust.graveyard,
        &trace.graveyard,
        false,
    );
    diff_zone(
        diffs,
        &format!("players[{p}].exile"),
        &rust.exile,
        &trace.exile,
        false,
    );
    diff_zone(
        diffs,
        &format!("players[{p}].commandZone"),
        &rust.command_zone,
        &trace.command_zone,
        false,
    );
}

fn diff_zone(
    diffs: &mut Vec<FieldDiff>,
    path: &str,
    rust: &[CardDto],
    trace: &[CardDto],
    library_dependent: bool,
) {
    let rust_names = name_multiset(rust);
    let trace_names = name_multiset(trace);
    if rust_names != trace_names {
        diffs.push(FieldDiff {
            path: path.to_string(),
            rust: render_multiset(&rust_names),
            trace: render_multiset(&trace_names),
            library_dependent,
        });
    }
}

fn name_multiset(cards: &[CardDto]) -> BTreeMap<String, u32> {
    let mut out: BTreeMap<String, u32> = BTreeMap::new();
    for c in cards {
        *out.entry(c.identity.name.clone()).or_default() += 1;
    }
    out
}

fn render_multiset(set: &BTreeMap<String, u32>) -> String {
    set.iter()
        .map(|(name, count)| {
            if *count == 1 {
                name.clone()
            } else {
                format!("{name} x{count}")
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn scalar<T: PartialEq + std::fmt::Display>(
    diffs: &mut Vec<FieldDiff>,
    path: &str,
    rust: T,
    trace: T,
) {
    if rust != trace {
        diffs.push(FieldDiff {
            path: path.to_string(),
            rust: rust.to_string(),
            trace: trace.to_string(),
            library_dependent: false,
        });
    }
}

fn scalar_opt(diffs: &mut Vec<FieldDiff>, path: &str, rust: &Option<String>, trace: &Option<String>) {
    if rust != trace {
        diffs.push(FieldDiff {
            path: path.to_string(),
            rust: rust.clone().unwrap_or_else(|| "<none>".into()),
            trace: trace.clone().unwrap_or_else(|| "<none>".into()),
            library_dependent: false,
        });
    }
}
