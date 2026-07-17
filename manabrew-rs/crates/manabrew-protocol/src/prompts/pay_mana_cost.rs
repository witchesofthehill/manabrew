use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::prompts::common::{PaymentAction, PromptPresentation};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/payManaCost.ts")]
pub struct PayManaCostInput {
    pub presentation: PromptPresentation,
    pub card_id: String,
    pub card_name: String,
    pub mana_cost: String,
    pub can_confirm_from_pool: bool,
    pub actions: Vec<PaymentAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/payManaCost.ts")]
pub enum PayManaCostOutput {
    Act {
        action_id: String,
    },
    Pay {
        #[serde(default)]
        auto: bool,
    },
    Cancel,
}
