use std::path::PathBuf;
use std::time::{Duration, Instant};

use forge_card_script::ParsedCardScript;
use forge_cardset_archive::load_checked;
use memmap2::Mmap;
use walkdir::WalkDir;

fn main() {
    let mut args = std::env::args().skip(1);
    let cards_dir = PathBuf::from(
        args.next()
            .unwrap_or_else(|| "forge/forge-gui/res/cardsfolder".to_string()),
    );
    let archive_path = PathBuf::from(
        args.next()
            .unwrap_or_else(|| "target/cardset.rkyv".to_string()),
    );

    if !cards_dir.exists() {
        eprintln!("cards dir does not exist: {}", cards_dir.display());
        std::process::exit(1);
    }
    if !archive_path.exists() {
        eprintln!(
            "archive does not exist: {} — run `cargo run --release -p forge-cardset-archive --bin build-cardset-archive` first",
            archive_path.display()
        );
        std::process::exit(1);
    }

    println!("== Benchmark: filesystem vs rkyv archive ==\n");

    // ── FS load ─────────────────────────────────────────
    let t = Instant::now();
    let mut all_text: Vec<String> = Vec::with_capacity(35_000);
    let mut fs_total_bytes = 0usize;
    for entry in WalkDir::new(&cards_dir).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        if entry.path().extension().and_then(|e| e.to_str()) != Some("txt") {
            continue;
        }
        let raw = std::fs::read_to_string(entry.path()).unwrap();
        fs_total_bytes += raw.len();
        all_text.push(raw);
    }
    let fs_load = t.elapsed();
    println!(
        "FS load:        {:>6} files, {:>7.2} MiB  in {}",
        all_text.len(),
        fs_total_bytes as f64 / 1024.0 / 1024.0,
        fmt(fs_load),
    );

    // ── FS parse ────────────────────────────────────────
    let t = Instant::now();
    let mut fs_lines = 0usize;
    for raw in &all_text {
        let parsed = ParsedCardScript::parse(raw);
        fs_lines += parsed.lines().len();
    }
    let fs_parse = t.elapsed();
    let fs_total = fs_load + fs_parse;
    println!(
        "FS parse:       {:>6} cards, {:>7} lines in {}",
        all_text.len(),
        fs_lines,
        fmt(fs_parse)
    );
    println!(
        "FS total:                                in {}",
        fmt(fs_total)
    );
    println!();

    // ── Archive load (mmap, zero-copy) ──────────────────
    let t = Instant::now();
    let file = std::fs::File::open(&archive_path).expect("open archive");
    let mmap = unsafe { Mmap::map(&file).expect("mmap archive") };
    let mmap_elapsed = t.elapsed();
    println!(
        "Archive mmap:   {:>7.2} MiB                  in {}",
        mmap.len() as f64 / 1024.0 / 1024.0,
        fmt(mmap_elapsed)
    );

    let t = Instant::now();
    let archive = load_checked(&mmap[..]).expect("validate archive");
    let validate_elapsed = t.elapsed();
    println!(
        "Archive verify: {:>6} cards                  in {}",
        archive.cards.len(),
        fmt(validate_elapsed)
    );

    // ── Archive parse (zero-copy through &str) ──────────
    let t = Instant::now();
    let mut arch_lines = 0usize;
    for card in archive.cards.iter() {
        let parsed = ParsedCardScript::parse(card.raw.as_str());
        arch_lines += parsed.lines().len();
    }
    let arch_parse = t.elapsed();
    let arch_total = mmap_elapsed + validate_elapsed + arch_parse;
    println!(
        "Archive parse:  {:>6} cards, {:>7} lines in {}",
        archive.cards.len(),
        arch_lines,
        fmt(arch_parse)
    );
    println!(
        "Archive total:                           in {}",
        fmt(arch_total)
    );
    println!();

    // ── Summary ─────────────────────────────────────────
    println!("── Summary ──");
    println!(
        "Load only       (FS load          vs mmap+verify):     {:>6.1}× faster",
        fs_load.as_secs_f64() / (mmap_elapsed + validate_elapsed).as_secs_f64()
    );
    println!(
        "Load + parse    (FS load+parse    vs mmap+verify+parse): {:>6.1}× faster",
        fs_total.as_secs_f64() / arch_total.as_secs_f64()
    );

    // ── Lookup spot-check ───────────────────────────────
    let probe = ["Lightning Bolt", "Llanowar Elves", "Black Lotus"];
    println!("\n── Lookup spot-check ──");
    for name in probe {
        let t = Instant::now();
        let hit = archive.lookup(name);
        let lookup = t.elapsed();
        match hit {
            Some(card) => println!(
                "  '{name:<20}' → {} bytes ({})",
                card.raw.len(),
                fmt(lookup)
            ),
            None => println!("  '{name:<20}' → not found ({})", fmt(lookup)),
        }
    }
}

fn fmt(d: Duration) -> String {
    if d.as_secs() >= 1 {
        format!("{:>6.2} s ", d.as_secs_f64())
    } else if d.as_millis() >= 1 {
        format!("{:>6.2} ms", d.as_secs_f64() * 1000.0)
    } else {
        format!("{:>6.2} µs", d.as_secs_f64() * 1_000_000.0)
    }
}
