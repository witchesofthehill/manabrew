use forge_foundation::ZoneType;

use super::{matches_valid_cards_for_sa, EffectContext};
use crate::card::perpetual::perpetual_interface::PerpetualInterface;
use crate::card::perpetual::{perpetual_keywords, perpetual_pt_boost};
use crate::ids::CardId;

/// End-of-turn revert for PumpAll. Mirrors the `GameCommand.run()` in Java
/// `PumpAllEffect` that reverses the P/T bonus and removes granted keywords
/// when the effect duration expires.
pub fn run(
    game: &mut crate::game::GameState,
    card_id: crate::ids::CardId,
    att_bonus: i32,
    def_bonus: i32,
    keywords: &[String],
) {
    if game.card(card_id).zone != ZoneType::Battlefield {
        return;
    }
    game.card_mut(card_id).add_pt_boost(-att_bonus, -def_bonus);
    for kw in keywords {
        game.card_mut(card_id).pump_keywords.remove(kw);
    }
}

/// `SP$ PumpAll` — modify P/T of all matching permanents until end of turn (or perpetually).
///
/// Mirrors Java's `PumpAllEffect.java`:
/// - `NumAtt$` / `NumDef$` specify power/toughness change (signed: "+2", "-2").
/// - `ValidCards$` selects which permanents are affected.
/// - `PumpZone$` specifies the zone to look in (default: Battlefield, supports Hand).
/// - `Duration$ Perpetual` stores the bonus in `perpetual_power_modifier` /
///   `perpetual_toughness_modifier` so it persists across zone changes.
/// - Without `Duration$ Perpetual`, uses temporary `power_modifier` / `toughness_modifier`
///   (zeroed at cleanup by `step_cleanup`).
///
/// Positive values are a pump (Giant Growth effect); negative values are a
/// debuff (Rising Miasma -2/-2).
///
/// # Card script examples
/// ```text
/// A:SP$ PumpAll | ValidCards$ Creature.YouCtrl | NumAtt$ +2 | NumDef$ +2
/// A:SP$ PumpAll | ValidCards$ Creature | NumAtt$ -2 | NumDef$ -2
/// DB$ PumpAll | PumpZone$ Hand | ValidCards$ Creature.YouOwn | NumAtt$ +1 | NumDef$ +1 | Duration$ Perpetual
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `PumpAllEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(PumpAllEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    // parse_param strips leading '+' sign via Rust's i32::from_str which accepts it.
    // Fall back to SVar resolution for Count$Kicked etc.
    let att_bonus = sa
        .ir
        .num_att
        .as_deref()
        .map(|raw| super::resolve_numeric_value(ctx.game, sa, raw, 0))
        .unwrap_or(0);
    let def_bonus = sa
        .ir
        .num_def
        .as_deref()
        .map(|raw| super::resolve_numeric_value(ctx.game, sa, raw, 0))
        .unwrap_or(0);

    // Parse KW$ parameter for keyword grants (e.g. "KW$ Haste" or "KW$ Flying & Trample")
    let keywords: Vec<String> = sa
        .ir
        .kw
        .as_deref()
        .map(|kw_str| {
            kw_str
                .split('&')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();

    if att_bonus == 0 && def_bonus == 0 && keywords.is_empty() {
        return;
    }

    let valid_cards = sa.ir.valid_cards_selector.as_ref();

    // Determine the zone to look for cards in (default: Battlefield).
    let pump_zone_str = sa.ir.pump_zone.as_deref().unwrap_or("Battlefield");
    let pump_zone = match pump_zone_str {
        s if s.eq_ignore_ascii_case("Hand") => ZoneType::Hand,
        _ => ZoneType::Battlefield,
    };

    // Perpetual effects persist across zone changes (stored in perpetual_*_modifier).
    let is_perpetual = sa.ir.perpetual_duration;
    let resolve_ts = if is_perpetual {
        Some(ctx.game.next_effect_timestamp())
    } else {
        None
    };

    // Pass 1 — collect matching cards in the target zone
    let player_ids = ctx.game.player_order.clone();
    let mut to_pump: Vec<CardId> = Vec::new();
    for &pid in &player_ids {
        let zone_cards = ctx.game.cards_in_zone(pump_zone, pid).to_vec();
        for cid in zone_cards {
            if matches_valid_cards_for_sa(ctx.game, sa, ctx.game.card(cid), valid_cards, "Creature")
            {
                to_pump.push(cid);
            }
        }
    }

    // Pass 2 — apply modifiers
    for card_id in to_pump {
        if ctx.game.card(card_id).zone != pump_zone {
            continue; // already moved
        }
        if is_perpetual {
            let ts = resolve_ts.expect("perpetual resolve timestamp must exist");
            let card = ctx.game.card_mut(card_id);
            perpetual_pt_boost::PerpetualPtBoost {
                timestamp: ts,
                power: att_bonus,
                toughness: def_bonus,
            }
            .apply_effect(card);
            for kw in &keywords {
                perpetual_keywords::PerpetualKeywords {
                    timestamp: ts,
                    add_keywords: vec![kw.clone()],
                    remove_keywords: Vec::new(),
                    remove_all: false,
                }
                .apply_effect(card);
            }
        } else {
            ctx.game
                .card_mut(card_id)
                .add_pt_boost(att_bonus, def_bonus);
            for kw in &keywords {
                ctx.game.card_mut(card_id).add_pump_keyword(kw);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::ability::spell_ability_effect::SpellAbilityEffect;
    use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};
    use std::collections::HashMap;

    use crate::ability::effects::EffectContext;
    use crate::agent::PassAgent;
    use crate::card::Card;
    use crate::game::GameState;
    use crate::ids::{CardId, PlayerId};
    use crate::mana::ManaPool;
    use crate::spellability::SpellAbility;
    use crate::trigger::handler::TriggerHandler;

    fn make_creature(game: &mut GameState, owner: PlayerId) -> CardId {
        let c = Card::new(
            CardId(0),
            "Bear".into(),
            owner,
            CardTypeLine::parse("Creature - Bear"),
            ManaCost::parse("1 G"),
            ColorSet::GREEN,
            Some(2),
            Some(2),
            vec![],
            vec![],
        );
        game.create_card(c)
    }

    fn make_ctx<'a>(
        game: &'a mut GameState,
        agents: &'a mut Vec<Box<dyn crate::agent::PlayerAgent>>,
        th: &'a mut TriggerHandler,
        mp: &'a mut Vec<ManaPool>,
        templates: &'a HashMap<String, Card>,
        templates_variants: &'a HashMap<(String, String), usize>,
        token_fallback: &'a HashMap<String, String>,
        edition_dates: &'a HashMap<String, String>,
        rng: &'a mut dyn crate::game_rng::GameRng,
    ) -> EffectContext<'a> {
        EffectContext {
            game,
            combat: None,
            agents,
            trigger_handler: th,
            token_templates: templates,
            token_art_variants: templates_variants,
            token_fallback,
            edition_dates,
            mana_pools: mp,
            parent_target_card: None,
            rng,
        }
    }

    #[test]
    fn pump_all_boosts_all_creatures() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);
        let c1 = make_creature(&mut game, p0);
        let c2 = make_creature(&mut game, p1);
        game.move_card(c1, ZoneType::Battlefield, p0);
        game.move_card(c2, ZoneType::Battlefield, p1);

        let sa = SpellAbility::new_simple(
            None,
            p0,
            "A:SP$ PumpAll | ValidCards$ Creature | NumAtt$ +2 | NumDef$ +2",
        );
        let mut th = TriggerHandler::new();
        let mut agents: Vec<Box<dyn crate::agent::PlayerAgent>> =
            vec![Box::new(PassAgent), Box::new(PassAgent)];
        let mut mp = vec![ManaPool::default(), ManaPool::default()];
        let templates = HashMap::new();
        let templates_variants: HashMap<(String, String), usize> = HashMap::new();
        let token_fallback: HashMap<String, String> = HashMap::new();
        let edition_dates: HashMap<String, String> = HashMap::new();
        let mut rng_adapter = crate::game_rng::ThreadRngAdapter;
        let mut ctx = make_ctx(
            &mut game,
            &mut agents,
            &mut th,
            &mut mp,
            &templates,
            &templates_variants,
            &token_fallback,
            &edition_dates,
            &mut rng_adapter,
        );
        super::PumpAllEffect::resolve(&mut ctx, &sa);

        assert_eq!(ctx.game.card(c1).power(), 4); // 2+2
        assert_eq!(ctx.game.card(c1).toughness(), 4);
        assert_eq!(ctx.game.card(c2).power(), 4);
        assert_eq!(ctx.game.card(c2).toughness(), 4);
    }

    #[test]
    fn pump_all_debuff_reduces_pt() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);
        let c1 = make_creature(&mut game, p0);
        game.move_card(c1, ZoneType::Battlefield, p0);

        // Rising Miasma: -2/-2 to all
        let sa = SpellAbility::new_simple(
            None,
            p0,
            "A:SP$ PumpAll | ValidCards$ Creature | NumAtt$ -2 | NumDef$ -2",
        );
        let mut th = TriggerHandler::new();
        let mut agents: Vec<Box<dyn crate::agent::PlayerAgent>> =
            vec![Box::new(PassAgent), Box::new(PassAgent)];
        let mut mp = vec![ManaPool::default(), ManaPool::default()];
        let templates = HashMap::new();
        let templates_variants: HashMap<(String, String), usize> = HashMap::new();
        let token_fallback: HashMap<String, String> = HashMap::new();
        let edition_dates: HashMap<String, String> = HashMap::new();
        let mut rng_adapter = crate::game_rng::ThreadRngAdapter;
        let mut ctx = make_ctx(
            &mut game,
            &mut agents,
            &mut th,
            &mut mp,
            &templates,
            &templates_variants,
            &token_fallback,
            &edition_dates,
            &mut rng_adapter,
        );
        super::PumpAllEffect::resolve(&mut ctx, &sa);

        assert_eq!(ctx.game.card(c1).power(), 0); // 2-2
        assert_eq!(ctx.game.card(c1).toughness(), 0);
    }

    #[test]
    fn pump_all_you_ctrl_only_affects_your_creatures() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);
        let p1 = PlayerId(1);
        let mine = make_creature(&mut game, p0);
        let theirs = make_creature(&mut game, p1);
        game.move_card(mine, ZoneType::Battlefield, p0);
        game.move_card(theirs, ZoneType::Battlefield, p1);

        // Righteous Charge: creatures you control get +2/+2
        let sa = SpellAbility::new_simple(
            None,
            p0,
            "A:SP$ PumpAll | ValidCards$ Creature.YouCtrl | NumAtt$ +2 | NumDef$ +2",
        );
        let mut th = TriggerHandler::new();
        let mut agents: Vec<Box<dyn crate::agent::PlayerAgent>> =
            vec![Box::new(PassAgent), Box::new(PassAgent)];
        let mut mp = vec![ManaPool::default(), ManaPool::default()];
        let templates = HashMap::new();
        let templates_variants: HashMap<(String, String), usize> = HashMap::new();
        let token_fallback: HashMap<String, String> = HashMap::new();
        let edition_dates: HashMap<String, String> = HashMap::new();
        let mut rng_adapter = crate::game_rng::ThreadRngAdapter;
        let mut ctx = make_ctx(
            &mut game,
            &mut agents,
            &mut th,
            &mut mp,
            &templates,
            &templates_variants,
            &token_fallback,
            &edition_dates,
            &mut rng_adapter,
        );
        super::PumpAllEffect::resolve(&mut ctx, &sa);

        assert_eq!(ctx.game.card(mine).power(), 4); // boosted
        assert_eq!(ctx.game.card(theirs).power(), 2); // unchanged
    }
}
