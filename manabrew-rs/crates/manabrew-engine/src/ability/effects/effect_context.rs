//! `EffectContext` — bundle of subsystem refs threaded through effect resolution.
//!
//! Rust-specific concession: Java reaches `Game.getTriggerHandler()`, agents,
//! combat, mana pools via chained getters from `SpellAbility.getHostCard()`.
//! The Rust engine deliberately owns those subsystems outside `GameState`
//! (see `trigger_handler.rs` top comment), so every resolver needs a handful
//! of mutable references. This struct packs them.

use std::collections::HashMap;

use forge_foundation::ZoneType;

use crate::agent::PlayerAgent;
use crate::card::{Card, CounterType};
use crate::event::RunParams;
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::mana::ManaPool;
use crate::replacement::replacement_handler::{
    apply_replacements, apply_replacements_with_agents, ReplacementEvent,
};
use crate::replacement::ReplacementResult;
use crate::spellability::SpellAbility;
use crate::trigger::handler::TriggerHandler;
use crate::trigger::TriggerType;

/// Everything an effect needs to resolve.
pub struct EffectContext<'a> {
    pub game: &'a mut GameState,
    pub combat: Option<&'a mut crate::combat::CombatState>,
    pub agents: &'a mut [Box<dyn PlayerAgent>],
    pub trigger_handler: &'a mut TriggerHandler,
    pub token_templates: &'a HashMap<String, Card>,
    /// Token art variant counts for game-RNG parity with Java.
    pub token_art_variants: &'a HashMap<(String, String), usize>,
    /// Token fallback codes: edition_code → fallback_edition_code.
    pub token_fallback: &'a HashMap<String, String>,
    /// Edition release dates: edition_code → "YYYY-MM-DD". Used to sort
    /// editions newest-first for token fallback (Java parity).
    pub edition_dates: &'a HashMap<String, String>,
    pub mana_pools: &'a mut Vec<ManaPool>,
    /// CardId of the parent SA's chosen target card, propagated through the
    /// sub-ability chain so that `Defined$ ParentTarget` effects can resolve it.
    /// Mirrors Java's `SpellAbility.getParentTargetCard()` (via getRootAbility()).
    pub parent_target_card: Option<CardId>,
    /// Pluggable RNG for game effects (shuffles, coin flips, dice rolls).
    /// Parity tests inject a JavaRandom-backed implementation; normal gameplay
    /// uses the default ThreadRngAdapter.
    pub rng: &'a mut dyn crate::game_rng::GameRng,
}

pub(crate) fn add_counter_with_context(
    game: &mut GameState,
    trigger_handler: Option<&mut TriggerHandler>,
    agents: Option<&mut [Box<dyn PlayerAgent>]>,
    card_id: CardId,
    counter_type: &CounterType,
    amount: i32,
    mut params: RunParams,
    is_effect: bool,
) -> i32 {
    if amount <= 0 {
        return 0;
    }

    let mut event = ReplacementEvent::AddCounter {
        target: card_id,
        counter_type: counter_type.clone(),
        count: amount,
        is_effect,
    };
    let result = match agents {
        Some(agents) => apply_replacements_with_agents(game, agents, &mut event),
        None => apply_replacements(game, &mut event),
    };
    if !matches!(
        result,
        ReplacementResult::NotReplaced | ReplacementResult::Updated
    ) {
        return 0;
    }
    let ReplacementEvent::AddCounter { count, .. } = event else {
        return 0;
    };
    if count <= 0 {
        return 0;
    }
    if game.card(card_id).phased_out
        || crate::staticability::static_ability_cant_put_counter::any_cant_put_counter_on_card(
            &game.cards,
            game.card(card_id),
            counter_type,
        )
    {
        return 0;
    }

    let old_value = game.card(card_id).counter_count(counter_type);
    let count = if let Some(max) = crate::staticability::static_ability_max_counter::max_counter(
        &game.cards,
        game.card(card_id),
        counter_type,
    ) {
        (max - old_value).clamp(0, count)
    } else {
        count
    };
    if count <= 0 {
        return 0;
    }

    game.card_mut(card_id)
        .add_counter_internal(counter_type, count);
    let new_value = game.card(card_id).counter_count(counter_type);
    if new_value <= old_value {
        return 0;
    }

    if let Some(trigger_handler) = trigger_handler {
        params.card = Some(card_id);
        params.counter_type = Some(format!("{counter_type:?}"));
        for counter_amount in (old_value + 1)..=new_value {
            params.counter_amount = Some(counter_amount);
            trigger_handler.run_trigger(TriggerType::CounterAdded, params.clone(), false);
        }
        params.counter_amount = Some(new_value - old_value);
        trigger_handler.run_trigger(TriggerType::CounterAddedOnce, params, false);
    }

    new_value - old_value
}

impl EffectContext<'_> {
    /// Get the number of art variants for a token in a given edition,
    /// following TokenFallbackCode chains. Returns 1 if not found.
    /// When edition_code is empty, scans all editions and returns the first
    /// match (mirrors Java's `fallbackToken` which iterates all editions).
    pub fn token_art_variant_count(&self, token_script: &str, edition_code: &str) -> usize {
        let script_lower = token_script.to_lowercase();
        if !edition_code.is_empty() {
            let key = (script_lower.clone(), edition_code.to_uppercase());
            if let Some(&count) = self.token_art_variants.get(&key) {
                return count;
            }
            if let Some(fallback) = self.token_fallback.get(&edition_code.to_uppercase()) {
                return self.token_art_variant_count(token_script, fallback);
            }
        }
        // Fallback: host edition doesn't have this token. Java's
        // `fallbackToken` iterates editions in a specific order that's
        // hard to reproduce exactly. In practice Java almost always
        // resolves to an edition with 1 art variant for common tokens.
        // Default to 1 to match the typical Java behavior.
        1
    }

    /// Consume game-RNG calls to match Java's token prototype creation.
    /// Java calls Aggregates.random(Set) which does nextInt() per element,
    /// plus PaperToken.getImageKey() which does nextInt(artIndex).
    pub fn sync_token_art_rng(&mut self, token_script: &str, sa: &SpellAbility) {
        // Java's TokenDb caches token prototypes globally. The first creation
        // of a token type consumes game RNG (Aggregates.random + getImageKey);
        // subsequent creations reuse the cached prototype without RNG.
        let host_edition = sa
            .source
            .and_then(|cid| self.game.card(cid).set_code.as_deref())
            .unwrap_or("");
        let art_count = self.token_art_variant_count(token_script, host_edition);
        // Java's Aggregates.random(Collection<PaperToken>) uses min-random
        // selection: for each element, call nextInt() (unbounded). Collection
        // size = number of art variants in the resolved edition.
        for _ in 0..art_count {
            self.rng.next_int(1);
        }
        // PaperToken.getImageKey(): nextInt(artIndex)
        self.rng.next_int(1);
    }

    pub fn move_card(&mut self, card_id: CardId, dest_zone: ZoneType, dest_owner: PlayerId) {
        let mut runtime = crate::replacement::replacement_handler::ReplacementRuntime {
            trigger_handler: self.trigger_handler,
            token_templates: self.token_templates,
            token_art_variants: self.token_art_variants,
            token_fallback: self.token_fallback,
            edition_dates: self.edition_dates,
            mana_pools: self.mana_pools,
            rng: self.rng,
        };
        self.game.move_card_with_agents_and_replacement_runtime(
            card_id,
            dest_zone,
            dest_owner,
            self.agents,
            &mut runtime,
        );
    }

    pub(crate) fn add_counter(
        &mut self,
        card_id: CardId,
        counter_type: &CounterType,
        amount: i32,
        params: RunParams,
    ) -> i32 {
        add_counter_with_context(
            self.game,
            Some(self.trigger_handler),
            Some(self.agents),
            card_id,
            counter_type,
            amount,
            params,
            true,
        )
    }
}
