//! Helper functions for effect resolution — re-export shim.
//!
//! All functions now live in `crate::ability::ability_utils`.
//! This module re-exports everything for backward compatibility so that
//! existing callers using `effects::helpers::*` or `effects::*` paths
//! continue to compile unchanged.

pub use crate::ability::ability_utils::*;
