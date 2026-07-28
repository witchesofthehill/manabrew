use std::collections::{BTreeMap, HashMap};

use forge_foundation::ZoneType;
use manabrew_engine::card::Card;
use manabrew_engine::game::GameState;
use manabrew_engine::ids::{CardId, PlayerId};
use manabrew_engine::mana::ManaPool;
use manabrew_engine::spellability::SpellAbility;

pub use manabrew_protocol::game::*;
use manabrew_protocol::prompts::common::{TargetKind, TargetRef};

use crate::ids_codec::{card_id_str, player_id_str, stack_id_str};

/// Classify the targeting intent of a spell ability from its `ApiType`
/// and (where needed) parameters. Falls back to `Hostile` / `Friendly`
/// when the API type is unknown or ambiguous.
pub fn targeting_intent_of(sa: &SpellAbility) -> TargetingIntent {
    use manabrew_engine::ability::api_type::ApiType;
    let Some(api) = sa.api else {
        return TargetingIntent::Hostile;
    };
    match api {
        ApiType::DealDamage | ApiType::DamageAll | ApiType::EachDamage => TargetingIntent::Damage,
        ApiType::Destroy | ApiType::DestroyAll => TargetingIntent::Destroy,
        ApiType::Sacrifice | ApiType::SacrificeAll => TargetingIntent::Sacrifice,
        ApiType::ChangeZone | ApiType::ChangeZoneAll => classify_change_zone(sa),
        ApiType::Mill => TargetingIntent::Mill,
        ApiType::Discard => TargetingIntent::Discard,
        ApiType::Counter => TargetingIntent::Counter,
        ApiType::ControlSpell => TargetingIntent::GainControl,
        ApiType::Tap | ApiType::TapAll => TargetingIntent::Tap,
        ApiType::Untap | ApiType::UntapAll => TargetingIntent::Untap,
        ApiType::TapOrUntap | ApiType::TapOrUntapAll => TargetingIntent::Tap,
        ApiType::CopyPermanent | ApiType::CopySpellAbility | ApiType::Clone => {
            TargetingIntent::Copy
        }
        ApiType::Pump
        | ApiType::PumpAll
        | ApiType::Animate
        | ApiType::AnimateAll
        | ApiType::Protection
        | ApiType::ProtectionAll => TargetingIntent::Buff,
        ApiType::PutCounter | ApiType::PutCounterAll => classify_put_counter(sa),
        ApiType::RemoveCounter | ApiType::RemoveCounterAll => TargetingIntent::Debuff,
        ApiType::Debuff => TargetingIntent::Debuff,
        ApiType::GainLife => TargetingIntent::Heal,
        ApiType::LoseLife => TargetingIntent::LoseLife,
        ApiType::Draw => TargetingIntent::Draw,
        ApiType::Reveal | ApiType::RevealHand | ApiType::LookAt | ApiType::PeekAndReveal => {
            TargetingIntent::Reveal
        }
        ApiType::GainControl
        | ApiType::GainControlVariant
        | ApiType::ExchangeControl
        | ApiType::ExchangeControlVariant => TargetingIntent::GainControl,
        ApiType::Fight => TargetingIntent::Fight,
        ApiType::Attach | ApiType::Unattach => TargetingIntent::Attach,
        _ => TargetingIntent::Hostile,
    }
}

/// Distinguish Exile vs Bounce vs generic Hostile for ChangeZone effects.
fn classify_change_zone(sa: &SpellAbility) -> TargetingIntent {
    // Returning a card out of the graveyard/exile is recursion of your own
    // cards (regrowth, reanimate), not a hostile bounce/blink.
    let from_dead = matches!(
        sa.ir.origin_zone,
        Some(ZoneType::Graveyard) | Some(ZoneType::Exile)
    );
    match sa.ir.destination_zone {
        Some(ZoneType::Hand) | Some(ZoneType::Library) | Some(ZoneType::Battlefield)
            if from_dead =>
        {
            TargetingIntent::Friendly
        }
        Some(ZoneType::Hand) | Some(ZoneType::Library) | Some(ZoneType::Battlefield)
            if sa.ir.origin_zone == Some(ZoneType::Library) =>
        {
            TargetingIntent::Fetch
        }
        Some(ZoneType::Exile) => TargetingIntent::Exile,
        Some(ZoneType::Hand) | Some(ZoneType::Library) => TargetingIntent::Bounce,
        Some(ZoneType::Graveyard) => TargetingIntent::Destroy,
        Some(ZoneType::Battlefield) => TargetingIntent::Friendly,
        _ => TargetingIntent::Hostile,
    }
}

/// PutCounter effects can be buffs (+1/+1) or debuffs (-1/-1) depending on
/// the counter type. Default to Buff since most targeted put-counter
/// effects place positive counters.
fn classify_put_counter(sa: &SpellAbility) -> TargetingIntent {
    match sa.ir.counter_type.as_ref() {
        Some(manabrew_engine::card::CounterType::M1M1) => TargetingIntent::Debuff,
        Some(_) => TargetingIntent::Buff,
        None => {
            let counter_type = sa.ir.counter_type_text.as_deref().unwrap_or("");
            if counter_type.starts_with("M1M1") || counter_type.contains("-1/-1") {
                TargetingIntent::Debuff
            } else {
                TargetingIntent::Buff
            }
        }
    }
}

pub fn intent_is_hostile(intent: TargetingIntent) -> bool {
    matches!(
        intent,
        TargetingIntent::Damage
            | TargetingIntent::Destroy
            | TargetingIntent::Sacrifice
            | TargetingIntent::Exile
            | TargetingIntent::Bounce
            | TargetingIntent::Mill
            | TargetingIntent::Discard
            | TargetingIntent::Counter
            | TargetingIntent::Tap
            | TargetingIntent::Debuff
            | TargetingIntent::LoseLife
            | TargetingIntent::GainControl
            | TargetingIntent::Fight
            | TargetingIntent::Hostile
    )
}

/// Determine if a spell ability's effect is hostile based on its API type.
/// Kept for backwards compatibility; new code should use `targeting_intent_of`.
pub fn is_hostile_api(sa: &SpellAbility) -> bool {
    intent_is_hostile(targeting_intent_of(sa))
}

fn collect_stack_targets(root: &SpellAbility) -> Vec<TargetRef> {
    let mut out = Vec::new();
    let mut current = Some(root);

    while let Some(sa) = current {
        let intent = targeting_intent_of(sa);
        let oracle = stack_target_oracle(sa);

        if let Some(cid) = sa.target_chosen.target_card {
            out.push(TargetRef {
                kind: TargetKind::Card,
                id: card_id_str(cid),
                intent: Some(intent),
                oracle: oracle.clone(),
            });
        }
        if let Some(pid) = sa.target_chosen.target_player {
            out.push(TargetRef {
                kind: TargetKind::Player,
                id: player_id_str(pid),
                intent: Some(intent),
                oracle: oracle.clone(),
            });
        }
        if let Some(stack_id) = sa.target_chosen.target_stack_entry {
            out.push(TargetRef {
                kind: TargetKind::Spell,
                id: stack_id_str(stack_id),
                intent: Some(intent),
                oracle: oracle.clone(),
            });
        }

        current = sa.sub_ability.as_deref();
    }

    out
}

fn stack_target_oracle(sa: &SpellAbility) -> Option<String> {
    let desc = if !sa.stack_description.trim().is_empty() {
        sa.stack_description.trim()
    } else if !sa.description.trim().is_empty() {
        sa.description.trim()
    } else {
        return None;
    };
    Some(desc.to_string())
}

fn mana_pool_to_map(pool: &ManaPool) -> BTreeMap<ManaColor, u32> {
    let mut m = BTreeMap::new();
    for (color, amount) in [
        (ManaColor::White, pool.white()),
        (ManaColor::Blue, pool.blue()),
        (ManaColor::Black, pool.black()),
        (ManaColor::Red, pool.red()),
        (ManaColor::Green, pool.green()),
        (ManaColor::Colorless, pool.colorless()),
    ] {
        if amount > 0 {
            m.insert(color, amount as u32);
        }
    }
    m
}

fn phase_to_step(phase: forge_foundation::PhaseType) -> StepKind {
    use forge_foundation::PhaseType::*;
    match phase {
        Untap => StepKind::Untap,
        Upkeep => StepKind::Upkeep,
        Draw => StepKind::Draw,
        Main1 => StepKind::Main1,
        CombatBegin => StepKind::CombatBegin,
        CombatDeclareAttackers => StepKind::CombatDeclareAttackers,
        CombatDeclareBlockers => StepKind::CombatDeclareBlockers,
        CombatFirstStrikeDamage => StepKind::CombatFirstStrikeDamage,
        CombatDamage => StepKind::CombatDamage,
        CombatEnd => StepKind::CombatEnd,
        Main2 => StepKind::Main2,
        EndOfTurn => StepKind::EndOfTurn,
        Cleanup => StepKind::Cleanup,
    }
}

pub(crate) fn step_to_phase(step: StepKind) -> forge_foundation::PhaseType {
    use forge_foundation::PhaseType::*;
    match step {
        StepKind::Untap => Untap,
        StepKind::Upkeep => Upkeep,
        StepKind::Draw => Draw,
        StepKind::Main1 => Main1,
        StepKind::CombatBegin => CombatBegin,
        StepKind::CombatDeclareAttackers => CombatDeclareAttackers,
        StepKind::CombatDeclareBlockers => CombatDeclareBlockers,
        StepKind::CombatFirstStrikeDamage => CombatFirstStrikeDamage,
        StepKind::CombatDamage => CombatDamage,
        StepKind::CombatEnd => CombatEnd,
        StepKind::Main2 => Main2,
        StepKind::EndOfTurn => EndOfTurn,
        StepKind::Cleanup => Cleanup,
    }
}

pub fn zone_kind_of(zone: ZoneType) -> ZoneKind {
    match zone {
        ZoneType::Hand | ZoneType::ExtraHand => ZoneKind::Hand,
        ZoneType::Graveyard | ZoneType::Flashback => ZoneKind::Graveyard,
        ZoneType::Battlefield | ZoneType::Merged => ZoneKind::Battlefield,
        ZoneType::Exile => ZoneKind::Exile,
        ZoneType::Command => ZoneKind::Command,
        _ => ZoneKind::Library,
    }
}

pub fn target_ref_card(id: String) -> TargetRef {
    TargetRef {
        kind: TargetKind::Card,
        id,
        intent: None,
        oracle: None,
    }
}

pub fn target_ref_player(id: String) -> TargetRef {
    TargetRef {
        kind: TargetKind::Player,
        id,
        intent: None,
        oracle: None,
    }
}

pub fn target_ref_spell(id: String) -> TargetRef {
    TargetRef {
        kind: TargetKind::Spell,
        id,
        intent: None,
        oracle: None,
    }
}

fn day_time_of(game: &GameState) -> DayTime {
    if game.is_neither_day_nor_night() {
        DayTime::Neither
    } else if game.is_night {
        DayTime::Night
    } else {
        DayTime::Day
    }
}

fn should_show_command_zone_card(game: &GameState, cid: CardId) -> bool {
    let card = game.card(cid);
    !(card.type_line.core_types.is_empty()
        && card
            .type_line
            .subtypes
            .iter()
            .any(|subtype| subtype.eq_ignore_ascii_case("Effect")))
}

fn visible_battlefield_saga_final_chapter(card: &Card) -> Option<i32> {
    if card.zone != ZoneType::Battlefield
        || card.face_down
        || !card.type_line.has_subtype("Saga")
        || !card.has_chapter()
    {
        return None;
    }
    let final_chapter = card.get_final_chapter_nr();
    (final_chapter > 0).then_some(final_chapter)
}

fn visible_battlefield_class_level(card: &Card) -> Option<i32> {
    if card.zone != ZoneType::Battlefield || card.face_down || !card.type_line.has_subtype("Class")
    {
        return None;
    }
    (card.class_level > 0).then_some(card.class_level)
}

fn roman_value(value: &str) -> Option<i32> {
    let mut total = 0;
    let mut previous = 0;
    for ch in value.chars().rev() {
        let current = match ch {
            'I' => 1,
            'V' => 5,
            'X' => 10,
            'L' => 50,
            'C' => 100,
            'D' => 500,
            'M' => 1000,
            _ => return None,
        };
        if current < previous {
            total -= current;
        } else {
            total += current;
            previous = current;
        }
    }
    (total > 0).then_some(total)
}

fn append_oracle(oracle: &mut String, line: &str) {
    if !oracle.is_empty() {
        oracle.push('\n');
    }
    oracle.push_str(line);
}

fn visible_class_levels(card: &Card) -> Vec<ClassLevelDto> {
    if card.face_down || !card.type_line.has_subtype("Class") {
        return Vec::new();
    }
    let mut levels = vec![ClassLevelDto {
        level: 1,
        oracle: String::new(),
        cost: None,
    }];
    let mut current = 0;
    for line in card
        .oracle_text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        if line.starts_with('(') && levels.len() == 1 && levels[0].oracle.is_empty() {
            continue;
        }
        let heading = line
            .rsplit_once(": Level ")
            .and_then(|(cost, level)| level.parse::<i32>().ok().map(|level| (cost.trim(), level)));
        if let Some((printed_cost, level)) = heading {
            let cost = card
                .activated_abilities
                .iter()
                .find(|ability| {
                    ability.ability_api
                        == Some(manabrew_engine::ability::api_type::ApiType::ClassLevelUp)
                        && ability.params.get("ClassLevel")
                            == Some(format!("EQ{}", level - 1).as_str())
                })
                .and_then(|ability| ability.cost_string())
                .or_else(|| Some(printed_cost.to_string()));
            levels.push(ClassLevelDto {
                level,
                oracle: String::new(),
                cost,
            });
            current = levels.len() - 1;
        } else {
            append_oracle(&mut levels[current].oracle, line);
        }
    }
    if levels.iter().all(|level| level.oracle.is_empty()) {
        return Vec::new();
    }

    levels.sort_by_key(|level| level.level);
    levels
}

fn visible_saga_chapters(card: &Card) -> Vec<SagaChapterDto> {
    if card.face_down || !card.type_line.has_subtype("Saga") {
        return Vec::new();
    }
    let mut chapters: Vec<SagaChapterDto> = Vec::new();
    let mut current = None;
    for line in card
        .oracle_text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let heading = [" — ", " – ", " - "].into_iter().find_map(|separator| {
            let (labels, oracle) = line.split_once(separator)?;
            let positions: Option<Vec<_>> = labels
                .split(',')
                .map(|label| roman_value(label.trim()))
                .collect();
            positions.map(|positions| (positions, oracle))
        });
        if let Some((positions, oracle)) = heading {
            chapters.push(SagaChapterDto {
                chapters: positions,
                oracle: oracle.to_string(),
            });
            current = Some(chapters.len() - 1);
        } else if line.starts_with('•') {
            if let Some(index) = current {
                append_oracle(&mut chapters[index].oracle, line);
            }
        }
    }
    chapters
}

pub fn card_to_dto(game: &GameState, cid: CardId) -> CardDto {
    let card = game.card(cid);
    let types: Vec<String> = card
        .type_line
        .core_types
        .iter()
        .map(|ct| ct.name().to_string())
        .collect();
    let subtypes: Vec<String> = card.type_line.subtypes.clone();
    let supertypes: Vec<String> = card
        .type_line
        .supertypes
        .iter()
        .map(|st| st.name().to_string())
        .collect();

    let power = card.base_power.map(|_| card.power().to_string());
    let toughness = card.base_toughness.map(|_| card.toughness().to_string());
    let base_power = card.base_power;
    let base_toughness = card.base_toughness;

    // Collect non-zero counters, using the variant name as key (e.g. "P1P1", "M1M1", "Loyalty")
    let counters: BTreeMap<String, u32> = card
        .counters
        .iter()
        .filter(|(_, &v)| v > 0)
        .map(|(k, &v)| (format!("{k:?}"), v as u32))
        .collect();

    let text = if card.oracle_text.is_empty() {
        card.abilities
            .iter()
            .filter_map(|a| {
                for part in a.split('|') {
                    let part = part.trim();
                    if let Some(desc) = part.strip_prefix("SpellDescription$ ") {
                        return Some(desc.to_string());
                    }
                }
                None
            })
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        card.oracle_text.clone()
    };
    let class_levels = visible_class_levels(card);
    let saga_chapters = visible_saga_chapters(card);

    // Face-down cards show as nameless 2/2 creatures with no info
    let morph_pt = manabrew_engine::spellability::MORPH_PT.to_string();
    let (
        name,
        types,
        subtypes,
        supertypes,
        power,
        toughness,
        base_power,
        base_toughness,
        text,
        color,
        mana_cost_str,
        cmc,
    ) = if card.face_down && card.zone == ZoneType::Battlefield {
        (
            "Face-down creature".to_string(),
            vec!["Creature".to_string()],
            vec![],
            vec![],
            Some(morph_pt.clone()),
            Some(morph_pt),
            None,
            None,
            String::new(),
            String::new(),
            String::new(),
            0,
        )
    } else {
        (
            card.card_name.clone(),
            types,
            subtypes,
            supertypes,
            power,
            toughness,
            base_power,
            base_toughness,
            text,
            card.color.to_string(),
            card.mana_cost.to_string(),
            card.mana_cost.cmc(),
        )
    };

    CardDto {
        id: card_id_str(cid),
        identity: CardIdentity {
            name,
            set_code: card.set_code.clone().unwrap_or_default(),
            card_number: card.card_number.clone().unwrap_or_default(),
            is_token: card.is_token,
        },
        color,
        mana_cost: mana_cost_str,
        cmc,
        types,
        subtypes,
        supertypes,
        power,
        toughness,
        base_power,
        base_toughness,
        final_chapter: visible_battlefield_saga_final_chapter(card),
        class_level: visible_battlefield_class_level(card),
        class_levels,
        saga_chapters,
        text,
        controller_id: player_id_str(card.controller),
        owner_id: player_id_str(card.owner),
        tapped: card.tapped,
        is_crewed: card.is_crewed,
        is_attacking: card.attacking_player.is_some(),
        attacking_player_id: card.attacking_player.map(player_id_str),
        attack_target_id: None,
        // Merge intrinsic keywords with those granted by continuous effects (layer 6)
        // and temporary pump keywords (KW$ parameter, until end of turn).
        keywords: {
            let mut all_kw = card.keywords.as_string_list();
            for k in card
                .granted_keywords
                .iter_strings()
                .chain(card.pump_keywords.iter_strings())
            {
                if !all_kw.iter().any(|e| e.eq_ignore_ascii_case(k)) {
                    all_kw.push(k.to_string());
                }
            }
            all_kw
        },
        counters,
        damage: card.damage,
        summoning_sick: card.summoning_sick && !card.has_haste(),
        is_copy: card.copied_permanent.is_some(),
        is_double_faced: card.other_part.is_some(),
        flashback_cost: card.get_flashback_cost(),
        kicker_cost: card.get_kicker_cost(),
        is_transformed: card.is_transformed,
        is_face_down: card.face_down,
        is_bestowed: card.is_bestowed,
        attached_to: card.attached_to.map(card_id_str),
        attachment_ids: card
            .attachments
            .iter()
            .map(|&aid| card_id_str(aid))
            .collect(),
        merged_card_ids: card
            .melded_with
            .iter()
            .map(|&mid| card_id_str(mid))
            .collect(),
        phased_out: card.phased_out,
        exerted: card.exerted,
        is_ring_bearer: game.player(card.controller).ring_bearer == Some(cid),
        effective_mana_cost: {
            let is_command_zone_commander =
                card.zone == ZoneType::Command && game.player_is_commander(card.controller, cid);
            if is_command_zone_commander && !card.is_land() {
                let cost_adj = manabrew_engine::staticability::static_ability_cost_change::compute_cost_adjustment(
                    game, card, card.controller, card.zone,
                );
                let mut adjusted = if !cost_adj.is_empty() {
                    cost_adj.apply(&card.mana_cost)
                } else {
                    card.mana_cost.clone()
                };

                if is_command_zone_commander {
                    let commander_tax = game.player_commander_tax(card.controller, cid);
                    if commander_tax > 0 {
                        adjusted =
                            adjusted.add(&forge_foundation::ManaCost::generic(commander_tax));
                    }
                }

                let adjusted_str = adjusted.to_string();
                if adjusted_str != card.mana_cost.to_string() {
                    Some(adjusted_str)
                } else {
                    None
                }
            } else {
                None
            }
        },
        madness_cost: card.get_madness_cost(),
        is_madness_exiled: card.zone == forge_foundation::ZoneType::Exile
            && card.get_madness_cost().is_some(),
        is_plotted: card
            .keywords
            .iter_strings()
            .chain(card.granted_keywords.iter_strings())
            .any(|kw| kw.starts_with(manabrew_engine::card::KEYWORD_PLOTTED_PREFIX)),
        is_warp_exiled: card.has_keyword(manabrew_engine::card::KEYWORD_WARP_EXILED),
        foil: card.paper_foil,
        // Combat death prediction is computed by the Forge harness only; the
        // Rust engine doesn't surface it yet.
        would_die_in_combat: false,
    }
}

pub trait GameViewDtoExt {
    fn from_engine(
        game: &GameState,
        mana_pools: &[ManaPool],
        human_player: PlayerId,
        game_id: &str,
    ) -> Self;

    fn all_zone_cards(&self) -> impl Iterator<Item = &CardDto>;
}

impl GameViewDtoExt for GameViewDto {
    fn from_engine(
        game: &GameState,
        mana_pools: &[ManaPool],
        human_player: PlayerId,
        game_id: &str,
    ) -> Self {
        let mut players = Vec::new();
        let mut zones: Vec<ZoneDto> = Vec::new();
        let visible_zone = |zone: ZoneType, kind: ZoneKind, pid: PlayerId| -> ZoneDto {
            let cards: Vec<CardView> = game
                .cards_in_zone(zone, pid)
                .iter()
                .map(|&cid| CardView::Visible(card_to_dto(game, cid)))
                .collect();
            let count = cards.len();
            ZoneDto {
                zone: kind,
                owner_id: player_id_str(pid),
                cards,
                count,
            }
        };
        for &pid in &game.player_order {
            let ps = game.player(pid);
            let pool = mana_pools.get(pid.index()).cloned().unwrap_or_default();
            let commander_damage: HashMap<String, i32> = ps
                .commander_damage_received
                .iter()
                .map(|(&card_raw_id, &dmg)| (card_id_str(CardId(card_raw_id)), dmg))
                .collect();

            zones.push(visible_zone(ZoneType::Hand, ZoneKind::Hand, pid));
            zones.push(visible_zone(ZoneType::Graveyard, ZoneKind::Graveyard, pid));
            zones.push(visible_zone(ZoneType::Exile, ZoneKind::Exile, pid));
            let command_cards: Vec<CardView> = game
                .cards_in_zone(ZoneType::Command, pid)
                .iter()
                .copied()
                .filter(|&cid| should_show_command_zone_card(game, cid))
                .map(|cid| CardView::Visible(card_to_dto(game, cid)))
                .collect();
            zones.push(ZoneDto {
                zone: ZoneKind::Command,
                owner_id: player_id_str(pid),
                count: command_cards.len(),
                cards: command_cards,
            });
            // Library bulk is hidden; only the count is public.
            zones.push(ZoneDto {
                zone: ZoneKind::Library,
                owner_id: player_id_str(pid),
                cards: Vec::new(),
                count: game.cards_in_zone(ZoneType::Library, pid).len(),
            });

            let mut counters = BTreeMap::new();
            for (kind, value) in [
                (PlayerCounterKind::Poison, ps.poison_counters),
                (PlayerCounterKind::Energy, ps.energy_counters),
                (PlayerCounterKind::Radiation, ps.radiation_counters),
            ] {
                if value > 0 {
                    counters.insert(kind, value as u32);
                }
            }

            players.push(PlayerDto {
                id: player_id_str(pid),
                name: ps.name.clone(),
                status: if ps.has_conceded {
                    PlayerStatus::Conceded
                } else if ps.has_lost {
                    PlayerStatus::Lost
                } else {
                    PlayerStatus::Playing
                },
                is_human: pid == human_player,
                life: ps.life,
                counters,
                mana_pool: mana_pool_to_map(&pool),
                commander_damage,
                has_city_blessing: ps.has_city_blessing,
                ring_level: ps.ring_level,
                speed: ps.speed,
            });
        }

        // Battlefield -- bucketed by controller.
        let mut battlefield_by_controller: HashMap<String, Vec<CardView>> = HashMap::new();
        for &owner in &game.player_order {
            for &cid in game.cards_in_zone(ZoneType::Battlefield, owner) {
                let controller_id = player_id_str(game.card(cid).controller);
                battlefield_by_controller
                    .entry(controller_id)
                    .or_default()
                    .push(CardView::Visible(card_to_dto(game, cid)));
            }
        }
        for &pid in &game.player_order {
            let owner_id = player_id_str(pid);
            let cards = battlefield_by_controller
                .remove(&owner_id)
                .unwrap_or_default();
            zones.push(ZoneDto {
                zone: ZoneKind::Battlefield,
                owner_id,
                count: cards.len(),
                cards,
            });
        }

        // Stack
        let stack: Vec<StackObjectDto> = game
            .stack
            .iter()
            .map(|entry| {
                let source_card = entry.spell_ability.source.map(|cid| game.card(cid));
                let identity = CardIdentity {
                    name: source_card
                        .map(|c| c.card_name.clone())
                        .unwrap_or_else(|| "Ability".to_string()),
                    set_code: source_card
                        .and_then(|c| c.set_code.clone())
                        .unwrap_or_default(),
                    card_number: source_card
                        .and_then(|c| c.card_number.clone())
                        .unwrap_or_default(),
                    is_token: source_card.map(|c| c.is_token).unwrap_or(false),
                };
                StackObjectDto {
                    id: format!("stack-{}", entry.id),
                    source_id: entry
                        .spell_ability
                        .source
                        .map(card_id_str)
                        .unwrap_or_default(),
                    controller_id: player_id_str(entry.spell_ability.activating_player),
                    owner_id: source_card
                        .map(|c| player_id_str(c.owner))
                        .unwrap_or_default(),
                    identity,
                    text: entry.spell_ability.ability_text.clone(),
                    is_permanent_spell: entry.is_creature_spell || entry.is_permanent_spell,
                    is_casting: entry.is_pending_cast,
                    is_double_faced: source_card.map(|c| c.is_double_faced()).unwrap_or(false),
                    is_transformed: source_card.map(|c| c.is_transformed).unwrap_or(false),
                    targets: collect_stack_targets(&entry.spell_ability),
                }
            })
            .collect();

        GameViewDto {
            game_id: game_id.to_string(),
            turn: game.turn.turn_number,
            step: phase_to_step(game.turn.phase),
            combat_assignments: game
                .turn
                .combat_block_assignments
                .iter()
                .map(|(blocker, attacker)| CombatAssignmentDto {
                    blocker_id: card_id_str(*blocker),
                    attacker_id: card_id_str(*attacker),
                })
                .collect(),
            active_player_id: player_id_str(game.active_player()),
            priority_player_id: player_id_str(game.turn.priority_player),
            players,
            zones,
            stack,
            game_over: game.game_over,
            winner_id: game.winner.map(player_id_str),
            monarch_id: game.monarch.map(player_id_str),
            initiative_holder_id: game.initiative_holder.map(player_id_str),
            day_time: day_time_of(game),
        }
    }

    fn all_zone_cards(&self) -> impl Iterator<Item = &CardDto> {
        self.zones.iter().flat_map(|zone| {
            zone.cards.iter().filter_map(|card| match card {
                CardView::Visible(dto) => Some(dto),
                CardView::Hidden { .. } => None,
            })
        })
    }
}
