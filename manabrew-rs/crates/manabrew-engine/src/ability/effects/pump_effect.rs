use forge_foundation::ZoneType;

use super::EffectContext;
use crate::ability::ability_ir::DefinedRef;
use crate::card::card_util;
use crate::card::perpetual::perpetual_interface::PerpetualInterface;
use crate::card::perpetual::{perpetual_keywords, perpetual_pt_boost};

/// Parsed `NumAtt$`/`NumDef$` bonus spec: either a fixed literal or a
/// target-relative scale (Java L469–L481).
#[derive(Clone, Copy)]
enum PtBonus {
    Fixed(i32),
    Double,
    Triple,
}

impl PtBonus {
    fn parse(raw: Option<&str>, fallback: impl FnOnce() -> i32) -> Self {
        match raw {
            Some("Double") => PtBonus::Double,
            Some("Triple") => PtBonus::Triple,
            _ => PtBonus::Fixed(fallback()),
        }
    }

    /// Resolve the bonus against a concrete target's current P or T.
    fn resolve(self, current: i32) -> i32 {
        match self {
            PtBonus::Fixed(n) => n,
            PtBonus::Double => current,
            PtBonus::Triple => current * 2,
        }
    }
}

/// End-of-turn revert for Pump. Mirrors the `GameCommand.run()` in Java
/// `PumpEffect` that reverses the P/T bonus and removes granted keywords
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
    game.card_mut(card_id).power_modifier -= att_bonus;
    game.card_mut(card_id).toughness_modifier -= def_bonus;
    for kw in keywords {
        game.card_mut(card_id).pump_keywords.remove(kw);
    }
}

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `PumpEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(PumpEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let mut pumped_targets: Vec<crate::ids::CardId> = Vec::new();

    // `Optional$` — activator confirms before any pump applies (Java L283–L292).
    if sa.ir.optional_present {
        let card_name = sa.source.map(|cid| ctx.game.card(cid).card_name.clone());
        let prompt = sa
            .ir
            .option_question
            .as_deref()
            .unwrap_or("Apply pump to target?");
        let activator = sa.activating_player;
        if !ctx.agents[activator.index()].confirm_action(
            activator,
            Some("OptionalPump"),
            prompt,
            &[],
            sa.source,
            sa.api,
        ) {
            return;
        }
    }

    let att_bonus = PtBonus::parse(sa.ir.num_att.as_deref(), || {
        match sa.ir.num_att.as_deref() {
            Some(raw) => super::resolve_numeric_value(ctx.game, sa, raw, 0),
            None => 0,
        }
    });
    let def_bonus = PtBonus::parse(sa.ir.num_def.as_deref(), || {
        match sa.ir.num_def.as_deref() {
            Some(raw) => super::resolve_numeric_value(ctx.game, sa, raw, 0),
            None => 0,
        }
    });

    // Parse KW$ parameter for keyword grants (e.g. "KW$ Haste" or "KW$ Flying & Trample")
    let mut keywords: Vec<String> = sa
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

    // `KWChoice$` — activator picks one keyword from a comma-separated list
    // (Java L297–L302). Reuses `choose_mode` which maps to a pick-one dialog
    // in concrete agents.
    if let Some(kw_choice) = sa.ir.kw_choice.as_deref() {
        let options: Vec<String> = kw_choice
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if !options.is_empty() {
            let activator = sa.activating_player;
            let picks =
                ctx.agents[activator.index()].choose_mode(activator, &options, 1, 1, sa.source);
            if let Some(&idx) = picks.first() {
                if let Some(kw) = options.get(idx) {
                    keywords.push(kw.clone());
                }
            }
        }
    }

    // `CanBlockAny$` — synthetic keyword grant (Java L79–L85 / L240–L253).
    // Rust has no dedicated `addCanBlockAny` / `addCanBlockAdditional`, so we
    // encode the permission as pump keywords that block-restriction code can
    // match on ("CanBlockAny" / "CanBlock:N"). Full block-amount support lands
    // once the combat module reads these markers.
    if sa.ir.can_block_any {
        keywords.push("CanBlockAny".to_string());
    }
    if let Some(amt) = sa.ir.can_block_amount.as_deref() {
        keywords.push(format!("CanBlock:{}", amt));
    }

    let is_perpetual = sa.ir.perpetual_duration;
    let resolve_ts = if is_perpetual {
        Some(ctx.game.next_effect_timestamp())
    } else {
        None
    };

    // Overload: apply pump to ALL valid creatures instead of the chosen target.
    if sa.overloaded {
        let valid_tgts = sa.ir.valid_tgts_text.clone().unwrap_or_default();
        let valid_tgts_selector = sa.ir.valid_tgts_selector.as_ref();
        let all_bf: Vec<crate::ids::CardId> = ctx
            .game
            .player_order
            .clone()
            .iter()
            .flat_map(|&pid| ctx.game.cards_in_zone(ZoneType::Battlefield, pid).to_vec())
            .collect();
        for cid in all_bf {
            if ctx.game.card(cid).zone != ZoneType::Battlefield {
                continue;
            }
            if !super::matches_valid_cards_for_sa(
                ctx.game,
                sa,
                ctx.game.card(cid),
                valid_tgts_selector,
                &valid_tgts,
            ) {
                continue;
            }
            let target = ctx.game.card(cid);
            let att = att_bonus.resolve(target.power());
            let def = def_bonus.resolve(target.toughness());
            apply_pump_to_card(ctx, cid, att, def, &keywords, is_perpetual, resolve_ts);
        }
        return;
    }

    let mut targets = crate::ability::spell_ability_effect::get_target_cards(ctx.game, sa);
    if targets.is_empty() && matches!(sa.defined_ref(), Some(DefinedRef::ParentTarget)) {
        targets.extend(ctx.parent_target_card);
    }
    targets.extend(card_util::get_radiance(ctx.game, sa).iter().copied());
    targets.sort_unstable_by_key(|cid| cid.0);
    targets.dedup();

    let tgt_zones = sa
        .target_restrictions
        .as_ref()
        .map(|tr| tr.tgt_zone.clone())
        .filter(|zones| !zones.is_empty())
        .unwrap_or_else(|| vec![ZoneType::Battlefield]);
    for target_card in targets {
        if !tgt_zones.contains(&ctx.game.card(target_card).zone) {
            continue;
        }
        let target = ctx.game.card(target_card);
        let att = att_bonus.resolve(target.power());
        let def = def_bonus.resolve(target.toughness());
        apply_pump_to_card(
            ctx,
            target_card,
            att,
            def,
            &keywords,
            is_perpetual,
            resolve_ts,
        );
        pumped_targets.push(target_card);
    }

    if pumped_targets.is_empty() && !keywords.is_empty() {
        let pumped_players: Vec<crate::ids::PlayerId> =
            if let Some(tp) = sa.target_chosen.target_player {
                vec![tp]
            } else if let Some(d) = sa.defined() {
                crate::ability::ability_utils::resolve_defined_players_with_sa(
                    d,
                    sa,
                    sa.activating_player,
                    ctx.game,
                )
            } else {
                Vec::new()
            };
        for player in pumped_players {
            for kw in &keywords {
                crate::player::add_pump_keyword_with_duration(
                    ctx.game,
                    player,
                    kw.clone(),
                    sa.ir.duration.as_ref(),
                );
            }
        }
    }

    // `AtEOT$ <action>` — register an end-of-turn delayed trigger that performs
    // `action` on the pumped targets (Java PumpEffect L486).
    if let Some(action) = sa.ir.at_eot.as_deref() {
        crate::ability::spell_ability_effect::register_at_eot(
            ctx.trigger_handler,
            ctx.game,
            sa,
            action,
            pumped_targets,
        );
    }
}

fn apply_pump_to_card(
    ctx: &mut EffectContext,
    card_id: crate::ids::CardId,
    att: i32,
    def: i32,
    keywords: &[String],
    is_perpetual: bool,
    resolve_ts: Option<i64>,
) {
    if is_perpetual {
        let ts = resolve_ts.expect("perpetual resolve timestamp must exist");
        let card = ctx.game.card_mut(card_id);
        perpetual_pt_boost::PerpetualPtBoost {
            timestamp: ts,
            power: att,
            toughness: def,
        }
        .apply_effect(card);
        for kw in keywords {
            perpetual_keywords::PerpetualKeywords {
                timestamp: ts,
                add_keywords: vec![kw.clone()],
                remove_keywords: Vec::new(),
                remove_all: false,
            }
            .apply_effect(card);
        }
    } else {
        ctx.game.card_mut(card_id).add_pt_boost(att, def);
        for kw in keywords {
            ctx.game.card_mut(card_id).add_pump_keyword(kw);
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

    fn make_creature(game: &mut GameState, owner: PlayerId, name: &str) -> CardId {
        let c = Card::new(
            CardId(0),
            name.into(),
            owner,
            CardTypeLine::parse("Creature - Human Soldier"),
            ManaCost::parse("1 W"),
            ColorSet::WHITE,
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
    fn non_targeted_pump_defaults_to_self_like_java() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);
        let guardian = make_creature(&mut game, p0, "Guardian of New Benalia");
        game.move_card(guardian, ZoneType::Battlefield, p0);

        let sa = SpellAbility::new_simple(
            Some(guardian),
            p0,
            "AB$ Pump | KW$ Indestructible | SpellDescription$ CARDNAME gains indestructible until end of turn.",
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

        super::PumpEffect::resolve(&mut ctx, &sa);

        assert!(ctx.game.card(guardian).has_indestructible());
    }

    #[test]
    fn targeted_pump_does_not_fall_back_to_source() {
        let mut game = GameState::new(&["Alice", "Bob"], 20);
        let p0 = PlayerId(0);
        let source = make_creature(&mut game, p0, "Source");
        game.move_card(source, ZoneType::Battlefield, p0);

        let sa = SpellAbility::new_simple(
            Some(source),
            p0,
            "SP$ Pump | ValidTgts$ Creature | KW$ Indestructible",
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

        super::PumpEffect::resolve(&mut ctx, &sa);

        assert!(!ctx.game.card(source).has_indestructible());
    }
}
