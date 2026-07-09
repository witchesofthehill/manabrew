mod analytics;
mod diff;
mod replay_agent;
mod trace;

use std::cell::RefCell;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use clap::Parser;
use forge_carddb::database::ArchiveBundle;
use forge_carddb::CardDatabase;
use forge_foundation::ZoneType;
use manabrew_agent_interface::agent_impl::PromptAgent;
use manabrew_engine::agent::PlayerAgent;
use manabrew_engine::game::{GameState, TypeRegistry};
use manabrew_engine::game_loop::GameLoop;
use manabrew_engine::game_runtime::GameRuntime;
use manabrew_engine::ids::PlayerId;
use manabrew_engine::player::RegisteredPlayer;
use manabrew_game_runtime::deck::{
    deck_to_identities, force_commander_by_name, instantiate_registered_players,
    prepare_registered_player, DeckCardIdentity, PreparedRegisteredPlayer,
};
use manabrew_game_runtime::host_runtime::register_tokens_from_db;
use manabrew_protocol::deck_dto::Deck;
use memmap2::Mmap;
use rand::rngs::StdRng;
use rand::SeedableRng;

use crate::replay_agent::{ReplayAgent, ReplayContext};

#[derive(Parser)]
#[command(about = "Replay a captured Forge trace through the Rust engine and diff GameViewDto")]
struct Args {
    trace: PathBuf,
    #[arg(long)]
    deck0: Option<PathBuf>,
    #[arg(long)]
    deck1: Option<PathBuf>,
    #[arg(long)]
    events: Option<PathBuf>,
    #[arg(long, env = "CARDSET_ARCHIVE")]
    cardset: Option<PathBuf>,
    #[arg(long, default_value = "forge/forge-gui/res/cardsfolder")]
    cards_dir: PathBuf,
    #[arg(long, default_value_t = 400)]
    max_turns: u32,
    #[arg(long)]
    continue_on_divergence: bool,
    #[arg(long, default_value_t = 50)]
    max_divergences: usize,
    #[arg(long)]
    reconcile: bool,
}

fn main() {
    if let Err(err) = run() {
        eprintln!("error: {err}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args = Args::parse();

    let trace = trace::load(&args.trace)?;
    eprintln!(
        "[replay] trace {}: {} players, {} recorded decisions",
        trace.header.game_id,
        trace.header.players.len(),
        trace.decisions.len()
    );

    let (db, token_db) = load_card_data(args.cardset.as_deref())?;
    load_type_registry(&args.cards_dir);

    let selections = match args.events.as_deref() {
        Some(path) => Some(analytics::Selections::load(path)?),
        None => None,
    };

    let deck_paths = [args.deck0.as_deref(), args.deck1.as_deref()];
    let mut prepared: Vec<PreparedRegisteredPlayer> = Vec::new();
    for (idx, tp) in trace.header.players.iter().enumerate() {
        let identities = build_identities(
            &trace,
            idx,
            tp,
            deck_paths.get(idx).copied().flatten(),
            selections.as_ref(),
        )?;
        let mut player = prepare_registered_player(tp.username.clone(), &db, &identities);
        player.registered.starting_life = trace.header.starting_life;
        if let Some(commander) = tp.commander.as_deref() {
            if !force_commander_by_name(&mut player, commander) {
                eprintln!("[replay] warning: commander {commander:?} not found in deck cards");
            }
        }
        prepared.push(player);
    }

    let registered: Vec<RegisteredPlayer> = prepared.iter().map(|p| p.registered.clone()).collect();
    let mut game = GameState::new_from_registered_players(&registered);
    instantiate_registered_players(&mut game, prepared);

    let is_commander = trace.header.format.eq_ignore_ascii_case("Commander");
    if is_commander {
        for idx in 0..registered.len() {
            game.player_mut(PlayerId(idx as u32))
                .commander_damage_enabled = true;
        }
    }

    if let Some(starter) = trace.starting_player {
        game.turn.active_player = PlayerId(starter as u32);
        game.turn.priority_player = PlayerId(starter as u32);
    }

    for idx in 0..registered.len() {
        let pid = PlayerId(idx as u32);
        force_opening_hand(&mut game, pid, trace.opening_hands.get(&idx));
        game.draw_cards(pid, 7);
    }

    let mut game_loop = GameLoop::new(registered.len());
    game_loop.set_provide_priority_action_space(false);
    let abort = Arc::new(AtomicBool::new(false));
    game_loop.set_abort_signal(Arc::clone(&abort));
    register_tokens_from_db(&mut game_loop, &token_db);

    let ctx = Rc::new(RefCell::new(ReplayContext::new(
        trace.decisions,
        Arc::clone(&abort),
        args.continue_on_divergence || args.reconcile,
        args.max_divergences,
    )));

    let mut agents: Vec<Box<dyn PlayerAgent>> = Vec::new();
    for idx in 0..registered.len() {
        let responder = ReplayAgent::new(Rc::clone(&ctx), args.reconcile);
        agents.push(Box::new(PromptAgent::new(
            PlayerId(idx as u32),
            trace.header.game_id.clone(),
            responder,
        )));
    }

    let mut runtime = GameRuntime::from_parts(game, game_loop, agents);
    runtime.run_opening_hand_actions();

    let mut rng = StdRng::seed_from_u64(0);
    while !runtime.game().game_over
        && runtime.game().turn.turn_number <= args.max_turns
        && !abort.load(std::sync::atomic::Ordering::Relaxed)
    {
        runtime.run_turn(&mut rng);
    }

    report(&ctx.borrow());
    Ok(())
}

fn report(ctx: &ReplayContext) {
    eprintln!(
        "[replay] diffed {} decisions, {} clean, remap misses {}, desyncs {}",
        ctx.diffed_decisions, ctx.clean_decisions, ctx.remap_misses, ctx.desyncs
    );
    let Some(first) = ctx.first_divergence() else {
        println!(
            "CLEAN: replayed cleanly through {} diffed decisions (of {} recorded)",
            ctx.clean_decisions,
            ctx.total_decisions()
        );
        return;
    };

    let label = if first.is_library_boundary() {
        "LIBRARY BOUNDARY"
    } else {
        "DIVERGENCE"
    };
    let suffix = if first.is_library_boundary() {
        ": first divergence is hidden-library dependent (expected)"
    } else {
        ""
    };
    println!(
        "{label} at decision #{} (turn {} {}, {} on {}){suffix}",
        first.decision_index, first.turn, first.step, first.prompt_kind, first.deciding_player
    );
    print_diffs(&first.diffs);

    if ctx.divergences.len() > 1 {
        println!(
            "+ {} more divergence(s) observed (continue-on-divergence; uncorrected replay):",
            ctx.divergences.len() - 1
        );
        for div in ctx.divergences.iter().skip(1) {
            let fields: Vec<&str> = div.diffs.iter().map(|d| d.path.as_str()).collect();
            println!(
                "  #{} turn {} {} {} on {}: {}",
                div.decision_index,
                div.turn,
                div.step,
                div.prompt_kind,
                div.deciding_player,
                fields.join(", ")
            );
        }
    }
}

fn print_diffs(diffs: &[diff::FieldDiff]) {
    for d in diffs {
        println!(
            "  {}{}: rust={} | trace={}",
            d.path,
            if d.library_dependent {
                " (library)"
            } else {
                ""
            },
            d.rust,
            d.trace
        );
    }
}

fn build_identities(
    trace: &trace::Trace,
    idx: usize,
    player: &trace::TracePlayer,
    deck_path: Option<&Path>,
    selections: Option<&analytics::Selections>,
) -> Result<Vec<DeckCardIdentity>, String> {
    if let Some(path) = deck_path {
        let text = std::fs::read_to_string(path).map_err(|e| format!("read {path:?}: {e}"))?;
        let deck: Deck = serde_json::from_str(&text).map_err(|e| format!("parse {path:?}: {e}"))?;
        return Ok(ensure_commander(
            deck_to_identities(&deck),
            player.commander.as_deref(),
        ));
    }
    if let Some(selections) = selections {
        if let Some(identities) = selections.deck_for(
            trace.header.room_id.as_deref(),
            &player.username,
            trace.header.ts.as_deref(),
        ) {
            eprintln!(
                "[replay] player {idx} {:?}: {} cards from analytics DeckSelected (timestamp-joined)",
                player.username,
                identities.len()
            );
            return Ok(ensure_commander(identities, player.commander.as_deref()));
        }
    }
    let reconstructed = trace.deck_cards.get(&idx).cloned().unwrap_or_default();
    if reconstructed.is_empty() {
        return Err(format!(
            "no deck for player {idx}: pass --deck{idx} <deck.json>, --events <analytics dir>, or use a trace with visible cards"
        ));
    }
    eprintln!(
        "[replay] player {idx} deck {:?}: reconstructed partial deck of {} distinct cards from trace (pass --events for the full analytics decklist)",
        player.deck_name,
        reconstructed.len()
    );
    Ok(ensure_commander(reconstructed, player.commander.as_deref()))
}

fn ensure_commander(
    mut identities: Vec<DeckCardIdentity>,
    commander: Option<&str>,
) -> Vec<DeckCardIdentity> {
    let Some(commander) = commander else {
        return identities;
    };
    if !identities.iter().any(|i| i.name == commander) {
        identities.push(DeckCardIdentity {
            name: commander.to_string(),
            set_code: String::new(),
            card_number: String::new(),
            section: Some("commander".to_string()),
        });
    }
    identities
}

fn force_opening_hand(game: &mut GameState, pid: PlayerId, hand: Option<&Vec<String>>) {
    let Some(hand) = hand else {
        return;
    };
    let mut wanted: HashMap<String, usize> = HashMap::new();
    for name in hand {
        *wanted.entry(name.clone()).or_default() += 1;
    }
    let library: Vec<_> = game.cards_in_zone(ZoneType::Library, pid).to_vec();
    let mut rest = Vec::new();
    let mut top = Vec::new();
    for cid in library {
        let name = game.card(cid).card_name.clone();
        match wanted.get_mut(&name) {
            Some(count) if *count > 0 => {
                *count -= 1;
                top.push(cid);
            }
            _ => rest.push(cid),
        }
    }
    rest.extend(top);
    game.replace_zone_cards(ZoneType::Library, pid, rest);
}

fn load_card_data(cardset: Option<&Path>) -> Result<(CardDatabase, CardDatabase), String> {
    let path = cardset
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("src-tauri/resources/cardset.rkyv"));
    if !path.exists() {
        return Err(format!(
            "cardset archive not found at {}; build it (see manabrew-engine/AGENTS.md) or pass --cardset",
            path.display()
        ));
    }
    let file = std::fs::File::open(&path).map_err(|e| format!("open {path:?}: {e}"))?;
    let mmap = unsafe { Mmap::map(&file).map_err(|e| format!("mmap {path:?}: {e}"))? };
    let ArchiveBundle { cards, tokens, .. } = CardDatabase::load_from_archive(&mmap)?;
    Ok((cards, tokens))
}

fn load_type_registry(cards_dir: &Path) {
    let type_list = cards_dir
        .parent()
        .map(|p| p.join("lists").join("TypeLists.txt"))
        .unwrap_or_default();
    match std::fs::read_to_string(&type_list) {
        Ok(content) => TypeRegistry::load(&content),
        Err(_) => eprintln!(
            "[replay] warning: TypeLists.txt not found at {}; creature-type data unavailable",
            type_list.display()
        ),
    }
}
