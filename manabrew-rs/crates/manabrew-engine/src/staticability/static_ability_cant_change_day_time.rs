use crate::game::GameState;
use crate::staticability::StaticMode;

/// Check if day/night cannot change to the given value.
///
/// `value`: `None` corresponds to Java's `null` → always returns `false`.
/// `Some(false)` = changing to Day, `Some(true)` = changing to Night.
///
/// Mirrors Java's `cantChangeDay(Game, Boolean)`.
pub fn cant_change_day(game: &GameState, value: Option<bool>) -> bool {
    // Java: if (value == null) return false;
    let Some(value) = value else {
        return false;
    };

    for card in game
        .cards
        .iter()
        .filter(|c| c.zone.is_static_ability_source())
    {
        for st_ab in card
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&StaticMode::CantChangeDayTime) && sa.zones_check(card.zone))
        {
            if cant_change_day_check(st_ab, value) {
                return true;
            }
        }
    }
    false
}

/// Mirrors Java's `cantChangeDayCheck`.
///
/// IMPORTANT: The Java code has intentional fall-through in its switch statement
/// (no break between "Day" and "Night" cases). This means:
/// - `NewTime = "Day"` → always returns false (both checks fire due to fall-through)
/// - `NewTime = "Night"` → returns false unless `value == true`
/// - No `NewTime` param → returns true (no restriction)
fn cant_change_day_check(st_ab: &crate::staticability::StaticAbility, value: bool) -> bool {
    if let Some(new_time) = st_ab.ir.new_time_text.as_deref() {
        match new_time {
            "Day" => {
                // Fall-through: Day case runs both checks.
                // First: if (value != false) return false;
                if value {
                    return false;
                }
                // Falls through to Night case:
                // if (value != true) return false;
                if !value {
                    return false;
                }
            }
            "Night" => {
                // if (value != true) return false;
                if !value {
                    return false;
                }
            }
            _ => {}
        }
    }
    true
}
