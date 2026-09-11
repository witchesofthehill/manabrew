use std::borrow::Cow;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A semantic transient-event identifier. Standard constants keep producers typed,
/// while the transparent string representation lets newer identifiers pass
/// through older protocol clients.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, TS)]
#[serde(transparent)]
#[ts(export, export_to = "display/index.ts")]
pub struct DisplayEventType(#[ts(type = "string")] Cow<'static, str>);

impl DisplayEventType {
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
    pub const GAME_CARD_COUNTER_ADD: Self = Self(Cow::Borrowed("game.card.counter-add"));
    pub const GAME_COMBAT_BLOCK: Self = Self(Cow::Borrowed("game.combat.block"));
    pub const GAME_CARD_DAMAGE: Self = Self(Cow::Borrowed("game.card.damage"));
    pub const GAME_DAY_NIGHT_DAY: Self = Self(Cow::Borrowed("game.day-night.day"));
    pub const GAME_TURN_END: Self = Self(Cow::Borrowed("game.turn.end"));
    pub const GAME_CARD_ATTACH: Self = Self(Cow::Borrowed("game.card.attach"));
    pub const GAME_CARD_TRANSFORM: Self = Self(Cow::Borrowed("game.card.transform"));
    pub const GAME_RANDOM_COIN_FLIP: Self = Self(Cow::Borrowed("game.random.coin-flip"));
    pub const GAME_OUTCOME_LOSS: Self = Self(Cow::Borrowed("game.outcome.loss"));
    pub const GAME_PLAYER_MANA_BURN: Self = Self(Cow::Borrowed("game.player.mana-burn"));
    pub const GAME_DAY_NIGHT_NIGHT: Self = Self(Cow::Borrowed("game.day-night.night"));
    pub const GAME_CARD_PHASE: Self = Self(Cow::Borrowed("game.card.phase"));
    pub const GAME_PLAYER_POISON: Self = Self(Cow::Borrowed("game.player.poison"));
    pub const GAME_CARD_REGENERATE: Self = Self(Cow::Borrowed("game.card.regenerate"));
    pub const GAME_CARD_COUNTER_REMOVE: Self = Self(Cow::Borrowed("game.card.counter-remove"));
    pub const GAME_CARD_SACRIFICE: Self = Self(Cow::Borrowed("game.card.sacrifice"));
    pub const GAME_SNAPSHOT_RESTORED: Self = Self(Cow::Borrowed("game.snapshot.restored"));
    pub const GAME_PLAYER_SPEED_UP: Self = Self(Cow::Borrowed("game.player.speed-up"));
    pub const GAME_CONTRAPTION_SPROCKET: Self = Self(Cow::Borrowed("game.contraption.sprocket"));
    pub const GAME_PLAYER_SHARD: Self = Self(Cow::Borrowed("game.player.shard"));
    pub const GAME_TOKEN_CREATE: Self = Self(Cow::Borrowed("game.token.create"));
    pub const GAME_OUTCOME_WIN: Self = Self(Cow::Borrowed("game.outcome.win"));
    pub const GAME_SPELL_RESOLVE_ARTIFACT: Self =
        Self(Cow::Borrowed("game.spell.resolve.artifact"));
    pub const GAME_SPELL_RESOLVE_ARTIFACT_CREATURE: Self =
        Self(Cow::Borrowed("game.spell.resolve.artifact-creature"));
    pub const GAME_SPELL_RESOLVE_CREATURE: Self =
        Self(Cow::Borrowed("game.spell.resolve.creature"));
    pub const GAME_SPELL_RESOLVE_ENCHANTMENT: Self =
        Self(Cow::Borrowed("game.spell.resolve.enchantment"));
    pub const GAME_SPELL_RESOLVE_INSTANT: Self = Self(Cow::Borrowed("game.spell.resolve.instant"));
    pub const GAME_SPELL_RESOLVE_PLANESWALKER: Self =
        Self(Cow::Borrowed("game.spell.resolve.planeswalker"));
    pub const GAME_SPELL_RESOLVE_SORCERY: Self = Self(Cow::Borrowed("game.spell.resolve.sorcery"));
    pub const GAME_LAND_ENTER_BLACK: Self = Self(Cow::Borrowed("game.land.enter.black"));
    pub const GAME_LAND_ENTER_BLUE: Self = Self(Cow::Borrowed("game.land.enter.blue"));
    pub const GAME_LAND_ENTER_GREEN: Self = Self(Cow::Borrowed("game.land.enter.green"));
    pub const GAME_LAND_ENTER_RED: Self = Self(Cow::Borrowed("game.land.enter.red"));
    pub const GAME_LAND_ENTER_WHITE: Self = Self(Cow::Borrowed("game.land.enter.white"));
    pub const GAME_LAND_ENTER_BLACK_RED: Self = Self(Cow::Borrowed("game.land.enter.black-red"));
    pub const GAME_LAND_ENTER_BLACK_WHITE: Self =
        Self(Cow::Borrowed("game.land.enter.black-white"));
    pub const GAME_LAND_ENTER_BLUE_BLACK: Self = Self(Cow::Borrowed("game.land.enter.blue-black"));
    pub const GAME_LAND_ENTER_GREEN_BLACK: Self =
        Self(Cow::Borrowed("game.land.enter.green-black"));
    pub const GAME_LAND_ENTER_GREEN_BLUE: Self = Self(Cow::Borrowed("game.land.enter.green-blue"));
    pub const GAME_LAND_ENTER_GREEN_RED: Self = Self(Cow::Borrowed("game.land.enter.green-red"));
    pub const GAME_LAND_ENTER_RED_BLUE: Self = Self(Cow::Borrowed("game.land.enter.red-blue"));
    pub const GAME_LAND_ENTER_WHITE_BLUE: Self = Self(Cow::Borrowed("game.land.enter.white-blue"));
    pub const GAME_LAND_ENTER_WHITE_GREEN: Self =
        Self(Cow::Borrowed("game.land.enter.white-green"));
    pub const GAME_LAND_ENTER_WHITE_RED: Self = Self(Cow::Borrowed("game.land.enter.white-red"));
    pub const GAME_LAND_ENTER_BLACK_RED_GREEN: Self =
        Self(Cow::Borrowed("game.land.enter.black-red-green"));
    pub const GAME_LAND_ENTER_BLACK_WHITE_GREEN: Self =
        Self(Cow::Borrowed("game.land.enter.black-white-green"));
    pub const GAME_LAND_ENTER_BLUE_BLACK_RED: Self =
        Self(Cow::Borrowed("game.land.enter.blue-black-red"));
    pub const GAME_LAND_ENTER_GREEN_BLACK_BLUE: Self =
        Self(Cow::Borrowed("game.land.enter.green-black-blue"));
    pub const GAME_LAND_ENTER_GREEN_BLUE_RED: Self =
        Self(Cow::Borrowed("game.land.enter.green-blue-red"));
    pub const GAME_LAND_ENTER_GREEN_RED_WHITE: Self =
        Self(Cow::Borrowed("game.land.enter.green-red-white"));
    pub const GAME_LAND_ENTER_RED_BLUE_WHITE: Self =
        Self(Cow::Borrowed("game.land.enter.red-blue-white"));
    pub const GAME_LAND_ENTER_WHITE_BLUE_BLACK: Self =
        Self(Cow::Borrowed("game.land.enter.white-blue-black"));
    pub const GAME_LAND_ENTER_WHITE_GREEN_BLUE: Self =
        Self(Cow::Borrowed("game.land.enter.white-green-blue"));
    pub const GAME_LAND_ENTER_WHITE_RED_BLACK: Self =
        Self(Cow::Borrowed("game.land.enter.white-red-black"));
    pub const GAME_LAND_ENTER_OTHER: Self = Self(Cow::Borrowed("game.land.enter.other"));
    pub const GAME_CARD_SCRIPTED_EFFECT: Self = Self(Cow::Borrowed("game.card.scripted-effect"));
    pub const PROMPT_DECISION_REQUIRED: Self = Self(Cow::Borrowed("prompt.decision-required"));
    pub const PROMPT_TARGET_REQUIRED: Self = Self(Cow::Borrowed("prompt.target-required"));
    pub const PROMPT_PAYMENT_REQUIRED: Self = Self(Cow::Borrowed("prompt.payment-required"));
    pub const PROMPT_COMBAT_REQUIRED: Self = Self(Cow::Borrowed("prompt.combat-required"));
    pub const PROMPT_ACTION_REJECTED: Self = Self(Cow::Borrowed("prompt.action-rejected"));
}

impl<'de> Deserialize<'de> for DisplayEventType {
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
pub enum DisplayEventOrigin {
    Player { player_id: String },
    Card { card_id: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "display/index.ts")]
pub enum DisplayEventContext {
    Card {
        card_name: String,
        set_code: String,
        player_id: String,
    },
    Turn {
        active_player_name: String,
        turn_number: u32,
    },
    Prompt {
        prompt_id: u32,
    },
}

fn default_display_event_count() -> u32 {
    1
}

fn deserialize_display_event_count<'de, D>(deserializer: D) -> Result<u32, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let count = u32::deserialize(deserializer)?;
    if count == 0 {
        return Err(serde::de::Error::custom(
            "display event count must be positive",
        ));
    }
    Ok(count)
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "display/index.ts")]
pub struct DisplayEvent {
    #[ts(type = "number")]
    pub sequence: u64,
    pub event_type: DisplayEventType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub origin: Option<DisplayEventOrigin>,
    #[serde(
        default = "default_display_event_count",
        deserialize_with = "deserialize_display_event_count"
    )]
    pub count: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub context: Option<DisplayEventContext>,
}
