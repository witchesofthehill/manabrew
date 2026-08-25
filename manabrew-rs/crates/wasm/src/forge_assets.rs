//! Serves Forge's asset tree straight out of the rkyv card archive.
//!
//! `cardset.rkyv` already carries exactly what `FModel.initialize` reads — raw
//! card scripts, token scripts, edition files, block data and `TypeLists.txt` —
//! and the client already downloads and caches it for the Rust engine. Shipping
//! a second copy for the Wasm Forge build would duplicate ~15MB for no reason.
//!
//! Forge cannot read rkyv and cannot share linear memory with this module, so
//! the bytes have to cross through JS as a string. The framing is
//! `path\0body\0…`, which is what `WasmMain.writeFramed` unpacks into the
//! in-memory filesystem.

use forge_cardset_archive::load_checked;
use wasm_bindgen::prelude::*;

/// Name a card script by the same rule Forge files them under: lowercase, no
/// punctuation, underscores between words.
fn script_name(name_lower: &str) -> String {
    let mut out = String::with_capacity(name_lower.len());
    let mut pending_sep = false;
    for ch in name_lower.chars() {
        if ch.is_ascii_alphanumeric() {
            if pending_sep && !out.is_empty() {
                out.push('_');
            }
            pending_sep = false;
            out.push(ch);
        } else if ch == '\'' || ch == '"' || ch == ',' || ch == '.' {
            // Dropped outright rather than turned into a separator.
        } else {
            pending_sep = true;
        }
    }
    out
}

fn push(out: &mut String, path: &str, body: &str) {
    out.push_str(path);
    out.push('\0');
    out.push_str(body);
    out.push('\0');
}

/// Build the NUL-framed asset bundle the Wasm Forge build unpacks at boot.
///
/// `wanted` restricts the card scripts to the names actually in play. Forge
/// reads its whole cardsfolder at init, so shipping all 33k scripts costs
/// seconds of boot for cards no game will touch; pass the decks' names and it
/// stays a few hundred KB. An empty list means every card.
#[wasm_bindgen]
pub fn forge_asset_bundle(bytes: &[u8], wanted: Vec<String>) -> Result<String, JsError> {
    let archive = load_checked(bytes).map_err(|e| JsError::new(&e))?;

    let filter: Option<std::collections::HashSet<String>> = if wanted.is_empty() {
        None
    } else {
        Some(wanted.iter().map(|n| n.to_ascii_lowercase()).collect())
    };

    let mut out = String::with_capacity(if filter.is_some() { 1 << 20 } else { bytes.len() * 2 });

    for card in archive.cards.iter() {
        if let Some(keep) = &filter {
            if !keep.contains(card.name_lower.as_str()) {
                continue;
            }
        }
        let file = script_name(card.name_lower.as_str());
        let Some(letter) = file.chars().next() else {
            continue;
        };
        push(
            &mut out,
            &format!("res/cardsfolder/{letter}/{file}.txt"),
            card.raw.as_str(),
        );
    }

    for token in archive.tokens.iter() {
        let file = script_name(token.name_lower.as_str());
        if file.is_empty() {
            continue;
        }
        push(
            &mut out,
            &format!("res/tokenscripts/{file}.txt"),
            token.raw.as_str(),
        );
    }

    for edition in archive.editions.iter() {
        push(
            &mut out,
            // The archive stores file stems, and Forge's readers filter on .txt.
            &format!("res/editions/{}.txt", edition.name.as_str()),
            edition.raw.as_str(),
        );
    }

    for block in archive.block_data.iter() {
        push(
            &mut out,
            &format!("res/blockdata/{}.txt", block.name.as_str()),
            block.raw.as_str(),
        );
    }

    push(
        &mut out,
        "res/lists/TypeLists.txt",
        archive.type_lists.as_str(),
    );

    // formats/, defaults/, effects/ and the rest of lists/ — FModel.initialize
    // reads all of them and throws without them.
    for extra in archive.extras.iter() {
        push(
            &mut out,
            &format!("res/{}", extra.path.as_str()),
            extra.raw.as_str(),
        );
    }

    Ok(out)
}
