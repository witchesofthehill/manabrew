use std::borrow::Cow;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A semantic sound identifier. Standard constants keep producers typed,
/// while the transparent string representation lets newer identifiers pass
/// through older protocol clients.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, TS)]
#[serde(transparent)]
#[ts(export, export_to = "display/index.ts")]
pub struct SoundType(#[ts(type = "string")] Cow<'static, str>);

impl SoundType {
    pub fn new(value: impl Into<String>) -> Self {
        Self(Cow::Owned(value.into()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub const GAME_CARD_DRAW: Self = Self(Cow::Borrowed("game.card.draw"));
    pub const GAME_CARD_PLAY: Self = Self(Cow::Borrowed("game.card.play"));
    pub const GAME_CARD_TAP: Self = Self(Cow::Borrowed("game.card.tap"));
    pub const GAME_CARD_UNTAP: Self = Self(Cow::Borrowed("game.card.untap"));
    pub const GAME_CARD_DISCARD: Self = Self(Cow::Borrowed("game.card.discard"));
    pub const GAME_CARD_DESTROY: Self = Self(Cow::Borrowed("game.card.destroy"));
    pub const GAME_CARD_EXILE: Self = Self(Cow::Borrowed("game.card.exile"));
    pub const GAME_LIBRARY_SHUFFLE: Self = Self(Cow::Borrowed("game.library.shuffle"));
    pub const GAME_PLAYER_LIFE_GAIN: Self = Self(Cow::Borrowed("game.player.life-gain"));
    pub const GAME_PLAYER_LIFE_LOSS: Self = Self(Cow::Borrowed("game.player.life-loss"));
    pub const GAME_TURN_START: Self = Self(Cow::Borrowed("game.turn.start"));
    pub const GAME_RANDOM_DIE_ROLL: Self = Self(Cow::Borrowed("game.random.die-roll"));
    pub const GAME_START: Self = Self(Cow::Borrowed("game.start"));
    pub const PROMPT_DECISION_REQUIRED: Self = Self(Cow::Borrowed("prompt.decision-required"));
    pub const PROMPT_TARGET_REQUIRED: Self = Self(Cow::Borrowed("prompt.target-required"));
    pub const PROMPT_PAYMENT_REQUIRED: Self = Self(Cow::Borrowed("prompt.payment-required"));
    pub const PROMPT_COMBAT_REQUIRED: Self = Self(Cow::Borrowed("prompt.combat-required"));
    pub const PROMPT_ACTION_REJECTED: Self = Self(Cow::Borrowed("prompt.action-rejected"));
}

impl<'de> Deserialize<'de> for SoundType {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        String::deserialize(deserializer).map(Self::new)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "display/index.ts")]
pub enum SoundCueOrigin {
    Player { player_id: String },
    Card { card_id: String },
}
fn default_sound_count() -> u32 {
    1
}

fn deserialize_sound_count<'de, D>(deserializer: D) -> Result<u32, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let count = u32::deserialize(deserializer)?;
    if count == 0 {
        return Err(serde::de::Error::custom("sound cue count must be positive"));
    }
    Ok(count)
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "display/index.ts")]
pub enum DisplayEvent {
    CardPlayed {
        card_id: String,
        card_name: String,
        set_code: String,
        player_id: String,
    },
    TurnChanged {
        active_player_id: String,
        active_player_name: String,
        turn_number: u32,
    },
    SoundCue {
        #[ts(type = "number")]
        sequence: u64,
        sound_type: SoundType,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        origin: Option<SoundCueOrigin>,
        #[serde(
            default = "default_sound_count",
            deserialize_with = "deserialize_sound_count"
        )]
        count: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        prompt_id: Option<u32>,
    },
}
