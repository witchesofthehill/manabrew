use forge_carddb::CardRules;

use super::card_assembly;
use super::Card;
use crate::ids::PlayerId;
use crate::spellability::SpellAbility;

/// Build a `Card` from card rules using the 3-phase card assembly
/// pipeline.
pub(crate) fn build_from_rules(rules: &CardRules, owner: PlayerId) -> Card {
    // Phase 1: Parse raw text into components.
    let mut components = card_assembly::parse_card_components(&rules.main_part);

    // Phase 2: Synthesize derived triggers/keywords (Magecraft, Exert, etc.).
    // Pass 0 as existing trigger count — keyword-generated triggers are added
    // by the constructor in Phase 3, so we don't know the count yet.
    card_assembly::synthesize_derived(&mut components, 0);

    // Phase 3: Assemble into Card.
    card_assembly::assemble_card(rules, owner, components)
}

/// Compatibility entrypoint for parity with Java `CardFactory`.
pub fn from_rules(rules: &CardRules, owner: PlayerId) -> Card {
    build_from_rules(rules, owner)
}

/// Java-parity helper for `CardFactory.copySpellAbilityAndPossiblyHost`.
///
/// The full host-card cloning path is not yet present in the Rust engine, but
/// this preserves current copy semantics and centralizes them in the card
/// module so effects can call one canonical implementation.
pub fn copy_spell_ability(target_sa: &SpellAbility, controller: PlayerId) -> SpellAbility {
    let mut copy = target_sa.clone();
    copy.activating_player = controller;
    copy.is_copy = true;
    // Copied spells/abilities are not re-cast and should not require paying costs.
    copy.pay_costs = None;
    copy
}

/// Java parity helper for `SpellAbility.cantBeCopied()` checks.
pub fn spell_ability_cant_be_copied(cards: &[Card], sa: &SpellAbility) -> bool {
    sa.source
        .map(|source| {
            crate::staticability::static_ability_cant_be_copied::cant_be_copied(
                cards,
                &cards[source.index()],
            )
        })
        .unwrap_or(false)
}
