use super::CounterType;

/// Java parity shim for `CounterEnumType` behaviour used by scanner and basic checks.
pub struct CounterEnumType;

impl CounterEnumType {
    pub fn is(counter: &CounterType, expected: &CounterType) -> bool {
        counter == expected
    }
}
