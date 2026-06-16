//! ManifestBaseEffect — abstract base for manifest variants.
//!
//! Mirrors Java's `ManifestBaseEffect.java`.
//! Provides shared logic for `ManifestEffect`, `ManifestDreadEffect`,
//! and `CloakEffect` that puts cards onto the battlefield face-down
//! as 2/2 creatures.

use crate::spellability::SpellAbility;

use super::EffectContext;

/// Common manifest parameters parsed from a spell ability.
pub struct ManifestParams {
    /// Number of cards to manifest.
    pub amount: usize,
    /// Whether the manifested cards come from the library.
    pub from_library: bool,
}

/// Parse common manifest parameters from a spell ability.
pub fn parse_manifest_params(ctx: &EffectContext, sa: &SpellAbility) -> ManifestParams {
    let amount = super::resolve_numeric_svar(ctx.game, sa, "Amount", 1).max(1) as usize;
    let from_library = sa
        .ir
        .defined_text
        .as_deref()
        .is_none_or(|d| d == "TopOfLibrary");
    ManifestParams {
        amount,
        from_library,
    }
}

/// Get the default message for manifest choice prompts.
pub fn default_manifest_message() -> &'static str {
    "Choose a card to manifest"
}

/// Get the default message for manifest dread choice prompts.
pub fn default_manifest_dread_message() -> &'static str {
    "Choose a card to manifest dread"
}

/// Get the default message for cloak choice prompts.
pub fn default_cloak_message() -> &'static str {
    "Choose a card to cloak"
}

/// Resolve the base manifest effect — put cards from the top of the library
/// onto the battlefield face-down as 2/2 creatures.
/// Mirrors Java's `ManifestBaseEffect.resolve(SpellAbility)`.
///
/// This is the shared resolution logic for Manifest, Manifest Dread, and Cloak.
/// Each variant may override behavior (Manifest Dread looks at more cards,
/// Cloak grants the face-down card special turn-face-up abilities).
pub fn resolve(ctx: &mut EffectContext, sa: &SpellAbility, is_cloak: bool) {
    let player = sa.activating_player;
    let manifest = parse_manifest_params(ctx, sa);

    for _ in 0..manifest.amount {
        let library = ctx
            .game
            .cards_in_zone(forge_foundation::ZoneType::Library, player);
        if library.is_empty() {
            break;
        }

        // Take the top card of the library
        let card_id = library[0];

        // Move to battlefield face-down
        ctx.game
            .move_card(card_id, forge_foundation::ZoneType::Battlefield, player);

        // Set face-down properties — 2/2 creature with no abilities
        let card = ctx.game.card_mut(card_id);
        card.set_face_down(true);
        card.manifested = true;
        if is_cloak {
            card.cloaked = true;
        }

        // Set base P/T to 2/2 for face-down creatures
        card.add_new_pt(2, 2);

        // Register triggers for the new permanent
        ctx.trigger_handler
            .register_active_trigger(ctx.game, card_id);

        // Fire zone change triggers
        super::zone_triggers::emit_zone_trigger(
            ctx.trigger_handler,
            card_id,
            forge_foundation::ZoneType::Library,
            forge_foundation::ZoneType::Battlefield,
        );
    }
}
