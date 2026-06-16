use std::path::PathBuf;
use std::time::Instant;

use forge_cardset_archive::{build_archive_from_sources, ArchiveSources};

fn main() {
    let mut args = std::env::args().skip(1);
    let cards_dir = PathBuf::from(
        args.next()
            .unwrap_or_else(|| "forge/forge-gui/res/cardsfolder".to_string()),
    );
    let tokens_dir = PathBuf::from(
        args.next()
            .unwrap_or_else(|| "forge/forge-gui/res/tokenscripts".to_string()),
    );
    let editions_dir = PathBuf::from(
        args.next()
            .unwrap_or_else(|| "forge/forge-gui/res/editions".to_string()),
    );
    let block_data_dir = PathBuf::from(
        args.next()
            .unwrap_or_else(|| "forge/forge-gui/res/blockdata".to_string()),
    );
    let out_path = PathBuf::from(
        args.next()
            .unwrap_or_else(|| "src-tauri/resources/cardset.rkyv".to_string()),
    );

    let started = Instant::now();
    let sources = ArchiveSources {
        cardsfolder: &cards_dir,
        tokenscripts: Some(&tokens_dir),
        editions: Some(&editions_dir),
        block_data: Some(&block_data_dir),
    };
    match build_archive_from_sources(sources, &out_path) {
        Ok(stats) => {
            println!(
                "wrote {} ({} cards, {} tokens, {} editions, {:.2} MiB, {} skipped, {} duplicates) in {:?}",
                out_path.display(),
                stats.cards,
                stats.tokens,
                stats.editions,
                stats.bytes_written as f64 / 1024.0 / 1024.0,
                stats.skipped,
                stats.duplicates,
                started.elapsed()
            );
        }
        Err(err) => {
            eprintln!("build failed: {err}");
            std::process::exit(1);
        }
    }
}
