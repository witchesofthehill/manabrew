use forge_foundation::ZoneType;

use crate::ability::ability_utils;
use crate::card::card_damage_history::TrackedEntity;
use crate::card::valid_filter::matches_valid_card;
use crate::card::valid_filter::matches_valid_card_selector_in_game;
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::parsing::cached_compiled_selector;
use crate::parsing::compare::compare_expr;
use crate::spellability::SpellAbility;
use crate::zone::zone_type::smart_value_of as parse_zone_type;

fn eval_amount(game: &GameState, _source_id: CardId, sa: &SpellAbility, expr: &str) -> i32 {
    if let Ok(value) = expr.trim().parse::<i32>() {
        return value;
    }
    crate::svar::resolve_numeric_value(game, sa, expr.trim(), 0)
}

fn split_escaped_underscores(text: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut escaped = false;

    for ch in text.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
        } else if ch == '\\' {
            escaped = true;
        } else if ch == '_' {
            parts.push(current);
            current = String::new();
        } else {
            current.push(ch);
        }
    }
    parts.push(current);
    parts
}

fn count_matching_cards(
    game: &GameState,
    cards: impl IntoIterator<Item = CardId>,
    restriction: &str,
    source_id: CardId,
) -> usize {
    let source = game.card(source_id);
    cards
        .into_iter()
        .filter(|&cid| matches_valid_card(restriction, game.card(cid), source))
        .count()
}

fn count_type(
    game: &GameState,
    cards: impl IntoIterator<Item = CardId>,
    card_type: &str,
    source_id: CardId,
) -> usize {
    let selector = cached_compiled_selector(card_type);
    let source = game.card(source_id);
    cards
        .into_iter()
        .filter(|&cid| matches_valid_card_selector_in_game(&selector, game.card(cid), source, game))
        .count()
}

fn player_controls_matching(
    game: &GameState,
    player: PlayerId,
    zone: ZoneType,
    restriction: &str,
    source_id: CardId,
) -> usize {
    count_matching_cards(
        game,
        game.cards_in_zone(zone, player).iter().copied(),
        restriction,
        source_id,
    )
}

fn any_attacker_matches(
    game: &GameState,
    attacker_controller: PlayerId,
    attacked: TrackedEntity,
    restriction: &str,
    source_id: CardId,
) -> bool {
    let source = game.card(source_id);
    game.cards_in_zone(ZoneType::Battlefield, attacker_controller)
        .iter()
        .copied()
        .filter(|&cid| game.card(cid).is_creature())
        .filter(|&cid| {
            game.card(cid)
                .damage_history
                .has_attacked_this_turn(attacked)
        })
        .any(|cid| matches_valid_card(restriction, game.card(cid), source))
}

fn highest_life(game: &GameState) -> i32 {
    game.alive_players()
        .into_iter()
        .map(|pid| game.player(pid).life)
        .max()
        .unwrap_or(i32::MIN)
}

fn lowest_life(game: &GameState) -> i32 {
    game.alive_players()
        .into_iter()
        .map(|pid| game.player(pid).life)
        .min()
        .unwrap_or(i32::MAX)
}

fn defined_players_for_property(
    game: &GameState,
    _source_id: CardId,
    controller: PlayerId,
    sa: &SpellAbility,
    property: &str,
) -> Vec<PlayerId> {
    if property == "OriginalHostRemembered" {
        return sa
            .original_host
            .map(|host| game.card(host).remembered_players.clone())
            .unwrap_or_default();
    }
    ability_utils::resolve_defined_players_with_sa(property, sa, controller, game)
}

pub fn player_has_property(
    player: PlayerId,
    property: &str,
    game: &GameState,
    source_id: CardId,
    controller: PlayerId,
    sa: &SpellAbility,
) -> bool {
    let source = game.card(source_id);
    let player_state = game.player(player);

    if property == "Activator" {
        return player == source.controller;
    } else if property == "You" {
        return player == controller;
    } else if property == "Opponent" {
        return player != controller
            && crate::player::player_predicates::is_opponent_of(game, player, controller);
    } else if let Some(rest) = property.strip_prefix("OpponentOf ") {
        return defined_players_for_property(game, source_id, controller, sa, rest)
            .into_iter()
            .all(|other| {
                player != other
                    && crate::player::player_predicates::is_opponent_of(game, player, other)
            });
    } else if let Some(rest) = property.strip_prefix("PlayerUID_") {
        return rest.trim().parse::<u32>().ok() == Some(player.0);
    } else if property == "YourTeam" {
        return crate::player::player_predicates::same_team(game, player, controller);
    } else if property == "Allies" {
        return player != controller
            && !crate::player::player_predicates::is_opponent_of(game, player, controller);
    } else if property == "Active" {
        return player == game.active_player();
    } else if property == "NonActive" {
        return player != game.active_player();
    } else if property == "OpponentToActive" {
        let active = game.active_player();
        return player != active
            && crate::player::player_predicates::is_opponent_of(game, player, active);
    } else if property == "Other" {
        return player != controller;
    } else if property == "CardOwner" {
        return player == source.owner;
    } else if property == "withMostLife" || property == "Player.withMostLife" {
        return player_state.life == highest_life(game);
    } else if property == "withLeastLife" || property == "Player.withLeastLife" {
        return player_state.life == lowest_life(game);
    } else if property == "descended" {
        return game.player_has_descended(player);
    } else if property == "committedCrimeThisTurn" {
        return player_state.committed_crime_this_turn > 0;
    } else if property == "isMonarch" {
        return game.monarch == Some(player);
    } else if property == "hasInitiative" {
        return game.initiative_holder == Some(player);
    } else if property == "hasBlessing" {
        return game.player_has_blessing(player);
    } else if property == "CanBeEnchantedBy" {
        return crate::player::player_predicates::can_be_attached(game, player);
    } else if let Some(props) = property.strip_prefix("damageDoneSingleSource ") {
        let max_damage = game
            .cards
            .iter()
            .filter(|card| card.controller == controller)
            .map(|card| card.total_damage_done_this_turn)
            .max()
            .unwrap_or(0);
        if props.len() < 2 {
            return false;
        }
        return compare_expr(
            max_damage,
            &format!(
                "{}{}",
                &props[..2],
                eval_amount(game, source_id, sa, &props[2..])
            ),
        );
    } else if let Some(defined) = property.strip_prefix("wasDealtCombatDamageThisCombatBy ") {
        return ability_utils::get_defined_cards(game, Some(source_id), defined, Some(controller))
            .into_iter()
            .any(|cid| {
                game.card(cid)
                    .damage_history
                    .damage_done_this_turn
                    .iter()
                    .any(|instance| {
                        instance.is_combat && instance.target == Some(TrackedEntity::Player(player))
                    })
            });
    } else if let Some(defined) = property.strip_prefix("wasDealtDamageThisGameBy ") {
        return ability_utils::get_defined_cards(game, Some(source_id), defined, Some(controller))
            .into_iter()
            .any(|cid| {
                game.card(cid)
                    .damage_history
                    .damage_done_this_turn
                    .iter()
                    .any(|instance| instance.target == Some(TrackedEntity::Player(player)))
            });
    } else if property.starts_with("wasDealt") {
        let combat = if property.contains("CombatDamage") {
            Some(true)
        } else {
            None
        };
        let mut valid_card = None;
        let mut comparator = "GE".to_string();
        let mut rhs = 1;

        if property.contains("ThisTurnBy") {
            let parts: Vec<_> = property.split_whitespace().collect();
            let mut idx = 2;
            if property.contains("BySource") {
                idx -= 1;
            } else {
                valid_card = parts.get(1).copied();
            }
            if let Some(comp) = parts.get(idx) {
                comparator = comp[..2].to_string();
                rhs = eval_amount(game, source_id, sa, &comp[2..]);
            }
        }

        let result = if property.contains("BySource") {
            source
                .damage_history
                .damage_done_this_turn
                .iter()
                .filter(|instance| combat.is_none_or(|value| instance.is_combat == value))
                .filter(|instance| instance.target == Some(TrackedEntity::Player(player)))
                .count() as i32
        } else {
            game.cards
                .iter()
                .filter(|card| {
                    valid_card.is_none_or(|filter| matches_valid_card(filter, card, source))
                })
                .flat_map(|card| card.damage_history.damage_done_this_turn.iter())
                .filter(|instance| combat.is_none_or(|value| instance.is_combat == value))
                .filter(|instance| instance.target == Some(TrackedEntity::Player(player)))
                .count() as i32
        };
        return compare_expr(result, &format!("{comparator}{rhs}"));
    } else if property == "attackedBySourceThisCombat" {
        return source.attacking_player == Some(player);
    } else if property == "attackedBySourceThisTurn" {
        return source
            .damage_history
            .has_attacked_this_turn(TrackedEntity::Player(player));
    } else if property == "Attacking" {
        return game
            .cards
            .iter()
            .any(|card| card.controller == player && card.attacking_player.is_some());
    } else if property == "Defending" {
        return game
            .cards
            .iter()
            .any(|card| card.attacking_player == Some(player));
    } else if property.starts_with("LostLifeThisTurn") {
        let compare = property
            .split_once(' ')
            .map(|(_, expr)| expr)
            .unwrap_or("GE1");
        return compare_expr(player_state.life_lost_this_turn, compare);
    } else if property == "TappedLandForManaThisTurn" {
        return player_state.tapped_land_for_mana_this_turn;
    } else if property == "CardsInHandAtBeginningOfTurn" {
        return player_state.num_cards_in_hand_started_this_turn_with > 0;
    } else if property == "IsRemembered" {
        return source.remembered_players.contains(&player);
    } else if property == "IsRememberedOrController" {
        return source.remembered_players.contains(&player)
            || source
                .remembered_cards
                .iter()
                .any(|&cid| game.card(cid).controller == player);
    } else if property == "IsTriggerRemembered" {
        return sa.trigger_remembered.iter().any(
            |value| matches!(value, crate::event::AbilityValue::Player(pid) if *pid == player),
        );
    } else if property == "EnchantedBy" {
        return source.attached_to_player == Some(player)
            || game
                .cards_in_zone(ZoneType::Battlefield, player)
                .iter()
                .any(|&cid| source.attached_to == Some(cid));
    } else if property == "EnchantedController" {
        return source
            .attached_to
            .is_some_and(|attached| game.card(attached).controller == player);
    } else if property == "Chosen" {
        return source.chosen_player == Some(player);
    } else if property == "NotedDefender" {
        let tracker = player_state
            .draft_notes
            .get("Cogwork Tracker")
            .map(String::as_str)
            .unwrap_or("");
        return tracker
            .split(',')
            .any(|entry| entry.trim() == player.0.to_string());
    } else if property.starts_with("life") {
        let amount = eval_amount(game, source_id, sa, property.get(6..).unwrap_or_default());
        let compare = &property[4..6];
        return compare_expr(player_state.life, &format!("{compare}{amount}"));
    } else if property == "IsPoisoned" {
        return player_state.poison_counters > 0;
    } else if property == "IsCorrupted" {
        return player_state.poison_counters > 2;
    } else if property == "NoSpeed" {
        return player_state.speed == 0;
    } else if property == "MaxSpeed" {
        return player_state.speed == 4;
    } else if property == "targetedBy" {
        return sa.target_chosen.target_player == Some(player);
    } else if let Some(rest) = property.strip_prefix("controls") {
        let parts = split_escaped_underscores(rest);
        let restriction = parts.first().map(String::as_str).unwrap_or("");
        let comparator = parts.get(1).map(String::as_str).unwrap_or("GE1");
        let count =
            player_controls_matching(game, player, ZoneType::Battlefield, restriction, source_id)
                as i32;
        return compare_expr(count, comparator);
    } else if let Some(rest) = property.strip_prefix("HasCardsIn") {
        let parts: Vec<_> = rest.split('_').collect();
        if parts.len() < 3 {
            return false;
        }
        let Some(zone) = parse_zone_type(parts[0]) else {
            return false;
        };
        let count = player_controls_matching(game, player, zone, parts[1], source_id) as i32;
        let rhs = eval_amount(game, source_id, sa, &parts[2][2..]);
        return compare_expr(count, &format!("{}{}", &parts[2][..2], rhs));
    } else if property.starts_with("withMore") {
        let (left, right) = property.split_once("sThan").unwrap_or((property, ""));
        let card_type = &left[8..];
        let compared_player = if right == "Active" {
            game.active_player()
        } else {
            controller
        };
        return count_type(
            game,
            game.cards_in_zone(ZoneType::Battlefield, player)
                .iter()
                .copied(),
            card_type,
            source_id,
        ) > count_type(
            game,
            game.cards_in_zone(ZoneType::Battlefield, compared_player)
                .iter()
                .copied(),
            card_type,
            source_id,
        );
    } else if property.starts_with("withAtLeast") {
        let amount = property[11..12].parse::<usize>().unwrap_or(0);
        let (left, right) = property.split_once("sThan").unwrap_or((property, ""));
        let card_type = left
            .split_once("More")
            .map(|(_, t)| t)
            .unwrap_or("")
            .trim_end_matches('s');
        let compared_player = if right == "Active" {
            game.active_player()
        } else {
            controller
        };
        let theirs = count_type(
            game,
            game.cards_in_zone(ZoneType::Battlefield, player)
                .iter()
                .copied(),
            card_type,
            source_id,
        );
        let yours = count_type(
            game,
            game.cards_in_zone(ZoneType::Battlefield, compared_player)
                .iter()
                .copied(),
            card_type,
            source_id,
        );
        return theirs >= yours + amount;
    } else if let Some(rest) = property.strip_prefix("hasMore") {
        let compared_player = if property.contains("ThanActive") {
            game.active_player()
        } else {
            controller
        };
        if rest.starts_with("Life") {
            return player_state.life > game.player(compared_player).life;
        } else if rest.starts_with("CardsInHand") {
            return game.cards_in_zone(ZoneType::Hand, player).len()
                > game.cards_in_zone(ZoneType::Hand, compared_player).len();
        }
    } else if let Some(rest) = property.strip_prefix("hasFewer") {
        let (left, right) = rest.split_once("Than").unwrap_or((rest, ""));
        let card_type = left
            .split_once("sIn")
            .map(|(prefix, _)| prefix)
            .unwrap_or("");
        let compared_player = if right == "Active" {
            game.active_player()
        } else {
            controller
        };
        let zone = if rest.starts_with("CreaturesInYard") {
            ZoneType::Graveyard
        } else {
            ZoneType::Battlefield
        };
        return count_type(
            game,
            game.cards_in_zone(zone, player).iter().copied(),
            card_type,
            source_id,
        ) < count_type(
            game,
            game.cards_in_zone(zone, compared_player).iter().copied(),
            card_type,
            source_id,
        );
    } else if let Some(kind) = property.strip_prefix("withMost") {
        if kind == "Life" {
            return player_state.life == highest_life(game);
        } else if kind == "PermanentInPlay" {
            let counts: Vec<_> = game
                .alive_players()
                .into_iter()
                .map(|pid| (pid, game.cards_in_zone(ZoneType::Battlefield, pid).len()))
                .collect();
            let max = counts.iter().map(|(_, count)| *count).max().unwrap_or(0);
            return counts.iter().filter(|(_, count)| *count == max).count() == 1
                && counts
                    .iter()
                    .any(|(pid, count)| *pid == player && *count == max);
        } else if kind == "CardsInHand" {
            let largest = game
                .alive_players()
                .into_iter()
                .max_by_key(|&pid| game.cards_in_zone(ZoneType::Hand, pid).len());
            return largest == Some(player);
        } else if let Some(mut card_type) = kind.strip_prefix("Type") {
            let check_only = card_type.ends_with("Only");
            if check_only {
                card_type = &card_type[..card_type.len() - 4];
            }
            let mut best = 0usize;
            let mut leaders = Vec::new();
            for pid in game.alive_players() {
                let count = count_type(
                    game,
                    game.cards_in_zone(ZoneType::Battlefield, pid)
                        .iter()
                        .copied(),
                    card_type,
                    source_id,
                );
                if count > best {
                    best = count;
                    leaders.clear();
                }
                if count == best {
                    leaders.push(pid);
                }
            }
            if check_only && leaders.len() != 1 {
                return false;
            }
            return leaders.contains(&player);
        }
    } else if let Some(kind) = property.strip_prefix("withLowest") {
        if kind == "Life" {
            return player_state.life == lowest_life(game);
        }
    } else if property.starts_with("Triggered") || property == "OriginalHostRemembered" {
        return defined_players_for_property(game, source_id, controller, sa, property)
            .contains(&player);
    } else if property == "castSpellThisTurn" {
        return player_state.spells_cast_this_turn > 0;
    } else if property == "attackedWithCreaturesThisTurn" {
        return !player_state.attacked_players_this_turn.is_empty();
    } else if let Some(restriction) = property.strip_prefix("wasAttackedThisTurnBy ") {
        return any_attacker_matches(
            game,
            controller,
            TrackedEntity::Player(player),
            restriction,
            source_id,
        );
    } else if property == "attackedYouTheirCurrentTurn" {
        return player_state
            .attacked_players_this_turn
            .contains(&controller);
    } else if let Some(card_type) = property.strip_prefix("attackedYouCtrlTheirCurrentTurn_") {
        let selector = cached_compiled_selector(card_type);
        return game
            .cards_in_zone(ZoneType::Battlefield, controller)
            .iter()
            .copied()
            .filter(|&cid| {
                matches_valid_card_selector_in_game(&selector, game.card(cid), source, game)
            })
            .any(|cid| {
                any_attacker_matches(game, player, TrackedEntity::Card(cid), "Card", source_id)
            });
    } else if property == "attackedYouTheirLastTurn" {
        return player_state
            .attacked_players_last_turn
            .contains(&controller);
    } else if property == "BeenAttackedThisCombat" {
        return game.alive_players().into_iter().any(|pid| {
            game.player(pid)
                .attacked_players_this_combat
                .contains(&player)
        });
    } else if property == "VenturedThisTurn" {
        return player_state.ventured_this_turn > 0;
    } else if property.starts_with("Condition") {
        return crate::svar::player_condition_matches(
            player, property, game, source_id, controller, sa,
        );
    } else if let Some(key) = property.strip_prefix("NotedFor") {
        return player_state
            .notes
            .get(key)
            .into_iter()
            .flatten()
            .any(|note| {
                note == &format!("Name:{}", source.card_name)
                    || note == &format!("Id:{}", source.id.0)
            });
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card::Card;
    use crate::event::AbilityValue;
    use forge_foundation::{CardTypeLine, ColorSet, ManaCost};

    fn add_source(game: &mut GameState, controller: PlayerId) -> CardId {
        game.create_card(Card::new(
            CardId(0),
            "Source".to_string(),
            controller,
            CardTypeLine::parse("Artifact"),
            ManaCost::parse("0"),
            ColorSet::COLORLESS,
            None,
            None,
            vec![],
            vec![],
        ))
    }

    #[test]
    fn matches_opponent_of_defined_player() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let source_id = add_source(&mut game, PlayerId(0));
        let sa = SpellAbility::new_empty(Some(source_id), PlayerId(0));

        assert!(player_has_property(
            PlayerId(1),
            "OpponentOf You",
            &game,
            source_id,
            PlayerId(0),
            &sa,
        ));
        assert!(!player_has_property(
            PlayerId(0),
            "OpponentOf You",
            &game,
            source_id,
            PlayerId(0),
            &sa,
        ));
    }

    #[test]
    fn matches_trigger_remembered_player() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let source_id = add_source(&mut game, PlayerId(0));
        let mut sa = SpellAbility::new_empty(Some(source_id), PlayerId(0));
        sa.trigger_remembered = vec![AbilityValue::Player(PlayerId(1))];

        assert!(player_has_property(
            PlayerId(1),
            "IsTriggerRemembered",
            &game,
            source_id,
            PlayerId(0),
            &sa,
        ));
        assert!(!player_has_property(
            PlayerId(0),
            "IsTriggerRemembered",
            &game,
            source_id,
            PlayerId(0),
            &sa,
        ));
    }

    #[test]
    fn matches_condition_property() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let source_id = add_source(&mut game, PlayerId(0));
        let sa = SpellAbility::new_empty(Some(source_id), PlayerId(0));

        assert!(player_has_property(
            PlayerId(0),
            "ConditionGE20 LifeTotal",
            &game,
            source_id,
            PlayerId(0),
            &sa,
        ));
        assert!(!player_has_property(
            PlayerId(1),
            "ConditionGT20 LifeTotal",
            &game,
            source_id,
            PlayerId(0),
            &sa,
        ));
    }
}
