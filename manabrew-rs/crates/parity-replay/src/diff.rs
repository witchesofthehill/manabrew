use std::collections::BTreeMap;

use manabrew_protocol::game::{CardDto, GameViewDto, PlayerCounterKind, PlayerDto, ZoneKind};

use crate::view;

pub struct FieldDiff {
    pub path: String,
    pub rust: String,
    pub trace: String,
    pub library_dependent: bool,
}

pub fn diff_views(rust: &GameViewDto, trace: &GameViewDto) -> Vec<FieldDiff> {
    let mut diffs = Vec::new();

    scalar(&mut diffs, "turn", rust.turn, trace.turn);
    scalar(
        &mut diffs,
        "step",
        format!("{:?}", rust.step),
        format!("{:?}", trace.step),
    );
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
        let Some(rust_player) = view::player(rust, &trace_player.id) else {
            diffs.push(FieldDiff {
                path: format!("players[{}]", trace_player.id),
                rust: "<absent>".into(),
                trace: "<present>".into(),
                library_dependent: false,
            });
            continue;
        };
        diff_player(&mut diffs, rust, trace, rust_player, trace_player);
    }

    diff_zone(
        &mut diffs,
        "battlefield",
        view::battlefield_cards(rust),
        view::battlefield_cards(trace),
        false,
    );

    diffs
}

fn diff_player(
    diffs: &mut Vec<FieldDiff>,
    rust_view: &GameViewDto,
    trace_view: &GameViewDto,
    rust: &PlayerDto,
    trace: &PlayerDto,
) {
    let p = &trace.id;
    scalar(diffs, &format!("players[{p}].life"), rust.life, trace.life);
    for kind in [
        PlayerCounterKind::Poison,
        PlayerCounterKind::Energy,
        PlayerCounterKind::Experience,
        PlayerCounterKind::Radiation,
        PlayerCounterKind::Ticket,
    ] {
        scalar(
            diffs,
            &format!("players[{p}].counters[{kind:?}]"),
            view::counter(rust, kind),
            view::counter(trace, kind),
        );
    }
    let rust_library = view::library_count(rust_view, p);
    let trace_library = view::library_count(trace_view, p);
    if rust_library != trace_library {
        diffs.push(FieldDiff {
            path: format!("players[{p}].libraryCount"),
            rust: rust_library.to_string(),
            trace: trace_library.to_string(),
            library_dependent: true,
        });
    }
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

    for (kind, label, library_dependent) in [
        (ZoneKind::Hand, "hand", true),
        (ZoneKind::Graveyard, "graveyard", false),
        (ZoneKind::Exile, "exile", false),
        (ZoneKind::Command, "commandZone", false),
    ] {
        diff_zone(
            diffs,
            &format!("players[{p}].{label}"),
            view::zone_cards(rust_view, p, kind),
            view::zone_cards(trace_view, p, kind),
            library_dependent,
        );
    }
}

fn diff_zone<'a>(
    diffs: &mut Vec<FieldDiff>,
    path: &str,
    rust: impl Iterator<Item = &'a CardDto>,
    trace: impl Iterator<Item = &'a CardDto>,
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

fn name_multiset<'a>(cards: impl Iterator<Item = &'a CardDto>) -> BTreeMap<String, u32> {
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

fn scalar_opt(
    diffs: &mut Vec<FieldDiff>,
    path: &str,
    rust: &Option<String>,
    trace: &Option<String>,
) {
    if rust != trace {
        diffs.push(FieldDiff {
            path: path.to_string(),
            rust: rust.clone().unwrap_or_else(|| "<none>".into()),
            trace: trace.clone().unwrap_or_else(|| "<none>".into()),
            library_dependent: false,
        });
    }
}
