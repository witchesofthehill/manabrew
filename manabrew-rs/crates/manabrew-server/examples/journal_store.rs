use manabrew_server::journal::{JournalManifest, JournalStore};
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
use std::path::Path;

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case")]
enum Command {
    Begin {
        game: String,
        writer: String,
        manifest: JournalManifest,
    },
    Claim {
        game: String,
        writer: String,
        epoch: i64,
    },
    Append {
        game: String,
        writer: String,
        epoch: i64,
        batch: String,
    },
    Read {
        game: String,
        after: i64,
        limit: usize,
    },
}

fn execute(store: &mut JournalStore, command: Command) -> Result<Value, String> {
    match command {
        Command::Begin {
            game,
            writer,
            manifest,
        } => serde_json::to_value(store.begin(&game, &writer, &manifest)?),
        Command::Claim {
            game,
            writer,
            epoch,
        } => serde_json::to_value(store.claim(&game, &writer, epoch)?),
        Command::Append {
            game,
            writer,
            epoch,
            batch,
        } => serde_json::to_value(store.append(&game, &writer, epoch, &batch)?),
        Command::Read { game, after, limit } => {
            serde_json::to_value(store.read(&game, after, limit)?)
        }
    }
    .map_err(|error| error.to_string())
}

fn main() {
    let path = std::env::args().nth(1).expect("journal database path");
    let mut store = JournalStore::open(Path::new(&path)).expect("open journal database");
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    for line in stdin.lock().lines() {
        let result = line
            .map_err(|error| error.to_string())
            .and_then(|line| serde_json::from_str(&line).map_err(|error| error.to_string()))
            .and_then(|command| execute(&mut store, command));
        let response = match result {
            Ok(value) => json!({ "ok": true, "result": value }),
            Err(error) => json!({ "ok": false, "error": error }),
        };
        writeln!(stdout, "{response}").unwrap();
        stdout.flush().unwrap();
    }
}
