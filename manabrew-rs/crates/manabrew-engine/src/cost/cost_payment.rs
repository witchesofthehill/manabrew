use crate::agent::PlayerAgent;
use crate::cost::payment_decision::PaymentDecision;
use crate::cost::trait_cost_decision_maker::DefaultCostDecisionMaker;
use crate::cost::trait_cost_visitor::CostVisitor;
use crate::cost::{Cost, CostPart};
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};

pub struct CostPayment {
    /// The original, unadjusted cost.
    pub cost: Cost,
    /// The cost after adjustment (reductions, increases, etc.).
    pub adjusted_cost: Cost,
    /// The source card being paid for.
    pub source: CardId,
    /// The player paying the cost.
    pub player: PlayerId,
    /// Cost parts that have been successfully paid (for refund on cancel).
    pub paid_cost_parts: Vec<CostPart>,
    /// Whether we are paying as an effect (not a spell/ability activation).
    pub is_effect: bool,
}

impl CostPayment {
    /// Create a new `CostPayment` for the given cost and source.
    pub fn new(cost: Cost, source: CardId, player: PlayerId, is_effect: bool) -> Self {
        let adjusted_cost = cost.clone();
        CostPayment {
            cost,
            adjusted_cost,
            source,
            player,
            paid_cost_parts: Vec::new(),
            is_effect,
        }
    }

    /// Check if all cost parts have been paid.
    pub fn is_fully_paid(&self) -> bool {
        self.paid_cost_parts.len() == self.adjusted_cost.parts.len()
    }

    /// Refund all paid cost parts (on cancel/failure).
    pub fn refund_payment(&mut self, game: &mut GameState) {
        for part in &self.paid_cost_parts {
            refund_cost_part(game, self.source, self.player, part);
        }
        self.paid_cost_parts.clear();
    }

    pub fn pay_cost(&mut self, game: &mut GameState, agent: &mut dyn PlayerAgent) -> bool {
        // TODO: self.adjusted_cost = CostAdjustment::adjust(&self.cost, ...);
        let mut parts = self.adjusted_cost.parts.clone();

        if parts.len() > 1 {
            parts = agent.order_cost_parts(parts);
        }

        let mut decision_maker = DefaultCostDecisionMaker {
            player: self.player,
            ability: None,
            source: self.source,
            effect: self.is_effect,
            agent,
        };

        for part in &parts {
            let decision = decision_maker.visit(self.player, self.source, part, game);

            match decision {
                Some(pd) => {
                    if !pay_as_decided(game, self.player, self.source, part, &pd, self.is_effect) {
                        return false;
                    }
                    self.paid_cost_parts.push(part.clone());
                }
                None => {
                    return false;
                }
            }
        }

        true
    }

    /// Batch decide-then-pay flow (AI agents).
    pub fn pay_computer_costs(
        &mut self,
        game: &mut GameState,
        agent: &mut dyn PlayerAgent,
    ) -> bool {
        // TODO: adjust cost via CostAdjustment::adjust()
        let parts = self.adjusted_cost.parts.clone();
        let mut decision_maker = DefaultCostDecisionMaker {
            player: self.player,
            ability: None,
            source: self.source,
            effect: self.is_effect,
            agent,
        };

        // Phase 1: Collect all decisions
        let mut decisions: Vec<(CostPart, PaymentDecision)> = Vec::new();
        for part in &parts {
            let decision = decision_maker.visit(self.player, self.source, part, game);

            match decision {
                Some(pd) => {
                    if decision_maker.pays_right_after_decision()
                        && !pay_as_decided(
                            game,
                            self.player,
                            self.source,
                            part,
                            &pd,
                            self.is_effect,
                        )
                    {
                        return false;
                    }
                    decisions.push((part.clone(), pd));
                }
                None => return false,
            }
        }

        // Phase 2: Execute all decisions
        for (part, pd) in &decisions {
            if !pay_as_decided(game, self.player, self.source, part, pd, self.is_effect) {
                return false;
            }
        }

        true
    }

    /// Check if a cost can be paid as additional costs.
    pub fn can_pay_additional_costs(
        cost: &Cost,
        game: &GameState,
        source: CardId,
        player: PlayerId,
        _is_effect: bool,
    ) -> bool {
        // TODO: cost = CostAdjustment::adjust(cost, ability, effect);
        crate::cost::can_pay_ignoring_mana(cost, game, source, player)
    }

    /// Handle offering/emerge sacrifice after cost payment.
    pub fn handle_offerings(
        _game: &mut GameState,
        _source: CardId,
        _test: bool,
        _cost_is_paid: bool,
    ) -> bool {
        // TODO: Port Java's handleOfferings():
        // - If sa.isOffering(): sacrifice the offering card, fire zone triggers
        // - If sa.isEmerge(): sacrifice the emerge card, update LKI, fire zone triggers
        true
    }
}

/// Execute a single cost part payment based on the decision.
pub fn pay_as_decided(
    game: &mut GameState,
    player: PlayerId,
    source: CardId,
    cost_part: &CostPart,
    decision: &PaymentDecision,
    _is_effect: bool,
) -> bool {
    pay_as_decided_distributed(game, player, source, cost_part, decision)
}

fn pay_as_decided_distributed(
    game: &mut GameState,
    player: PlayerId,
    source: CardId,
    cost_part: &CostPart,
    decision: &PaymentDecision,
) -> bool {
    match cost_part {
        CostPart::Tap => {
            crate::cost::cost_tap::pay_with_decision(game, player, source, cost_part, decision)
        }
        CostPart::Untap => {
            crate::cost::cost_untap::pay_with_decision(game, player, source, cost_part, decision)
        }
        CostPart::Mana { .. } => crate::cost::cost_part_mana::pay_with_decision(
            game, player, source, cost_part, decision,
        ),
        CostPart::PayLife(_) => {
            crate::cost::cost_pay_life::pay_with_decision(game, player, source, cost_part, decision)
        }
        CostPart::Sacrifice { .. } => crate::cost::cost_sacrifice::pay_with_decision(
            game, player, source, cost_part, decision,
        ),
        CostPart::Discard { .. } => {
            crate::cost::cost_discard::pay_with_decision(game, player, source, cost_part, decision)
        }
        CostPart::SubCounter { .. } => crate::cost::cost_remove_counter::pay_with_decision(
            game, player, source, cost_part, decision,
        ),
        CostPart::AddCounter { .. } => crate::cost::cost_put_counter::pay_with_decision(
            game, player, source, cost_part, decision,
        ),
        CostPart::Exile { .. }
        | CostPart::ExileFromAnyGrave { .. }
        | CostPart::ExileFromSameGrave { .. } => {
            crate::cost::cost_exile::pay_with_decision(game, player, source, cost_part, decision)
        }
        CostPart::ExileCtrlOrGrave { .. } => {
            crate::cost::cost_exile_ctrl_or_grave::pay_with_decision(
                game, player, source, cost_part, decision,
            )
        }
        CostPart::Return { .. } => {
            crate::cost::cost_return::pay_with_decision(game, player, source, cost_part, decision)
        }
        CostPart::TapType { .. } => {
            crate::cost::cost_tap_type::pay_with_decision(game, player, source, cost_part, decision)
        }
        CostPart::UntapType { .. } => crate::cost::cost_untap_type::pay_with_decision(
            game, player, source, cost_part, decision,
        ),
        CostPart::PayEnergy(_) => crate::cost::cost_pay_energy::pay_with_decision(
            game, player, source, cost_part, decision,
        ),
        CostPart::PayShards(_) => crate::cost::cost_pay_shards::pay_with_decision(
            game, player, source, cost_part, decision,
        ),
        CostPart::DamageYou(_) => {
            crate::cost::cost_damage::pay_with_decision(game, player, source, cost_part, decision)
        }
        CostPart::Draw(_) => {
            crate::cost::cost_draw::pay_with_decision(game, player, source, cost_part, decision)
        }
        CostPart::Mill(_) => {
            crate::cost::cost_mill::pay_with_decision(game, player, source, cost_part, decision)
        }
        CostPart::Reveal { .. } => {
            crate::cost::cost_reveal::pay_with_decision(game, player, source, cost_part, decision)
        }
        CostPart::Exert { .. } => {
            crate::cost::cost_exert::pay_with_decision(game, player, source, cost_part, decision)
        }
        CostPart::Enlist { .. } => {
            crate::cost::cost_enlist::pay_with_decision(game, player, source, cost_part, decision)
        }
        CostPart::GainLife(_) => crate::cost::cost_gain_life::pay_with_decision(
            game, player, source, cost_part, decision,
        ),
        CostPart::GainControl { .. } => crate::cost::cost_gain_control::pay_with_decision(
            game, player, source, cost_part, decision,
        ),
        CostPart::RemoveAnyCounter { .. } => {
            crate::cost::cost_remove_any_counter::pay_with_decision(
                game, player, source, cost_part, decision,
            )
        }
        CostPart::Unattach { .. } => {
            crate::cost::cost_unattach::pay_with_decision(game, player, source, cost_part, decision)
        }
        CostPart::ExiledMoveToGrave { .. } => {
            crate::cost::cost_exiled_move_to_grave::pay_with_decision(
                game, player, source, cost_part, decision,
            )
        }
        CostPart::AddMana { .. } => {
            crate::cost::cost_add_mana::pay_with_decision(game, player, source, cost_part, decision)
        }
        CostPart::Waterbend { .. } => crate::cost::cost_waterbend::pay_with_decision(
            game, player, source, cost_part, decision,
        ),
        CostPart::ChooseColor(_) => crate::cost::cost_choose_color::pay_with_decision(
            game, player, source, cost_part, decision,
        ),
        CostPart::ChooseCreatureType(_) => {
            crate::cost::cost_choose_creature_type::pay_with_decision(
                game, player, source, cost_part, decision,
            )
        }
        CostPart::FlipCoin(_) => crate::cost::cost_flip_coin::pay_with_decision(
            game, player, source, cost_part, decision,
        ),
        CostPart::RollDice { .. } => crate::cost::cost_roll_dice::pay_with_decision(
            game, player, source, cost_part, decision,
        ),
        CostPart::ExileFromStack { .. } => crate::cost::cost_exile_from_stack::pay_with_decision(
            game, player, source, cost_part, decision,
        ),
        CostPart::CollectEvidence(_) => crate::cost::cost_collect_evidence::pay_with_decision(
            game, player, source, cost_part, decision,
        ),
        CostPart::Forage => {
            crate::cost::cost_forage::pay_with_decision(game, player, source, cost_part, decision)
        }
        CostPart::PutCardToLib { .. } => crate::cost::cost_put_card_to_lib::pay_with_decision(
            game, player, source, cost_part, decision,
        ),
        CostPart::PromiseGift => crate::cost::cost_promise_gift::pay_with_decision(
            game, player, source, cost_part, decision,
        ),
        CostPart::RevealChosen { .. } => crate::cost::cost_reveal_chosen::pay_with_decision(
            game, player, source, cost_part, decision,
        ),
        CostPart::Behold { .. } => {
            crate::cost::cost_behold::pay_with_decision(game, player, source, cost_part, decision)
        }
        CostPart::Blight(_) => {
            crate::cost::cost_blight::pay_with_decision(game, player, source, cost_part, decision)
        }
    }
}

/// Refund a single cost part.
fn refund_cost_part(game: &mut GameState, source: CardId, player: PlayerId, part: &CostPart) {
    match part {
        CostPart::Tap => {
            crate::cost::cost_tap::refund(game, source);
        }
        CostPart::Untap => {
            crate::cost::cost_untap::refund(game, source);
        }
        CostPart::SubCounter {
            amount,
            counter_type,
            ..
        } => crate::cost::cost_remove_counter::refund(
            game,
            source,
            amount.resolve(game, source, player),
            counter_type,
        ),
        CostPart::AddCounter {
            amount,
            counter_type,
        } => {
            crate::cost::cost_put_counter::refund(
                game,
                source,
                amount.resolve(game, source, player),
                counter_type,
            );
        }
        CostPart::PayEnergy(amount) => {
            crate::cost::cost_pay_energy::refund(
                game,
                player,
                amount.resolve(game, source, player),
            );
        }
        CostPart::PayShards(amount) => {
            crate::cost::cost_pay_shards::refund(
                game,
                player,
                amount.resolve(game, source, player),
            );
        }
        CostPart::PayLife(amount) => {
            game.player_gain_life(player, amount.resolve(game, source, player));
        }
        CostPart::ChooseColor(_) => {
            crate::cost::cost_choose_color::refund(game, source);
        }
        CostPart::Blight(_) => {
            // Could refund by removing -1/-1 counters, but snapshot rollback handles it.
        }
        // Most cost parts (sacrifice, discard, exile, return, etc.) are not
        // individually refundable — zone changes are rolled back by GameSnapshot.
        _ => {
            eprintln!("[WARN] Unhandled cost part refund: {:?}", part);
        }
    }
}
