use crate::ability::ability_ir::{DefinedRef, NumericParamIr};
use crate::card::card_damage_history::TrackedEntity;
use crate::card::filter_constants as fc;
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::parsing::compare::compare_expr;
use crate::spellability::SpellAbility;
use forge_card_script::{
    parse_script_svar_numeric_expression, ScriptSVarNumericExpression, ScriptSVarObjectRef,
};

fn parse_trigger_int_values(sa: &SpellAbility, key: &str) -> Vec<i32> {
    crate::ability::ability_key::from_string(key)
        .and_then(|ability_key| sa.get_triggering_value(ability_key))
        .map(|raw| {
            raw.split(',')
                .filter_map(|part| part.trim().parse::<i32>().ok())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn paid_sacrificed_card(sa: &SpellAbility) -> Option<CardId> {
    sa.paid_hash
        .get(crate::cost::cost_sacrifice::HASH_CARDS)
        .or_else(|| sa.paid_hash.get(crate::cost::cost_sacrifice::HASH_LKI))
        .and_then(|ids| ids.first())
        .and_then(|raw| raw.parse::<u32>().ok())
        .map(CardId)
}

fn sacrificed_card_value(game: &GameState, sa: &SpellAbility, svar_expr: &str) -> i32 {
    let Some(sac_id) = paid_sacrificed_card(sa).or(game.last_sacrificed_card) else {
        return 0;
    };
    let sac_card = game.card(sac_id);
    if svar_expr.ends_with("Power") {
        sac_card
            .lki_power
            .unwrap_or(sac_card.base_power.unwrap_or(0))
    } else if svar_expr.ends_with("Toughness") {
        sac_card
            .lki_toughness
            .unwrap_or(sac_card.base_toughness.unwrap_or(0))
    } else {
        sac_card.mana_cost.cmc()
    }
}

fn sacrificed_card_property_value(game: &GameState, sa: &SpellAbility, property: &str) -> i32 {
    match property {
        "CardPower" | "CardToughness" | "CardManaCost" => {
            sacrificed_card_value(game, sa, &format!("Sacrificed${property}"))
        }
        _ => 0,
    }
}

fn apply_simple_operator_chain(num: i32, operators: &str) -> i32 {
    let mut value = num;
    for op in operators.split('/') {
        let op = op.trim();
        if let Some(arg) = op.strip_prefix("Plus.") {
            value += arg.parse::<i32>().unwrap_or(0);
        } else if let Some(arg) = op.strip_prefix("Minus.") {
            value -= arg.parse::<i32>().unwrap_or(0);
        } else if let Some(arg) = op.strip_prefix("Times.") {
            value *= arg.parse::<i32>().unwrap_or(1);
        } else if let Some(arg) = op.strip_prefix("HalfUp") {
            let _ = arg;
            value = (value + 1) / 2;
        } else if let Some(arg) = op.strip_prefix("HalfDown") {
            let _ = arg;
            value = ((value as f64) / 2.0).floor() as i32;
        }
    }
    value
}

fn do_x_math(
    num: i32,
    operators: &str,
    game: &GameState,
    source_id: CardId,
    controller: PlayerId,
    sa: &SpellAbility,
) -> i32 {
    if operators.is_empty() {
        return num;
    }
    let parts: Vec<&str> = operators.split('.').collect();
    let op = parts.first().copied().unwrap_or("");
    let secondary = parts.get(1).copied().map_or(0, |rhs| {
        rhs.parse::<i32>()
            .unwrap_or_else(|_| resolve_svar_expression(rhs, game, source_id, controller, sa))
    });

    if op.contains("Plus") {
        num + secondary
    } else if op.contains("NMinus") {
        secondary - num
    } else if op.contains("Minus") {
        num - secondary
    } else if op.contains("Twice") {
        num * 2
    } else if op.contains("Thrice") {
        num * 3
    } else if op.contains("HalfUp") {
        ((num as f64) / 2.0).ceil() as i32
    } else if op.contains("HalfDown") {
        ((num as f64) / 2.0).floor() as i32
    } else if op.contains("ThirdUp") {
        ((num as f64) / 3.0).ceil() as i32
    } else if op.contains("ThirdDown") {
        ((num as f64) / 3.0).floor() as i32
    } else if op.contains("Negative") {
        -num
    } else if op.contains("Times") {
        num * secondary
    } else if op.contains("Pow") {
        (num as f64).powf(secondary as f64) as i32
    } else if op.contains("DivideEvenlyUp") {
        if secondary == 0 {
            0
        } else {
            num / secondary + i32::from(num % secondary != 0)
        }
    } else if op.contains("DivideEvenlyDown") {
        if secondary == 0 {
            0
        } else {
            num / secondary
        }
    } else if op.contains("Mod") {
        num % secondary
    } else if op.contains("Abs") {
        num.abs()
    } else if op.contains("LimitMax") {
        num.min(secondary)
    } else if op.contains("LimitMin") {
        num.max(secondary)
    } else {
        num
    }
}

fn spell_ability_x_property(spell_ability: &SpellAbility, expr: &str, game: &GameState) -> i32 {
    let Some(source_id) = spell_ability.source else {
        return 0;
    };
    let source = game.card(source_id);
    let parts: Vec<&str> = expr.split('/').collect();
    let value = parts.first().copied().unwrap_or("");
    let operators = parts.get(1).copied().unwrap_or("");

    let base = match value {
        "CardPower" => source.power(),
        "CardToughness" => source.toughness(),
        _ if value.starts_with("CardCounters.") => {
            let counter_name = value.strip_prefix("CardCounters.").unwrap_or("");
            if counter_name.eq_ignore_ascii_case("ALL") {
                source.counters.values().copied().sum()
            } else {
                source.counter_count(&crate::ability::ability_utils::parse_counter_type(
                    counter_name,
                ))
            }
        }
        _ if value.starts_with("CardManaCost") => {
            let mut cmc = source.mana_value();
            if value.contains("LKI") && source.zone != forge_foundation::ZoneType::Stack {
                cmc += spell_ability.x_mana_cost_paid as i32 * source.mana_cost.count_x() as i32;
            }
            cmc
        }
        _ => 0,
    };

    do_x_math(
        base,
        operators,
        game,
        source_id,
        spell_ability.activating_player,
        spell_ability,
    )
}

fn card_x_property(
    card_id: CardId,
    expr: &str,
    game: &GameState,
    source_id: CardId,
    controller: PlayerId,
    sa: &SpellAbility,
) -> i32 {
    let card = game.card(card_id);
    let parts: Vec<&str> = expr.split('/').collect();
    let value = parts.first().copied().unwrap_or("");
    let operators = parts.get(1).copied().unwrap_or("");

    let base = match value {
        "CardPower" => card.lki_power.unwrap_or_else(|| card.power()),
        "CardBasePower" => card.base_power.unwrap_or(0),
        "CardToughness" => card.lki_toughness.unwrap_or_else(|| card.toughness()),
        "CardBaseToughness" => card.base_toughness.unwrap_or(0),
        "CardSumPT" => {
            card.lki_power.unwrap_or_else(|| card.power())
                + card.lki_toughness.unwrap_or_else(|| card.toughness())
        }
        _ if value.starts_with("CardManaCost") || value == "ManaCost" => {
            let mut cmc = card.mana_value();
            if value.contains("LKI") && card.zone != forge_foundation::ZoneType::Stack {
                cmc += sa.x_mana_cost_paid as i32 * card.mana_cost.count_x() as i32;
            }
            cmc
        }
        "Amount" | "Count" => 1,
        _ if value.starts_with("CardCounters.") => {
            let counter_name = value.strip_prefix("CardCounters.").unwrap_or("");
            if counter_name.eq_ignore_ascii_case("ALL") {
                card.counters.values().copied().sum()
            } else {
                card.counter_count(&crate::ability::ability_utils::parse_counter_type(
                    counter_name,
                ))
            }
        }
        _ => 0,
    };

    do_x_math(base, operators, game, source_id, controller, sa)
}

fn resolve_spell_ability_expr(expr: &str, game: &GameState, sa: &SpellAbility) -> Option<i32> {
    let (defined, property) = expr.split_once('$')?;
    resolve_spell_ability_property(defined, property, game, sa)
}

fn resolve_spell_ability_property(
    defined: &str,
    property: &str,
    game: &GameState,
    sa: &SpellAbility,
) -> Option<i32> {
    let spells = crate::ability::ability_utils::get_defined_spell_abilities(defined, sa, game);
    if spells.is_empty() {
        return None;
    }
    Some(
        spells
            .iter()
            .map(|spell| spell_ability_x_property(spell, property, game))
            .sum(),
    )
}

fn resolve_card_list_expr(
    expr: &str,
    game: &GameState,
    source_id: CardId,
    controller: PlayerId,
    sa: &SpellAbility,
) -> Option<i32> {
    let (defined, property) = expr.split_once('$')?;
    resolve_card_list_property(defined, property, game, source_id, controller, sa)
}

fn resolve_card_list_property(
    defined: &str,
    property: &str,
    game: &GameState,
    source_id: CardId,
    controller: PlayerId,
    sa: &SpellAbility,
) -> Option<i32> {
    let cards = resolve_defined_cards_for_svar(defined, game, source_id, sa);
    if cards.is_empty() {
        return None;
    }
    if let Some(rest) = property.strip_prefix("Valid ") {
        let (valid, operators) = rest.split_once('/').unwrap_or((rest, ""));
        let num = cards
            .into_iter()
            .filter(|&cid| {
                crate::ability::ability_utils::matches_valid_cards_for_sa(
                    game,
                    sa,
                    game.card(cid),
                    None,
                    valid,
                )
            })
            .count() as i32;
        return Some(do_x_math(num, operators, game, source_id, controller, sa));
    }
    Some(
        cards
            .into_iter()
            .map(|cid| card_x_property(cid, property, game, source_id, controller, sa))
            .sum(),
    )
}

fn resolve_defined_cards_for_svar(
    defined: &str,
    game: &GameState,
    source_id: CardId,
    sa: &SpellAbility,
) -> Vec<CardId> {
    let defined_ref = DefinedRef::parse(defined);
    match defined_ref {
        DefinedRef::Targeted
        | DefinedRef::TargetedCard
        | DefinedRef::ThisTargetedCard
        | DefinedRef::ParentTargeted => sa.target_chosen.all_target_cards(),
        DefinedRef::TriggeredCard | DefinedRef::TriggeredCardLkiCopy => {
            let cards = sa.get_triggering_cards(crate::ability::AbilityKey::Card);
            if cards.is_empty() {
                sa.trigger_source.into_iter().collect()
            } else {
                cards
            }
        }
        DefinedRef::ReplacedCard => {
            let cards = sa.get_triggering_cards(crate::ability::AbilityKey::ReplacedCard);
            if cards.is_empty() {
                sa.get_triggering_cards(crate::ability::AbilityKey::Card)
            } else {
                cards
            }
        }
        DefinedRef::TriggeredNewCard | DefinedRef::TriggeredNewCardLkiCopy => {
            let cards = sa.get_triggering_cards(crate::ability::AbilityKey::NewCard);
            if cards.is_empty() {
                sa.trigger_source.into_iter().collect()
            } else {
                cards
            }
        }
        DefinedRef::TriggeredAttacker => {
            sa.get_triggering_cards(crate::ability::AbilityKey::Attacker)
        }
        DefinedRef::TriggeredAttackers => {
            sa.get_triggering_cards(crate::ability::AbilityKey::Attackers)
        }
        DefinedRef::TriggeredBlocker => {
            sa.get_triggering_cards(crate::ability::AbilityKey::Blocker)
        }
        DefinedRef::TriggeredTarget
        | DefinedRef::TriggeredTargetLkiCopy
        | DefinedRef::TriggeredTargets => {
            let cards = sa.get_triggering_cards(crate::ability::AbilityKey::TargetCard);
            if cards.is_empty() {
                sa.get_triggering_cards(crate::ability::AbilityKey::Target)
            } else {
                cards
            }
        }
        DefinedRef::Explorer => sa.get_triggering_cards(crate::ability::AbilityKey::Explorer),
        DefinedRef::Explored => sa.get_triggering_cards(crate::ability::AbilityKey::Explored),
        DefinedRef::Discarded => sa.discarded_cost_cards.clone(),
        DefinedRef::Sacrificed => paid_sacrificed_card(sa)
            .or(game.last_sacrificed_card)
            .into_iter()
            .collect(),
        DefinedRef::Remembered => game.card(source_id).remembered_cards.clone(),
        DefinedRef::RememberedLki => {
            let cards = sa
                .trigger_objects
                .get(&crate::ability::AbilityKey::RememberedLKI)
                .map(cards_from_ability_value)
                .unwrap_or_default();
            if cards.is_empty() {
                game.card(source_id).remembered_cards.clone()
            } else {
                cards
            }
        }
        DefinedRef::DelayTriggerRememberedLki => sa
            .trigger_objects
            .get(&crate::ability::AbilityKey::RememberedLKI)
            .map(cards_from_ability_value)
            .unwrap_or_default(),
        DefinedRef::DelayTriggerRemembered | DefinedRef::TriggerRemembered => sa
            .trigger_remembered
            .iter()
            .flat_map(cards_from_ability_value)
            .collect(),
        DefinedRef::Imprinted => game.card(source_id).imprinted_cards.clone(),
        _ => crate::ability::ability_utils::get_defined_cards(
            game,
            Some(source_id),
            defined_ref.as_legacy_str(),
            Some(sa.activating_player),
        ),
    }
}

fn cards_from_ability_value(value: &crate::event::AbilityValue) -> Vec<CardId> {
    match value {
        crate::event::AbilityValue::Card(cid) => vec![*cid],
        crate::event::AbilityValue::Cards(cards) => cards.clone(),
        _ => Vec::new(),
    }
}

fn resolve_lowered_svar_expression(
    expression: &ScriptSVarNumericExpression<'_>,
    game: &GameState,
    source_id: CardId,
    controller: PlayerId,
    sa: &SpellAbility,
) -> Option<i32> {
    match expression {
        ScriptSVarNumericExpression::Number(value) => {
            let mut parts = value.split('/');
            let number = parts.next().unwrap_or("");
            let operators = parts.next().unwrap_or("");
            Some(do_x_math(
                number.trim().parse::<i32>().unwrap_or(0),
                operators,
                game,
                source_id,
                controller,
                sa,
            ))
        }
        ScriptSVarNumericExpression::Count(raw) => Some(resolve_count_svar_for_sa(
            raw, game, source_id, controller, sa,
        )),
        ScriptSVarNumericExpression::PlayerCount(raw) => Some(resolve_player_count_svar(
            raw, game, source_id, controller, sa,
        )),
        ScriptSVarNumericExpression::TriggerCount(raw) => Some(resolve_trigger_count_svar(
            raw, game, source_id, controller, sa,
        )),
        ScriptSVarNumericExpression::SVarReference { name, operators } => {
            let raw = game.card(source_id).get_s_var(name)?;
            let value = resolve_svar_expression(raw, game, source_id, controller, sa);
            Some(do_x_math(value, operators, game, source_id, controller, sa))
        }
        ScriptSVarNumericExpression::Remembered { property } => {
            Some(crate::ability::ability_utils::handle_paid(
                game,
                &game.card(source_id).remembered_cards,
                property,
                source_id,
            ))
        }
        ScriptSVarNumericExpression::RememberedSize { operators } => Some(do_x_math(
            game.card(source_id).remembered_cards.len() as i32,
            operators,
            game,
            source_id,
            controller,
            sa,
        )),
        ScriptSVarNumericExpression::DiscardedValid { filter, times } => Some(
            resolve_discarded_valid_svar(game, source_id, filter, *times),
        ),
        ScriptSVarNumericExpression::ObjectProperty { object, property } => match object {
            ScriptSVarObjectRef::Sacrificed => {
                Some(sacrificed_card_property_value(game, sa, property))
            }
            ScriptSVarObjectRef::TriggeredCard => {
                crate::lki::resolve_triggered_card_lki_property(game, sa, property).or_else(|| {
                    resolve_card_list_property(
                        "TriggeredCard",
                        property,
                        game,
                        source_id,
                        controller,
                        sa,
                    )
                })
            }
            ScriptSVarObjectRef::CardList(defined) => {
                resolve_card_list_property(defined, property, game, source_id, controller, sa)
            }
            ScriptSVarObjectRef::PlayerList(defined) => {
                resolve_direct_player_property(defined, property, game, source_id, controller, sa)
            }
            ScriptSVarObjectRef::SpellAbility(defined) => {
                resolve_spell_ability_property(defined, property, game, sa)
            }
            ScriptSVarObjectRef::PaidHash(key) => {
                resolve_paid_hash_property(key, property, game, source_id, sa)
            }
            ScriptSVarObjectRef::ReplaceCount => None,
            ScriptSVarObjectRef::RuntimeValue(_) => None,
        },
    }
}

fn resolve_discarded_valid_svar(
    game: &GameState,
    source_id: CardId,
    filter: &str,
    times: i32,
) -> i32 {
    let remembered = &game.card(source_id).remembered_cards;
    if remembered.is_empty() {
        return 0;
    }
    for &rem_id in remembered {
        let rem_card = game.card(rem_id);
        let matches = if filter.contains("nonLand") {
            !rem_card.is_land()
        } else if filter == "Card" {
            true
        } else {
            true
        };
        if matches {
            return times;
        }
    }
    0
}

fn resolve_trigger_count_svar(
    expr: &str,
    game: &GameState,
    source_id: CardId,
    controller: PlayerId,
    sa: &SpellAbility,
) -> i32 {
    let (prefix, rest) = expr.split_once('$').unwrap_or((expr, ""));
    let mut parts = rest.split('/');
    let key = parts.next().unwrap_or("");
    let operators = parts.next().unwrap_or("");
    let values = parse_trigger_int_values(sa, key.trim());
    let count = if prefix.ends_with("Max") {
        values.into_iter().max().unwrap_or(0)
    } else {
        values.into_iter().sum()
    };
    do_x_math(count, operators, game, source_id, controller, sa)
}

const MAX_SVAR_RESOLUTION_DEPTH: usize = 50;

thread_local! {
    static SVAR_RESOLUTION_DEPTH: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

pub(crate) fn resolve_svar_expression(
    expr: &str,
    game: &GameState,
    source_id: CardId,
    controller: PlayerId,
    sa: &SpellAbility,
) -> i32 {
    let depth = SVAR_RESOLUTION_DEPTH.with(|d| d.get());
    if depth >= MAX_SVAR_RESOLUTION_DEPTH {
        eprintln!("SVar resolution exceeded depth limit, returning 0 for: {expr}");
        return 0;
    }
    SVAR_RESOLUTION_DEPTH.with(|d| d.set(depth + 1));
    let value = resolve_svar_expression_inner(expr, game, source_id, controller, sa);
    SVAR_RESOLUTION_DEPTH.with(|d| d.set(depth));
    value
}

fn resolve_svar_expression_inner(
    expr: &str,
    game: &GameState,
    source_id: CardId,
    controller: PlayerId,
    sa: &SpellAbility,
) -> i32 {
    let expr = expr.trim();
    if let Ok(n) = expr.parse::<i32>() {
        return n;
    }
    if let Some(expression) = parse_script_svar_numeric_expression(expr) {
        if let Some(value) =
            resolve_lowered_svar_expression(&expression, game, source_id, controller, sa)
        {
            return value;
        }
    }
    if expr.starts_with("TriggerCount$") || expr.starts_with("TriggerCountMax$") {
        return resolve_trigger_count_svar(expr, game, source_id, controller, sa);
    }
    if expr.starts_with("Count$") {
        return resolve_count_svar_for_sa(expr, game, source_id, controller, sa);
    }
    if expr.starts_with("PlayerCount") {
        return resolve_player_count_svar(expr, game, source_id, controller, sa);
    }
    if let Some(property) = expr.strip_prefix("Remembered$") {
        return crate::ability::ability_utils::handle_paid(
            game,
            &game.card(source_id).remembered_cards,
            property,
            source_id,
        );
    }
    if let Some(rest) = expr.strip_prefix("RememberedSize") {
        return do_x_math(
            game.card(source_id).remembered_cards.len() as i32,
            rest.strip_prefix('/').unwrap_or(""),
            game,
            source_id,
            controller,
            sa,
        );
    }
    if let Some(value) = resolve_paid_hash_expr(expr, game, source_id, sa) {
        return value;
    }
    if let Some(value) = resolve_spell_ability_expr(expr, game, sa) {
        return value;
    }
    if let Some(value) = resolve_card_list_expr(expr, game, source_id, controller, sa) {
        return value;
    }
    if let Some(value) = crate::lki::resolve_triggered_card_lki_svar(game, sa, expr) {
        return value;
    }
    if let Some(value) = resolve_direct_player_expr(expr, game, source_id, controller, sa) {
        return value;
    }
    if let Some(svar_expr) = game.card(source_id).get_s_var(expr) {
        return resolve_svar_expression(svar_expr, game, source_id, controller, sa);
    }
    0
}

fn player_x_property(
    player: PlayerId,
    expr: &str,
    game: &GameState,
    source_id: CardId,
    controller: PlayerId,
    sa: &SpellAbility,
) -> i32 {
    let parts: Vec<&str> = expr.split('/').collect();
    let value = parts.first().copied().unwrap_or("");
    let operators = parts.get(1).copied().unwrap_or("");

    let base = match value {
        _ if value.starts_with("Valid") => {
            let (zones, restrictions) = if let Some(rest) = value.strip_prefix("Valid ") {
                (vec![forge_foundation::ZoneType::Battlefield], rest)
            } else {
                let mut parts = value.splitn(2, ' ');
                let zone_part = parts
                    .next()
                    .unwrap_or("")
                    .strip_prefix("Valid")
                    .unwrap_or("");
                let restrictions = parts.next().unwrap_or("");
                let zones: Vec<_> = if zone_part.is_empty() {
                    vec![forge_foundation::ZoneType::Battlefield]
                } else {
                    zone_part
                        .split(',')
                        .filter_map(crate::ability::ability_utils::parse_zone_type)
                        .collect()
                };
                (zones, restrictions)
            };
            let selector = crate::parsing::cached_compiled_selector(restrictions);
            let source = game.card(source_id);
            // Mirror Java `AbilityUtils.playerXProperty` (`AbilityUtils.java:
            // 3380, 3389`): pass the iterated `player` as the `YouCtrl`
            // controller so per-opponent counts (e.g. Beza's
            // `PlayerCountOpponents$HighestValid Land.YouCtrl`) actually scope
            // to that opponent's permanents, not the source's.
            let context = crate::card::valid_filter::MatchContext::from_source(source)
                .with_game(game)
                .with_source_controller(player);
            game.cards
                .iter()
                .filter(|card| {
                    zones.contains(&card.zone)
                        && crate::card::valid_filter::matches_valid_card_selector_with_context(
                            &selector, card, context,
                        )
                })
                .count() as i32
        }
        "CardsInHand" => game
            .cards_in_zone(forge_foundation::ZoneType::Hand, player)
            .len() as i32,
        "CardsInLibrary" => game
            .cards_in_zone(forge_foundation::ZoneType::Library, player)
            .len() as i32,
        "CardsInGraveyard" => game
            .cards_in_zone(forge_foundation::ZoneType::Graveyard, player)
            .len() as i32,
        "CardsInPlay" => game
            .cards_in_zone(forge_foundation::ZoneType::Battlefield, player)
            .len() as i32,
        "CreaturesInPlay" => game
            .cards_in_zone(forge_foundation::ZoneType::Battlefield, player)
            .iter()
            .filter(|&&cid| game.card(cid).is_creature())
            .count() as i32,
        "StartingLife" => game.player(player).starting_life,
        "LifeTotal" => game.player(player).life,
        "LifeLostThisTurn" => game.player(player).life_lost_this_turn,
        "LifeLostLastTurn" => game.player(player).life_lost_last_turn,
        "LifeGainedThisTurn" => game.player(player).life_gained_this_turn,
        "LifeGainedByTeamThisTurn" => game.player(player).life_gained_by_team_this_turn,
        "LifeStartedThisTurnWith" => game.player(player).life_started_this_turn_with,
        "Speed" => game.player(player).speed,
        "TopOfLibraryCMC" => game
            .cards_in_zone(forge_foundation::ZoneType::Library, player)
            .last()
            .map(|&cid| game.card(cid).mana_value())
            .unwrap_or(0),
        "LandsPlayed" => game.player(player).lands_played_this_turn,
        "SpellsCastThisTurn" => game.player(player).spells_cast_this_turn,
        "CardsDrawn" => game.player(player).drawn_this_turn,
        "CardsDiscardedThisTurn" => game.player(player).discarded_this_turn,
        "ExploredThisTurn" => game.player(player).explored_this_turn,
        "AttackersDeclared" => game
            .cards
            .iter()
            .filter(|card| {
                card.controller == player && card.attacked_this_turn && card.is_creature()
            })
            .count() as i32,
        "DamageToOppsThisTurn" => game.player(player).opponents_assigned_damage_this_turn,
        "NonCombatDamageDealtThisTurn" => {
            game.player(player).assigned_damage_this_turn
                - game.player(player).assigned_combat_damage_this_turn
        }
        "PoisonCounters" => game.player(player).poison_counters,
        "EnergyCounters" => game.player(player).energy_counters,
        "ManaExpendedThisTurn" => game.player(player).mana_expended_this_turn,
        "RingTemptedYou" => game.player(player).ring_level,
        "OpponentsAttackedThisTurn" => {
            let mut attacked = Vec::new();
            for card in &game.cards {
                if card.controller != player {
                    continue;
                }
                for entity in &card.damage_history.attacked_this_turn {
                    if let TrackedEntity::Player(pid) = entity {
                        if !attacked.contains(pid) {
                            attacked.push(*pid);
                        }
                    }
                }
            }
            attacked.len() as i32
        }
        "OpponentsAttackedThisCombat" => {
            game.player(player).attacked_players_this_combat.len() as i32
        }
        "BeenDealtCombatDamageSinceLastTurn" => {
            i32::from(game.player(player).been_dealt_combat_damage_since_last_turn)
        }
        "AttractionsVisitedThisTurn" => game.player(player).attractions_visited_this_turn,
        _ if value.starts_with("Counters.") => {
            let counter_name = value.strip_prefix("Counters.").unwrap_or("");
            if counter_name.eq_ignore_ascii_case("ALL") {
                game.player(player).poison_counters
                    + game.player(player).energy_counters
                    + game.player(player).radiation_counters
            } else if counter_name.eq_ignore_ascii_case("POISON") {
                game.player(player).poison_counters
            } else if counter_name.eq_ignore_ascii_case("ENERGY") {
                game.player(player).energy_counters
            } else if counter_name.eq_ignore_ascii_case("RADIATION") {
                game.player(player).radiation_counters
            } else {
                0
            }
        }
        _ if value.starts_with("HasProperty") => i32::from(crate::player::player_has_property(
            player,
            value.strip_prefix("HasProperty").unwrap_or(""),
            game,
            source_id,
            controller,
            sa,
        )),
        _ => 0,
    };

    do_x_math(base, operators, game, source_id, controller, sa)
}

pub fn player_condition_matches(
    player: PlayerId,
    property: &str,
    game: &GameState,
    source_id: CardId,
    controller: PlayerId,
    sa: &SpellAbility,
) -> bool {
    let Some(rest) = property.strip_prefix("Condition") else {
        return false;
    };
    let Some((lhs, prop_expr)) = rest.split_once(' ') else {
        return false;
    };
    let (cmp, rhs_expr) = if lhs.is_empty() {
        ("GE", "1")
    } else if lhs.len() >= 2 {
        (&lhs[..2], &lhs[2..])
    } else {
        ("GE", "1")
    };
    let rhs = resolve_svar_expression(rhs_expr, game, source_id, controller, sa);
    compare_expr(
        player_x_property(player, prop_expr, game, source_id, controller, sa),
        &format!("{cmp}{rhs}"),
    )
}

fn resolve_direct_player_expr(
    expr: &str,
    game: &GameState,
    source_id: CardId,
    controller: PlayerId,
    sa: &SpellAbility,
) -> Option<i32> {
    let (defined, property) = expr.split_once('$')?;
    resolve_direct_player_property(defined, property, game, source_id, controller, sa)
}

fn resolve_direct_player_property(
    defined: &str,
    property: &str,
    game: &GameState,
    source_id: CardId,
    controller: PlayerId,
    sa: &SpellAbility,
) -> Option<i32> {
    let players = crate::ability::ability_utils::resolve_defined_players_with_sa(
        defined, sa, controller, game,
    );
    if players.is_empty() {
        return None;
    }
    Some(
        players
            .into_iter()
            .map(|pid| player_x_property(pid, property, game, source_id, controller, sa))
            .sum(),
    )
}

fn resolve_player_count_svar(
    expr: &str,
    game: &GameState,
    source_id: CardId,
    controller: PlayerId,
    sa: &SpellAbility,
) -> i32 {
    let Some((group, property_expr)) = expr.split_once('$') else {
        return 0;
    };
    let kind = group.strip_prefix("PlayerCount").unwrap_or(group);
    let mut property_parts = property_expr.splitn(2, '/');
    let property = property_parts.next().unwrap_or("");
    let operators = property_parts.next().unwrap_or("");
    let players: Vec<PlayerId> = if kind.is_empty() || kind == "Players" {
        game.alive_players()
    } else if kind == "Opponents" {
        game.alive_players()
            .into_iter()
            .filter(|&pid| crate::player::player_predicates::is_opponent_of(game, controller, pid))
            .collect()
    } else if kind == "Remembered" {
        game.card(source_id).remembered_players.clone()
    } else if kind.starts_with("PropertyYou") {
        vec![controller]
    } else if let Some(property) = kind.strip_prefix("Property") {
        game.alive_players()
            .into_iter()
            .filter(|&pid| {
                crate::player::player_has_property(pid, property, game, source_id, controller, sa)
            })
            .collect()
    } else if let Some(defined) = kind.strip_prefix("Defined") {
        crate::ability::ability_utils::resolve_defined_players_with_sa(
            defined, sa, controller, game,
        )
    } else {
        Vec::new()
    };

    if players.is_empty() {
        return 0;
    }

    if property.eq_ignore_ascii_case("Amount") {
        return do_x_math(
            players.len() as i32,
            operators,
            game,
            source_id,
            controller,
            sa,
        );
    }
    if let Some(rest) = property.strip_prefix("Highest") {
        return do_x_math(
            players
                .iter()
                .map(|&pid| player_x_property(pid, rest, game, source_id, controller, sa))
                .max()
                .unwrap_or(0),
            operators,
            game,
            source_id,
            controller,
            sa,
        );
    }
    if let Some(rest) = property.strip_prefix("Lowest") {
        return do_x_math(
            players
                .iter()
                .map(|&pid| player_x_property(pid, rest, game, source_id, controller, sa))
                .min()
                .unwrap_or(0),
            operators,
            game,
            source_id,
            controller,
            sa,
        );
    }
    if property.eq_ignore_ascii_case("TiedForHighestLife") {
        let max_life = players
            .iter()
            .map(|&pid| game.player(pid).life)
            .max()
            .unwrap_or(i32::MIN);
        return do_x_math(
            players
                .iter()
                .filter(|&&pid| game.player(pid).life == max_life)
                .count() as i32,
            operators,
            game,
            source_id,
            controller,
            sa,
        );
    }
    if property.eq_ignore_ascii_case("TiedForLowestLife") {
        let min_life = players
            .iter()
            .map(|&pid| game.player(pid).life)
            .min()
            .unwrap_or(i32::MAX);
        return do_x_math(
            players
                .iter()
                .filter(|&&pid| game.player(pid).life == min_life)
                .count() as i32,
            operators,
            game,
            source_id,
            controller,
            sa,
        );
    }
    if let Some(raw_property) = property.strip_prefix("HasProperty") {
        return do_x_math(
            players
                .into_iter()
                .filter(|&pid| {
                    crate::player::player_has_property(
                        pid,
                        raw_property,
                        game,
                        source_id,
                        controller,
                        sa,
                    )
                })
                .count() as i32,
            operators,
            game,
            source_id,
            controller,
            sa,
        );
    }
    if let Some(rest) = property.strip_prefix("Condition") {
        if let Some((lhs, prop_expr)) = rest.split_once(' ') {
            let (cmp, rhs_expr) = if lhs.is_empty() {
                ("GE", "1")
            } else if lhs.len() >= 2 {
                (&lhs[..2], &lhs[2..])
            } else {
                ("GE", "1")
            };
            let rhs = resolve_svar_expression(rhs_expr, game, source_id, controller, sa);
            return do_x_math(
                players
                    .into_iter()
                    .filter(|&pid| {
                        compare_expr(
                            player_x_property(pid, prop_expr, game, source_id, controller, sa),
                            &format!("{cmp}{rhs}"),
                        )
                    })
                    .count() as i32,
                operators,
                game,
                source_id,
                controller,
                sa,
            );
        }
    }

    do_x_math(
        players
            .into_iter()
            .map(|pid| player_x_property(pid, property, game, source_id, controller, sa))
            .sum(),
        operators,
        game,
        source_id,
        controller,
        sa,
    )
}

/// Resolve a numeric parameter from a SpellAbility, expanding SVar references.
///
/// This is the main entry point for effect resolution — call it whenever you
/// need to convert a param value (which might be a literal int, "X", or an
/// SVar reference) into an integer.
///
/// **Examples:**
/// - `"NumDmg" -> "3"` → returns 3
/// - `"NumDmg" -> "X"` → returns `sa.x_mana_cost_paid` or evaluates the "X" SVar
/// - `"NumDmg" -> "AFLifeLost"` → looks up SVar "AFLifeLost" and evaluates it
///
/// **param_name**: The param key on the ability IR (e.g. "NumDmg", "LifeAmount")
/// **default**: The value to return if the param is missing or empty
pub fn resolve_numeric_svar(
    game: &GameState,
    sa: &SpellAbility,
    param_name: &str,
    default: i32,
) -> i32 {
    let Some(value) = sa.ir.semantic_numeric_params.get(param_name) else {
        return default;
    };
    resolve_semantic_numeric_value(game, sa, value, default)
}

fn resolve_semantic_numeric_value(
    game: &GameState,
    sa: &SpellAbility,
    value: &NumericParamIr,
    default: i32,
) -> i32 {
    match value {
        NumericParamIr::Integer(value) => *value,
        NumericParamIr::Amount(amount) => amount.resolve_for_spell_ability(game, sa, default),
        NumericParamIr::SVarReference(names) => match names.as_slice() {
            [name] => resolve_numeric_value(game, sa, name, default),
            [] => default,
            _ => names
                .iter()
                .map(|name| resolve_numeric_value(game, sa, name, default))
                .sum(),
        },
        NumericParamIr::Raw(raw) => resolve_numeric_value(game, sa, raw, default),
    }
}

/// Resolve a raw numeric DSL value using the same semantics as
/// [`resolve_numeric_svar`], without first looking it up in `sa.params`.
pub fn resolve_numeric_value(
    game: &GameState,
    sa: &SpellAbility,
    raw_val: &str,
    default: i32,
) -> i32 {
    let val_str = raw_val.trim();
    if val_str.is_empty() {
        return default;
    }

    // Try direct integer parse first
    if let Ok(n) = val_str.parse::<i32>() {
        return n;
    }
    // Try with leading + sign (e.g. "+3")
    if let Some(stripped) = val_str.strip_prefix('+') {
        if let Ok(n) = stripped.parse::<i32>() {
            return n;
        }
    }

    // Support signed SVar references like "-X" / "+X".
    let (sign, val_str) = if let Some(stripped) = val_str.strip_prefix('-') {
        (-1, stripped.trim())
    } else if let Some(stripped) = val_str.strip_prefix('+') {
        (1, stripped.trim())
    } else {
        (1, val_str)
    };

    if let Some(source_id) = sa.source {
        if let Some(expression) = parse_script_svar_numeric_expression(val_str) {
            if let Some(value) = resolve_lowered_svar_expression(
                &expression,
                game,
                source_id,
                sa.activating_player,
                sa,
            ) {
                return sign * value;
            }
        }
        if let Some(value) =
            resolve_card_list_expr(val_str, game, source_id, sa.activating_player, sa)
        {
            return sign * value;
        }
    }

    // Check if it's the X mana cost value directly
    if val_str == "X" {
        // First check if there's an SVar named "X" on the source card
        if let Some(source_id) = sa.source {
            if let Some(svar_expr) = game.card(source_id).get_s_var("X") {
                if svar_expr.starts_with("Count$") {
                    return sign
                        * resolve_count_svar_for_sa(
                            svar_expr,
                            game,
                            source_id,
                            sa.activating_player,
                            sa,
                        );
                }
                if svar_expr.starts_with("PlayerCount") {
                    return sign
                        * resolve_player_count_svar(
                            svar_expr,
                            game,
                            source_id,
                            sa.activating_player,
                            sa,
                        );
                }
                if let Some(value) = resolve_paid_hash_expr(svar_expr, game, source_id, sa) {
                    return sign * value;
                }
                if svar_expr.starts_with("TriggerCount$")
                    || svar_expr.starts_with("TriggerCountMax$")
                {
                    return sign
                        * resolve_trigger_count_svar(
                            svar_expr,
                            game,
                            source_id,
                            sa.activating_player,
                            sa,
                        );
                }
                if let Some(expression) = parse_script_svar_numeric_expression(svar_expr) {
                    if let Some(value) = resolve_lowered_svar_expression(
                        &expression,
                        game,
                        source_id,
                        sa.activating_player,
                        sa,
                    ) {
                        return sign * value;
                    }
                }
                if let Some(value) = resolve_spell_ability_expr(svar_expr, game, sa) {
                    return sign * value;
                }
                if let Some(value) =
                    resolve_card_list_expr(svar_expr, game, source_id, sa.activating_player, sa)
                {
                    return sign * value;
                }
                // Must run before resolve_direct_player_expr, which can
                // greedily match some object-property expression prefixes.
                if let Some(value) =
                    crate::lki::resolve_triggered_card_lki_svar(game, sa, svar_expr)
                {
                    return sign * value;
                }
                if let Some(value) =
                    resolve_direct_player_expr(svar_expr, game, source_id, sa.activating_player, sa)
                {
                    return sign * value;
                }
                return sign * evaluate_svar(svar_expr, sa);
            }
        }
        // Otherwise use x_mana_cost_paid directly
        return sign * sa.x_mana_cost_paid as i32;
    }

    // It's an SVar reference — look it up on the source card
    if let Some(source_id) = sa.source {
        if let Some(svar_expr) = game.card(source_id).get_s_var(val_str.trim()) {
            // Game-aware SVar resolution for patterns that need GameState.
            if svar_expr.starts_with("Count$") {
                return sign
                    * resolve_count_svar_for_sa(
                        svar_expr,
                        game,
                        source_id,
                        sa.activating_player,
                        sa,
                    );
            }
            if svar_expr.starts_with("PlayerCount") {
                return sign
                    * resolve_player_count_svar(
                        svar_expr,
                        game,
                        source_id,
                        sa.activating_player,
                        sa,
                    );
            }
            if let Some(value) = resolve_paid_hash_expr(svar_expr, game, source_id, sa) {
                return sign * value;
            }
            if let Some(expression) = parse_script_svar_numeric_expression(svar_expr) {
                if let Some(value) = resolve_lowered_svar_expression(
                    &expression,
                    game,
                    source_id,
                    sa.activating_player,
                    sa,
                ) {
                    return sign * value;
                }
            }
            if let Some(value) = resolve_spell_ability_expr(svar_expr, game, sa) {
                return sign * value;
            }
            if let Some(value) =
                resolve_card_list_expr(svar_expr, game, source_id, sa.activating_player, sa)
            {
                return sign * value;
            }
            // Must be checked before resolve_direct_player_expr, which
            // would incorrectly match "TriggeredCard" as a player definition.
            if let Some(value) = crate::lki::resolve_triggered_card_lki_svar(game, sa, svar_expr) {
                return sign * value;
            }
            // evaluate_svar handles Number$N, Count$Kicked, TriggerCount, etc.
            // Must run before resolve_direct_player_expr which greedily matches
            // any foo$bar pattern via the resolve_defined_players fallback.
            let eval = evaluate_svar(svar_expr, sa);
            if eval != 0 || svar_expr.starts_with("Number$") || svar_expr.starts_with("Count$") {
                return sign * eval;
            }
            if let Some(value) =
                resolve_direct_player_expr(svar_expr, game, source_id, sa.activating_player, sa)
            {
                return sign * value;
            }
            return sign * eval;
        }
    }

    default
}

fn resolve_paid_hash_expr(
    expr: &str,
    game: &GameState,
    source_id: CardId,
    sa: &SpellAbility,
) -> Option<i32> {
    let (paid_key, property) = expr.split_once('$')?;
    resolve_paid_hash_property(paid_key, property, game, source_id, sa)
}

fn resolve_paid_hash_property(
    paid_key: &str,
    property: &str,
    game: &GameState,
    source_id: CardId,
    sa: &SpellAbility,
) -> Option<i32> {
    let paid_values = sa.paid_hash.get(paid_key)?;
    let paid_cards: Vec<CardId> = paid_values
        .iter()
        .filter_map(|value| {
            let raw = value.strip_prefix("Card#").unwrap_or(value);
            raw.parse::<u32>().ok().map(CardId)
        })
        .filter(|cid| cid.index() < game.cards.len())
        .collect();

    if property.starts_with("TapPowerValue") {
        return Some(
            paid_cards
                .iter()
                .map(|&cid| crate::cost::cost_tap_type::tap_power_value(game, cid, Some(sa)))
                .sum(),
        );
    }

    Some(crate::ability::ability_utils::handle_paid(
        game,
        &paid_cards,
        property,
        source_id,
    ))
}

/// Evaluate a simple SVar expression.
/// Supports `Count$Kicked.A.B` (returns A if kicked, B otherwise)
/// and `Count$KickedCount` (returns the multikicker count).
pub fn evaluate_svar(expr: &str, sa: &SpellAbility) -> i32 {
    // X mana cost — return the value of X paid when casting
    if let Some(rest) = expr
        .strip_prefix("Count$xPaid")
        .or_else(|| expr.strip_prefix("Count$XPaid"))
    {
        let operators = rest.strip_prefix('/').unwrap_or(rest);
        return apply_simple_operator_chain(sa.x_mana_cost_paid as i32, operators);
    }
    // Converge/Sunburst — handled in resolve_numeric_svar (needs GameState)
    if expr == "Count$Converge" || expr == "Count$Sunburst" {
        return 0; // Fallback; game-aware path in resolve_numeric_svar handles this
    }
    if expr == "Count$TriggerRememberAmount" {
        return sa.trigger_remembered_amount;
    }
    if let Some(rest) = expr.strip_prefix("TriggerCount$") {
        let (key, operators) = rest.split_once('/').unwrap_or((rest, ""));
        let values = parse_trigger_int_values(sa, key.trim());
        let count = values.into_iter().sum::<i32>();
        return apply_simple_operator_chain(count, operators);
    }
    if let Some(rest) = expr.strip_prefix("TriggerCountMax$") {
        let (key, operators) = rest.split_once('/').unwrap_or((rest, ""));
        let count = parse_trigger_int_values(sa, key.trim())
            .into_iter()
            .max()
            .unwrap_or(0);
        return apply_simple_operator_chain(count, operators);
    }
    if expr == "TriggerCount$Result" {
        return trigger_result_values(sa).into_iter().sum();
    }
    if expr == "TriggerCountMax$Result" {
        return trigger_result_values(sa).into_iter().max().unwrap_or(0);
    }
    // TriggerCount$Amount — number of objects that matched the trigger event.
    // For per-event triggers (ChangesZoneAll batched as individual fires), this is 1.
    if expr == "TriggerCount$Amount" {
        return sa.trigger_remembered_amount.max(1);
    }
    // Count$KickedCount — return the multikicker count (for Multikicker effects)
    if expr == "Count$KickedCount" {
        return sa.kick_count as i32;
    }
    // Count$Kicked.X.Y — if kicked return X, else return Y
    if let Some(rest) = expr.strip_prefix("Count$Kicked.") {
        let parts: Vec<&str> = rest.splitn(2, '.').collect();
        if parts.len() == 2 {
            let kicked_val = parts[0].parse::<i32>().unwrap_or(0);
            let normal_val = parts[1].parse::<i32>().unwrap_or(0);
            return if sa.kicked { kicked_val } else { normal_val };
        }
    }
    // Number$N — literal numeric SVar (e.g. "Number$2" set by LoseLife for AFLifeLost)
    if let Some(rest) = expr.strip_prefix("Number$") {
        return rest.trim().parse::<i32>().unwrap_or(0);
    }
    // Fallback: try parsing as integer
    expr.parse::<i32>().unwrap_or(0)
}

fn trigger_result_values(sa: &SpellAbility) -> Vec<i32> {
    sa.trigger_objects
        .get(&crate::ability::AbilityKey::Result)
        .map(|raw| {
            raw.split(',')
                .filter_map(|part| part.trim().parse::<i32>().ok())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

/// Resolve a Count$ SVar expression that requires game state access.
/// Handles patterns like `Count$Valid Forest.YouCtrl`, `Count$Converge`,
/// `Count$CardPower`, etc.
pub fn resolve_count_svar(
    expr: &str,
    game: &GameState,
    source_id: CardId,
    controller: PlayerId,
) -> i32 {
    resolve_count_svar_for_sa(
        expr,
        game,
        source_id,
        controller,
        &crate::spellability::SpellAbility::new_empty(Some(source_id), controller),
    )
}

/// Resolve a cost-adjustment `Amount$ <ident>` slot. Tries a direct integer
/// parse first, then looks up `ident` on the host's SVar table and routes
/// through the subset of `Count$…` patterns relevant for cost adjustment.
/// Mirrors Java `AbilityUtils.calculateAmount(host, name, staticAbility)`
/// for the static-ability path. Owned by `svar/` so cost callers don't
/// reimplement SVar walking.
pub fn resolve_cost_amount_svar(
    game: &GameState,
    source: &crate::card::Card,
    name: &str,
    caster: PlayerId,
) -> i32 {
    if let Ok(n) = name.parse::<i32>() {
        return n;
    }
    let Some(expr) = source.get_s_var(name) else {
        return 0;
    };
    evaluate_cost_amount_count_expr(game, source, expr, caster)
}

fn evaluate_cost_amount_count_expr(
    game: &GameState,
    source: &crate::card::Card,
    expr: &str,
    caster: PlayerId,
) -> i32 {
    use crate::card::Card;
    use forge_foundation::ZoneType;
    if expr == "Count$xPaid" || expr == "Count$XPaid" {
        return source
            .svars
            .get("XPaid")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);
    }
    if let Some(counter_name) = expr.strip_prefix("Count$CardCounters.") {
        let counter_type = crate::ability::ability_utils::parse_counter_type(counter_name);
        return source.counter_count(&counter_type);
    }
    if let Some(rest) = expr.strip_prefix("Count$ThisTurnCast_") {
        if rest.contains("YouCtrl") || rest.contains("YouOwn") {
            return game.player(source.controller).spells_cast_this_turn;
        }
        return game.player(caster).spells_cast_this_turn;
    }
    if expr == "Count$YourLifeTotal" {
        return game.player(source.controller).life;
    }
    if let Some(rest) = expr.strip_prefix("Count$Valid ") {
        let (filter, aggregator) = rest.split_once('$').unwrap_or((rest, ""));
        let selector = crate::parsing::cached_compiled_selector(filter);
        let matches: Vec<&Card> = game
            .cards
            .iter()
            .filter(|c| c.zone == ZoneType::Battlefield)
            .filter(|c| {
                crate::card::valid_filter::matches_valid_card_selector_in_game(
                    &selector, c, source, game,
                )
            })
            .collect();
        return match aggregator {
            "" | "Amount" => matches.len() as i32,
            "GreatestCardManaCost" => matches.iter().map(|c| c.mana_cost.cmc()).max().unwrap_or(0),
            _ => 0,
        };
    }
    if expr.contains("Graveyard") && expr.contains("YouCtrl") {
        return game
            .cards_in_zone(ZoneType::Graveyard, source.controller)
            .len() as i32;
    }
    expr.strip_prefix("Count$")
        .and_then(|s| s.parse::<i32>().ok())
        .unwrap_or(0)
}

pub fn resolve_count_svar_for_sa(
    expr: &str,
    game: &GameState,
    source_id: CardId,
    controller: PlayerId,
    sa: &SpellAbility,
) -> i32 {
    use forge_foundation::ZoneType;

    if let Some(rest) = expr
        .strip_prefix("Count$xPaid")
        .or_else(|| expr.strip_prefix("Count$XPaid"))
    {
        let operators = rest.strip_prefix('/').unwrap_or(rest);
        return do_x_math(
            sa.x_mana_cost_paid as i32,
            operators,
            game,
            source_id,
            controller,
            sa,
        );
    }
    if let Some(operators) = expr.strip_prefix("Count$CastTotalManaSpent") {
        let operators = operators.strip_prefix('/').unwrap_or(operators);
        return do_x_math(
            game.card(source_id).paying_mana_to_cast.len() as i32,
            operators,
            game,
            source_id,
            controller,
            sa,
        );
    }

    if expr == "Count$TriggerRememberAmount" {
        return sa.trigger_remembered_amount;
    }
    if expr == "Count$ChosenNumber" {
        return game.card(source_id).chosen_number.unwrap_or(0);
    }
    if expr == "TriggerCount$Result" {
        return trigger_result_values(sa).into_iter().sum();
    }
    if expr == "TriggerCountMax$Result" {
        return trigger_result_values(sa).into_iter().max().unwrap_or(0);
    }

    if expr == "Count$Converge" || expr == "Count$Sunburst" {
        return game.card(source_id).sunburst_count();
    }

    if expr == "Count$YourSpeed" {
        return game.player(controller).speed;
    }

    if let Some(operators) = expr.strip_prefix("Count$YourLifeTotal") {
        let operators = operators.strip_prefix('/').unwrap_or(operators);
        return do_x_math(
            game.player(controller).life,
            operators,
            game,
            source_id,
            controller,
            sa,
        );
    }

    if let Some(operators) = expr.strip_prefix("Count$YouDrewThisTurn") {
        let operators = operators.strip_prefix('/').unwrap_or(operators);
        return do_x_math(
            game.player(controller).drawn_this_turn,
            operators,
            game,
            source_id,
            controller,
            sa,
        );
    }

    if let Some(operators) = expr.strip_prefix("Count$OppGreatestLifeTotal") {
        let operators = operators.strip_prefix('/').unwrap_or(operators);
        let highest_life = game
            .alive_players()
            .into_iter()
            .filter(|&pid| crate::player::player_predicates::is_opponent_of(game, controller, pid))
            .map(|pid| game.player(pid).life)
            .max()
            .unwrap_or(0);
        return do_x_math(highest_life, operators, game, source_id, controller, sa);
    }

    // Count$Metalcraft.A.B — return A if controller has 3+ artifacts, else B.
    if let Some(rest) = expr.strip_prefix("Count$Metalcraft.") {
        let parts: Vec<&str> = rest.splitn(2, '.').collect();
        if parts.len() == 2 {
            let yes = parts[0].parse::<i32>().unwrap_or(1);
            let no = parts[1].parse::<i32>().unwrap_or(0);
            return if game.player_has_metalcraft(controller) {
                yes
            } else {
                no
            };
        }
    }

    if let Some(rest) = expr.strip_prefix("Count$MaxSpeed.") {
        let parts: Vec<&str> = rest.splitn(2, '.').collect();
        if parts.len() == 2 {
            let yes = parts[0].parse::<i32>().unwrap_or(1);
            let no = parts[1].parse::<i32>().unwrap_or(0);
            return if game.player(controller).speed == 4 {
                yes
            } else {
                no
            };
        }
    }

    if expr == "Count$AttackersDeclared" {
        return game
            .cards
            .iter()
            .filter(|card| {
                card.controller == controller && card.attacked_this_turn && card.is_creature()
            })
            .count() as i32;
    }

    if expr == "Count$TopOfLibraryCMC" {
        return game
            .cards_in_zone(ZoneType::Library, controller)
            .last()
            .map(|&cid| game.card(cid).mana_value())
            .unwrap_or(0);
    }

    if let Some(rest) = expr.strip_prefix("Count$OptionalGenericCostPaid.") {
        let parts: Vec<&str> = rest.splitn(2, '.').collect();
        if parts.len() == 2 {
            let paid_val = parts[0].parse::<i32>().unwrap_or(1);
            let unpaid_val = parts[1].parse::<i32>().unwrap_or(0);
            return if sa.optional_generic_cost_paid {
                paid_val
            } else {
                unpaid_val
            };
        }
    }

    if expr == "Count$KickedCount" {
        return sa.kick_count as i32;
    }
    if let Some(rest) = expr.strip_prefix("Count$Kicked.") {
        let parts: Vec<&str> = rest.splitn(2, '.').collect();
        if parts.len() == 2 {
            let chosen = if sa.kicked { parts[0] } else { parts[1] };
            return resolve_svar_expression(chosen, game, source_id, controller, sa);
        }
    }

    // Count$UrzaLands.A.B — return A when the controller has all three Urza
    // lands, else B.
    if let Some(rest) = expr.strip_prefix("Count$UrzaLands.") {
        let parts: Vec<&str> = rest.splitn(2, '.').collect();
        if parts.len() == 2 {
            let chosen = if crate::player::player_predicates::has_urza_lands(game, controller) {
                parts[0]
            } else {
                parts[1]
            };
            return resolve_svar_expression(chosen, game, source_id, controller, sa);
        }
    }

    // Count$PromisedGift.A.B — return A when gift promised, else B.
    if let Some(rest) = expr.strip_prefix("Count$PromisedGift.") {
        let parts: Vec<&str> = rest.splitn(2, '.').collect();
        if parts.len() == 2 {
            let promised_val = parts[0].parse::<i32>().unwrap_or(1);
            let not_promised_val = parts[1].parse::<i32>().unwrap_or(0);
            return if game.card(source_id).promised_gift.is_some() {
                promised_val
            } else {
                not_promised_val
            };
        }
    }
    if expr == "Count$PromisedGift" {
        return if game.card(source_id).promised_gift.is_some() {
            1
        } else {
            0
        };
    }

    // Count$Valid<Zone[,Zone...]> <restrictions>
    // Examples:
    // - Count$ValidHand Card.YouOwn
    // - Count$ValidGraveyard Card
    // - Count$ValidBattlefield Creature.YouCtrl
    if let Some(rest) = expr.strip_prefix("Count$Valid") {
        let (rest, operators) = rest.split_once('/').unwrap_or((rest, ""));
        let mut parts = rest.trim_start().splitn(2, ' ');
        let zone_part = parts.next().unwrap_or("").trim();
        let restrictions = parts.next().unwrap_or("").trim();
        let (restrictions, aggregator) = restrictions.split_once('$').unwrap_or((restrictions, ""));
        if !restrictions.is_empty() {
            let zones: Vec<ZoneType> = if zone_part.is_empty() {
                vec![ZoneType::Battlefield]
            } else {
                zone_part
                    .split(',')
                    .filter_map(crate::ability::ability_utils::parse_zone_type)
                    .collect()
            };
            if !zones.is_empty() {
                let source = game.card(source_id);
                let selector = crate::parsing::cached_compiled_selector(restrictions);
                // Thread targets through so `TargetedPlayerOwn` etc. resolve.
                let targeted_players: Vec<crate::ids::PlayerId> =
                    sa.target_chosen.target_player.into_iter().collect();
                let targeted_cards: Vec<crate::ids::CardId> =
                    sa.target_chosen.target_card.into_iter().collect();
                let ctx = crate::card::valid_filter::MatchContext::from_source(source)
                    .with_game(game)
                    .with_targets(&targeted_cards, &targeted_players)
                    .with_spell_ability(sa);
                let matches: Vec<&crate::card::Card> = game
                    .cards
                    .iter()
                    .filter(|card| {
                        zones.contains(&card.zone)
                            && crate::card::valid_filter::matches_valid_card_selector_with_context(
                                &selector, card, ctx,
                            )
                    })
                    .collect();
                let count = match aggregator {
                    "" | "Amount" => matches.len() as i32,
                    "GreatestCardManaCost" => {
                        matches.iter().map(|c| c.mana_cost.cmc()).max().unwrap_or(0)
                    }
                    _ => 0,
                };
                return do_x_math(count, operators, game, source_id, controller, sa);
            }
        }
    }

    // Count$Valid TYPE.QUALIFIERS — count permanents matching filter
    // Count$Valid TYPE.QUALIFIERS/Times.N — count × N multiplier
    // Count$Valid TYPE.QUALIFIERS$GreatestCardPower — greatest power among matching creatures
    if let Some(filter_str) = expr.strip_prefix("Count$Valid ") {
        let (filter_str, operators) = filter_str.split_once('/').unwrap_or((filter_str, ""));
        // Check for $GreatestCardPower suffix
        let (filter_str, greatest_power) =
            if let Some(base) = filter_str.strip_suffix("$GreatestCardPower") {
                (base, true)
            } else {
                (filter_str, false)
            };

        // Check for $Colors suffix — return distinct colors among matching
        // permanents (e.g. Faeburrow Elder: Count$Valid Permanent.YouCtrl$Colors).
        let count_distinct_colors = filter_str.ends_with("$Colors");
        let filter_str = if count_distinct_colors {
            filter_str.trim_end_matches("$Colors")
        } else {
            filter_str
        };

        // Check for /Times.N multiplier suffix (e.g. "Enchantment.Other/Times.2")
        let (filter_str, multiplier) = crate::parsing::strip_times_multiplier(filter_str);

        let battlefield = game.cards_in_zone(ZoneType::Battlefield, controller);
        // Also check opponent's battlefield for non-YouCtrl filters
        let opp = game.opponent_of(controller);
        let opp_battlefield = game.cards_in_zone(ZoneType::Battlefield, opp);

        let has_you_ctrl =
            filter_str.contains(fc::YOU_CTRL) || filter_str.contains(fc::YOU_CONTROL);

        let cards_to_check: Vec<CardId> = if has_you_ctrl {
            battlefield.to_vec()
        } else {
            battlefield
                .iter()
                .chain(opp_battlefield.iter())
                .copied()
                .collect()
        };

        let source = game.card(source_id);
        let selector = crate::parsing::cached_compiled_selector(filter_str);
        if greatest_power {
            // Return the greatest power among matching creatures
            let mut max_power = 0;
            for &cid in &cards_to_check {
                let card = game.card(cid);
                if crate::card::valid_filter::matches_valid_card_selector_in_game(
                    &selector, card, source, game,
                ) {
                    max_power = max_power.max(card.power());
                }
            }
            return do_x_math(max_power, operators, game, source_id, controller, sa);
        } else if count_distinct_colors {
            let mut mask: u8 = 0;
            for &cid in &cards_to_check {
                let card = game.card(cid);
                if crate::card::valid_filter::matches_valid_card_selector_in_game(
                    &selector, card, source, game,
                ) {
                    mask |= card.color.mask();
                }
            }
            return do_x_math(
                (mask.count_ones() as i32) * multiplier,
                operators,
                game,
                source_id,
                controller,
                sa,
            );
        } else {
            let mut count = 0;
            for &cid in &cards_to_check {
                let card = game.card(cid);
                if crate::card::valid_filter::matches_valid_card_selector_in_game(
                    &selector, card, source, game,
                ) {
                    count += 1;
                }
            }
            return do_x_math(
                count * multiplier,
                operators,
                game,
                source_id,
                controller,
                sa,
            );
        }
    }

    // Count$Devotion.COLOR — count mana symbols of a color among permanents you control.
    if let Some(color_str) = expr.strip_prefix("Count$Devotion.") {
        let color_mask: u16 = match color_str.to_uppercase().as_str() {
            "W" | "WHITE" => forge_foundation::ManaAtom::WHITE,
            "U" | "BLUE" => forge_foundation::ManaAtom::BLUE,
            "B" | "BLACK" => forge_foundation::ManaAtom::BLACK,
            "R" | "RED" => forge_foundation::ManaAtom::RED,
            "G" | "GREEN" => forge_foundation::ManaAtom::GREEN,
            _ => 0,
        };
        if color_mask != 0 {
            let battlefield = game.cards_in_zone(ZoneType::Battlefield, controller);
            let mut count = 0i32;
            for &cid in battlefield {
                let card = game.card(cid);
                for shard in card.mana_cost.shards() {
                    if (shard.shard() & color_mask) != 0 {
                        count += 1;
                    }
                }
            }
            return count;
        }
    }

    // Count$Compare SVAR OPTHRESHOLD.IFTRUE.IFFALSE
    // e.g. Count$Compare Y GE1.3.1  → if Y >= 1 then 3 else 1
    if let Some(rest) = expr.strip_prefix("Count$Compare ") {
        let parts: Vec<&str> = rest.splitn(2, ' ').collect();
        if parts.len() == 2 {
            let svar_name = parts[0];
            let cond_parts: Vec<&str> = parts[1].splitn(3, '.').collect();
            if cond_parts.len() == 3 {
                // Resolve the referenced SVar
                let svar_val = if let Some(svar_expr) = game.card(source_id).get_s_var(svar_name) {
                    if svar_expr.starts_with("Count$") || svar_expr.starts_with("PlayerCount") {
                        resolve_svar_expression(svar_expr, game, source_id, controller, sa)
                    } else {
                        svar_expr.parse::<i32>().unwrap_or(0)
                    }
                } else {
                    svar_name.parse::<i32>().unwrap_or(0)
                };

                // Parse operator + threshold from cond_parts[0], e.g. "GE1"
                let cond = cond_parts[0];
                let result = compare_expr(svar_val, cond);

                let resolve_branch = |raw: &str| {
                    raw.parse::<i32>().unwrap_or_else(|_| {
                        if let Some(svar_expr) = game.card(source_id).get_s_var(raw) {
                            resolve_svar_expression(svar_expr, game, source_id, controller, sa)
                        } else {
                            resolve_svar_expression(raw, game, source_id, controller, sa)
                        }
                    })
                };
                let if_true = resolve_branch(cond_parts[1]);
                let if_false = resolve_branch(cond_parts[2]);
                return if result { if_true } else { if_false };
            }
        }
    }

    if let Some(operators) = expr.strip_prefix("Count$ColorsColorIdentity") {
        let operators = operators.strip_prefix('/').unwrap_or(operators);
        let count = game
            .player_commander_color_identity(game.card(source_id).controller)
            .len() as i32;
        return do_x_math(count, operators, game, source_id, controller, sa);
    }

    // Count$CardPower — power of the source card
    if expr == "Count$CardPower" {
        return game.card(source_id).power();
    }
    // Count$CardToughness
    if expr == "Count$CardToughness" {
        return game.card(source_id).toughness();
    }
    if let Some(operators) = expr.strip_prefix("Count$YourTurns") {
        let operators = operators.strip_prefix('/').unwrap_or(operators);
        return do_x_math(
            game.player(controller).statistics.turns_played,
            operators,
            game,
            source_id,
            controller,
            sa,
        );
    }
    // Count$CardCounters.TYPE
    if let Some(counter_type) = expr.strip_prefix("Count$CardCounters.") {
        let ct = crate::ability::effects::parse_counter_type(counter_type);
        return *game.card(source_id).counters.get(&ct).unwrap_or(&0);
    }

    // Count$TotalDamageDoneByThisTurn — total damage dealt by the source card this turn.
    if expr == "Count$TotalDamageDoneByThisTurn" {
        return game.card(source_id).total_damage_done_this_turn;
    }

    // Count$InYour<Zone> / Count$CardsInYour<Zone> — zone size for the SA's
    // controller (e.g. `Count$CardsInYourHand` returns the hand size of the
    // ability's "you"). Mirrors Java `AbilityUtils.getCardListForXCount`'s
    // `InYour<Zone>` substring branch (`AbilityUtils.java:3718`).
    if let Some(rest) = expr
        .strip_prefix("Count$CardsInYour")
        .or_else(|| expr.strip_prefix("Count$InYour"))
    {
        let zone = match rest {
            "Hand" => Some(ZoneType::Hand),
            "Yard" | "Graveyard" => Some(ZoneType::Graveyard),
            "Library" => Some(ZoneType::Library),
            "Exile" => Some(ZoneType::Exile),
            "Battlefield" => Some(ZoneType::Battlefield),
            _ => None,
        };
        if let Some(zone) = zone {
            return game.cards_in_zone(zone, controller).len() as i32;
        }
    }

    // Count$RememberedSize — mirrors Java `Card.getRememberedCount()`
    // (cards + players + integers).
    if let Some(rest) = expr.strip_prefix("Count$RememberedSize") {
        let operators = rest.strip_prefix('/').unwrap_or(rest);
        let card = game.card(source_id);
        let count =
            card.remembered_cards.len() + card.remembered_players.len() + card.remembered_cmc.len();
        return do_x_math(count as i32, operators, game, source_id, controller, sa);
    }

    expr.parse::<i32>().unwrap_or_else(|_| {
        eprintln!("Unrecognized Count expression, returning 0 for: {expr}");
        0
    })
}

/// Check if a card matches a validity filter string like "Forest.YouCtrl".
#[allow(dead_code)]
fn valid_card_matches_with_source(
    filter: &str,
    card: &crate::card::Card,
    controller: PlayerId,
    source_id: CardId,
    chosen_type: Option<&str>,
) -> bool {
    let parts: Vec<&str> = filter.split('.').collect();
    let base_type = parts.first().copied().unwrap_or("");

    // Check base type
    let type_ok = match base_type {
        fc::CREATURE => card.is_creature(),
        fc::LAND => card.is_land(),
        fc::ARTIFACT => card.type_line.is_artifact(),
        fc::ENCHANTMENT => card.type_line.is_enchantment(),
        fc::PLANESWALKER => card.type_line.is_planeswalker(),
        fc::PERMANENT | fc::CARD => true,
        // Subtypes (Forest, Island, Goblin, etc.)
        _ => card.type_line.has_subtype(base_type),
    };
    if !type_ok {
        return false;
    }

    // Check qualifiers (split by '.' and '+')
    for &dot_qual in &parts[1..] {
        for sub_qual in dot_qual.split('+') {
            let sub_qual = sub_qual.trim();
            if sub_qual.eq_ignore_ascii_case(fc::YOU_CTRL)
                || sub_qual.eq_ignore_ascii_case(fc::YOU_CONTROL)
            {
                if card.controller != controller {
                    return false;
                }
            } else if sub_qual.eq_ignore_ascii_case(fc::SELF_REF) {
                if card.id != source_id {
                    return false;
                }
            } else if sub_qual.eq_ignore_ascii_case(fc::OTHER) {
                if card.id == source_id {
                    return false;
                }
            } else if sub_qual.eq_ignore_ascii_case("ChosenType") {
                // Card must have the source card's chosen creature type as a subtype.
                // Changeling means all creature types — always matches.
                match chosen_type {
                    Some(ct)
                        if card.type_line.has_subtype(ct) || card.has_keyword("Changeling") => {}
                    _ => return false,
                }
            } else if sub_qual.starts_with("counters_") {
                // Parse "counters_GE1_P1P1", "counters_EQ0_P1P1", etc.
                if !check_counter_qualifier(card, sub_qual) {
                    return false;
                }
            }
        }
    }
    true
}

/// Check a counter qualifier like "counters_GE1_P1P1".
#[allow(dead_code)]
fn check_counter_qualifier(card: &crate::card::Card, qual: &str) -> bool {
    let rest = match qual.strip_prefix("counters_") {
        Some(r) => r,
        None => return true,
    };
    // Split into OP+THRESHOLD and COUNTER_TYPE, e.g. "GE1_P1P1"
    let parts: Vec<&str> = rest.splitn(2, '_').collect();
    if parts.len() != 2 {
        return true;
    }
    let cond = parts[0];
    let counter_type = crate::ability::effects::parse_counter_type(parts[1]);
    let count = *card.counters.get(&counter_type).unwrap_or(&0);

    compare_expr(count, cond)
}

#[cfg(test)]
mod tests {
    use forge_foundation::{CardTypeLine, ColorSet, ManaCost};

    use super::resolve_numeric_svar;
    use crate::card::Card;
    use crate::game::GameState;
    use crate::ids::{CardId, PlayerId};
    use crate::spellability::SpellAbility;

    #[test]
    fn resolves_player_count_defined_life_total_twice() {
        let mut game = GameState::new(&["A", "B"], 20);
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);
        game.player_mut(p1).life = 7;

        let mut host = Card::new(
            CardId(0),
            "Host".to_string(),
            p0,
            CardTypeLine::parse("Creature"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            Some(1),
            Some(1),
            vec![],
            vec![],
        );
        host.svars.insert(
            "X".to_string(),
            "PlayerCountDefinedTriggeredAttackedTarget$LifeTotal/Twice".to_string(),
        );
        let host_id = game.create_card(host);

        let mut sa = SpellAbility::new_simple(Some(host_id), p0, "DB$ GainLife | LifeAmount$ X");
        sa.set_triggering_object(crate::ability::AbilityKey::AttackedTarget, p1);

        assert_eq!(resolve_numeric_svar(&game, &sa, "LifeAmount", 0), 14);
    }

    #[test]
    fn resolves_player_count_highest_life_total() {
        let mut game = GameState::new(&["A", "B"], 20);
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);
        game.player_mut(p0).life = 11;
        game.player_mut(p1).life = 17;

        let mut host = Card::new(
            CardId(0),
            "Host".to_string(),
            p0,
            CardTypeLine::parse("Creature"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            Some(1),
            Some(1),
            vec![],
            vec![],
        );
        host.svars.insert(
            "X".to_string(),
            "PlayerCountPlayers$HighestLifeTotal".to_string(),
        );
        let host_id = game.create_card(host);

        let sa = SpellAbility::new_simple(Some(host_id), p0, "DB$ GainLife | LifeAmount$ X");
        assert_eq!(resolve_numeric_svar(&game, &sa, "LifeAmount", 0), 17);
    }

    #[test]
    fn resolves_triggered_target_life_total_half_up() {
        let mut game = GameState::new(&["A", "B"], 20);
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);
        game.player_mut(p1).life = 9;

        let mut host = Card::new(
            CardId(0),
            "Host".to_string(),
            p0,
            CardTypeLine::parse("Creature"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            Some(1),
            Some(1),
            vec![],
            vec![],
        );
        host.svars.insert(
            "X".to_string(),
            "TriggeredTarget$LifeTotal/HalfUp".to_string(),
        );
        let host_id = game.create_card(host);

        let mut sa = SpellAbility::new_simple(
            Some(host_id),
            p0,
            "DB$ LoseLife | Defined$ TriggeredTarget | LifeAmount$ X",
        );
        sa.set_triggering_object(crate::ability::AbilityKey::TargetPlayer, p1);

        assert_eq!(resolve_numeric_svar(&game, &sa, "LifeAmount", 0), 5);
    }

    #[test]
    fn resolves_player_count_minus_remembered_amount() {
        let mut game = GameState::new(&["A", "B"], 20);
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);

        let remembered = Card::new(
            CardId(1),
            "Remembered".to_string(),
            p1,
            CardTypeLine::parse("Creature"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            Some(1),
            Some(1),
            vec![],
            vec![],
        );
        let remembered_id = game.create_card(remembered);

        let mut host = Card::new(
            CardId(0),
            "Host".to_string(),
            p0,
            CardTypeLine::parse("Creature"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            Some(1),
            Some(1),
            vec![],
            vec![],
        );
        host.svars.insert(
            "X".to_string(),
            "PlayerCountOpponents$Amount/Minus.Remembered$Amount".to_string(),
        );
        let host_id = game.create_card(host);
        game.card_mut(host_id).add_remembered_card(remembered_id);

        let sa = SpellAbility::new_simple(Some(host_id), p0, "DB$ Draw | NumCards$ X");
        assert_eq!(resolve_numeric_svar(&game, &sa, "NumCards", -1), 0);
    }

    #[test]
    fn resolves_player_count_minus_empty_remembered_amount() {
        let mut game = GameState::new(&["A", "B"], 20);
        let p0 = PlayerId(0);

        let mut host = Card::new(
            CardId(0),
            "Host".to_string(),
            p0,
            CardTypeLine::parse("Creature"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            Some(1),
            Some(1),
            vec![],
            vec![],
        );
        host.svars.insert(
            "X".to_string(),
            "PlayerCountOpponents$Amount/Minus.Remembered$Amount".to_string(),
        );
        let host_id = game.create_card(host);

        let sa = SpellAbility::new_simple(Some(host_id), p0, "DB$ Draw | NumCards$ X");
        assert_eq!(resolve_numeric_svar(&game, &sa, "NumCards", -1), 1);
    }

    #[test]
    fn resolves_player_count_remembered_life_lost_this_turn() {
        let mut game = GameState::new(&["A", "B"], 20);
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);

        game.player_mut(p1).life_lost_this_turn = 11;

        let mut host = Card::new(
            CardId(0),
            "Host".to_string(),
            p0,
            CardTypeLine::parse("Creature"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            Some(1),
            Some(1),
            vec![],
            vec![],
        );
        host.svars.insert(
            "X".to_string(),
            "PlayerCountRemembered$LifeLostThisTurn".to_string(),
        );
        let host_id = game.create_card(host);
        game.card_mut(host_id).add_remembered_player(p1);

        let sa = SpellAbility::new_simple(Some(host_id), p0, "DB$ LoseLife | LifeAmount$ X");
        assert_eq!(resolve_numeric_svar(&game, &sa, "LifeAmount", -1), 11);
    }

    #[test]
    fn resolves_triggered_spell_ability_card_mana_cost_lki() {
        let mut game = GameState::new(&["A", "B"], 20);
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);

        let mut host = Card::new(
            CardId(0),
            "Host".to_string(),
            p0,
            CardTypeLine::parse("Creature"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            Some(1),
            Some(1),
            vec![],
            vec![],
        );
        host.svars.insert(
            "X".to_string(),
            "TriggeredSpellAbility$CardManaCostLKI".to_string(),
        );
        let host_id = game.create_card(host);

        let mut spell_card = Card::new(
            CardId(1),
            "Big Spell".to_string(),
            p1,
            CardTypeLine::parse("Sorcery"),
            ManaCost::parse("X U"),
            ColorSet::BLUE,
            None,
            None,
            vec![],
            vec![],
        );
        spell_card.set_zone(forge_foundation::ZoneType::Graveyard);
        let spell_id = game.create_card(spell_card);

        let mut triggered_sa =
            SpellAbility::new_simple(Some(spell_id), p1, "SP$ DealDamage | NumDmg$ 1");
        triggered_sa.x_mana_cost_paid = 4;

        let mut sa = SpellAbility::new_simple(Some(host_id), p0, "DB$ GainLife | LifeAmount$ X");
        sa.set_triggering_spell_ability("SpellAbility", triggered_sa);

        assert_eq!(resolve_numeric_svar(&game, &sa, "LifeAmount", 0), 5);
    }

    #[test]
    fn resolves_count_your_speed_and_max_speed() {
        let mut game = GameState::new(&["A", "B"], 20);
        let p0 = PlayerId(0);
        game.player_mut(p0).speed = 4;

        let mut host = Card::new(
            CardId(0),
            "Host".to_string(),
            p0,
            CardTypeLine::parse("Creature"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            Some(1),
            Some(1),
            vec![],
            vec![],
        );
        host.svars
            .insert("X".to_string(), "Count$YourSpeed".to_string());
        host.svars
            .insert("Y".to_string(), "Count$MaxSpeed.2.1".to_string());
        let host_id = game.create_card(host);

        let sa = SpellAbility::new_simple(
            Some(host_id),
            p0,
            "DB$ GainLife | LifeAmount$ X | NumCards$ Y",
        );
        assert_eq!(resolve_numeric_svar(&game, &sa, "LifeAmount", 0), 4);
        assert_eq!(resolve_numeric_svar(&game, &sa, "NumCards", 0), 2);
    }

    #[test]
    fn resolves_attackers_declared_and_life_lost_last_turn() {
        let mut game = GameState::new(&["A", "B"], 20);
        let p0 = PlayerId(0);

        let mut attacker = Card::new(
            CardId(0),
            "Attacker".to_string(),
            p0,
            CardTypeLine::parse("Creature"),
            ManaCost::parse("1 R"),
            ColorSet::RED,
            Some(2),
            Some(2),
            vec![],
            vec![],
        );
        attacker.attacked_this_turn = true;
        game.create_card(attacker);

        game.player_mut(p0).life_lost_this_turn = 3;
        game.player_mut(p0).new_turn();

        let mut host = Card::new(
            CardId(1),
            "Host".to_string(),
            p0,
            CardTypeLine::parse("Creature"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            Some(1),
            Some(1),
            vec![],
            vec![],
        );
        host.svars
            .insert("X".to_string(), "Count$AttackersDeclared".to_string());
        host.svars.insert(
            "Y".to_string(),
            "PlayerCountPropertyYou$LifeLostLastTurn".to_string(),
        );
        let host_id = game.create_card(host);

        let sa = SpellAbility::new_simple(
            Some(host_id),
            p0,
            "DB$ GainLife | LifeAmount$ X | NumCards$ Y",
        );
        assert_eq!(resolve_numeric_svar(&game, &sa, "LifeAmount", 0), 1);
        assert_eq!(resolve_numeric_svar(&game, &sa, "NumCards", 0), 3);
    }

    #[test]
    fn resolves_top_of_library_cmc() {
        let mut game = GameState::new(&["A", "B"], 20);
        let p0 = PlayerId(0);

        let top = Card::new(
            CardId(0),
            "Top".to_string(),
            p0,
            CardTypeLine::parse("Sorcery"),
            ManaCost::parse("2 U"),
            ColorSet::BLUE,
            None,
            None,
            vec![],
            vec![],
        );
        let top_id = game.create_card(top);
        game.move_card(top_id, forge_foundation::ZoneType::Library, p0);

        let mut host = Card::new(
            CardId(1),
            "Host".to_string(),
            p0,
            CardTypeLine::parse("Creature"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            Some(1),
            Some(1),
            vec![],
            vec![],
        );
        host.svars
            .insert("X".to_string(), "Count$TopOfLibraryCMC".to_string());
        let host_id = game.create_card(host);

        let sa = SpellAbility::new_simple(Some(host_id), p0, "DB$ GainLife | LifeAmount$ X");
        assert_eq!(resolve_numeric_svar(&game, &sa, "LifeAmount", 0), 3);
    }

    #[test]
    fn resolves_player_property_counters_for_discard_damage_and_combat() {
        let mut game = GameState::new(&["A", "B"], 20);
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);
        game.player_mut(p0).discarded_this_turn = 2;
        game.player_mut(p0).explored_this_turn = 1;
        game.player_mut(p0).opponents_assigned_damage_this_turn = 4;
        game.player_mut(p0).assigned_damage_this_turn = 7;
        game.player_mut(p0).assigned_combat_damage_this_turn = 2;
        game.player_mut(p0).attacked_players_this_combat.push(p1);
        game.player_mut(p0).been_dealt_combat_damage_since_last_turn = true;

        let mut host = Card::new(
            CardId(0),
            "Host".to_string(),
            p0,
            CardTypeLine::parse("Creature"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            Some(1),
            Some(1),
            vec![],
            vec![],
        );
        host.svars.insert(
            "A".to_string(),
            "PlayerCountPropertyYou$CardsDiscardedThisTurn".to_string(),
        );
        host.svars.insert(
            "B".to_string(),
            "PlayerCountPropertyYou$ExploredThisTurn".to_string(),
        );
        host.svars.insert(
            "C".to_string(),
            "PlayerCountPropertyYou$DamageToOppsThisTurn".to_string(),
        );
        host.svars.insert(
            "D".to_string(),
            "PlayerCountPropertyYou$NonCombatDamageDealtThisTurn".to_string(),
        );
        host.svars.insert(
            "E".to_string(),
            "PlayerCountPropertyYou$OpponentsAttackedThisCombat".to_string(),
        );
        host.svars.insert(
            "F".to_string(),
            "PlayerCountPropertyYou$BeenDealtCombatDamageSinceLastTurn".to_string(),
        );
        let host_id = game.create_card(host);

        let sa = SpellAbility::new_simple(
            Some(host_id),
            p0,
            "DB$ GainLife | LifeAmount$ A | NumCards$ B",
        );
        assert_eq!(resolve_numeric_svar(&game, &sa, "LifeAmount", 0), 2);
        assert_eq!(resolve_numeric_svar(&game, &sa, "NumCards", 0), 1);
        assert_eq!(
            super::resolve_svar_expression(
                game.card(host_id).get_s_var("C").unwrap(),
                &game,
                host_id,
                p0,
                &sa,
            ),
            4
        );
        assert_eq!(
            super::resolve_svar_expression(
                game.card(host_id).get_s_var("D").unwrap(),
                &game,
                host_id,
                p0,
                &sa,
            ),
            5
        );
        assert_eq!(
            super::resolve_svar_expression(
                game.card(host_id).get_s_var("E").unwrap(),
                &game,
                host_id,
                p0,
                &sa,
            ),
            1
        );
        assert_eq!(
            super::resolve_svar_expression(
                game.card(host_id).get_s_var("F").unwrap(),
                &game,
                host_id,
                p0,
                &sa,
            ),
            1
        );
    }

    #[test]
    fn resolves_trigger_result_sum_and_max_from_trigger_objects() {
        let mut game = GameState::new(&["A", "B"], 20);
        let p0 = PlayerId(0);

        let mut host = Card::new(
            CardId(0),
            "Host".to_string(),
            p0,
            CardTypeLine::parse("Creature"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            Some(1),
            Some(1),
            vec![],
            vec![],
        );
        host.svars
            .insert("Sum".to_string(), "TriggerCount$Result".to_string());
        host.svars
            .insert("Max".to_string(), "TriggerCountMax$Result".to_string());
        let host_id = game.create_card(host);

        let mut sa = SpellAbility::new_simple(Some(host_id), p0, "DB$ Draw | NumCards$ Sum");
        sa.set_triggering_object(crate::ability::AbilityKey::Result, "4,11,7");

        assert_eq!(
            super::resolve_svar_expression(
                game.card(host_id).get_s_var("Sum").unwrap(),
                &game,
                host_id,
                p0,
                &sa,
            ),
            22
        );
        assert_eq!(
            super::resolve_svar_expression(
                game.card(host_id).get_s_var("Max").unwrap(),
                &game,
                host_id,
                p0,
                &sa,
            ),
            11
        );
    }
}
