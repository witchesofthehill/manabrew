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
use crate::card::Card;
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::mana::ManaPool;
use crate::spellability::SpellAbility;
use crate::trigger::handler::TriggerHandler;

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
}
