use super::*;

use crate::cost::cost_adjustment::apply_cost_reductions;

impl GameLoop {
    pub(super) fn mana_from_cost(cost: &crate::cost::Cost) -> forge_foundation::ManaCost {
        let mut out = forge_foundation::ManaCost::generic(0);
        for part in &cost.parts {
            if let CostPart::Mana { cost: mc, .. } = part {
                out = out.add(mc);
            }
        }
        out
    }

    fn can_use_source_level_mana_fallback(
        game: &GameState,
        player: PlayerId,
        available_mana: &crate::mana::mana_pool::ManaPool,
    ) -> bool {
        let has_all_color_source = available_mana
            .source_colors
            .as_ref()
            .is_some_and(|sources| {
                sources.iter().any(|&source| {
                    (source & forge_foundation::mana::ManaAtom::COLORS_SUPERPOSITION)
                        == forge_foundation::mana::ManaAtom::COLORS_SUPERPOSITION
                })
            });
        has_all_color_source || crate::mana::has_replacement_adjusted_available_mana(game, player)
    }

    /// Get cards the active player can play.
    pub(crate) fn get_playable_cards(
        &self,
        game: &GameState,
        player: PlayerId,
        must_be_instant: bool,
    ) -> Vec<crate::agent::PlayOption> {
        let mut playable = Vec::new();
        let hand = game.cards_in_zone(ZoneType::Hand, player);
        let has_flash_permission = |card_id: CardId| {
            let card = game.card(card_id);
            card.type_line.is_instant()
                || card.has_keyword("Flash")
                || card.get_offering_type().is_some()
                || crate::staticability::static_ability_cast_with_flash::any_with_flash_for_card(
                    &game.cards,
                    card,
                    player,
                )
        };
        let can_may_play_from_static = |card_id: CardId| {
            let card = game.card(card_id);
            game.cards_in_zone(ZoneType::Battlefield, player)
                .iter()
                .chain(game.cards_in_zone(ZoneType::Command, player).iter())
                .any(|&source_id| {
                    let source = game.card(source_id);
                    source.static_abilities.iter().any(|sa| {
                        crate::staticability::static_ability_continuous::can_play_or_granted(
                            sa, source, card, game,
                        )
                    })
                })
        };
        // First MayPlay alt-cost (e.g. Airbend's `MayPlayAltManaCost$ 2`)
        // granted to `card_id`. Returns the cost string if any.
        let may_play_alt_cost = |card_id: CardId| -> Option<String> {
            let card = game.card(card_id);
            game.cards_in_zone(ZoneType::Battlefield, player)
                .iter()
                .chain(game.cards_in_zone(ZoneType::Command, player).iter())
                .find_map(|&source_id| {
                    let source = game.card(source_id);
                    source.static_abilities.iter().find_map(|sa| {
                        crate::staticability::static_ability_continuous::may_play_alt_mana_cost(
                            sa, source, card, game,
                        )
                    })
                })
        };
        // Count distinct MayPlay statics that grant permission to cast
        // `card_id`. Java's `GameActionUtil.getMayPlaySpellOptions` enumerates
        // one alternative SA per `CardPlayOption` returned by
        // `source.mayPlay(activator)`, so the same exiled card can produce
        // multiple play options when several statics grant permission (e.g.
        // multiple airbend Effects each remembering it).
        let count_may_play_grants = |card_id: CardId| -> usize {
            let card = game.card(card_id);
            game.cards_in_zone(ZoneType::Battlefield, player)
                .iter()
                .chain(game.cards_in_zone(ZoneType::Command, player).iter())
                .map(|&source_id| {
                    let source = game.card(source_id);
                    source
                        .static_abilities
                        .iter()
                        .filter(|sa| {
                            crate::staticability::static_ability_continuous::can_play_or_granted(
                                sa, source, card, game,
                            )
                        })
                        .count()
                })
                .sum()
        };
        let chosen_types_by_source: std::collections::HashMap<CardId, String> = game
            .cards
            .iter()
            .filter_map(|c| c.chosen_type.clone().map(|chosen| (c.id, chosen)))
            .collect();

        for &card_id in hand {
            let card = game.card(card_id);
            if card.is_land() {
                if crate::staticability::static_ability_cant_be_cast::cant_play_land_ability(
                    &game.cards,
                    card,
                    player,
                ) {
                    continue;
                }
                let land_sa = SpellAbility::new_land(Some(card_id), player);
                if !must_be_instant && crate::spellability::land_ability::can_play(&land_sa, game) {
                    playable.push(crate::agent::PlayOption {
                        card_id,
                        mode: crate::agent::PlayCardMode::Normal,
                        alt_cost_index: 0,
                    });
                    if card
                        .other_part
                        .as_ref()
                        .is_some_and(|other| other.type_line.is_land())
                    {
                        playable.push(crate::agent::PlayOption {
                            card_id,
                            mode: crate::agent::PlayCardMode::BackFaceLand,
                            alt_cost_index: 0,
                        });
                    }
                }
            } else {
                // MDFC: emit both the back-face LAND and the front-face SPELL
                // (Java `getPossibleActions`).
                if card
                    .other_part
                    .as_ref()
                    .is_some_and(|other| other.type_line.is_land())
                {
                    let cant_play_land =
                        crate::staticability::static_ability_cant_be_cast::cant_play_land_ability(
                            &game.cards,
                            card,
                            player,
                        );
                    if !cant_play_land {
                        let land_sa = SpellAbility::new_land(Some(card_id), player);
                        if !must_be_instant
                            && crate::spellability::land_ability::can_play(&land_sa, game)
                        {
                            playable.push(crate::agent::PlayOption {
                                card_id,
                                mode: crate::agent::PlayCardMode::BackFaceLand,
                                alt_cost_index: 0,
                            });
                        }
                    }
                }
                let cast_sa =
                    crate::spellability::build_spell_ability_for_card_cast(game, card_id, player);
                if crate::staticability::static_ability_cant_be_cast::cant_be_cast_ability_in_context(
                    &game.cards,
                    &cast_sa,
                    card,
                    player,
                    Some(game),
                ) {
                    continue;
                }

                if must_be_instant && !has_flash_permission(card_id) {
                    continue;
                }

                // Spell-level checks: not on battlefield, no split second
                if !crate::spellability::spell::can_play(&cast_sa, game) {
                    continue;
                }

                // NonStackingEffect is an AI hint in Java (AiController), not a game rule.
                // Do NOT filter here — let the agent decide whether to cast duplicates.

                if let Some(ref tr) = cast_sa.target_restrictions {
                    let min_targets = tr.get_min_targets(game, &cast_sa);
                    if min_targets > 0
                        && !target_restrictions::has_candidates_in_spell_ability_chain(
                            game, player, &cast_sa,
                        )
                    {
                        continue;
                    }
                }

                // Check if we can pay the mana cost (normal or alternative).
                // Mirror Java's per-spell restriction filtering: mana sources
                // with RestrictValid$ that don't match the spell being cast
                // must not count toward availability.
                let payment_ctx = mana::ManaPaymentContext {
                    is_spell: true,
                    is_activated_ability: false,
                    sa_on_stack: false,
                    type_line: Some(card.type_line.clone()),
                    card_name: Some(card.card_name.clone()),
                    card_color: Some(card.color),
                    chosen_types_by_source: chosen_types_by_source.clone(),
                };
                let available_mana = mana::calculate_available_mana_with_context(
                    self.pool(player),
                    game,
                    player,
                    Some(card_id),
                    &[],
                    Some(&payment_ctx),
                );

                // Apply cost reduction/increase from static abilities
                let cost_adj = crate::cost::cost_adjustment::compute_cost_adjustment(
                    game,
                    card,
                    player,
                    ZoneType::Hand,
                );
                let raise_cost = crate::cost::cost_adjustment::compute_raise_cost_parts(
                    game,
                    card,
                    player,
                    ZoneType::Hand,
                );
                let raise_mana = raise_cost
                    .as_ref()
                    .map(Self::mana_from_cost)
                    .unwrap_or_else(|| forge_foundation::ManaCost::generic(0));

                // Check mana conversion for playability
                let any_color =
                    crate::staticability::static_ability_mana_convert::can_spend_mana_as_any_color(
                        &game.cards,
                        player,
                        card,
                    );

                // Check normal cost OR any alternative costs
                // For X-cost spells, check only the non-X portion (X=0 is valid)
                // Delve: reduce generic cost by number of graveyard cards
                // Convoke: reduce total cost by number of untapped creatures
                let normal_ok = {
                    let base = if card.mana_cost.count_x() > 0 {
                        cost_adj.apply(&card.mana_cost.without_x())
                    } else {
                        cost_adj.apply(&card.mana_cost)
                    };
                    let base = base.add(&raise_mana);
                    let payable_base =
                        crate::mana::apply_player_life_payment_keywords(game, player, &base);
                    // Phyrexian mana: check AIPhyrexianPayment to determine
                    // if life payment is allowed for this card. Uses greedy
                    // simulation matching Java's ComputerUtilMana behavior.
                    let has_phyrexian = payable_base.shards().iter().any(|s| s.is_phyrexian());
                    if has_phyrexian {
                        let phyrexian_life_allowed = match card.ai_phyrexian_payment.as_deref() {
                            Some("Never") => false,
                            Some(s) if s.starts_with("OnFatalDamage.") => {
                                let dmg: i32 = s[14..].parse().unwrap_or(0);
                                let opp = game.opponent_of(player);
                                game.player(opp).life <= dmg
                            }
                            _ => true,
                        };
                        if phyrexian_life_allowed {
                            crate::mana::can_pay_spell_mana_cost_for_action_space(
                                game,
                                self.pool(player),
                                player,
                                card_id,
                                &payable_base,
                                &payment_ctx,
                            )
                        } else {
                            let colored = payable_base.phyrexian_to_colored();
                            let reduced =
                                apply_cost_reductions(game, player, card_id, card, &colored);
                            if any_color {
                                available_mana.can_pay_any_color(&reduced)
                            } else {
                                available_mana.can_pay(&reduced)
                            }
                        }
                    } else {
                        let reduced =
                            apply_cost_reductions(game, player, card_id, card, &payable_base);
                        if any_color {
                            available_mana.can_pay_any_color(&reduced)
                        } else {
                            crate::mana::can_pay_spell_mana_cost_for_action_space(
                                game,
                                self.pool(player),
                                player,
                                card_id,
                                &reduced,
                                &payment_ctx,
                            )
                            // The incremental simulator mirrors payment choice order.
                            // If it misses an availability-only source (e.g.
                            // Any-color/static land-type or replacement-expanded
                            // mana), fall back to the source-level mask used by
                            // Java's action-space feasibility check.
                            || (Self::can_use_source_level_mana_fallback(
                                game,
                                player,
                                &available_mana,
                            ) && available_mana.can_pay(&reduced))
                        }
                    }
                };
                let room_right_split_ok = card.type_line.has_subtype("Room")
                    && card.svars.get("RoomRightSplitCost").is_some_and(|cost| {
                        let cost = forge_foundation::ManaCost::parse(cost);
                        let adjusted = cost_adj.apply(&cost).add(&raise_mana);
                        if any_color {
                            available_mana.can_pay_any_color(&adjusted)
                        } else {
                            available_mana.can_pay(&adjusted)
                        }
                    });

                // Spectacle: alt cost if opponent lost life this turn
                let spectacle_ok = if let Some(spec_cost_str) = card.get_spectacle_cost() {
                    let adjusted = cost_adj
                        .apply(&forge_foundation::ManaCost::parse(&spec_cost_str))
                        .add(&raise_mana);
                    game.player_opponents_lost_life_this_turn(player)
                        && available_mana.can_pay(&adjusted)
                } else {
                    false
                };

                // Evoke: alt cost for creatures. A card may have multiple Evoke
                // costs simultaneously — e.g. Mulldrifter (intrinsic Evoke {2}{U})
                // in P0's hand while Ashling, the Limitless grants Evoke {4} via
                // its `AddKeyword$ Evoke:4` static. Each is a separate alternative
                // cost in MTG, so enumerate them as separate playable entries to
                // match Java's count.
                // Keep the ORIGINAL index (position in `get_all_evoke_costs()`)
                // alongside the cost string, so each payable Evoke can be tied
                // to the exact keyword instance cast_spell uses at payment time.
                let evoke_payable: Vec<(usize, String)> = card
                    .get_all_evoke_costs()
                    .into_iter()
                    .enumerate()
                    .filter(|(_, cost_str)| {
                        let evoke_cost = crate::cost::parse_cost(cost_str);
                        let evoke_mana = Self::mana_from_cost(&evoke_cost);
                        let adjusted = cost_adj.apply(&evoke_mana).add(&raise_mana);
                        available_mana.can_pay(&adjusted)
                            && crate::cost::can_pay_ignoring_mana_for_spell(
                                &evoke_cost,
                                game,
                                card_id,
                                player,
                            )
                    })
                    .collect();
                let evoke_ok = !evoke_payable.is_empty();

                // Dash: alt cost
                let dash_ok = if let Some(dash_cost_str) = card.get_dash_cost() {
                    let adjusted = cost_adj
                        .apply(&forge_foundation::ManaCost::parse(&dash_cost_str))
                        .add(&raise_mana);
                    available_mana.can_pay(&adjusted)
                } else {
                    false
                };

                // Blitz: alt cost
                let blitz_ok = if let Some(blitz_cost_str) = card.get_blitz_cost() {
                    let adjusted = cost_adj
                        .apply(&forge_foundation::ManaCost::parse(&blitz_cost_str))
                        .add(&raise_mana);
                    available_mana.can_pay(&adjusted)
                } else {
                    false
                };

                // Overload: alt cost
                let overload_ok = if let Some(ovl_cost_str) = card.get_overload_cost() {
                    let adjusted = cost_adj
                        .apply(&forge_foundation::ManaCost::parse(&ovl_cost_str))
                        .add(&raise_mana);
                    available_mana.can_pay(&adjusted)
                } else {
                    false
                };

                // StaticAbilityAlternativeCost (Mode$ AlternativeCost)
                let static_alt_ok =
                    crate::staticability::static_ability_alternative_cost::alternative_costs(
                        game,
                        &game.cards,
                        &cast_sa,
                        card,
                        player,
                    )
                    .iter()
                    .any(|entry| {
                        let base = Self::mana_from_cost(&entry.cost);
                        let adjusted = cost_adj.apply(&base).add(&raise_mana);
                        available_mana.can_pay(&adjusted)
                            && crate::cost::can_pay_ignoring_mana_for_spell(
                                &entry.cost,
                                game,
                                card_id,
                                player,
                            )
                    });

                // Suspend: special action, pay suspend cost to exile with time counters
                // (Suspend is not a spell cast — cost reduction doesn't apply)
                let suspend_ok = if let Some((suspend_cost_str, _counters)) =
                    card.get_suspend_cost()
                {
                    available_mana.can_pay(&forge_foundation::ManaCost::parse(&suspend_cost_str))
                } else {
                    false
                };

                // Foretell: pay {2} to exile face-down from hand
                // (This is a special action, not a cast — always costs {2})
                let foretell_exile_ok = if card.get_foretell_cost().is_some() {
                    available_mana.can_pay(&forge_foundation::ManaCost::generic(2))
                } else {
                    false
                };

                // Emerge: alt cost minus sacrificed creature's mana value
                let emerge_ok = if let Some(emerge_cost_str) = card.get_emerge_cost() {
                    // Simplified: check if emerge base cost is affordable
                    // (actual cost reduction from sac'd creature computed at cast time)
                    let adjusted =
                        cost_adj.apply(&forge_foundation::ManaCost::parse(&emerge_cost_str));
                    available_mana.can_pay(&adjusted) || {
                        // Even if base emerge cost isn't payable, if we have creatures to sac
                        // the reduction might make it payable — approximate check
                        !game
                            .cards_in_zone(ZoneType::Battlefield, player)
                            .iter()
                            .filter(|&&cid| game.card(cid).is_creature())
                            .collect::<Vec<_>>()
                            .is_empty()
                    }
                } else {
                    false
                };

                // Spree: Java's `CostAdjustment` only folds `ModeCost$` into
                // the spell's cost AFTER modes are chosen, so playability
                // gates only the base cost. Mode affordability is rechecked
                // at cast time. Mirror that here — gating on
                // `base + cheapest mode` here makes Rust drop Spree spells
                // from the action space that Java still offers.

                // Offering: sacrifice a permanent of a type to reduce cost
                let offering_ok = if let Some(offering_type) = card.get_offering_type() {
                    let offering_type_lower = offering_type.to_lowercase();
                    // Check if we have a permanent of the right type to sacrifice
                    game.cards_in_zone(ZoneType::Battlefield, player)
                        .iter()
                        .any(|&cid| {
                            cid != card_id && {
                                let c = game.card(cid);
                                match offering_type_lower.as_str() {
                                    "creature" => c.is_creature(),
                                    "artifact" => c.type_line.is_artifact(),
                                    "enchantment" => c.type_line.is_enchantment(),
                                    "land" => c.type_line.is_land(),
                                    _ => c.type_line.has_subtype(&offering_type),
                                }
                            }
                        })
                } else {
                    false
                };

                // Morph: can cast any Morph card face-down for the morph generic cost
                let morph_ok = card.has_morph
                    && available_mana.can_pay(&forge_foundation::ManaCost::generic(
                        crate::spellability::MORPH_GENERIC_COST,
                    ));

                // Bestow: cast as an Aura for bestow cost.
                // Requires a valid creature target on the battlefield (Aura targeting).
                let bestow_ok = if let Some(bestow_cost_str) = card.get_bestow_cost() {
                    let adjusted =
                        cost_adj.apply(&forge_foundation::ManaCost::parse(&bestow_cost_str));
                    let can_afford = available_mana.can_pay(&adjusted);
                    // Bestow turns the creature into an Aura targeting a creature.
                    // Only offer bestow if at least one creature exists to enchant.
                    let has_creature_target = can_afford
                        && game
                            .cards
                            .iter()
                            .any(|c| c.zone == ZoneType::Battlefield && c.is_creature());
                    has_creature_target
                } else {
                    false
                };

                // Warp: alt cost for creatures
                let warp_ok = if let Some(warp_cost_str) = card.get_warp_cost() {
                    let adjusted = cost_adj
                        .apply(&forge_foundation::ManaCost::parse(&warp_cost_str))
                        .add(&raise_mana);
                    available_mana.can_pay(&adjusted)
                } else {
                    false
                };

                if !normal_ok
                    && !room_right_split_ok
                    && !spectacle_ok
                    && !evoke_ok
                    && !dash_ok
                    && !blitz_ok
                    && !overload_ok
                    && !static_alt_ok
                    && !suspend_ok
                    && !foretell_exile_ok
                    && !emerge_ok
                    && !offering_ok
                    && !morph_ok
                    && !bestow_ok
                    && !warp_ok
                {
                    continue;
                }

                // Check additional non-mana costs from SP$ line (e.g. Sac<1/Creature>,
                // BeholdExile<...>) through shared cost payability logic.
                // Use the _for_spell variant so CantSacrifice statics (e.g. Yasharn)
                // can properly evaluate ValidCause$ Spell restrictions.
                let sp_additional_ok = if let Some(sc) = card.action_spell_cost.as_ref() {
                    crate::cost::can_pay_ignoring_mana_for_spell(sc, game, card_id, player)
                } else {
                    true
                };
                let raised_additional_ok = if let Some(ref rc) = raise_cost {
                    crate::cost::can_pay_ignoring_mana_for_spell(rc, game, card_id, player)
                } else {
                    true
                };
                let additional_costs_ok = sp_additional_ok && raised_additional_ok;

                if additional_costs_ok {
                    // Only validate cast-time targets from SP$ abilities.
                    // Non-spell abilities (AB$/DB$/...) must not gate whether the card
                    // can be cast from hand. Otherwise cards with target-dependent
                    // activated abilities (e.g. Walking Bulwark) become incorrectly
                    // uncastable when no valid AB$ target exists.
                    let all_valid = card.action_spell_specs.iter().all(|spec| {
                        let dynamic_target_count = spec
                            .target_chain
                            .iter()
                            .any(|target| target.min_targets.is_none());
                        if dynamic_target_count {
                            return card.abilities.get(spec.ability_index).is_none_or(|ab| {
                                target_restrictions::has_candidates_in_chain(
                                    game,
                                    player,
                                    ab,
                                    Some(card_id),
                                )
                            });
                        }

                        spec.target_chain.iter().all(|target| {
                            target.min_targets.unwrap_or(1) <= 0
                                || target.target_restrictions.has_candidates(
                                    game,
                                    player,
                                    Some(card_id),
                                )
                        })
                    });
                    if all_valid {
                        if normal_ok {
                            playable.push(crate::agent::PlayOption {
                                card_id,
                                mode: crate::agent::PlayCardMode::Normal,
                                alt_cost_index: 0,
                            });
                        }
                        if room_right_split_ok {
                            playable.push(crate::agent::PlayOption {
                                card_id,
                                mode: crate::agent::PlayCardMode::RoomRightSplit,
                                alt_cost_index: 0,
                            });
                        }
                        if spectacle_ok {
                            playable.push(crate::agent::PlayOption {
                                card_id,
                                mode: crate::agent::PlayCardMode::Alternative(
                                    crate::spellability::AlternativeCost::Spectacle,
                                ),
                                alt_cost_index: 0,
                            });
                        }
                        // Push one Evoke entry per payable Evoke cost. PlayOption
                        // currently carries only an `Alternative(Evoke)` discriminant
                        // (no per-entry cost), but downstream cost selection will
                        // resolve the right cost at cast time. Java enumerates each
                        // Evoke cost separately for ActionSpace; matching that count
                        // is what keeps the deterministic agent's RNG aligned.
                        // `alt_cost_index` disambiguates multiple Evoke costs on
                        // the same card: intrinsic `Evoke {2}{U}` at index 0
                        // versus Ashling's granted `Evoke {4}` at index 1.
                        // cast_spell.rs uses the index to look up the correct
                        // cost in `get_all_evoke_costs()`.
                        //
                        // Java's ActionSpace sorts SAs by
                        // `sa.toUnsuppressedString()` which reflects the Evoke
                        // cost text, so the two Evoke variants interleave by
                        // cost-string order. Mirror that here by sorting payable
                        // entries by the cost string, but preserve the original
                        // index so cast-time lookup still hits the right one.
                        let mut ordered: Vec<(usize, String)> = evoke_payable.clone();
                        ordered.sort_by(|a, b| a.1.cmp(&b.1));
                        for (idx, _cost) in ordered {
                            playable.push(crate::agent::PlayOption {
                                card_id,
                                mode: crate::agent::PlayCardMode::Alternative(
                                    crate::spellability::AlternativeCost::Evoke,
                                ),
                                alt_cost_index: idx as u8,
                            });
                        }
                        if dash_ok {
                            playable.push(crate::agent::PlayOption {
                                card_id,
                                mode: crate::agent::PlayCardMode::Alternative(
                                    crate::spellability::AlternativeCost::Dash,
                                ),
                                alt_cost_index: 0,
                            });
                        }
                        if blitz_ok {
                            playable.push(crate::agent::PlayOption {
                                card_id,
                                mode: crate::agent::PlayCardMode::Alternative(
                                    crate::spellability::AlternativeCost::Blitz,
                                ),
                                alt_cost_index: 0,
                            });
                        }
                        if overload_ok {
                            playable.push(crate::agent::PlayOption {
                                card_id,
                                mode: crate::agent::PlayCardMode::Alternative(
                                    crate::spellability::AlternativeCost::Overload,
                                ),
                                alt_cost_index: 0,
                            });
                        }
                        if static_alt_ok {
                            playable.push(crate::agent::PlayOption {
                                card_id,
                                mode: crate::agent::PlayCardMode::StaticAlternative,
                                alt_cost_index: 0,
                            });
                        }
                        if emerge_ok {
                            playable.push(crate::agent::PlayOption {
                                card_id,
                                mode: crate::agent::PlayCardMode::Alternative(
                                    crate::spellability::AlternativeCost::Emerge,
                                ),
                                alt_cost_index: 0,
                            });
                        }
                        if suspend_ok {
                            playable.push(crate::agent::PlayOption {
                                card_id,
                                mode: crate::agent::PlayCardMode::Alternative(
                                    crate::spellability::AlternativeCost::Suspend,
                                ),
                                alt_cost_index: 0,
                            });
                        }
                        if foretell_exile_ok {
                            playable.push(crate::agent::PlayOption {
                                card_id,
                                mode: crate::agent::PlayCardMode::ForetellExile,
                                alt_cost_index: 0,
                            });
                        }
                        if morph_ok {
                            playable.push(crate::agent::PlayOption {
                                card_id,
                                mode: crate::agent::PlayCardMode::Alternative(
                                    crate::spellability::AlternativeCost::Morph,
                                ),
                                alt_cost_index: 0,
                            });
                        }
                        if bestow_ok {
                            playable.push(crate::agent::PlayOption {
                                card_id,
                                mode: crate::agent::PlayCardMode::Alternative(
                                    crate::spellability::AlternativeCost::Bestow,
                                ),
                                alt_cost_index: 0,
                            });
                        }
                        if warp_ok {
                            playable.push(crate::agent::PlayOption {
                                card_id,
                                mode: crate::agent::PlayCardMode::Alternative(
                                    crate::spellability::AlternativeCost::Warp,
                                ),
                                alt_cost_index: 0,
                            });
                        }
                    }
                }
            }
        }

        // Check graveyard for MayPlay$ static abilities (e.g. Walk-In Closet
        // "You may play lands from your graveyard"). Mirrors Java
        // GameActionUtil.canPlayCardMayPlay() for graveyard zone.
        if !must_be_instant {
            let gy_cards: Vec<CardId> = game.cards_in_zone(ZoneType::Graveyard, player).to_vec();
            for &card_id in &gy_cards {
                let card = game.card(card_id);
                if !card.is_land() {
                    continue; // For now, only handle land MayPlay from graveyard
                }
                let may_play_grants = game
                    .cards_in_zone(ZoneType::Battlefield, player)
                    .iter()
                    .chain(game.cards_in_zone(ZoneType::Command, player).iter())
                    .map(|&source_id| {
                        let source = game.card(source_id);
                        source
                            .static_abilities
                            .iter()
                            .filter(|sa| {
                                crate::staticability::static_ability_continuous::can_play_or_granted(
                                    sa, source, card, game,
                                )
                            })
                            .count()
                    })
                    .sum::<usize>();
                if may_play_grants > 0
                    && crate::spellability::land_ability::can_play(
                        &SpellAbility::new_land(Some(card_id), player),
                        game,
                    )
                {
                    for _ in 0..may_play_grants {
                        playable.push(crate::agent::PlayOption {
                            card_id,
                            mode: crate::agent::PlayCardMode::Normal,
                            alt_cost_index: 0,
                        });
                    }
                }
            }
        }

        // Check battlefield for Room enchantments with a locked door that can be
        // unlocked. Java models this as a `StaticAbilityApiBased` (`ST$ UnlockDoor`)
        // which falls through to the CastSpell branch in the harness, NOT as an
        // activated ability. We mirror that by putting it in `playable` with
        // `PlayCardMode::UnlockDoor`.
        if !must_be_instant {
            let bf_cards: Vec<CardId> = game.cards_in_zone(ZoneType::Battlefield, player).to_vec();
            for &card_id in &bf_cards {
                let card = game.card(card_id);
                if !card.type_line.has_subtype("Room") {
                    continue;
                }
                let fully_unlocked = card
                    .svars
                    .get("UnlockedRoomCount")
                    .and_then(|count| count.parse::<i32>().ok())
                    .is_some_and(|count| count >= 2)
                    || (!card.full_name.is_empty()
                        && card.card_name == card.full_name
                        && card.full_name.contains(" // "));
                if fully_unlocked {
                    continue;
                }
                // Find the synthetic UnlockDoor activated ability
                let has_unlock_ab = card.activated_abilities.iter().any(|ab| ab.is_unlock_door);
                if !has_unlock_ab {
                    continue;
                }
                // Check if the ability can actually be activated (cost, etc.)
                // We reuse the same checks from get_activatable_abilities inline.
                for ab in &card.activated_abilities {
                    if !ab.is_unlock_door {
                        continue;
                    }
                    let mana_cost = Self::mana_from_cost(&ab.cost);
                    let available_mana =
                        mana::calculate_available_mana(self.pool(player), game, player);
                    if available_mana.can_pay(&mana_cost)
                        && crate::cost::can_pay_ignoring_mana(&ab.cost, game, card_id, player)
                    {
                        playable.push(crate::agent::PlayOption {
                            card_id,
                            mode: crate::agent::PlayCardMode::UnlockDoor,
                            alt_cost_index: 0,
                        });
                    }
                }
            }
        }

        // Check graveyard for cast permissions such as Flashback, Escape, and Harmonize.
        let graveyard: Vec<CardId> = game.cards_in_zone(ZoneType::Graveyard, player).to_vec();
        for card_id in graveyard {
            let card = game.card(card_id);
            if must_be_instant && !has_flash_permission(card_id) {
                continue;
            }
            let available_mana = mana::calculate_available_mana_for_casting_excluding(
                self.pool(player),
                game,
                player,
                Some(card_id),
            );
            let sp_additional_ok = if let Some(sc) = card.action_spell_cost.as_ref() {
                crate::cost::can_pay_ignoring_mana_for_spell(sc, game, card_id, player)
            } else {
                true
            };
            let flashback_ok = if let Some(fb_cost_str) = card.get_flashback_cost() {
                let fb_cost = crate::cost::parse_cost(&fb_cost_str);
                let fb_mana = Self::mana_from_cost(&fb_cost);
                available_mana.can_pay(&fb_mana)
                    && sp_additional_ok
                    && crate::cost::can_pay_ignoring_mana_for_spell(&fb_cost, game, card_id, player)
            } else {
                false
            };
            let harmonize_ok = if let Some(harmonize_cost_str) = card.get_harmonize_cost() {
                let harmonize_mana = forge_foundation::ManaCost::parse(&harmonize_cost_str);
                let harmonize_base = if harmonize_mana.count_x() > 0 {
                    harmonize_mana.without_x()
                } else {
                    harmonize_mana
                };
                available_mana.can_pay(&harmonize_base) && sp_additional_ok
            } else {
                false
            };
            let escape_ok = if let Some((escape_mana_str, exile_count)) = card.get_escape_cost() {
                let escape_mc = forge_foundation::ManaCost::parse(&escape_mana_str);
                let other_gy_count = game
                    .cards_in_zone(ZoneType::Graveyard, player)
                    .iter()
                    .filter(|&&cid| cid != card_id)
                    .count() as i32;
                available_mana.can_pay(&escape_mc) && other_gy_count >= exile_count
            } else {
                false
            };
            if flashback_ok {
                playable.push(crate::agent::PlayOption {
                    card_id,
                    mode: crate::agent::PlayCardMode::Alternative(
                        crate::spellability::AlternativeCost::Flashback,
                    ),
                    alt_cost_index: 0,
                });
            }
            if harmonize_ok {
                playable.push(crate::agent::PlayOption {
                    card_id,
                    mode: crate::agent::PlayCardMode::Alternative(
                        crate::spellability::AlternativeCost::Harmonize,
                    ),
                    alt_cost_index: 0,
                });
            }
            if escape_ok {
                playable.push(crate::agent::PlayOption {
                    card_id,
                    mode: crate::agent::PlayCardMode::Alternative(
                        crate::spellability::AlternativeCost::Escape,
                    ),
                    alt_cost_index: 0,
                });
            }
        }

        // Check exile for Foretold cards (face-down in exile with foretell cost).
        let exile: Vec<CardId> = game.cards_in_zone(ZoneType::Exile, player).to_vec();
        for card_id in exile {
            let card = game.card(card_id);
            let can_may_play = can_may_play_from_static(card_id);
            if can_may_play {
                if card.is_land() {
                    let land_sa = SpellAbility::new_land(Some(card_id), player);
                    if !must_be_instant
                        && crate::spellability::land_ability::can_play(&land_sa, game)
                    {
                        playable.push(crate::agent::PlayOption {
                            card_id,
                            mode: crate::agent::PlayCardMode::Normal,
                            alt_cost_index: 0,
                        });
                    }
                    continue;
                }

                if must_be_instant && !has_flash_permission(card_id) {
                    continue;
                }
                let alt_cost_str = may_play_alt_cost(card_id);
                let mut cast_sa =
                    crate::spellability::build_spell_ability_for_card_cast(game, card_id, player);
                if alt_cost_str.is_some() {
                    cast_sa.restriction.variables.set_zone(ZoneType::Exile);
                }
                if crate::staticability::static_ability_cant_be_cast::cant_be_cast_ability_in_context(
                    &game.cards,
                    &cast_sa,
                    card,
                    player,
                    Some(game),
                ) {
                    continue;
                }
                if !crate::spellability::spell::can_play(&cast_sa, game) {
                    continue;
                }
                if let Some(ref tr) = cast_sa.target_restrictions {
                    let min_targets = tr.get_min_targets(game, &cast_sa);
                    if min_targets > 0
                        && !target_restrictions::has_candidates_in_spell_ability_chain(
                            game, player, &cast_sa,
                        )
                    {
                        continue;
                    }
                }
                let available_mana = mana::calculate_available_mana_for_casting_excluding(
                    self.pool(player),
                    game,
                    player,
                    Some(card_id),
                );
                let cost_adj = crate::cost::cost_adjustment::compute_cost_adjustment(
                    game,
                    card,
                    player,
                    ZoneType::Exile,
                );
                let alt_cost_mc = alt_cost_str
                    .as_ref()
                    .map(|s| forge_foundation::ManaCost::parse(s));
                let base_cost = alt_cost_mc.as_ref().unwrap_or(&card.mana_cost);
                let adjusted = cost_adj.apply(base_cost);
                if available_mana.can_pay(&adjusted) {
                    let grant_count = count_may_play_grants(card_id).max(1);
                    for _ in 0..grant_count {
                        playable.push(crate::agent::PlayOption {
                            card_id,
                            mode: crate::agent::PlayCardMode::Normal,
                            alt_cost_index: 0,
                        });
                    }
                }
                continue;
            }
            if card.face_down {
                if let Some(foretell_cost_str) = card.get_foretell_cost() {
                    if card.entered_current_zone_this_turn(game.turn.turn_number) {
                        continue;
                    }
                    if must_be_instant && !has_flash_permission(card_id) {
                        continue;
                    }
                    let available_mana = mana::calculate_available_mana_for_casting_excluding(
                        self.pool(player),
                        game,
                        player,
                        Some(card_id),
                    );
                    let foretell_mc = forge_foundation::ManaCost::parse(&foretell_cost_str);
                    let cost_adj = crate::cost::cost_adjustment::compute_cost_adjustment(
                        game,
                        card,
                        player,
                        ZoneType::Exile,
                    );
                    let adjusted = cost_adj.apply(&foretell_mc);
                    if available_mana.can_pay(&adjusted) {
                        playable.push(crate::agent::PlayOption {
                            card_id,
                            mode: crate::agent::PlayCardMode::Alternative(
                                crate::spellability::AlternativeCost::Foretell,
                            ),
                            alt_cost_index: 0,
                        });
                    }
                }
            } else if let Some(plotted_turn) = card
                .keywords
                .iter_strings()
                .chain(card.granted_keywords.iter_strings())
                .find_map(crate::card::parse_plotted_turn)
            {
                // Plot: plotted card in exile can be cast for free on a later turn,
                // and Forge also rejects cards that entered exile this turn.
                if game.turn.turn_number <= plotted_turn
                    || card.entered_current_zone_this_turn(game.turn.turn_number)
                {
                    continue;
                }
                if must_be_instant && !has_flash_permission(card_id) {
                    continue;
                }
                playable.push(crate::agent::PlayOption {
                    card_id,
                    mode: crate::agent::PlayCardMode::Alternative(
                        crate::spellability::AlternativeCost::Plot,
                    ),
                    alt_cost_index: 0,
                });
            } else if card.has_keyword(crate::card::KEYWORD_WARP_EXILED) {
                // Warp: exiled card can be cast for its normal mana cost
                if must_be_instant && !has_flash_permission(card_id) {
                    continue;
                }
                let available_mana = mana::calculate_available_mana_for_casting_excluding(
                    self.pool(player),
                    game,
                    player,
                    Some(card_id),
                );
                let cost_adj = crate::cost::cost_adjustment::compute_cost_adjustment(
                    game,
                    card,
                    player,
                    ZoneType::Exile,
                );
                let adjusted = cost_adj.apply(&card.mana_cost);
                if available_mana.can_pay(&adjusted) {
                    playable.push(crate::agent::PlayOption {
                        card_id,
                        mode: crate::agent::PlayCardMode::Normal,
                        alt_cost_index: 0,
                    });
                }
            }
        }

        // Check Command zone for commanders (with commander tax)
        let command_zone: Vec<CardId> = game.cards_in_zone(ZoneType::Command, player).to_vec();
        for card_id in command_zone {
            let card = game.card(card_id);
            if game.player_is_commander(player, card_id) {
                if must_be_instant && !has_flash_permission(card_id) {
                    continue;
                }
                let tax = game.player_commander_tax(player, card_id);
                let cost_adj = crate::cost::cost_adjustment::compute_cost_adjustment(
                    game,
                    card,
                    player,
                    ZoneType::Command,
                );
                let adjusted_cost = cost_adj.apply(&card.mana_cost);
                // Use a context-aware availability check so mana abilities
                // with `RestrictValid$` (e.g. Secluded Courtyard's
                // "Spell.Creature+ChosenType") are filtered out when the
                // commander isn't a matching creature type. Without this,
                // command-zone casts could incorrectly pull colored mana
                // from chosen-type-gated sources.
                let payment_ctx = mana::ManaPaymentContext {
                    is_spell: true,
                    is_activated_ability: false,
                    sa_on_stack: false,
                    type_line: Some(card.type_line.clone()),
                    card_name: Some(card.card_name.clone()),
                    card_color: Some(card.color),
                    chosen_types_by_source: game
                        .cards
                        .iter()
                        .filter_map(|c| c.chosen_type.clone().map(|chosen| (c.id, chosen)))
                        .collect(),
                };
                let available_mana = mana::calculate_available_mana_with_context(
                    self.pool(player),
                    game,
                    player,
                    Some(card_id),
                    &[],
                    Some(&payment_ctx),
                );
                if available_mana.can_pay_with_extra_generic(&adjusted_cost, tax) {
                    playable.push(crate::agent::PlayOption {
                        card_id,
                        mode: crate::agent::PlayCardMode::Normal,
                        alt_cost_index: 0,
                    });
                }
            }
        }

        playable
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card::Card;
    use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};

    fn card(
        name: &str,
        owner: PlayerId,
        type_line: &str,
        mana_cost: &str,
        color: ColorSet,
        power: Option<i32>,
        toughness: Option<i32>,
        abilities: Vec<&str>,
    ) -> Card {
        Card::new(
            CardId(0),
            name.to_string(),
            owner,
            CardTypeLine::parse(type_line),
            ManaCost::parse(mana_cost),
            color,
            power,
            toughness,
            vec![],
            abilities.into_iter().map(str::to_string).collect(),
        )
    }

    #[test]
    fn phyrexian_spell_with_generic_is_playable_from_off_color_sources_and_life() {
        let player = PlayerId(1);
        let opponent = PlayerId(0);
        let mut game = GameState::new(&["Alice", "Bob"], 20);

        for name in ["Forest", "Mountain"] {
            let mut land = card(
                name,
                player,
                &format!("Basic Land - {name}"),
                "",
                ColorSet::COLORLESS,
                None,
                None,
                vec![],
            );
            land.zone = ZoneType::Battlefield;
            let land_id = game.create_card(land);
            game.add_card_to_zone(ZoneType::Battlefield, player, land_id);
        }

        let mut target = card(
            "Raging Goblin",
            opponent,
            "Creature - Goblin",
            "R",
            ColorSet::RED,
            Some(1),
            Some(1),
            vec![],
        );
        target.zone = ZoneType::Battlefield;
        let target_id = game.create_card(target);
        game.add_card_to_zone(ZoneType::Battlefield, opponent, target_id);

        let mut dismember = card(
            "Dismember",
            player,
            "Instant",
            "1 BP BP",
            ColorSet::BLACK,
            None,
            None,
            vec!["SP$ Pump | IsCurse$ True | ValidTgts$ Creature | NumAtt$ -5 | NumDef$ -5"],
        );
        dismember.zone = ZoneType::Hand;
        let dismember_id = game.create_card(dismember);
        game.add_card_to_zone(ZoneType::Hand, player, dismember_id);

        let game_loop = GameLoop::new(2);
        let sa =
            crate::spellability::build_spell_ability_for_card_cast(&game, dismember_id, player);
        let valid_targets = crate::card::card_util::get_valid_cards_to_target(&game, &sa);
        assert_eq!(
            valid_targets.len(),
            1,
            "Dismember should have the opposing creature as a valid target"
        );
        let available_mana =
            crate::mana::calculate_available_mana(game_loop.pool(player), &game, player);
        assert!(
            available_mana.can_pay_with_phyrexian_life(&ManaCost::parse("1 BP BP"), 20),
            "available off-color sources should cover generic while life covers phyrexian shards"
        );
        let playable = game_loop.get_playable_cards(&game, player, true);

        assert!(
            playable.iter().any(|option| option.card_id == dismember_id),
            "Dismember should be instant-speed playable using one off-color generic source and 4 life"
        );
    }
}
