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

/// Name a card script the way Forge does, because with lazily loaded card
/// scripts the *filename* is how Forge finds a card: it strips the accents and
/// transforms the name (`CardStorageReader.attemptToLoadCard`), then looks for
/// that base name. A file written under any other spelling is invisible, and
/// the game reports the card as unsupported — which is what happened to
/// "Lim-Dûl's Vault" and "Palantír of Orthanc".
fn script_name(name_lower: &str) -> String {
    let mut out = String::with_capacity(name_lower.len());
    for ch in strip_accents(name_lower) {
        let ch = ch.to_ascii_lowercase();
        if ch == '\'' {
            continue;
        }
        if ch.is_ascii_lowercase() || ch.is_ascii_digit() {
            out.push(ch);
            continue;
        }
        if out.ends_with('_') {
            continue;
        }
        // A comma inside a number is dropped, not separated: "Borrowing
        // 100,000 Arrows".
        if ch == ',' && out.chars().last().is_some_and(|prev| prev.is_ascii_digit()) {
            continue;
        }
        out.push('_');
    }
    while out.ends_with('_') {
        out.pop();
    }
    out
}

/// The ASCII letter behind an accented one, as Apache Commons'
/// `StringUtils.stripAccents` gives Forge: decompose, then drop the combining
/// marks. Anything with no ASCII behind it is left for `script_name` to turn
/// into a separator.
fn strip_accents(name: &str) -> impl Iterator<Item = char> + '_ {
    name.chars().filter_map(|ch| match ch {
        // Combining diacritical marks, i.e. an already-decomposed spelling.
        '\u{0300}'..='\u{036f}' => None,
        'à'..='å' | 'À'..='Å' => Some('a'),
        'è'..='ë' | 'È'..='Ë' => Some('e'),
        'ì'..='ï' | 'Ì'..='Ï' => Some('i'),
        'ò'..='ö' | 'Ò'..='Ö' | 'ø' | 'Ø' => Some('o'),
        'ù'..='ü' | 'Ù'..='Ü' => Some('u'),
        'ç' | 'Ç' => Some('c'),
        'ñ' | 'Ñ' => Some('n'),
        'ý' | 'ÿ' | 'Ý' => Some('y'),
        _ => Some(ch),
    })
}

fn push(out: &mut String, path: &str, body: &str) {
    out.push_str(path);
    out.push('\0');
    out.push_str(body);
    out.push('\0');
}

/// Map every flavor name an edition file carries to the card Forge files it
/// under, both lowercased.
///
/// The lines look like
/// `40 U Lightning Bolt @Toshitaka Matsuda ${"flavorName": "Thrum of the Vestige"}`:
/// collector number, rarity, card name, optional artist, optional JSON tail.
fn flavor_name_index<'a>(
    editions: impl Iterator<Item = &'a str>,
) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();
    for raw in editions {
        for line in raw.lines() {
            let Some((head, tail)) = line.split_once("${") else {
                continue;
            };
            let Some(flavor) = json_string_field(tail, "flavorName") else {
                continue;
            };
            // Drop the collector number and the rarity, then the artist.
            let mut fields = head.splitn(3, char::is_whitespace);
            let (Some(_), Some(_), Some(rest)) = (fields.next(), fields.next(), fields.next())
            else {
                continue;
            };
            let name = rest.split('@').next().unwrap_or(rest).trim();
            if !name.is_empty() {
                out.insert(flavor.to_ascii_lowercase(), name.to_ascii_lowercase());
            }
        }
    }
    out
}

/// The value of one string field, without pulling in a JSON parser for a tail
/// this small.
fn json_string_field(tail: &str, field: &str) -> Option<String> {
    let key = format!("\"{field}\"");
    let after = tail.split_once(&key)?.1;
    let after = after.split_once(':')?.1;
    let start = after.find('"')? + 1;
    let value = &after[start..];
    let end = value.find('"')?;
    Some(value[..end].to_string())
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

    let mut filter: Option<std::collections::HashSet<String>> = if wanted.is_empty() {
        None
    } else {
        Some(wanted.iter().map(|n| n.to_ascii_lowercase()).collect())
    };

    // A deck can name an alt-art printing by its Scryfall flavor name — FCA #40
    // is a Lightning Bolt called "Thrum of the Vestige" — and that name matches
    // no card script. The engine resolves the name at deck build (see
    // ManaBrewEngineAdapter.resolveFlavorName), so the script it then asks for
    // has to be in the bundle: without this the browser hands Forge a deck it
    // cannot build even though the JVM path is fine.
    if let Some(keep) = filter.as_mut() {
        let known: std::collections::HashSet<&str> = archive
            .cards
            .iter()
            .map(|card| card.name_lower.as_str())
            .collect();
        let unknown: Vec<String> = keep
            .iter()
            .filter(|name| !known.contains(name.as_str()))
            .cloned()
            .collect();
        if !unknown.is_empty() {
            let flavors = flavor_name_index(archive.editions.iter().map(|e| e.raw.as_str()));
            for name in unknown {
                if let Some(real) = flavors.get(&name) {
                    keep.insert(real.clone());
                }
            }
        }
    }
    let filter = filter;

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

#[cfg(test)]
mod tests {
    use super::flavor_name_index;

    const FCA: &str = concat!(
        "39 U Light Up the Stage @Square Enix ${\"flavorName\": \"A Promise Fulfilled\"}\n",
        "40 U Lightning Bolt @Toshitaka Matsuda ${\"flavorName\": \"Thrum of the Vestige\"}\n",
        "41 R Mizzix's Mastery @Toshitaka Matsuda ${\"flavorName\": \"Dawn Warriors' Legacy\"}\n",
        "42 M Najeela, the Blade-Blossom\n",
    );

    #[test]
    fn maps_a_flavor_name_to_the_card_forge_knows() {
        let index = flavor_name_index([FCA].into_iter());
        assert_eq!(
            index.get("thrum of the vestige").map(String::as_str),
            Some("lightning bolt")
        );
        assert_eq!(
            index.get("dawn warriors' legacy").map(String::as_str),
            Some("mizzix's mastery")
        );
        // A line with no flavor tail is not an entry.
        assert!(!index.values().any(|name| name.contains("najeela")));
    }

    #[test]
    fn files_an_accented_card_where_forge_looks_for_it() {
        // The real filenames in Forge's cardsfolder.
        assert_eq!(super::script_name("lim-dûl's vault"), "lim_duls_vault");
        assert_eq!(super::script_name("palantír of orthanc"), "palantir_of_orthanc");
        // The same names spelled with combining marks instead.
        assert_eq!(super::script_name("lim-du\u{0302}l's vault"), "lim_duls_vault");
        assert_eq!(super::script_name("palanti\u{0301}r of orthanc"), "palantir_of_orthanc");
        // Unaccented names are unchanged, and a number keeps its comma out.
        assert_eq!(super::script_name("lightning bolt"), "lightning_bolt");
        assert_eq!(super::script_name("borrowing 100,000 arrows"), "borrowing_100000_arrows");
    }

    #[test]
    fn tolerates_a_line_with_no_artist() {
        let index = flavor_name_index(
            ["7 R Sheoldred, the Apocalypse ${\"flavorName\": \"Khan, Engineered Evil\"}"]
                .into_iter(),
        );
        assert_eq!(
            index.get("khan, engineered evil").map(String::as_str),
            Some("sheoldred, the apocalypse")
        );
    }
}
