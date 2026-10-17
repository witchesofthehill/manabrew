use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use forge_foundation::sealed_product::{PaperCard, Rarity, SealedTemplate};
use forge_foundation::ColorSet;
use forge_limited::{
    BoosterDraft, CardRanker, DraftRankCache, GauntletKind, GauntletMini, GauntletOutcome,
    IBoosterDraft, LimitedDeck, LimitedPoolType, LimitedWinLoseController, SealedCardPoolGenerator,
    SealedDeckGroup, TickOutcome, WinstonDraft,
};
use rand::rngs::StdRng;
use rand::SeedableRng;

use crate::limited_dto::{
    identity_to_paper_card, BoosterDraftSetupDto, DraftStateDto, GauntletOutcomeDto,
    GauntletStateDto, LimitedDeckDto, SealedPoolDto, SealedSetupDto, WinstonStateDto,
};
use manabrew_protocol::deck_dto::DeckCardIdentity;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LimitedEngineCheckpointRef<'a, T> {
    schema_version: u32,
    kind: &'a str,
    session_id: &'a str,
    state: T,
}

#[derive(serde::Serialize)]
struct GauntletCheckpointRef<'a> {
    engine: &'a GauntletMini,
    decks: &'a [LimitedDeckDto],
}

pub struct LimitedManager {
    sessions: Mutex<HashMap<String, SealedDeckGroup>>,
    drafts: Mutex<HashMap<String, BoosterDraft>>,
    winston: Mutex<HashMap<String, WinstonDraft>>,
    gauntlets: Mutex<HashMap<String, GauntletMini>>,
    gauntlet_decks: Mutex<HashMap<String, Vec<LimitedDeckDto>>>,
    rank_cache: Arc<DraftRankCache>,
}

impl Default for LimitedManager {
    fn default() -> Self {
        Self::new()
    }
}

impl LimitedManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            drafts: Mutex::new(HashMap::new()),
            winston: Mutex::new(HashMap::new()),
            gauntlets: Mutex::new(HashMap::new()),
            gauntlet_decks: Mutex::new(HashMap::new()),
            rank_cache: Arc::new(DraftRankCache::new()),
        }
    }

    pub fn export_session(&self, kind: &str, session_id: &str) -> Result<String, String> {
        match kind {
            "draft" => {
                let drafts = lock_recover(&self.drafts);
                let draft = drafts
                    .get(session_id)
                    .ok_or_else(|| format!("no draft session for id {session_id}"))?;
                serialize_checkpoint(kind, session_id, draft.export_checkpoint())
            }
            "winston" => {
                let drafts = lock_recover(&self.winston);
                let draft = drafts
                    .get(session_id)
                    .ok_or_else(|| format!("no Winston session for id {session_id}"))?;
                serialize_checkpoint(kind, session_id, draft)
            }
            "sealed" => {
                let sessions = lock_recover(&self.sessions);
                let group = sessions
                    .get(session_id)
                    .ok_or_else(|| format!("no sealed session for id {session_id}"))?;
                serialize_checkpoint(kind, session_id, group)
            }
            "gauntlet" => {
                let gauntlets = lock_recover(&self.gauntlets);
                let engine = gauntlets
                    .get(session_id)
                    .ok_or_else(|| format!("no gauntlet session for id {session_id}"))?;
                let decks = lock_recover(&self.gauntlet_decks);
                let decks = decks
                    .get(session_id)
                    .ok_or_else(|| "gauntlet deck identities are missing".to_string())?;
                serialize_checkpoint(kind, session_id, GauntletCheckpointRef { engine, decks })
            }
            _ => Err(format!("unknown Limited session kind: {kind}")),
        }
    }

    pub fn import_session(
        &self,
        checkpoint: crate::limited_dto::LimitedEngineCheckpointDto,
    ) -> Result<crate::limited_dto::LimitedSessionImportDto, String> {
        checkpoint.validate()?;
        let session_id = checkpoint.session_id;
        let state = match checkpoint.kind.as_str() {
            "draft" => {
                let saved = serde_json::from_value(checkpoint.state)
                    .map_err(|error| format!("invalid draft checkpoint: {error}"))?;
                let draft = BoosterDraft::import_checkpoint(saved)?;
                let awaiting = !draft.is_round_over() && draft.has_next_choice();
                let state = serde_json::to_value(DraftStateDto::from_engine(
                    session_id.clone(),
                    &draft,
                    awaiting,
                ))
                .map_err(|error| error.to_string())?;
                lock_recover(&self.drafts).insert(session_id.clone(), draft);
                state
            }
            "winston" => {
                let draft: WinstonDraft = serde_json::from_value(checkpoint.state)
                    .map_err(|error| format!("invalid Winston checkpoint: {error}"))?;
                draft.validate_checkpoint()?;
                let state =
                    serde_json::to_value(WinstonStateDto::from_engine(session_id.clone(), &draft))
                        .map_err(|error| error.to_string())?;
                lock_recover(&self.winston).insert(session_id.clone(), draft);
                state
            }
            "sealed" => {
                let group: SealedDeckGroup = serde_json::from_value(checkpoint.state)
                    .map_err(|error| format!("invalid sealed checkpoint: {error}"))?;
                let state =
                    serde_json::to_value(SealedPoolDto::from_group(session_id.clone(), &group))
                        .map_err(|error| error.to_string())?;
                lock_recover(&self.sessions).insert(session_id.clone(), group);
                state
            }
            "gauntlet" => {
                let saved: crate::limited_dto::GauntletCheckpointDto =
                    serde_json::from_value(checkpoint.state)
                        .map_err(|error| format!("invalid gauntlet checkpoint: {error}"))?;
                if saved.engine.rounds == 0
                    || saved.engine.current_round == 0
                    || saved.engine.current_round > saved.engine.rounds
                    || saved.engine.rounds as usize > saved.engine.ai_decks.len()
                    || saved.decks.len() != saved.engine.ai_decks.len() + 1
                {
                    return Err("incompatible gauntlet checkpoint state".into());
                }
                let state = serde_json::to_value(GauntletStateDto::from_engine(
                    session_id.clone(),
                    &saved.engine,
                ))
                .map_err(|error| error.to_string())?;
                let mut gauntlets = lock_recover(&self.gauntlets);
                let mut decks = lock_recover(&self.gauntlet_decks);
                gauntlets.insert(session_id.clone(), saved.engine);
                decks.insert(session_id.clone(), saved.decks);
                state
            }
            kind => return Err(format!("unknown Limited session kind: {kind}")),
        };
        Ok(crate::limited_dto::LimitedSessionImportDto {
            kind: checkpoint.kind,
            session_id,
            state,
        })
    }

    pub fn get_draft_review(
        &self,
        kind: &str,
        session_id: &str,
        seat: usize,
    ) -> Result<Vec<crate::limited_dto::LimitedDraftDecisionDto>, String> {
        let decisions = match kind {
            "draft" => lock_recover(&self.drafts)
                .get(session_id)
                .ok_or_else(|| format!("no draft session for id {session_id}"))?
                .decisions_for_seat(seat)?,
            "winston" => lock_recover(&self.winston)
                .get(session_id)
                .ok_or_else(|| format!("no Winston session for id {session_id}"))?
                .decisions_for_seat(seat)?,
            _ => return Err("draft review requires draft or Winston kind".into()),
        };
        Ok(decisions
            .into_iter()
            .map(|decision| {
                crate::limited_dto::LimitedDraftDecisionDto::from_engine(session_id, kind, decision)
            })
            .collect())
    }

    pub fn auto_pick(
        &self,
        session_id: &str,
        seat: usize,
        card_id: Option<&str>,
    ) -> Result<DraftStateDto, String> {
        let mut drafts = lock_recover(&self.drafts);
        let draft = drafts
            .get_mut(session_id)
            .ok_or_else(|| format!("no draft session for id {session_id}"))?;
        let nominated =
            card_id.and_then(|id| crate::limited_dto::parse_occurrence_id(session_id, id).ok());
        draft.submit_auto_pick_for(seat, nominated)?;
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
        Ok(DraftStateDto::from_engine_for_seat(
            session_id.to_string(),
            draft,
            seat,
            awaiting,
        ))
    }

    fn template_for_pool(&self, pool: &[PaperCard], variant: Option<&str>) -> SealedTemplate {
        let editions = crate::limited_bootstrap::editions();
        let dominant = crate::limited_bootstrap::dominant_set_code(pool);
        if let Some(code) = dominant.as_deref() {
            if let Some(edition) = editions.get(code) {
                let v = variant.filter(|s| !s.is_empty());
                if let Some(tpl) = edition.to_sealed_template_named(v) {
                    return tpl;
                }
            }
        }
        SealedTemplate::generic_draft_booster()
    }

    pub fn start_sealed(
        &self,
        setup: &SealedSetupDto,
        card_pool: Vec<PaperCard>,
    ) -> Result<SealedPoolDto, String> {
        let pool_type = match setup.pool_type.as_str() {
            "Full" => LimitedPoolType::Full,
            "Custom" => LimitedPoolType::Custom,
            other => {
                return Err(format!(
                    "pool type {other:?} not supported in Phase 1 — Full and Custom only"
                ));
            }
        };

        let mut rng = match setup.seed {
            Some(seed) => StdRng::seed_from_u64(seed),
            None => StdRng::from_entropy(),
        };
        let template = if pool_type == LimitedPoolType::Custom {
            SealedTemplate::generic_no_slot_booster()
        } else {
            self.template_for_pool(&card_pool, setup.variant.as_deref())
        };
        let required_cards =
            template.number_of_cards_expected() as usize * setup.num_boosters as usize;
        if setup.singleton && card_pool.len() < required_cards {
            return Err(format!(
                "singleton pool has {} playable cards but {required_cards} are required",
                card_pool.len()
            ));
        }
        let mut gen = SealedCardPoolGenerator::new(pool_type, card_pool)
            .with_template_and_pool_limit(template, setup.num_boosters as usize, setup.singleton);

        let ranker = Arc::new(CardRanker::new(self.rank_cache.clone()));

        let group = gen.generate_sealed_deck(
            "Sealed Pool",
            &mut rng,
            7,
            ranker,
            self.rank_cache.clone(),
            |c| c.colors,
            |c| c.rarity == Rarity::BasicLand,
        );

        let session_id = format!("sealed-{}", uuid_like());
        let dto = SealedPoolDto::from_group(session_id.clone(), &group);

        lock_recover(&self.sessions).insert(session_id, group);

        Ok(dto)
    }

    pub fn get_sealed_pool(&self, session_id: &str) -> Option<SealedPoolDto> {
        let sessions = lock_recover(&self.sessions);
        sessions
            .get(session_id)
            .map(|g| SealedPoolDto::from_group(session_id.to_string(), g))
    }

    pub fn start_booster_draft(
        &self,
        setup: &BoosterDraftSetupDto,
        card_pool: Vec<PaperCard>,
    ) -> Result<DraftStateDto, String> {
        let pod_size = setup.pod_size.clamp(2, 8) as usize;
        let rounds = setup.rounds.clamp(1, 6);

        let ranker = Arc::new(CardRanker::new(self.rank_cache.clone()));
        let color_of: Arc<dyn Fn(&PaperCard) -> ColorSet + Send + Sync> =
            Arc::new(|c: &PaperCard| c.colors);

        let required_cards = pod_size * rounds as usize * 15;
        if setup.custom_pool && card_pool.len() < required_cards {
            return Err(format!("cube has {} cards but {required_cards} are required for {pod_size} players and {rounds} rounds", card_pool.len()));
        }
        let template = if setup.custom_pool {
            SealedTemplate::generic_no_slot_booster()
        } else {
            self.template_for_pool(&card_pool, setup.variant.as_deref())
        };
        let mut draft = BoosterDraft::new(pod_size, rounds, template, card_pool, ranker, color_of);
        draft.set_limited_pool(setup.custom_pool);
        if let Some(seed) = setup.seed {
            draft.set_seed(seed);
        }
        if let Some(picks) = setup.picks_per_pass {
            draft.set_picks_per_pass(picks);
        }
        draft.start_round();
        let outcome = draft.tick();
        let awaiting = matches!(outcome, TickOutcome::AwaitingHuman);

        let session_id = format!("draft-{}", uuid_like());
        let dto = DraftStateDto::from_engine(session_id.clone(), &draft, awaiting);
        lock_recover(&self.drafts).insert(session_id, draft);
        Ok(dto)
    }

    pub fn submit_human_pick(
        &self,
        session_id: &str,
        card_id: &str,
    ) -> Result<DraftStateDto, String> {
        let mut drafts = lock_recover(&self.drafts);
        let draft = drafts
            .get_mut(session_id)
            .ok_or_else(|| format!("no draft session for id {session_id}"))?;
        crate::limited_dto::submit_occurrence_pick(draft, session_id, 0, card_id)?;
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
        Ok(DraftStateDto::from_engine(
            session_id.to_string(),
            draft,
            awaiting,
        ))
    }

    pub fn undo_pick(&self, session_id: &str) -> Result<DraftStateDto, String> {
        let mut drafts = lock_recover(&self.drafts);
        let draft = drafts
            .get_mut(session_id)
            .ok_or_else(|| format!("no draft session for id {session_id}"))?;
        draft.undo_last_human_pick()?;
        let awaiting = !draft.is_round_over() && draft.has_next_choice();
        Ok(DraftStateDto::from_engine(
            session_id.to_string(),
            draft,
            awaiting,
        ))
    }

    pub fn get_draft_state(&self, session_id: &str) -> Option<DraftStateDto> {
        let drafts = lock_recover(&self.drafts);
        drafts.get(session_id).map(|d| {
            let awaiting = !d.is_round_over() && d.has_next_choice();
            DraftStateDto::from_engine(session_id.to_string(), d, awaiting)
        })
    }

    pub fn start_multiplayer_draft(
        &self,
        setup: &BoosterDraftSetupDto,
        card_pool: Vec<PaperCard>,
        humans: Vec<(usize, String)>,
    ) -> Result<DraftStateDto, String> {
        let pod_size = setup.pod_size.clamp(2, 8) as usize;
        let rounds = setup.rounds.clamp(1, 6);
        if humans.is_empty() || humans.len() > pod_size {
            return Err(format!(
                "multiplayer draft needs 1..={pod_size} humans, got {}",
                humans.len()
            ));
        }
        let ranker = Arc::new(CardRanker::new(self.rank_cache.clone()));
        let color_of: Arc<dyn Fn(&PaperCard) -> ColorSet + Send + Sync> =
            Arc::new(|c: &PaperCard| c.colors);
        let required_cards = pod_size * rounds as usize * 15;
        if setup.custom_pool && card_pool.len() < required_cards {
            return Err(format!("cube has {} cards but {required_cards} are required for {pod_size} players and {rounds} rounds", card_pool.len()));
        }
        let template = if setup.custom_pool {
            SealedTemplate::generic_no_slot_booster()
        } else {
            self.template_for_pool(&card_pool, setup.variant.as_deref())
        };
        let mut draft = BoosterDraft::with_human_seats(
            pod_size, rounds, template, card_pool, ranker, color_of, &humans,
        );
        draft.set_limited_pool(setup.custom_pool);
        if let Some(seed) = setup.seed {
            draft.set_seed(seed);
        }
        if let Some(picks) = setup.picks_per_pass {
            draft.set_picks_per_pass(picks);
        }
        draft.start_round();
        let outcome = draft.tick();
        let awaiting = matches!(outcome, TickOutcome::AwaitingHuman);
        let session_id = format!("draft-{}", uuid_like());
        let dto = DraftStateDto::from_engine_for_seat(session_id.clone(), &draft, 0, awaiting);
        lock_recover(&self.drafts).insert(session_id, draft);
        Ok(dto)
    }

    pub fn submit_pick_for_seat(
        &self,
        session_id: &str,
        seat_idx: usize,
        card_id: &str,
    ) -> Result<DraftStateDto, String> {
        let mut drafts = lock_recover(&self.drafts);
        let draft = drafts
            .get_mut(session_id)
            .ok_or_else(|| format!("no draft session for id {session_id}"))?;
        crate::limited_dto::submit_occurrence_pick(draft, session_id, seat_idx, card_id)?;
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
        Ok(DraftStateDto::from_engine_for_seat(
            session_id.to_string(),
            draft,
            seat_idx,
            awaiting,
        ))
    }

    pub fn get_seat_state(&self, session_id: &str, seat_idx: usize) -> Option<DraftStateDto> {
        let drafts = lock_recover(&self.drafts);
        drafts.get(session_id).map(|d| {
            let awaiting = !d.is_round_over() && d.has_next_choice();
            DraftStateDto::from_engine_for_seat(session_id.to_string(), d, seat_idx, awaiting)
        })
    }

    pub fn start_winston(
        &self,
        setup: &crate::limited_dto::WinstonSetupDto,
        card_pool: Vec<PaperCard>,
    ) -> Result<WinstonStateDto, String> {
        let pool_packs = setup.pool_packs.clamp(2, 12) as usize;
        let required_cards = pool_packs * 2 * 15;
        if setup.custom_pool && card_pool.len() < required_cards {
            return Err(format!("cube has {} cards but {required_cards} are required for {pool_packs} packs per player", card_pool.len()));
        }
        let template = if setup.custom_pool {
            SealedTemplate::generic_no_slot_booster()
        } else {
            self.template_for_pool(&card_pool, setup.variant.as_deref())
        };
        let draft = WinstonDraft::new_with_seed(
            template,
            card_pool,
            pool_packs,
            setup.custom_pool,
            setup.seed,
        );
        let session_id = format!("winston-{}", uuid_like());
        let dto = WinstonStateDto::from_engine(session_id.clone(), &draft);
        lock_recover(&self.winston).insert(session_id, draft);
        Ok(dto)
    }

    pub fn winston_take(&self, session_id: &str) -> Result<WinstonStateDto, String> {
        let mut winston = lock_recover(&self.winston);
        let draft = winston
            .get_mut(session_id)
            .ok_or_else(|| format!("no winston session for id {session_id}"))?;
        draft.human_take_pile()?;
        Self::drain_winston_ai(draft);
        Ok(WinstonStateDto::from_engine(session_id.to_string(), draft))
    }

    pub fn winston_pass(&self, session_id: &str) -> Result<WinstonStateDto, String> {
        let mut winston = lock_recover(&self.winston);
        let draft = winston
            .get_mut(session_id)
            .ok_or_else(|| format!("no winston session for id {session_id}"))?;
        draft.human_pass_pile()?;
        Self::drain_winston_ai(draft);
        Ok(WinstonStateDto::from_engine(session_id.to_string(), draft))
    }

    pub fn get_winston_state(&self, session_id: &str) -> Option<WinstonStateDto> {
        let winston = lock_recover(&self.winston);
        winston
            .get(session_id)
            .map(|d| WinstonStateDto::from_engine(session_id.to_string(), d))
    }

    fn drain_winston_ai(draft: &mut WinstonDraft) {
        use forge_limited::WinstonOutcome;
        while let WinstonOutcome::Picked { .. } = draft.tick() {}
    }

    pub fn start_gauntlet_from_sealed(
        &self,
        session_id: &str,
        rounds: u32,
        main: Vec<DeckCardIdentity>,
        sideboard: Vec<DeckCardIdentity>,
    ) -> Result<GauntletStateDto, String> {
        let sessions = lock_recover(&self.sessions);
        let group = sessions
            .get(session_id)
            .ok_or_else(|| format!("no sealed session for id {session_id}"))?;
        if main.len() < 40 {
            return Err("sealed main deck must contain at least 40 cards".to_string());
        }
        let human_deck = LimitedDeck {
            name: group.deck_name.clone(),
            main: main.iter().map(identity_to_paper_card).collect(),
            sideboard: sideboard.iter().map(identity_to_paper_card).collect(),
        };
        let ai_decks: Vec<LimitedDeck> = group.ai_decks.clone();
        let gauntlet = GauntletMini::new(GauntletKind::Sealed, rounds, human_deck, ai_decks)?;
        let gauntlet_id = format!("gauntlet-{}", uuid_like());
        let dto = GauntletStateDto::from_engine(gauntlet_id.clone(), &gauntlet);
        let mut decks = vec![LimitedDeckDto {
            name: gauntlet.human_deck.name.clone(),
            main,
            sideboard,
        }];
        decks.extend(gauntlet.ai_decks.iter().map(LimitedDeckDto::from));
        lock_recover(&self.gauntlet_decks).insert(gauntlet_id.clone(), decks);
        lock_recover(&self.gauntlets).insert(gauntlet_id, gauntlet);
        Ok(dto)
    }
    pub fn start_gauntlet_from_draft(
        &self,
        session_id: &str,
        rounds: u32,
        main: Vec<DeckCardIdentity>,
        sideboard: Vec<DeckCardIdentity>,
    ) -> Result<GauntletStateDto, String> {
        let drafts = lock_recover(&self.drafts);
        let draft = drafts
            .get(session_id)
            .ok_or_else(|| format!("no draft session for id {session_id}"))?;
        let ai_decks = draft.build_ai_decks()?;
        if main.len() < 40 {
            return Err("draft main deck must contain at least 40 cards".to_string());
        }
        let human_deck = LimitedDeck {
            name: "Draft Deck".to_string(),
            main: main.iter().map(identity_to_paper_card).collect(),
            sideboard: sideboard.iter().map(identity_to_paper_card).collect(),
        };
        let gauntlet = GauntletMini::new(GauntletKind::BoosterDraft, rounds, human_deck, ai_decks)?;
        let gauntlet_id = format!("gauntlet-{}", uuid_like());
        let mut decks = vec![LimitedDeckDto {
            name: gauntlet.human_deck.name.clone(),
            main,
            sideboard,
        }];
        for (deck, seat) in gauntlet.ai_decks.iter().zip(
            (0..draft.pod_size())
                .filter_map(|i| draft.seat(i))
                .filter(|seat| !seat.is_human),
        ) {
            let pool = crate::limited_dto::draft_picked_cards(session_id, draft, seat.seat);
            decks.push(crate::limited_dto::deck_with_pool_ids(deck, &pool));
        }
        lock_recover(&self.gauntlet_decks).insert(gauntlet_id.clone(), decks);
        let dto = GauntletStateDto::from_engine(gauntlet_id.clone(), &gauntlet);
        lock_recover(&self.gauntlets).insert(gauntlet_id, gauntlet);
        Ok(dto)
    }
    pub fn get_draft_ai_decks(
        &self,
        session_id: &str,
    ) -> Result<Vec<crate::limited_dto::DraftAiDeckDto>, String> {
        let drafts = lock_recover(&self.drafts);
        let draft = drafts
            .get(session_id)
            .ok_or_else(|| format!("no draft session for id {session_id}"))?;
        let decks = draft.build_ai_decks()?;
        Ok(decks
            .iter()
            .zip(
                (0..draft.pod_size())
                    .filter_map(|i| draft.seat(i))
                    .filter(|seat| !seat.is_human),
            )
            .map(|(deck, seat)| {
                let pool = crate::limited_dto::draft_picked_cards(session_id, draft, seat.seat);
                crate::limited_dto::DraftAiDeckDto {
                    seat: seat.seat as u32,
                    deck: crate::limited_dto::deck_with_pool_ids(deck, &pool),
                }
            })
            .collect())
    }

    pub fn record_gauntlet_outcome(
        &self,
        gauntlet_id: &str,
        won_game: bool,
        match_over: bool,
        match_won: bool,
    ) -> Result<GauntletOutcomeDto, String> {
        let mut gauntlets = lock_recover(&self.gauntlets);
        let gauntlet = gauntlets
            .get_mut(gauntlet_id)
            .ok_or_else(|| format!("no gauntlet for id {gauntlet_id}"))?;
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
        let state = GauntletStateDto::from_engine(gauntlet_id.to_string(), gauntlet);
        Ok(GauntletOutcomeDto {
            state,
            outcome: label.to_string(),
            next_round_index,
        })
    }

    pub fn advance_gauntlet_round(&self, gauntlet_id: &str) -> Result<GauntletStateDto, String> {
        let mut gauntlets = lock_recover(&self.gauntlets);
        let gauntlet = gauntlets
            .get_mut(gauntlet_id)
            .ok_or_else(|| format!("no gauntlet for id {gauntlet_id}"))?;
        gauntlet.next_round();
        Ok(GauntletStateDto::from_engine(
            gauntlet_id.to_string(),
            gauntlet,
        ))
    }

    pub fn get_gauntlet_state(&self, gauntlet_id: &str) -> Option<GauntletStateDto> {
        let gauntlets = lock_recover(&self.gauntlets);
        gauntlets
            .get(gauntlet_id)
            .map(|g| GauntletStateDto::from_engine(gauntlet_id.to_string(), g))
    }

    pub fn get_gauntlet_match_decks(
        &self,
        gauntlet_id: &str,
    ) -> Option<crate::limited_dto::GauntletMatchDecksDto> {
        use crate::limited_dto::GauntletMatchDecksDto;
        let gauntlets = lock_recover(&self.gauntlets);
        let g = gauntlets.get(gauntlet_id)?;
        g.current_opponent()?;
        let decks = lock_recover(&self.gauntlet_decks);
        let decks = decks.get(gauntlet_id)?;
        let human = &decks[0];
        let opponent = &decks[g.current_round as usize];
        Some(GauntletMatchDecksDto {
            human_main: human.main.clone(),
            human_sideboard: human.sideboard.clone(),
            human_deck_name: human.name.clone(),
            opponent_name: opponent.name.clone(),
            opponent_main: opponent.main.clone(),
            opponent_sideboard: opponent.sideboard.clone(),
        })
    }

    pub fn drop_sealed_session(&self, session_id: &str) -> bool {
        lock_recover(&self.sessions).remove(session_id).is_some()
    }

    pub fn drop_draft_session(&self, session_id: &str) -> bool {
        lock_recover(&self.drafts).remove(session_id).is_some()
    }

    pub fn drop_winston_session(&self, session_id: &str) -> bool {
        lock_recover(&self.winston).remove(session_id).is_some()
    }

    pub fn drop_gauntlet(&self, gauntlet_id: &str) -> bool {
        let removed = lock_recover(&self.gauntlets).remove(gauntlet_id).is_some();
        lock_recover(&self.gauntlet_decks).remove(gauntlet_id);
        removed
    }

    pub fn update_gauntlet_human_deck(
        &self,
        gauntlet_id: &str,
        main: Vec<DeckCardIdentity>,
        sideboard: Vec<DeckCardIdentity>,
    ) -> Result<GauntletStateDto, String> {
        let mut gauntlets = lock_recover(&self.gauntlets);
        let g = gauntlets
            .get_mut(gauntlet_id)
            .ok_or_else(|| format!("no gauntlet for id {gauntlet_id}"))?;
        g.human_deck.main = main.iter().map(identity_to_paper_card).collect();
        g.human_deck.sideboard = sideboard.iter().map(identity_to_paper_card).collect();
        let mut decks = lock_recover(&self.gauntlet_decks);
        let human = &mut decks
            .get_mut(gauntlet_id)
            .expect("gauntlet deck identities")[0];
        human.main = main;
        human.sideboard = sideboard;
        Ok(GauntletStateDto::from_engine(gauntlet_id.to_string(), g))
    }
}

fn serialize_checkpoint<T: serde::Serialize>(
    kind: &str,
    session_id: &str,
    state: T,
) -> Result<String, String> {
    serde_json::to_string(&LimitedEngineCheckpointRef {
        schema_version: 1,
        kind,
        session_id,
        state,
    })
    .map_err(|error| error.to_string())
}

fn lock_recover<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

fn uuid_like() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:x}")
}
