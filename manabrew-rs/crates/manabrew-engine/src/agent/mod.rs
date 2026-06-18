use crate::agent::notification::GameNotification;
use crate::card::CounterType;
use crate::combat::DefenderId;
use crate::cost::payment_decision::PaymentDecision;
use crate::cost::CostPart;
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::mana::ManaPool;
use crate::player::actions::PlayerAction;
use crate::spellability::SpellAbility;

pub mod attach_ai;
pub mod creature_evaluator;
pub mod game_log;
pub mod notification;
pub mod types;

pub use game_log::*;
pub use types::*;

/// Trait for player decision-making. Decouples the engine from UI/AI.
/// Implementations can be interactive (prompt user), AI, or network-driven.
pub trait PlayerAgent {
    /// Called before each agent decision point with the current game state.
    /// Override this to capture snapshots for a UI or network layer.
    fn snapshot_state(&mut self, _game: &GameState, _mana_pools: &[ManaPool]) {}

    /// Poll and clear any pending snapshot-restore request from this agent.
    fn take_restore_request(&mut self) -> Option<u64> {
        None
    }

    fn reveal_cards(
        &mut self,
        _game: &GameState,
        _player: PlayerId,
        _cards: &[CardId],
        _zone: forge_foundation::ZoneType,
        _owner: PlayerId,
        _message_prefix: Option<&str>,
    ) {
    }

    /// Returns the phase this player has declared they'll auto-pass until.
    /// `Some(Some("main1"))` = pass until main1 phase.
    /// `Some(None)` = pass through rest of turn.
    /// `None` = no standing pass-until (prompt normally).
    fn get_pass_until_phase(&self) -> Option<Option<&str>> {
        None
    }

    /// Clear the pass-until declaration (e.g. when a trigger interrupts).
    fn clear_pass_until(&mut self) {}

    /// Choose whether to keep the current opening hand or mulligan.
    /// `mulligan_count` is the number of mulligans already taken this game.
    /// Returns true to keep, false to mulligan.
    fn mulligan_decision(&mut self, player: PlayerId, hand: &[CardId], mulligan_count: u32)
        -> bool;

    /// Fire the mulligan prompt without blocking for a response.
    /// Default: no-op. UI agents override to decouple prompt dispatch from
    /// response collection so multiple players can be prompted in parallel.
    fn mulligan_decision_send(
        &mut self,
        _player: PlayerId,
        _hand: &[CardId],
        _mulligan_count: u32,
    ) {
    }

    /// Block waiting for the mulligan response previously sent via
    /// `mulligan_decision_send`. Default falls back to the blocking
    /// `mulligan_decision` so agents that don't split send/recv still work.
    fn mulligan_decision_recv(
        &mut self,
        player: PlayerId,
        hand: &[CardId],
        mulligan_count: u32,
    ) -> bool {
        self.mulligan_decision(player, hand, mulligan_count)
    }

    /// London Mulligan: after keeping, choose `count` cards from hand to put
    /// on the bottom of the library. Returns exactly `count` card IDs.
    /// Default: picks the first `count` cards (suitable for simple AI agents).
    fn choose_cards_to_bottom(
        &mut self,
        _player: PlayerId,
        hand: &[CardId],
        count: usize,
    ) -> Vec<CardId> {
        hand.iter().copied().take(count).collect()
    }

    /// Fire the put-back prompt without blocking. Default: no-op.
    fn choose_cards_to_bottom_send(&mut self, _player: PlayerId, _hand: &[CardId], _count: usize) {}

    /// Block waiting for the put-back response. Default falls back to the
    /// blocking `choose_cards_to_bottom`.
    fn choose_cards_to_bottom_recv(
        &mut self,
        player: PlayerId,
        hand: &[CardId],
        count: usize,
    ) -> Vec<CardId> {
        self.choose_cards_to_bottom(player, hand, count)
    }

    /// Choose a main-phase action: play a card from hand, tap a land for mana, untap a land,
    /// activate an ability, or pass.
    /// `tappable_lands` lists untapped lands available for tapping.
    /// `untappable_lands` lists source IDs whose most recent mana action can be undone.
    /// `activatable` lists (card_id, ability_index) pairs for activated abilities that can be used.
    fn choose_action(
        &mut self,
        player: PlayerId,
        action_space: Option<&PriorityActionSpace>,
        request_action_space: &mut dyn FnMut() -> PriorityActionSpace,
    ) -> PlayerAction;

    /// Choose attackers from available creatures, assigning each to a defender.
    /// `possible_defenders` lists valid attack targets (opponent players + their planeswalkers).
    /// Returns (attacker, defender) pairs.
    fn choose_attackers(
        &mut self,
        player: PlayerId,
        available: &[CardId],
        possible_defenders: &[DefenderId],
    ) -> Vec<(CardId, DefenderId)>;

    /// Choose which attackers to exert.
    /// Input is the subset of already-declared attackers that can pay an Exert
    /// optional attack cost. Return a subset of `attackers`.
    /// Default: choose none.
    fn exert_attackers(&mut self, _player: PlayerId, _attackers: &[CardId]) -> Vec<CardId> {
        vec![]
    }

    /// Choose which attackers to enlist.
    /// Input is the subset of already-declared attackers that can pay an Enlist
    /// optional attack cost. Return a subset of `attackers`.
    /// Default: choose none.
    fn enlist_attackers(&mut self, _player: PlayerId, _attackers: &[CardId]) -> Vec<CardId> {
        vec![]
    }

    /// Choose blockers. Returns pairs of (blocker, attacker).
    /// `max_blockers` is the BlockRestrict limit (if any) — agent should stop after this many.
    fn choose_blockers(
        &mut self,
        player: PlayerId,
        attackers: &[CardId],
        available_blockers: &[CardId],
        max_blockers: Option<usize>,
    ) -> Vec<(CardId, CardId)>;

    /// Choose one attacker for a specific blocker during sequential declaration.
    ///
    /// Return `Some(attacker_id)` to assign this blocker, or `None` to leave it
    /// unassigned. Default behavior maps through `choose_blockers` for the single
    /// blocker, preserving existing agent behavior when not overridden.
    fn choose_blocker_for(
        &mut self,
        player: PlayerId,
        attackers: &[CardId],
        blocker: CardId,
    ) -> Option<CardId> {
        let pairs = self.choose_blockers(player, attackers, &[blocker], None);
        pairs
            .into_iter()
            .find_map(|(b, a)| if b == blocker { Some(a) } else { None })
    }

    /// Choose the order in which an attacker assigns damage to its blockers.
    /// The attacker must assign lethal damage to each blocker in order before
    /// assigning damage to the next one.
    /// Returns a permutation of `blockers` in the desired assignment order.
    /// Default: return blockers as-is (no reordering).
    fn choose_damage_assignment_order(
        &mut self,
        _player: PlayerId,
        _attacker: CardId,
        blockers: &[CardId],
    ) -> Vec<CardId> {
        blockers.to_vec()
    }

    /// Choose exact combat damage assignment for one blocked attacker.
    ///
    /// `blockers_in_order` are in assignment order. `defender_id` is provided
    /// only when damage can legally be assigned to the defender (e.g. trample).
    ///
    /// Return pairs of `(assignee, damage)` where:
    /// - `Some(card_id)` assigns to a blocker
    /// - `None` assigns to defender
    ///
    fn assign_combat_damage(
        &mut self,
        game: &GameState,
        _player: PlayerId,
        attacker: CardId,
        blockers_in_order: &[CardId],
        defender_id: Option<DefenderId>,
        damage_to_assign: i32,
    ) -> Vec<(Option<CardId>, i32)> {
        let mut out: Vec<(Option<CardId>, i32)> = Vec::new();
        if damage_to_assign <= 0 {
            return out;
        }

        let mut dmg_left = damage_to_assign;
        let has_deathtouch = game.card(attacker).has_deathtouch();
        let can_assign_to_defender = defender_id.is_some() && game.card(attacker).has_trample();
        let mut last_blocker: Option<CardId> = None;

        for &blocker_id in blockers_in_order {
            if dmg_left <= 0 {
                break;
            }
            if game.card(blocker_id).zone != forge_foundation::ZoneType::Battlefield {
                continue;
            }
            if crate::staticability::static_ability_colorless_damage_source::target_is_protected_from_source(
                &game.cards,
                game.card(blocker_id),
                game.card(attacker),
            ) {
                continue;
            }
            last_blocker = Some(blocker_id);

            let blocker_card = game.card(blocker_id);
            let is_indestructible = blocker_card.has_keyword("Indestructible");
            let attacker_has_wither =
                game.card(attacker).has_wither() || game.card(attacker).has_infect();
            let lethal = if is_indestructible && !attacker_has_wither {
                // Can't kill by damage — assign all remaining (mirrors maxDamage + 1)
                dmg_left + 1
            } else if has_deathtouch {
                1
            } else if blocker_card.type_line.is_planeswalker() {
                blocker_card
                    .counter_count(&crate::card::CounterType::Loyalty)
                    .max(0)
            } else {
                (blocker_card.toughness() - blocker_card.damage).max(0)
            };
            let assign = lethal.min(dmg_left);
            if assign > 0 {
                out.push((Some(blocker_id), assign));
                dmg_left -= assign;
            }
        }

        if dmg_left > 0 {
            if can_assign_to_defender {
                out.push((None, dmg_left));
            } else if let Some(last) = last_blocker {
                if let Some((_, amount)) = out
                    .iter_mut()
                    .find(|(assignee, _)| assignee.map(|id| id == last).unwrap_or(false))
                {
                    *amount += dmg_left;
                } else {
                    out.push((Some(last), dmg_left));
                }
            }
        }
        out
    }

    fn choose_targets_for(
        &mut self,
        sa: &mut SpellAbility,
        game: &GameState,
        mana_pools: &[ManaPool],
    ) -> bool;

    /// Choose a target player (e.g. for Lightning Bolt targeting a player).
    /// `sa` is the active spell ability context (source card, API type, etc.) for UI display.
    fn choose_target_player(
        &mut self,
        player: PlayerId,
        valid: &[PlayerId],
        sa: Option<&SpellAbility>,
    ) -> Option<PlayerId>;

    /// Choose a target card (e.g. for Lightning Bolt targeting a creature).
    fn choose_target_card(
        &mut self,
        player: PlayerId,
        valid: &[CardId],
        sa: Option<&SpellAbility>,
    ) -> Option<CardId>;

    /// Choose a target card from a specific zone (e.g. Raise Dead from graveyard).
    fn choose_target_card_from_zone(
        &mut self,
        player: PlayerId,
        _zone: forge_foundation::ZoneType,
        valid: &[CardId],
        sa: Option<&SpellAbility>,
    ) -> Option<CardId> {
        self.choose_target_card(player, valid, sa)
    }

    /// Choose a target that can be a player or a card (e.g. "any target").
    fn choose_target_any(
        &mut self,
        player: PlayerId,
        valid_players: &[PlayerId],
        valid_cards: &[CardId],
        sa: Option<&SpellAbility>,
    ) -> TargetChoice;

    /// Choose one permanent to sacrifice/select from the valid options.
    /// `sa` is the active spell ability context for UI display.
    /// Default picks the first (used by AI agents).
    fn choose_sacrifice(
        &mut self,
        _player: PlayerId,
        valid: &[CardId],
        _source: Option<CardId>,
    ) -> Option<CardId> {
        valid.first().copied()
    }

    /// Choose which of the top `cards` (from Scry) to put on the bottom of the library.
    /// The rest will stay on top. Default: keep all on top (no cards sent to bottom).
    fn choose_scry(
        &mut self,
        _game: &GameState,
        _player: PlayerId,
        _cards: &[CardId],
    ) -> Vec<CardId> {
        vec![]
    }

    /// Choose which of the top `cards` (from Surveil) to put into the graveyard.
    /// The rest will go on top. Default: keep all on top (nothing milled).
    fn choose_surveil(
        &mut self,
        _game: &GameState,
        _player: PlayerId,
        _cards: &[CardId],
    ) -> Vec<CardId> {
        vec![]
    }

    /// Choose up to `max` cards from `valid` to move to the destination zone (Dig effect).
    /// `optional` means the player is not required to choose any.
    /// Default: take first `max` cards.
    fn choose_dig(
        &mut self,
        _game: &GameState,
        _player: PlayerId,
        valid: &[CardId],
        max: usize,
        _optional: bool,
    ) -> Vec<CardId> {
        valid.iter().copied().take(max).collect()
    }

    /// Choose an ordering for the top N cards being put back on the library (Ponder/Reorder).
    /// Returns the cards in desired order: index 0 will be placed deepest, last will be on top.
    /// Default: keep original order.
    fn choose_reorder_library(
        &mut self,
        _game: &GameState,
        _player: PlayerId,
        cards: &[CardId],
    ) -> Vec<CardId> {
        cards.to_vec()
    }

    /// Choose which cards to discard from hand (for SP$ Discard effects).
    /// `hand` is the full hand, `num` is how many must be discarded.
    /// Default: discard the first `num` cards.
    fn choose_discard(&mut self, _player: PlayerId, hand: &[CardId], num: usize) -> Vec<CardId> {
        hand.iter().copied().take(num).collect()
    }

    /// Choose any number of cards to discard (for `AnyNumber$ True` on
    /// SP$/DB$ Discard). The agent may pick 0..=hand.len() cards.
    /// Default: discard `min` cards (the minimum forced amount).
    fn choose_discard_any_number(
        &mut self,
        _player: PlayerId,
        hand: &[CardId],
        min: usize,
        max: usize,
    ) -> Vec<CardId> {
        let _ = max;
        hand.iter().copied().take(min).collect()
    }

    /// Choose cards to discard at random (for Mode$ Random discard, e.g. Hypnotic Specter).
    /// The engine calls this instead of `choose_discard` when the discard is random.
    /// Default: discard the first `num` cards (same as choose_discard).
    /// Deterministic agents should override this to use their seeded RNG.
    fn choose_random_discard(
        &mut self,
        _player: PlayerId,
        hand: &[CardId],
        num: usize,
    ) -> Vec<CardId> {
        hand.iter().copied().take(num).collect()
    }

    /// Choose a target spell on the stack (for SP$ Counter effects).
    /// `valid` is a slice of stack entry IDs.
    /// Default: target the first (topmost) spell.
    fn choose_target_spell(
        &mut self,
        _player: PlayerId,
        valid: &[u32],
        _source: Option<CardId>,
    ) -> Option<u32> {
        valid.first().copied()
    }

    /// Choose N modes for a modal spell (SP$ Charm / Commands).
    ///
    /// `descriptions` — human-readable description of each mode.
    /// `min` — minimum number of modes to choose.
    /// `max` — maximum number of modes to choose.
    ///
    /// Returns indices into `descriptions` of the chosen modes, in order.
    /// Default: choose the first `min` modes (index 0, 1, …).
    fn choose_mode(
        &mut self,
        _player: PlayerId,
        descriptions: &[String],
        min: usize,
        _max: usize,
        _source_card_id: Option<CardId>,
    ) -> Vec<usize> {
        (0..min.min(descriptions.len())).collect()
    }

    fn choose_spell_abilities_for_effect(
        &mut self,
        _player: PlayerId,
        abilities: &[SpellAbility],
        num: usize,
    ) -> Vec<usize> {
        (0..num.min(abilities.len())).collect()
    }

    /// Choose exactly one entity (Card or Player) from a candidate list.
    fn choose_single_entity_for_effect(
        &mut self,
        _player: PlayerId,
        valid: &[GameEntity],
        _is_optional: bool,
    ) -> Option<GameEntity> {
        valid.first().copied()
    }

    fn get_ability_to_play(
        &mut self,
        _player: PlayerId,
        abilities: &[SpellAbility],
    ) -> Option<usize> {
        if abilities.is_empty() {
            None
        } else {
            Some(0)
        }
    }

    /// Choose whether to put a revealed nonland card into the graveyard during Explore.
    /// Returns true to put in graveyard, false to keep on top of library.
    fn choose_explore_put_in_graveyard(
        &mut self,
        _game: &GameState,
        _player: PlayerId,
        _revealed_card_name: &str,
        revealed_cmc: i32,
        mana_producing_lands: usize,
        predicted_mana: usize,
        lands_in_hand: usize,
    ) -> bool {
        // EXPLORE_MAX_CMC_DIFF_TO_PUT_IN_GRAVEYARD = 2
        // EXPLORE_NUM_LANDS_TO_STILL_NEED_MORE = 2
        const MAX_CMC_DIFF: i32 = 2;
        const NUM_LANDS_TO_STILL_NEED_MORE: usize = 2;

        if lands_in_hand == 0 && mana_producing_lands <= NUM_LANDS_TO_STILL_NEED_MORE {
            return true;
        }
        if revealed_cmc - MAX_CMC_DIFF >= predicted_mana as i32 {
            return true;
        }
        false
    }

    /// Choose which legendary permanent to keep when the legend rule applies.
    /// `duplicates` contains all legendaries with the same name controlled by this player.
    /// Returns the CardId of the one to keep; the rest are sacrificed.
    fn choose_legend_keep(&mut self, _player: PlayerId, duplicates: &[CardId]) -> CardId {
        duplicates[0]
    }

    /// Choose whether an optional triggered ability fires.
    /// `description` is the trigger text shown to the player.
    /// `source` is the engine card id of the source card (for UI display).
    /// `api` is the spell ability API type.
    /// Returns true to allow the trigger, false to decline.
    /// Default: always allow (non-interactive agents accept all optional triggers).
    fn choose_optional_trigger(
        &mut self,
        _player: PlayerId,
        _description: &str,
        _source: Option<CardId>,
        _api: Option<crate::ability::api_type::ApiType>,
    ) -> bool {
        true
    }

    fn confirm_replacement_effect(
        &mut self,
        _player: PlayerId,
        _question: &str,
        _effect_description: &str,
        _source: Option<CardId>,
    ) -> bool {
        true
    }

    /// Generic confirmation hook for optional effect prompts that don't yet
    /// have a dedicated typed callback in the Rust agent interface.
    ///
    /// Returns true to accept/confirm, false to decline.
    fn confirm_action(
        &mut self,
        _player: PlayerId,
        _mode: Option<&str>,
        _message: &str,
        _options: &[String],
        _source: Option<CardId>,
        _api: Option<crate::ability::api_type::ApiType>,
    ) -> bool {
        false
    }

    fn confirm_payment(
        &mut self,
        player: PlayerId,
        cost_kind: &str,
        message: &str,
        source: Option<CardId>,
        api: Option<crate::ability::api_type::ApiType>,
    ) -> bool {
        let _ = (player, cost_kind, message, source, api);
        true
    }

    fn pay_cost_to_prevent_effect(
        &mut self,
        player: PlayerId,
        cost_kind: &str,
        message: &str,
        source: Option<CardId>,
        api: Option<crate::ability::api_type::ApiType>,
        can_pay: bool,
        targets: &[GameEntity],
        effect_text: &str,
    ) -> bool {
        let _ = (targets, effect_text);
        if !can_pay {
            return false;
        }
        self.confirm_payment(player, cost_kind, message, source, api)
    }

    fn choose_binary(
        &mut self,
        player: PlayerId,
        question: &str,
        kind: BinaryChoiceKind,
        _default_choice: Option<bool>,
        source: Option<CardId>,
        api: Option<crate::ability::api_type::ApiType>,
    ) -> bool {
        let (left, right) = kind.labels();
        self.confirm_action(
            player,
            Some(kind.as_str()),
            question,
            &[right.to_string(), left.to_string()],
            source,
            api,
        )
    }

    /// Choose whether to pay the kicker cost for a spell.
    /// `kicker_cost` is the mana cost string (e.g. "W", "2 R").
    /// `source` is the name of the spell being cast (for UI display).
    /// Returns true to kick, false to cast without kicker.
    /// Default: don't kick (AI default).
    fn choose_kicker(
        &mut self,
        _player: PlayerId,
        _kicker_cost: &str,
        _source: Option<CardId>,
    ) -> bool {
        false
    }

    /// Assist: another player asks if we'll help pay generic mana.
    /// Returns how much generic mana to pay (0 = decline). Default: decline.
    fn help_pay_assist(&mut self, _player: PlayerId, _card_name: &str, _max_generic: u32) -> u32 {
        0
    }

    /// Choose whether to pay the buyback cost for a spell.
    /// Returns true to pay buyback, false to cast normally.
    /// Default: don't pay buyback.
    fn choose_buyback(
        &mut self,
        _player: PlayerId,
        _buyback_cost: &str,
        _source: Option<CardId>,
    ) -> bool {
        false
    }

    /// Choose how many times to pay the multikicker cost.
    /// `max_kicks` is the maximum affordable.
    /// Returns the number of times to kick (0 to max_kicks).
    /// Default: 0 (don't multikick).
    fn choose_multikicker(
        &mut self,
        _player: PlayerId,
        _cost: &str,
        _max_kicks: u32,
        _source: Option<CardId>,
    ) -> u32 {
        0
    }

    /// Choose how many times to pay the replicate cost.
    /// `max_replicates` is the maximum affordable.
    /// Returns the number of replicates.
    /// Default: 0.
    fn choose_replicate(
        &mut self,
        _player: PlayerId,
        _cost: &str,
        _max_replicates: u32,
        _source: Option<CardId>,
    ) -> u32 {
        0
    }

    /// Choose a color (for ChooseColorEffect).
    /// `valid_colors` lists the legal color choices (e.g. ["White","Blue","Black","Red","Green"]).
    /// Default: pick the first valid color.
    fn choose_color(&mut self, _player: PlayerId, valid_colors: &[String]) -> Option<String> {
        valid_colors.first().cloned()
    }

    /// Choose one or more colors.
    fn choose_colors(
        &mut self,
        _player: PlayerId,
        valid_colors: &[String],
        min: usize,
        max: usize,
    ) -> Vec<String> {
        let hi = max.min(valid_colors.len());
        let lo = min.min(hi);
        valid_colors.iter().take(lo).cloned().collect()
    }

    /// Choose cards for an effect (ChooseCardEffect, CloneEffect, etc.).
    /// `valid` lists eligible card IDs, `min`/`max` are the selection bounds.
    /// Default: pick up to `max` from the front of `valid`.
    fn choose_cards_for_effect(
        &mut self,
        _player: PlayerId,
        valid: &[CardId],
        _min: usize,
        max: usize,
    ) -> Vec<CardId> {
        valid.iter().copied().take(max).collect()
    }

    /// Choose cards to tap for a `tapXType` cost that has a total-power floor
    /// such as Crew. `card_powers` carries the effective tap-power value for
    /// each candidate under the active ability; `card_sort_powers` carries the
    /// normal net power value used by Forge's deterministic cost plumbing when
    /// ordering candidates.
    fn choose_tap_type_for_cost(
        &mut self,
        player: PlayerId,
        valid: &[CardId],
        _min_total_power: i32,
        _card_powers: &[(CardId, i32)],
        _card_sort_powers: &[(CardId, i32)],
        _sa: Option<&SpellAbility>,
    ) -> Vec<CardId> {
        self.choose_cards_for_effect(player, valid, 1, valid.len())
    }

    /// Choose game entities (players and/or permanents) for an effect like Proliferate.
    fn choose_entities_for_effect(
        &mut self,
        _player: PlayerId,
        candidates: &[GameEntity],
        _min: usize,
        max: usize,
    ) -> Vec<GameEntity> {
        candidates.iter().copied().take(max).collect()
    }

    /// Choose a single card for hidden-origin zone changes (e.g. library search).
    fn choose_single_card_for_zone_change(
        &mut self,
        _game: &GameState,
        player: PlayerId,
        valid: &[CardId],
        _select_prompt: &str,
        _is_optional: bool,
    ) -> Option<CardId> {
        self.choose_cards_for_effect(player, valid, 1, 1)
            .into_iter()
            .next()
    }

    /// Choose multiple cards for hidden-origin zone changes (e.g. tutor multi-select).
    fn choose_cards_for_zone_change(
        &mut self,
        _game: &GameState,
        player: PlayerId,
        valid: &[CardId],
        min: usize,
        max: usize,
        _select_prompt: &str,
    ) -> Vec<CardId> {
        self.choose_cards_for_effect(player, valid, min, max)
    }

    /// Choose a creature/card type (for ChooseType effect).
    /// `type_category` is "Creature", "Card", "Land", etc.
    /// `valid_types` lists the legal type choices.
    /// Default: pick the first valid type.
    fn choose_type(
        &mut self,
        _player: PlayerId,
        _type_category: &str,
        valid_types: &[String],
    ) -> Option<String> {
        valid_types.first().cloned()
    }

    /// Choose a counter type.
    fn choose_counter_type(
        &mut self,
        _player: PlayerId,
        options: &[CounterType],
        _prompt: &str,
    ) -> Option<CounterType> {
        options.first().cloned()
    }

    /// Choose a card name (for NameCard effect).
    /// `valid_names` lists the legal card name choices (for ChooseFromList mode).
    /// Default: pick the first valid name.
    fn choose_card_name(&mut self, _player: PlayerId, valid_names: &[String]) -> Option<String> {
        valid_names.first().cloned()
    }

    /// Choose a number (for ChooseNumber effect).
    /// Default: pick the minimum.
    fn choose_number(&mut self, _player: PlayerId, min: i32, _max: i32) -> Option<i32> {
        Some(min)
    }

    /// Choose how many times to pay an optional keyword cost.
    /// Default: decline optional keyword costs.
    fn choose_number_for_keyword_cost(
        &mut self,
        _player: PlayerId,
        _max: i32,
        _prompt: &str,
        _source: Option<CardId>,
    ) -> i32 {
        0
    }

    /// Choose one number from an explicit list of legal rolled values.
    fn choose_number_from_list(
        &mut self,
        _player: PlayerId,
        choices: &[i32],
        _message: &str,
        _source_card_id: Option<CardId>,
    ) -> Option<i32> {
        choices.first().copied()
    }

    /// Choose one die result from a rolled list to ignore.
    fn choose_roll_to_ignore(
        &mut self,
        _player: PlayerId,
        rolls: &[i32],
        _source: Option<CardId>,
    ) -> Option<i32> {
        rolls.first().copied()
    }

    /// Choose one rolled result to exchange with a card's power or toughness.
    fn choose_roll_to_swap(
        &mut self,
        _player: PlayerId,
        rolls: &[i32],
        _source: Option<CardId>,
    ) -> Option<i32> {
        rolls.first().copied()
    }

    /// Choose one or more dice to reroll from the current natural roll list.
    fn choose_dice_to_reroll(
        &mut self,
        _player: PlayerId,
        _rolls: &[i32],
        _source: Option<CardId>,
    ) -> Vec<i32> {
        vec![]
    }

    /// Choose one rolled result to increment or decrement by 1.
    fn choose_roll_to_modify(
        &mut self,
        _player: PlayerId,
        rolls: &[i32],
        _source: Option<CardId>,
    ) -> Option<i32> {
        rolls.first().copied()
    }

    /// Choose whether a swap should use power or toughness.
    fn choose_roll_swap_value(
        &mut self,
        _player: PlayerId,
        _current_result: i32,
        _power: i32,
        _toughness: i32,
        _source: Option<CardId>,
    ) -> Option<RollSwapChoice> {
        Some(RollSwapChoice::Power)
    }

    /// Choose heads or tails for a coin flip.
    /// Returns true for heads, false for tails.
    /// Default: always call heads.
    fn flip_coin_call(&mut self, _player: PlayerId) -> bool {
        true
    }

    /// Choose the value of X for an X-cost spell.
    /// `max_x` is the maximum affordable value.
    /// Returns the chosen X value (0 to max_x).
    /// Default: spend all available mana (max_x).
    fn choose_x_value(&mut self, _player: PlayerId, max_x: u32, _source: Option<CardId>) -> u32 {
        max_x
    }

    /// Announce the value of a variable (`announce`, e.g. "X") in a spell's
    /// cost before payment, within `[min, max]`.
    /// Mirrors Java's `PlayerController.announceRequirements`.
    /// Returns None to cancel the cast.
    fn announce_requirements(
        &mut self,
        _player: PlayerId,
        _announce: &str,
        min: i32,
        _max: i32,
        _source: Option<CardId>,
    ) -> Option<i32> {
        Some(min)
    }

    /// Choose whether to pay life instead of mana for a Phyrexian mana shard.
    /// Returns true to pay 2 life, false to pay the color.
    /// Default: always pay color (never pay life).
    fn choose_phyrexian_pay_life(
        &mut self,
        _player: PlayerId,
        _color: &str,
        _source: Option<CardId>,
    ) -> bool {
        false
    }

    /// Pay an attack cost for a creature (Propaganda, Ghostly Prison).
    /// Called in a loop: tap lands to build mana, then Pay or Decline.
    fn pay_combat_cost(
        &mut self,
        _player: PlayerId,
        _attacker: CardId,
        _cost: i32,
        _description: &str,
        _tappable_lands: &[CardId],
        _untappable_lands: &[CardId],
        _mana_pool_total: i32,
    ) -> CombatCostAction {
        CombatCostAction::Decline
    }

    /// Choose graveyard cards to exile for Delve (reduces generic cost).
    /// `valid` lists graveyard card IDs, `max` is the maximum that can be exiled.
    /// Default: exile max cards (AI default — maximize cost reduction).
    fn choose_delve(
        &mut self,
        _player: PlayerId,
        valid: &[CardId],
        max: usize,
        _source: Option<CardId>,
    ) -> Vec<CardId> {
        valid.iter().copied().take(max).collect()
    }

    /// Choose artifacts to tap for Improvise (each pays {1} generic).
    /// `untapped_artifacts` lists available artifacts to tap.
    /// Default: don't improvise (AI default — auto-tap handles mana).
    fn choose_improvise(
        &mut self,
        _player: PlayerId,
        _untapped_artifacts: &[CardId],
        _remaining_cost: &forge_foundation::ManaCost,
        _source: Option<CardId>,
    ) -> Vec<CardId> {
        vec![]
    }

    /// Choose creatures to tap for Convoke (each pays {1} or a matching colored mana).
    /// `untapped_creatures` lists available creatures to tap.
    /// Default: don't convoke (AI default — auto-tap handles mana).
    fn choose_convoke(
        &mut self,
        _player: PlayerId,
        _untapped_creatures: &[CardId],
        _remaining_cost: &forge_foundation::ManaCost,
        _source: Option<CardId>,
    ) -> Vec<CardId> {
        vec![]
    }

    /// Pay a mana cost within a single payment session.
    /// Called in a loop for manual interaction: tap lands to build mana, then
    /// `Pay { auto: false }` or `Cancel`. Agents can also return
    /// `Pay { auto: true }` to delegate the rest of the session to engine
    /// auto-pay.
    /// Default: always cancel.
    fn pay_mana_cost(
        &mut self,
        _player: PlayerId,
        _card_id: CardId,
        _card_name: &str,
        _mana_cost: &str,
        _mana_cost_display: &str,
        _mana_cost_checkpoint: &str,
        _can_confirm_from_pool: bool,
        _allow_reserved_source_reuse: bool,
        _reserved_sacrifices: &[CardId],
        _mana_ability_options: &[ManaAbilityOption],
        _tappable_lands: &[CardId],
        _untappable_lands: &[CardId],
        _mana_pool: &ManaPool,
    ) -> ManaCostAction {
        ManaCostAction::AttemptedAndFailed
    }

    /// Block until this agent acknowledges a display-only prompt that
    /// requires UI dwell time (e.g. dice roll animations). Default
    /// implementation is a no-op — only human-driven transports need
    /// to wait for an ack.
    ///
    /// Used to make multi-agent broadcasts run their UI in parallel:
    /// the broadcast loop dispatches the prompt to every agent in one
    /// pass (so all clients receive it simultaneously), then a second
    /// pass calls `await_display_ack` on each agent so the engine
    /// blocks until the slowest player finishes their animation.
    fn await_display_ack(&mut self) {}

    /// Decide how to pay a single cost part.
    fn decide_cost_part(
        &mut self,
        _player: PlayerId,
        _source: CardId,
        _cost_part: &CostPart,
        _game: &GameState,
    ) -> Option<PaymentDecision> {
        // TODO: Implement default decisions per CostPart variant,
        None
    }

    /// Whether this agent pays each cost part immediately after deciding (true)
    /// or batches all decisions first, then pays (false).
    fn pays_right_after_decision(&self) -> bool {
        false
    }

    /// Reorder cost parts before payment (for human players to choose payment order).
    fn order_cost_parts(&mut self, parts: Vec<CostPart>) -> Vec<CostPart> {
        parts
    }

    /// Specify mana color distribution for combo/any mana production.
    /// `available_colors` lists which colors can be produced.
    /// `amount` is the total mana to distribute across colors.
    /// Returns a list of color letters (e.g. ["W", "W", "U"]) totaling `amount`.
    /// Default: picks the color with least mana in pool for each unit (AI heuristic).
    fn specify_mana_combo(
        &mut self,
        _player: PlayerId,
        available_colors: &[String],
        amount: usize,
        _source: Option<CardId>,
        _express_choice: Option<u16>,
    ) -> Vec<String> {
        // Default AI: pick first available color for all
        if let Some(first) = available_colors.first() {
            vec![first.clone(); amount]
        } else {
            vec!["C".to_string(); amount]
        }
    }

    /// Choose whether to play a land or cast a spell when both are possible.
    /// Returns true for land, false for spell, None to pass.
    fn choose_land_or_spell(&mut self, player: PlayerId) -> Option<bool>;

    /// Receive engine notifications for UI/game-log observers.
    /// Default is a no-op so simple agents do not need to handle them.
    fn notify(&mut self, _event: GameNotification) {}

    /// Choose which replacement effect to apply when multiple effects match the same event.
    fn choose_single_replacement_effect(
        &mut self,
        _player: PlayerId,
        _descriptions: &[String],
    ) -> usize {
        0
    }
}

/// A simple agent that always passes priority and makes no choices.
/// Useful for testing.
pub struct PassAgent;

impl PlayerAgent for PassAgent {
    fn choose_targets_for(
        &mut self,
        _sa: &mut SpellAbility,
        _game: &GameState,
        _mana_pools: &[ManaPool],
    ) -> bool {
        true
    }

    fn mulligan_decision(
        &mut self,
        _player: PlayerId,
        _hand: &[CardId],
        _mulligan_count: u32,
    ) -> bool {
        true
    }

    fn choose_action(
        &mut self,
        _player: PlayerId,
        _action_space: Option<&PriorityActionSpace>,
        _request_action_space: &mut dyn FnMut() -> PriorityActionSpace,
    ) -> PlayerAction {
        PlayerAction::PassPriority
    }

    fn choose_attackers(
        &mut self,
        _player: PlayerId,
        _available: &[CardId],
        _possible_defenders: &[DefenderId],
    ) -> Vec<(CardId, DefenderId)> {
        Vec::new() // no attackers
    }

    fn choose_blockers(
        &mut self,
        _player: PlayerId,
        _attackers: &[CardId],
        _available_blockers: &[CardId],
        _max_blockers: Option<usize>,
    ) -> Vec<(CardId, CardId)> {
        Vec::new() // no blockers
    }

    fn choose_target_player(
        &mut self,
        _player: PlayerId,
        valid: &[PlayerId],
        _sa: Option<&SpellAbility>,
    ) -> Option<PlayerId> {
        valid.first().copied()
    }

    fn choose_target_card(
        &mut self,
        _player: PlayerId,
        valid: &[CardId],
        _sa: Option<&SpellAbility>,
    ) -> Option<CardId> {
        valid.first().copied()
    }

    fn choose_target_any(
        &mut self,
        _player: PlayerId,
        valid_players: &[PlayerId],
        valid_cards: &[CardId],
        _sa: Option<&SpellAbility>,
    ) -> TargetChoice {
        if let Some(&pid) = valid_players.first() {
            TargetChoice::Player(pid)
        } else if let Some(&cid) = valid_cards.first() {
            TargetChoice::Card(cid)
        } else {
            TargetChoice::None
        }
    }

    fn choose_sacrifice(
        &mut self,
        _player: PlayerId,
        valid: &[CardId],
        _source: Option<CardId>,
    ) -> Option<CardId> {
        valid.first().copied()
    }

    fn choose_land_or_spell(&mut self, _player: PlayerId) -> Option<bool> {
        None
    }
}
