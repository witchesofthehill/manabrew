use super::*;
use crate::cost::CostPart;

impl GameLoop {
    pub(crate) fn mana_source_available_for_payment(
        game: &GameState,
        player: PlayerId,
        card_id: CardId,
    ) -> bool {
        Self::mana_source_available_for_payment_with_reserved(game, player, card_id, &[])
    }

    pub(crate) fn mana_source_available_for_payment_with_reserved(
        game: &GameState,
        player: PlayerId,
        card_id: CardId,
        reserved_sacrifices: &[CardId],
    ) -> bool {
        Self::mana_source_available_for_payment_with_reserved_and_reuse(
            game,
            player,
            card_id,
            reserved_sacrifices,
            false,
        )
    }

    pub(crate) fn mana_source_available_for_payment_with_reserved_and_reuse(
        game: &GameState,
        player: PlayerId,
        card_id: CardId,
        reserved_sacrifices: &[CardId],
        allow_reserved_source_reuse: bool,
    ) -> bool {
        let card = game.card(card_id);
        let summoning_sick = card.is_creature() && card.summoning_sick && !card.has_haste();

        let has_usable_mana_ability = card.activated_abilities.iter().any(|ab| {
            let needs_tap = ab
                .cost
                .parts
                .iter()
                .any(|part| matches!(part, CostPart::Tap));
            ab.is_mana_ability
                && (!card.tapped || !needs_tap)
                && (!summoning_sick || !needs_tap)
                && Self::mana_ability_available_for_payment_with_reserved_and_reuse(
                    game,
                    player,
                    card_id,
                    ab,
                    reserved_sacrifices,
                    allow_reserved_source_reuse,
                )
        });

        has_usable_mana_ability
    }

    pub(crate) fn mana_ability_available_for_payment_with_reserved(
        game: &GameState,
        player: PlayerId,
        card_id: CardId,
        ab: &crate::ability::activated::ActivatedAbility,
        reserved_sacrifices: &[CardId],
    ) -> bool {
        Self::mana_ability_available_for_payment_with_reserved_and_reuse(
            game,
            player,
            card_id,
            ab,
            reserved_sacrifices,
            false,
        )
    }

    pub(crate) fn mana_ability_available_for_payment_with_reserved_and_reuse(
        game: &GameState,
        player: PlayerId,
        card_id: CardId,
        ab: &crate::ability::activated::ActivatedAbility,
        reserved_sacrifices: &[CardId],
        allow_reserved_source_reuse: bool,
    ) -> bool {
        if !crate::cost::can_pay_ignoring_mana(&ab.cost, game, card_id, player) {
            return false;
        }

        if !crate::mana::mana_ability_meets_script_requirements(game, card_id, ab) {
            return false;
        }

        for part in &ab.cost.parts {
            if let CostPart::Sacrifice {
                type_filter,
                amount,
            } = part
            {
                if type_filter == "CARDNAME" {
                    if amount.resolve(game, card_id, player) > 1
                        || (reserved_sacrifices.contains(&card_id) && !allow_reserved_source_reuse)
                    {
                        return false;
                    }
                } else {
                    let mut targets = crate::cost::get_sacrifice_targets_for_cost(
                        game,
                        player,
                        type_filter,
                        None,
                    );
                    if !allow_reserved_source_reuse {
                        targets.retain(|cid| !reserved_sacrifices.contains(cid));
                    }
                    if (targets.len() as i32) < amount.resolve(game, card_id, player) {
                        return false;
                    }
                }
            }
        }

        true
    }

    pub(crate) fn action_space(
        &self,
        game: &GameState,
        player: PlayerId,
        is_main_phase: bool,
    ) -> crate::agent::PriorityActionSpace {
        let _params_lookup_scope =
            crate::perf::ParamsLookupScopeGuard::enter(crate::perf::ParamsLookupScope::ActionSpace);
        let can_play_sorcery =
            is_main_phase && player == game.active_player() && game.stack.is_empty();
        let must_be_instant = !can_play_sorcery;

        let playable = {
            let _params_lookup_scope = crate::perf::ParamsLookupScopeGuard::enter(
                crate::perf::ParamsLookupScope::ActionSpacePlayable,
            );
            self.get_playable_cards(game, player, must_be_instant)
        };
        let activatable: Vec<crate::agent::ActivatableAction> = {
            let _params_lookup_scope = crate::perf::ParamsLookupScopeGuard::enter(
                crate::perf::ParamsLookupScope::ActionSpaceActivatable,
            );
            self.get_activatable_abilities(game, player, can_play_sorcery)
                .into_iter()
                .map(|(card_id, ability_index)| {
                    let card = game.card(card_id);
                    let ability = card
                        .activated_abilities
                        .iter()
                        .find(|a| a.ability_index == ability_index);
                    let (produced_mana, produced_mana_amount) = ability
                        .map(|a| {
                            crate::mana::mana_ability_prompt_metadata(game, card_id, player, a)
                        })
                        .unwrap_or((None, None));
                    crate::agent::ActivatableAction {
                        card_id,
                        ability_index,
                        description: ability
                            .map(|a| a.display_description(&card.card_name))
                            .unwrap_or_default(),
                        cost: ability.and_then(|a| a.cost_string()),
                        is_mana_ability: ability.map(|a| a.is_mana_ability).unwrap_or(false),
                        produced_mana,
                        produced_mana_amount,
                    }
                })
                .collect()
        };

        let tappable_lands: Vec<CardId> = {
            let _params_lookup_scope = crate::perf::ParamsLookupScopeGuard::enter(
                crate::perf::ParamsLookupScope::ActionSpaceManaSource,
            );
            game.cards_in_zone(ZoneType::Battlefield, player)
                .iter()
                .copied()
                .filter(|&cid| Self::mana_source_available_for_payment(game, player, cid))
                .collect()
        };

        let untappable_lands: Vec<CardId> = {
            let _params_lookup_scope = crate::perf::ParamsLookupScopeGuard::enter(
                crate::perf::ParamsLookupScope::ActionSpaceUntap,
            );
            self.undoable_mana_sources(player)
        };

        let mut mana_abilities = Vec::new();
        for &card_id in &tappable_lands {
            let card = game.card(card_id);
            for ability in card
                .activated_abilities
                .iter()
                .filter(|a| a.is_mana_ability)
            {
                let (produced_mana, produced_mana_amount) =
                    crate::mana::mana_ability_prompt_metadata(game, card_id, player, ability);
                mana_abilities.push(crate::agent::ActivatableAction {
                    card_id,
                    ability_index: ability.ability_index,
                    description: ability.display_description(&card.card_name),
                    cost: ability.cost_string(),
                    is_mana_ability: true,
                    produced_mana,
                    produced_mana_amount,
                });
            }
        }

        crate::agent::PriorityActionSpace {
            playable,
            tappable_lands,
            untappable_lands,
            activatable,
            mana_abilities,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ability::activated::parse_activated_ability;
    use crate::card::Card;
    use forge_foundation::{CardTypeLine, ColorSet, ManaCost};

    fn make_card(
        id: u32,
        owner: PlayerId,
        name: &str,
        type_line: &str,
        abilities: Vec<&str>,
    ) -> Card {
        let mut card = Card::new(
            CardId(id),
            name.to_string(),
            owner,
            CardTypeLine::parse(type_line),
            ManaCost::zero(),
            ColorSet::COLORLESS,
            None,
            None,
            vec![],
            vec![],
        );
        card.abilities = abilities.iter().map(|s| s.to_string()).collect();
        card.activated_abilities = abilities
            .iter()
            .enumerate()
            .filter_map(|(i, raw)| parse_activated_ability(raw, i))
            .collect();
        card
    }

    #[test]
    fn tapped_non_tap_mana_source_is_available_for_payment() {
        let player = PlayerId(0);
        let mut game = GameState::new(&["P1", "P2"], 20);
        let spawn = game.create_card(make_card(
            1,
            player,
            "Eldrazi Spawn Token",
            "Creature Eldrazi Spawn",
            vec!["AB$ Mana | Cost$ Sac<1/CARDNAME> | Produced$ C | Amount$ 1"],
        ));

        game.add_card_to_zone(ZoneType::Battlefield, player, spawn);
        game.card_mut(spawn).zone = ZoneType::Battlefield;
        game.card_mut(spawn).tapped = true;

        assert!(GameLoop::mana_source_available_for_payment(
            &game, player, spawn
        ));
    }

    #[test]
    fn reserved_cardname_mana_source_can_be_reused_for_activated_cost_payment() {
        let player = PlayerId(0);
        let mut game = GameState::new(&["P1", "P2"], 20);
        let spawn = game.create_card(make_card(
            1,
            player,
            "Eldrazi Spawn Token",
            "Creature Eldrazi Spawn",
            vec!["AB$ Mana | Cost$ Sac<1/CARDNAME> | Produced$ C | Amount$ 1"],
        ));

        game.add_card_to_zone(ZoneType::Battlefield, player, spawn);
        game.card_mut(spawn).zone = ZoneType::Battlefield;

        let mana_ability = game.card(spawn).activated_abilities[0].clone();
        assert!(
            !GameLoop::mana_ability_available_for_payment_with_reserved_and_reuse(
                &game,
                player,
                spawn,
                &mana_ability,
                &[spawn],
                false,
            )
        );
        assert!(
            GameLoop::mana_ability_available_for_payment_with_reserved_and_reuse(
                &game,
                player,
                spawn,
                &mana_ability,
                &[spawn],
                true,
            )
        );
    }

    #[test]
    fn untapped_non_mana_land_is_not_available_for_payment() {
        let player = PlayerId(0);
        let mut game = GameState::new(&["P1", "P2"], 20);
        let vista = game.create_card(make_card(
            1,
            player,
            "Prismatic Vista",
            "Land",
            vec!["AB$ ChangeZone | Cost$ T PayLife<1> Sac<1/CARDNAME> | Origin$ Library | Destination$ Battlefield | ChangeType$ Land.Basic"],
        ));

        game.add_card_to_zone(ZoneType::Battlefield, player, vista);
        game.card_mut(vista).zone = ZoneType::Battlefield;

        assert!(!GameLoop::mana_source_available_for_payment(
            &game, player, vista
        ));
    }
}
