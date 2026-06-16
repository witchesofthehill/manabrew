//! Cardset rkyv archive loader.
//!
//! Wraps the `forge-cardset-archive` mmap-backed archive in a small handle
//! that the debugger can open once and read repeatedly. Validation runs at
//! `open()`, so the per-frame `load_unchecked` access in `archive()` is
//! sound.

use std::path::Path;

use forge_cardset_archive::{load_checked, load_unchecked, ArchivedCardArchive};
use memmap2::Mmap;

pub(crate) struct ArchiveState {
    mmap: Mmap,
}

impl ArchiveState {
    pub(crate) fn open(path: &Path) -> Result<Self, String> {
        let file = std::fs::File::open(path).map_err(|e| format!("open: {e}"))?;
        let mmap = unsafe { Mmap::map(&file).map_err(|e| format!("mmap: {e}"))? };
        // Validate once up front so the per-frame `load_unchecked` is safe.
        load_checked(&mmap).map_err(|e| format!("validate: {e}"))?;
        Ok(Self { mmap })
    }

    pub(crate) fn archive(&self) -> &ArchivedCardArchive {
        // SAFETY: validated at construction; mmap bytes are page-aligned.
        unsafe { load_unchecked(&self.mmap) }
    }
}
