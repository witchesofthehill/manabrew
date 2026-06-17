use std::collections::HashMap;

use forge_foundation::ZoneType;
use manabrew_engine::game::GameState;
use manabrew_engine::ids::{CardId, PlayerId};
use manabrew_engine::mana::ManaPool;
use manabrew_engine::spellability::SpellAbility;

pub use manabrew_protocol::values::*;

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
    match sa.ir.destination_zone {
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

/// Determine if a spell ability's effect is hostile based on its API type.
/// Kept for backwards compatibility; new code should use `targeting_intent_of`.
pub fn is_hostile_api(sa: &SpellAbility) -> bool {
    targeting_intent_of(sa).is_hostile()
}

fn collect_stack_targets(root: &SpellAbility) -> Vec<StackTargetDto> {
    let mut out = Vec::new();
    let mut node_index = 0u32;
    let mut current = Some(root);

    while let Some(sa) = current {
        let mut target_index = 0u32;
        let intent = targeting_intent_of(sa);
        let hostile = intent.is_hostile();

        if let Some(cid) = sa.target_chosen.target_card {
            out.push(StackTargetDto {
                kind: StackTargetKindDto::Card,
                id: card_id_str(cid),
                node_index,
                target_index,
                hostile,
                intent,
            });
            target_index += 1;
        }
        if let Some(pid) = sa.target_chosen.target_player {
            out.push(StackTargetDto {
                kind: StackTargetKindDto::Player,
                id: player_id_str(pid),
                node_index,
                target_index,
                hostile,
                intent,
            });
            target_index += 1;
        }
        if let Some(stack_id) = sa.target_chosen.target_stack_entry {
            out.push(StackTargetDto {
                kind: StackTargetKindDto::Stack,
                id: stack_id_str(stack_id),
                node_index,
                target_index,
                hostile,
                intent,
            });
        }

        node_index += 1;
        current = sa.sub_ability.as_deref();
    }

    out
}

fn mana_pool_to_map(pool: &ManaPool) -> HashMap<String, i32> {
    let mut m = HashMap::new();
    m.insert("W".into(), pool.white());
    m.insert("U".into(), pool.blue());
    m.insert("B".into(), pool.black());
    m.insert("R".into(), pool.red());
    m.insert("G".into(), pool.green());
    m.insert("C".into(), pool.colorless());
    m
}

fn phase_to_step(phase: forge_foundation::PhaseType) -> &'static str {
    use forge_foundation::PhaseType::*;
    match phase {
        Untap => "untap",
        Upkeep => "upkeep",
        Draw => "draw",
        Main1 => "main1",
        CombatBegin => "begin_combat",
        CombatDeclareAttackers => "declare_attackers",
        CombatDeclareBlockers => "declare_blockers",
        CombatFirstStrikeDamage => "first_strike_damage",
        CombatDamage => "combat_damage",
        CombatEnd => "end_combat",
        Main2 => "main2",
        EndOfTurn => "end",
        Cleanup => "cleanup",
    }
}

/// Parse a frontend step string back to a PhaseType.
pub fn step_to_phase(step: &str) -> Option<forge_foundation::PhaseType> {
    use forge_foundation::PhaseType::*;
    match step {
        "untap" => Some(Untap),
        "upkeep" => Some(Upkeep),
        "draw" => Some(Draw),
        "main1" => Some(Main1),
        "begin_combat" => Some(CombatBegin),
        "declare_attackers" => Some(CombatDeclareAttackers),
        "declare_blockers" => Some(CombatDeclareBlockers),
        "first_strike_damage" => Some(CombatFirstStrikeDamage),
        "combat_damage" => Some(CombatDamage),
        "end_combat" => Some(CombatEnd),
        "main2" => Some(Main2),
        "end" => Some(EndOfTurn),
        "cleanup" => Some(Cleanup),
        _ => None,
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

pub fn card_to_dto(
    game: &GameState,
    cid: CardId,
    playable_ids: &[CardId],
    zone_label: &str,
) -> CardDto {
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
    let counters: HashMap<String, i32> = card
        .counters
        .iter()
        .filter(|(_, &v)| v > 0)
        .map(|(k, &v)| (format!("{k:?}"), v))
        .collect();

    // Build ability text from abilities
    let text = card
        .abilities
        .iter()
        .filter_map(|a| {
            // Extract SpellDescription$ if present
            for part in a.split('|') {
                let part = part.trim();
                if let Some(desc) = part.strip_prefix("SpellDescription$ ") {
                    return Some(desc.to_string());
                }
            }
            None
        })
        .collect::<Vec<_>>()
        .join("\n");

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
        name,
        set_code: card.set_code.clone().unwrap_or_default(),
        card_number: card.card_number.clone().unwrap_or_default(),
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
        text,
        is_playable: playable_ids.contains(&cid),
        is_selected: false,
        controller_id: player_id_str(card.controller),
        owner_id: player_id_str(card.owner),
        zone_id: zone_label.to_string(),
        tapped: card.tapped,
        is_crewed: card.is_crewed,
        is_attacking: card.attacking_player.is_some(),
        attacking_player_id: card.attacking_player.map(player_id_str),
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
        is_token: card.is_token,
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
        phased_out: card.phased_out,
        exerted: card.exerted,
        is_ring_bearer: game.player(card.controller).ring_bearer == Some(cid),
        effective_mana_cost: {
            let is_command_zone_commander =
                card.zone == ZoneType::Command && game.player_is_commander(card.controller, cid);
            if (playable_ids.contains(&cid) || is_command_zone_commander) && !card.is_land() {
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
        playable_ids: &[CardId],
    ) -> Self;
}

impl GameViewDtoExt for GameViewDto {
    fn from_engine(
        game: &GameState,
        mana_pools: &[ManaPool],
        human_player: PlayerId,
        game_id: &str,
        playable_ids: &[CardId],
    ) -> Self {
        let mut players = Vec::new();
        for &pid in &game.player_order {
            let ps = game.player(pid);
            let pool = mana_pools.get(pid.index()).cloned().unwrap_or_default();
            let commander_damage: HashMap<String, i32> = ps
                .commander_damage_received
                .iter()
                .map(|(&card_raw_id, &dmg)| (card_id_str(CardId(card_raw_id)), dmg))
                .collect();
            let zone_cards = |zone: ZoneType, zone_name: &str| -> Vec<CardDto> {
                game.cards_in_zone(zone, pid)
                    .iter()
                    .map(|&cid| card_to_dto(game, cid, playable_ids, zone_name))
                    .collect()
            };
            let command_zone: Vec<CardDto> = game
                .cards_in_zone(ZoneType::Command, pid)
                .iter()
                .copied()
                .filter(|&cid| should_show_command_zone_card(game, cid))
                .map(|cid| card_to_dto(game, cid, playable_ids, "command"))
                .collect();
            players.push(PlayerDto {
                id: player_id_str(pid),
                name: ps.name.clone(),
                is_human: pid == human_player,
                life: ps.life,
                poison: ps.poison_counters,
                hand: zone_cards(ZoneType::Hand, "hand"),
                graveyard: zone_cards(ZoneType::Graveyard, "graveyard"),
                exile: zone_cards(ZoneType::Exile, "exile"),
                command_zone,
                library_count: game.cards_in_zone(ZoneType::Library, pid).len(),
                mana_pool: mana_pool_to_map(&pool),
                commander_damage,
                energy_counters: ps.energy_counters,
                radiation_counters: ps.radiation_counters,
                has_city_blessing: ps.has_city_blessing,
                ring_level: ps.ring_level,
                speed: ps.speed,
            });
        }

        // Battlefield -- all players
        let mut battlefield = Vec::new();
        for &pid in &game.player_order {
            for &cid in game.cards_in_zone(ZoneType::Battlefield, pid) {
                battlefield.push(card_to_dto(game, cid, playable_ids, "battlefield"));
            }
        }

        // Stack
        let stack: Vec<StackObjectDto> = game
            .stack
            .iter()
            .map(|entry| {
                let source_card = entry.spell_ability.source.map(|cid| game.card(cid));
                let name = source_card
                    .map(|c| c.card_name.clone())
                    .unwrap_or_else(|| "Ability".to_string());
                let set_code = source_card
                    .and_then(|c| c.set_code.clone())
                    .unwrap_or_default();
                let card_number = source_card
                    .and_then(|c| c.card_number.clone())
                    .unwrap_or_default();
                StackObjectDto {
                    id: format!("stack-{}", entry.id),
                    source_id: entry
                        .spell_ability
                        .source
                        .map(card_id_str)
                        .unwrap_or_default(),
                    controller_id: player_id_str(entry.spell_ability.activating_player),
                    name,
                    text: entry.spell_ability.ability_text.clone(),
                    set_code,
                    card_number,
                    is_permanent_spell: entry.is_creature_spell || entry.is_permanent_spell,
                    is_casting: entry.is_pending_cast,
                    targets: collect_stack_targets(&entry.spell_ability),
                }
            })
            .collect();

        GameViewDto {
            game_id: game_id.to_string(),
            turn: game.turn.turn_number,
            step: phase_to_step(game.turn.phase).to_string(),
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
            battlefield,
            stack,
            game_over: game.game_over,
            winner_id: game.winner.map(player_id_str),
            conceded_player_ids: game
                .players
                .iter()
                .filter(|p| p.has_conceded)
                .map(|p| player_id_str(p.id))
                .collect(),
            monarch_id: game.monarch.map(player_id_str),
            initiative_holder_id: game.initiative_holder.map(player_id_str),
        }
    }
}
