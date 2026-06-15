use forge_foundation::ZoneType;
use serde::{Deserialize, Serialize};

use super::EffectContext;
use crate::ability::spell_ability_effect::get_target_players;

/// `Mode$` vocabulary for `DB$ Discard`. Mirrors Java
/// `DiscardEffect.resolve`'s mode dispatch. Default is [`Self::TgtChoose`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum DiscardMode {
    #[default]
    TgtChoose,
    YouChoose,
    RevealTgtChoose,
    RevealYouChoose,
    Random,
    Hand,
}

impl DiscardMode {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "TgtChoose" => Some(Self::TgtChoose),
            "YouChoose" => Some(Self::YouChoose),
            "RevealTgtChoose" => Some(Self::RevealTgtChoose),
            "RevealYouChoose" => Some(Self::RevealYouChoose),
            "Random" => Some(Self::Random),
            "Hand" => Some(Self::Hand),
            _ => None,
        }
    }

    fn chooser_style_optional(self) -> bool {
        matches!(
            self,
            Self::TgtChoose | Self::YouChoose | Self::RevealYouChoose | Self::RevealTgtChoose
        )
    }

    fn reveals_hand(self) -> bool {
        matches!(self, Self::RevealTgtChoose | Self::RevealYouChoose)
    }

    fn chooser_is_activator(self) -> bool {
        matches!(self, Self::YouChoose | Self::RevealYouChoose)
    }
}

/// SP$ Discard — target/defined players discard N cards.
///
/// Mirrors Java's `DiscardEffect.resolve()`.
#[forge_engine_macros::spell_effect(DiscardEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let num = super::resolve_numeric_svar(ctx.game, sa, crate::parsing::keys::NUM_CARDS, 1).max(0)
        as usize;
    let mode = sa.ir.discard_mode.unwrap_or_default();

    // AnyNumber$ True — discarder may pick 0..=hand.len (Cavalier of Flame,
    // Careful Study). Routes through a distinct agent method so deterministic
    // agents sample count + selection with the same RNG trajectory Java uses.
    let any_number = sa.ir.any_number;

    let target_players = get_target_players(ctx.game, sa);
    let first_target = target_players.first().copied();

    for target_player in target_players.iter().copied() {
        let mut hand: Vec<_> = ctx
            .game
            .cards_in_zone(ZoneType::Hand, target_player)
            .to_vec();
        if let Some(valid_filter) = sa.ir.discard_valid_text.as_deref() {
            let valid_selector = sa.ir.discard_valid_selector.as_ref();
            hand.retain(|&card_id| {
                super::matches_valid_cards_for_sa(
                    ctx.game,
                    sa,
                    ctx.game.card(card_id),
                    valid_selector,
                    valid_filter,
                )
            });
        }

        // AnyNumber$ True implicitly subsumes Optional — picking 0 = decline.
        // Java's DiscardEffect doesn't fire a separate confirm_action there.
        let chooser_style_optional = mode.chooser_style_optional();

        // Java DiscardEffect.resolve(): chooser defaults to the discarder,
        // *YouChoose routes to the activator, RevealTgtChoose pins to the
        // first target. DiscardEffect.java:236-241.
        let chooser = if mode.chooser_is_activator() {
            sa.activating_player
        } else if mode == DiscardMode::RevealTgtChoose {
            first_target.unwrap_or(target_player)
        } else {
            target_player
        };

        // Reveal* modes broadcast the discarder's hand before the pick
        // (DiscardEffect.java:244 `game.getAction().reveal(...)`).
        if mode.reveals_hand() && !hand.is_empty() {
            let source_name = sa.source.map(|cid| ctx.game.card(cid).card_name.clone());
            for agent in ctx.agents.iter_mut() {
                agent.reveal_cards(
                    ctx.game,
                    target_player,
                    &hand,
                    ZoneType::Hand,
                    target_player,
                    source_name.as_deref(),
                );
            }
        }

        if sa.ir.optional && !any_number && !chooser_style_optional {
            let accepted = ctx.agents[target_player.index()].confirm_action(
                target_player,
                None,
                "Do you want to discard?",
                &[],
                sa.source,
                Some(crate::ability::api_type::ApiType::Discard),
            );
            if !accepted {
                continue;
            }
        }

        // Mode$ Hand — discard the whole hand, no chooser
        // (DiscardEffect.java:154-174).
        if mode == DiscardMode::Hand {
            let remember_discarded = sa.ir.remember_discarded;
            for card_id in hand.iter().copied() {
                if ctx.game.card(card_id).zone == ZoneType::Hand {
                    if remember_discarded {
                        if let Some(sid) = sa.source {
                            ctx.game.card_mut(sid).add_remembered_card(card_id);
                        }
                    }
                    ctx.game.discard_card(
                        card_id,
                        target_player,
                        Some(sa),
                        Some(ctx.agents),
                        ctx.trigger_handler,
                    );
                }
            }
            continue;
        }

        let to_discard = match mode {
            DiscardMode::Random => {
                ctx.agents[target_player.index()].choose_random_discard(target_player, &hand, num)
            }
            _ if any_number => ctx.agents[chooser.index()].choose_discard_any_number(
                target_player,
                &hand,
                0,
                hand.len(),
            ),
            _ if sa.ir.optional && chooser_style_optional => ctx.agents[chooser.index()]
                .choose_discard_any_number(target_player, &hand, 0, num.min(hand.len())),
            _ if chooser_style_optional => {
                ctx.agents[chooser.index()].choose_discard(target_player, &hand, num)
            }
            _ => ctx.agents[target_player.index()].choose_discard(target_player, &hand, num),
        };

        // RememberDiscarded$ — source remembers each card actually discarded
        // so downstream SubAbility effects (e.g. Cavalier of Flame's
        // `NumCards$ Y` where Y = Remembered count) can compute amounts.
        let remember_discarded = sa.ir.remember_discarded;

        let to_discard = if to_discard.len() > 1 {
            let reordered = ctx.agents[target_player.index()].choose_reorder_library(
                ctx.game,
                target_player,
                &to_discard,
            );
            if reordered.len() == to_discard.len() {
                reordered
            } else {
                to_discard
            }
        } else {
            to_discard
        };

        for card_id in to_discard {
            if ctx.game.card(card_id).zone == ZoneType::Hand {
                if remember_discarded {
                    if let Some(sid) = sa.source {
                        ctx.game.card_mut(sid).add_remembered_card(card_id);
                    }
                }
                ctx.game.discard_card(
                    card_id,
                    target_player,
                    Some(sa),
                    Some(ctx.agents),
                    ctx.trigger_handler,
                );
            }
        }
    }
}
