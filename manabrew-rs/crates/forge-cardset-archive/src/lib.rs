//! Single-blob rkyv archive of the Forge cardset.
//!
pub use rkyv::AlignedVec;
use rkyv::{Archive, Deserialize, Serialize};

pub fn align_bytes(bytes: &[u8]) -> AlignedVec {
    let mut buf = AlignedVec::with_capacity(bytes.len());
    buf.extend_from_slice(bytes);
    buf
}

#[cfg(feature = "build")]
mod build;
#[cfg(feature = "build")]
pub use build::{build_archive_from_sources, ArchiveSources, BuildStats};

pub const ARCHIVE_FORMAT_VERSION: u32 = 4;

#[derive(Archive, Serialize, Deserialize, Debug, Clone)]
#[archive(check_bytes)]
pub struct Card {
    /// Lowercased canonical name — used as the binary-search key.
    pub name_lower: String,
    /// Raw card-script source, exactly as on disk.
    pub raw: String,
}

#[derive(Archive, Serialize, Deserialize, Debug, Clone)]
#[archive(check_bytes)]
pub struct Edition {
    pub name: String,
    pub raw: String,
}

/// Free-form text resource — e.g. files from `forge/forge-gui/res/blockdata/`
/// such as `boosters-special.txt`. Same shape as `Edition` but separated for
/// clarity and to keep schema growth obvious in diffs.
#[derive(Archive, Serialize, Deserialize, Debug, Clone)]
#[archive(check_bytes)]
pub struct BlockData {
    pub name: String,
    pub raw: String,
}

#[derive(Archive, Serialize, Deserialize, Debug)]
#[archive(check_bytes)]
pub struct CardArchive {
    pub format_version: u32,
    pub cards: Vec<Card>,
    pub tokens: Vec<Card>,
    pub editions: Vec<Edition>,
    pub block_data: Vec<BlockData>,
}

impl ArchivedCardArchive {
    pub fn lookup(&self, name: &str) -> Option<&ArchivedCard> {
        let key = name.to_ascii_lowercase();
        let idx = self
            .cards
            .binary_search_by(|c| c.name_lower.as_str().cmp(key.as_str()))
            .ok()?;
        Some(&self.cards[idx])
    }
}

impl ArchivedCard {
    /// Canonical display name extracted from the raw `Name:` field, falling
    /// back to the lowercased index key if the field is missing.
    pub fn display_name(&self) -> &str {
        self.raw
            .as_str()
            .lines()
            .find_map(|line| line.strip_prefix("Name:"))
            .unwrap_or(self.name_lower.as_str())
    }
}

/// Serialize a `CardArchive` to bytes. Returns rkyv's `AlignedVec` so the
/// caller can write it straight to disk without losing alignment.
pub fn to_bytes(archive: &CardArchive) -> Result<rkyv::AlignedVec, String> {
    rkyv::to_bytes::<_, 4_194_304>(archive).map_err(|e| format!("rkyv serialize: {e}"))
}

/// Build a synthetic, in-memory rkyv archive from `(name_lower, raw)` card
/// scripts. Tests use this to construct a small `CardDatabase` without
/// walking the full cardsfolder — pipe the bytes into
/// `CardDatabase::load_from_archive`.
pub fn build_test_archive(scripts: &[(&str, &str)]) -> Vec<u8> {
    let cards: Vec<Card> = scripts
        .iter()
        .map(|(name_lower, raw)| Card {
            name_lower: (*name_lower).to_string(),
            raw: (*raw).to_string(),
        })
        .collect();
    let archive = CardArchive {
        format_version: ARCHIVE_FORMAT_VERSION,
        cards,
        tokens: Vec::new(),
        editions: Vec::new(),
        block_data: Vec::new(),
    };
    to_bytes(&archive)
        .expect("test archive serialization")
        .to_vec()
}

/// Validate and access an archive in-place, zero-copy.
///
/// `bytes` must be aligned to at least the archive's required alignment.
/// In practice an `mmap`'d region is page-aligned, which trivially satisfies
/// rkyv's requirement; for `fetch()`'d bytes on web, copy into an
/// `rkyv::AlignedVec` before calling this.
pub fn load_checked(bytes: &[u8]) -> Result<&ArchivedCardArchive, String> {
    let archive = rkyv::check_archived_root::<CardArchive>(bytes)
        .map_err(|e| format!("invalid archive: {e}"))?;
    if archive.format_version != ARCHIVE_FORMAT_VERSION {
        return Err(format!(
            "archive format version mismatch: file is v{}, runtime expects v{}",
            archive.format_version, ARCHIVE_FORMAT_VERSION
        ));
    }
    Ok(archive)
}

/// Same as `load_checked` but skips bytecheck validation.
///
/// # Safety
///
/// `bytes` must be a valid rkyv archive of `CardArchive`, properly aligned.
pub unsafe fn load_unchecked(bytes: &[u8]) -> &ArchivedCardArchive {
    rkyv::archived_root::<CardArchive>(bytes)
}
