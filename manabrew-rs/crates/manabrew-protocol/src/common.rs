use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "common/index.ts")]
pub enum TargetKind {
    Player,
    Card,
    Spell,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "common/index.ts")]
pub struct TargetRef {
    pub kind: TargetKind,
    pub id: String,
    pub intent: TargetingIntent,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub node_index: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub target_index: Option<u32>,
}

impl TargetRef {
    pub fn player(id: String, intent: TargetingIntent) -> Self {
        Self {
            kind: TargetKind::Player,
            id,
            intent,
            node_index: None,
            target_index: None,
        }
    }

    pub fn card(id: String, intent: TargetingIntent) -> Self {
        Self {
            kind: TargetKind::Card,
            id,
            intent,
            node_index: None,
            target_index: None,
        }
    }

    pub fn spell(id: String, intent: TargetingIntent) -> Self {
        Self {
            kind: TargetKind::Spell,
            id,
            intent,
            node_index: None,
            target_index: None,
        }
    }

    pub fn with_indexes(mut self, node_index: u32, target_index: u32) -> Self {
        self.node_index = Some(node_index);
        self.target_index = Some(target_index);
        self
    }
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS, strum_macros::Display,
)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "common/index.ts")]
pub enum TargetingIntent {
    #[default]
    Damage,
    Destroy,
    Sacrifice,
    Exile,
    Bounce,
    Mill,
    Discard,
    Counter,
    Tap,
    Untap,
    Copy,
    Buff,
    Debuff,
    Heal,
    LoseLife,
    Reveal,
    Draw,
    GainControl,
    Fight,
    Attach,
    Attack,
    Block,
    Hostile,
    Friendly,
}
