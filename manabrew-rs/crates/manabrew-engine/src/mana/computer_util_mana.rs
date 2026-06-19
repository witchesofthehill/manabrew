use forge_foundation::mana::ManaAtom;
use forge_foundation::{ManaCost, ManaCostShard, ZoneType};
use indexmap::IndexMap;
use std::collections::HashMap;

use crate::agent::ManaAbilityOption;
use crate::cost::cost_part::pay_cost_from_source;
use crate::cost::{can_pay_ignoring_mana, CostPart};
use crate::event::RunParams;
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};

use super::mana_cost_being_paid::{can_pay_for_shard_with_color, ManaCostBeingPaid};
use super::mana_pool::ManaPaymentOutcome;
use super::{
    add_produced_mana_to_pool, all_basic_subtype_atoms, atom_short, basic_land_mana_atom,
    chosen_colors_to_atoms, tap_land_for_mana, ManaPool, ManaProductionParams,
};

#[derive(Debug, Clone)]
struct ManaAbilityRef {
    card_id: CardId,
    ability_index: Option<usize>,
    atoms: Vec<u16>,
    amount: i32,
    mana_text: String,
    produced_ir: Option<crate::ability::ProducedMana>,
    source_order: usize,
}

impl ManaAbilityRef {
    fn can_pay_shard(&self, shard: ManaCostShard) -> bool {
        // Java's deterministic AutoPay treats empty `Combo ColorIdentity`
        // abilities as generic-pay candidates, then resolution produces no
        // mana in non-Commander games. Keep that tap/continue behavior.
        if self
            .produced_ir
            .as_ref()
            .is_some_and(crate::ability::ProducedMana::is_combo_color_identity)
            && self.atoms.is_empty()
            && (shard == ManaCostShard::Generic || shard.is_generic())
        {
            return true;
        }
        self.atoms
            .iter()
            .any(|&a| can_pay_for_shard_with_color(shard, a))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AutoTapChoice {
    pub card_id: CardId,
    pub mana_ability_index: Option<usize>,
    pub chosen_atom: u16,
    /// True when the mana ability has multiple color options and the caller
    /// must record an explicit express choice in the trace. Mirrors Java
    /// `AbilityManaPart.getExpressChoice()` being non-null.
    pub needs_express_choice: bool,
}

#[derive(Debug, Clone, Default)]
pub struct AutoTapPaymentTrace {
    pub choices: Vec<AutoTapChoice>,
    pub payment: ManaPaymentOutcome,
    pub paid: bool,
}

#[derive(Debug, Clone)]
pub struct ManaPaymentSources {
    pub source_cards: Vec<CardId>,
    pub mana_ability_options: Vec<ManaAbilityOption>,
}

fn mana_cost_from_cost(cost: &crate::cost::Cost) -> ManaCost {
    let mut out = ManaCost::generic(0);
    for part in &cost.parts {
        if let CostPart::Mana { cost, .. } = part {
            out = out.add(cost);
        }
    }
    out
}

/// Optional callback for choosing which permanent to sacrifice during mana
/// ability cost payment.  When `None`, the engine picks the first target after
/// sorting by (card_name, card_id) — a deterministic fallback.  When `Some`,
/// the callback is invoked with the sorted list of valid targets and should
/// return the chosen card (mirrors Java's `choosePermanentsToSacrifice`
/// which uses the harness RNG).
pub type SacrificeChooser<'a> = &'a mut dyn FnMut(&[CardId]) -> Option<CardId>;

/// Callback parameter for mana ability payment decisions.
/// Used to dispatch both sacrifice chooser and confirm payment callbacks
/// through a single unified interface to avoid multiple mutable borrows.
#[derive(Debug)]
pub enum ManaPayCallback<'a> {
    /// Choose which permanent to sacrifice from the given list.
    /// Return the chosen card, or None to cancel.
    ChooseSacrifice(&'a [CardId]),
    /// Notify the caller that auto-pay is making a color-choice prompt.
    /// The callback may use this to preserve parity-visible prompt ordering.
    /// The return value is ignored for this variant.
    ChooseColor(&'a [String]),
    /// Choose permanents for a `tapXType` mana-ability cost. The callback
    /// writes the selected cards into `chosen`; the return value is only used
    /// as a success/cancel signal to fit the unified callback shape.
    ChooseTapType {
        valid: &'a [CardId],
        min: usize,
        max: usize,
        chosen: &'a mut Vec<CardId>,
    },
    /// Confirm whether to sacrifice the given card for a mana ability.
    /// Return true to proceed, false to cancel.
    /// Mirrors Java's DeterministicCostDecision.confirmPayment() path.
    ConfirmSelfSacrifice(CardId),
    /// Confirm whether to remove counters from the source for a mana ability.
    /// Mirrors Java CostPayment confirm for CostRemoveCounter (SubCounter).
    ConfirmSubCounter(CardId),
    /// Confirm whether to exile the source for a mana ability.
    /// Mirrors Java CostPayment confirm for source-paid CostExile.
    ConfirmSourceExile(CardId),
    /// Confirm whether to pay life for a mana ability.
    /// Mirrors Java CostPayment confirm for CostPayLife.
    ConfirmPayLife(CardId),
    /// Execute the sacrifice of the given permanent for a mana ability.
    /// The callback is responsible for firing Sacrificed/ChangesZone using
    /// battlefield LKI, moving the card, and returning the same card id on
    /// success. Returning `None` cancels the payment.
    NotifySacrificeForMana(CardId),
    /// Apply real ProduceMana replacements to the actual mana string this
    /// source is about to add to the pool. The callback mutates `mana` after
    /// running replacement choice through the caller's agents.
    ApplyProduceManaReplacement {
        activator: PlayerId,
        source_card: CardId,
        mana: &'a mut String,
    },
}

/// Unified callback for mana payment decisions during auto-tap.
/// Returns Some(card_id) on success, None to cancel.
pub type ManaPayCallbackFn<'a> = &'a mut dyn FnMut(ManaPayCallback<'_>) -> Option<CardId>;

/// Auto-tap lands to produce the required mana.
/// Mirrors harness AutoPay flow used by parity tests: collect currently playable
/// mana abilities in battlefield order, choose the first legal source for the
/// next unpaid shard, then repeat after each activation.
pub fn auto_tap_lands(
    game: &mut GameState,
    pool: &mut ManaPool,
    player: PlayerId,
    cost: &ManaCost,
    current_spell: Option<CardId>,
) -> Vec<CardId> {
    auto_tap_lands_trace(game, pool, player, cost, current_spell)
        .into_iter()
        .map(|choice| choice.card_id)
        .collect()
}

pub fn auto_tap_lands_allow_reserved_source_reuse(
    game: &mut GameState,
    pool: &mut ManaPool,
    player: PlayerId,
    cost: &ManaCost,
    current_spell: Option<CardId>,
) -> Vec<CardId> {
    auto_tap_lands_allow_reserved_source_reuse_trace(game, pool, player, cost, current_spell)
        .into_iter()
        .map(|choice| choice.card_id)
        .collect()
}

pub fn auto_tap_lands_trace(
    game: &mut GameState,
    pool: &mut ManaPool,
    player: PlayerId,
    cost: &ManaCost,
    current_spell: Option<CardId>,
) -> Vec<AutoTapChoice> {
    auto_tap_lands_internal(
        game,
        pool,
        player,
        cost,
        current_spell,
        false,
        &[],
        &mut None,
    )
}

pub fn auto_tap_lands_allow_reserved_source_reuse_trace(
    game: &mut GameState,
    pool: &mut ManaPool,
    player: PlayerId,
    cost: &ManaCost,
    current_spell: Option<CardId>,
) -> Vec<AutoTapChoice> {
    auto_tap_lands_internal(
        game,
        pool,
        player,
        cost,
        current_spell,
        true,
        &[],
        &mut None,
    )
}

/// Auto-tap with an explicit sacrifice chooser callback for parity with Java's
/// `choosePermanentsToSacrifice` RNG path.
pub fn auto_tap_lands_with_chooser(
    game: &mut GameState,
    pool: &mut ManaPool,
    player: PlayerId,
    cost: &ManaCost,
    current_spell: Option<CardId>,
    sacrifice_chooser: SacrificeChooser<'_>,
) -> Vec<CardId> {
    let mut callback = |kind: ManaPayCallback<'_>| -> Option<CardId> {
        match kind {
            ManaPayCallback::ChooseSacrifice(valid) => sacrifice_chooser(valid),
            ManaPayCallback::ChooseColor(_) => None,
            ManaPayCallback::ChooseTapType { .. } => None,
            ManaPayCallback::ConfirmSelfSacrifice(cid) => Some(cid),
            ManaPayCallback::ConfirmSubCounter(cid) => Some(cid),
            ManaPayCallback::ConfirmSourceExile(cid) => Some(cid),
            ManaPayCallback::ConfirmPayLife(cid) => Some(cid),
            ManaPayCallback::NotifySacrificeForMana(cid) => Some(cid),
            ManaPayCallback::ApplyProduceManaReplacement { .. } => None,
        }
    };
    auto_tap_lands_internal(
        game,
        pool,
        player,
        cost,
        current_spell,
        false,
        &[],
        &mut Some(&mut callback),
    )
    .into_iter()
    .map(|choice| choice.card_id)
    .collect()
}

pub fn auto_tap_lands_allow_reserved_source_reuse_with_chooser(
    game: &mut GameState,
    pool: &mut ManaPool,
    player: PlayerId,
    cost: &ManaCost,
    current_spell: Option<CardId>,
    sacrifice_chooser: SacrificeChooser<'_>,
) -> Vec<CardId> {
    let mut callback = |kind: ManaPayCallback<'_>| -> Option<CardId> {
        match kind {
            ManaPayCallback::ChooseSacrifice(valid) => sacrifice_chooser(valid),
            ManaPayCallback::ChooseColor(_) => None,
            ManaPayCallback::ChooseTapType { .. } => None,
            ManaPayCallback::ConfirmSelfSacrifice(cid) => Some(cid),
            ManaPayCallback::ConfirmSubCounter(cid) => Some(cid),
            ManaPayCallback::ConfirmSourceExile(cid) => Some(cid),
            ManaPayCallback::ConfirmPayLife(cid) => Some(cid),
            ManaPayCallback::NotifySacrificeForMana(cid) => Some(cid),
            ManaPayCallback::ApplyProduceManaReplacement { .. } => None,
        }
    };
    auto_tap_lands_internal(
        game,
        pool,
        player,
        cost,
        current_spell,
        true,
        &[],
        &mut Some(&mut callback),
    )
    .into_iter()
    .map(|choice| choice.card_id)
    .collect()
}

/// Auto-tap with unified callback for both sacrifice chooser and confirm payment.
/// Used by parity tests to mirror Java's RNG-driven decision paths.
pub fn auto_tap_lands_with_callbacks(
    game: &mut GameState,
    pool: &mut ManaPool,
    player: PlayerId,
    cost: &ManaCost,
    current_spell: Option<CardId>,
    callback: ManaPayCallbackFn<'_>,
) -> Vec<CardId> {
    auto_tap_lands_internal(
        game,
        pool,
        player,
        cost,
        current_spell,
        false,
        &[],
        &mut Some(callback),
    )
    .into_iter()
    .map(|choice| choice.card_id)
    .collect()
}

pub fn auto_tap_lands_trace_with_callbacks(
    game: &mut GameState,
    pool: &mut ManaPool,
    player: PlayerId,
    cost: &ManaCost,
    current_spell: Option<CardId>,
    callback: ManaPayCallbackFn<'_>,
) -> Vec<AutoTapChoice> {
    auto_tap_lands_internal(
        game,
        pool,
        player,
        cost,
        current_spell,
        false,
        &[],
        &mut Some(callback),
    )
}

/// Same as [`auto_tap_lands_trace_with_callbacks`] but excludes the given
/// permanents from the auto-payer's mana-source pool. Used during spell
/// casting so a permanent reserved for the spell's additional sacrifice
/// cost (`Sac<1/X>`) can't also be picked for a `Sac<1/CARDNAME>` mana
/// ability — see the seed-62 Eviscerator's Insight divergence.
pub fn auto_tap_lands_trace_with_callbacks_and_reserved_sacrifices(
    game: &mut GameState,
    pool: &mut ManaPool,
    player: PlayerId,
    cost: &ManaCost,
    current_spell: Option<CardId>,
    reserved_sacrifices: &[CardId],
    callback: ManaPayCallbackFn<'_>,
) -> Vec<AutoTapChoice> {
    auto_tap_lands_internal(
        game,
        pool,
        player,
        cost,
        current_spell,
        false,
        reserved_sacrifices,
        &mut Some(callback),
    )
}

/// Same as [`auto_tap_lands_trace_with_callbacks_and_reserved_sacrifices`]
/// but propagates a `ManaPaymentContext` to the source-grouping pass so
/// `RestrictValid$` mana sources are filtered out when they don't apply to
/// the current payment (e.g. Flamebraider's "Spend only on Elemental spells/
/// abilities" must not show up when paying an `UnlessCost`).
pub fn auto_tap_lands_trace_with_callbacks_reserved_and_ctx(
    game: &mut GameState,
    pool: &mut ManaPool,
    player: PlayerId,
    cost: &ManaCost,
    current_spell: Option<CardId>,
    reserved_sacrifices: &[CardId],
    callback: ManaPayCallbackFn<'_>,
    payment_ctx: &crate::mana::ManaPaymentContext,
) -> Vec<AutoTapChoice> {
    auto_tap_lands_internal_with_ctx(
        game,
        pool,
        player,
        cost,
        current_spell,
        false,
        reserved_sacrifices,
        &mut Some(callback),
        Some(payment_ctx),
        false,
        false,
    )
    .choices
}

#[allow(clippy::too_many_arguments)]
pub fn auto_tap_lands_pay_incremental_with_callbacks_reserved_and_ctx(
    game: &mut GameState,
    pool: &mut ManaPool,
    player: PlayerId,
    cost: &ManaCost,
    current_spell: Option<CardId>,
    reserved_sacrifices: &[CardId],
    callback: ManaPayCallbackFn<'_>,
    payment_ctx: &crate::mana::ManaPaymentContext,
    any_color_conversion: bool,
) -> AutoTapPaymentTrace {
    auto_tap_lands_internal_with_ctx(
        game,
        pool,
        player,
        cost,
        current_spell,
        false,
        reserved_sacrifices,
        &mut Some(callback),
        Some(payment_ctx),
        true,
        any_color_conversion,
    )
}

/// Determine the next mana source/ability auto-pay would use without mutating
/// the game or pool. This lets callback-driven payment replay the exact same
/// source choice as engine auto-pay, including multi-ability lands.
pub fn next_auto_tap_choice(
    game: &GameState,
    pool: &ManaPool,
    player: PlayerId,
    cost: &ManaCost,
    current_spell: Option<CardId>,
    allow_reserved_source_reuse: bool,
) -> Option<AutoTapChoice> {
    next_auto_tap_choice_with_reserved_sacrifices(
        game,
        pool,
        player,
        cost,
        current_spell,
        allow_reserved_source_reuse,
        &[],
    )
}

pub fn next_auto_tap_choice_with_reserved_sacrifices(
    game: &GameState,
    pool: &ManaPool,
    player: PlayerId,
    cost: &ManaCost,
    current_spell: Option<CardId>,
    allow_reserved_source_reuse: bool,
    reserved_sacrifices: &[CardId],
) -> Option<AutoTapChoice> {
    let mut unpaid = ManaCostBeingPaid::from_mana_cost(cost);
    pay_cost_from_pool(&mut unpaid, pool);
    if unpaid.is_paid() {
        return None;
    }

    let mana_ability_map =
        group_sources_by_mana_color(game, player, reserved_sacrifices, None, false);
    if mana_ability_map.is_empty() {
        return None;
    }

    let mut sources_for_shards = group_and_order_to_pay_shards(&mana_ability_map, &unpaid);
    if sources_for_shards.is_empty() {
        return None;
    }
    sort_sources_for_autopay(game, player, &mut sources_for_shards);

    let to_pay = get_next_shard_to_pay(&unpaid, &sources_for_shards)?;
    let ma_list = sources_for_shards.get(&to_pay)?;
    let sa_payment = choose_mana_ability(
        game,
        player,
        current_spell,
        to_pay,
        ma_list,
        allow_reserved_source_reuse,
        reserved_sacrifices,
        &sources_for_shards,
        &unpaid,
    )?;
    let chosen_atom = choose_atom_for_shard(&sa_payment, to_pay)?;
    Some(AutoTapChoice {
        card_id: sa_payment.card_id,
        mana_ability_index: sa_payment.ability_index,
        chosen_atom,
        needs_express_choice: sa_payment.atoms.len() > 1,
    })
}

pub fn auto_tap_lands_allow_reserved_source_reuse_with_callbacks(
    game: &mut GameState,
    pool: &mut ManaPool,
    player: PlayerId,
    cost: &ManaCost,
    current_spell: Option<CardId>,
    callback: ManaPayCallbackFn<'_>,
) -> Vec<CardId> {
    auto_tap_lands_internal(
        game,
        pool,
        player,
        cost,
        current_spell,
        true,
        &[],
        &mut Some(callback),
    )
    .into_iter()
    .map(|choice| choice.card_id)
    .collect()
}

pub fn auto_tap_lands_allow_reserved_source_reuse_trace_with_callbacks_and_reserved_sacrifices(
    game: &mut GameState,
    pool: &mut ManaPool,
    player: PlayerId,
    cost: &ManaCost,
    current_spell: Option<CardId>,
    reserved_sacrifices: &[CardId],
    callback: ManaPayCallbackFn<'_>,
) -> Vec<AutoTapChoice> {
    auto_tap_lands_internal(
        game,
        pool,
        player,
        cost,
        current_spell,
        true,
        reserved_sacrifices,
        &mut Some(callback),
    )
}

pub fn auto_tap_lands_allow_reserved_source_reuse_with_callbacks_and_reserved_sacrifices(
    game: &mut GameState,
    pool: &mut ManaPool,
    player: PlayerId,
    cost: &ManaCost,
    current_spell: Option<CardId>,
    reserved_sacrifices: &[CardId],
    callback: ManaPayCallbackFn<'_>,
) -> Vec<CardId> {
    auto_tap_lands_internal(
        game,
        pool,
        player,
        cost,
        current_spell,
        true,
        reserved_sacrifices,
        &mut Some(callback),
    )
    .into_iter()
    .map(|choice| choice.card_id)
    .collect()
}

/// Mirrors Java AutoPay.payManaCost() — the main auto-tap loop.
///
/// Key parity points:
/// - Re-collects candidates EVERY iteration (fresh source list after each tap/sacrifice)
/// - Tries ALL shards in priority order per iteration via `choose_candidate`
/// - Uses `is_sole_source_for_other_shard` to preserve flexible sources
/// - Delegates sacrifice/counter costs through the callback
fn auto_tap_lands_internal(
    game: &mut GameState,
    pool: &mut ManaPool,
    player: PlayerId,
    cost: &ManaCost,
    current_spell: Option<CardId>,
    allow_reserved_source_reuse: bool,
    reserved_sacrifices: &[CardId],
    callback: &mut Option<ManaPayCallbackFn<'_>>,
) -> Vec<AutoTapChoice> {
    auto_tap_lands_internal_with_ctx(
        game,
        pool,
        player,
        cost,
        current_spell,
        allow_reserved_source_reuse,
        reserved_sacrifices,
        callback,
        None,
        false,
        false,
    )
    .choices
}

fn auto_tap_lands_internal_with_ctx(
    game: &mut GameState,
    pool: &mut ManaPool,
    player: PlayerId,
    cost: &ManaCost,
    current_spell: Option<CardId>,
    allow_reserved_source_reuse: bool,
    reserved_sacrifices: &[CardId],
    callback: &mut Option<ManaPayCallbackFn<'_>>,
    payment_ctx: Option<&crate::mana::ManaPaymentContext>,
    consume_incrementally: bool,
    any_color_conversion: bool,
) -> AutoTapPaymentTrace {
    let mut tapped_choices: Vec<AutoTapChoice> = Vec::new();
    let mut payment = ManaPaymentOutcome::default();

    let trace = std::env::var("FORGE_PAYMENT_TRACE").is_ok();
    if trace {
        let turn = game.turn.turn_number;
        let phase = format!("{:?}", game.turn.phase);
        let spell_name = current_spell
            .map(|cid| game.card(cid).card_name.clone())
            .unwrap_or_else(|| "<none>".to_string());
        eprintln!(
            "[pay-trace-rust] T{} {} P{:?} AUTO-PAY-START cost={} spell={} pool_before={}",
            turn,
            phase,
            player,
            cost,
            spell_name,
            pool.total_mana(),
        );
    }

    let mut unpaid = ManaCostBeingPaid::from_mana_cost(cost);
    if consume_incrementally {
        let spent = pool.pay_unpaid_for_spell_incremental(
            &mut unpaid,
            payment_ctx.unwrap_or(&crate::mana::ManaPaymentContext::default()),
            any_color_conversion,
        );
        payment.colors_spent |= spent.colors_spent;
        payment.paying_mana.extend(spent.paying_mana);
    } else {
        pay_cost_from_pool(&mut unpaid, pool);
    }
    if unpaid.is_paid() {
        if trace {
            eprintln!("[pay-trace-rust] AUTO-PAY-EXIT-EARLY paid-from-pool");
        }
        return AutoTapPaymentTrace {
            choices: tapped_choices,
            payment,
            paid: true,
        };
    }

    // Guard counter mirrors Java's AutoPay.payManaCost() `guard++ < 128`.
    let mut guard = 0u32;
    while !unpaid.is_paid() && guard < 128 {
        guard += 1;

        // Java re-collects candidates every iteration. This ensures tapped/sacrificed
        // sources are excluded and state changes from the previous iteration are visible.
        let mana_ability_map =
            group_sources_by_mana_color(game, player, reserved_sacrifices, payment_ctx, false);
        if mana_ability_map.is_empty() {
            break;
        }
        let mut candidates = collect_sorted_candidates(game, player, &mana_ability_map);
        if candidates.is_empty() {
            break;
        }

        // Java's chooseCandidate: iterate shards in priority order, pick the
        // least-versatile candidate that can pay.
        let Some((sa_payment, to_pay)) = choose_candidate(
            game,
            player,
            current_spell,
            &candidates,
            &unpaid,
            allow_reserved_source_reuse,
            reserved_sacrifices,
        ) else {
            break;
        };

        let Some(chosen_atom) = choose_atom_for_shard(&sa_payment, to_pay) else {
            break;
        };
        // Pay non-tap ability costs (sacrifice, counter removal) through callback.
        // If payment fails (e.g. sacrifice declined), remove the candidate and retry.
        if !pay_non_tap_mana_ability_costs(
            game,
            player,
            &sa_payment,
            current_spell,
            allow_reserved_source_reuse,
            reserved_sacrifices,
            callback,
        ) {
            // Java: candidate became unpayable; remove and continue.
            candidates.retain(|c| c.card_id != sa_payment.card_id);
            continue;
        }

        if let Some(fixed_atoms) = fixed_output_atoms_for_payment(game, player, &sa_payment) {
            let is_special_output = sa_payment.mana_text.starts_with("Special ");
            let trace_atom = if is_special_output {
                fixed_atoms.iter().fold(0, |acc, atom| acc | *atom)
            } else {
                chosen_atom
            };
            let produced =
                produce_mana_for_auto_pay(game, pool, player, &sa_payment, chosen_atom, callback);
            let trigger_atoms =
                add_taps_for_mana_trigger_mana(game, pool, player, &sa_payment, &produced);
            if consume_incrementally {
                let spent = pool.pay_unpaid_for_spell_incremental(
                    &mut unpaid,
                    payment_ctx.unwrap_or(&crate::mana::ManaPaymentContext::default()),
                    any_color_conversion,
                );
                payment.colors_spent |= spent.colors_spent;
                payment.paying_mana.extend(spent.paying_mana);
            } else {
                for &atom in &trigger_atoms {
                    let _ = unpaid.try_pay_mana(atom, atom as u8);
                }
            }
            tapped_choices.push(AutoTapChoice {
                card_id: sa_payment.card_id,
                mana_ability_index: sa_payment.ability_index,
                chosen_atom: trace_atom,
                needs_express_choice: is_special_output,
            });
        } else {
            // Sources with more than one possible color require a color
            // choice at resolution (Java fires `chooseColor` once per pick).
            // `sa_payment.atoms` already accounts for Combo ColorIdentity
            // because `group_sources_by_mana_color` resolves it against the
            // commander identity when the Produced$ IR is ComboColorIdentity.
            let is_empty_combo_color_identity = sa_payment
                .produced_ir
                .as_ref()
                .is_some_and(crate::ability::ProducedMana::is_combo_color_identity)
                && sa_payment.atoms.is_empty();
            let needs_express = sa_payment.atoms.len() > 1;
            let mut trigger_atoms_for_non_incremental: Vec<u16> = Vec::new();
            if is_empty_combo_color_identity {
                // Java's deterministic AutoPay taps an empty `Combo
                // ColorIdentity` source (Arcane Signet in a non-Commander
                // game, etc.) but produces no mana. Skip
                // `produce_mana_for_auto_pay` entirely so the helper doesn't
                // add a stand-in atom to the pool.
                if source_requires_tap(game, &sa_payment) && !game.card(sa_payment.card_id).tapped {
                    game.tap(sa_payment.card_id);
                }
            } else {
                let produced = produce_mana_for_auto_pay(
                    game,
                    pool,
                    player,
                    &sa_payment,
                    chosen_atom,
                    callback,
                );
                trigger_atoms_for_non_incremental =
                    add_taps_for_mana_trigger_mana(game, pool, player, &sa_payment, &produced);
            }

            tapped_choices.push(AutoTapChoice {
                card_id: sa_payment.card_id,
                mana_ability_index: sa_payment.ability_index,
                chosen_atom,
                needs_express_choice: needs_express,
            });

            if consume_incrementally {
                if !is_empty_combo_color_identity {
                    let spent = pool.pay_unpaid_for_spell_incremental(
                        &mut unpaid,
                        payment_ctx.unwrap_or(&crate::mana::ManaPaymentContext::default()),
                        any_color_conversion,
                    );
                    payment.colors_spent |= spent.colors_spent;
                    payment.paying_mana.extend(spent.paying_mana);
                }
            } else if !is_empty_combo_color_identity {
                let _ = unpaid.try_pay_mana(chosen_atom, chosen_atom as u8);
                for _ in 1..sa_payment.amount.max(1) {
                    let _ = unpaid.try_pay_mana(chosen_atom, chosen_atom as u8);
                }
                for &atom in &trigger_atoms_for_non_incremental {
                    let _ = unpaid.try_pay_mana(atom, atom as u8);
                }
            }
            // NOTE: do not re-iterate `1..amount` here to push extra mana into
            // the pool. `produce_mana_for_auto_pay` already adds the full
            // `Amount$` worth of mana via `auto_pay_base_mana_string`, so an
            // additional loop would double-count. Origin/main carried such a
            // loop because its inline path called `tap_land_for_mana` (which
            // adds only one mana) and had to manually back-fill extras —
            // that's no longer needed with the helper.
        }
    }

    // Phyrexian-life fallback: after the tap-and-pay loop finishes, any
    // remaining unpaid shards that are phyrexian can be paid with 2 life
    // each (CR 107.4f). Mirrors Java `ManaPool.payManaCost`'s phyrexian
    // handling. Without this, cards like Mutagenic Growth / Dismember /
    // Gut Shot can never be cast when the player lacks the matching
    // colored mana even with enough life to pay.
    if !unpaid.is_paid() && unpaid.contains_only_phyrexian_mana() {
        // Mark the cost as paid in the unpaid tracker and accumulate the
        // life that needs to be spent. The actual life deduction is the
        // caller's job (cast_spell.rs invokes pay_life_cost based on
        // result.life_paid, which routes through life-payment replacements
        // and triggers). Deducting here would double-charge.
        let life_required = required_phyrexian_life(&unpaid);
        if game.player(player).life > life_required {
            while !unpaid.is_paid() {
                if !unpaid.pay_phyrexian() {
                    break;
                }
                payment.life_paid += 2;
            }
        }
    }

    AutoTapPaymentTrace {
        choices: tapped_choices,
        payment,
        paid: unpaid.is_paid(),
    }
}

fn produce_mana_for_auto_pay(
    game: &mut GameState,
    pool: &mut ManaPool,
    player: PlayerId,
    ma: &ManaAbilityRef,
    chosen_atom: u16,
    callback: &mut Option<ManaPayCallbackFn<'_>>,
) -> String {
    if source_requires_tap(game, ma) && !game.card(ma.card_id).tapped {
        game.tap(ma.card_id);
    }

    let source = game.card(ma.card_id);
    let ab = ma
        .ability_index
        .and_then(|idx| source.activated_abilities.get(idx));
    let params = ManaProductionParams {
        source_card: ma.card_id,
        is_snow: source.type_line.is_snow(),
        restriction: ab.and_then(|a| a.restrict_valid.as_deref().map(str::to_string)),
        adds_no_counter: ab.map(|a| a.adds_no_counter).unwrap_or(false),
        adds_keywords: ab.and_then(|a| a.adds_keywords.clone()),
        adds_keywords_valid: ab.and_then(|a| a.adds_keywords_valid.clone()),
        adds_counters: ab.and_then(|a| a.adds_counters.clone()),
        adds_counters_valid: ab.and_then(|a| a.adds_counters_valid.clone()),
        triggers_when_spent: ab.and_then(|a| a.triggers_when_spent.clone()),
    };

    let mut mana_string = auto_pay_base_mana_string(game, player, ma, chosen_atom, callback);
    if let Some(ref mut cb) = callback {
        cb(ManaPayCallback::ApplyProduceManaReplacement {
            activator: player,
            source_card: ma.card_id,
            mana: &mut mana_string,
        });
    }
    add_produced_mana_to_pool(pool, &mana_string, &params);
    mana_string
}

fn add_taps_for_mana_trigger_mana(
    game: &GameState,
    pool: &mut ManaPool,
    player: PlayerId,
    sa_payment: &ManaAbilityRef,
    produced: &str,
) -> Vec<u16> {
    add_taps_for_mana_trigger_mana_impl(game, pool, player, sa_payment, produced, true)
}

fn add_taps_for_mana_trigger_mana_impl(
    game: &GameState,
    pool: &mut ManaPool,
    player: PlayerId,
    sa_payment: &ManaAbilityRef,
    produced: &str,
    require_tap: bool,
) -> Vec<u16> {
    // TapsForMana fires only when the mana ability has a Tap cost
    // (`AbilityManaPart.tapsForMana`). Implicit basic-land taps have no parsed
    let mut produced_atoms: Vec<u16> = Vec::new();
    let tapped_source = sa_payment.card_id;
    let pays_with_tap = match sa_payment.ability_index {
        Some(idx) => game
            .card(tapped_source)
            .activated_abilities
            .get(idx)
            .is_some_and(|ab| {
                ab.cost
                    .parts
                    .iter()
                    .any(|part| matches!(part, CostPart::Tap))
            }),
        None => true,
    };
    if require_tap && !pays_with_tap {
        return produced_atoms;
    }
    let params = RunParams {
        card: Some(tapped_source),
        player: Some(player),
        activator: Some(player),
        produced: Some(produced.to_string()),
        ..Default::default()
    };
    for &host_id in game.cards_in_zone(ZoneType::Battlefield, player) {
        let host = game.card(host_id);
        for trigger in &host.triggers {
            if trigger.kind != crate::trigger::TriggerType::TapsForMana {
                continue;
            }
            if !trigger.get_mode().perform_test(trigger, &params, game) {
                continue;
            }
            let Some(sa) = trigger.ensure_ability(game, host_id, player) else {
                continue;
            };
            let Some(produced_ir) = sa.produced_ir() else {
                continue;
            };
            let amount = sa.amount_of_mana_generated().max(1);
            let atoms = produced_ir.to_atoms(&host.chosen_colors);
            let Some(atom) = atoms.first().copied() else {
                continue;
            };
            let Some(letter) = ManaPool::atom_to_letter(atom).chars().next() else {
                continue;
            };
            let mana_string = std::iter::repeat_n(letter.to_string(), amount as usize)
                .collect::<Vec<_>>()
                .join(" ");
            let mana_params = ManaProductionParams {
                source_card: host_id,
                is_snow: host.type_line.is_snow(),
                restriction: None,
                adds_no_counter: false,
                adds_keywords: None,
                adds_keywords_valid: None,
                adds_counters: None,
                adds_counters_valid: None,
                triggers_when_spent: None,
            };
            // Panharmonicon: each qualifying static fires the trigger again.
            let extra = crate::staticability::static_ability_panharmonicon::extra_triggers(
                game, host_id, trigger, &params,
            );
            let total_fires = 1 + extra as usize;
            for _ in 0..total_fires {
                add_produced_mana_to_pool(pool, &mana_string, &mana_params);
                for _ in 0..amount {
                    produced_atoms.push(atom);
                }
            }
        }
    }
    produced_atoms
}

fn auto_pay_base_mana_string(
    game: &GameState,
    player: PlayerId,
    ma: &ManaAbilityRef,
    chosen_atom: u16,
    callback: &mut Option<ManaPayCallbackFn<'_>>,
) -> String {
    let base_amount = auto_pay_base_amount(game, player, ma).max(1) as usize;

    // Empty Combo ColorIdentity produces nothing — `ManaEffect.resolve`.
    if ma
        .produced_ir
        .as_ref()
        .is_some_and(crate::ability::ProducedMana::is_combo_color_identity)
        && ma.atoms.is_empty()
    {
        return String::new();
    }

    if let Some(fixed_atoms) = ma
        .produced_ir
        .as_ref()
        .and_then(crate::ability::ProducedMana::fixed_atoms)
    {
        return repeat_atoms_as_mana_string(&fixed_atoms, base_amount);
    }

    if let Some(special) = ma
        .produced_ir
        .as_ref()
        .and_then(crate::ability::ProducedMana::special_kind)
    {
        let atoms = crate::ability::effects::mana_effect::available_special_mana_atoms(
            game, ma.card_id, player, special,
        );
        return repeat_atoms_as_mana_string(&atoms, base_amount);
    }

    if ma.atoms.len() > 1 {
        if let Some(ref mut cb) = callback {
            if let Some(color_name) = super::mana_atom_to_color_name(chosen_atom) {
                let forced = [color_name.to_string()];
                for _ in 0..base_amount {
                    cb(ManaPayCallback::ChooseColor(&forced));
                }
            }
        }
    }

    repeat_atoms_as_mana_string(&[chosen_atom], base_amount)
}

fn auto_pay_base_amount(game: &GameState, player: PlayerId, ma: &ManaAbilityRef) -> i32 {
    ma.ability_index
        .and_then(|idx| game.card(ma.card_id).activated_abilities.get(idx))
        .map(|ab| {
            parse_mana_ability_amount_with_game(ab, Some(game), Some(ma.card_id), Some(player))
        })
        .unwrap_or(1)
}

fn repeat_atoms_as_mana_string(atoms: &[u16], repeats: usize) -> String {
    let mut out = Vec::new();
    for _ in 0..repeats.max(1) {
        for &atom in atoms {
            out.push(ManaPool::atom_to_letter(atom).to_string());
        }
    }
    out.join(" ")
}

fn pay_cost_from_pool(unpaid: &mut ManaCostBeingPaid, pool: &ManaPool) {
    let colors = [
        (ManaAtom::WHITE, pool.white()),
        (ManaAtom::BLUE, pool.blue()),
        (ManaAtom::BLACK, pool.black()),
        (ManaAtom::RED, pool.red()),
        (ManaAtom::GREEN, pool.green()),
        (ManaAtom::COLORLESS, pool.colorless()),
    ];

    for (atom, count) in colors {
        for _ in 0..count.max(0) {
            if unpaid.is_paid() {
                return;
            }
            let _ = unpaid.try_pay_mana(atom, atom as u8);
        }
    }
}

fn get_next_shard_to_pay(
    unpaid: &ManaCostBeingPaid,
    sources_for_shards: &IndexMap<ManaCostShard, Vec<ManaAbilityRef>>,
) -> Option<ManaCostShard> {
    let mut shards_to_pay = unpaid.get_distinct_shards();
    shards_to_pay.sort_by_key(|shard| sources_for_shards.get(shard).map_or(0, |v| v.len()));
    unpaid.get_shard_to_pay_by_priority(&shards_to_pay, ManaAtom::COLORS_SUPERPOSITION as u8)
}

/// Build a flat, sorted candidate list from the mana ability map.
/// Mirrors Java AutoPay.collectPlayableManaAbilities() — called fresh each iteration.
fn collect_sorted_candidates(
    game: &GameState,
    player: PlayerId,
    mana_ability_map: &IndexMap<i32, Vec<ManaAbilityRef>>,
) -> Vec<ManaAbilityRef> {
    collect_sorted_candidates_with_pref(game, player, mana_ability_map, false)
}

fn collect_sorted_candidates_with_pref(
    game: &GameState,
    player: PlayerId,
    mana_ability_map: &IndexMap<i32, Vec<ManaAbilityRef>>,
    prefer_higher_amount: bool,
) -> Vec<ManaAbilityRef> {
    let mut out: Vec<ManaAbilityRef> = mana_ability_map
        .values()
        .flat_map(|v| v.iter().cloned())
        .collect();
    // Deduplicate by (card_id, ability_index) — same ability may appear under multiple color keys.
    let mut seen = std::collections::HashSet::new();
    out.retain(|ma| seen.insert((ma.card_id, ma.ability_index, ma.source_order)));
    // Sort by score, then by zone_timestamp (battlefield entry order) to match
    // Java's card iteration which uses timestamp order, not CardId order.
    out.sort_by(|a, b| {
        let score_a = autopay_source_score(game, player, a);
        let score_b = autopay_source_score(game, player, b);
        (score_a * 1000).cmp(&(score_b * 1000)).then_with(|| {
            let ts_a = game.card(a.card_id).zone_timestamp;
            let ts_b = game.card(b.card_id).zone_timestamp;
            ts_a.cmp(&ts_b)
                .then_with(|| {
                    // Probe-only tiebreak: prefer the higher-amount ability of
                    // the same source so the greedy picker doesn't shadow it.
                    if prefer_higher_amount && a.card_id == b.card_id {
                        b.amount.cmp(&a.amount)
                    } else {
                        std::cmp::Ordering::Equal
                    }
                })
                .then_with(|| a.source_order.cmp(&b.source_order))
        })
    });
    out
}

/// Returns the chosen source and the shard it will pay.
fn choose_candidate(
    game: &GameState,
    player: PlayerId,
    current_spell: Option<CardId>,
    candidates: &[ManaAbilityRef],
    unpaid: &ManaCostBeingPaid,
    allow_reserved_source_reuse: bool,
    reserved_sacrifices: &[CardId],
) -> Option<(ManaAbilityRef, ManaCostShard)> {
    for shard in shard_priority(unpaid, candidates) {
        if let Some(ma) = choose_least_versatile_candidate(
            game,
            player,
            current_spell,
            candidates,
            shard,
            unpaid,
            allow_reserved_source_reuse,
            reserved_sacrifices,
        ) {
            return Some((ma, shard));
        }
    }
    None
}

fn shard_priority(unpaid: &ManaCostBeingPaid, candidates: &[ManaAbilityRef]) -> Vec<ManaCostShard> {
    let mut colored = Vec::new();
    let mut generic = None;
    let mut seen = std::collections::HashSet::new();
    for shard in unpaid.get_distinct_shards() {
        if matches!(shard, ManaCostShard::X | ManaCostShard::ColoredX) {
            continue;
        }
        if !seen.insert(shard) {
            continue;
        }
        if matches!(shard, ManaCostShard::Generic) {
            generic = Some(shard);
        } else {
            colored.push(shard);
        }
    }
    // Sort colored shards by fewest available candidates (most constrained first).
    // Equal-count shards need a deterministic tiebreak; otherwise payment can
    // consume flexible sources in different orders across runs/engines.
    colored.sort_by(|&a, &b| {
        let count_a = count_candidates_for_shard(candidates, a);
        let count_b = count_candidates_for_shard(candidates, b);
        count_a
            .cmp(&count_b)
            .then_with(|| shard_color_rank(a).cmp(&shard_color_rank(b)))
    });
    if let Some(g) = generic {
        colored.push(g);
    }
    colored
}

fn shard_color_rank(shard: ManaCostShard) -> u8 {
    let ordered = color_set_order_atoms(shard.color_mask() as u16);
    let Some(primary) = ordered.first() else {
        return 5;
    };
    color_set_order_atoms(ManaAtom::COLORS_SUPERPOSITION)
        .iter()
        .position(|atom| atom == primary)
        .map(|idx| idx as u8)
        .unwrap_or(5)
}

fn color_set_order_atoms(mask: u16) -> &'static [u16] {
    match mask & ManaAtom::COLORS_SUPERPOSITION {
        0 => &[],
        1 => &[ManaAtom::WHITE],
        2 => &[ManaAtom::BLUE],
        3 => &[ManaAtom::WHITE, ManaAtom::BLUE],
        4 => &[ManaAtom::BLACK],
        5 => &[ManaAtom::WHITE, ManaAtom::BLACK],
        6 => &[ManaAtom::BLUE, ManaAtom::BLACK],
        7 => &[ManaAtom::WHITE, ManaAtom::BLUE, ManaAtom::BLACK],
        8 => &[ManaAtom::RED],
        9 => &[ManaAtom::RED, ManaAtom::WHITE],
        10 => &[ManaAtom::BLUE, ManaAtom::RED],
        11 => &[ManaAtom::BLUE, ManaAtom::RED, ManaAtom::WHITE],
        12 => &[ManaAtom::BLACK, ManaAtom::RED],
        13 => &[ManaAtom::RED, ManaAtom::WHITE, ManaAtom::BLACK],
        14 => &[ManaAtom::BLUE, ManaAtom::BLACK, ManaAtom::RED],
        15 => &[
            ManaAtom::WHITE,
            ManaAtom::BLUE,
            ManaAtom::BLACK,
            ManaAtom::RED,
        ],
        16 => &[ManaAtom::GREEN],
        17 => &[ManaAtom::GREEN, ManaAtom::WHITE],
        18 => &[ManaAtom::GREEN, ManaAtom::BLUE],
        19 => &[ManaAtom::GREEN, ManaAtom::WHITE, ManaAtom::BLUE],
        20 => &[ManaAtom::BLACK, ManaAtom::GREEN],
        21 => &[ManaAtom::WHITE, ManaAtom::BLACK, ManaAtom::GREEN],
        22 => &[ManaAtom::BLACK, ManaAtom::GREEN, ManaAtom::BLUE],
        23 => &[
            ManaAtom::GREEN,
            ManaAtom::WHITE,
            ManaAtom::BLUE,
            ManaAtom::BLACK,
        ],
        24 => &[ManaAtom::RED, ManaAtom::GREEN],
        25 => &[ManaAtom::RED, ManaAtom::GREEN, ManaAtom::WHITE],
        26 => &[ManaAtom::GREEN, ManaAtom::BLUE, ManaAtom::RED],
        27 => &[
            ManaAtom::RED,
            ManaAtom::GREEN,
            ManaAtom::WHITE,
            ManaAtom::BLUE,
        ],
        28 => &[ManaAtom::BLACK, ManaAtom::RED, ManaAtom::GREEN],
        29 => &[
            ManaAtom::BLACK,
            ManaAtom::RED,
            ManaAtom::GREEN,
            ManaAtom::WHITE,
        ],
        30 => &[
            ManaAtom::BLUE,
            ManaAtom::BLACK,
            ManaAtom::RED,
            ManaAtom::GREEN,
        ],
        31 => &[
            ManaAtom::WHITE,
            ManaAtom::BLUE,
            ManaAtom::BLACK,
            ManaAtom::RED,
            ManaAtom::GREEN,
        ],
        _ => &[],
    }
}

/// Count how many candidates can pay a given shard.
fn count_candidates_for_shard(candidates: &[ManaAbilityRef], shard: ManaCostShard) -> usize {
    candidates.iter().filter(|c| c.can_pay_shard(shard)).count()
}

fn choose_least_versatile_candidate(
    game: &GameState,
    player: PlayerId,
    current_spell: Option<CardId>,
    candidates: &[ManaAbilityRef],
    shard: ManaCostShard,
    unpaid: &ManaCostBeingPaid,
    allow_reserved_source_reuse: bool,
    reserved_sacrifices: &[CardId],
) -> Option<ManaAbilityRef> {
    let mut fallback: Option<ManaAbilityRef> = None;
    for ma in candidates {
        if Some(ma.card_id) == current_spell {
            continue;
        }
        if !ma.can_pay_shard(shard) {
            continue;
        }
        if !can_pay_non_tap_mana_ability_costs(
            game,
            player,
            ma,
            current_spell,
            allow_reserved_source_reuse,
            reserved_sacrifices,
        ) {
            continue;
        }
        if fallback.is_none() {
            fallback = Some(ma.clone());
        }
        if !is_sole_source_for_other_shard_candidates(ma, shard, candidates, unpaid) {
            return Some(ma.clone());
        }
    }
    fallback
}

fn is_sole_source_for_other_shard_candidates(
    candidate: &ManaAbilityRef,
    current_shard: ManaCostShard,
    candidates: &[ManaAbilityRef],
    unpaid: &ManaCostBeingPaid,
) -> bool {
    let mut seen = std::collections::HashSet::new();
    for other_shard in unpaid.get_distinct_shards() {
        if other_shard == current_shard {
            continue;
        }
        if matches!(
            other_shard,
            ManaCostShard::Generic | ManaCostShard::X | ManaCostShard::ColoredX
        ) {
            continue;
        }
        if !seen.insert(other_shard) {
            continue;
        }
        if !candidate.can_pay_shard(other_shard) {
            continue;
        }
        let sources_for_other = candidates
            .iter()
            .filter(|alt| alt.can_pay_shard(other_shard))
            .count();
        if sources_for_other <= 1 {
            return true;
        }
    }
    false
}

fn choose_mana_ability(
    game: &GameState,
    player: PlayerId,
    current_spell: Option<CardId>,
    to_pay: ManaCostShard,
    ma_list: &[ManaAbilityRef],
    allow_reserved_source_reuse: bool,
    reserved_sacrifices: &[CardId],
    sources_for_shards: &IndexMap<ManaCostShard, Vec<ManaAbilityRef>>,
    unpaid: &ManaCostBeingPaid,
) -> Option<ManaAbilityRef> {
    let mut fallback: Option<ManaAbilityRef> = None;

    for ma in ma_list {
        if Some(ma.card_id) == current_spell {
            continue;
        }
        if !ma.can_pay_shard(to_pay)
            || !can_pay_non_tap_mana_ability_costs(
                game,
                player,
                ma,
                current_spell,
                allow_reserved_source_reuse,
                reserved_sacrifices,
            )
        {
            continue;
        }

        if fallback.is_none() {
            fallback = Some(ma.clone());
        }

        // Check if this candidate is the sole source for another unpaid shard.
        // If so, defer it — another shard needs it more.
        if !is_sole_source_for_other_shard(ma, to_pay, sources_for_shards, unpaid) {
            return Some(ma.clone());
        }
    }

    // All valid candidates are sole sources for other shards.
    // Fall back to the first valid one (forced pick).
    fallback
}

/// Returns true if `candidate` is the ONLY source that can pay for some
/// other unpaid colored shard (not the current one, not generic/X).
fn is_sole_source_for_other_shard(
    candidate: &ManaAbilityRef,
    current_shard: ManaCostShard,
    sources_for_shards: &IndexMap<ManaCostShard, Vec<ManaAbilityRef>>,
    unpaid: &ManaCostBeingPaid,
) -> bool {
    for other_shard in unpaid.get_distinct_shards() {
        if other_shard == current_shard {
            continue;
        }
        // Skip generic/X shards — they can be paid by anything.
        if matches!(
            other_shard,
            ManaCostShard::Generic | ManaCostShard::X | ManaCostShard::ColoredX
        ) {
            continue;
        }
        if !candidate.can_pay_shard(other_shard) {
            continue;
        }
        // Count how many sources in the pool can pay for this other shard.
        let sources_for_other = sources_for_shards
            .get(&other_shard)
            .map(|list| {
                list.iter()
                    .filter(|alt| alt.can_pay_shard(other_shard))
                    .count()
            })
            .unwrap_or(0);
        if sources_for_other <= 1 {
            return true; // This candidate is the only source — defer it.
        }
    }
    false
}

fn can_pay_non_tap_mana_ability_costs(
    game: &GameState,
    player: PlayerId,
    ma: &ManaAbilityRef,
    reserved_source: Option<CardId>,
    allow_reserved_source_reuse: bool,
    reserved_sacrifices: &[CardId],
) -> bool {
    let Some(ab_idx) = ma.ability_index else {
        return true;
    };
    let cost_parts: Vec<_> = game.card(ma.card_id).activated_abilities[ab_idx]
        .cost
        .parts
        .clone();
    for part in &cost_parts {
        if !can_pay_source_paid_mana_cost_part(
            game,
            player,
            ma.card_id,
            part,
            reserved_source,
            allow_reserved_source_reuse,
            reserved_sacrifices,
        ) {
            return false;
        }
    }
    true
}

pub(crate) fn reapply_non_undoable_payment_ability(
    game: &mut GameState,
    pool: &mut ManaPool,
    player: PlayerId,
    card_id: CardId,
    ability_index: usize,
) {
    let Some(ab) = game.card(card_id).activated_abilities.get(ability_index) else {
        return;
    };
    let atoms = ab
        .produced_ir
        .as_ref()
        .map(|ir| {
            ir.fixed_atoms()
                .unwrap_or_else(|| ir.to_atoms(&game.card(card_id).chosen_colors))
        })
        .unwrap_or_default();
    let amount = super::resolve_mana_ability_amount(game, card_id, player, ab);
    let has_tap_cost = ab.cost.parts.iter().any(|p| matches!(p, CostPart::Tap));
    let ma = ManaAbilityRef {
        card_id,
        ability_index: Some(ability_index),
        atoms: atoms.clone(),
        amount,
        mana_text: String::new(),
        produced_ir: ab.produced_ir.clone(),
        source_order: 0,
    };
    if pay_non_tap_mana_ability_costs(game, player, &ma, None, false, &[], &mut None) {
        if has_tap_cost {
            game.tap(card_id);
        }
        for &atom in &atoms {
            pool.add(atom, amount.max(1));
        }
    }
}

fn pay_non_tap_mana_ability_costs(
    game: &mut GameState,
    player: PlayerId,
    ma: &ManaAbilityRef,
    reserved_source: Option<CardId>,
    allow_reserved_source_reuse: bool,
    reserved_sacrifices: &[CardId],
    callback: &mut Option<ManaPayCallbackFn<'_>>,
) -> bool {
    let Some(ab_idx) = ma.ability_index else {
        return true;
    };
    let cost_parts: Vec<_> = game.card(ma.card_id).activated_abilities[ab_idx]
        .cost
        .parts
        .clone();
    for part in &cost_parts {
        match part {
            CostPart::Tap | CostPart::Mana { .. } => {}
            CostPart::PayLife(amount) => {
                if game.player(player).life < amount.resolve(game, ma.card_id, player) {
                    return false;
                }
                if let Some(ref mut cb) = callback {
                    if let Some(confirmed_id) = cb(ManaPayCallback::ConfirmPayLife(ma.card_id)) {
                        if confirmed_id != ma.card_id {
                            return false;
                        }
                    } else {
                        return false;
                    }
                }
                game.player_lose_life(player, amount.resolve(game, ma.card_id, player));
            }
            CostPart::SubCounter {
                amount,
                counter_type,
                ..
            } => {
                if game.card(ma.card_id).counter_count(counter_type)
                    < amount.resolve(game, ma.card_id, player)
                {
                    return false;
                }
                if let Some(ref mut cb) = callback {
                    if let Some(confirmed_id) = cb(ManaPayCallback::ConfirmSubCounter(ma.card_id)) {
                        if confirmed_id != ma.card_id {
                            return false;
                        }
                    } else {
                        return false;
                    }
                }
                let amount_n = amount.resolve(game, ma.card_id, player);
                game.card_mut(ma.card_id)
                    .remove_counter(counter_type, amount_n);
            }
            CostPart::Sacrifice {
                type_filter,
                amount,
            } => {
                if type_filter == "CARDNAME" {
                    if amount.resolve(game, ma.card_id, player) > 1
                        || game.card(ma.card_id).zone != ZoneType::Battlefield
                    {
                        return false;
                    }
                    if let Some(ref mut cb) = callback {
                        if let Some(confirmed_id) =
                            cb(ManaPayCallback::ConfirmSelfSacrifice(ma.card_id))
                        {
                            if confirmed_id != ma.card_id {
                                return false;
                            }
                        } else {
                            return false; // confirmation declined
                        }
                    }
                    if let Some(ref mut cb) = callback {
                        if let Some(sacrificed_id) =
                            cb(ManaPayCallback::NotifySacrificeForMana(ma.card_id))
                        {
                            if sacrificed_id != ma.card_id {
                                return false;
                            }
                        } else {
                            return false;
                        }
                    } else {
                        let owner = game.card(ma.card_id).owner;
                        game.move_card(ma.card_id, ZoneType::Graveyard, owner);
                    }
                } else {
                    let mut targets = crate::cost::get_sacrifice_targets_for_cost(
                        game,
                        player,
                        type_filter,
                        None,
                    );
                    targets.retain(|cid| !reserved_sacrifices.contains(cid));
                    if !allow_reserved_source_reuse {
                        if let Some(reserved) = reserved_source {
                            targets.retain(|&cid| cid != reserved);
                        }
                    }
                    targets.sort_by(|&a, &b| {
                        game.card(a)
                            .card_name
                            .cmp(&game.card(b).card_name)
                            .then_with(|| a.index().cmp(&b.index()))
                    });
                    let required = (amount.resolve(game, ma.card_id, player)).max(0) as usize;
                    if targets.len() < required {
                        return false;
                    }
                    for _ in 0..required {
                        let chosen = if let Some(ref mut cb) = callback {
                            cb(ManaPayCallback::ChooseSacrifice(&targets))
                        } else {
                            targets.first().copied()
                        };
                        if let Some(cid) = chosen {
                            targets.retain(|&c| c != cid);
                            if let Some(ref mut cb) = callback {
                                if let Some(sacrificed_id) =
                                    cb(ManaPayCallback::NotifySacrificeForMana(cid))
                                {
                                    if sacrificed_id != cid {
                                        return false;
                                    }
                                } else {
                                    return false;
                                }
                            } else {
                                let owner = game.card(cid).owner;
                                game.move_card(cid, ZoneType::Graveyard, owner);
                            }
                        }
                    }
                }
            }
            CostPart::Exile { amount, from, .. } => {
                if !pay_cost_from_source(part)
                    || amount.resolve(game, ma.card_id, player) > 1
                    || game.card(ma.card_id).zone != *from
                {
                    return false;
                }
                if let Some(ref mut cb) = callback {
                    if let Some(confirmed_id) = cb(ManaPayCallback::ConfirmSourceExile(ma.card_id))
                    {
                        if confirmed_id != ma.card_id {
                            return false;
                        }
                    } else {
                        return false;
                    }
                }
                let owner = game.card(ma.card_id).owner;
                game.move_card(ma.card_id, ZoneType::Exile, owner);
            }
            CostPart::TapType { .. } => {
                let targets = choose_tap_type_targets_for_mana_ability_with_callback(
                    game,
                    player,
                    ma.card_id,
                    part,
                    reserved_source,
                    allow_reserved_source_reuse,
                    reserved_sacrifices,
                    callback,
                );
                if targets.is_empty() {
                    return false;
                }
                for cid in targets {
                    game.tap(cid);
                }
            }
            _ => return false,
        }
    }
    true
}

fn can_pay_source_paid_mana_cost_part(
    game: &GameState,
    player: PlayerId,
    source_id: CardId,
    part: &CostPart,
    reserved_source: Option<CardId>,
    allow_reserved_source_reuse: bool,
    reserved_sacrifices: &[CardId],
) -> bool {
    match part {
        CostPart::Tap | CostPart::Mana { .. } => true,
        CostPart::PayLife(amount) => {
            game.player(player).life >= amount.resolve(game, source_id, player)
        }
        CostPart::SubCounter {
            amount,
            counter_type,
            ..
        } => {
            game.card(source_id).counter_count(counter_type)
                >= amount.resolve(game, source_id, player)
        }
        CostPart::Sacrifice {
            type_filter,
            amount,
        } => {
            if type_filter == "CARDNAME" {
                amount.resolve(game, source_id, player) <= 1
                    && game.card(source_id).zone == ZoneType::Battlefield
                    && !reserved_sacrifices.contains(&source_id)
            } else {
                let targets = get_payable_mana_sacrifice_targets(
                    game,
                    player,
                    type_filter,
                    reserved_source,
                    allow_reserved_source_reuse,
                    reserved_sacrifices,
                );
                (targets.len() as i32) >= amount.resolve(game, source_id, player)
            }
        }
        CostPart::Exile { amount, from, .. } => {
            pay_cost_from_source(part)
                && amount.resolve(game, source_id, player) <= 1
                && game.card(source_id).zone == *from
        }
        CostPart::TapType { .. } => !choose_tap_type_targets_for_mana_ability(
            game,
            player,
            source_id,
            part,
            reserved_source,
            allow_reserved_source_reuse,
            reserved_sacrifices,
        )
        .is_empty(),
        _ => false,
    }
}

fn choose_tap_type_targets_for_mana_ability(
    game: &GameState,
    player: PlayerId,
    source_id: CardId,
    part: &CostPart,
    reserved_source: Option<CardId>,
    allow_reserved_source_reuse: bool,
    reserved_sacrifices: &[CardId],
) -> Vec<CardId> {
    let mut callback = None;
    choose_tap_type_targets_for_mana_ability_with_callback(
        game,
        player,
        source_id,
        part,
        reserved_source,
        allow_reserved_source_reuse,
        reserved_sacrifices,
        &mut callback,
    )
}

fn choose_tap_type_targets_for_mana_ability_with_callback(
    game: &GameState,
    player: PlayerId,
    source_id: CardId,
    part: &CostPart,
    reserved_source: Option<CardId>,
    allow_reserved_source_reuse: bool,
    reserved_sacrifices: &[CardId],
    callback: &mut Option<ManaPayCallbackFn<'_>>,
) -> Vec<CardId> {
    let CostPart::TapType {
        amount,
        type_filter,
        min_total_power,
    } = part
    else {
        return Vec::new();
    };
    let mut targets = crate::cost::get_tap_type_targets(game, player, type_filter, source_id);
    targets.retain(|cid| !reserved_sacrifices.contains(cid));
    if !allow_reserved_source_reuse {
        if let Some(reserved) = reserved_source {
            targets.retain(|&cid| cid != reserved);
        }
    }

    if let Some(power_threshold) = min_total_power {
        targets.sort_by(|&a, &b| {
            crate::cost::cost_tap_type::tap_power_value(game, b, None)
                .cmp(&crate::cost::cost_tap_type::tap_power_value(game, a, None))
                .then_with(|| {
                    game.card(a)
                        .card_name
                        .cmp(&game.card(b).card_name)
                        .then_with(|| a.index().cmp(&b.index()))
                })
        });
        if let Some(cb) = callback {
            let mut chosen = Vec::new();
            if cb(ManaPayCallback::ChooseTapType {
                valid: &targets,
                min: 1,
                max: targets.len(),
                chosen: &mut chosen,
            })
            .is_none()
            {
                return Vec::new();
            }
            chosen.retain(|cid| targets.contains(cid));
            chosen.dedup();
            let chosen_power: i32 = chosen
                .iter()
                .map(|&cid| crate::cost::cost_tap_type::tap_power_value(game, cid, None))
                .sum();
            if chosen_power >= *power_threshold {
                return chosen;
            }
            return Vec::new();
        }
        let mut chosen = Vec::new();
        let mut total = 0;
        for cid in targets {
            total += crate::cost::cost_tap_type::tap_power_value(game, cid, None);
            chosen.push(cid);
            if total >= *power_threshold {
                return chosen;
            }
        }
        return Vec::new();
    }

    let required = (amount.resolve(game, source_id, player)).max(0) as usize;
    if targets.len() < required {
        return Vec::new();
    }
    targets.sort_by(|&a, &b| {
        game.card(a)
            .card_name
            .cmp(&game.card(b).card_name)
            .then_with(|| a.index().cmp(&b.index()))
    });
    if let Some(cb) = callback {
        let mut chosen = Vec::new();
        if cb(ManaPayCallback::ChooseTapType {
            valid: &targets,
            min: required,
            max: required,
            chosen: &mut chosen,
        })
        .is_none()
        {
            return Vec::new();
        }
        chosen.retain(|cid| targets.contains(cid));
        chosen.dedup();
        if chosen.len() < required {
            return Vec::new();
        }
        chosen.truncate(required);
        return chosen;
    }
    targets.truncate(required);
    targets
}

fn get_payable_mana_sacrifice_targets(
    game: &GameState,
    player: PlayerId,
    type_filter: &str,
    reserved_source: Option<CardId>,
    allow_reserved_source_reuse: bool,
    reserved_sacrifices: &[CardId],
) -> Vec<CardId> {
    let mut targets = crate::cost::get_sacrifice_targets_for_cost(game, player, type_filter, None);
    targets.retain(|cid| !reserved_sacrifices.contains(cid));
    if !allow_reserved_source_reuse {
        if let Some(reserved) = reserved_source {
            targets.retain(|&cid| cid != reserved);
        }
    }
    targets
}

fn choose_atom_for_shard(mana_ab: &ManaAbilityRef, shard: ManaCostShard) -> Option<u16> {
    if shard.is_colorless() && mana_ab.atoms.contains(&ManaAtom::COLORLESS) {
        return Some(ManaAtom::COLORLESS);
    }

    if shard == ManaCostShard::Generic || shard.is_generic() {
        if mana_ab
            .produced_ir
            .as_ref()
            .is_some_and(crate::ability::ProducedMana::is_combo_color_identity)
            && mana_ab.atoms.is_empty()
        {
            return Some(ManaAtom::WHITE);
        }
        return mana_ab.atoms.first().copied();
    }

    mana_ab
        .atoms
        .iter()
        .copied()
        .find(|&a| can_pay_for_shard_with_color(shard, a))
}

fn group_and_order_to_pay_shards(
    mana_ability_map: &IndexMap<i32, Vec<ManaAbilityRef>>,
    cost: &ManaCostBeingPaid,
) -> IndexMap<ManaCostShard, Vec<ManaAbilityRef>> {
    let mut res: IndexMap<ManaCostShard, Vec<ManaAbilityRef>> = IndexMap::new();

    if (cost.get_generic_mana_amount() > 0 || cost.has_any_kind(ManaAtom::OR_2_GENERIC))
        && mana_ability_map.contains_key(&(ManaAtom::GENERIC as i32))
    {
        res.insert(
            ManaCostShard::Generic,
            mana_ability_map
                .get(&(ManaAtom::GENERIC as i32))
                .cloned()
                .unwrap_or_default(),
        );
    }

    for shard in cost.get_distinct_shards() {
        if shard.is_or_2_generic() {
            let color_key = shard.color_mask() as i32;
            if let Some(list) = mana_ability_map.get(&color_key) {
                res.entry(shard).or_default().extend(list.clone());
            }
            if let Some(list) = mana_ability_map.get(&(ManaAtom::GENERIC as i32)) {
                res.entry(shard).or_default().extend(list.clone());
            }
            continue;
        }

        if shard == ManaCostShard::Generic {
            continue;
        }

        for (color_key, list) in mana_ability_map {
            let key_color =
                (*color_key as u16) & (ManaAtom::COLORS_SUPERPOSITION | ManaAtom::COLORLESS);
            if can_pay_for_shard_with_color(shard, key_color) {
                let bucket = res.entry(shard).or_default();
                for ma in list {
                    if !bucket
                        .iter()
                        .any(|x| x.card_id == ma.card_id && x.ability_index == ma.ability_index)
                    {
                        bucket.push(ma.clone());
                    }
                }
            }
        }
    }

    res
}

#[allow(dead_code)]
fn sort_mana_abilities(
    game: &GameState,
    player: PlayerId,
    current_spell: Option<CardId>,
    mana_ability_map: &mut IndexMap<ManaCostShard, Vec<ManaAbilityRef>>,
    colors_most_common: &[u16],
) {
    let mut mana_card_score: HashMap<CardId, i32> = HashMap::new();
    let mut ordered_cards: Vec<CardId> = Vec::new();

    for abilities in mana_ability_map.values() {
        for ability in abilities {
            if mana_card_score.contains_key(&ability.card_id) {
                continue;
            }
            let score = score_mana_producing_card(game, ability.card_id, player);
            mana_card_score.insert(ability.card_id, score);
            ordered_cards.push(ability.card_id);
        }
    }

    ordered_cards.sort_by_key(|cid| mana_card_score.get(cid).copied().unwrap_or(0));

    let shards: Vec<ManaCostShard> = mana_ability_map.keys().copied().collect();
    for shard in shards {
        let Some(existing) = mana_ability_map.get(&shard).cloned() else {
            continue;
        };
        let mut new_abilities = existing.clone();
        let existing_index: HashMap<(CardId, Option<usize>), usize> = existing
            .iter()
            .enumerate()
            .map(|(i, a)| ((a.card_id, a.ability_index), i))
            .collect();

        let cmp = |a: &ManaAbilityRef, b: &ManaAbilityRef| -> std::cmp::Ordering {
            let idx_a = ordered_cards
                .iter()
                .position(|&c| c == a.card_id)
                .unwrap_or(usize::MAX);
            let idx_b = ordered_cards
                .iter()
                .position(|&c| c == b.card_id)
                .unwrap_or(usize::MAX);
            let mut pre_order = (idx_a as isize) - (idx_b as isize);

            if pre_order != 0 {
                if shard.is_generic()
                    && mana_card_score.get(&a.card_id) == mana_card_score.get(&b.card_id)
                {
                    for &col in colors_most_common {
                        let a_can = a.atoms.contains(&col);
                        let b_can = b.atoms.contains(&col);
                        if a_can && !b_can {
                            return std::cmp::Ordering::Greater;
                        }
                        if !a_can && b_can {
                            return std::cmp::Ordering::Less;
                        }
                    }
                }

                let a_pos = existing_index
                    .get(&(a.card_id, a.ability_index))
                    .copied()
                    .unwrap_or(usize::MAX);
                let b_pos = existing_index
                    .get(&(b.card_id, b.ability_index))
                    .copied()
                    .unwrap_or(usize::MAX);
                pre_order += (a_pos as isize) - (b_pos as isize);

                return pre_order.cmp(&0);
            }

            let shard_mana = shard.short_string();
            let pay_with_a = a.mana_text.contains(shard_mana);
            let pay_with_b = b.mana_text.contains(shard_mana);
            if pay_with_a && !pay_with_b {
                return std::cmp::Ordering::Less;
            }
            if pay_with_b && !pay_with_a {
                return std::cmp::Ordering::Greater;
            }

            a.ability_index
                .cmp(&b.ability_index)
                .then(a.source_order.cmp(&b.source_order))
        };
        for i in 1..new_abilities.len() {
            let pivot = new_abilities[i].clone();
            // Binary search: find leftmost position where pivot should go.
            let mut lo = 0usize;
            let mut hi = i;
            while lo < hi {
                let mid = (lo + hi) / 2;
                if cmp(&pivot, &new_abilities[mid]).is_lt() {
                    hi = mid;
                } else {
                    lo = mid + 1;
                }
            }
            // Shift [lo..i) right by one, then place pivot at lo.
            if lo < i {
                for j in (lo..i).rev() {
                    new_abilities.swap(j, j + 1);
                }
                new_abilities[lo] = pivot;
            }
        }

        let _ = current_spell;
        mana_ability_map.insert(shard, new_abilities);
    }
}

fn group_sources_by_mana_color(
    game: &GameState,
    player: PlayerId,
    reserved_sacrifices: &[CardId],
    payment_ctx: Option<&crate::mana::ManaPaymentContext>,
    filter_reflected_replacements: bool,
) -> IndexMap<i32, Vec<ManaAbilityRef>> {
    group_sources_by_mana_color_inner(
        game,
        player,
        reserved_sacrifices,
        payment_ctx,
        filter_reflected_replacements,
        false,
    )
}

fn group_sources_by_mana_color_inner(
    game: &GameState,
    player: PlayerId,
    reserved_sacrifices: &[CardId],
    payment_ctx: Option<&crate::mana::ManaPaymentContext>,
    filter_reflected_replacements: bool,
    skip_self_restriction: bool,
) -> IndexMap<i32, Vec<ManaAbilityRef>> {
    let mut mana_map: IndexMap<i32, Vec<ManaAbilityRef>> = IndexMap::new();
    let mut source_order = 0usize;

    for card_id in get_available_mana_sources(game, player, reserved_sacrifices) {
        let card = game.card(card_id);
        let mut explicit_mana_added = false;

        for ab in &card.activated_abilities {
            if !is_payable_mana_ability_with_self_check(
                game,
                player,
                card_id,
                ab,
                reserved_sacrifices,
                payment_ctx,
                !skip_self_restriction,
            ) {
                continue;
            }
            // Handle ManaReflected abilities (e.g. The Grey Havens).
            // Java has two paths here:
            // - `ComputerUtilMana.groupSourcesByManaColor` predicts
            //   ProduceMana replacements against the placeholder original
            //   mana ("1"), which can hide reflected colors from castability
            //   probes when an amount-only replacement such as Nyxbloom is
            //   active.
            // - harness `AutoPay.producedAtoms` uses actual reflected colors
            //   for real payment.
            if ab.is_mana_reflected {
                let reflected_atoms = if filter_reflected_replacements {
                    super::reflected_atoms_for_availability(game, player, card_id, ab)
                } else {
                    super::compute_reflected_atoms(game, player, card_id, ab)
                };
                if !reflected_atoms.is_empty() {
                    explicit_mana_added = true;
                    let ma = ManaAbilityRef {
                        card_id,
                        ability_index: Some(ab.ability_index),
                        atoms: reflected_atoms,
                        amount: parse_mana_ability_amount_with_game(
                            ab,
                            Some(game),
                            Some(card_id),
                            Some(player),
                        ),
                        mana_text: ab
                            .produced_ir
                            .as_ref()
                            .map(crate::ability::ProducedMana::as_script_text)
                            .unwrap_or("1".into())
                            .into_owned(),
                        produced_ir: ab.produced_ir.clone(),
                        source_order,
                    };
                    source_order += 1;
                    add_mana_ability_to_color_map(&mut mana_map, &ma);
                }
                continue;
            }

            let Some(produced_ir) = ab.produced_ir.as_ref() else {
                continue;
            };
            let produced = produced_ir.as_script_text();
            // Combo ColorIdentity (e.g. Arcane Signet): atoms come from the
            // commander's color identity, not the produced string literal.
            // Must be handled here so auto-pay can see these sources — the
            // availability check in `mana::mod.rs` already honours the same
            // rule for playability.
            // Special <kind> (e.g. Bloom Tender's "Special EachColorAmong_Valid Permanent.YouCtrl"):
            // atoms are computed by inspecting permanents at availability time and the
            // ability produces one mana per distinct color (so the fixed multiplier
            // matches the atom count — keeps the auto-pay budget aligned with reality).
            let mut special_atom_multiplier: Option<i32> = None;
            let atoms = if ab
                .produced_ir
                .as_ref()
                .is_some_and(crate::ability::ProducedMana::is_combo_color_identity)
            {
                let colors = game.player_commander_color_identity(player);
                if colors.is_empty() {
                    Vec::new()
                } else {
                    chosen_colors_to_atoms(&colors)
                }
            } else if let Some(special) = ab
                .produced_ir
                .as_ref()
                .and_then(crate::ability::ProducedMana::special_kind)
            {
                let special_atoms =
                    crate::ability::effects::mana_effect::available_special_mana_atoms(
                        game, card_id, player, special,
                    );
                special_atom_multiplier = Some(special_atoms.len().max(1) as i32);
                special_atoms
            } else {
                let intrinsic = produced_ir.to_atoms(&card.chosen_colors);
                super::java_replacement_filtered_atoms_for_availability(
                    game, player, card_id, ab, &intrinsic,
                )
            };
            if atoms.is_empty()
                && !ab
                    .produced_ir
                    .as_ref()
                    .is_some_and(crate::ability::ProducedMana::is_combo_color_identity)
            {
                continue;
            }

            explicit_mana_added = true;
            let fixed_output_multiplier = special_atom_multiplier
                .or_else(|| produced_ir.fixed_atoms().map(|a| a.len() as i32))
                .unwrap_or(1);
            let replacement_multiplier = atoms
                .iter()
                .map(|&atom| {
                    super::replacement_adjusted_atoms_for_availability(game, player, card_id, atom)
                        .len() as i32
                })
                .max()
                .unwrap_or(1)
                .max(1);
            let ma = ManaAbilityRef {
                card_id,
                ability_index: Some(ab.ability_index),
                atoms: atoms.clone(),
                amount: parse_mana_ability_amount_with_game(
                    ab,
                    Some(game),
                    Some(card_id),
                    Some(player),
                ) * fixed_output_multiplier
                    * replacement_multiplier,
                mana_text: produced.to_string(),
                produced_ir: ab.produced_ir.clone(),
                source_order,
            };
            source_order += 1;
            add_mana_ability_to_color_map(&mut mana_map, &ma);
        }

        if !explicit_mana_added
            && card.zone == ZoneType::Battlefield
            && card.is_land()
            && !card.tapped
        {
            let mut atoms = all_basic_subtype_atoms(card);
            if atoms.is_empty() {
                if let Some(a) = basic_land_mana_atom(card) {
                    atoms.push(a);
                }
            }
            for atom in atoms {
                let replacement_multiplier =
                    super::replacement_adjusted_atoms_for_availability(game, player, card_id, atom)
                        .len() as i32;
                let ma = ManaAbilityRef {
                    card_id,
                    ability_index: None,
                    atoms: vec![atom],
                    amount: replacement_multiplier.max(1),
                    mana_text: atom_short(atom).to_string(),
                    produced_ir: None,
                    source_order,
                };
                source_order += 1;
                add_mana_ability_to_color_map(&mut mana_map, &ma);
            }
        }
    }

    mana_map
}

fn add_mana_ability_to_color_map(
    map: &mut IndexMap<i32, Vec<ManaAbilityRef>>,
    ma: &ManaAbilityRef,
) {
    map.entry(ManaAtom::GENERIC as i32)
        .or_default()
        .push(ma.clone());

    for &atom in &ma.atoms {
        map.entry(atom as i32).or_default().push(ma.clone());
    }
}

pub fn collect_mana_payment_sources(
    game: &GameState,
    player: PlayerId,
    reserved_sacrifices: &[CardId],
) -> ManaPaymentSources {
    let source_cards = get_available_mana_sources(game, player, reserved_sacrifices);
    let mut mana_ability_options = Vec::new();

    for &card_id in &source_cards {
        let card = game.card(card_id);
        for ab in &card.activated_abilities {
            if !is_payable_mana_ability(game, player, card_id, ab, reserved_sacrifices, None) {
                continue;
            }
            let (produced_mana, produced_mana_amount) =
                crate::mana::mana_ability_prompt_metadata(game, card_id, player, ab);
            mana_ability_options.push(ManaAbilityOption {
                card_id,
                ability_index: ab.ability_index,
                description: ab.ability_text.clone(),
                cost: ab.cost_string(),
                produced_mana,
                produced_mana_amount,
            });
        }
    }

    ManaPaymentSources {
        source_cards,
        mana_ability_options,
    }
}

pub fn can_pay_mana_cost_with_reserved_sacrifices(
    game: &GameState,
    pool: &ManaPool,
    player: PlayerId,
    excluded_source: CardId,
    cost: &crate::cost::Cost,
    reserved_sacrifices: &[CardId],
    payment_ctx: Option<&crate::mana::ManaPaymentContext>,
) -> bool {
    let mana_cost = mana_cost_from_cost(cost);
    let mut source_masks: Vec<u16> = Vec::new();

    for _ in 0..pool.white() {
        source_masks.push(ManaAtom::WHITE);
    }
    for _ in 0..pool.blue() {
        source_masks.push(ManaAtom::BLUE);
    }
    for _ in 0..pool.black() {
        source_masks.push(ManaAtom::BLACK);
    }
    for _ in 0..pool.red() {
        source_masks.push(ManaAtom::RED);
    }
    for _ in 0..pool.green() {
        source_masks.push(ManaAtom::GREEN);
    }
    source_masks.extend(std::iter::repeat_n(0, pool.colorless() as usize));

    for &card_id in game.cards_in_zone(ZoneType::Battlefield, player) {
        if card_id == excluded_source {
            continue;
        }
        let card = game.card(card_id);
        let mut source_mask = 0u16;
        for ab in &card.activated_abilities {
            if !ab.is_mana_ability
                || ab
                    .cost
                    .parts
                    .iter()
                    .any(|p| matches!(p, CostPart::Mana { .. }))
            {
                continue;
            }
            if !is_payable_mana_ability(game, player, card_id, ab, reserved_sacrifices, payment_ctx)
            {
                continue;
            }
            if ab.is_mana_reflected {
                for atom in super::compute_reflected_atoms(game, player, card_id, ab) {
                    source_mask |= atom;
                }
            } else if let Some(produced_ir) = ab.produced_ir.as_ref() {
                if produced_ir.is_combo_color_identity() {
                    let colors = game.player_commander_color_identity(player);
                    if !colors.is_empty() {
                        let mut combo = 0u16;
                        for atom in chosen_colors_to_atoms(&colors) {
                            combo |= atom;
                        }
                        source_mask |= combo;
                    }
                } else if let Some(fixed_atoms) = produced_ir.fixed_atoms() {
                    for atom in fixed_atoms {
                        source_masks.push(atom);
                    }
                    source_mask = 0;
                    break;
                } else {
                    for atom in produced_ir.to_atoms(&card.chosen_colors) {
                        source_mask |= atom;
                    }
                }
            }
        }

        if source_mask != 0 {
            source_masks.push(source_mask);
            continue;
        }

        if card.is_land() && !card.tapped {
            let implicit_atoms = all_basic_subtype_atoms(card);
            if !implicit_atoms.is_empty() {
                let mut implicit_mask = 0u16;
                for atom in implicit_atoms {
                    implicit_mask |= atom;
                }
                source_masks.push(implicit_mask);
            } else if let Some(atom) = basic_land_mana_atom(card) {
                source_masks.push(atom);
            }
        }
    }

    let mut requirements = Vec::new();
    for shard in mana_cost.shards() {
        let color_mask = u16::from(shard.color_mask());
        if color_mask != 0 {
            requirements.push(color_mask);
        }
    }
    let generic_count = mana_cost.generic_cost();
    if source_masks.len() < requirements.len() + generic_count as usize {
        return false;
    }

    requirements.sort_by(|&a, &b| {
        let count_a = source_masks.iter().filter(|src| (**src & a) != 0).count();
        let count_b = source_masks.iter().filter(|src| (**src & b) != 0).count();
        count_a.cmp(&count_b).then(a.cmp(&b))
    });

    let mut committed = std::collections::HashSet::new();
    for requirement in requirements {
        let mut best_index: Option<usize> = None;
        let mut best_pop = usize::MAX;
        let mut best_mask = u16::MAX;
        for (i, source_mask) in source_masks.iter().copied().enumerate() {
            if committed.contains(&i) || (source_mask & requirement) == 0 {
                continue;
            }
            let pop = source_mask.count_ones() as usize;
            if pop < best_pop || (pop == best_pop && source_mask < best_mask) {
                best_index = Some(i);
                best_pop = pop;
                best_mask = source_mask;
            }
        }
        let Some(best_index) = best_index else {
            return false;
        };
        committed.insert(best_index);
    }

    source_masks.len() - committed.len() >= generic_count as usize
}

pub fn can_pay_spell_mana_cost_for_action_space(
    game: &GameState,
    pool: &ManaPool,
    player: PlayerId,
    current_spell: CardId,
    cost: &forge_foundation::ManaCost,
    payment_ctx: &crate::mana::ManaPaymentContext,
) -> bool {
    let mut unpaid = ManaCostBeingPaid::from_mana_cost(cost);
    let mut simulated_pool = pool.clone();
    simulated_pool.pay_unpaid_for_spell_incremental(&mut unpaid, payment_ctx, false);
    if unpaid.is_paid() {
        return true;
    }

    let mut used_sources = std::collections::HashSet::new();
    let mut guard = 0u32;
    while !unpaid.is_paid() && guard < 128 {
        guard += 1;

        let mana_ability_map =
            group_sources_by_mana_color_inner(game, player, &[], Some(payment_ctx), true, true);
        if mana_ability_map.is_empty() {
            break;
        }

        let mut candidates =
            collect_sorted_candidates_with_pref(game, player, &mana_ability_map, true);
        candidates.retain(|candidate| {
            !used_sources.contains(&candidate.card_id) && candidate.card_id != current_spell
        });
        if candidates.is_empty() {
            break;
        }

        let Some((sa_payment, to_pay)) = choose_candidate(
            game,
            player,
            Some(current_spell),
            &candidates,
            &unpaid,
            false,
            &[],
        ) else {
            break;
        };

        let Some(chosen_atom) = choose_atom_for_shard(&sa_payment, to_pay) else {
            break;
        };
        let produced = if let Some(fixed_atoms) =
            fixed_output_atoms_for_payment(game, player, &sa_payment)
        {
            let repeats = (sa_payment.amount.max(1) as usize)
                .checked_div(fixed_atoms.len().max(1))
                .unwrap_or(1)
                .max(1);
            let adjusted_atoms = replacement_adjusted_atoms_for_payment(
                game,
                player,
                sa_payment.card_id,
                &fixed_atoms,
                repeats,
            );
            let mana_string = atoms_as_mana_string(&adjusted_atoms);
            let params = ManaProductionParams {
                source_card: sa_payment.card_id,
                is_snow: game.card(sa_payment.card_id).type_line.is_snow(),
                restriction: None,
                adds_no_counter: false,
                adds_keywords: None,
                adds_keywords_valid: None,
                adds_counters: None,
                adds_counters_valid: None,
                triggers_when_spent: None,
            };
            add_produced_mana_to_pool(&mut simulated_pool, &mana_string, &params);
            mana_string
        } else {
            let mut callback = None;
            let mana_string =
                auto_pay_base_mana_string(game, player, &sa_payment, chosen_atom, &mut callback);
            let produced_ir = crate::ability::ProducedMana::from_raw_boundary(&mana_string);
            let adjusted_atoms = produced_ir
                .fixed_atoms()
                .unwrap_or_else(|| produced_ir.to_atoms(&[]))
                .into_iter()
                .flat_map(|atom| {
                    super::replacement_adjusted_atoms_for_availability(
                        game,
                        player,
                        sa_payment.card_id,
                        atom,
                    )
                })
                .collect::<Vec<_>>();
            let mana_string = if adjusted_atoms.is_empty() {
                mana_string
            } else {
                atoms_as_mana_string(&adjusted_atoms)
            };
            let params = ManaProductionParams {
                source_card: sa_payment.card_id,
                is_snow: game.card(sa_payment.card_id).type_line.is_snow(),
                restriction: None,
                adds_no_counter: false,
                adds_keywords: None,
                adds_keywords_valid: None,
                adds_counters: None,
                adds_counters_valid: None,
                triggers_when_spent: None,
            };
            add_produced_mana_to_pool(&mut simulated_pool, &mana_string, &params);
            mana_string
        };
        add_taps_for_mana_trigger_mana_impl(
            game,
            &mut simulated_pool,
            player,
            &sa_payment,
            &produced,
            false,
        );
        simulated_pool.pay_unpaid_for_spell_incremental(&mut unpaid, payment_ctx, false);

        used_sources.insert(sa_payment.card_id);
    }

    unpaid.is_paid()
        || (unpaid.contains_only_phyrexian_mana()
            && game.player(player).life > required_phyrexian_life(&unpaid))
}

fn replacement_adjusted_atoms_for_payment(
    game: &GameState,
    player: PlayerId,
    source: CardId,
    atoms: &[u16],
    repeats: usize,
) -> Vec<u16> {
    let mut adjusted = Vec::new();
    for &atom in atoms {
        for _ in 0..repeats {
            adjusted.extend(super::replacement_adjusted_atoms_for_availability(
                game, player, source, atom,
            ));
        }
    }
    adjusted
}

fn atoms_as_mana_string(atoms: &[u16]) -> String {
    atoms
        .iter()
        .map(|&atom| atom_short(atom))
        .collect::<Vec<_>>()
        .join(" ")
}

fn fixed_output_atoms_for_payment(
    game: &GameState,
    player: PlayerId,
    mana_ability: &ManaAbilityRef,
) -> Option<Vec<u16>> {
    if let Some(fixed_atoms) = mana_ability
        .produced_ir
        .as_ref()
        .and_then(crate::ability::ProducedMana::fixed_atoms)
    {
        return Some(fixed_atoms);
    }
    let special = mana_ability
        .produced_ir
        .as_ref()
        .and_then(crate::ability::ProducedMana::special_kind)?;
    let atoms = crate::ability::effects::mana_effect::available_special_mana_atoms(
        game,
        mana_ability.card_id,
        player,
        special,
    );
    if atoms.is_empty() {
        None
    } else {
        Some(atoms)
    }
}

fn get_available_mana_sources(
    game: &GameState,
    player: PlayerId,
    reserved_sacrifices: &[CardId],
) -> Vec<CardId> {
    let mut sources: Vec<CardId> = game.cards_in_zone(ZoneType::Battlefield, player).to_vec();

    for &cid in game.cards_in_zone(ZoneType::Hand, player) {
        let card = game.card(cid);
        if card
            .activated_abilities
            .iter()
            .any(|ab| is_payable_mana_ability(game, player, cid, ab, reserved_sacrifices, None))
        {
            sources.push(cid);
        }
    }

    sources.retain(|&cid| {
        let card = game.card(cid);
        for ab in &card.activated_abilities {
            if is_payable_mana_ability(game, player, cid, ab, reserved_sacrifices, None) {
                return true;
            }
        }
        if card.zone != ZoneType::Battlefield || card.tapped || !card.is_land() {
            return false;
        }
        let has_subtype = !all_basic_subtype_atoms(card).is_empty();
        let has_basic = basic_land_mana_atom(card).is_some();
        has_subtype || has_basic
    });
    sources
}

fn is_payable_mana_ability(
    game: &GameState,
    player: PlayerId,
    card_id: CardId,
    ab: &crate::ability::activated::ActivatedAbility,
    reserved_sacrifices: &[CardId],
    payment_ctx: Option<&crate::mana::ManaPaymentContext>,
) -> bool {
    is_payable_mana_ability_with_self_check(
        game,
        player,
        card_id,
        ab,
        reserved_sacrifices,
        payment_ctx,
        true,
    )
}

fn is_payable_mana_ability_with_self_check(
    game: &GameState,
    player: PlayerId,
    card_id: CardId,
    ab: &crate::ability::activated::ActivatedAbility,
    reserved_sacrifices: &[CardId],
    payment_ctx: Option<&crate::mana::ManaPaymentContext>,
    apply_self_check: bool,
) -> bool {
    if !ab.is_mana_ability {
        return false;
    }
    let card = game.card(card_id);
    match card.zone {
        ZoneType::Battlefield => {
            if ab.activation_zone == Some(ZoneType::Hand) {
                return false;
            }
        }
        ZoneType::Hand => {
            if ab.activation_zone != Some(ZoneType::Hand) {
                return false;
            }
        }
        _ => return false,
    }
    if ab
        .cost
        .parts
        .iter()
        .any(|p| matches!(p, CostPart::Mana { .. }))
    {
        return false;
    }
    if !can_pay_ignoring_mana(&ab.cost, game, card_id, player) {
        return false;
    }
    if !crate::mana::mana_ability_meets_script_requirements(game, card_id, ab) {
        return false;
    }
    if let Some(ctx) = payment_ctx {
        if let Some(raw) = ab.restrict_valid.as_deref() {
            let card = game.card(card_id);
            let resolved = if raw.contains("ChosenType") {
                let chosen = card.chosen_type.clone().unwrap_or_default();
                raw.replace("ChosenType", &chosen)
            } else {
                raw.to_string()
            };
            if !crate::mana::mana_meets_restriction(&resolved, ctx) {
                return false;
            }
            // ActionSpace.java:277 (permissive) vs AutoPay.canPayShard:273
            // (strict self-check). Action-space probes use the permissive form.
            if apply_self_check {
                let self_ctx = crate::mana::ManaPaymentContext {
                    is_spell: false,
                    is_activated_ability: true,
                    sa_on_stack: false,
                    type_line: Some(card.type_line.clone()),
                    card_name: Some(card.card_name.clone()),
                    card_color: Some(card.color),
                    chosen_types_by_source: ctx.chosen_types_by_source.clone(),
                };
                if !crate::mana::mana_meets_restriction(&resolved, &self_ctx) {
                    return false;
                }
            }
        }
    }
    can_pay_mana_ability_costs_with_reserved(
        game,
        player,
        card_id,
        &ab.cost.parts,
        reserved_sacrifices,
    )
}

fn can_pay_mana_ability_costs_with_reserved(
    game: &GameState,
    player: PlayerId,
    source_id: CardId,
    cost_parts: &[CostPart],
    reserved_sacrifices: &[CardId],
) -> bool {
    for part in cost_parts {
        if !can_pay_source_paid_mana_cost_part(
            game,
            player,
            source_id,
            part,
            None,
            true,
            reserved_sacrifices,
        ) {
            return false;
        }
    }
    true
}

fn required_phyrexian_life(unpaid: &ManaCostBeingPaid) -> i32 {
    unpaid
        .get_distinct_shards()
        .into_iter()
        .filter(|shard| shard.is_phyrexian())
        .map(|shard| unpaid.get_unpaid_shards(shard) * 2)
        .sum()
}

fn score_mana_producing_card(game: &GameState, card_id: CardId, player: PlayerId) -> i32 {
    let card = game.card(card_id);
    let mut score = 0;
    let mut has_mana_ability = false;

    for ab in &card.activated_abilities {
        if ab.is_mana_ability {
            score += score_mana_ability(game, card_id, ab, None);
            has_mana_ability = true;
        } else if can_pay_ignoring_mana(&ab.cost, game, card_id, player) {
            score += 13;
        }
    }

    if !has_mana_ability && card.is_land() {
        let mut subtype_atoms = all_basic_subtype_atoms(card);
        if subtype_atoms.is_empty() {
            if let Some(a) = basic_land_mana_atom(card) {
                subtype_atoms.push(a);
            }
        }
        for atom in subtype_atoms {
            score += score_implicit_land_mana_ability(atom);
        }
    }

    if card.can_attack() {
        score += 13;
    }
    if card.can_block() {
        score += 13;
    }

    score
}

fn score_mana_ability(
    game: &GameState,
    card_id: CardId,
    ab: &crate::ability::activated::ActivatedAbility,
    produced_override: Option<&crate::ability::ProducedMana>,
) -> i32 {
    let mut score = 0;
    let card = game.card(card_id);

    let orig_produced = ab.produced_ir.as_ref();
    if ab
        .produced_ir
        .as_ref()
        .is_some_and(crate::ability::ProducedMana::is_combo_color_identity)
    {
        score += 7;
        for part in &ab.cost.parts {
            match part {
                CostPart::PayLife(_) => score += 3,
                CostPart::Sacrifice { type_filter, .. } => {
                    score += 6;
                    if type_filter != "CARDNAME" {
                        score += 40;
                    }
                }
                CostPart::Discard { .. } => score += 6,
                _ => {}
            }
            score += 1;
        }
        return score;
    }
    let is_any_mana = ab
        .produced_ir
        .as_ref()
        .is_some_and(crate::ability::ProducedMana::is_any_like);
    if is_any_mana {
        score += 7;
    } else if orig_produced.is_none() {
        score += 2;
    } else if let Some(produced) = produced_override.or(orig_produced) {
        let mana_text = ability_mana_text_for_score_ir(produced, &card.chosen_colors);
        if mana_text == "Any" {
            score += 7;
        } else {
            let tokens = mana_text
                .split_whitespace()
                .filter(|t| !t.is_empty())
                .count();
            score += tokens.max(1) as i32;
            if !mana_text.contains('C') {
                score += 1;
            }
        }
    } else {
        score += 1;
    }

    for part in &ab.cost.parts {
        match part {
            CostPart::PayLife(_) => score += 3,
            CostPart::Sacrifice { type_filter, .. } => {
                score += 6;
                if type_filter != "CARDNAME" {
                    score += 40;
                }
            }
            CostPart::Discard { .. } => score += 6,
            _ => {}
        }
        score += 1;
    }

    score
}

/// Lower scores are picked first. Lands score low; creatures score high (+26).
/// This ensures lands are tapped before valuable mana dorks.
fn sort_sources_for_autopay(
    game: &GameState,
    player: PlayerId,
    sources_for_shards: &mut IndexMap<ManaCostShard, Vec<ManaAbilityRef>>,
) {
    for abilities in sources_for_shards.values_mut() {
        abilities.sort_by(|a, b| {
            // Score per-ability (not per-card) so that different abilities on the same
            // card (e.g. Yavimaya Coast's {C} vs {G}/{U}) get accurate individual scores.
            let sa = autopay_source_score(game, player, a) * 1000 + a.source_order as i32;
            let sb = autopay_source_score(game, player, b) * 1000 + b.source_order as i32;
            sa.cmp(&sb)
        });
    }
}

/// - Mana ability score based on produced colors
/// - +cost_parts.size() for activation cost complexity
/// - +13 per combat role (attack/block) for creatures
fn autopay_source_score(game: &GameState, _player: PlayerId, ma: &ManaAbilityRef) -> i32 {
    let card = game.card(ma.card_id);
    let mut score = if ma
        .produced_ir
        .as_ref()
        .is_some_and(crate::ability::ProducedMana::is_combo_color_identity)
    {
        score_atoms_for_autopay(&ma.atoms).unwrap_or(2)
    } else if ma
        .produced_ir
        .as_ref()
        .is_some_and(crate::ability::ProducedMana::is_any_like)
    {
        7
    } else if ma.mana_text == "Any" {
        7
    } else if ma.mana_text == "1" && ma.atoms.is_empty() {
        1
    } else {
        let produced = ma.mana_text.clone();
        let tokens = produced
            .split_whitespace()
            .filter(|token| !token.is_empty())
            .count();
        let mut score = tokens.max(1) as i32;
        if !produced.contains('C') {
            score += 1;
        }
        score
    };

    if let Some(ab_idx) = ma.ability_index {
        if let Some(ab) = card.activated_abilities.get(ab_idx) {
            score += ab.cost.parts.len() as i32;
        }
    } else {
        score = score_implicit_land_mana_ability(
            ma.atoms.first().copied().unwrap_or(ManaAtom::COLORLESS),
        );
    }

    if card.is_creature() {
        score += 13;
        score += 13;
    }

    score
}

fn score_atoms_for_autopay(atoms: &[u16]) -> Option<i32> {
    if atoms.is_empty() {
        return None;
    }
    let mut produced = atoms
        .iter()
        .copied()
        .filter(|&atom| atom != ManaAtom::GENERIC)
        .map(atom_short)
        .collect::<Vec<_>>();
    produced.sort_unstable();
    produced.dedup();
    if produced.is_empty() {
        return None;
    }
    let mut score = produced.len().max(1) as i32;
    if !produced.contains(&"C") {
        score += 1;
    }
    Some(score)
}

fn score_implicit_land_mana_ability(atom: u16) -> i32 {
    let mut score = 0;
    let text = atom_short(atom);
    score += text.len() as i32;
    if atom != ManaAtom::COLORLESS {
        score += 1;
    }
    score += 1;
    score
}

fn ability_mana_text_for_score_ir(
    produced_ir: &crate::ability::ProducedMana,
    chosen_colors: &[String],
) -> String {
    if produced_ir.is_any_like() {
        return "Any".to_string();
    }
    let atoms = produced_ir.to_atoms(chosen_colors);
    if atoms.is_empty() {
        return String::new();
    }

    atoms
        .into_iter()
        .map(atom_short)
        .collect::<Vec<_>>()
        .join(" ")
}

/// Auto-tap untapped lands to produce `needed` additional generic mana.
/// Used for paying commander tax on top of the regular cost.
pub fn auto_tap_lands_generic(
    game: &mut GameState,
    pool: &mut ManaPool,
    player: PlayerId,
    needed: i32,
) -> Vec<CardId> {
    let deficit = (needed - pool.total_mana()).max(0);
    if deficit <= 0 {
        return Vec::new();
    }

    let mut remaining = deficit;
    let mut tapped_lands: Vec<CardId> = Vec::new();

    for card_id in get_available_mana_sources(game, player, &[]) {
        if remaining <= 0 {
            break;
        }
        let card = game.card(card_id);
        if !card.is_land() || card.tapped {
            continue;
        }
        let mut atoms = all_basic_subtype_atoms(card);
        if atoms.is_empty() {
            if let Some(a) = basic_land_mana_atom(card) {
                atoms.push(a);
            }
        }

        let atom = if atoms.contains(&ManaAtom::COLORLESS) {
            ManaAtom::COLORLESS
        } else {
            atoms.first().copied().unwrap_or(ManaAtom::COLORLESS)
        };

        tap_land_for_mana(
            game,
            pool,
            player,
            card_id,
            atom,
            true,
            &mut tapped_lands,
            None,
        );
        remaining -= 1;
    }

    tapped_lands
}

fn source_requires_tap(game: &GameState, ma: &ManaAbilityRef) -> bool {
    match ma.ability_index {
        // Implicit mana abilities (basic/subtype lands) always require tapping.
        None => true,
        Some(ab_idx) => game.card(ma.card_id).activated_abilities[ab_idx]
            .cost
            .parts
            .iter()
            .any(|p| matches!(p, CostPart::Tap)),
    }
}

/// Resolve the Amount param for a mana ability, supporting SVar expressions
/// like `IncubationAmount` → `Count$Compare Y GE1.3.1`.
fn parse_mana_ability_amount_with_game(
    ab: &crate::ability::activated::ActivatedAbility,
    game: Option<&GameState>,
    card_id: Option<CardId>,
    player: Option<PlayerId>,
) -> i32 {
    let Some(amount_str) = ab.amount.as_deref() else {
        return 1;
    };
    // Try direct integer parse first
    if let Ok(n) = amount_str.parse::<i32>() {
        return if n > 0 { n } else { 1 };
    }
    // It's an SVar reference — resolve it using the source card's SVars
    if let (Some(game), Some(cid), Some(pid)) = (game, card_id, player) {
        if let Some(svar_expr) = game.card(cid).svars.get(amount_str) {
            if svar_expr.starts_with("Count$") {
                return crate::ability::effects::resolve_count_svar(svar_expr, game, cid, pid);
            }
            return svar_expr.parse::<i32>().unwrap_or(1);
        }
    }
    1
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card::Card;
    use forge_foundation::{CardTypeLine, ColorSet};

    fn make_card(
        id: u32,
        owner: PlayerId,
        name: &str,
        type_line: &str,
        abilities: Vec<&str>,
    ) -> Card {
        Card::new(
            CardId(id),
            name.to_string(),
            owner,
            CardTypeLine::parse(type_line),
            ManaCost::no_cost(),
            ColorSet::COLORLESS,
            None,
            None,
            vec![],
            abilities.into_iter().map(|s| s.to_string()).collect(),
        )
    }

    #[test]
    fn auto_tap_does_not_spend_reserved_source_on_mana_sacrifice_costs_by_default() {
        let mut game = GameState::new(&["P1", "P2"], 20);
        let player = PlayerId(0);
        let mut pool = ManaPool::new();

        let reserved_food = game.create_card(make_card(
            1,
            player,
            "Food Token",
            "Artifact Food",
            vec!["AB$ GainLife | Cost$ 2 T Sac<1/CARDNAME> | LifeAmount$ 3"],
        ));
        let goose = game.create_card(make_card(
            2,
            player,
            "Gilded Goose",
            "Creature Bird",
            vec!["AB$ Mana | Cost$ T Sac<1/Food> | Produced$ Any"],
        ));
        let forest = game.create_card(make_card(
            3,
            player,
            "Forest",
            "Land Forest",
            vec!["AB$ Mana | Cost$ T | Produced$ G"],
        ));

        game.add_card_to_zone(ZoneType::Battlefield, player, reserved_food);
        game.add_card_to_zone(ZoneType::Battlefield, player, goose);
        game.add_card_to_zone(ZoneType::Battlefield, player, forest);
        game.card_mut(reserved_food).zone = ZoneType::Battlefield;
        game.card_mut(goose).zone = ZoneType::Battlefield;
        game.card_mut(forest).zone = ZoneType::Battlefield;
        game.card_mut(reserved_food).summoning_sick = false;
        game.card_mut(goose).summoning_sick = false;
        game.card_mut(forest).summoning_sick = false;

        let tapped = auto_tap_lands(
            &mut game,
            &mut pool,
            player,
            &ManaCost::parse("2"),
            Some(reserved_food),
        );

        assert_eq!(pool.total_mana(), 1);
        assert_eq!(tapped, vec![forest]);
        assert!(!game.card(goose).tapped);
        assert_eq!(game.card(goose).zone, ZoneType::Battlefield);
        assert_eq!(game.card(reserved_food).zone, ZoneType::Battlefield);
    }

    #[test]
    fn auto_tap_can_spend_reserved_source_when_explicitly_allowed() {
        let mut game = GameState::new(&["P1", "P2"], 20);
        let player = PlayerId(0);
        let mut pool = ManaPool::new();

        let reserved_food = game.create_card(make_card(
            1,
            player,
            "Food Token",
            "Artifact Food",
            vec!["AB$ GainLife | Cost$ 2 T Sac<1/CARDNAME> | LifeAmount$ 3"],
        ));
        let goose = game.create_card(make_card(
            2,
            player,
            "Gilded Goose",
            "Creature Bird",
            vec!["AB$ Mana | Cost$ T Sac<1/Food> | Produced$ Any"],
        ));
        let forest = game.create_card(make_card(
            3,
            player,
            "Forest",
            "Land Forest",
            vec!["AB$ Mana | Cost$ T | Produced$ G"],
        ));

        for cid in [reserved_food, goose, forest] {
            game.add_card_to_zone(ZoneType::Battlefield, player, cid);
            game.card_mut(cid).zone = ZoneType::Battlefield;
            game.card_mut(cid).summoning_sick = false;
        }

        let tapped = auto_tap_lands_allow_reserved_source_reuse(
            &mut game,
            &mut pool,
            player,
            &ManaCost::parse("2"),
            Some(reserved_food),
        );

        assert_eq!(pool.total_mana(), 2);
        // Auto-tapper prefers simpler sources: Forest (score 3) before Goose (score 35).
        assert_eq!(tapped, vec![forest, goose]);
        assert!(game.card(goose).tapped);
        assert!(game.card(forest).tapped);
        assert_eq!(game.card(goose).zone, ZoneType::Battlefield);
        assert_eq!(game.card(reserved_food).zone, ZoneType::Graveyard);
    }

    #[test]
    fn auto_tap_uses_battlefield_order_for_generic_payment() {
        let mut game = GameState::new(&["P1", "P2"], 20);
        let player = PlayerId(0);
        let mut pool = ManaPool::new();

        let plains = game.create_card(make_card(
            1,
            player,
            "Plains",
            "Land",
            vec!["AB$ Mana | Cost$ T | Produced$ W"],
        ));
        let mountain = game.create_card(make_card(
            2,
            player,
            "Mountain",
            "Land",
            vec!["AB$ Mana | Cost$ T | Produced$ R"],
        ));
        let forest = game.create_card(make_card(
            3,
            player,
            "Forest",
            "Land Forest",
            vec!["AB$ Mana | Cost$ T | Produced$ G"],
        ));

        for cid in [plains, mountain, forest] {
            game.add_card_to_zone(ZoneType::Battlefield, player, cid);
            game.card_mut(cid).zone = ZoneType::Battlefield;
            game.card_mut(cid).summoning_sick = false;
        }

        let tapped = auto_tap_lands(&mut game, &mut pool, player, &ManaCost::parse("2"), None);

        assert_eq!(pool.total_mana(), 2);
        assert_eq!(tapped, vec![plains, mountain]);
        assert!(game.card(plains).tapped);
        assert!(game.card(mountain).tapped);
        assert!(!game.card(forest).tapped);
    }

    #[test]
    fn auto_tap_calls_confirm_payment_for_self_sacrifice() {
        let mut game = GameState::new(&["P1", "P2"], 20);
        let player = PlayerId(0);

        // Create a Treasure Token (self-sacrifice for mana)
        let treasure = game.create_card(make_card(
            1,
            player,
            "Treasure Token",
            "Artifact Treasure",
            vec!["AB$ Mana | Cost$ T Sac<1/CARDNAME> | Produced$ Any"],
        ));

        game.add_card_to_zone(ZoneType::Battlefield, player, treasure);
        game.card_mut(treasure).zone = ZoneType::Battlefield;
        game.card_mut(treasure).summoning_sick = false;

        // Test 1: confirm_payment returns true (ACCEPT)
        {
            let mut pool = ManaPool::new();
            let tapped = {
                let game_ptr: *mut GameState = &mut game;
                let mut callback = |kind: ManaPayCallback<'_>| -> Option<CardId> {
                    match kind {
                        ManaPayCallback::ChooseSacrifice(_) => None,
                        ManaPayCallback::ChooseColor(_) => None,
                        ManaPayCallback::ChooseTapType { .. } => None,
                        ManaPayCallback::ConfirmSelfSacrifice(cid) => {
                            assert_eq!(cid, treasure); // should be asking about Treasure
                            Some(cid) // confirm
                        }
                        ManaPayCallback::ConfirmSubCounter(cid) => Some(cid),
                        ManaPayCallback::ConfirmSourceExile(cid) => Some(cid),
                        ManaPayCallback::ConfirmPayLife(cid) => Some(cid),
                        ManaPayCallback::NotifySacrificeForMana(cid) => unsafe {
                            let game = &mut *game_ptr;
                            let owner = game.card(cid).owner;
                            game.move_card(cid, ZoneType::Graveyard, owner);
                            Some(cid)
                        },
                        ManaPayCallback::ApplyProduceManaReplacement { .. } => None,
                    }
                };

                auto_tap_lands_with_callbacks(
                    &mut game,
                    &mut pool,
                    player,
                    &ManaCost::parse("1"),
                    None,
                    &mut callback,
                )
            };

            // The confirm callback was called if the treasure was sacrificed
            assert_eq!(tapped, vec![treasure]);
            assert_eq!(game.card(treasure).zone, ZoneType::Graveyard);
            assert_eq!(pool.total_mana(), 1);
        }

        // Reset for test 2: create new treasure and add a Forest as fallback
        let treasure2 = game.create_card(make_card(
            2,
            player,
            "Treasure Token",
            "Artifact Treasure",
            vec!["AB$ Mana | Cost$ T Sac<1/CARDNAME> | Produced$ Any"],
        ));
        let forest = game.create_card(make_card(
            3,
            player,
            "Forest",
            "Land Forest",
            vec!["AB$ Mana | Cost$ T | Produced$ G"],
        ));
        game.add_card_to_zone(ZoneType::Battlefield, player, treasure2);
        game.add_card_to_zone(ZoneType::Battlefield, player, forest);
        game.card_mut(treasure2).zone = ZoneType::Battlefield;
        game.card_mut(treasure2).summoning_sick = false;
        game.card_mut(forest).zone = ZoneType::Battlefield;
        game.card_mut(forest).summoning_sick = false;

        // Test 2: confirm_payment returns false (DECLINE)
        {
            let mut pool = ManaPool::new();
            let tapped = {
                let game_ptr: *mut GameState = &mut game;
                let mut callback = |kind: ManaPayCallback<'_>| -> Option<CardId> {
                    match kind {
                        ManaPayCallback::ChooseSacrifice(_) => None,
                        ManaPayCallback::ChooseColor(_) => None,
                        ManaPayCallback::ChooseTapType { .. } => None,
                        ManaPayCallback::ConfirmSelfSacrifice(cid) => {
                            assert_eq!(cid, treasure2);
                            None // decline
                        }
                        ManaPayCallback::ConfirmSubCounter(cid) => Some(cid),
                        ManaPayCallback::ConfirmSourceExile(cid) => Some(cid),
                        ManaPayCallback::ConfirmPayLife(cid) => Some(cid),
                        ManaPayCallback::NotifySacrificeForMana(cid) => unsafe {
                            let game = &mut *game_ptr;
                            let owner = game.card(cid).owner;
                            game.move_card(cid, ZoneType::Graveyard, owner);
                            Some(cid)
                        },
                        ManaPayCallback::ApplyProduceManaReplacement { .. } => None,
                    }
                };

                auto_tap_lands_with_callbacks(
                    &mut game,
                    &mut pool,
                    player,
                    &ManaCost::parse("1"),
                    None,
                    &mut callback,
                )
            };

            // When declined, should fall back to Forest
            assert_eq!(tapped, vec![forest]);
            assert_eq!(game.card(treasure2).zone, ZoneType::Battlefield); // not sacrificed
            assert_eq!(game.card(forest).zone, ZoneType::Battlefield);
            assert_eq!(pool.total_mana(), 1);
        }
    }
}
