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
    BoosterDraftSetupDto, DraftStateDto, GauntletOutcomeDto, GauntletStateDto, SealedPoolDto,
    SealedSetupDto, WinstonStateDto,
};

pub struct LimitedManager {
    sessions: Mutex<HashMap<String, SealedDeckGroup>>,
    drafts: Mutex<HashMap<String, BoosterDraft>>,
    winston: Mutex<HashMap<String, WinstonDraft>>,
    gauntlets: Mutex<HashMap<String, GauntletMini>>,
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
            rank_cache: Arc::new(DraftRankCache::new()),
        }
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
        let template = self.template_for_pool(&card_pool, setup.variant.as_deref());
        let mut gen = SealedCardPoolGenerator::new(pool_type, card_pool)
            .with_template(template, setup.num_boosters as usize);

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

        let template = self.template_for_pool(&card_pool, setup.variant.as_deref());
        let mut draft = BoosterDraft::new(pod_size, rounds, template, card_pool, ranker, color_of);
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
        card_name: &str,
    ) -> Result<DraftStateDto, String> {
        let mut drafts = lock_recover(&self.drafts);
        let draft = drafts
            .get_mut(session_id)
            .ok_or_else(|| format!("no draft session for id {session_id}"))?;
        let pack_card = draft
            .current_pack_for_human()
            .and_then(|p| p.cards().iter().find(|c| c.name == card_name).cloned())
            .ok_or_else(|| format!("card {card_name:?} not in current pack"))?;
        draft.submit_human_pick(pack_card)?;
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
        let template = self.template_for_pool(&card_pool, setup.variant.as_deref());
        let mut draft = BoosterDraft::with_human_seats(
            pod_size, rounds, template, card_pool, ranker, color_of, &humans,
        );
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
        card_name: &str,
    ) -> Result<DraftStateDto, String> {
        let mut drafts = lock_recover(&self.drafts);
        let draft = drafts
            .get_mut(session_id)
            .ok_or_else(|| format!("no draft session for id {session_id}"))?;
        let pack_card = draft
            .current_pack_for_seat(seat_idx)
            .and_then(|p| p.cards().iter().find(|c| c.name == card_name).cloned())
            .ok_or_else(|| format!("card {card_name:?} not in seat {seat_idx}'s pack"))?;
        draft.submit_human_pick_for(seat_idx, pack_card)?;
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
        pool_packs: u32,
        card_pool: Vec<PaperCard>,
        variant: Option<&str>,
    ) -> Result<WinstonStateDto, String> {
        let pool_packs = pool_packs.clamp(2, 12) as usize;
        let template = self.template_for_pool(&card_pool, variant);
        let draft = WinstonDraft::new(template, card_pool, pool_packs);
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
        loop {
            match draft.tick() {
                WinstonOutcome::Picked { .. } => continue,
                WinstonOutcome::AwaitingHuman | WinstonOutcome::Complete => break,
            }
        }
    }

    pub fn start_gauntlet_from_sealed(
        &self,
        session_id: &str,
        rounds: u32,
    ) -> Result<GauntletStateDto, String> {
        let sessions = lock_recover(&self.sessions);
        let group = sessions
            .get(session_id)
            .ok_or_else(|| format!("no sealed session for id {session_id}"))?;
        let human_deck = group.suggested_human_deck.clone().ok_or_else(|| {
            "sealed pool has no suggested human deck — open more packs".to_string()
        })?;
        let ai_decks: Vec<LimitedDeck> = group.ai_decks.clone();
        let gauntlet = GauntletMini::new(GauntletKind::Sealed, rounds, human_deck, ai_decks)?;
        let gauntlet_id = format!("gauntlet-{}", uuid_like());
        let dto = GauntletStateDto::from_engine(gauntlet_id.clone(), &gauntlet);
        lock_recover(&self.gauntlets).insert(gauntlet_id, gauntlet);
        Ok(dto)
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
        use crate::limited_dto::{paper_card_to_identity, GauntletMatchDecksDto};
        let gauntlets = lock_recover(&self.gauntlets);
        let g = gauntlets.get(gauntlet_id)?;
        let opponent = g.current_opponent()?;
        Some(GauntletMatchDecksDto {
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
            human_deck_name: g.human_deck.name.clone(),
            opponent_name: opponent.name.clone(),
            opponent_main: opponent.main.iter().map(paper_card_to_identity).collect(),
            opponent_sideboard: opponent
                .sideboard
                .iter()
                .map(paper_card_to_identity)
                .collect(),
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
        lock_recover(&self.gauntlets).remove(gauntlet_id).is_some()
    }

    pub fn update_gauntlet_human_deck(
        &self,
        gauntlet_id: &str,
        main: Vec<PaperCard>,
        sideboard: Vec<PaperCard>,
    ) -> Result<GauntletStateDto, String> {
        let mut gauntlets = lock_recover(&self.gauntlets);
        let g = gauntlets
            .get_mut(gauntlet_id)
            .ok_or_else(|| format!("no gauntlet for id {gauntlet_id}"))?;
        g.human_deck.main = main;
        g.human_deck.sideboard = sideboard;
        Ok(GauntletStateDto::from_engine(gauntlet_id.to_string(), g))
    }
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
