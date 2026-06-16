//! TokenEffectBase — shared token creation machinery.
//!
//! Mirrors Java's `TokenEffectBase.java`.  Rust effects are generated as
//! resolver functions rather than subclasses, so this module exposes a trait
//! with Java-parity default methods plus a concrete stateless implementation
//! used by effects that need the common token path.
use std::collections::HashMap;

use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};

use super::{emit_zone_trigger, EffectContext};
use crate::agent::types::GameEntity;
use crate::card::card_zone_table::CardZoneTable;
use crate::card::Card;
use crate::event::RunParams;
use crate::ids::{CardId, PlayerId};
use crate::parsing::{keys, split_param_list_value};
use crate::replacement::replacement_handler::{apply_replacements_with_agents, ReplacementEvent};
use crate::replacement::replacement_result::ReplacementResult;
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

#[derive(Clone)]
pub struct TokenTableCell {
    pub owner: PlayerId,
    pub prototype: Card,
    pub amount: usize,
}

#[derive(Clone, Default)]
pub struct TokenCreateTable {
    cells: Vec<TokenTableCell>,
}

impl TokenCreateTable {
    pub fn put(&mut self, owner: PlayerId, prototype: Card, amount: usize) {
        self.cells.push(TokenTableCell {
            owner,
            prototype,
            amount,
        });
    }

    pub fn cells(&self) -> &[TokenTableCell] {
        &self.cells
    }

    pub fn retain_players(&mut self, keep: impl Fn(PlayerId) -> bool) {
        self.cells.retain(|cell| keep(cell.owner));
    }

    pub fn is_empty(&self) -> bool {
        self.cells.is_empty()
    }
}

#[derive(Debug, Clone, Default)]
pub struct TokenCreateResult {
    pub created: Vec<CardId>,
    pub combat_changed: bool,
}

#[derive(Clone, Copy)]
pub enum TokenAttachmentTarget {
    Card(CardId),
    Player(PlayerId),
}

pub trait TokenEffectBase {
    fn token_scripts(&self, sa: &SpellAbility) -> Vec<String> {
        split_param_list_value(sa.ir.token_script.as_deref(), ",")
    }

    fn get_token_template<'a>(
        &self,
        templates: &'a HashMap<String, Card>,
        script: &str,
    ) -> Option<&'a Card> {
        templates.get(script).or_else(|| {
            let lower = script.to_ascii_lowercase();
            templates
                .iter()
                .find(|(key, _)| key.to_ascii_lowercase() == lower)
                .map(|(_, value)| value)
        })
    }

    fn require_token_template(&self, templates: &HashMap<String, Card>, script: &str) -> Card {
        self.get_token_template(templates, script)
            .cloned()
            .unwrap_or_else(|| panic!("don't find Token for TokenScript: {script}"))
    }

    fn create_token_table(
        &self,
        ctx: &EffectContext,
        players: &[PlayerId],
        token_scripts: &[String],
        final_amount: usize,
        sa: &SpellAbility,
    ) -> TokenCreateTable {
        let mut token_table = TokenCreateTable::default();
        for &owner in players {
            if !ctx.game.player(owner).is_alive() {
                continue;
            }
            for script in token_scripts {
                let mut result = self.require_token_template(ctx.token_templates, script);
                result.set_owner(owner);
                result.set_controller(owner);
                result.set_is_token(true);
                result.set_s_var("TokenScript", script);
                result.set_s_var("TokenSpawningAbility", sa.ability_text.clone());
                token_table.put(owner, result, final_amount);
            }
        }
        token_table
    }

    fn make_token_table_internal_from_script(
        &self,
        ctx: &EffectContext,
        owner: PlayerId,
        script: &str,
        final_amount: usize,
        sa: &SpellAbility,
    ) -> TokenCreateTable {
        let mut result = self.require_token_template(ctx.token_templates, script);
        result.set_owner(owner);
        result.set_controller(owner);
        result.set_is_token(true);
        result.set_s_var("TokenScript", script);
        result.set_s_var("TokenSpawningAbility", sa.ability_text.clone());
        self.make_token_table_internal(owner, result, final_amount)
    }

    fn make_token_table_internal(
        &self,
        owner: PlayerId,
        result: Card,
        final_amount: usize,
    ) -> TokenCreateTable {
        let mut token_table = TokenCreateTable::default();
        token_table.put(owner, result, final_amount);
        token_table
    }

    fn has_inline_token_params(&self, sa: &SpellAbility) -> bool {
        sa.ir.token_power.is_some()
            || sa.ir.token_toughness.is_some()
            || sa.ir.token_types_text.is_some()
            || sa.ir.token_name_text.is_some()
    }

    fn build_inline_token(&self, sa: &SpellAbility, owner: PlayerId) -> Card {
        let name = sa
            .ir
            .token_name_text
            .clone()
            .unwrap_or_else(|| "Token".to_string());
        let power = sa.ir.token_power;
        let toughness = sa.ir.token_toughness;
        let type_line = sa
            .ir
            .token_types_text
            .as_deref()
            .map(CardTypeLine::parse)
            .unwrap_or_else(|| CardTypeLine::parse("Creature"));
        let colors = sa
            .ir
            .token_colors_text
            .as_deref()
            .map(|s| {
                if s.eq_ignore_ascii_case("Colorless") {
                    ColorSet::COLORLESS
                } else {
                    ColorSet::from_names(s)
                }
            })
            .unwrap_or(ColorSet::COLORLESS);
        let keywords = split_param_list_value(sa.ir.token_keywords_text.as_deref(), "&");

        Card::new(
            CardId(0),
            name,
            owner,
            type_line,
            ManaCost::parse(""),
            colors,
            power,
            toughness,
            keywords,
            vec![],
        )
    }

    fn make_token_table_from_scripts(
        &self,
        ctx: &mut EffectContext,
        players: &[PlayerId],
        token_scripts: &[String],
        final_amount: usize,
        clone_origin: bool,
        trigger_list: &mut CardZoneTable,
        sa: &SpellAbility,
    ) -> TokenCreateResult {
        let token_table = self.create_token_table(ctx, players, token_scripts, final_amount, sa);
        self.make_token_table(ctx, token_table, clone_origin, trigger_list, sa)
    }

    fn make_token_table(
        &self,
        ctx: &mut EffectContext,
        mut token_table: TokenCreateTable,
        clone_origin: bool,
        trigger_list: &mut CardZoneTable,
        sa: &SpellAbility,
    ) -> TokenCreateResult {
        if token_table.is_empty() {
            return TokenCreateResult::default();
        }

        self.apply_create_token_replacements(ctx, &mut token_table);

        let original_tokens: Vec<Card> = token_table
            .cells()
            .iter()
            .map(|cell| cell.prototype.clone())
            .collect();
        let pump_keywords = self.pump_keywords(sa);
        let mut result = TokenCreateResult::default();

        for cell in token_table.cells().iter().cloned() {
            let script = cell.prototype.get_s_var("TokenScript").map(str::to_owned);
            if let Some(script) = script.as_deref() {
                ctx.sync_token_art_rng(script, sa);
            }

            let controller = cell.prototype.controller;
            for _ in 0..cell.amount {
                let Some(token_id) = self.create_single_token(
                    ctx,
                    sa,
                    &cell.prototype,
                    cell.owner,
                    controller,
                    clone_origin,
                    &pump_keywords,
                    trigger_list,
                    &original_tokens,
                ) else {
                    // Java records a None->None table entry with a null moved card here.
                    // Rust CardZoneTable is CardId-only, so there is no valid value to store.
                    continue;
                };
                result.created.push(token_id);
                if self.add_token_to_combat(ctx, sa, token_id) {
                    result.combat_changed = true;
                }
            }
        }

        if let Some(action) = sa.ir.at_eot.as_deref() {
            crate::ability::spell_ability_effect::register_at_eot(
                ctx.trigger_handler,
                ctx.game,
                sa,
                action,
                result.created.clone(),
            );
        }

        result
    }

    fn create_single_token(
        &self,
        ctx: &mut EffectContext,
        sa: &SpellAbility,
        prototype: &Card,
        creator: PlayerId,
        controller: PlayerId,
        clone_origin: bool,
        pump_keywords: &[String],
        trigger_list: &mut CardZoneTable,
        original_tokens: &[Card],
    ) -> Option<CardId> {
        let attachment_before_move = if sa.ir.attach_after_text.is_none() {
            self.attachment_target(ctx, sa)
        } else {
            None
        };
        if sa.ir.attached_to.is_some()
            && attachment_before_move.is_none()
            && prototype.type_line.has_subtype("Aura")
        {
            return None;
        }

        let mut token = prototype.clone();
        token.set_owner(creator);
        token.set_controller(controller);
        token.set_is_token(true);

        if let Some(counter_type) = sa.ir.with_counters_type.as_ref() {
            let amount = super::resolve_numeric_svar(ctx.game, sa, keys::WITH_COUNTERS_AMOUNT, 1);
            token.add_counter(counter_type, amount.max(0));
        }

        if let Some(add_triggers_from) = sa.ir.add_triggers_from_text.as_deref() {
            if let Some(source_id) = sa.source {
                let cards = crate::ability::ability_utils::get_defined_cards(
                    ctx.game,
                    Some(source_id),
                    add_triggers_from,
                    Some(sa.activating_player),
                );
                for card_id in cards {
                    for trigger in ctx.game.card(card_id).copiable_triggers() {
                        token.add_trigger(trigger);
                    }
                }
            }
        }

        let token_id = ctx.game.create_card(token);
        self.after_token_created(ctx, token_id);
        if let Some(attachment) = attachment_before_move {
            if !self.attach_token_to(ctx, token_id, attachment)
                && ctx.game.card(token_id).type_line.has_subtype("Aura")
            {
                return None;
            }
        }

        ctx.move_card(token_id, ZoneType::Battlefield, controller);

        if sa.ir.token_tapped {
            ctx.game.tap(token_id);
        }

        if clone_origin {
            if let Some(source_id) = sa.source {
                ctx.game.card_mut(token_id).clone_origin = Some(source_id);
            }
        }
        if clone_origin || prototype.copied_permanent.is_some() {
            ctx.game.card_mut(token_id).copied_permanent =
                prototype.copied_permanent.or_else(|| {
                    if prototype.id != CardId(0) {
                        Some(prototype.id)
                    } else {
                        None
                    }
                });
        }

        if !pump_keywords.is_empty() {
            for keyword in pump_keywords {
                ctx.game.card_mut(token_id).add_pump_keyword(keyword);
            }
            self.add_pump_until(ctx, sa, token_id);
        }

        if let Some(location) = sa.ir.at_eot_trig_text.as_deref() {
            crate::ability::spell_ability_effect::add_self_trigger_at_eot(
                ctx.trigger_handler,
                ctx.game,
                location,
                token_id,
            );
        }

        if sa.ir.remember_tokens {
            if let Some(source_id) = sa.source {
                ctx.game.card_mut(source_id).add_remembered_card(token_id);
            }
        }
        if sa.ir.remember_original_tokens
            && original_tokens.iter().any(|original| {
                original.card_name == prototype.card_name
                    && original.type_line == prototype.type_line
            })
        {
            if let Some(source_id) = sa.source {
                ctx.game.card_mut(source_id).add_remembered_card(token_id);
            }
        }
        if sa.ir.imprint_tokens {
            if let Some(source_id) = sa.source {
                ctx.game.card_mut(source_id).add_imprinted_card(token_id);
            }
        }
        if sa.ir.remember_source {
            if let Some(source_id) = sa.source {
                ctx.game.card_mut(token_id).add_remembered_card(source_id);
            }
        }
        if let Some(defined) = sa.ir.token_remembered.as_deref() {
            if let Some(source_id) = sa.source {
                let remembered_cards = crate::ability::ability_utils::get_defined_cards(
                    ctx.game,
                    Some(source_id),
                    defined,
                    Some(sa.activating_player),
                );
                ctx.game
                    .card_mut(token_id)
                    .add_remembered_cards(remembered_cards);
            }
        }
        if sa.ir.cleanup_for_each {
            let remembered = prototype.remembered_cards.clone();
            for card_id in remembered {
                ctx.game.card_mut(token_id).remove_remembered(card_id);
            }
        }

        if sa.ir.attach_after_text.is_some() {
            if let Some(attachment) = self.attachment_target(ctx, sa) {
                let _ = self.attach_token_to(ctx, token_id, attachment);
            }
        }

        ctx.trigger_handler
            .register_active_trigger(ctx.game, token_id);
        ctx.trigger_handler.run_trigger(
            TriggerType::TokenCreated,
            RunParams {
                card: Some(token_id),
                player: Some(creator),
                ..Default::default()
            },
            false,
        );
        emit_zone_trigger(
            ctx.trigger_handler,
            token_id,
            ZoneType::None,
            ZoneType::Battlefield,
        );

        let token_lki = crate::card::card_copy_service::get_lki_copy(ctx.game.card(token_id));
        trigger_list.put(Some(ZoneType::None), Some(ZoneType::Battlefield), token_id);
        let first_time = ctx.game.player(creator).tokens_created_this_turn == 0;
        // TODO(parity): Java CardZoneTable stores the token LKI copy here. Rust
        // CardZoneTable currently stores CardId only, so consumers see the live token.
        let _ = token_lki;
        trigger_list.add_token(token_id, creator, first_time);
        crate::player::add_tokens_created_this_turn(ctx.game, creator, 1);

        Some(token_id)
    }

    fn after_token_created(&self, ctx: &mut EffectContext, token_id: CardId) {
        let token = ctx.game.card_mut(token_id);
        token.update_spell_abilities();

        let bound_host = ctx.game.card(token_id).clone();
        let token = ctx.game.card_mut(token_id);
        for trigger in &mut token.triggers {
            trigger.bind_host_card_id(bound_host.id);
        }
        for static_ability in &mut token.static_abilities {
            static_ability.base.set_host_card_id(bound_host.id);
        }
        for replacement_effect in &mut token.replacement_effects {
            replacement_effect.base.set_host_card_id(bound_host.id);
        }
    }

    fn attachment_target(
        &self,
        ctx: &mut EffectContext,
        sa: &SpellAbility,
    ) -> Option<TokenAttachmentTarget> {
        let attached_to = sa.ir.attached_to.as_deref()?;
        let (players, cards) =
            crate::ability::ability_utils::get_defined_entities(attached_to, sa, ctx.game);
        let mut entities = Vec::with_capacity(players.len() + cards.len());
        entities.extend(players.into_iter().map(GameEntity::Player));
        entities.extend(
            cards
                .into_iter()
                .filter(|&card_id| ctx.game.card(card_id).zone == ZoneType::Battlefield)
                .map(GameEntity::Card),
        );
        if entities.is_empty() {
            return None;
        }

        ctx.agents[sa.activating_player.index()].snapshot_state(ctx.game, ctx.mana_pools);
        let chosen = ctx.agents[sa.activating_player.index()].choose_single_entity_for_effect(
            sa.activating_player,
            &entities,
            false,
        )?;
        match chosen {
            GameEntity::Card(card_id) => Some(TokenAttachmentTarget::Card(card_id)),
            GameEntity::Player(player_id) => Some(TokenAttachmentTarget::Player(player_id)),
        }
    }

    fn attach_token_to(
        &self,
        ctx: &mut EffectContext,
        token_id: CardId,
        target: TokenAttachmentTarget,
    ) -> bool {
        match target {
            TokenAttachmentTarget::Card(target_id) => {
                if ctx.game.card(target_id).zone != ZoneType::Battlefield {
                    return false;
                }
                if crate::staticability::static_ability_cant_attach::cant_attach(
                    &ctx.game.cards,
                    ctx.game.card(token_id),
                    ctx.game.card(target_id),
                    false,
                ) {
                    return false;
                }
                ctx.game.attach_to(token_id, target_id);
                true
            }
            TokenAttachmentTarget::Player(player_id) => {
                if !ctx.game.player(player_id).is_alive() {
                    return false;
                }
                ctx.game.attach_to_player(token_id, player_id);
                true
            }
        }
    }

    fn add_token_to_combat(
        &self,
        ctx: &mut EffectContext,
        sa: &SpellAbility,
        token_id: CardId,
    ) -> bool {
        if super::add_to_combat(ctx, sa, token_id, keys::TOKEN_ATTACKING) {
            return true;
        }
        self.add_token_blocking(ctx, sa, token_id)
    }

    fn add_token_blocking(
        &self,
        ctx: &mut EffectContext,
        sa: &SpellAbility,
        token_id: CardId,
    ) -> bool {
        if !ctx.game.turn.is_combat() || !ctx.game.card(token_id).is_creature() {
            return false;
        }
        let Some(blocking) = sa.ir.token_blocking_text.as_deref() else {
            return false;
        };
        let attackers = crate::ability::ability_utils::get_defined_cards(
            ctx.game,
            sa.source,
            blocking,
            Some(sa.activating_player),
        );
        let Some(combat) = ctx.combat.as_deref_mut() else {
            return false;
        };
        let Some(attacker_id) = attackers
            .into_iter()
            .find(|&attacker_id| combat.is_attacking(attacker_id))
        else {
            return false;
        };
        if !crate::combat::combat_util::can_creature_block(ctx.game, token_id, attacker_id) {
            return false;
        }
        if combat
            .blockers
            .iter()
            .any(|&(blocker, attacker)| blocker == token_id && attacker == attacker_id)
        {
            return false;
        }
        combat.declare_blocker(
            token_id,
            attacker_id,
            ctx.game.card(token_id).zone_timestamp,
        );
        true
    }

    fn pump_keywords(&self, sa: &SpellAbility) -> Vec<String> {
        split_param_list_value(sa.ir.pump_keywords.as_deref(), " & ")
    }

    fn add_pump_until(&self, ctx: &mut EffectContext, sa: &SpellAbility, token_id: CardId) {
        if let Some(duration) = sa.ir.pump_duration_text.as_deref() {
            ctx.game
                .card_mut(token_id)
                .set_s_var("PumpDuration", duration);
        }
    }

    fn apply_create_token_replacements(
        &self,
        ctx: &mut EffectContext,
        token_table: &mut TokenCreateTable,
    ) {
        let mut retained = Vec::with_capacity(token_table.cells.len());
        for mut cell in token_table.cells.drain(..) {
            let mut event = ReplacementEvent::CreateToken {
                player: cell.owner,
                count: cell.amount as i32,
                is_effect: true,
            };
            match apply_replacements_with_agents(&mut *ctx.game, ctx.agents, &mut event) {
                ReplacementResult::NotReplaced => retained.push(cell),
                ReplacementResult::Updated => {
                    if let ReplacementEvent::CreateToken { count, .. } = event {
                        cell.amount = count.max(0) as usize;
                    }
                    retained.push(cell);
                }
                ReplacementResult::Replaced
                | ReplacementResult::Prevented
                | ReplacementResult::Skipped => {}
            }
        }
        token_table.cells = retained;
    }
}

pub struct TokenEffectBaseImpl;

impl TokenEffectBase for TokenEffectBaseImpl {}

pub const TOKEN_EFFECT_BASE: TokenEffectBaseImpl = TokenEffectBaseImpl;
