use std::collections::HashMap;
use std::sync::Mutex;

use deunicode::deunicode;
use forge_cardset_archive::ArchivedCardArchive;

use crate::card_rules::CardRules;
use crate::parser::CardScriptParser;

pub struct CardDatabase {
    cards: Mutex<HashMap<String, &'static CardRules>>,
    archive: Option<&'static ArchivedCardArchive>,
    parser: Mutex<CardScriptParser>,
    lazy_failures: Mutex<usize>,
    normalized_names: HashMap<String, String>,
    flavor_name_aliases: HashMap<String, String>,
    flavor_name_aliases_normalized: HashMap<String, String>,
    token_art_variants: HashMap<(String, String), usize>,
    token_fallback: HashMap<String, String>,
    edition_dates: HashMap<String, String>,
    edition_names: HashMap<String, String>,
    card_default_edition: HashMap<String, String>,
}

impl std::fmt::Debug for CardDatabase {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let parsed_count = self.cards.lock().map(|m| m.len()).unwrap_or_default();
        f.debug_struct("CardDatabase")
            .field("parsed_cards", &parsed_count)
            .field(
                "archive_cards",
                &self.archive.map(|a| a.cards.len()).unwrap_or(0),
            )
            .field("flavor_aliases", &self.flavor_name_aliases.len())
            .finish()
    }
}

/// Result of loading a batch of card scripts.
#[derive(Debug, Default)]
pub struct LoadResult {
    pub loaded: usize,
    pub failed: usize,
    pub errors: Vec<(String, String)>,
}

#[derive(Debug)]
pub struct ArchiveBundle {
    pub cards: CardDatabase,
    pub tokens: CardDatabase,
    pub cards_result: LoadResult,
    pub tokens_result: LoadResult,
}

impl CardDatabase {
    pub fn new() -> Self {
        CardDatabase {
            cards: Mutex::new(HashMap::new()),
            archive: None,
            parser: Mutex::new(CardScriptParser::new()),
            lazy_failures: Mutex::new(0),
            normalized_names: HashMap::new(),
            flavor_name_aliases: HashMap::new(),
            flavor_name_aliases_normalized: HashMap::new(),
            token_art_variants: HashMap::new(),
            token_fallback: HashMap::new(),
            edition_dates: HashMap::new(),
            edition_names: HashMap::new(),
            card_default_edition: HashMap::new(),
        }
    }

    pub fn len(&self) -> usize {
        if let Some(archive) = self.archive {
            archive.cards.len()
        } else {
            self.cards.lock().map(|m| m.len()).unwrap_or(0)
        }
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn get(&self, name: &str) -> Option<&'static CardRules> {
        if let Some(rules) = self.cards.lock().ok().and_then(|m| m.get(name).copied()) {
            return Some(rules);
        }
        self.lazy_parse_by_lower(name)
    }

    pub fn archive(&self) -> Option<&'static ArchivedCardArchive> {
        self.archive
    }

    pub fn get_by_card_name(&self, card_name: &str) -> Option<&'static CardRules> {
        if let Some(rules) = self.lookup_face(card_name) {
            return Some(rules);
        }
        // Scryfall-style DFC names arrive as `"Front Face // Back Face"`,
        // but Forge stores DFCs under the front face only — the back is
        // inside the same script file. Split-card names like `"Fire // Ice"`
        // do live under the full string and hit the path above. So we only
        // strip the back as a fallback, preserving split-card lookups.
        if let Some((front, _back)) = card_name.split_once(" // ") {
            return self.lookup_face(front);
        }
        None
    }

    fn lookup_face(&self, card_name: &str) -> Option<&'static CardRules> {
        let resolved = self
            .normalized_names
            .get(card_name)
            .map(|s| s.as_str())
            .unwrap_or(card_name);
        let resolved = self.resolve_flavor_alias(resolved);
        let lower = resolved.to_ascii_lowercase();

        if let Some(rules) = self.cache_get(&lower) {
            return Some(rules);
        }
        if let Some(rules) = self.lazy_parse_by_lower(&lower) {
            return Some(rules);
        }
        let ascii_query = deunicode(resolved).to_ascii_lowercase();
        if ascii_query != lower {
            if let Some(rules) = self.cache_get(&ascii_query) {
                return Some(rules);
            }
            if let Some(rules) = self.lazy_parse_by_lower(&ascii_query) {
                return Some(rules);
            }
        }
        None
    }

    fn cache_get(&self, key: &str) -> Option<&'static CardRules> {
        self.cards.lock().ok()?.get(key).copied()
    }

    fn cache_insert(&self, key: String, rules: &'static CardRules) {
        if let Ok(mut map) = self.cards.lock() {
            map.entry(key).or_insert(rules);
        }
    }

    fn lazy_parse_by_lower(&self, name_lower: &str) -> Option<&'static CardRules> {
        let archive = self.archive?;
        let archived = archive.lookup(name_lower)?;
        let raw = archived.raw.as_str();
        let lines: Vec<&str> = raw.lines().collect();

        let parsed = {
            let mut parser = self.parser.lock().expect("parser mutex poisoned");
            parser.parse(lines, Some(name_lower))
        };
        match parsed {
            Ok(card) => {
                let leaked: &'static CardRules = Box::leak(Box::new(card));
                self.cache_insert(name_lower.to_string(), leaked);
                Some(leaked)
            }
            Err(_) => {
                if let Ok(mut failures) = self.lazy_failures.lock() {
                    *failures += 1;
                }
                None
            }
        }
    }

    pub fn iter(&self) -> Vec<(String, &'static CardRules)> {
        match self.cards.lock() {
            Ok(map) => map.iter().map(|(k, v)| (k.clone(), *v)).collect(),
            Err(_) => Vec::new(),
        }
    }

    pub fn card_names(&self) -> Vec<String> {
        if let Some(archive) = self.archive {
            archive
                .cards
                .iter()
                .map(|c| c.display_name().to_string())
                .collect()
        } else {
            match self.cards.lock() {
                Ok(map) => map.values().map(|r| r.name()).collect(),
                Err(_) => Vec::new(),
            }
        }
    }

    pub fn iter_card_keys(&self) -> Vec<String> {
        if let Some(archive) = self.archive {
            archive
                .cards
                .iter()
                .map(|c| c.name_lower.to_string())
                .collect()
        } else {
            match self.cards.lock() {
                Ok(map) => map.keys().cloned().collect(),
                Err(_) => Vec::new(),
            }
        }
    }

    pub fn force_parse_all(&self) -> LoadResult {
        let mut result = LoadResult::default();
        let Some(archive) = self.archive else {
            // Eager DB — already fully loaded.
            result.loaded = self.len();
            return result;
        };
        for card in archive.cards.iter() {
            let name_lower = card.name_lower.as_str();
            if self.cache_get(name_lower).is_some() {
                result.loaded += 1;
                continue;
            }
            match self.lazy_parse_by_lower(name_lower) {
                Some(_) => result.loaded += 1,
                None => result.failed += 1,
            }
        }
        result
    }

    /// Access the raw token art variant map.
    pub fn token_art_variants(&self) -> &HashMap<(String, String), usize> {
        &self.token_art_variants
    }

    /// Access the raw token fallback map.
    pub fn token_fallback(&self) -> &HashMap<String, String> {
        &self.token_fallback
    }

    /// Access the edition release dates map.
    pub fn edition_dates(&self) -> &HashMap<String, String> {
        &self.edition_dates
    }

    /// Get the default edition for a card by name (lowercase).
    pub fn card_default_edition(&self, card_name: &str) -> Option<&str> {
        self.card_default_edition
            .get(&card_name.to_lowercase())
            .map(|s| s.as_str())
    }

    /// Get the number of art variants for a token script in a given edition.
    /// Follows `TokenFallbackCode` chains to find the edition that has the token.
    /// Returns 1 if not found (single variant assumed).
    pub fn token_art_variant_count(&self, token_script: &str, edition_code: &str) -> usize {
        let key = (token_script.to_lowercase(), edition_code.to_uppercase());
        if let Some(&count) = self.token_art_variants.get(&key) {
            return count;
        }
        // Follow TokenFallbackCode chain
        if let Some(fallback) = self.token_fallback.get(&edition_code.to_uppercase()) {
            return self.token_art_variant_count(token_script, fallback);
        }
        // Not found in any edition — Java's fallbackToken iterates all editions
        // until it finds one. We return 1 as a safe default (single variant).
        1
    }

    /// Number of editions that contain a given token script.
    /// Mirrors the size of the `Set<String>` passed to `Aggregates.random()`
    /// in Java's `TokenDb.loadTokenFromSet()`.
    pub fn token_edition_count(&self, token_script: &str) -> usize {
        let key_lower = token_script.to_lowercase();
        self.token_art_variants
            .keys()
            .filter(|(script, _)| *script == key_lower)
            .count()
    }

    /// Mirror of Java's CardDb.getNormalizedName().
    /// If the given name is an accent-stripped variant, returns the original name.
    pub fn get_normalized_name<'a>(&'a self, card_name: &'a str) -> &'a str {
        self.normalized_names
            .get(card_name)
            .map(|s| s.as_str())
            .unwrap_or(card_name)
    }

    pub fn load_from_archive(archive_bytes: &[u8]) -> Result<ArchiveBundle, String> {
        // Manually allocate an over-sized buffer and pick a 16-byte-aligned
        // slice inside it. rkyv's `AlignedVec` should do this for us, but it
        // depends on the platform allocator honoring `Layout::align` — which
        // wasm32 allocators sometimes don't. Doing it by hand makes the
        // alignment property something we can verify rather than something
        // we hope is true.
        const ALIGN: usize = 16;
        let mut storage: Box<[u8]> = vec![0u8; archive_bytes.len() + ALIGN].into_boxed_slice();
        let raw = storage.as_mut_ptr() as usize;
        let pad = (ALIGN - (raw % ALIGN)) % ALIGN;
        storage[pad..pad + archive_bytes.len()].copy_from_slice(archive_bytes);
        let leaked: &'static mut [u8] = Box::leak(storage);
        let bytes_static: &'static [u8] = &leaked[pad..pad + archive_bytes.len()];
        debug_assert_eq!(
            (bytes_static.as_ptr() as usize) % ALIGN,
            0,
            "archive buffer not 16-aligned"
        );

        let archive: &'static ArchivedCardArchive =
            forge_cardset_archive::load_checked(bytes_static)
                .map_err(|e| format!("invalid archive: {e}"))?;

        let mut cards = Self::new();
        cards.archive = Some(archive);
        for edition in archive.editions.iter() {
            cards.extract_flavor_aliases_from_edition_contents(edition.raw.as_str());
        }
        let cards_result = LoadResult {
            loaded: archive.cards.len(),
            failed: 0,
            errors: Vec::new(),
        };

        let mut tokens = Self::new();
        let tokens_result = tokens.parse_scripts(
            archive
                .tokens
                .iter()
                .map(|c| (c.name_lower.as_str(), c.raw.as_str())),
        );

        Ok(ArchiveBundle {
            cards,
            tokens,
            cards_result,
            tokens_result,
        })
    }

    fn parse_scripts<'a, I>(&mut self, scripts: I) -> LoadResult
    where
        I: IntoIterator<Item = (&'a str, &'a str)>,
    {
        let mut result = LoadResult::default();
        let mut parser = CardScriptParser::new();
        for (filename, content) in scripts {
            let lines: Vec<&str> = content.lines().collect();
            match parser.parse(lines, Some(filename)) {
                Ok(card) => {
                    let key = if card.normalized_name.is_empty() {
                        card.name()
                    } else {
                        card.normalized_name.clone()
                    };
                    let card_name = card.name();
                    let normal_name = deunicode(&card_name);
                    if normal_name != card_name {
                        self.normalized_names.insert(normal_name, card_name);
                    }
                    self.register_flavor_aliases_for_card(&card);
                    let leaked: &'static CardRules = Box::leak(Box::new(card));
                    self.cache_insert(key, leaked);
                    result.loaded += 1;
                }
                Err(e) => {
                    result.failed += 1;
                    result.errors.push((filename.to_string(), e));
                }
            }
        }
        result
    }

    fn resolve_flavor_alias<'a>(&'a self, name: &'a str) -> &'a str {
        if let Some(mapped) = self.flavor_name_aliases.get(&name.to_ascii_lowercase()) {
            return mapped;
        }
        let normalized = deunicode(name).to_ascii_lowercase();
        if let Some(mapped) = self.flavor_name_aliases_normalized.get(&normalized) {
            return mapped;
        }
        name
    }

    fn register_flavor_alias(&mut self, alias: &str, canonical_name: &str) {
        if alias.eq_ignore_ascii_case(canonical_name) {
            return;
        }
        self.flavor_name_aliases
            .insert(alias.to_ascii_lowercase(), canonical_name.to_string());

        let normalized_alias = deunicode(alias);
        if normalized_alias != alias {
            self.normalized_names
                .insert(normalized_alias.clone(), alias.to_string());
        }
        self.flavor_name_aliases_normalized.insert(
            normalized_alias.to_ascii_lowercase(),
            canonical_name.to_string(),
        );
    }

    fn register_flavor_aliases_for_card(&mut self, card: &CardRules) {
        let canonical = card.name();
        if let Some(alias) = &card.main_part.flavor_name {
            self.register_flavor_alias(alias, &canonical);
        }
        if let Some(other) = &card.other_part {
            if let Some(alias) = &other.flavor_name {
                self.register_flavor_alias(alias, &canonical);
            }
        }
        for face in card.specialized_parts.values() {
            if let Some(alias) = &face.flavor_name {
                self.register_flavor_alias(alias, &canonical);
            }
        }
    }

    fn extract_flavor_aliases_from_edition_contents(&mut self, contents: &str) {
        let mut in_entries = false;
        let mut in_tokens = false;
        let mut in_metadata = false;
        let mut edition_code = String::new();
        let mut edition_date = String::new();
        let mut edition_name = String::new();
        // Count occurrences of each token script in this edition
        let mut token_counts: HashMap<String, usize> = HashMap::new();

        for raw_line in contents.lines() {
            let line = raw_line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if line.starts_with('[') && line.ends_with(']') {
                let section = &line[1..line.len() - 1];
                in_metadata = section.eq_ignore_ascii_case("metadata");
                in_tokens = section.eq_ignore_ascii_case("tokens");
                in_entries = !in_metadata && !in_tokens;
                continue;
            }
            if in_metadata {
                // Extract edition code and token fallback
                if let Some(name) = line.strip_prefix("Name=") {
                    edition_name = name.trim().to_string();
                } else if let Some(code) = line.strip_prefix("Code=") {
                    edition_code = code.trim().to_uppercase();
                } else if let Some(date) = line.strip_prefix("Date=") {
                    edition_date = date.trim().to_string();
                } else if let Some(fallback) = line.strip_prefix("TokenFallbackCode=") {
                    let fb = fallback.trim().to_uppercase();
                    if !edition_code.is_empty() && !fb.is_empty() {
                        self.token_fallback.insert(edition_code.clone(), fb);
                    }
                }
                continue;
            }
            if in_tokens {
                // Parse token line: "1a c_0_1_eldrazi_spawn_sac @Aleksi Briclot"
                if let Some(token_name) = parse_token_line(line) {
                    *token_counts.entry(token_name).or_insert(0) += 1;
                }
                continue;
            }
            if !in_entries {
                continue;
            }
            // Track card → edition mapping (newest release date wins).
            // Mirrors Java's LATEST_ART_ALL which picks the most recent
            // printing. Java's CardEdition.compareTo sorts by date then
            // name — Collections.reverse gives newest/alphabetically-last
            // first. We replicate: prefer newer date, break ties by
            // edition name descending (lexicographic).
            if !edition_code.is_empty() && !edition_date.is_empty() {
                if let Some(card_name) = parse_card_name_from_edition_line(line) {
                    let key = card_name.to_lowercase();
                    let dominated = if let Some(existing_code) = self.card_default_edition.get(&key)
                    {
                        let existing_date = self
                            .edition_dates
                            .get(existing_code)
                            .map(|s| s.as_str())
                            .unwrap_or("0000-00-00");
                        let existing_name = self
                            .edition_names
                            .get(existing_code)
                            .map(|s| s.as_str())
                            .unwrap_or("");
                        match edition_date.as_str().cmp(existing_date) {
                            std::cmp::Ordering::Greater => true,
                            std::cmp::Ordering::Less => false,
                            std::cmp::Ordering::Equal => edition_name.as_str() >= existing_name,
                        }
                    } else {
                        true
                    };
                    if dominated {
                        self.card_default_edition.insert(key, edition_code.clone());
                    }
                }
            }
            if let Some((printed_name, flavor_name)) = parse_edition_flavor_alias_line(line) {
                let canonical = self
                    .get_by_card_name(&printed_name)
                    .map(|rules| rules.name())
                    .unwrap_or(printed_name);
                self.register_flavor_alias(&flavor_name, &canonical);
            }
        }

        // Store edition date, name, and token variant counts
        if !edition_code.is_empty() {
            if !edition_date.is_empty() {
                self.edition_dates
                    .insert(edition_code.clone(), edition_date);
            }
            if !edition_name.is_empty() {
                self.edition_names
                    .insert(edition_code.clone(), edition_name);
            }
            for (token_name, count) in token_counts {
                self.token_art_variants
                    .insert((token_name, edition_code.clone()), count);
            }
        }
    }
}

/// Parse a card name from an edition's `[cards]` section line.
/// Format: "1 M All Is Dust @Jason Felix" → "All Is Dust"
fn parse_card_name_from_edition_line(line: &str) -> Option<&str> {
    let mut parts = line.splitn(3, char::is_whitespace);
    let _collector = parts.next()?; // "1"
    let _rarity = parts.next()?; // "M"
    let rest = parts.next()?.trim(); // "All Is Dust @Jason Felix"
    if rest.is_empty() {
        return None;
    }
    Some(split_at_any(rest, &[" @", " ${"]))
}

/// Parse a token line from an edition's `[tokens]` section.
/// Format: "1a c_0_1_eldrazi_spawn_sac @Aleksi Briclot"
/// Returns the token script name (lowercase).
fn parse_token_line(line: &str) -> Option<String> {
    let mut parts = line.splitn(3, char::is_whitespace);
    let _collector = parts.next()?; // e.g. "1a"
    let token_name = parts.next()?.trim(); // e.g. "c_0_1_eldrazi_spawn_sac"
    if token_name.is_empty() {
        return None;
    }
    Some(token_name.to_lowercase())
}

fn parse_edition_flavor_alias_line(line: &str) -> Option<(String, String)> {
    let flavor_name = extract_flavor_name_json(line)?;
    let mut parts = line.splitn(3, char::is_whitespace);
    let _collector = parts.next()?;
    let _rarity = parts.next()?;
    let rest = parts.next()?.trim();
    let card_name = split_at_any(rest, &[" @", " ${"]).trim();
    if card_name.is_empty() {
        return None;
    }
    Some((card_name.to_string(), flavor_name))
}

fn split_at_any<'a>(input: &'a str, delimiters: &[&str]) -> &'a str {
    let mut best = input.len();
    for delim in delimiters {
        if let Some(idx) = input.find(delim) {
            best = best.min(idx);
        }
    }
    &input[..best]
}

fn extract_flavor_name_json(line: &str) -> Option<String> {
    let key_pos = line.find("\"flavorName\"")?;
    let tail = &line[key_pos + "\"flavorName\"".len()..];
    let colon = tail.find(':')?;
    let tail = &tail[colon + 1..].trim_start();
    if !tail.starts_with('"') {
        return None;
    }
    let value = &tail[1..];
    let end = value.find('"')?;
    Some(value[..end].to_string())
}

impl Default for CardDatabase {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use forge_cardset_archive::build_test_archive;

    fn db_from(scripts: &[(&str, &str)]) -> CardDatabase {
        let bytes = build_test_archive(scripts);
        CardDatabase::load_from_archive(&bytes)
            .expect("synthetic archive should load")
            .cards
    }

    #[test]
    fn lazy_lookup_two_cards() {
        let db = db_from(&[
            (
                "lightning bolt",
                "Name:Lightning Bolt\nManaCost:R\nTypes:Instant\nOracle:Bolt!",
            ),
            (
                "grizzly bears",
                "Name:Grizzly Bears\nManaCost:1 G\nTypes:Creature Bear\nPT:2/2\nOracle:",
            ),
        ]);
        // `len()` reflects the universe (archive index size), not the parse cache.
        assert_eq!(db.len(), 2);
        assert!(db.get_by_card_name("Lightning Bolt").is_some());
        assert!(db.get_by_card_name("Grizzly Bears").is_some());
    }

    #[test]
    fn get_by_card_name_case_insensitive() {
        let db = db_from(&[(
            "lightning bolt",
            "Name:Lightning Bolt\nManaCost:R\nTypes:Instant\nOracle:Bolt!",
        )]);
        let card = db.get_by_card_name("Lightning Bolt").unwrap();
        assert_eq!(card.main_part.name, "Lightning Bolt");
    }

    #[test]
    fn get_by_card_name_accent_normalized() {
        let db = db_from(&[(
            "troll of khazad-d\u{00fb}m",
            "Name:Troll of Khazad-d\u{00fb}m\nManaCost:5 B\nTypes:Creature Troll\nPT:6/5\nOracle:Swampwalk",
        )]);
        // Exact match resolves.
        assert!(db.get_by_card_name("Troll of Khazad-d\u{00fb}m").is_some());
        // ASCII-stripped query resolves via the deunicode fallback in `get_by_card_name`.
        assert!(db.get_by_card_name("Troll of Khazad-dum").is_some());
    }
}
