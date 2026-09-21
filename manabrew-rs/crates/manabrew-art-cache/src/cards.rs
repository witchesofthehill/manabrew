//! The card data beside the art: one Scryfall record per file, keyed by name.
//!
//! A cache of pictures is not enough to play offline: the client learns a
//! card's image url from `api.scryfall.com`, so with no internet it cannot name
//! the file it already has. The bulk file the every-card download streams
//! carries every record, and a deck download carries the ones that deck needs,
//! so both write here and neither has to rewrite the other's work.
//!
//! One file per record for the same reason the art is one file per key: a
//! request maps straight to a file, and a second writer is an added file rather
//! than a rebuilt table.

use std::io::Read;
use std::path::{Path, PathBuf};

pub const CARDS_DIR: &str = "card-data";
const PRINTINGS_DIR: &str = "printings";
const RULINGS_DIR: &str = "rulings";
pub const SETS_FILE: &str = "sets.json";
pub const NAMES_FILE: &str = "card-names.json";

/// Beside the art but not art: the eviction sweep must skip them.
pub const NON_ART_FILES: [&str; 2] = [SETS_FILE, NAMES_FILE];

/// Long enough for every real card name, short enough for every filesystem.
const MAX_KEY_BYTES: usize = 180;

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

/// Reversible, so two different cards can never land on one file. A name that
/// encodes past what a filesystem accepts keeps a prefix and a hash of the
/// whole, which is still one file per name.
pub fn file_key(name: &str) -> String {
    let normalized = lookup_key(name);
    let mut key = String::with_capacity(normalized.len());
    for byte in normalized.bytes() {
        match byte {
            b'a'..=b'z' | b'0'..=b'9' | b'.' | b'-' => key.push(byte as char),
            b' ' => key.push('_'),
            _ => key.push_str(&format!("%{byte:02x}")),
        }
    }
    if key.len() > MAX_KEY_BYTES {
        // Ascii by construction, so this cannot split a character.
        key.truncate(MAX_KEY_BYTES - 17);
        key.push_str(&format!("-{:016x}", fnv1a(normalized.as_bytes())));
    }
    key
}

fn fnv1a(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in bytes {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100_0000_01b3);
    }
    hash
}

pub struct CardStore {
    dir: PathBuf,
}

impl CardStore {
    /// `root` is the art cache's directory: the data belongs beside the
    /// pictures, so one address serves both and neither can be found without
    /// the other.
    pub fn new(root: &Path) -> Self {
        Self {
            dir: root.join(CARDS_DIR),
        }
    }

    /// The record exactly as Scryfall wrote it, so no field the client reads
    /// can be lost in a translation here.
    pub fn read(&self, name: &str) -> Option<Vec<u8>> {
        read_file(&self.path_for(name))
    }

    /// The exact printing a deck names, when the record that was stored is that
    /// printing. The every-card download stores one printing per card, so this
    /// answers for a deck whose art was downloaded and misses otherwise, which
    /// is a miss the caller already handles.
    pub fn read_printing(&self, set: &str, collector_number: &str) -> Option<Vec<u8>> {
        read_file(
            &self
                .dir
                .join(PRINTINGS_DIR)
                .join(format!("{}.json", printing_key(set, collector_number))),
        )
    }

    pub fn read_rulings(&self, oracle_id: &str) -> Option<Vec<u8>> {
        read_file(
            &self
                .dir
                .join(RULINGS_DIR)
                .join(format!("{}.json", file_key(oracle_id))),
        )
    }

    /// Written under the card's own name, under each face's, because a
    /// double-faced card is asked for both ways, and under its printing.
    /// Renamed into place, so a half-written record is never served.
    pub fn store(&self, record: &str, card: &serde_json::Value) -> std::io::Result<()> {
        let Some(name) = card.get("name").and_then(|n| n.as_str()) else {
            return Ok(());
        };
        std::fs::create_dir_all(&self.dir)?;
        for key in keys_for(name, card) {
            write_file(&self.dir.join(format!("{key}.json")), record.as_bytes())?;
        }
        let printing = card
            .get("set")
            .and_then(|s| s.as_str())
            .zip(card.get("collector_number").and_then(|n| n.as_str()));
        if let Some((set, number)) = printing {
            let dir = self.dir.join(PRINTINGS_DIR);
            std::fs::create_dir_all(&dir)?;
            write_file(
                &dir.join(format!("{}.json", printing_key(set, number))),
                record.as_bytes(),
            )?;
        }
        Ok(())
    }

    pub fn store_rulings(&self, oracle_id: &str, rulings: &str) -> std::io::Result<()> {
        let dir = self.dir.join(RULINGS_DIR);
        std::fs::create_dir_all(&dir)?;
        write_file(
            &dir.join(format!("{}.json", file_key(oracle_id))),
            rulings.as_bytes(),
        )
    }

    /// How many cards this machine can describe with no internet. Faces are
    /// files of their own, so this counts a little high on double-faced cards
    /// and is only ever shown as a rough size.
    pub fn count(&self) -> usize {
        std::fs::read_dir(&self.dir)
            .map(|entries| {
                entries
                    .flatten()
                    .filter(|entry| entry.path().extension().is_some_and(|e| e == "json"))
                    .count()
            })
            .unwrap_or(0)
    }

    fn path_for(&self, name: &str) -> PathBuf {
        self.dir.join(format!("{}.json", file_key(name)))
    }
}

fn read_file(path: &Path) -> Option<Vec<u8>> {
    let mut file = std::fs::File::open(path).ok()?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).ok()?;
    Some(bytes)
}

fn write_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let temp = path.with_extension("part");
    std::fs::write(&temp, bytes)?;
    std::fs::rename(&temp, path)
}

fn printing_key(set: &str, collector_number: &str) -> String {
    file_key(&format!("{set}-{collector_number}"))
}

fn keys_for(name: &str, card: &serde_json::Value) -> Vec<String> {
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
    let mut keys = vec![file_key(name)];
    for face in faces {
        let key = file_key(face);
        if !keys.contains(&key) {
            keys.push(key);
        }
    }
    keys
}

/// Everything this cache can be asked for. Nothing from a request is used to
/// build a path — the store builds one from scratch — so the shaping here is
/// dropping the query, refusing something absurd, and nothing else.
#[derive(Debug, PartialEq, Eq)]
pub enum CacheRequest {
    Card(String),
    /// A set and a collector number: the exact printing a deck asked for.
    Printing(String, String),
    Sets,
    /// Every name, which is all a name-keyed cache can offer a search.
    Names,
    Rulings(String),
}

pub fn parse_request(path: &str) -> Option<CacheRequest> {
    let path = path.trim_start_matches('/');
    let path = path.split(['?', '#']).next().unwrap_or("");
    if path.len() > 512 {
        return None;
    }
    if path == "scryfall-sets" {
        return Some(CacheRequest::Sets);
    }
    if path == "scryfall-names" {
        return Some(CacheRequest::Names);
    }
    if let Some(id) = path.strip_prefix("scryfall-rulings/") {
        return (!id.is_empty()).then(|| CacheRequest::Rulings(percent_decode(id)));
    }
    let card = path.strip_prefix("scryfall-card/")?;
    if card.is_empty() {
        return None;
    }
    // A name is percent-encoded by the client, so a bare slash can only be the
    // set and collector number form.
    match card.split_once('/') {
        Some((set, number)) if !set.is_empty() && !number.is_empty() => Some(
            CacheRequest::Printing(percent_decode(set), percent_decode(number)),
        ),
        Some(_) => None,
        None => Some(CacheRequest::Card(percent_decode(card))),
    }
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

    fn store(root: &Path, records: &[&str]) -> CardStore {
        let store = CardStore::new(root);
        for record in records {
            let card = serde_json::from_str(record).expect("card json");
            store.store(record, &card).expect("store");
        }
        store
    }

    #[test]
    fn a_name_reads_back_the_record_it_was_written_from() {
        let dir = tempfile::tempdir().expect("temp dir");
        let records = [
            r#"{"name":"Llanowar Elves","image_uris":{"normal":"a.jpg"}}"#,
            r#"{"name":"Lightning Bolt","image_uris":{"normal":"b.jpg"}}"#,
        ];
        let store = store(dir.path(), &records);

        assert_eq!(store.count(), 2);
        let bolt = store.read("lightning BOLT").expect("bolt");
        assert_eq!(String::from_utf8_lossy(&bolt), records[1]);
        assert!(store.read("Black Lotus").is_none());
    }

    /// A deck download writes what that deck needs, long after the every-card
    /// download wrote everything, and must not disturb it.
    #[test]
    fn a_second_writer_adds_to_what_the_first_left() {
        let dir = tempfile::tempdir().expect("temp dir");
        store(dir.path(), &[r#"{"name":"Llanowar Elves"}"#]);
        let store = store(dir.path(), &[r#"{"name":"Lightning Bolt"}"#]);

        assert!(store.read("Llanowar Elves").is_some());
        assert!(store.read("Lightning Bolt").is_some());
    }

    #[test]
    fn a_double_faced_card_answers_to_either_face() {
        let dir = tempfile::tempdir().expect("temp dir");
        let record = r#"{"name":"Fable of the Mirror-Breaker // Reflection of Kiki-Jiki","card_faces":[{"name":"Fable of the Mirror-Breaker"},{"name":"Reflection of Kiki-Jiki"}]}"#;
        let store = store(dir.path(), &[record]);

        for name in [
            "Fable of the Mirror-Breaker // Reflection of Kiki-Jiki",
            "Fable of the Mirror-Breaker/Reflection of Kiki-Jiki",
            "Fable of the Mirror-Breaker",
            "reflection of kiki-jiki",
        ] {
            assert!(store.read(name).is_some(), "{name}");
        }
    }

    /// Two cards sharing a file would serve one under the other's name.
    #[test]
    fn a_key_is_reversible_and_fits_a_filesystem() {
        assert_ne!(file_key("Aether Vial"), file_key("Æther Vial"));
        assert_ne!(
            file_key("Jace, the Mind Sculptor"),
            file_key("Jace the Mind")
        );
        assert_eq!(file_key("Sword of Fire and Ice"), "sword_of_fire_and_ice");

        let long = "Our Market Research Shows That Players Like Really Long Card Names So We Made this Card to Have the Absolute Longest Card Name Ever Elemental";
        let key = file_key(long);
        assert!(key.len() <= MAX_KEY_BYTES, "{}", key.len());
        assert_ne!(key, file_key(&format!("{long} II")));
    }

    #[test]
    fn a_request_path_says_what_is_being_asked_for() {
        use CacheRequest::*;
        assert_eq!(
            parse_request("/scryfall-card/Lightning%20Bolt"),
            Some(Card("Lightning Bolt".into()))
        );
        assert_eq!(
            parse_request("/scryfall-card/Fable%20of%20the%20Mirror-Breaker%20%2F%2F%20Reflection%20of%20Kiki-Jiki?x=1"),
            Some(Card("Fable of the Mirror-Breaker // Reflection of Kiki-Jiki".into()))
        );
        assert_eq!(
            parse_request("/scryfall-card/mh2/123"),
            Some(Printing("mh2".into(), "123".into()))
        );
        assert_eq!(parse_request("/scryfall-sets"), Some(Sets));
        assert_eq!(parse_request("/scryfall-names"), Some(Names));
        assert_eq!(
            parse_request("/scryfall-rulings/4c0a1b4d"),
            Some(Rulings("4c0a1b4d".into()))
        );
        assert_eq!(parse_request("/scryfall-card/"), None);
        assert_eq!(parse_request("/scryfall-img/a/b.jpg"), None);
    }

    /// The printing a deck asks for, when the record that was kept is it.
    #[test]
    fn a_set_and_number_read_back_the_printing_they_were_written_from() {
        let dir = tempfile::tempdir().expect("temp dir");
        let record =
            r#"{"name":"Lightning Bolt","set":"MH2","collector_number":"123","lang":"en"}"#;
        let store = store(dir.path(), &[record]);

        assert_eq!(
            String::from_utf8_lossy(&store.read_printing("mh2", "123").expect("printing")),
            record
        );
        assert!(store.read_printing("MH2", "123").is_some(), "case folded");
        assert!(store.read_printing("mh2", "124").is_none());
        assert_eq!(store.count(), 1, "a printing is not a second card");
    }

    #[test]
    fn rulings_read_back_under_the_oracle_id_they_were_written_for() {
        let dir = tempfile::tempdir().expect("temp dir");
        let store = CardStore::new(dir.path());
        let body = r#"{"object":"list","has_more":false,"data":[]}"#;
        store
            .store_rulings("4c0a1b4d-1e0a-4e0a-9e0a-1b4d4c0a1b4d", body)
            .expect("store");

        assert_eq!(
            String::from_utf8_lossy(
                &store
                    .read_rulings("4C0A1B4D-1E0A-4E0A-9E0A-1B4D4C0A1B4D")
                    .expect("rulings")
            ),
            body
        );
        assert!(store.read_rulings("nothing-like-it").is_none());
    }

    /// A traversal cannot get out of the directory, because nothing from the
    /// request is used to build the path.
    #[test]
    fn a_request_cannot_leave_the_card_directory() {
        let dir = tempfile::tempdir().expect("temp dir");
        let store = store(dir.path(), &[r#"{"name":"Llanowar Elves"}"#]);
        for name in ["../../etc/passwd", "..", "/etc/passwd"] {
            assert!(store.read(name).is_none(), "{name}");
        }
        assert!(!dir.path().join("etc").exists());
    }
}
