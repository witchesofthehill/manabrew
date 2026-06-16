//! Static ability cost change — re-exports from `cost::cost_adjustment`.
//!
//! The canonical implementation now lives in `crate::cost::cost_adjustment`,
//! mirroring Java's `forge.game.cost.CostAdjustment`.
//! This module re-exports the public API for backwards compatibility.

pub use crate::cost::cost_adjustment::*;
