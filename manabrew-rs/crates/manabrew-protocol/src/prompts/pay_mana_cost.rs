use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::prompts::common::{PaymentAction, PromptPresentation};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/payManaCost.ts")]
pub struct PayManaCostInput {
    pub presentation: PromptPresentation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub card_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub card_name: Option<String>,
    pub mana_cost: String,
    pub can_confirm_from_pool: bool,
    #[serde(default = "auto_pay_default")]
    pub auto_pay_available: bool,
    pub actions: Vec<PaymentAction>,
}

fn auto_pay_default() -> bool {
    true
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
