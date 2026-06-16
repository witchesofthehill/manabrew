//! CostPaymentStack — tracks cost payments for trigger purposes.
//!
//! Mirrors Java's `CostPaymentStack.java`.

/// A simple stack for tracking cost payment instances.
/// Used mainly by triggers to inspect what costs are being paid.
/// Mirrors Java's `CostPaymentStack` class.
#[derive(Debug, Clone, Default)]
pub struct CostPaymentStack {
    stack: Vec<CostPaymentEntry>,
}

/// An individual cost payment entry.
#[derive(Debug, Clone)]
pub struct CostPaymentEntry {
    pub cost_description: String,
}

impl CostPaymentStack {
    pub fn new() -> Self {
        CostPaymentStack { stack: Vec::new() }
    }

    pub fn push(&mut self, entry: CostPaymentEntry) {
        self.stack.push(entry);
    }

    pub fn pop(&mut self) -> Option<CostPaymentEntry> {
        self.stack.pop()
    }

    pub fn peek(&self) -> Option<&CostPaymentEntry> {
        self.stack.last()
    }

    pub fn clear(&mut self) {
        self.stack.clear();
    }

    pub fn iter(&self) -> impl Iterator<Item = &CostPaymentEntry> {
        self.stack.iter()
    }

    /// Provides an iterator over entries.
    /// Mirrors Java's `CostPaymentStack.iterator()`.
    pub fn iterator(&self) -> impl Iterator<Item = &CostPaymentEntry> {
        self.stack.iter()
    }
}
