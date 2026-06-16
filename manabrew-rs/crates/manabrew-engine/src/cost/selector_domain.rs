use crate::card::valid_filter::MatchContext;
use crate::card::Card;

pub(crate) fn matches_selector_domain_predicate(
    raw: &str,
    card: &Card,
    context: MatchContext<'_>,
) -> Option<bool> {
    let lower = raw.trim().to_ascii_lowercase();
    if let Some(comparison) = lower.strip_prefix("manaspent ") {
        return matches_comparison(
            context.source_card.paying_mana_to_cast.len() as i32,
            comparison,
        );
    }
    if let Some(comparison) = lower.strip_prefix("numtargets ") {
        return matches_comparison(
            (context.targeted_cards.len() + context.targeted_players.len()) as i32,
            comparison,
        );
    }
    if lower.starts_with("kicked ") {
        return Some(false);
    }
    match lower.as_str() {
        "cmceven" => Some(card.mana_cost.cmc() % 2 == 0),
        "cmcodd" => Some(card.mana_cost.cmc() % 2 == 1),
        "powereven" => Some(card.power() % 2 == 0),
        "powerodd" => Some(card.power() % 2 != 0),
        "powernotbasepower" => card.base_power.map(|base_power| card.power() != base_power),
        _ => None,
    }
}

fn matches_comparison(actual: i32, comparison: &str) -> Option<bool> {
    let comparison = comparison.trim();
    let operator = comparison.get(..2)?;
    let expected = comparison.get(2..)?.trim().parse::<i32>().ok()?;
    match operator {
        "eq" => Some(actual == expected),
        "ne" => Some(actual != expected),
        "lt" => Some(actual < expected),
        "le" => Some(actual <= expected),
        "gt" => Some(actual > expected),
        "ge" => Some(actual >= expected),
        _ => None,
    }
}
