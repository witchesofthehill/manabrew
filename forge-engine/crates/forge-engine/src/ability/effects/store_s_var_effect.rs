//! StoreSVar effect — store a value in an SVar for later use.
//!
//! Ported from Java's `StoreSVarEffect.java`.
//! Stores a calculated value into a named SVar on the source card.

use super::EffectContext;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `StoreSVarEffect` class extending `SpellAbilityEffect`.
#[forge_engine_macros::spell_effect(StoreSVarEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let Some(source_id) = sa.source else { return };

    let svar_name = sa.ir.svar_name_text.clone().unwrap_or_default();
    let svar_type = sa.ir.svar_type_text.clone().unwrap_or_default();
    let expression = sa.ir.svar_expression_text.clone().unwrap_or_default();

    if svar_name.is_empty() || svar_type.is_empty() || expression.is_empty() {
        return;
    }

    let resolved_number = match svar_type.as_str() {
        "Number" => expression
            .parse::<i32>()
            .unwrap_or_else(|_| crate::svar::evaluate_svar(&expression, sa)),
        "Count" => crate::svar::resolve_count_svar_for_sa(
            &expression,
            ctx.game,
            source_id,
            sa.activating_player,
            sa,
        ),
        "CountSVar" => {
            let mut expression = expression.clone();
            if expression.contains('/') {
                let expr_math_var = expression
                    .split('/')
                    .nth(1)
                    .and_then(|rest| rest.split('.').nth(1))
                    .map(str::to_string);
                if let Some(expr_math_var) = expr_math_var {
                    let expr_math =
                        crate::svar::resolve_numeric_value(ctx.game, sa, &expr_math_var, 0);
                    expression = expression.replace(&expr_math_var, &expr_math.to_string());
                }
            }
            crate::svar::resolve_svar_expression(
                &format!("SVar${expression}"),
                ctx.game,
                source_id,
                sa.activating_player,
                sa,
            )
        }
        "Calculate" => {
            if let Some(svar_expr) = ctx.game.card(source_id).get_s_var(&expression) {
                crate::svar::resolve_count_svar_for_sa(
                    svar_expr,
                    ctx.game,
                    source_id,
                    sa.activating_player,
                    sa,
                )
            } else {
                expression
                    .parse::<i32>()
                    .unwrap_or_else(|_| crate::svar::evaluate_svar(&expression, sa))
            }
        }
        _ => expression
            .parse::<i32>()
            .unwrap_or_else(|_| crate::svar::evaluate_svar(&expression, sa)),
    };
    let resolved_value = format!("Number${}", resolved_number);

    ctx.game
        .card_mut(source_id)
        .set_s_var(svar_name, resolved_value);
}
