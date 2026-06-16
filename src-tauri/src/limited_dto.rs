use forge_foundation::sealed_product::{PaperCard, Rarity};
use forge_foundation::ColorSet;
use forge_limited::{
    BoosterDraft, GauntletKind, GauntletMini, IBoosterDraft, LimitedDeck, SealedDeckGroup,
    WinstonDraft,
};
use manabrew_agent_interface::deck_dto::CardIdentity;
use serde::{Deserialize, Serialize};

use crate::limited_bootstrap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SealedSetupDto {
    pub pool_type: String,
    pub num_boosters: u32,
    pub pool: Vec<CardIdentity>,
    #[serde(default)]
    pub variant: Option<String>,
    #[serde(default)]
    pub seed: Option<u64>,
}

pub fn paper_card_to_identity(c: &PaperCard) -> CardIdentity {
    CardIdentity {
        id: String::new(),
        name: c.name.clone(),
        set_code: c.set_code.clone(),
        card_number: c.collector_number.clone(),
        foil: if c.foil { Some(true) } else { None },
    }
}

pub fn identity_to_paper_card(c: &CardIdentity) -> PaperCard {
    let (rarity, colors, dual_faced) = resolve_card_meta(&c.name, &c.set_code, &c.card_number);
    let mut pc = PaperCard::new(
        c.name.clone(),
        c.set_code.clone(),
        c.card_number.clone(),
        rarity,
    )
    .with_colors(colors)
    .with_double_faced(dual_faced);
    pc.foil = c.foil.unwrap_or(false);
    pc
}

fn resolve_card_meta(
    name: &str,
    set_code: &str,
    collector_number: &str,
) -> (Rarity, ColorSet, bool) {
    let editions = limited_bootstrap::editions();
    let rarity = editions
        .get(set_code)
        .and_then(|ed| {
            ed.cards
                .iter()
                .find(|e| e.collector_number == collector_number)
        })
        .map(|e| e.rarity)
        .or_else(|| {
            if is_basic_land_name(name) {
                Some(Rarity::BasicLand)
            } else {
                None
            }
        })
        .unwrap_or(Rarity::Unknown);
    let card_db = crate::card_db::get_card_db();
    let (colors, dual_faced) = card_db
        .get_by_card_name(name)
        .map(|r| (r.color(), r.split_type.is_dual_faced()))
        .unwrap_or_default();
    (rarity, colors, dual_faced)
}

fn is_basic_land_name(name: &str) -> bool {
    matches!(
        name,
        "Plains"
            | "Island"
            | "Swamp"
            | "Mountain"
            | "Forest"
            | "Wastes"
            | "Snow-Covered Plains"
            | "Snow-Covered Island"
            | "Snow-Covered Swamp"
            | "Snow-Covered Mountain"
            | "Snow-Covered Forest"
            | "Snow-Covered Wastes"
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LimitedDeckDto {
    pub name: String,
    pub main: Vec<CardIdentity>,
    pub sideboard: Vec<CardIdentity>,
}

impl From<&LimitedDeck> for LimitedDeckDto {
    fn from(d: &LimitedDeck) -> Self {
        Self {
            name: d.name.clone(),
            main: d.main.iter().map(paper_card_to_identity).collect(),
            sideboard: d.sideboard.iter().map(paper_card_to_identity).collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SealedPoolDto {
    pub session_id: String,
    pub deck_name: String,
    pub land_set_code: Option<String>,
    pub cards: Vec<CardIdentity>,
    pub suggested_deck: Option<LimitedDeckDto>,
    pub ai_decks: Vec<LimitedDeckDto>,
}

impl SealedPoolDto {
    pub fn from_group(session_id: String, group: &SealedDeckGroup) -> Self {
        Self {
            session_id,
            deck_name: group.deck_name.clone(),
            land_set_code: group.land_set_code.clone(),
            cards: group
                .human_pool
                .iter()
                .map(paper_card_to_identity)
                .collect(),
            suggested_deck: group
                .suggested_human_deck
                .as_ref()
                .map(LimitedDeckDto::from),
            ai_decks: group.ai_decks.iter().map(LimitedDeckDto::from).collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SealedTemplateMetadataDto {
    pub id: String,
    pub label: String,
    pub description: String,
    pub num_packs: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditionInfoDto {
    pub code: String,
    pub name: String,
    pub edition_type: String,
    pub date: Option<String>,
    pub slots: Vec<EditionSlotDto>,
    pub foil_chance: f64,
    pub foil_type: String,
    pub variants: Vec<String>,
    pub has_replacement_hooks: bool,
    pub booster_covers: u32,
    pub prerelease: Option<String>,
    pub alias: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditionSlotDto {
    pub label: String,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CubeMetadataDto {
    pub id: String,
    pub name: String,
    pub num_packs: u32,
    pub singleton: bool,
    pub land_set_code: Option<String>,
    pub card_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoosterDraftSetupDto {
    pub pod_size: u32,
    pub rounds: u32,
    pub pool: Vec<CardIdentity>,
    #[serde(default)]
    pub variant: Option<String>,
    #[serde(default)]
    pub seed: Option<u64>,
    #[serde(default)]
    pub picks_per_pass: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftSeatDto {
    pub seat: u32,
    pub name: String,
    pub is_human: bool,
    pub picks_made: u32,
    pub last_pick_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftStateDto {
    pub session_id: String,
    pub round: u32,
    pub total_rounds: u32,
    pub pick_number: u32,
    pub pack_size: u32,
    pub current_pack: Vec<CardIdentity>,
    pub picked_pile: Vec<CardIdentity>,
    pub seat_summaries: Vec<DraftSeatDto>,
    pub is_round_over: bool,
    pub is_complete: bool,
    pub awaiting_human: bool,
    pub human_conspiracies: Vec<String>,
    pub picks_per_pass: u32,
    pub picks_remaining_in_pack: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WinstonStateDto {
    pub session_id: String,
    pub active_seat: u32,
    pub current_pile: u32,
    pub piles: Vec<Vec<CardIdentity>>,
    pub deck_size: u32,
    pub picked_pile: Vec<CardIdentity>,
    pub ai_pick_count: u32,
    pub awaiting_human: bool,
    pub is_complete: bool,
}

impl WinstonStateDto {
    pub fn from_engine(session_id: String, draft: &WinstonDraft) -> Self {
        let piles: Vec<Vec<CardIdentity>> = draft
            .piles()
            .iter()
            .map(|p| p.iter().map(paper_card_to_identity).collect())
            .collect();
        Self {
            session_id,
            active_seat: draft.active_seat() as u32,
            current_pile: draft.current_pile() as u32,
            piles,
            deck_size: draft.deck_size() as u32,
            picked_pile: draft
                .human_picked()
                .iter()
                .map(paper_card_to_identity)
                .collect(),
            ai_pick_count: draft.ai_picked_count() as u32,
            awaiting_human: draft.is_human_turn() && !draft.is_complete(),
            is_complete: draft.is_complete(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WinstonSetupDto {
    pub pool_packs: u32,
    pub pool: Vec<CardIdentity>,
    #[serde(default)]
    pub variant: Option<String>,
    #[serde(default)]
    pub seed: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CubeImportRequestDto {
    pub cube_id_or_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CubeImportResultDto {
    pub cube_id: String,
    pub name: String,
    pub card_count: u32,
    pub num_packs: u32,
    pub singleton: bool,
    pub pool: Vec<CardIdentity>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChaosThemeDto {
    pub tag: String,
    pub label: String,
    pub order_number: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GauntletSetupDto {
    pub session_id: String,
    pub kind: String,
    pub rounds: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GauntletMatchDecksDto {
    pub human_deck_name: String,
    pub human_main: Vec<CardIdentity>,
    pub human_sideboard: Vec<CardIdentity>,
    pub opponent_name: String,
    pub opponent_main: Vec<CardIdentity>,
    pub opponent_sideboard: Vec<CardIdentity>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GauntletStateDto {
    pub gauntlet_id: String,
    pub kind: String,
    pub rounds: u32,
    pub current_round: u32,
    pub wins: u32,
    pub losses: u32,
    pub completed: bool,
    pub human_deck_name: String,
    pub opponents: Vec<GauntletOpponentDto>,
    pub current_opponent: Option<GauntletOpponentDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GauntletOpponentDto {
    pub round: u32,
    pub deck_name: String,
    pub main_count: u32,
    pub sideboard_count: u32,
}

impl GauntletStateDto {
    pub fn from_engine(gauntlet_id: String, g: &GauntletMini) -> Self {
        let opponents: Vec<GauntletOpponentDto> = g
            .ai_decks
            .iter()
            .enumerate()
            .map(|(i, d)| GauntletOpponentDto {
                round: (i + 1) as u32,
                deck_name: d.name.clone(),
                main_count: d.main.len() as u32,
                sideboard_count: d.sideboard.len() as u32,
            })
            .collect();
        let current_opponent = opponents
            .get(g.current_round.saturating_sub(1) as usize)
            .filter(|_| !g.completed)
            .cloned();
        Self {
            gauntlet_id,
            kind: gauntlet_kind_str(g.kind).to_string(),
            rounds: g.rounds,
            current_round: g.current_round,
            wins: g.wins,
            losses: g.losses,
            completed: g.completed,
            human_deck_name: g.human_deck.name.clone(),
            opponents,
            current_opponent,
        }
    }
}

fn gauntlet_kind_str(k: GauntletKind) -> &'static str {
    match k {
        GauntletKind::Sealed => "sealed",
        GauntletKind::BoosterDraft => "draft",
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GauntletOutcomeDto {
    pub state: GauntletStateDto,
    pub outcome: String,
    pub next_round_index: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConspiracyHookDto {
    pub card_name: String,
    pub flag_name: String,
    pub description: String,
}

impl DraftStateDto {
    pub fn from_engine(session_id: String, draft: &BoosterDraft, awaiting_human: bool) -> Self {
        Self::from_engine_for_seat(session_id, draft, 0, awaiting_human)
    }

    pub fn from_engine_for_seat(
        session_id: String,
        draft: &BoosterDraft,
        seat_idx: usize,
        awaiting_human: bool,
    ) -> Self {
        let viewer = draft.seat(seat_idx);
        let pack: Vec<CardIdentity> = draft
            .current_pack_for_seat(seat_idx)
            .map(|p| p.cards().iter().map(paper_card_to_identity).collect())
            .unwrap_or_default();
        let pick_number = viewer.map(|s| s.picked.len() + 1).unwrap_or(1) as u32;
        let mut seat_summaries: Vec<DraftSeatDto> = (0..draft.pod_size())
            .filter_map(|i| draft.seat(i))
            .map(|p| DraftSeatDto {
                seat: p.seat as u32,
                name: p.name.clone(),
                is_human: p.is_human,
                picks_made: p.picked.len() as u32,
                last_pick_name: p.last_pick.as_ref().map(|c| c.name.clone()),
            })
            .collect();
        seat_summaries.sort_by_key(|s| s.seat);
        let human_conspiracies: Vec<String> = viewer
            .map(|s| {
                forge_limited::CONSPIRACY_HOOKS
                    .iter()
                    .filter(|h| s.flags.contains(h.flag))
                    .map(|h| h.card_name.to_string())
                    .collect()
            })
            .unwrap_or_default();
        let picks_remaining_in_pack = draft
            .current_pack_for_seat(seat_idx)
            .map(|p| p.picks_remaining())
            .unwrap_or(0);
        let picked_pile = viewer
            .map(|s| s.picked.iter().map(paper_card_to_identity).collect())
            .unwrap_or_default();
        Self {
            session_id,
            round: draft.round(),
            total_rounds: draft.total_rounds(),
            pick_number,
            pack_size: pack.len() as u32,
            current_pack: pack,
            picked_pile,
            seat_summaries,
            is_round_over: draft.is_round_over(),
            is_complete: !draft.has_next_choice() && draft.round() >= draft.total_rounds(),
            awaiting_human,
            human_conspiracies,
            picks_per_pass: draft.picks_per_pass(),
            picks_remaining_in_pack,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MpDraftHumanSeatDto {
    pub seat: u32,
    pub name: String,
}
