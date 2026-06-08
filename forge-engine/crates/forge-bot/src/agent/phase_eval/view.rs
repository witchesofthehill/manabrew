// Adapted from phase-rs/phase crates/phase-ai (Apache-2.0). See THIRD-PARTY-NOTICES.md.
use forge_agent_interface::game_view_dto::{CardDto, GameViewDto, PlayerDto};

pub struct BotView<'a> {
    pub view: &'a GameViewDto,
    pub me: String,
}

impl<'a> BotView<'a> {
    pub fn new(view: &'a GameViewDto, me: &str) -> Self {
        Self {
            view,
            me: me.to_string(),
        }
    }

    pub fn player(&self, id: &str) -> Option<&'a PlayerDto> {
        self.view.player(id)
    }

    pub fn my_life(&self) -> i32 {
        self.player(&self.me).map_or(0, |p| p.life)
    }

    pub fn opponents(&self) -> Vec<&'a PlayerDto> {
        self.view
            .players
            .iter()
            .filter(|p| p.id != self.me)
            .collect()
    }

    pub fn creatures_of(&self, id: &str) -> Vec<&'a CardDto> {
        self.view
            .battlefield
            .iter()
            .filter(|c| c.controller_id == id && is_creature(c))
            .collect()
    }

    /// Look up a card by id across only the zones a fair player can see:
    /// the shared battlefield, every player's public graveyard / exile /
    /// command zone, and the bot's own hand. Opponents' hand contents are
    /// deliberately excluded so the AI never reads hidden information.
    pub fn card_by_id(&self, id: &str) -> Option<&'a CardDto> {
        if let Some(c) = self.view.battlefield.iter().find(|c| c.id == id) {
            return Some(c);
        }
        for p in &self.view.players {
            if p.id == self.me {
                if let Some(c) = p.hand.iter().find(|c| c.id == id) {
                    return Some(c);
                }
            }
            if let Some(c) = p
                .graveyard
                .iter()
                .chain(p.exile.iter())
                .chain(p.command_zone.iter())
                .find(|c| c.id == id)
            {
                return Some(c);
            }
        }
        None
    }

    pub fn commander_format(&self) -> bool {
        self.view.players.iter().any(|p| !p.command_zone.is_empty())
    }

    pub fn starting_life(&self) -> f64 {
        if self.commander_format() {
            40.0
        } else {
            20.0
        }
    }
}

pub fn is_creature(c: &CardDto) -> bool {
    c.types.iter().any(|t| t.eq_ignore_ascii_case("creature"))
}

pub fn is_land(c: &CardDto) -> bool {
    c.types.iter().any(|t| t.eq_ignore_ascii_case("land"))
}

pub fn power_of(c: &CardDto) -> i32 {
    c.power
        .as_deref()
        .and_then(parse_stat)
        .or(c.base_power)
        .unwrap_or(0)
}

pub fn toughness_of(c: &CardDto) -> i32 {
    c.toughness
        .as_deref()
        .and_then(parse_stat)
        .or(c.base_toughness)
        .unwrap_or(0)
}

fn parse_stat(s: &str) -> Option<i32> {
    s.trim().parse::<i32>().ok()
}

pub fn has_kw(c: &CardDto, kw: &str) -> bool {
    c.keywords.iter().any(|k| k.eq_ignore_ascii_case(kw))
}
