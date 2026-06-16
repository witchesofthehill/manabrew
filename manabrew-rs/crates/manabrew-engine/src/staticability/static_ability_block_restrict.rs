use forge_foundation::ZoneType;

use crate::card::{valid_filter, Card};
use crate::ids::PlayerId;
use crate::parsing::CompiledSelector;
use crate::staticability::StaticMode;

pub fn block_restrict_num(cards: &[Card], defender: PlayerId) -> i32 {
    let mut num = i32::MAX;
    for source in cards.iter().filter(|c| c.zone == ZoneType::Battlefield) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&StaticMode::BlockRestrict))
        {
            let valid = st_ab.ir.valid_defender.as_ref();
            if !matches_valid_player(valid, defender, source.controller) {
                continue;
            }
            let n = st_ab
                .ir
                .max_blockers
                .as_deref()
                .map(|s| eval_amount(source, s))
                .unwrap_or(1);
            if n < num {
                num = n;
            }
        }
    }
    num
}

fn matches_valid_player(
    valid: Option<&CompiledSelector>,
    player: PlayerId,
    source_controller: PlayerId,
) -> bool {
    valid_filter::matches_valid_player_selector_opt(valid, player, source_controller)
}

fn eval_amount(source: &Card, expr: &str) -> i32 {
    if let Ok(n) = expr.parse::<i32>() {
        return n;
    }
    if let Some(svar) = source.svars.get(expr) {
        if let Ok(n) = svar.parse::<i32>() {
            return n;
        }
        let mut sa =
            crate::spellability::SpellAbility::new_empty(Some(source.id), source.controller);
        sa.kicked = false;
        return crate::ability::effects::evaluate_svar(svar, &sa);
    }
    1
}
