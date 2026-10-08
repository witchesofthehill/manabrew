use forge_foundation::sealed_product::{PaperCard, Rarity};
use forge_foundation::ColorSet;
use forge_limited::{
    BoosterDraft, GauntletKind, GauntletMini, IBoosterDraft, LimitedDeck, SealedDeckGroup,
    WinstonDraft,
};
use manabrew_protocol::deck_dto::DeckCardIdentity;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LimitedEngineCheckpointDto {
    pub schema_version: u32,
    pub kind: String,
    pub session_id: String,
    pub state: serde_json::Value,
}

impl LimitedEngineCheckpointDto {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err(format!(
                "unsupported Limited checkpoint schema version {}",
                self.schema_version
            ));
        }
        if self.session_id.is_empty() {
            return Err("Limited checkpoint session id is empty".into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LimitedSessionImportDto {
    pub kind: String,
    pub session_id: String,
    pub state: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GauntletCheckpointDto {
    pub engine: GauntletMini,
    pub decks: Vec<LimitedDeckDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LimitedDraftDecisionDto {
    pub revision: u64,
    pub seat: usize,
    pub round: u32,
    pub pick_number: u32,
    pub action: forge_limited::DraftDecisionAction,
    pub pack_id: String,
    pub visible_cards: Vec<DeckCardIdentity>,
    pub selected_ids: Vec<String>,
    pub automatic: bool,
}

impl LimitedDraftDecisionDto {
    pub fn from_engine(
        session_id: &str,
        kind: &str,
        decision: forge_limited::DraftDecision,
    ) -> Self {
        let occurrence_id = |id| {
            if kind == "draft" {
                format!("{session_id}:{}:{id}", decision.pack_id)
            } else {
                format!("{session_id}:{id}")
            }
        };
        let visible_cards = decision
            .visible_cards
            .iter()
            .map(|(card, id)| {
                let mut card = paper_card_to_identity(card);
                card.id = occurrence_id(*id);
                card
            })
            .collect();
        let selected_ids = decision
            .selected_ids
            .iter()
            .map(|id| occurrence_id(*id))
            .collect();
        Self {
            revision: decision.revision,
            seat: decision.seat,
            round: decision.round,
            pick_number: decision.pick_number,
            action: decision.action,
            pack_id: format!("{session_id}:{}", decision.pack_id),
            visible_cards,
            selected_ids,
            automatic: decision.automatic,
        }
    }
}

use crate::limited_bootstrap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SealedSetupDto {
    pub pool_type: String,
    pub num_boosters: u32,
    pub pool: Vec<DeckCardIdentity>,
    #[serde(default)]
    pub variant: Option<String>,
    #[serde(default)]
    pub seed: Option<u64>,
    #[serde(default)]
    pub singleton: bool,
}

pub fn paper_card_to_identity(c: &PaperCard) -> DeckCardIdentity {
    DeckCardIdentity {
        id: String::new(),
        oracle_id: None,
        token_script: None,
        name: c.name.clone(),
        set_code: c.set_code.clone(),
        card_number: c.collector_number.clone(),
        foil: if c.foil { Some(true) } else { None },
    }
}

pub fn identity_to_paper_card(c: &DeckCardIdentity) -> PaperCard {
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
    pub main: Vec<DeckCardIdentity>,
    pub sideboard: Vec<DeckCardIdentity>,
}

impl From<&LimitedDeck> for LimitedDeckDto {
    fn from(d: &LimitedDeck) -> Self {
        Self {
            name: d.name.clone(),
            main: d
                .main
                .iter()
                .enumerate()
                .map(|(i, c)| {
                    let mut card = paper_card_to_identity(c);
                    card.id = format!("{}:main:{i}", d.name);
                    card
                })
                .collect(),
            sideboard: d
                .sideboard
                .iter()
                .enumerate()
                .map(|(i, c)| {
                    let mut card = paper_card_to_identity(c);
                    card.id = format!("{}:sideboard:{i}", d.name);
                    card
                })
                .collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SealedPackDto {
    pub id: String,
    pub set_code: String,
    pub cards: Vec<DeckCardIdentity>,
}

pub fn deck_with_pool_ids(deck: &LimitedDeck, pool: &[DeckCardIdentity]) -> LimitedDeckDto {
    let mut dto = LimitedDeckDto::from(deck);
    let mut remaining: Vec<&DeckCardIdentity> = pool.iter().collect();
    for card in dto.main.iter_mut().chain(dto.sideboard.iter_mut()) {
        if let Some(index) = remaining.iter().position(|source| {
            source.name == card.name
                && source.set_code == card.set_code
                && source.card_number == card.card_number
                && source.foil == card.foil
        }) {
            card.id = remaining.remove(index).id.clone();
        }
    }
    dto.sideboard.extend(remaining.into_iter().cloned());
    dto
}

pub fn draft_picked_cards(
    session_id: &str,
    draft: &BoosterDraft,
    seat_idx: usize,
) -> Vec<DeckCardIdentity> {
    draft
        .seat(seat_idx)
        .map(|seat| {
            seat.picked
                .iter()
                .zip(draft.picked_ids_for_seat(seat_idx))
                .map(|(c, (pack, id))| {
                    let mut card = paper_card_to_identity(c);
                    card.id = format!("{session_id}:{pack}:{id}");
                    card
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn submit_occurrence_pick(
    draft: &mut BoosterDraft,
    session_id: &str,
    seat: usize,
    card_id: &str,
) -> Result<(), String> {
    let (pack, card) = parse_occurrence_id(session_id, card_id)?;
    draft.submit_human_pick_id_for(seat, pack, card)
}

pub fn parse_occurrence_id(session_id: &str, card_id: &str) -> Result<(u32, u32), String> {
    let suffix = card_id
        .strip_prefix(session_id)
        .and_then(|s| s.strip_prefix(':'))
        .ok_or_else(|| "card occurrence belongs to another session".to_string())?;
    let (pack, card) = suffix
        .split_once(':')
        .ok_or_else(|| "invalid card occurrence".to_string())?;
    let pack = pack
        .parse()
        .map_err(|_| "invalid pack occurrence".to_string())?;
    let card = card
        .parse()
        .map_err(|_| "invalid card occurrence".to_string())?;
    Ok((pack, card))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftAiDeckDto {
    pub seat: u32,
    pub deck: LimitedDeckDto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SealedPoolDto {
    pub session_id: String,
    pub deck_name: String,
    pub land_set_code: Option<String>,
    pub cards: Vec<DeckCardIdentity>,
    pub packs: Vec<SealedPackDto>,
    pub suggested_deck: Option<LimitedDeckDto>,
    pub ai_decks: Vec<LimitedDeckDto>,
}

impl SealedPoolDto {
    pub fn from_group(session_id: String, group: &SealedDeckGroup) -> Self {
        let packs: Vec<SealedPackDto> = group
            .human_packs
            .iter()
            .enumerate()
            .map(|(pack_index, cards)| {
                let id = format!("{session_id}:{pack_index}");
                SealedPackDto {
                    set_code: group.pack_set_code.clone(),
                    cards: cards
                        .iter()
                        .enumerate()
                        .map(|(card_index, c)| {
                            let mut card = paper_card_to_identity(c);
                            card.id = format!("{id}:{card_index}");
                            card
                        })
                        .collect(),
                    id,
                }
            })
            .collect();
        let cards: Vec<DeckCardIdentity> = packs
            .iter()
            .flat_map(|pack| pack.cards.iter().cloned())
            .collect();
        let suggested_deck = group
            .suggested_human_deck
            .as_ref()
            .map(|deck| deck_with_pool_ids(deck, &cards));
        Self {
            session_id,
            deck_name: group.deck_name.clone(),
            land_set_code: group.land_set_code.clone(),
            cards,
            packs,
            suggested_deck,
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
pub struct BoosterDraftSetupDto {
    pub pod_size: u32,
    pub rounds: u32,
    pub pool: Vec<DeckCardIdentity>,
    #[serde(default)]
    pub variant: Option<String>,
    #[serde(default)]
    pub seed: Option<u64>,
    #[serde(default)]
    pub picks_per_pass: Option<u32>,
    #[serde(default)]
    pub pick_seconds: Option<u32>,
    #[serde(default)]
    pub custom_pool: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftSeatDto {
    pub seat: u32,
    pub name: String,
    pub is_human: bool,
    pub picks_made: u32,
    pub last_pick_name: Option<String>,
    pub current_pack_size: u32,
    pub packs_waiting: u32,
    pub awaiting_pick: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftStateDto {
    pub session_id: String,
    pub revision: u64,
    pub round: u32,
    pub total_rounds: u32,
    pub pick_number: u32,
    pub pack_size: u32,
    pub current_pack: Vec<DeckCardIdentity>,
    pub picked_pile: Vec<DeckCardIdentity>,
    pub seat_summaries: Vec<DraftSeatDto>,
    pub is_round_over: bool,
    pub is_complete: bool,
    pub awaiting_human: bool,
    pub human_conspiracies: Vec<String>,
    pub picks_per_pass: u32,
    pub picks_remaining_in_pack: u32,
    pub pass_direction: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WinstonStateDto {
    pub session_id: String,
    pub revision: u64,
    pub active_seat: u32,
    pub current_pile: u32,
    pub piles: Vec<Vec<DeckCardIdentity>>,
    pub deck_size: u32,
    pub picked_pile: Vec<DeckCardIdentity>,
    pub ai_pick_count: u32,
    pub awaiting_human: bool,
    pub is_complete: bool,
}

impl WinstonStateDto {
    pub fn from_engine(session_id: String, draft: &WinstonDraft) -> Self {
        let piles: Vec<Vec<DeckCardIdentity>> = draft
            .piles()
            .iter()
            .zip(draft.pile_ids())
            .map(|(pile, ids)| {
                pile.iter()
                    .zip(ids)
                    .map(|(c, id)| {
                        let mut card = paper_card_to_identity(c);
                        card.id = format!("{session_id}:{id}");
                        card
                    })
                    .collect()
            })
            .collect();
        let picked_pile = draft
            .human_picked()
            .iter()
            .zip(draft.human_picked_ids())
            .map(|(c, id)| {
                let mut card = paper_card_to_identity(c);
                card.id = format!("{session_id}:{id}");
                card
            })
            .collect();
        Self {
            session_id,
            revision: draft.revision(),
            active_seat: draft.active_seat() as u32,
            current_pile: draft.current_pile() as u32,
            piles,
            deck_size: draft.deck_size() as u32,
            picked_pile,
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
    pub pool: Vec<DeckCardIdentity>,
    #[serde(default)]
    pub variant: Option<String>,
    #[serde(default)]
    pub seed: Option<u64>,
    #[serde(default)]
    pub custom_pool: bool,
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
    pub pool: Vec<DeckCardIdentity>,
    pub playable_card_count: u32,
    pub rejected_card_count: u32,
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
pub struct GauntletMatchDecksDto {
    pub human_deck_name: String,
    pub human_main: Vec<DeckCardIdentity>,
    pub human_sideboard: Vec<DeckCardIdentity>,
    pub opponent_name: String,
    pub opponent_main: Vec<DeckCardIdentity>,
    pub opponent_sideboard: Vec<DeckCardIdentity>,
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
        let pack: Vec<DeckCardIdentity> = draft
            .current_pack_for_seat(seat_idx)
            .map(|p| {
                p.cards()
                    .iter()
                    .zip(p.card_ids())
                    .map(|(c, id)| {
                        let mut card = paper_card_to_identity(c);
                        card.id = format!("{session_id}:{}:{id}", p.id());
                        card
                    })
                    .collect()
            })
            .unwrap_or_default();
        let pick_number = viewer.map(|s| s.picked.len() + 1).unwrap_or(1) as u32;
        let mut seat_summaries: Vec<DraftSeatDto> = (0..draft.pod_size())
            .filter_map(|i| draft.seat(i))
            .map(|p| DraftSeatDto {
                seat: p.seat as u32,
                name: p.name.clone(),
                is_human: p.is_human,
                picks_made: p.picked.len() as u32,
                last_pick_name: p
                    .last_pick
                    .as_ref()
                    .filter(|_| p.seat == seat_idx)
                    .map(|c| c.name.clone()),
                current_pack_size: p.current_pack().map(|pack| pack.len()).unwrap_or(0) as u32,
                packs_waiting: p
                    .pack_queue
                    .len()
                    .saturating_sub(usize::from(p.current_pack().is_some()))
                    as u32,
                awaiting_pick: draft.awaiting_pick_for_seat(p.seat),
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
        let picked_pile = draft_picked_cards(&session_id, draft, seat_idx);
        Self {
            session_id,
            revision: draft.revision(),
            round: draft.round(),
            total_rounds: draft.total_rounds(),
            pick_number,
            pack_size: pack.len() as u32,
            current_pack: pack,
            picked_pile,
            seat_summaries,
            is_round_over: draft.is_round_over(),
            is_complete: !draft.has_next_choice() && draft.round() >= draft.total_rounds(),
            awaiting_human: awaiting_human && draft.awaiting_pick_for_seat(seat_idx),
            human_conspiracies,
            picks_per_pass: draft.picks_per_pass(),
            picks_remaining_in_pack,
            pass_direction: match draft.current_direction() {
                forge_limited::PassDirection::Left => "left",
                forge_limited::PassDirection::Right => "right",
            }
            .to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MpDraftHumanSeatDto {
    pub seat: u32,
    pub name: String,
}
