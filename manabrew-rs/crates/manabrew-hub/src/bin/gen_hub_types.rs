//! Generates the hub REST API's TypeScript types via ts-rs:
//!
//!   cargo run -p manabrew-hub --no-default-features --bin gen-hub-types -- <out-dir>
//!
//! `Deck`/`DeckFormat` fields are emitted as bare references and resolved by
//! the prepended import from the canonical generated protocol types.
use std::fs;
use std::path::PathBuf;

use manabrew_hub::dto::{
    HubDeckDetail, HubDeckList, HubDeckSummary, PublishDeckRequest, PublishDeckResponse,
    TopDeckStat,
};
use ts_rs::TS;

const DECK_IMPORT: &str = "import type { Deck, DeckFormat } from \"@/protocol/deck\";\n\n";

fn main() {
    let out = PathBuf::from(
        std::env::args()
            .nth(1)
            .unwrap_or_else(|| "bindings".to_string()),
    );
    PublishDeckRequest::export_all_to(&out).expect("export PublishDeckRequest");
    PublishDeckResponse::export_all_to(&out).expect("export PublishDeckResponse");
    HubDeckSummary::export_all_to(&out).expect("export HubDeckSummary");
    HubDeckList::export_all_to(&out).expect("export HubDeckList");
    HubDeckDetail::export_all_to(&out).expect("export HubDeckDetail");
    TopDeckStat::export_all_to(&out).expect("export TopDeckStat");

    let path = out.join("hubTypes.ts");
    let generated = fs::read_to_string(&path).expect("read hubTypes.ts");
    fs::write(&path, format!("{DECK_IMPORT}{generated}")).expect("write hubTypes.ts");
}
