use forge_foundation::ZoneType;

use crate::card::{valid_filter, Card, CounterType};
use crate::parsing::CompiledSelector;
use crate::staticability::StaticMode;

pub fn max_counter(cards: &[Card], target: &Card, counter_type: &CounterType) -> Option<i32> {
    let _perf_scope =
        crate::perf::ParamsLookupScopeGuard::enter(crate::perf::ParamsLookupScope::StaticAbility);
    let mut result: Option<i32> = None;
    for source in cards.iter().filter(|c| c.zone == ZoneType::Battlefield) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&StaticMode::MaxCounter))
        {
            if let Some(parsed) = st_ab.ir.counter_type.as_ref() {
                if *parsed != *counter_type {
                    continue;
                }
            }
            if !matches_valid_card(st_ab.ir.valid_card.as_ref(), target, source) {
                continue;
            }
            let value = st_ab.ir.max_num.unwrap_or(0);
            result = Some(result.map_or(value, |v| v.min(value)));
        }
    }
    result
}

fn matches_valid_card(valid: Option<&CompiledSelector>, card: &Card, source: &Card) -> bool {
    valid_filter::matches_valid_card_selector_opt(valid, card, source)
}
