use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "deck/index.ts")]
pub enum CardFinish {
    Regular,
    Gloss,
    Etched,
    Prismatic,
    Cold,
    Opal,
    Rain,
    Heat,
    Pool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "deck/index.ts")]
pub enum CardFramePreset {
    Printing,
    Modern,
    Retro,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "deck/index.ts")]
pub enum CardBorderPreset {
    Printing,
    Black,
    White,
    Silver,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "deck/index.ts")]
pub enum CardWearPreset {
    Fresh,
    Light,
    Played,
    Heavy,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "deck/index.ts")]
pub struct CardCosmetics {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub finish: Option<CardFinish>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub frame: Option<CardFramePreset>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub border: Option<CardBorderPreset>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub wear: Option<CardWearPreset>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub wear_seed: Option<u32>,
}

impl CardCosmetics {
    pub fn normalize(mut self) -> Option<Self> {
        if self.frame == Some(CardFramePreset::Printing) {
            self.frame = None;
        }
        if self.border == Some(CardBorderPreset::Printing) {
            self.border = None;
        }
        if self.wear == Some(CardWearPreset::Fresh) {
            self.wear = None;
        }
        if self.wear.is_none() || self.wear_seed == Some(0) {
            self.wear_seed = None;
        }
        (self != Self::default()).then_some(self)
    }

    pub fn deserialize_optional<'de, D>(deserializer: D) -> Result<Option<Self>, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        Ok(Option::<Self>::deserialize(deserializer)?.and_then(Self::normalize))
    }
}
