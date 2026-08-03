use manabrew_protocol::game::{
    CardDto, CardView, GameViewDto, PlayerCounterKind, PlayerDto, ZoneKind,
};

pub fn visible(card: &CardView) -> Option<&CardDto> {
    match card {
        CardView::Visible(c) => Some(c),
        CardView::Hidden { .. } => None,
    }
}

pub fn zone_cards<'a>(
    view: &'a GameViewDto,
    owner_id: &'a str,
    kind: ZoneKind,
) -> impl Iterator<Item = &'a CardDto> {
    view.zones
        .iter()
        .filter(move |z| z.zone == kind && z.owner_id == owner_id)
        .flat_map(|z| z.cards.iter())
        .filter_map(visible)
}

pub fn battlefield_cards(view: &GameViewDto) -> impl Iterator<Item = &CardDto> {
    view.zones
        .iter()
        .filter(|z| z.zone == ZoneKind::Battlefield)
        .flat_map(|z| z.cards.iter())
        .filter_map(visible)
}

pub fn all_visible_cards(view: &GameViewDto) -> impl Iterator<Item = &CardDto> {
    view.zones
        .iter()
        .flat_map(|z| z.cards.iter())
        .filter_map(visible)
}

pub fn library_count(view: &GameViewDto, owner_id: &str) -> usize {
    view.zones
        .iter()
        .find(|z| z.zone == ZoneKind::Library && z.owner_id == owner_id)
        .map(|z| z.count)
        .unwrap_or(0)
}

pub fn player<'a>(view: &'a GameViewDto, id: &str) -> Option<&'a PlayerDto> {
    view.players.iter().find(|p| p.id == id)
}

pub fn counter(player: &PlayerDto, kind: PlayerCounterKind) -> u32 {
    player.counters.get(&kind).copied().unwrap_or(0)
}
