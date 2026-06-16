use crate::protocol::{CardSnapshot, Divergence, PlayerSnapshot, StateSnapshot};

pub fn compare(index: usize, rust: &StateSnapshot, java: &StateSnapshot) -> Vec<Divergence> {
    let mut divs = Vec::new();
    let turn = rust.turn;
    let phase = rust.phase.clone();

    if rust.turn != java.turn {
        divs.push(divergence(
            index, turn, &phase, "turn", &rust.turn, &java.turn,
        ));
    }
    if rust.phase != java.phase {
        divs.push(divergence(
            index,
            turn,
            &phase,
            "phase",
            &rust.phase,
            &java.phase,
        ));
    }
    if rust.active_player != java.active_player {
        divs.push(divergence(
            index,
            turn,
            &phase,
            "active_player",
            &rust.active_player,
            &java.active_player,
        ));
    }
    if rust.priority_player != java.priority_player {
        divs.push(divergence(
            index,
            turn,
            &phase,
            "priority_player",
            &rust.priority_player,
            &java.priority_player,
        ));
    }
    if rust.game_over != java.game_over {
        divs.push(divergence(
            index,
            turn,
            &phase,
            "game_over",
            &rust.game_over,
            &java.game_over,
        ));
    }
    if rust.winner != java.winner {
        divs.push(divergence(
            index,
            turn,
            &phase,
            "winner",
            &format!("{:?}", rust.winner),
            &format!("{:?}", java.winner),
        ));
    }
    if rust.stack != java.stack {
        divs.push(divergence(
            index,
            turn,
            &phase,
            "stack",
            &format!("{:?}", rust.stack),
            &format!("{:?}", java.stack),
        ));
    }

    // Per-player comparison
    let max_players = rust.players.len().max(java.players.len());
    for i in 0..max_players {
        let prefix = format!("players[{}]", i);
        match (rust.players.get(i), java.players.get(i)) {
            (Some(rp), Some(jp)) => {
                compare_players(&mut divs, index, turn, &phase, &prefix, rp, jp);
            }
            (Some(_), None) => {
                divs.push(divergence(
                    index,
                    turn,
                    &phase,
                    &format!("{}.exists", prefix),
                    &"present",
                    &"missing",
                ));
            }
            (None, Some(_)) => {
                divs.push(divergence(
                    index,
                    turn,
                    &phase,
                    &format!("{}.exists", prefix),
                    &"missing",
                    &"present",
                ));
            }
            (None, None) => {}
        }
    }

    divs
}

fn compare_players(
    divs: &mut Vec<Divergence>,
    index: usize,
    turn: u32,
    phase: &str,
    prefix: &str,
    rust: &PlayerSnapshot,
    java: &PlayerSnapshot,
) {
    macro_rules! cmp_field {
        ($field:ident) => {
            if rust.$field != java.$field {
                divs.push(divergence(
                    index,
                    turn,
                    phase,
                    &format!("{}.{}", prefix, stringify!($field)),
                    &rust.$field,
                    &java.$field,
                ));
            }
        };
    }

    cmp_field!(name);
    cmp_field!(life);
    cmp_field!(poison);
    cmp_field!(lands_played);
    cmp_field!(has_lost);
    cmp_field!(has_won);
    cmp_field!(library_size);

    // Diagnostic: compare library top order (ordered, not sorted) so silent
    // library-order divergences surface early. `library_top` is the first few
    // cards in draw order on each side.
    if rust.library_top != java.library_top {
        divs.push(crate::protocol::Divergence {
            snapshot_index: index,
            turn,
            phase: phase.to_string(),
            field: format!("{}.library_top", prefix),
            rust_value: format!("{:?}", rust.library_top),
            java_value: format!("{:?}", java.library_top),
        });
    }

    // Zone comparisons (sorted card name lists)
    compare_name_list(
        divs,
        index,
        turn,
        phase,
        &format!("{}.graveyard", prefix),
        &rust.graveyard,
        &java.graveyard,
    );
    compare_name_list(
        divs,
        index,
        turn,
        phase,
        &format!("{}.hand", prefix),
        &rust.hand,
        &java.hand,
    );
    compare_name_list(
        divs,
        index,
        turn,
        phase,
        &format!("{}.exile", prefix),
        &rust.exile,
        &java.exile,
    );

    // Battlefield comparison
    compare_battlefield(
        divs,
        index,
        turn,
        phase,
        &format!("{}.battlefield", prefix),
        &rust.battlefield,
        &java.battlefield,
    );
}

fn compare_name_list(
    divs: &mut Vec<Divergence>,
    index: usize,
    turn: u32,
    phase: &str,
    field: &str,
    rust: &[String],
    java: &[String],
) {
    if rust != java {
        divs.push(divergence(
            index,
            turn,
            phase,
            field,
            &format!("{:?}", rust),
            &format!("{:?}", java),
        ));
    }
}

fn compare_battlefield(
    divs: &mut Vec<Divergence>,
    index: usize,
    turn: u32,
    phase: &str,
    prefix: &str,
    rust: &[CardSnapshot],
    java: &[CardSnapshot],
) {
    // Both are sorted by name. Walk in lockstep.
    let max = rust.len().max(java.len());
    if rust.len() != java.len() {
        divs.push(divergence(
            index,
            turn,
            phase,
            &format!("{}.count", prefix),
            &rust.len(),
            &java.len(),
        ));
    }

    for i in 0..max {
        let card_prefix = format!("{}[{}]", prefix, i);
        match (rust.get(i), java.get(i)) {
            (Some(rc), Some(jc)) => {
                if rc.name != jc.name {
                    divs.push(divergence(
                        index,
                        turn,
                        phase,
                        &format!("{}.name", card_prefix),
                        &rc.name,
                        &jc.name,
                    ));
                }
                if rc.tapped != jc.tapped {
                    divs.push(divergence(
                        index,
                        turn,
                        phase,
                        &format!("{}.tapped", card_prefix),
                        &rc.tapped,
                        &jc.tapped,
                    ));
                }
                if rc.power != jc.power {
                    divs.push(divergence(
                        index,
                        turn,
                        phase,
                        &format!("{}.power", card_prefix),
                        &format!("{:?}", rc.power),
                        &format!("{:?}", jc.power),
                    ));
                }
                if rc.toughness != jc.toughness {
                    divs.push(divergence(
                        index,
                        turn,
                        phase,
                        &format!("{}.toughness", card_prefix),
                        &format!("{:?}", rc.toughness),
                        &format!("{:?}", jc.toughness),
                    ));
                }
                if rc.damage != jc.damage {
                    divs.push(divergence(
                        index,
                        turn,
                        phase,
                        &format!("{}.damage", card_prefix),
                        &rc.damage,
                        &jc.damage,
                    ));
                }
                // Only compare summoning_sick for creatures (power is Some).
                // Non-creature permanents (lands, artifacts, enchantments) have
                // summoning sickness tracked differently between the Java and
                // Rust engines — Java may retain sickness=true for a land that
                // entered the battlefield on a previous turn via MayPlay/
                // graveyard play, while Rust clears it at the next new_turn().
                // Since summoning sickness has no gameplay effect for non-
                // creatures (CR 302.6), we skip the comparison to avoid false
                // divergences.
                let is_creature = rc.power.is_some() || jc.power.is_some();
                if is_creature && rc.summoning_sick != jc.summoning_sick {
                    divs.push(divergence(
                        index,
                        turn,
                        phase,
                        &format!("{}.summoning_sick", card_prefix),
                        &rc.summoning_sick,
                        &jc.summoning_sick,
                    ));
                }
                if rc.counters != jc.counters {
                    divs.push(divergence(
                        index,
                        turn,
                        phase,
                        &format!("{}.counters", card_prefix),
                        &format!("{:?}", rc.counters),
                        &format!("{:?}", jc.counters),
                    ));
                }
                if rc.controller != jc.controller {
                    divs.push(divergence(
                        index,
                        turn,
                        phase,
                        &format!("{}.controller", card_prefix),
                        &rc.controller,
                        &jc.controller,
                    ));
                }
            }
            (Some(rc), None) => {
                divs.push(divergence(
                    index,
                    turn,
                    phase,
                    &format!("{}.exists", card_prefix),
                    &rc.name,
                    &"<missing>",
                ));
            }
            (None, Some(jc)) => {
                divs.push(divergence(
                    index,
                    turn,
                    phase,
                    &format!("{}.exists", card_prefix),
                    &"<missing>",
                    &jc.name,
                ));
            }
            (None, None) => {}
        }
    }
}

fn divergence<R: std::fmt::Display, J: std::fmt::Display>(
    snapshot_index: usize,
    turn: u32,
    phase: &str,
    field: &str,
    rust_value: &R,
    java_value: &J,
) -> Divergence {
    Divergence {
        snapshot_index,
        turn,
        phase: phase.to_string(),
        field: field.to_string(),
        rust_value: rust_value.to_string(),
        java_value: java_value.to_string(),
    }
}
