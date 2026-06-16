use crate::card::valid_filter::MatchContext;
use crate::card::Card;

pub(crate) fn matches_selector_domain_predicate(
    raw: &str,
    card: &Card,
    _context: MatchContext<'_>,
) -> Option<bool> {
    let lower = raw.trim().to_ascii_lowercase();
    if let Some(zone) = lower.strip_prefix("thisturnenteredfrom_") {
        return Some(zone == "battlefield" && card.entered_this_turn());
    }
    if lower.contains("triggeredcardlkicopy")
        || lower.contains("triggeredattackedtarget")
        || lower.contains("validexile ")
        || lower.starts_with("toplibrary_")
    {
        return Some(false);
    }
    None
}
