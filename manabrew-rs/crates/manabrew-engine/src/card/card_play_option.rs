//! Card play-option metadata (Java parity: `CardPlayOption`).

use crate::ids::PlayerId;
use crate::staticability::StaticAbility;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PayManaCost {
    Yes,
    No,
}

#[derive(Debug, Clone)]
pub struct CardPlayOption {
    pub player: PlayerId,
    pub static_ability: StaticAbility,
    pub pay_mana_cost: PayManaCost,
    pub with_flash: bool,
    pub grants_zone_permissions_flag: bool,
}

impl CardPlayOption {
    /// Java parity: whether this option permits spending mana as any type/color.
    pub fn apply_mana_convert(&self) -> bool {
        self.static_ability.ir.may_play_ignore_type
            || self.static_ability.ir.may_play_ignore_color
            || self.static_ability.ir.may_play_snow_ignore_color
    }

    /// Java parity accessor (`grantsZonePermissions`).
    pub fn grants_zone_permissions(&self) -> bool {
        self.grants_zone_permissions_flag
    }
}
