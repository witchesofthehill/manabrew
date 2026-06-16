use crate::event::RunParams;
use crate::ids::PlayerId;
use crate::trigger::Trigger;
use crate::trigger::TriggerType;

/// Mirrors Java's TriggerWaiting data object.
#[derive(Debug, Clone)]
pub struct TriggerWaiting {
    pub mode: TriggerType,
    pub params: RunParams,
    /// Trigger-to-player mapping. Mirrors Java's TriggerWaiting.triggers field.
    pub triggers: Option<Vec<(Trigger, PlayerId)>>,
}

impl TriggerWaiting {
    /// Mirrors Java's TriggerWaiting.getController(Trigger).
    /// Returns the controller for the given trigger, or None if the mapping is absent.
    pub fn get_controller(&self, trigger: &Trigger) -> Option<PlayerId> {
        let triggers = self.triggers.as_ref()?;
        triggers
            .iter()
            .find(|(t, _)| t.id == trigger.id)
            .map(|(_, player)| *player)
    }
}
