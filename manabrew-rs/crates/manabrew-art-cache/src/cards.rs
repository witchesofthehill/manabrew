//! The card data beside the art, keyed by name.
//!
//! A cache of pictures is not enough to play offline: the client learns a
//! card's image url from `api.scryfall.com`, so with no internet it cannot name
//! the file it already has. The bulk file the art download already streams
//! carries every record, so this keeps them: one line per card in `cards.jsonl`
//! and a name to (offset, length) table beside it, which is what lets a lookup
//! seek instead of holding 38k cards in memory.

use std::collections::HashMap;
use std::io::{BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub const CARDS_FILE: &str = "cards.jsonl";
pub const OFFSETS_FILE: &str = "cards.idx";

/// Names arrive from decks, the engine and other people's keyboards. Case and
/// the spacing around a double-faced card's `//` are the differences worth
/// forgiving; nothing else is.
pub fn lookup_key(name: &str) -> String {
    name.trim()
        .to_lowercase()
        .split('/')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" // ")
}

pub struct CardIndex {
    root: PathBuf,
    offsets: OnceLock<HashMap<String, (u64, u32)>>,
}

impl CardIndex {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            offsets: OnceLock::new(),
        }
    }

    /// The raw Scryfall record, exactly as the bulk file had it, so no field
    /// the client reads can be lost in a translation here.
    pub fn read(&self, name: &str) -> Option<Vec<u8>> {
        let &(offset, len) = self.offsets().get(&lookup_key(name))?;
        let mut file = std::fs::File::open(self.root.join(CARDS_FILE)).ok()?;
        file.seek(SeekFrom::Start(offset)).ok()?;
        let mut bytes = vec![0u8; len as usize];
        file.read_exact(&mut bytes).ok()?;
        Some(bytes)
    }

    pub fn len(&self) -> usize {
        self.offsets().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Read once. An absent or half-written table is an empty one, which reads
    /// as "no card data here" rather than an error every caller must handle.
    fn offsets(&self) -> &HashMap<String, (u64, u32)> {
        self.offsets.get_or_init(|| {
            let mut offsets = HashMap::new();
            let Ok(raw) = std::fs::read_to_string(self.root.join(OFFSETS_FILE)) else {
                return offsets;
            };
            for line in raw.lines() {
                let mut fields = line.rsplitn(3, '\t');
                let Some(len) = fields.next().and_then(|f| f.parse::<u32>().ok()) else {
                    continue;
                };
                let Some(offset) = fields.next().and_then(|f| f.parse::<u64>().ok()) else {
                    continue;
                };
                let Some(key) = fields.next() else { continue };
                offsets.insert(key.to_string(), (offset, len));
            }
            offsets
        })
    }
}

/// Written to temporaries and renamed into place together, so a cancelled or
/// crashed download leaves the previous pair whole rather than a table pointing
/// into a file that stops halfway.
pub struct CardIndexWriter {
    root: PathBuf,
    cards: BufWriter<std::fs::File>,
    offsets: BufWriter<std::fs::File>,
    at: u64,
    written: usize,
}

impl CardIndexWriter {
    pub fn create(root: &Path) -> std::io::Result<Self> {
        std::fs::create_dir_all(root)?;
        Ok(Self {
            root: root.to_path_buf(),
            cards: BufWriter::new(std::fs::File::create(temp(root, CARDS_FILE))?),
            offsets: BufWriter::new(std::fs::File::create(temp(root, OFFSETS_FILE))?),
            at: 0,
            written: 0,
        })
    }

    /// Indexed under the full name and under each face's own name, because a
    /// double-faced card is asked for both ways.
    pub fn push(&mut self, line: &str, card: &serde_json::Value) -> std::io::Result<()> {
        let Some(name) = card.get("name").and_then(|n| n.as_str()) else {
            return Ok(());
        };
        let len = line.len() as u32;
        self.cards.write_all(line.as_bytes())?;
        self.cards.write_all(b"\n")?;

        let faces = card
            .get("card_faces")
            .and_then(|f| f.as_array())
            .map(|faces| {
                faces
                    .iter()
                    .filter_map(|face| face.get("name").and_then(|n| n.as_str()))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let mut keys = vec![lookup_key(name)];
        for face in faces {
            let key = lookup_key(face);
            if !keys.contains(&key) {
                keys.push(key);
            }
        }
        for key in keys {
            writeln!(self.offsets, "{key}\t{at}\t{len}", at = self.at)?;
        }
        self.at += len as u64 + 1;
        self.written += 1;
        Ok(())
    }

    pub fn finish(mut self) -> std::io::Result<usize> {
        self.cards.flush()?;
        self.offsets.flush()?;
        for file in [CARDS_FILE, OFFSETS_FILE] {
            std::fs::rename(temp(&self.root, file), self.root.join(file))?;
        }
        Ok(self.written)
    }
}

fn temp(root: &Path, file: &str) -> PathBuf {
    root.join(format!("{file}.part"))
}

/// The name a `/scryfall-card/` request is asking for, percent-decoded. No path
/// is built from it — the lookup is a table — so the only shaping needed is
/// dropping the query and refusing something absurdly long.
pub fn name_from_request_path(path: &str) -> Option<String> {
    let raw = path
        .trim_start_matches('/')
        .strip_prefix("scryfall-card/")?
        .split(['?', '#'])
        .next()
        .unwrap_or("");
    if raw.is_empty() || raw.len() > 512 {
        return None;
    }
    Some(percent_decode(raw))
}

fn percent_decode(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                match u8::from_str_radix(&raw[i + 1..i + 3], 16) {
                    Ok(byte) => {
                        out.push(byte);
                        i += 3;
                    }
                    Err(_) => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
                continue;
            }
            b'+' => out.push(b' '),
            byte => out.push(byte),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, lines: &[&str]) -> usize {
        let mut writer = CardIndexWriter::create(root).expect("writer");
        for line in lines {
            let card = serde_json::from_str(line).expect("card json");
            writer.push(line, &card).expect("push");
        }
        writer.finish().expect("finish")
    }

    #[test]
    fn a_name_reads_back_the_line_it_was_written_from() {
        let dir = tempfile::tempdir().expect("temp dir");
        let lines = [
            r#"{"name":"Llanowar Elves","image_uris":{"normal":"a.jpg"}}"#,
            r#"{"name":"Lightning Bolt","image_uris":{"normal":"b.jpg"}}"#,
        ];
        assert_eq!(write(dir.path(), &lines), 2);

        let index = CardIndex::new(dir.path().to_path_buf());
        assert_eq!(index.len(), 2);
        let bolt = index.read("lightning BOLT").expect("bolt");
        assert_eq!(String::from_utf8_lossy(&bolt), lines[1]);
        assert!(index.read("Black Lotus").is_none());
    }

    #[test]
    fn a_double_faced_card_answers_to_either_face() {
        let dir = tempfile::tempdir().expect("temp dir");
        let line = r#"{"name":"Fable of the Mirror-Breaker // Reflection of Kiki-Jiki","card_faces":[{"name":"Fable of the Mirror-Breaker"},{"name":"Reflection of Kiki-Jiki"}]}"#;
        write(dir.path(), &[line]);

        let index = CardIndex::new(dir.path().to_path_buf());
        for name in [
            "Fable of the Mirror-Breaker // Reflection of Kiki-Jiki",
            "Fable of the Mirror-Breaker/Reflection of Kiki-Jiki",
            "Fable of the Mirror-Breaker",
            "reflection of kiki-jiki",
        ] {
            assert!(index.read(name).is_some(), "{name}");
        }
    }

    /// The table and the file it points into must never be replaced apart: a
    /// reader between the two renames would seek into the wrong card.
    #[test]
    fn an_unfinished_write_leaves_the_previous_pair_whole() {
        let dir = tempfile::tempdir().expect("temp dir");
        write(dir.path(), &[r#"{"name":"Llanowar Elves"}"#]);

        let mut writer = CardIndexWriter::create(dir.path()).expect("writer");
        let line = r#"{"name":"Lightning Bolt"}"#;
        writer
            .push(line, &serde_json::from_str(line).expect("json"))
            .expect("push");
        drop(writer);

        let index = CardIndex::new(dir.path().to_path_buf());
        assert!(index.read("Llanowar Elves").is_some());
        assert!(index.read("Lightning Bolt").is_none());
    }

    #[test]
    fn a_request_path_names_a_card() {
        assert_eq!(
            name_from_request_path("/scryfall-card/Lightning%20Bolt").as_deref(),
            Some("Lightning Bolt")
        );
        assert_eq!(
            name_from_request_path("/scryfall-card/Fable%20of%20the%20Mirror-Breaker%20%2F%2F%20Reflection%20of%20Kiki-Jiki?x=1").as_deref(),
            Some("Fable of the Mirror-Breaker // Reflection of Kiki-Jiki")
        );
        assert_eq!(name_from_request_path("/scryfall-card/"), None);
        assert_eq!(name_from_request_path("/scryfall-img/a/b.jpg"), None);
    }
}
