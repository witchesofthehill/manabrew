use manabrew_engine::ids::{CardId, PlayerId};

pub fn player_slot(index: usize) -> String {
    format!("player-{}", index)
}

pub fn player_id_str(pid: PlayerId) -> String {
    player_slot(pid.0 as usize)
}

pub fn card_id_str(cid: CardId) -> String {
    format!("card-{}", cid.0)
}

pub fn stack_id_str(id: u32) -> String {
    format!("stack-{}", id)
}

pub fn parse_player_slot(slot: &str) -> Option<usize> {
    slot.strip_prefix("player-")
        .and_then(|n| n.parse::<usize>().ok())
}

pub fn parse_player_id(s: &str) -> Option<PlayerId> {
    parse_player_slot(s).map(|n| PlayerId(n as u32))
}

pub fn parse_card_id(s: &str) -> Option<CardId> {
    s.strip_prefix("card-")
        .and_then(|n| n.parse::<u32>().ok())
        .map(CardId)
}

pub fn parse_stack_id(s: &str) -> Option<u32> {
    s.strip_prefix("stack-").and_then(|n| n.parse::<u32>().ok())
}
