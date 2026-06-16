use crate::card::valid_filter::MatchContext;
use crate::card::Card;

pub(crate) fn matches_selector_domain_predicate(
    raw: &str,
    _card: &Card,
    _context: MatchContext<'_>,
) -> Option<bool> {
    let lower = raw.trim().to_ascii_lowercase();
    if lower.contains("attachedby ")
        || lower.contains("enchantedby ")
        || lower.contains("damagedby ")
        || lower.contains("sharesblockingassignmentwith")
        || lower.starts_with("blockedbyvalidthisturn ")
        || lower.starts_with("blockedvalidthisturn ")
        || lower.starts_with("blockingvalid ")
        || lower.starts_with("attacking ")
        || lower.starts_with("totalpt_")
    {
        return Some(false);
    }
    None
}
