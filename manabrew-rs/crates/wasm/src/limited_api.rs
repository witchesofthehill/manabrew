use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Arc;

use forge_foundation::sealed_product::{PaperCard, Rarity, SealedTemplate};
use forge_foundation::ColorSet;
use forge_limited::{
    BoosterDraft, CardRanker, CubeImporter, DraftPack, DraftRankCache, GauntletKind, GauntletMini,
    GauntletOutcome, IBoosterDraft, LimitedDeck, LimitedPoolType, LimitedWinLoseController,
    SealedCardPoolGenerator, SealedDeckGroup, ThemedChaosDraft, TickOutcome, WinstonDraft,
    WinstonOutcome, CONSPIRACY_HOOKS,
};
use manabrew_protocol::deck_dto::DeckCardIdentity;
use rand::rngs::StdRng;
use rand::SeedableRng;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use crate::card_loader::get_card_db;

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
}

fn paper_card_to_identity(c: &PaperCard) -> DeckCardIdentity {
    DeckCardIdentity {
        id: String::new(),
        name: c.name.clone(),
        set_code: c.set_code.clone(),
        card_number: c.collector_number.clone(),
        foil: if c.foil { Some(true) } else { None },
    }
}

fn identity_to_paper_card(c: &DeckCardIdentity) -> PaperCard {
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
    let editions = crate::limited_bootstrap::editions();
    let card_db = crate::card_loader::get_card_db();
    let rarity = editions
        .and_then(|reg| reg.get(set_code))
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
    let (colors, dual_faced) = card_db
        .and_then(|db| db.get_by_card_name(name))
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
    pub cards: Vec<DeckCardIdentity>,
    pub suggested_deck: Option<LimitedDeckDto>,
    pub ai_decks: Vec<LimitedDeckDto>,
}

impl SealedPoolDto {
    fn from_group(session_id: String, group: &SealedDeckGroup) -> Self {
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
    pub current_pack: Vec<DeckCardIdentity>,
    pub picked_pile: Vec<DeckCardIdentity>,
    pub seat_summaries: Vec<DraftSeatDto>,
    pub is_round_over: bool,
    pub is_complete: bool,
    pub awaiting_human: bool,
    pub human_conspiracies: Vec<String>,
    pub picks_per_pass: u32,
    pub picks_remaining_in_pack: u32,
}

impl DraftStateDto {
    fn from_engine(session_id: String, draft: &BoosterDraft, awaiting_human: bool) -> Self {
        Self::from_engine_for_seat(session_id, draft, 0, awaiting_human)
    }

    fn from_engine_for_seat(
        session_id: String,
        draft: &BoosterDraft,
        seat_idx: usize,
        awaiting_human: bool,
    ) -> Self {
        let viewer = draft.seat(seat_idx);
        let pack: Vec<DeckCardIdentity> = draft
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
pub struct WinstonStateDto {
    pub session_id: String,
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
    fn from_engine(session_id: String, draft: &WinstonDraft) -> Self {
        let piles: Vec<Vec<DeckCardIdentity>> = draft
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
    pub pool: Vec<DeckCardIdentity>,
    #[serde(default)]
    pub variant: Option<String>,
    #[serde(default)]
    pub seed: Option<u64>,
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
pub struct ConspiracyHookDto {
    pub card_name: String,
    pub flag_name: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GauntletOpponentDto {
    pub round: u32,
    pub deck_name: String,
    pub main_count: u32,
    pub sideboard_count: u32,
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

impl GauntletStateDto {
    fn from_engine(gauntlet_id: String, g: &GauntletMini) -> Self {
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
pub struct GauntletDeckUpdateDto {
    pub gauntlet_id: String,
    pub main: Vec<DeckCardIdentity>,
    pub sideboard: Vec<DeckCardIdentity>,
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
}

struct WasmLimitedState {
    sessions: HashMap<String, SealedDeckGroup>,
    drafts: HashMap<String, BoosterDraft>,
    winston: HashMap<String, WinstonDraft>,
    gauntlets: HashMap<String, GauntletMini>,
    rank_cache: Arc<DraftRankCache>,
    name_index: std::collections::HashSet<String>,
    next_id: u64,
}

impl WasmLimitedState {
    fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            drafts: HashMap::new(),
            winston: HashMap::new(),
            gauntlets: HashMap::new(),
            rank_cache: Arc::new(DraftRankCache::new()),
            name_index: std::collections::HashSet::new(),
            next_id: 0,
        }
    }

    fn fresh_id(&mut self, prefix: &str) -> String {
        self.next_id += 1;
        format!("{prefix}-{:x}", self.next_id)
    }

    fn card_name_known(&self, name: &str) -> bool {
        self.name_index.contains(&name.to_lowercase())
    }
}

thread_local! {
    static STATE: RefCell<WasmLimitedState> = RefCell::new(WasmLimitedState::new());
}

fn rebuild_name_index(state: &mut WasmLimitedState) {
    let Some(db) = get_card_db() else {
        return;
    };
    state.name_index.clear();
    // Walk the archive index directly — name validation doesn't require the
    // cards to be parsed, and a freshly-loaded archive-backed DB has none
    // parsed yet.
    for key in db.iter_card_keys() {
        state.name_index.insert(key);
    }
}

/// the same shape `limited_start_sealed` / `limited_start_booster_draft`
/// expect for their `setup.pool` field.
///
/// Replaces the React-side Scryfall round-trip: the archive's
#[wasm_bindgen]
pub fn limited_get_set_pool(set_code: String) -> Result<JsValue, JsError> {
    let editions = crate::limited_bootstrap::editions()
        .ok_or_else(|| JsError::new("editions registry not loaded"))?;
    let edition = editions
        .get(&set_code)
        .ok_or_else(|| JsError::new(&format!("unknown set: {set_code}")))?;

    let pool: Vec<DeckCardIdentity> = edition
        .cards
        .iter()
        .map(|entry| DeckCardIdentity {
            id: String::new(),
            name: entry.name.clone(),
            set_code: edition.code.clone(),
            card_number: entry.collector_number.clone(),
            foil: None,
        })
        .collect();

    serde_wasm_bindgen::to_value(&pool).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn limited_list_sealed_templates() -> Result<JsValue, JsError> {
    let templates = vec![
        SealedTemplateMetadataDto {
            id: "draft".into(),
            label: "Standard Draft Booster".into(),
            description: "10 commons, 3 uncommons, 1 rare/mythic, 1 land".into(),
            num_packs: 6,
        },
        SealedTemplateMetadataDto {
            id: "cube".into(),
            label: "Cube Pack".into(),
            description: "15 cards drawn at random with no rarity slots".into(),
            num_packs: 6,
        },
    ];
    serde_wasm_bindgen::to_value(&templates).map_err(|e| JsError::new(&format!("serialize: {e}")))
}

#[wasm_bindgen]
pub fn limited_list_chaos_themes() -> Result<JsValue, JsError> {
    let themes = ThemedChaosDraft::parse_all(
        "5, DEFAULT, All 15-card Boosters\n\
         10, MODERN, Modern Sets Only\n\
         11, PIONEER, Pioneer Sets Only\n\
         12, STANDARD, Standard Sets Only\n",
    );
    let out: Vec<ChaosThemeDto> = themes
        .into_iter()
        .map(|t| ChaosThemeDto {
            tag: t.tag,
            label: t.label,
            order_number: t.order_number,
        })
        .collect();
    serde_wasm_bindgen::to_value(&out).map_err(|e| JsError::new(&format!("serialize: {e}")))
}

#[wasm_bindgen]
pub fn limited_list_conspiracy_hooks() -> Result<JsValue, JsError> {
    let out: Vec<ConspiracyHookDto> = CONSPIRACY_HOOKS
        .iter()
        .map(|h| ConspiracyHookDto {
            card_name: h.card_name.into(),
            flag_name: format!("{:?}", h.flag),
            description: h.description.into(),
        })
        .collect();
    serde_wasm_bindgen::to_value(&out).map_err(|e| JsError::new(&format!("serialize: {e}")))
}

fn filter_playable(state: &mut WasmLimitedState, pool: &[DeckCardIdentity]) -> Vec<PaperCard> {
    if state.name_index.is_empty() {
        rebuild_name_index(state);
    }
    pool.iter()
        .filter(|c| state.card_name_known(&c.name))
        .map(identity_to_paper_card)
        .collect()
}

fn empty_pool_error(supplied: usize) -> String {
    format!(
        "no playable cards in pool — supplied {supplied} cards but the engine can't script any of them yet"
    )
}

#[wasm_bindgen]
pub fn limited_start_sealed(setup_json: JsValue) -> Result<JsValue, JsError> {
    let setup: SealedSetupDto =
        serde_wasm_bindgen::from_value(setup_json).map_err(|e| JsError::new(&e.to_string()))?;
    STATE.with(|cell| {
        let mut state = cell.borrow_mut();
        let card_pool = filter_playable(&mut state, &setup.pool);
        if card_pool.is_empty() {
            return Err(JsError::new(&empty_pool_error(setup.pool.len())));
        }
        let pool_type = match setup.pool_type.as_str() {
            "Full" => LimitedPoolType::Full,
            "Custom" => LimitedPoolType::Custom,
            other => return Err(JsError::new(&format!("pool type {other:?} not supported"))),
        };
        let mut rng = match setup.seed {
            Some(seed) => StdRng::seed_from_u64(seed),
            None => StdRng::from_entropy(),
        };
        let template = template_for_pool(&card_pool, setup.variant.as_deref());
        let mut gen = SealedCardPoolGenerator::new(pool_type, card_pool)
            .with_template(template, setup.num_boosters as usize);
        let ranker = Arc::new(CardRanker::new(state.rank_cache.clone()));
        let cache = state.rank_cache.clone();
        let group = gen.generate_sealed_deck(
            "Sealed Pool",
            &mut rng,
            7,
            ranker,
            cache,
            |c| c.colors,
            |c| c.rarity == Rarity::BasicLand,
        );
        let session_id = state.fresh_id("sealed");
        let dto = SealedPoolDto::from_group(session_id.clone(), &group);
        state.sessions.insert(session_id, group);
        serde_wasm_bindgen::to_value(&dto).map_err(|e| JsError::new(&e.to_string()))
    })
}

#[wasm_bindgen]
pub fn limited_get_sealed_pool(session_id: String) -> Result<JsValue, JsError> {
    STATE.with(|cell| {
        let state = cell.borrow();
        let group = state
            .sessions
            .get(&session_id)
            .ok_or_else(|| JsError::new(&format!("no sealed session for id {session_id}")))?;
        let dto = SealedPoolDto::from_group(session_id, group);
        serde_wasm_bindgen::to_value(&dto).map_err(|e| JsError::new(&e.to_string()))
    })
}

#[wasm_bindgen]
pub fn limited_get_edition_info(set_code: String) -> Result<JsValue, JsError> {
    let dto = crate::limited_bootstrap::edition_info(&set_code);
    serde_wasm_bindgen::to_value(&dto).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn limited_start_booster_draft(setup_json: JsValue) -> Result<JsValue, JsError> {
    let setup: BoosterDraftSetupDto =
        serde_wasm_bindgen::from_value(setup_json).map_err(|e| JsError::new(&e.to_string()))?;
    STATE.with(|cell| {
        let mut state = cell.borrow_mut();
        let card_pool = filter_playable(&mut state, &setup.pool);
        if card_pool.is_empty() {
            return Err(JsError::new(&empty_pool_error(setup.pool.len())));
        }
        let pod_size = setup.pod_size.clamp(2, 8) as usize;
        let rounds = setup.rounds.clamp(1, 6);
        let ranker = Arc::new(CardRanker::new(state.rank_cache.clone()));
        let color_of: Arc<dyn Fn(&PaperCard) -> ColorSet + Send + Sync> =
            Arc::new(|c: &PaperCard| c.colors);
        let template = template_for_pool(&card_pool, setup.variant.as_deref());
        let mut draft = BoosterDraft::new(pod_size, rounds, template, card_pool, ranker, color_of);
        if let Some(n) = setup.picks_per_pass {
            draft.set_picks_per_pass(n);
        }
        draft.start_round();
        let outcome = draft.tick();
        let awaiting = matches!(outcome, TickOutcome::AwaitingHuman);
        let session_id = state.fresh_id("draft");
        let dto = DraftStateDto::from_engine(session_id.clone(), &draft, awaiting);
        state.drafts.insert(session_id, draft);
        serde_wasm_bindgen::to_value(&dto).map_err(|e| JsError::new(&e.to_string()))
    })
}

#[wasm_bindgen]
pub fn limited_pick_card(session_id: String, card_name: String) -> Result<JsValue, JsError> {
    STATE.with(|cell| {
        let mut state = cell.borrow_mut();
        let draft = state
            .drafts
            .get_mut(&session_id)
            .ok_or_else(|| JsError::new(&format!("no draft session for id {session_id}")))?;
        let pack_card = draft
            .current_pack_for_human()
            .and_then(|p: &DraftPack| p.cards().iter().find(|c| c.name == card_name).cloned())
            .ok_or_else(|| JsError::new(&format!("card {card_name:?} not in current pack")))?;
        draft
            .submit_human_pick(pack_card)
            .map_err(|e| JsError::new(&e))?;
        loop {
            match draft.tick() {
                TickOutcome::Progress => continue,
                TickOutcome::AwaitingHuman => break,
                TickOutcome::RoundOver => {
                    if !draft.start_round() {
                        break;
                    }
                }
                TickOutcome::Complete => break,
            }
        }
        let awaiting = !draft.is_round_over() && draft.has_next_choice();
        let dto = DraftStateDto::from_engine(session_id, draft, awaiting);
        serde_wasm_bindgen::to_value(&dto).map_err(|e| JsError::new(&e.to_string()))
    })
}

#[wasm_bindgen]
pub fn limited_get_draft_state(session_id: String) -> Result<JsValue, JsError> {
    STATE.with(|cell| {
        let state = cell.borrow();
        let draft = state
            .drafts
            .get(&session_id)
            .ok_or_else(|| JsError::new(&format!("no draft session for id {session_id}")))?;
        let awaiting = !draft.is_round_over() && draft.has_next_choice();
        let dto = DraftStateDto::from_engine(session_id, draft, awaiting);
        serde_wasm_bindgen::to_value(&dto).map_err(|e| JsError::new(&e.to_string()))
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MpDraftHumanSeatDto {
    pub seat: u32,
    pub name: String,
}

#[wasm_bindgen]
pub fn limited_start_multiplayer_draft(
    setup_json: JsValue,
    humans_json: JsValue,
) -> Result<JsValue, JsError> {
    let setup: BoosterDraftSetupDto =
        serde_wasm_bindgen::from_value(setup_json).map_err(|e| JsError::new(&e.to_string()))?;
    let humans: Vec<MpDraftHumanSeatDto> =
        serde_wasm_bindgen::from_value(humans_json).map_err(|e| JsError::new(&e.to_string()))?;
    STATE.with(|cell| {
        let mut state = cell.borrow_mut();
        let card_pool = filter_playable(&mut state, &setup.pool);
        if card_pool.is_empty() {
            return Err(JsError::new(&empty_pool_error(setup.pool.len())));
        }
        let pod_size = setup.pod_size.clamp(2, 8) as usize;
        let rounds = setup.rounds.clamp(1, 6);
        if humans.is_empty() || humans.len() > pod_size {
            return Err(JsError::new(&format!(
                "multiplayer draft needs 1..={pod_size} humans, got {}",
                humans.len()
            )));
        }
        let humans: Vec<(usize, String)> = humans
            .into_iter()
            .map(|h| (h.seat as usize, h.name))
            .collect();
        let ranker = Arc::new(CardRanker::new(state.rank_cache.clone()));
        let color_of: Arc<dyn Fn(&PaperCard) -> ColorSet + Send + Sync> =
            Arc::new(|c: &PaperCard| c.colors);
        let template = template_for_pool(&card_pool, setup.variant.as_deref());
        let mut draft = BoosterDraft::with_human_seats(
            pod_size, rounds, template, card_pool, ranker, color_of, &humans,
        );
        if let Some(n) = setup.picks_per_pass {
            draft.set_picks_per_pass(n);
        }
        draft.start_round();
        let outcome = draft.tick();
        let awaiting = matches!(outcome, TickOutcome::AwaitingHuman);
        let session_id = state.fresh_id("draft");
        let dto = DraftStateDto::from_engine_for_seat(session_id.clone(), &draft, 0, awaiting);
        state.drafts.insert(session_id, draft);
        serde_wasm_bindgen::to_value(&dto).map_err(|e| JsError::new(&e.to_string()))
    })
}

#[wasm_bindgen]
pub fn limited_submit_pick(
    session_id: String,
    seat_idx: u32,
    card_name: String,
) -> Result<JsValue, JsError> {
    STATE.with(|cell| {
        let mut state = cell.borrow_mut();
        let draft = state
            .drafts
            .get_mut(&session_id)
            .ok_or_else(|| JsError::new(&format!("no draft session for id {session_id}")))?;
        let seat = seat_idx as usize;
        if seat >= draft.pod_size() {
            return Err(JsError::new(&format!(
                "seat {seat} out of bounds (pod size {})",
                draft.pod_size()
            )));
        }
        let pack_card = draft
            .current_pack_for_seat(seat)
            .and_then(|p: &DraftPack| p.cards().iter().find(|c| c.name == card_name).cloned())
            .ok_or_else(|| {
                JsError::new(&format!("card {card_name:?} not in seat {seat}'s pack"))
            })?;
        draft
            .submit_human_pick_for(seat, pack_card)
            .map_err(|e| JsError::new(&e))?;
        loop {
            match draft.tick() {
                TickOutcome::Progress => continue,
                TickOutcome::AwaitingHuman => break,
                TickOutcome::RoundOver => {
                    if !draft.start_round() {
                        break;
                    }
                }
                TickOutcome::Complete => break,
            }
        }
        let awaiting = !draft.is_round_over() && draft.has_next_choice();
        let dto = DraftStateDto::from_engine_for_seat(session_id, draft, seat, awaiting);
        serde_wasm_bindgen::to_value(&dto).map_err(|e| JsError::new(&e.to_string()))
    })
}

#[wasm_bindgen]
pub fn limited_get_seat_state(session_id: String, seat_idx: u32) -> Result<JsValue, JsError> {
    STATE.with(|cell| {
        let state = cell.borrow();
        let draft = state
            .drafts
            .get(&session_id)
            .ok_or_else(|| JsError::new(&format!("no draft session for id {session_id}")))?;
        let seat = seat_idx as usize;
        if seat >= draft.pod_size() {
            return Err(JsError::new(&format!(
                "seat {seat} out of bounds (pod size {})",
                draft.pod_size()
            )));
        }
        let awaiting = !draft.is_round_over() && draft.has_next_choice();
        let dto = DraftStateDto::from_engine_for_seat(session_id, draft, seat, awaiting);
        serde_wasm_bindgen::to_value(&dto).map_err(|e| JsError::new(&e.to_string()))
    })
}

#[wasm_bindgen]
pub fn limited_undo_pick(session_id: String) -> Result<JsValue, JsError> {
    STATE.with(|cell| {
        let mut state = cell.borrow_mut();
        let draft = state
            .drafts
            .get_mut(&session_id)
            .ok_or_else(|| JsError::new(&format!("no draft session for id {session_id}")))?;
        draft.undo_last_human_pick().map_err(|e| JsError::new(&e))?;
        let awaiting = !draft.is_round_over() && draft.has_next_choice();
        let dto = DraftStateDto::from_engine(session_id, draft, awaiting);
        serde_wasm_bindgen::to_value(&dto).map_err(|e| JsError::new(&e.to_string()))
    })
}

#[wasm_bindgen]
pub fn limited_start_winston(setup_json: JsValue) -> Result<JsValue, JsError> {
    let setup: WinstonSetupDto =
        serde_wasm_bindgen::from_value(setup_json).map_err(|e| JsError::new(&e.to_string()))?;
    STATE.with(|cell| {
        let mut state = cell.borrow_mut();
        let card_pool = filter_playable(&mut state, &setup.pool);
        if card_pool.is_empty() {
            return Err(JsError::new(&empty_pool_error(setup.pool.len())));
        }
        let pool_packs = setup.pool_packs.clamp(2, 12) as usize;
        let template = template_for_pool(&card_pool, setup.variant.as_deref());
        let draft = WinstonDraft::new(template, card_pool, pool_packs);
        let session_id = state.fresh_id("winston");
        let dto = WinstonStateDto::from_engine(session_id.clone(), &draft);
        state.winston.insert(session_id, draft);
        serde_wasm_bindgen::to_value(&dto).map_err(|e| JsError::new(&e.to_string()))
    })
}

fn template_for_pool(pool: &[PaperCard], variant: Option<&str>) -> SealedTemplate {
    if let Some(editions) = crate::limited_bootstrap::editions() {
        let dominant = crate::limited_bootstrap::dominant_set_code(pool);
        if let Some(code) = dominant.as_deref() {
            if let Some(edition) = editions.get(code) {
                let v = variant.filter(|s| !s.is_empty());
                if let Some(tpl) = edition.to_sealed_template_named(v) {
                    return tpl;
                }
            }
        }
    }
    SealedTemplate::generic_draft_booster()
}

fn drain_winston_ai(draft: &mut WinstonDraft) {
    loop {
        match draft.tick() {
            WinstonOutcome::Picked { .. } => continue,
            WinstonOutcome::AwaitingHuman | WinstonOutcome::Complete => break,
        }
    }
}

#[wasm_bindgen]
pub fn limited_winston_take(session_id: String) -> Result<JsValue, JsError> {
    STATE.with(|cell| {
        let mut state = cell.borrow_mut();
        let draft = state
            .winston
            .get_mut(&session_id)
            .ok_or_else(|| JsError::new(&format!("no winston session for id {session_id}")))?;
        draft.human_take_pile().map_err(|e| JsError::new(&e))?;
        drain_winston_ai(draft);
        let dto = WinstonStateDto::from_engine(session_id, draft);
        serde_wasm_bindgen::to_value(&dto).map_err(|e| JsError::new(&e.to_string()))
    })
}

#[wasm_bindgen]
pub fn limited_winston_pass(session_id: String) -> Result<JsValue, JsError> {
    STATE.with(|cell| {
        let mut state = cell.borrow_mut();
        let draft = state
            .winston
            .get_mut(&session_id)
            .ok_or_else(|| JsError::new(&format!("no winston session for id {session_id}")))?;
        draft.human_pass_pile().map_err(|e| JsError::new(&e))?;
        drain_winston_ai(draft);
        let dto = WinstonStateDto::from_engine(session_id, draft);
        serde_wasm_bindgen::to_value(&dto).map_err(|e| JsError::new(&e.to_string()))
    })
}

#[wasm_bindgen]
pub fn limited_get_winston_state(session_id: String) -> Result<JsValue, JsError> {
    STATE.with(|cell| {
        let state = cell.borrow();
        let draft = state
            .winston
            .get(&session_id)
            .ok_or_else(|| JsError::new(&format!("no winston session for id {session_id}")))?;
        let dto = WinstonStateDto::from_engine(session_id, draft);
        serde_wasm_bindgen::to_value(&dto).map_err(|e| JsError::new(&e.to_string()))
    })
}

#[wasm_bindgen]
pub fn limited_start_gauntlet_from_sealed(
    session_id: String,
    rounds: u32,
) -> Result<JsValue, JsError> {
    STATE.with(|cell| {
        let mut state = cell.borrow_mut();
        let group = state
            .sessions
            .get(&session_id)
            .ok_or_else(|| JsError::new(&format!("no sealed session for id {session_id}")))?;
        let human_deck = group.suggested_human_deck.clone().ok_or_else(|| {
            JsError::new("sealed pool has no suggested human deck — open more packs")
        })?;
        let ai_decks: Vec<LimitedDeck> = group.ai_decks.clone();
        let gauntlet = GauntletMini::new(GauntletKind::Sealed, rounds, human_deck, ai_decks)
            .map_err(|e| JsError::new(&e))?;
        let gauntlet_id = state.fresh_id("gauntlet");
        let dto = GauntletStateDto::from_engine(gauntlet_id.clone(), &gauntlet);
        state.gauntlets.insert(gauntlet_id, gauntlet);
        serde_wasm_bindgen::to_value(&dto).map_err(|e| JsError::new(&e.to_string()))
    })
}

#[wasm_bindgen]
pub fn limited_record_gauntlet_outcome(
    gauntlet_id: String,
    won_game: bool,
    match_over: bool,
    match_won: bool,
) -> Result<JsValue, JsError> {
    STATE.with(|cell| {
        let mut state = cell.borrow_mut();
        let gauntlet = state
            .gauntlets
            .get_mut(&gauntlet_id)
            .ok_or_else(|| JsError::new(&format!("no gauntlet for id {gauntlet_id}")))?;
        let outcome =
            LimitedWinLoseController::record_outcome(gauntlet, won_game, match_over, match_won);
        let (label, next_round_index) = match outcome {
            GauntletOutcome::MatchInProgress => ("matchInProgress", None),
            GauntletOutcome::AdvanceToNextRound { next_round_index } => {
                ("advanceNextRound", Some(next_round_index))
            }
            GauntletOutcome::WonTournament => ("wonTournament", None),
            GauntletOutcome::LostRound => ("lostRound", None),
        };
        let dto = GauntletOutcomeDto {
            state: GauntletStateDto::from_engine(gauntlet_id, gauntlet),
            outcome: label.to_string(),
            next_round_index,
        };
        serde_wasm_bindgen::to_value(&dto).map_err(|e| JsError::new(&e.to_string()))
    })
}

#[wasm_bindgen]
pub fn limited_advance_gauntlet_round(gauntlet_id: String) -> Result<JsValue, JsError> {
    STATE.with(|cell| {
        let mut state = cell.borrow_mut();
        let gauntlet = state
            .gauntlets
            .get_mut(&gauntlet_id)
            .ok_or_else(|| JsError::new(&format!("no gauntlet for id {gauntlet_id}")))?;
        gauntlet.next_round();
        let dto = GauntletStateDto::from_engine(gauntlet_id, gauntlet);
        serde_wasm_bindgen::to_value(&dto).map_err(|e| JsError::new(&e.to_string()))
    })
}

#[wasm_bindgen]
pub fn limited_get_gauntlet_state(gauntlet_id: String) -> Result<JsValue, JsError> {
    STATE.with(|cell| {
        let state = cell.borrow();
        let gauntlet = state
            .gauntlets
            .get(&gauntlet_id)
            .ok_or_else(|| JsError::new(&format!("no gauntlet for id {gauntlet_id}")))?;
        let dto = GauntletStateDto::from_engine(gauntlet_id, gauntlet);
        serde_wasm_bindgen::to_value(&dto).map_err(|e| JsError::new(&e.to_string()))
    })
}

#[wasm_bindgen]
pub fn limited_get_gauntlet_match_decks(gauntlet_id: String) -> Result<JsValue, JsError> {
    STATE.with(|cell| {
        let state = cell.borrow();
        let g = state
            .gauntlets
            .get(&gauntlet_id)
            .ok_or_else(|| JsError::new(&format!("no gauntlet for id {gauntlet_id}")))?;
        let opponent = g
            .current_opponent()
            .ok_or_else(|| JsError::new("gauntlet has no current opponent"))?;
        let dto = GauntletMatchDecksDto {
            human_deck_name: g.human_deck.name.clone(),
            human_main: g
                .human_deck
                .main
                .iter()
                .map(paper_card_to_identity)
                .collect(),
            human_sideboard: g
                .human_deck
                .sideboard
                .iter()
                .map(paper_card_to_identity)
                .collect(),
            opponent_name: opponent.name.clone(),
            opponent_main: opponent.main.iter().map(paper_card_to_identity).collect(),
            opponent_sideboard: opponent
                .sideboard
                .iter()
                .map(paper_card_to_identity)
                .collect(),
        };
        serde_wasm_bindgen::to_value(&dto).map_err(|e| JsError::new(&e.to_string()))
    })
}

#[wasm_bindgen]
pub fn limited_update_gauntlet_human_deck(update_json: JsValue) -> Result<JsValue, JsError> {
    let update: GauntletDeckUpdateDto =
        serde_wasm_bindgen::from_value(update_json).map_err(|e| JsError::new(&e.to_string()))?;
    STATE.with(|cell| {
        let mut state = cell.borrow_mut();
        let g = state
            .gauntlets
            .get_mut(&update.gauntlet_id)
            .ok_or_else(|| JsError::new(&format!("no gauntlet for id {}", update.gauntlet_id)))?;
        g.human_deck.main = update.main.iter().map(identity_to_paper_card).collect();
        g.human_deck.sideboard = update
            .sideboard
            .iter()
            .map(identity_to_paper_card)
            .collect();
        let dto = GauntletStateDto::from_engine(update.gauntlet_id, g);
        serde_wasm_bindgen::to_value(&dto).map_err(|e| JsError::new(&e.to_string()))
    })
}

#[wasm_bindgen]
pub fn limited_drop_session(kind: String, session_id: String) -> Result<bool, JsError> {
    STATE.with(|cell| {
        let mut state = cell.borrow_mut();
        Ok(match kind.as_str() {
            "sealed" => state.sessions.remove(&session_id).is_some(),
            "draft" => state.drafts.remove(&session_id).is_some(),
            "winston" => state.winston.remove(&session_id).is_some(),
            "gauntlet" => state.gauntlets.remove(&session_id).is_some(),
            other => return Err(JsError::new(&format!("unknown session kind {other:?}"))),
        })
    })
}

#[wasm_bindgen]
pub fn limited_cubecobra_url(cube_id_or_url: String) -> Result<String, JsError> {
    let imp = CubeImporter::new(&cube_id_or_url).map_err(|e| JsError::new(&e))?;
    imp.cubecobra_download_url().map_err(|e| JsError::new(&e))
}

#[wasm_bindgen]
pub fn limited_import_cube(request_json: JsValue, body: String) -> Result<JsValue, JsError> {
    let request: CubeImportRequestDto =
        serde_wasm_bindgen::from_value(request_json).map_err(|e| JsError::new(&e.to_string()))?;
    let imp = CubeImporter::new(&request.cube_id_or_url).map_err(|e| JsError::new(&e))?;
    let cube = imp.parse(&body).map_err(|e| JsError::new(&e))?;
    let card_count: u32 = cube.cards.iter().map(|c| c.count).sum();
    let mut pool: Vec<DeckCardIdentity> = Vec::with_capacity(card_count as usize);
    for entry in &cube.cards {
        for copy in 0..entry.count {
            pool.push(DeckCardIdentity {
                id: String::new(),
                name: entry.name.clone(),
                set_code: entry.set_code.clone().unwrap_or_default(),
                card_number: format!("cube-{copy}"),
                foil: None,
            });
        }
    }
    let dto = CubeImportResultDto {
        cube_id: imp.cube_id,
        name: cube.name,
        card_count,
        num_packs: cube.num_packs,
        singleton: cube.singleton,
        pool,
    };
    serde_wasm_bindgen::to_value(&dto).map_err(|e| JsError::new(&e.to_string()))
}
