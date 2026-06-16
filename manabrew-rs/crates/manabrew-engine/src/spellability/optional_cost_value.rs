//! OptionalCostValue — pairs an optional cost type with a description.
//!
//! Mirrors Java's `OptionalCostValue.java`.

use serde::{Deserialize, Serialize};

use super::optional_cost::OptionalCost;

/// A valued optional cost with a description string.
/// Mirrors Java's `OptionalCostValue` — pairs a cost type with
/// descriptive text for display purposes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptionalCostValue {
    pub cost_type: OptionalCost,
    pub cost_description: String,
}

impl OptionalCostValue {
    pub fn new(cost_type: OptionalCost, cost_description: String) -> Self {
        OptionalCostValue {
            cost_type,
            cost_description,
        }
    }

    /// Get the optional cost type.
    /// Mirrors Java's `OptionalCostValue.getType()`.
    pub fn get_type(&self) -> OptionalCost {
        self.cost_type
    }

    /// Get the cost description.
    /// Mirrors Java's `OptionalCostValue.getCost()`.
    pub fn get_cost(&self) -> &str {
        &self.cost_description
    }
}

impl std::fmt::Display for OptionalCostValue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let name = self.cost_type.name();
        let is_tag = name.starts_with('(');
        if self.cost_type != OptionalCost::Generic && !is_tag {
            write!(f, "{} – {}", name, self.cost_description)?;
        } else if is_tag {
            write!(f, "{} {}", self.cost_description, name)?;
        } else {
            write!(f, "{}", self.cost_description)?;
        }
        Ok(())
    }
}
