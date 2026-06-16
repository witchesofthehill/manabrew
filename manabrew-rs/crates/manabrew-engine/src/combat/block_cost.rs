//! Block cost computation (War Cadence, etc.).
//!
//! Mirrors Java Forge's `CombatUtil.getBlockCost()` — scans battlefield for
//! `CantBlockUnless` static abilities and accumulates the mana cost a
//! blocker must pay to block a given attacker.

use forge_foundation::ZoneType;

use crate::card::{valid_filter, Card};
use crate::staticability::StaticMode;

/// Compute the total generic mana cost required for `blocker` to block `attacker`.
///
/// Returns the accumulated cost as a generic mana amount, or 0 if no cost.
///
/// Card script example (War Cadence):
/// ```text
/// S:Mode$ CantBlockUnless | ValidCard$ Creature | Cost$ 1
/// ```
pub fn get_block_cost(cards: &[Card], blocker: &Card, _attacker: &Card) -> i32 {
    let mut total_cost = 0;

    for source in cards.iter().filter(|c| c.zone == ZoneType::Battlefield) {
        for sa in &source.static_abilities {
            if !sa.check_mode(&StaticMode::CantBlockUnless) {
                continue;
            }

            // Check ValidCard$ matches the blocker
            if !valid_filter::matches_valid_card_selector_opt(
                sa.ir.valid_card.as_ref(),
                blocker,
                source,
            ) {
                continue;
            }

            // Parse Cost$ parameter as generic mana amount
            if let Some(cost_str) = sa.ir.cost.as_deref() {
                if let Ok(cost) = cost_str.trim().parse::<i32>() {
                    total_cost += cost;
                }
            }
        }
    }

    total_cost
}
