use forge_agent_interface::deck_dto::CardIdentity;
use forge_foundation::sealed_product::PaperCard;
use forge_limited::{CubeImporter, ThemedChaosDraft, CONSPIRACY_HOOKS};
use tauri::State;

use crate::card_db::card_name_known;
use crate::limited_bootstrap;
use crate::limited_dto::{
    identity_to_paper_card, BoosterDraftSetupDto, ChaosThemeDto, ConspiracyHookDto,
    CubeImportRequestDto, CubeImportResultDto, DraftStateDto, EditionInfoDto,
    GauntletMatchDecksDto, GauntletOutcomeDto, GauntletStateDto, MpDraftHumanSeatDto,
    SealedPoolDto, SealedSetupDto, SealedTemplateMetadataDto, WinstonSetupDto, WinstonStateDto,
};
use crate::limited_manager::LimitedManager;

#[tauri::command]
pub async fn limited_get_edition_info(set_code: String) -> Option<EditionInfoDto> {
    limited_bootstrap::edition_info(&set_code)
}

/// same shape `limited_start_sealed` / `limited_start_booster_draft` expect
#[tauri::command]
pub async fn limited_get_set_pool(set_code: String) -> Result<Vec<CardIdentity>, String> {
    let edition = limited_bootstrap::editions()
        .get(&set_code)
        .ok_or_else(|| format!("unknown set: {set_code}"))?;
    let pool: Vec<CardIdentity> = edition
        .cards
        .iter()
        .map(|entry| CardIdentity {
            id: String::new(),
            name: entry.name.clone(),
            set_code: edition.code.clone(),
            card_number: entry.collector_number.clone(),
            foil: None,
        })
        .collect();
    Ok(pool)
}

#[tauri::command]
pub async fn limited_start_sealed(
    lm: State<'_, LimitedManager>,
    setup: SealedSetupDto,
) -> Result<SealedPoolDto, String> {
    let card_pool = filter_playable(&setup.pool);
    if card_pool.is_empty() {
        return Err(empty_pool_error(setup.pool.len()));
    }
    lm.start_sealed(&setup, card_pool)
}

#[tauri::command]
pub async fn limited_get_sealed_pool(
    lm: State<'_, LimitedManager>,
    session_id: String,
) -> Result<SealedPoolDto, String> {
    lm.get_sealed_pool(&session_id)
        .ok_or_else(|| format!("no sealed session for id {session_id}"))
}

#[tauri::command]
pub async fn limited_start_booster_draft(
    lm: State<'_, LimitedManager>,
    setup: BoosterDraftSetupDto,
) -> Result<DraftStateDto, String> {
    let card_pool = filter_playable(&setup.pool);
    if card_pool.is_empty() {
        return Err(empty_pool_error(setup.pool.len()));
    }
    lm.start_booster_draft(&setup, card_pool)
}

#[tauri::command]
pub async fn limited_pick_card(
    lm: State<'_, LimitedManager>,
    session_id: String,
    card_name: String,
) -> Result<DraftStateDto, String> {
    lm.submit_human_pick(&session_id, &card_name)
}

#[tauri::command]
pub async fn limited_get_draft_state(
    lm: State<'_, LimitedManager>,
    session_id: String,
) -> Result<DraftStateDto, String> {
    lm.get_draft_state(&session_id)
        .ok_or_else(|| format!("no draft session for id {session_id}"))
}

#[tauri::command]
pub async fn limited_undo_pick(
    lm: State<'_, LimitedManager>,
    session_id: String,
) -> Result<DraftStateDto, String> {
    lm.undo_pick(&session_id)
}

#[tauri::command]
pub async fn limited_start_multiplayer_draft(
    lm: State<'_, LimitedManager>,
    setup: BoosterDraftSetupDto,
    humans: Vec<MpDraftHumanSeatDto>,
) -> Result<DraftStateDto, String> {
    let card_pool = filter_playable(&setup.pool);
    if card_pool.is_empty() {
        return Err(empty_pool_error(setup.pool.len()));
    }
    let humans = humans
        .into_iter()
        .map(|h| (h.seat as usize, h.name))
        .collect();
    lm.start_multiplayer_draft(&setup, card_pool, humans)
}

#[tauri::command]
pub async fn limited_submit_pick(
    lm: State<'_, LimitedManager>,
    session_id: String,
    seat_idx: u32,
    card_name: String,
) -> Result<DraftStateDto, String> {
    lm.submit_pick_for_seat(&session_id, seat_idx as usize, &card_name)
}

#[tauri::command]
pub async fn limited_get_seat_state(
    lm: State<'_, LimitedManager>,
    session_id: String,
    seat_idx: u32,
) -> Result<DraftStateDto, String> {
    lm.get_seat_state(&session_id, seat_idx as usize)
        .ok_or_else(|| format!("no draft session for id {session_id}"))
}

#[tauri::command]
pub async fn limited_start_winston(
    lm: State<'_, LimitedManager>,
    setup: WinstonSetupDto,
) -> Result<WinstonStateDto, String> {
    let card_pool = filter_playable(&setup.pool);
    if card_pool.is_empty() {
        return Err(empty_pool_error(setup.pool.len()));
    }
    lm.start_winston(setup.pool_packs, card_pool, setup.variant.as_deref())
}

#[tauri::command]
pub async fn limited_winston_take(
    lm: State<'_, LimitedManager>,
    session_id: String,
) -> Result<WinstonStateDto, String> {
    lm.winston_take(&session_id)
}

#[tauri::command]
pub async fn limited_winston_pass(
    lm: State<'_, LimitedManager>,
    session_id: String,
) -> Result<WinstonStateDto, String> {
    lm.winston_pass(&session_id)
}

#[tauri::command]
pub async fn limited_get_winston_state(
    lm: State<'_, LimitedManager>,
    session_id: String,
) -> Result<WinstonStateDto, String> {
    lm.get_winston_state(&session_id)
        .ok_or_else(|| format!("no winston session for id {session_id}"))
}

#[tauri::command]
pub async fn limited_cubecobra_url(cube_id_or_url: String) -> Result<String, String> {
    let importer = CubeImporter::new(&cube_id_or_url)?;
    importer.cubecobra_download_url()
}

#[tauri::command]
pub async fn limited_import_cube(
    request: CubeImportRequestDto,
    body: String,
) -> Result<CubeImportResultDto, String> {
    let importer = CubeImporter::new(&request.cube_id_or_url)?;
    let cube = importer.parse(&body)?;
    let card_count: u32 = cube.cards.iter().map(|c| c.count).sum();
    let mut pool: Vec<CardIdentity> = Vec::with_capacity(card_count as usize);
    for entry in &cube.cards {
        for copy in 0..entry.count {
            pool.push(CardIdentity {
                id: String::new(),
                name: entry.name.clone(),
                set_code: entry.set_code.clone().unwrap_or_default(),
                card_number: format!("cube-{copy}"),
                foil: None,
            });
        }
    }
    Ok(CubeImportResultDto {
        cube_id: importer.cube_id,
        name: cube.name,
        card_count,
        num_packs: cube.num_packs,
        singleton: cube.singleton,
        pool,
    })
}

#[tauri::command]
pub async fn limited_start_gauntlet_from_sealed(
    lm: State<'_, LimitedManager>,
    session_id: String,
    rounds: u32,
) -> Result<GauntletStateDto, String> {
    lm.start_gauntlet_from_sealed(&session_id, rounds)
}

#[tauri::command]
pub async fn limited_record_gauntlet_outcome(
    lm: State<'_, LimitedManager>,
    gauntlet_id: String,
    won_game: bool,
    match_over: bool,
    match_won: bool,
) -> Result<GauntletOutcomeDto, String> {
    lm.record_gauntlet_outcome(&gauntlet_id, won_game, match_over, match_won)
}

#[tauri::command]
pub async fn limited_advance_gauntlet_round(
    lm: State<'_, LimitedManager>,
    gauntlet_id: String,
) -> Result<GauntletStateDto, String> {
    lm.advance_gauntlet_round(&gauntlet_id)
}

#[tauri::command]
pub async fn limited_get_gauntlet_match_decks(
    lm: State<'_, LimitedManager>,
    gauntlet_id: String,
) -> Result<GauntletMatchDecksDto, String> {
    lm.get_gauntlet_match_decks(&gauntlet_id)
        .ok_or_else(|| format!("no gauntlet for id {gauntlet_id}"))
}

#[tauri::command]
pub async fn limited_update_gauntlet_human_deck(
    lm: State<'_, LimitedManager>,
    gauntlet_id: String,
    main: Vec<CardIdentity>,
    sideboard: Vec<CardIdentity>,
) -> Result<GauntletStateDto, String> {
    let main_cards = main.iter().map(identity_to_paper_card).collect();
    let sideboard_cards = sideboard.iter().map(identity_to_paper_card).collect();
    lm.update_gauntlet_human_deck(&gauntlet_id, main_cards, sideboard_cards)
}

#[tauri::command]
pub async fn limited_get_gauntlet_state(
    lm: State<'_, LimitedManager>,
    gauntlet_id: String,
) -> Result<GauntletStateDto, String> {
    lm.get_gauntlet_state(&gauntlet_id)
        .ok_or_else(|| format!("no gauntlet for id {gauntlet_id}"))
}

#[tauri::command]
pub async fn limited_drop_session(
    lm: State<'_, LimitedManager>,
    kind: String,
    session_id: String,
) -> Result<bool, String> {
    Ok(match kind.as_str() {
        "sealed" => lm.drop_sealed_session(&session_id),
        "draft" => lm.drop_draft_session(&session_id),
        "winston" => lm.drop_winston_session(&session_id),
        "gauntlet" => lm.drop_gauntlet(&session_id),
        other => return Err(format!("unknown session kind {other:?}")),
    })
}

#[tauri::command]
pub async fn limited_list_conspiracy_hooks() -> Result<Vec<ConspiracyHookDto>, String> {
    Ok(CONSPIRACY_HOOKS
        .iter()
        .map(|h| ConspiracyHookDto {
            card_name: h.card_name.into(),
            flag_name: format!("{:?}", h.flag),
            description: h.description.into(),
        })
        .collect())
}

#[tauri::command]
pub async fn limited_list_chaos_themes() -> Result<Vec<ChaosThemeDto>, String> {
    let themes = ThemedChaosDraft::parse_all(
        "5, DEFAULT, All 15-card Boosters\n\
         10, MODERN, Modern Sets Only\n\
         11, PIONEER, Pioneer Sets Only\n\
         12, STANDARD, Standard Sets Only\n",
    );
    Ok(themes
        .into_iter()
        .map(|t| ChaosThemeDto {
            tag: t.tag,
            label: t.label,
            order_number: t.order_number,
        })
        .collect())
}

#[tauri::command]
pub async fn limited_list_sealed_templates() -> Result<Vec<SealedTemplateMetadataDto>, String> {
    Ok(vec![
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
    ])
}

fn filter_playable(pool: &[CardIdentity]) -> Vec<PaperCard> {
    pool.iter()
        .filter(|c| card_name_known(&c.name))
        .map(identity_to_paper_card)
        .collect()
}

fn empty_pool_error(supplied: usize) -> String {
    format!(
        "no playable cards in pool — supplied {supplied} cards but the engine can't script any of them yet"
    )
}
