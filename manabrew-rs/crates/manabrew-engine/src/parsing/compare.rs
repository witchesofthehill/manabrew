//! Comparison utilities for Forge DSL expressions.
//!
//! Mirrors Java's `Expressions.compare()` — parses comparator strings like
//! `"GE2"`, `"LT5"`, `"EQ0"` and evaluates them against integer values.
//!
//! Used by `IsPresent$/PresentCompare$`, `CheckSVar$/SVarCompare$`,
//! `ConditionCompare$`, and similar parameter patterns.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompareOp {
    GreaterOrEqual,
    GreaterThan,
    LessOrEqual,
    LessThan,
    Equal,
    NotEqual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CompareExpr {
    pub op: CompareOp,
    pub threshold: i32,
}

impl CompareExpr {
    pub fn parse(expr: &str) -> Option<Self> {
        let (op, rest) = if let Some(rest) = expr.strip_prefix("GE") {
            (CompareOp::GreaterOrEqual, rest)
        } else if let Some(rest) = expr.strip_prefix("GT") {
            (CompareOp::GreaterThan, rest)
        } else if let Some(rest) = expr.strip_prefix("LE") {
            (CompareOp::LessOrEqual, rest)
        } else if let Some(rest) = expr.strip_prefix("LT") {
            (CompareOp::LessThan, rest)
        } else if let Some(rest) = expr.strip_prefix("NE") {
            (CompareOp::NotEqual, rest)
        } else if let Some(rest) = expr.strip_prefix("EQ") {
            (CompareOp::Equal, rest)
        } else {
            return None;
        };
        Some(Self {
            op,
            threshold: rest.parse::<i32>().ok()?,
        })
    }

    pub fn evaluate(self, value: i32) -> bool {
        match self.op {
            CompareOp::GreaterOrEqual => value >= self.threshold,
            CompareOp::GreaterThan => value > self.threshold,
            CompareOp::LessOrEqual => value <= self.threshold,
            CompareOp::LessThan => value < self.threshold,
            CompareOp::Equal => value == self.threshold,
            CompareOp::NotEqual => value != self.threshold,
        }
    }
}

/// Compare a value against a DSL comparator expression.
///
/// The expression is a prefix (`GE`, `GT`, `LE`, `LT`, `EQ`, `NE`) followed
/// by an integer threshold. For example, `"GE2"` means "greater than or equal
/// to 2".
///
/// Returns `true` if the comparison matches, or `true` on unknown format
/// (permissive fallback, matching Java behavior).
///
/// # Examples
///
/// ```
/// use manabrew_engine::parsing::compare::compare_expr;
///
/// assert!(compare_expr(3, "GE2"));
/// assert!(compare_expr(2, "GE2"));
/// assert!(!compare_expr(1, "GE2"));
/// assert!(compare_expr(0, "EQ0"));
/// assert!(!compare_expr(1, "EQ0"));
/// assert!(compare_expr(5, "GT4"));
/// assert!(!compare_expr(4, "GT4"));
/// ```
pub fn compare_expr(value: i32, expr: &str) -> bool {
    if let Some(parsed) = CompareExpr::parse(expr) {
        parsed.evaluate(value)
    } else {
        // Unknown comparator — permissive fallback (matches Java).
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ge() {
        assert!(compare_expr(2, "GE2"));
        assert!(compare_expr(3, "GE2"));
        assert!(!compare_expr(1, "GE2"));
    }

    #[test]
    fn gt() {
        assert!(compare_expr(3, "GT2"));
        assert!(!compare_expr(2, "GT2"));
    }

    #[test]
    fn le() {
        assert!(compare_expr(2, "LE2"));
        assert!(compare_expr(1, "LE2"));
        assert!(!compare_expr(3, "LE2"));
    }

    #[test]
    fn lt() {
        assert!(compare_expr(1, "LT2"));
        assert!(!compare_expr(2, "LT2"));
    }

    #[test]
    fn eq() {
        assert!(compare_expr(0, "EQ0"));
        assert!(!compare_expr(1, "EQ0"));
    }

    #[test]
    fn ne() {
        assert!(compare_expr(1, "NE0"));
        assert!(!compare_expr(0, "NE0"));
    }

    #[test]
    fn unknown_is_permissive() {
        assert!(compare_expr(42, "UNKNOWN"));
        assert!(compare_expr(0, ""));
    }
}
