//! TokenEffectBase — abstract base for token creation.
//!
//! Mirrors Java's `TokenEffectBase.java`.
//! Provides shared logic for creating token creatures, used by
//! `TokenEffect`, `IncubateEffect`, and similar effects.

use crate::card::Card;
use crate::ids::PlayerId;
use crate::spellability::SpellAbility;

use super::EffectContext;

/// Parsed token creation parameters.
pub struct TokenCreateParams {
    /// Number of tokens to create.
    pub amount: usize,
    /// The token script string(s).
    pub scripts: Vec<String>,
    /// The player who owns the tokens.
    pub owner: PlayerId,
}

/// Parse common token creation parameters from a spell ability.
pub fn parse_token_params(ctx: &EffectContext, sa: &SpellAbility) -> Option<TokenCreateParams> {
    let amount = sa
        .ir
        .token_amount
        .as_deref()
        .map(|raw| super::resolve_numeric_value(ctx.game, sa, raw, 1))
        .unwrap_or(1)
        .max(0) as usize;

    let scripts: Vec<String> = sa
        .token_script()
        .map(|s| s.split(',').map(|t| t.trim().to_string()).collect())
        .unwrap_or_default();

    if scripts.is_empty() {
        return None;
    }

    let owner = sa.activating_player;

    Some(TokenCreateParams {
        amount,
        scripts,
        owner,
    })
}

/// Look up a token template by script name from the template map.
pub fn get_token_template<'a>(
    templates: &'a std::collections::HashMap<String, Card>,
    script: &str,
) -> Option<&'a Card> {
    // Try exact match first, then case-insensitive
    templates.get(script).or_else(|| {
        let lower = script.to_ascii_lowercase();
        templates
            .iter()
            .find(|(k, _)| k.to_ascii_lowercase() == lower)
            .map(|(_, v)| v)
    })
}

/// Add a "pump until" effect to a token — grants temporary keywords/P/T boosts
/// that expire at end of turn or when a condition is met.
/// Mirrors Java's `TokenEffectBase.addPumpUntil(Card, SpellAbility, String)`.
///
/// Sets up the token with keywords and P/T modifiers from the SA parameters
/// that last until the specified until condition (typically end of turn).
pub fn add_pump_until(
    game: &mut crate::game::GameState,
    token_id: crate::ids::CardId,
    sa: &crate::spellability::SpellAbility,
) {
    // Read pump keywords from SA parameters
    if let Some(kws) = sa.ir.token_keywords_text.as_deref() {
        for kw in kws.split(',').map(|s| s.trim()) {
            if !kw.is_empty() {
                game.card_mut(token_id).granted_keywords.add(kw);
            }
        }
    }

    // Read pump power/toughness from SA parameters
    if let Some(power) = sa.ir.token_power {
        let current_t = game.card(token_id).toughness();
        let toughness = sa.ir.token_toughness.unwrap_or(current_t);
        game.card_mut(token_id).add_new_pt(power, toughness);
    }

    // If there's an "Until" parameter, mark the token for cleanup
    if let Some(until) = sa.ir.token_until_text.as_deref() {
        game.card_mut(token_id).set_s_var("TokenUntil", until);
    }
}

/// Run the token effect — create tokens based on parsed parameters.
/// Mirrors Java's `TokenEffectBase.run(SpellAbility)`.
///
/// Parses the token script, looks up the template, creates the specified
/// number of copies, and places them on the battlefield.
pub fn run(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let token_spec = match parse_token_params(ctx, sa) {
        Some(p) => p,
        None => return,
    };

    let controller = sa.activating_player;

    for script in &token_spec.scripts {
        let template = match get_token_template(ctx.token_templates, script) {
            Some(t) => t.clone(),
            None => continue,
        };

        for _ in 0..token_spec.amount {
            let mut token = template.clone();
            token.owner = controller;
            token.controller = controller;
            token.is_token = true;

            let token_id = ctx.game.create_card(token);
            ctx.game.move_card(
                token_id,
                forge_foundation::ZoneType::Battlefield,
                controller,
            );

            // Apply pump effects if specified
            add_pump_until(ctx.game, token_id, sa);

            // Register triggers for the new token
            ctx.trigger_handler
                .register_active_trigger(ctx.game, token_id);

            // Fire ETB trigger
            super::zone_triggers::emit_zone_trigger(
                ctx.trigger_handler,
                token_id,
                forge_foundation::ZoneType::None,
                forge_foundation::ZoneType::Battlefield,
            );

            ctx.trigger_handler.run_trigger(
                crate::trigger::TriggerType::TokenCreated,
                crate::event::RunParams {
                    card: Some(token_id),
                    player: Some(controller),
                    ..Default::default()
                },
                false,
            );
        }
    }
}
