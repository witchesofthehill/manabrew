use manabrew_engine::ids::CardId;

/// Append a stable parity key to each label: `label@key`.
pub fn disambiguate_labels(raw: &[String]) -> Vec<String> {
    raw.iter()
        .enumerate()
        .map(|(i, s)| format!("{s}@{}", i + 1))
        .collect()
}

/// Build stable per-decision labels for cards in list order.
pub fn label_cards_in_order(
    cards: &[CardId],
    mut card_name: impl FnMut(CardId) -> String,
    mut parity_id: impl FnMut(CardId) -> u32,
) -> Vec<(CardId, String)> {
    let raw: Vec<String> = cards.iter().map(|&id| card_name(id)).collect();
    let keys: Vec<u64> = cards.iter().map(|&id| parity_id(id) as u64).collect();
    let labels = disambiguate_labels_with_keys(&raw, &keys);
    cards.iter().copied().zip(labels).collect()
}

pub fn disambiguate_labels_with_keys(raw: &[String], keys: &[u64]) -> Vec<String> {
    raw.iter()
        .enumerate()
        .map(|(i, s)| {
            let key = keys.get(i).copied().unwrap_or(u64::MAX);
            format!("{s}@{key}")
        })
        .collect()
}
