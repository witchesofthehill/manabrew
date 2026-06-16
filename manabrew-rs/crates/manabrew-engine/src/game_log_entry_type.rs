/// Categories for engine log output.
/// Mirrors Java `GameLogEntryType`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GameLogEntryType {
    TurnBegin,
    TurnSkip,
    PhaseBegin,
    PriorityWaiting,
    PriorityResponse,
    PriorityPass,
    StackPush,
    StackResolve,
    Mulligan,
    Info,
}
