//! Frames Forge's whole asset tree out of the shared rkyv card archive.
//!
//! The framing is `path\0body\0…`, which `WasmMain.writeFramed` unpacks
//! into the in-memory filesystem.

use crate::{load_checked, ArchivedCardArchive};

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
        'ý'..='ÿ' | 'Ý'..='Ý' => Some('y'),
        _ => Some(ch),
    })
}

fn push(out: &mut String, path: &str, body: &str) {
    out.push_str(path);
    out.push('\0');
    out.push_str(body);
    out.push('\0');
}

fn for_each_asset<'a>(archive: &'a ArchivedCardArchive, mut visit: impl FnMut(String, &'a str)) {
    for card in archive.cards.iter() {
        let file = script_name(card.name_lower.as_str());
        let Some(letter) = file.chars().next() else {
            continue;
        };
        visit(
            format!("res/cardsfolder/{letter}/{file}.txt"),
            card.raw.as_str(),
        );
    }

    for token in archive.tokens.iter() {
        let file = script_name(token.name_lower.as_str());
        if file.is_empty() {
            continue;
        }
        visit(format!("res/tokenscripts/{file}.txt"), token.raw.as_str());
    }

    for edition in archive.editions.iter() {
        // The archive stores file stems, and Forge's readers filter on .txt.
        visit(
            format!("res/editions/{}.txt", edition.name.as_str()),
            edition.raw.as_str(),
        );
    }

    for block in archive.block_data.iter() {
        visit(
            format!("res/blockdata/{}.txt", block.name.as_str()),
            block.raw.as_str(),
        );
    }

    visit(
        "res/lists/TypeLists.txt".to_string(),
        archive.type_lists.as_str(),
    );

    // formats/, defaults/, effects/ and the rest of lists/ — FModel.initialize
    // reads all of them and throws without them.
    for extra in archive.extras.iter() {
        visit(format!("res/{}", extra.path.as_str()), extra.raw.as_str());
    }
}

fn frame_and_index<'a>(entries: impl Iterator<Item = (String, &'a str)>) -> (String, String) {
    use std::fmt::Write;
    let mut blob = String::with_capacity(64 << 20);
    let mut index = String::new();
    for (path, body) in entries {
        let body_offset = blob.len() + path.len() + 1;
        push(&mut blob, &path, body);
        let _ = writeln!(index, "{path}\t{body_offset}\t{}", body.len());
    }
    (blob, index)
}

/// Build the NUL-framed asset bundle the Wasm Forge build embeds and unpacks
/// at boot. Every card ships: the lazy name index Forge builds from the
/// cardsfolder is then complete, so no deck-time guessing about which scripts
/// might be needed can miss.
pub fn forge_asset_bundle(bytes: &[u8]) -> Result<String, String> {
    let archive = load_checked(bytes)?;
    let mut blob = String::with_capacity(64 << 20);
    for_each_asset(archive, |path, body| push(&mut blob, &path, body));
    Ok(blob)
}

/// The same bundle, plus a `path\toffset\tlen\n` index whose offsets and
/// lengths are byte ranges of each body within the blob. A reader that keeps
/// only the index can seek to a card's body and read it on demand, so the
/// whole tree never has to be unpacked into a filesystem to be addressable.
pub fn forge_asset_bundle_indexed(bytes: &[u8]) -> Result<(String, String), String> {
    let archive = load_checked(bytes)?;
    let mut entries: Vec<(String, &str)> = Vec::new();
    for_each_asset(archive, |path, body| entries.push((path, body)));
    Ok(frame_and_index(entries.into_iter()))
}

#[cfg(test)]
mod tests {
    #[test]
    fn index_offsets_slice_back_the_original_bodies() {
        let entries = vec![
            (
                "res/cardsfolder/l/lightning_bolt.txt".to_string(),
                "Name:Lightning Bolt\nA:SP$ DealDamage\n",
            ),
            (
                "res/cardsfolder/l/lim_duls_vault.txt".to_string(),
                "Name:Lim-Dûl's Vault\nA:AB$ Dig\n",
            ),
            (
                "res/lists/TypeLists.txt".to_string(),
                "Creature\nArtifact\n",
            ),
        ];
        let (blob, index) = super::frame_and_index(entries.iter().map(|(p, b)| (p.clone(), *b)));
        let bytes = blob.as_bytes();
        let lines: Vec<&str> = index.lines().collect();
        assert_eq!(lines.len(), entries.len());
        for (line, (path, body)) in lines.iter().zip(entries.iter()) {
            let mut parts = line.split('\t');
            assert_eq!(parts.next().unwrap(), path);
            let offset: usize = parts.next().unwrap().parse().unwrap();
            let len: usize = parts.next().unwrap().parse().unwrap();
            assert_eq!(&bytes[offset..offset + len], body.as_bytes());
        }
    }

    #[test]
    fn files_an_accented_card_where_forge_looks_for_it() {
        // The real filenames in Forge's cardsfolder.
        assert_eq!(super::script_name("lim-dûl's vault"), "lim_duls_vault");
        assert_eq!(
            super::script_name("palantír of orthanc"),
            "palantir_of_orthanc"
        );
        // The same names spelled with combining marks instead.
        assert_eq!(
            super::script_name("lim-du\u{0302}l's vault"),
            "lim_duls_vault"
        );
        assert_eq!(
            super::script_name("palanti\u{0301}r of orthanc"),
            "palantir_of_orthanc"
        );
        // Unaccented names are unchanged, and a number keeps its comma out.
        assert_eq!(super::script_name("lightning bolt"), "lightning_bolt");
        assert_eq!(
            super::script_name("borrowing 100,000 arrows"),
            "borrowing_100000_arrows"
        );
    }
}
