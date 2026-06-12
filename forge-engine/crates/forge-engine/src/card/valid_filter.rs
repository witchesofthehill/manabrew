//! Shared card/player filter matching used across triggers, static abilities,
//! replacement effects, and combat. Consolidates 34 duplicate implementations.
//!
//! This module provides canonical implementations for matching cards and players
//! against filter expressions like "Creature.YouCtrl" or "Opponent".
//!
//! **Filter Syntax:**
//!
//! Card filters are dot-separated: "Creature.YouCtrl.nonToken"
//! - Comma separates OR conditions: "Creature,Artifact" matches either
//! - Dot separates qualifiers: "Creature.YouCtrl" matches creatures you control
//! - Plus separates compound conditions: "YouCtrl+kicked" matches both
//!
//! **Type parts:**
//! - Card, Permanent, Creature, Land, Artifact, Enchantment, Planeswalker, Instant, Sorcery
//! - Subtypes: "Zombie", "Wall", "Forest", etc.
//!
//! **Qualifiers:**
//! - Controller: YouCtrl, OppCtrl, YouControl, OpponentCtrl
//! - Self: Self, Other, StrictlyOther
//! - Token: token, nonToken
//! - Type negation: nonCreature, nonLand
//! - State: tapped, untapped, kicked
//! - Counters: counters_GE3_P1P1, counters_EQ1_Charge
//! - CMC: cmcEQ1, cmcLE3, cmcGE5
//! - Color: White, Blue, Black, Red, Green, Colorless, multicolor
//! - Combat: DamagedBy
//! - Attachment: EnchantedBy

use forge_foundation::color::Color;
use forge_foundation::mana::ManaAtom;
use forge_foundation::ZoneType;

use crate::card::Card;
use crate::combat::{CombatState, DefenderId};
use crate::core::HasSVars;
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::parsing::compare::compare_expr;
use crate::parsing::keys;
use crate::parsing::{
    cached_compiled_selector, CardColorSelector, CardIdentitySelector, CardSelectorType,
    CardStateSelector, CardSupertypeSelector, CompiledSelector, ContextPredicate,
    ControllerSelector, NumericSelectorProperty, ParsedParams, RelationPredicate, Selector,
    SelectorCompareOperator, SelectorNumericOperand, SelectorPredicate, TargetRef,
};
use crate::spellability::SpellAbility;

fn requirement_controller(game: &GameState, source: &Card) -> PlayerId {
    let mut controller = source.controller;

    // Java parity: during trigger resolution, use the resolving trigger's
    // activating player rather than the host card's current controller.
    if !game.stack.is_empty()
        && game.stack.is_resolving()
        && game.stack.cur_resolving_card() == Some(source.id)
    {
        if let Some(entry) = game.stack.peek() {
            if entry.spell_ability.is_trigger {
                controller = entry.spell_ability.activating_player;
            }
        }
    }

    controller
}

fn requirement_amount(
    source: &Card,
    svar_source: &dyn HasSVars,
    expr: &str,
    game: &GameState,
) -> i32 {
    let raw_value = svar_source
        .get_svar(expr)
        .or_else(|| source.get_s_var(expr))
        .unwrap_or(expr)
        .trim();

    if let Ok(n) = raw_value.parse::<i32>() {
        return n;
    }
    if let Some(stripped) = raw_value.strip_prefix('+') {
        if let Ok(n) = stripped.parse::<i32>() {
            return n;
        }
    }
    if let Some(stripped) = raw_value.strip_prefix('-') {
        return -requirement_amount(source, svar_source, stripped.trim(), game);
    }

    if raw_value.starts_with("Count$") {
        return crate::svar::resolve_count_svar(raw_value, game, source.id, source.controller);
    }

    let sa = crate::spellability::SpellAbility::new_simple(
        Some(source.id),
        requirement_controller(game, source),
        &format!("DB$ Internal | Amount$ {raw_value}"),
    );
    let resolved = crate::svar::resolve_numeric_value(game, &sa, raw_value, i32::MIN);
    if resolved != i32::MIN {
        return resolved;
    }

    0
}

fn compare_requirement_amount(
    source: &Card,
    svar_source: &dyn HasSVars,
    compare: &str,
    game: &GameState,
    left: i32,
) -> bool {
    let operator = compare.get(..compare.len().min(2)).unwrap_or("GE");
    let operand_expr = compare.get(compare.len().min(2)..).unwrap_or("1");
    let operand = requirement_amount(source, svar_source, operand_expr, game);
    compare_expr(left, &format!("{operator}{operand}"))
}

/// Typed requirement bag for Java `CardTraitBase.meetsCommonRequirements(params)`.
///
/// Only params consumed by that Java method belong here. This keeps the shared
/// requirement gate reusable across trigger, spell ability, static ability, and
/// replacement IRs without passing the full legacy `Params` map at runtime.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CardTraitRequirementsIr {
    metalcraft: Option<String>,
    delirium: Option<String>,
    threshold: Option<String>,
    hellbent: Option<String>,
    bloodthirst: Option<String>,
    fateful_hour: Option<String>,
    monarch: Option<String>,
    revolt: Option<String>,
    desert: Option<String>,
    blessing: Option<String>,
    day_time: Option<String>,
    adamant: Option<String>,
    life_total: Option<String>,
    life_amount: Option<String>,
    is_present: Option<String>,
    is_present_selector: Option<CompiledSelector>,
    present_compare: Option<String>,
    present_player: Option<String>,
    present_zone: Option<String>,
    present_defined: Option<String>,
    is_present2: Option<String>,
    is_present2_selector: Option<CompiledSelector>,
    present_compare2: Option<String>,
    present_player2: Option<String>,
    present_zone2: Option<String>,
    check_defined_player: Option<String>,
    defined_player_compare: Option<String>,
    check_svar: Option<String>,
    svar_compare: Option<String>,
    check_second_svar: Option<String>,
    second_svar_compare: Option<String>,
    mana_spent: Option<String>,
    mana_not_spent: Option<String>,
    werewolf_transform_condition: bool,
    werewolf_untransform_condition: bool,
    class_level: Option<String>,
    condition: Option<String>,
}

impl CardTraitRequirementsIr {
    pub fn from_key_values<'a, I>(
        entries: I,
        is_present_selector: Option<CompiledSelector>,
        is_present2_selector: Option<CompiledSelector>,
    ) -> Self
    where
        I: IntoIterator<Item = (&'a str, &'a str)>,
    {
        let mut ir = Self::default();
        for (key, value) in entries {
            ir.set(key, value);
        }
        ir.is_present_selector = is_present_selector;
        ir.is_present2_selector = is_present2_selector;
        ir
    }

    pub fn from_parsed(params: &ParsedParams<'_>) -> Self {
        let mut ir = Self::from_key_values(
            params
                .entries()
                .iter()
                .map(|entry| (entry.key, entry.value)),
            None,
            None,
        );
        ir.is_present_selector = ir.is_present.as_deref().map(cached_compiled_selector);
        ir.is_present2_selector = ir.is_present2.as_deref().map(cached_compiled_selector);
        ir
    }

    pub fn is_empty(&self) -> bool {
        self.metalcraft.is_none()
            && self.delirium.is_none()
            && self.threshold.is_none()
            && self.hellbent.is_none()
            && self.bloodthirst.is_none()
            && self.fateful_hour.is_none()
            && self.monarch.is_none()
            && self.revolt.is_none()
            && self.desert.is_none()
            && self.blessing.is_none()
            && self.day_time.is_none()
            && self.adamant.is_none()
            && self.life_total.is_none()
            && self.is_present.is_none()
            && self.is_present2.is_none()
            && self.check_defined_player.is_none()
            && self.check_svar.is_none()
            && self.check_second_svar.is_none()
            && self.mana_spent.is_none()
            && self.mana_not_spent.is_none()
            && !self.werewolf_transform_condition
            && !self.werewolf_untransform_condition
            && self.class_level.is_none()
            && self.condition.is_none()
    }

    pub fn meets(&self, game: &GameState, source: &Card, svar_source: &dyn HasSVars) -> bool {
        meets_card_trait_requirements(self, game, source, svar_source)
    }

    fn set(&mut self, key: &str, value: &str) {
        match key {
            "Metalcraft" => self.metalcraft = Some(value.to_string()),
            "Delirium" => self.delirium = Some(value.to_string()),
            "Threshold" => self.threshold = Some(value.to_string()),
            "Hellbent" => self.hellbent = Some(value.to_string()),
            "Bloodthirst" => self.bloodthirst = Some(value.to_string()),
            "FatefulHour" => self.fateful_hour = Some(value.to_string()),
            "Monarch" => self.monarch = Some(value.to_string()),
            "Revolt" => self.revolt = Some(value.to_string()),
            "Desert" => self.desert = Some(value.to_string()),
            "Blessing" => self.blessing = Some(value.to_string()),
            "DayTime" => self.day_time = Some(value.to_string()),
            "Adamant" => self.adamant = Some(value.to_string()),
            "LifeTotal" => self.life_total = Some(value.to_string()),
            "LifeAmount" => self.life_amount = Some(value.to_string()),
            keys::IS_PRESENT => self.is_present = Some(value.to_string()),
            keys::PRESENT_COMPARE => self.present_compare = Some(value.to_string()),
            keys::PRESENT_PLAYER => self.present_player = Some(value.to_string()),
            keys::PRESENT_ZONE => self.present_zone = Some(value.to_string()),
            "PresentDefined" => self.present_defined = Some(value.to_string()),
            "IsPresent2" => self.is_present2 = Some(value.to_string()),
            "PresentCompare2" => self.present_compare2 = Some(value.to_string()),
            "PresentPlayer2" => self.present_player2 = Some(value.to_string()),
            "PresentZone2" => self.present_zone2 = Some(value.to_string()),
            "CheckDefinedPlayer" => self.check_defined_player = Some(value.to_string()),
            "DefinedPlayerCompare" => self.defined_player_compare = Some(value.to_string()),
            keys::CHECK_SVAR => self.check_svar = Some(value.to_string()),
            keys::SVAR_COMPARE => self.svar_compare = Some(value.to_string()),
            "CheckSecondSVar" => self.check_second_svar = Some(value.to_string()),
            "SecondSVarCompare" => self.second_svar_compare = Some(value.to_string()),
            "ManaSpent" => self.mana_spent = Some(value.to_string()),
            "ManaNotSpent" => self.mana_not_spent = Some(value.to_string()),
            "WerewolfTransformCondition" => self.werewolf_transform_condition = true,
            "WerewolfUntransformCondition" => self.werewolf_untransform_condition = true,
            "ClassLevel" => self.class_level = Some(value.to_string()),
            keys::CONDITION => self.condition = Some(value.to_string()),
            _ => {}
        }
    }
}

fn check_boolean_requirement(value: Option<&str>, actual: bool) -> bool {
    value.is_none_or(|value| value.eq_ignore_ascii_case("True") == actual)
}

fn player_life_for_requirement(game: &GameState, source: &Card, who: &str) -> i32 {
    let controller = requirement_controller(game, source);
    match who {
        "You" => game.player(controller).life,
        "OpponentSmallest" => game
            .alive_players()
            .into_iter()
            .filter(|&pid| pid != controller)
            .map(|pid| game.player(pid).life)
            .min()
            .unwrap_or(1),
        "OpponentGreatest" => game
            .alive_players()
            .into_iter()
            .filter(|&pid| pid != controller)
            .map(|pid| game.player(pid).life)
            .max()
            .unwrap_or(1),
        "ActivePlayer" => game.player(game.active_player()).life,
        _ => 1,
    }
}

fn collect_present_cards(
    game: &GameState,
    source: &Card,
    defined: Option<&str>,
    present_player: &str,
    present_zone: ZoneType,
) -> Vec<CardId> {
    if let Some(defined) = defined {
        return crate::ability::ability_utils::get_defined_cards(
            game,
            Some(source.id),
            defined,
            Some(requirement_controller(game, source)),
        );
    }

    let controller = requirement_controller(game, source);
    let mut cards = Vec::new();

    if present_player.eq_ignore_ascii_case("You") || present_player.eq_ignore_ascii_case("Any") {
        cards.extend(game.cards_in_zone(present_zone, controller).iter().copied());
    }
    if present_player.eq_ignore_ascii_case("Opponent") || present_player.eq_ignore_ascii_case("Any")
    {
        for pid in game.alive_players() {
            if pid != controller {
                cards.extend(game.cards_in_zone(present_zone, pid).iter().copied());
            }
        }
    }

    cards
}

fn paying_color_count(paying_mana_to_cast: &[u16], color_mask: u16) -> usize {
    paying_mana_to_cast
        .iter()
        .filter(|&&atom| atom == color_mask)
        .count()
}

fn has_all_spent_colors(colors_spent_to_cast: u16, colors: u16) -> bool {
    colors != 0 && (colors_spent_to_cast & colors) == colors
}

/// Check if a card matches a filter expression like "Creature.YouCtrl".
/// Returns true if `valid` is empty or the card satisfies all parts.
///
/// # Examples
///
/// ```ignore
/// // Matches any creature you control:
/// matches_valid_card("Creature.YouCtrl", creature, source)
///
/// // Matches either creatures or artifacts:
/// matches_valid_card("Creature,Artifact", card, source)
///
/// // Matches creatures you control that are tokens:
/// matches_valid_card("Creature.YouCtrl.token", card, source)
/// ```
pub fn matches_valid_card(valid: &str, card: &Card, source: &Card) -> bool {
    matches_valid_card_selector(&cached_compiled_selector(valid), card, source)
}

#[cfg(debug_assertions)]
fn legacy_matches_valid_card(valid: &str, card: &Card, context: MatchContext<'_>) -> bool {
    let valid = valid.trim();
    if valid.is_empty() {
        return true;
    }

    // Comma-separated = OR conditions.
    // Each comma-delimited part is a separate filter; the card matches if ANY part matches.
    // Parts may contain dots (e.g. "Card.Self,Elemental.Other+YouCtrl").
    if valid.contains(',') {
        return valid
            .split(',')
            .any(|part| matches_single_valid_card(part.trim(), card, context));
    }

    matches_single_valid_card(valid, card, context)
}

/// Convenience wrapper: None means "no filter" → always matches.
pub fn matches_valid_card_opt(valid: Option<&str>, card: &Card, source: &Card) -> bool {
    match valid {
        None => true,
        Some(v) => matches_valid_card(v, card, source),
    }
}

/// Match a precompiled selector against a card without reparsing the
/// comma/dot/plus selector structure.
pub fn matches_valid_card_selector(
    selector: &CompiledSelector,
    card: &Card,
    source: &Card,
) -> bool {
    matches_valid_card_selector_with_context(selector, card, MatchContext::from_source(source))
}

pub fn matches_valid_card_selector_in_game(
    selector: &CompiledSelector,
    card: &Card,
    source: &Card,
    game: &GameState,
) -> bool {
    matches_valid_card_selector_with_context(
        selector,
        card,
        MatchContext::from_source(source).with_game(game),
    )
}

#[derive(Debug, Clone, Copy)]
pub struct MatchContext<'a> {
    pub source_card: &'a Card,
    pub source_controller: PlayerId,
    pub targeted_cards: &'a [CardId],
    pub targeted_players: &'a [PlayerId],
    pub remembered_cards: &'a [CardId],
    pub remembered_players: &'a [PlayerId],
    pub trigger_remembered_cards: &'a [CardId],
    pub triggering_card: Option<CardId>,
    pub triggering_player: Option<PlayerId>,
    pub combat: Option<&'a CombatState>,
    pub game: Option<&'a GameState>,
    pub spell_ability: Option<&'a SpellAbility>,
}

impl<'a> MatchContext<'a> {
    pub fn from_source(source_card: &'a Card) -> Self {
        Self {
            source_card,
            source_controller: source_card.controller,
            targeted_cards: &[],
            targeted_players: &[],
            remembered_cards: &source_card.remembered_cards,
            remembered_players: &source_card.remembered_players,
            trigger_remembered_cards: &[],
            triggering_card: None,
            triggering_player: None,
            combat: None,
            game: None,
            spell_ability: None,
        }
    }

    pub fn with_game(mut self, game: &'a GameState) -> Self {
        self.game = Some(game);
        self
    }

    pub fn with_spell_ability(mut self, spell_ability: &'a SpellAbility) -> Self {
        self.spell_ability = Some(spell_ability);
        self
    }

    /// Override `source_controller` with an iterated player. Mirrors Java's
    /// `CardLists.getValidCardCount(..., player, source, ctb)` signature
    /// (`AbilityUtils.java:3380, 3389`), where `YouCtrl` resolves against the
    /// iterated player rather than the source's controller — needed by
    /// `PlayerCountOpponents$HighestValid X.YouCtrl` style SVars.
    pub fn with_source_controller(mut self, player: PlayerId) -> Self {
        self.source_controller = player;
        self
    }

    pub fn with_combat(mut self, combat: &'a CombatState) -> Self {
        self.combat = Some(combat);
        self
    }

    pub fn with_targets(
        mut self,
        targeted_cards: &'a [CardId],
        targeted_players: &'a [PlayerId],
    ) -> Self {
        self.targeted_cards = targeted_cards;
        self.targeted_players = targeted_players;
        self
    }

    pub fn with_triggering(
        mut self,
        triggering_card: Option<CardId>,
        triggering_player: Option<PlayerId>,
    ) -> Self {
        self.triggering_card = triggering_card;
        self.triggering_player = triggering_player;
        self
    }

    pub fn with_trigger_remembered_cards(mut self, cards: &'a [CardId]) -> Self {
        self.trigger_remembered_cards = cards;
        self
    }
}

/// Match a precompiled selector with explicit contextual state for predicates
/// like `Attacking`, `TopLibrary`, and `ExiledWithSource`.
pub fn matches_valid_card_selector_with_context(
    selector: &CompiledSelector,
    card: &Card,
    context: MatchContext<'_>,
) -> bool {
    crate::perf::increment(crate::perf::Metric::SelectorMatches, 1);
    let result = matches_card_selector_ir(&selector.ir, card, context);
    #[cfg(debug_assertions)]
    debug_assert_eq!(
        result,
        legacy_matches_valid_card(&selector.as_raw(), card, context),
        "compiled card selector diverged from string matcher for {:?}",
        selector.as_raw()
    );
    result
}

fn matches_card_selector_ir(selector: &Selector, card: &Card, context: MatchContext<'_>) -> bool {
    match selector.alternatives.as_slice() {
        [] => true,
        [alternative] => matches_card_selector_alt(alternative, card, context),
        alternatives => {
            for alternative in alternatives {
                if matches_card_selector_alt(alternative, card, context) {
                    return true;
                }
            }
            false
        }
    }
}

#[inline]
fn matches_card_selector_alt(
    alternative: &crate::parsing::SelectorAlt,
    card: &Card,
    context: MatchContext<'_>,
) -> bool {
    match alternative.predicates.as_slice() {
        [] => true,
        [predicate] => matches_card_predicate(predicate, card, context),
        [first, second] => {
            matches_card_predicate(first, card, context)
                && matches_card_predicate(second, card, context)
        }
        predicates => {
            for predicate in predicates {
                if !matches_card_predicate(predicate, card, context) {
                    return false;
                }
            }
            true
        }
    }
}

#[inline(always)]
fn matches_card_predicate(
    predicate: &SelectorPredicate,
    card: &Card,
    context: MatchContext<'_>,
) -> bool {
    match predicate {
        SelectorPredicate::Any => true,
        SelectorPredicate::CardType(card_type) => matches_card_type_predicate(card_type, card),
        SelectorPredicate::CardController(controller) => {
            matches_card_controller(*controller, card.controller, context.source_controller)
        }
        SelectorPredicate::Tapped(tapped) => card.tapped == *tapped,
        SelectorPredicate::Zone(zone) => card.zone == *zone,
        SelectorPredicate::Token(token) => card.is_token == *token,
        SelectorPredicate::Color(color) => matches_card_color(*color, card),
        SelectorPredicate::Colorless => card.color.is_colorless(),
        SelectorPredicate::CardOwner(controller) => {
            matches_card_controller(*controller, card.owner, context.source_controller)
        }
        SelectorPredicate::StartedTurnTapped(tapped) => card.started_turn_tapped == *tapped,
        SelectorPredicate::CameUnderControlSinceLastUpkeep => {
            card.came_under_control_since_last_upkeep()
        }
        SelectorPredicate::Multicolor => card.color.is_multicolor(),
        SelectorPredicate::Commander => card.is_commander,
        SelectorPredicate::Legendary => card.type_line.is_legendary(),
        SelectorPredicate::Kicked => card.kicked,
        SelectorPredicate::CardSupertype(supertype) => {
            matches_card_supertype_predicate(*supertype, card)
        }
        SelectorPredicate::CardIdentity(identity) => {
            matches_card_identity(*identity, card, context)
        }
        SelectorPredicate::Player | SelectorPredicate::PlayerController(_) => false,
        SelectorPredicate::RememberedCard => context.remembered_cards.contains(&card.id),
        SelectorPredicate::TriggerRememberedCard => {
            context.trigger_remembered_cards.contains(&card.id)
        }
        SelectorPredicate::EffectSource => context.source_card.effect_source == Some(card.id),
        SelectorPredicate::SourceColor(color) => matches_card_color(*color, card),
        SelectorPredicate::SourceColorless => card.color.is_colorless(),
        SelectorPredicate::ChosenColorSource => matches_chosen_color_source(card, context),
        SelectorPredicate::CardState(state) => matches_card_state(*state, card, context),
        SelectorPredicate::Context(predicate) => {
            matches_context_predicate(predicate, card, context)
        }
        SelectorPredicate::Relation(predicate) => {
            matches_relation_predicate(predicate, card, context)
        }
        SelectorPredicate::DamagedBy => card
            .damage_sources_this_turn
            .contains(&context.source_card.id),
        SelectorPredicate::AttachedBy => context.source_card.attached_to == Some(card.id),
        SelectorPredicate::WasCast { by_you } => {
            card.was_cast() && (!by_you || card.controller == context.source_controller)
        }
        SelectorPredicate::ChosenType => context
            .source_card
            .chosen_type
            .as_ref()
            .is_some_and(|ct| card.type_line.has_subtype(ct) || card.has_keyword("Changeling")),
        SelectorPredicate::Keyword { name, present } => card.has_keyword(name) == *present,
        SelectorPredicate::NumericComparison {
            property,
            operator,
            value,
        } => matches_numeric_comparison(*property, *operator, value, card, context),
        SelectorPredicate::NumericParity { property, even } => {
            resolve_numeric_property(*property, card, context)
                .is_some_and(|actual| (actual % 2 == 0) == *even)
        }
        SelectorPredicate::CounterComparison {
            operator,
            value,
            counter_type,
        } => matches_counter_comparison(*operator, value, counter_type, card, context),
        SelectorPredicate::Not(predicate) => !matches_card_predicate(predicate, card, context),
        SelectorPredicate::Raw(raw) => matches_raw_card_predicate(raw, card, context),
    }
}

#[inline]
fn matches_chosen_color_source(card: &Card, context: MatchContext<'_>) -> bool {
    context
        .source_card
        .chosen_colors
        .iter()
        .filter_map(|color| color_from_name_no_alloc(color))
        .any(|color| card.color.has_color(color))
}

#[inline]
fn color_from_name_no_alloc(value: &str) -> Option<Color> {
    match value.as_bytes() {
        [b'W'] | [b'w'] => Some(Color::White),
        [b'U'] | [b'u'] => Some(Color::Blue),
        [b'B'] | [b'b'] => Some(Color::Black),
        [b'R'] | [b'r'] => Some(Color::Red),
        [b'G'] | [b'g'] => Some(Color::Green),
        _ if value.eq_ignore_ascii_case("white") => Some(Color::White),
        _ if value.eq_ignore_ascii_case("blue") => Some(Color::Blue),
        _ if value.eq_ignore_ascii_case("black") => Some(Color::Black),
        _ if value.eq_ignore_ascii_case("red") => Some(Color::Red),
        _ if value.eq_ignore_ascii_case("green") => Some(Color::Green),
        _ => None,
    }
}

#[inline(always)]
fn matches_card_type_predicate(card_type: &CardSelectorType, card: &Card) -> bool {
    match card_type {
        CardSelectorType::Card => true,
        CardSelectorType::Creature => card.is_creature(),
        CardSelectorType::Land => card.is_land(),
        CardSelectorType::Instant => card.type_line.is_instant(),
        CardSelectorType::Sorcery => card.type_line.is_sorcery(),
        CardSelectorType::Artifact => card.type_line.is_artifact(),
        CardSelectorType::Enchantment => card.type_line.is_enchantment(),
        CardSelectorType::Planeswalker => card.type_line.is_planeswalker(),
        CardSelectorType::Permanent => card.is_permanent(),
        CardSelectorType::Spell => true,
        CardSelectorType::NonLand => !card.is_land(),
        CardSelectorType::NonCreature => !card.is_creature(),
        CardSelectorType::Named(name) => card.card_name.eq_ignore_ascii_case(name),
        CardSelectorType::Subtype(subtype) => card.has_subtype(subtype),
    }
}

#[inline(always)]
fn matches_card_supertype_predicate(supertype: CardSupertypeSelector, card: &Card) -> bool {
    match supertype {
        CardSupertypeSelector::Basic => card.type_line.is_basic(),
        CardSupertypeSelector::Snow => card.type_line.is_snow(),
    }
}

#[inline(always)]
fn matches_card_controller(
    controller: ControllerSelector,
    card_controller: PlayerId,
    source_controller: PlayerId,
) -> bool {
    match controller {
        ControllerSelector::You => card_controller == source_controller,
        ControllerSelector::Opponent => card_controller != source_controller,
    }
}

#[inline(always)]
fn matches_card_identity(
    identity: CardIdentitySelector,
    card: &Card,
    context: MatchContext<'_>,
) -> bool {
    match identity {
        CardIdentitySelector::Self_ => card.id == context.source_card.id,
        CardIdentitySelector::Other => card.id != context.source_card.id,
    }
}

fn matches_card_state(state: CardStateSelector, card: &Card, context: MatchContext<'_>) -> bool {
    match state {
        CardStateSelector::FaceDown => card.face_down,
        CardStateSelector::Paired => card.paired_with.is_some(),
        CardStateSelector::PairedWithSource => card.paired_with == Some(context.source_card.id),
        CardStateSelector::Attached => {
            card.attached_to.is_some() || card.attached_to_player.is_some()
        }
        CardStateSelector::Equipped => card.attached_to.is_some() && card.type_line.is_artifact(),
        CardStateSelector::Enchanted => {
            card.attached_to.is_some() && card.type_line.is_enchantment()
        }
        CardStateSelector::HasCounters => card.counters.values().any(|count| *count > 0),
        CardStateSelector::IsImprinted => context.source_card.imprinted_cards.contains(&card.id),
        CardStateSelector::Chosen => {
            context.source_card.chosen_cards.contains(&card.id)
                || context
                    .source_card
                    .named_cards
                    .iter()
                    .any(|name| card.card_name.eq_ignore_ascii_case(name))
        }
        CardStateSelector::ChosenCard => context.source_card.chosen_cards.contains(&card.id),
        CardStateSelector::NamedCard => context
            .source_card
            .named_cards
            .iter()
            .any(|name| card.card_name.eq_ignore_ascii_case(name)),
        CardStateSelector::ChosenColor => context
            .source_card
            .chosen_colors
            .iter()
            .filter_map(|color| color_from_name_no_alloc(color))
            .any(|color| card.color.has_color(color)),
        CardStateSelector::EnteredThisTurn => card.entered_this_turn(),
        CardStateSelector::WasDealtDamageThisTurn => !card.damage_sources_this_turn.is_empty(),
        CardStateSelector::Historic => {
            card.type_line.is_artifact()
                || card.type_line.is_legendary()
                || card.has_subtype("Saga")
        }
        CardStateSelector::Modified => {
            card.counters.values().any(|count| *count > 0)
                || card.attached_to.is_some()
                || card.power_modifier != 0
                || card.toughness_modifier != 0
                || card.static_power_modifier != 0
                || card.static_toughness_modifier != 0
        }
        CardStateSelector::Saddled => card.get_s_var("SaddledBy").is_some(),
        CardStateSelector::MayPlaySource => card.may_play(context.source_controller),
        CardStateSelector::Suspended => card.has_keyword("Suspend") && card.zone == ZoneType::Exile,
        CardStateSelector::SingleTarget => false,
        CardStateSelector::PromisedGift => card.promised_gift.is_some(),
        CardStateSelector::RingBearer => context
            .game
            .is_some_and(|game| game.player(card.controller).ring_bearer == Some(card.id)),
    }
}

fn matches_context_predicate(
    predicate: &ContextPredicate,
    card: &Card,
    context: MatchContext<'_>,
) -> bool {
    match predicate {
        ContextPredicate::Attacking(target) => {
            matches_attacking_predicate(target.as_ref(), card, context)
        }
        ContextPredicate::Blocking(target) => {
            matches_blocking_predicate(target.as_ref(), card, context)
        }
        ContextPredicate::BlockedByValidThisTurn(target) => {
            matches_blocked_by_valid_this_turn_target(target, card, context)
        }
        ContextPredicate::BlockedByValidThisTurnType(card_type) => {
            matches_blocked_by_valid_this_turn_type(card_type, card, context)
        }
        ContextPredicate::BlockedValidThisTurn(card_type)
        | ContextPredicate::BlockingValid(card_type) => {
            matches_blocked_valid_this_turn_type(card_type, card, context)
        }
        ContextPredicate::Blocked => context.combat.map_or(
            card.damage_history.creature_got_blocked_this_combat,
            |combat| combat.was_blocked_this_combat(card.id),
        ),
        ContextPredicate::AttackedThisTurn => !card.damage_history.attacked_this_turn.is_empty(),
        ContextPredicate::BlockingSource => context.combat.is_some_and(|combat| {
            combat
                .get_attackers_for(card.id)
                .contains(&context.source_card.id)
        }),
        ContextPredicate::BlockedBySource => context.combat.is_some_and(|combat| {
            combat
                .get_blockers_for(card.id)
                .contains(&context.source_card.id)
        }),
        ContextPredicate::WasCastFrom(_) => false,
        ContextPredicate::EnteredThisTurnFrom(zone) => {
            matches_entered_this_turn_from(*zone, card, context)
        }
        ContextPredicate::EnteredUnder(target) => {
            card.entered_this_turn()
                && relation_target_player_any(target, context, |player| card.controller == player)
        }
        ContextPredicate::TopLibrary => false,
        ContextPredicate::ExiledWithSource => {
            context.source_card.imprinted_cards.contains(&card.id)
        }
        ContextPredicate::RememberedPlayerCtrl => {
            context.remembered_players.contains(&card.controller)
        }
        ContextPredicate::TargetedPlayerCtrl => context.targeted_players.contains(&card.controller),
        ContextPredicate::ControlledBy(reference) => {
            matches_controlled_by_reference(reference, card, context)
        }
        ContextPredicate::ActivePlayerCtrl
        | ContextPredicate::DefenderCtrl
        | ContextPredicate::EnchantedController
        | ContextPredicate::NotDefinedTargeted => false,
    }
}

fn matches_controlled_by_reference(
    reference: &str,
    card: &Card,
    context: MatchContext<'_>,
) -> bool {
    if reference.eq_ignore_ascii_case("You") || reference.eq_ignore_ascii_case("YouCtrl") {
        card.controller == context.source_controller
    } else if reference.eq_ignore_ascii_case("Opponent")
        || reference.eq_ignore_ascii_case("OppCtrl")
        || reference.eq_ignore_ascii_case("OpponentCtrl")
    {
        card.controller != context.source_controller
    } else if reference.eq_ignore_ascii_case("Remembered")
        || reference.eq_ignore_ascii_case("RememberedPlayer")
        || reference.eq_ignore_ascii_case("RememberedController")
    {
        context.remembered_players.contains(&card.controller)
    } else if reference.eq_ignore_ascii_case("Targeted")
        || reference.eq_ignore_ascii_case("TargetedPlayer")
        || reference.eq_ignore_ascii_case("TargetedController")
    {
        context.targeted_players.contains(&card.controller)
    } else if let Some(target) = raw_target_ref(reference) {
        relation_target_player_any(&target, context, |player| card.controller == player)
    } else {
        false
    }
}

fn matches_relation_predicate(
    predicate: &RelationPredicate,
    card: &Card,
    context: MatchContext<'_>,
) -> bool {
    match predicate {
        RelationPredicate::SharesNameWith(target) => {
            relation_target_card_any(target, card, context, |target| {
                card.card_name.eq_ignore_ascii_case(&target.card_name)
            })
        }
        RelationPredicate::DoesNotShareNameWith(target) => {
            !relation_target_card_any(target, card, context, |target| {
                card.card_name.eq_ignore_ascii_case(&target.card_name)
            })
        }

        RelationPredicate::SharesCardTypeWith(target) => {
            relation_target_card_any(target, card, context, |target| {
                card.shares_card_type_with(target)
            })
        }
        RelationPredicate::SharesCreatureTypeWith(target) => {
            relation_target_card_any(target, card, context, |target| {
                shares_creature_type(card, target)
            })
        }
        RelationPredicate::SharesColorWith(target) => {
            relation_target_card_any(target, card, context, |target| {
                card.color.shares_color_with(target.color)
            })
        }
        RelationPredicate::SharesManaValueWith(target) => {
            relation_target_card_any(target, card, context, |target| {
                card.mana_cost.cmc() == target.mana_cost.cmc()
            })
        }
        RelationPredicate::AttachedTo(target) => {
            card.attached_to.is_some_and(|attached_to| {
                relation_target_contains_id(target, attached_to, context)
            }) || card.attached_to_player.is_some_and(|attached_to| {
                relation_target_player_any(target, context, |player| player == attached_to)
            })
        }
        RelationPredicate::AttachedToType(card_type) => {
            let Some(game) = context.game else {
                return false;
            };
            let Some(attached_to) = card.attached_to else {
                return false;
            };
            matches_card_type_predicate(card_type, game.card(attached_to))
        }
        RelationPredicate::OwnedBy(target) => {
            relation_target_player_any(target, context, |player| card.owner == player)
        }
        RelationPredicate::OpponentOf(target) => {
            relation_target_player_any(target, context, |player| card.controller != player)
        }
        RelationPredicate::IsTargeting(target) => {
            relation_target_contains_id(target, card.id, context)
                || relation_target_player_any(target, context, |player| {
                    context.targeted_players.contains(&player)
                })
        }
    }
}

fn relation_target_card_any(
    target: &TargetRef,
    subject: &Card,
    context: MatchContext<'_>,
    mut predicate: impl FnMut(&Card) -> bool,
) -> bool {
    match target {
        TargetRef::Source => predicate(context.source_card),
        TargetRef::Remembered | TargetRef::RememberedLki => context.game.is_some_and(|game| {
            context
                .remembered_cards
                .iter()
                .any(|id| predicate(game.card(*id)))
        }),
        TargetRef::Imprinted => context.game.is_some_and(|game| {
            context
                .source_card
                .imprinted_cards
                .iter()
                .any(|id| predicate(game.card(*id)))
        }),
        TargetRef::ChosenCard => context.game.is_some_and(|game| {
            context
                .source_card
                .chosen_cards
                .iter()
                .any(|id| predicate(game.card(*id)))
        }),
        TargetRef::Targeted => {
            let Some(game) = context.game else {
                return false;
            };
            context
                .targeted_cards
                .iter()
                .any(|id| predicate(game.card(*id)))
        }
        TargetRef::Battlefield => context.game.is_some_and(|game| {
            game.cards_in_all_zones(ZoneType::Battlefield)
                .any(|id| predicate(game.card(id)))
        }),
        TargetRef::OtherYourBattlefield => context.game.is_some_and(|game| {
            game.cards_in_zone(ZoneType::Battlefield, context.source_controller)
                .iter()
                .copied()
                .filter(|id| *id != subject.id)
                .any(|id| predicate(game.card(id)))
        }),
        TargetRef::YourGraveyard => context.game.is_some_and(|game| {
            game.cards_in_zone(ZoneType::Graveyard, context.source_controller)
                .iter()
                .any(|id| predicate(game.card(*id)))
        }),
        TargetRef::Player
        | TargetRef::Opponent
        | TargetRef::ChosenPlayer
        | TargetRef::TriggeredPlayer
        | TargetRef::TriggeredCardController
        | TargetRef::TriggeredDefendingPlayer
        | TargetRef::TriggeredAttackedTarget => false,
        TargetRef::TriggeredTarget | TargetRef::TriggeredCard => {
            let (Some(game), Some(card_id)) = (context.game, context.triggering_card) else {
                return false;
            };
            predicate(game.card(card_id))
        }
        TargetRef::Commander => context.game.is_some_and(|game| {
            game.player_registered_commanders(context.source_controller)
                .iter()
                .any(|id| predicate(game.card(*id)))
        }),
    }
}

fn relation_target_player_any(
    target: &TargetRef,
    context: MatchContext<'_>,
    mut predicate: impl FnMut(PlayerId) -> bool,
) -> bool {
    match target {
        TargetRef::Source => predicate(context.source_controller),
        TargetRef::Remembered | TargetRef::RememberedLki => {
            context.remembered_players.iter().copied().any(predicate)
        }
        TargetRef::Imprinted | TargetRef::ChosenCard => false,
        TargetRef::ChosenPlayer => context.source_card.chosen_player.is_some_and(predicate),
        TargetRef::Targeted => context.targeted_players.iter().copied().any(predicate),
        TargetRef::Player => {
            context.targeted_players.iter().copied().any(&mut predicate)
                || context.remembered_players.iter().copied().any(predicate)
        }
        TargetRef::Opponent => context
            .game
            .is_some_and(|game| predicate(game.opponent_of(context.source_controller))),
        TargetRef::Battlefield | TargetRef::OtherYourBattlefield | TargetRef::YourGraveyard => {
            false
        }
        TargetRef::TriggeredTarget => {
            context.triggering_player.is_some_and(&mut predicate)
                || context
                    .triggering_card
                    .and_then(|card_id| context.game.map(|game| game.card(card_id).controller))
                    .is_some_and(predicate)
        }
        TargetRef::TriggeredCard => context
            .triggering_card
            .and_then(|card_id| context.game.map(|game| game.card(card_id).controller))
            .is_some_and(predicate),
        TargetRef::TriggeredPlayer => context.triggering_player.is_some_and(predicate),
        TargetRef::TriggeredCardController => context
            .triggering_card
            .and_then(|card_id| context.game.map(|game| game.card(card_id).controller))
            .is_some_and(predicate),
        TargetRef::TriggeredDefendingPlayer | TargetRef::TriggeredAttackedTarget => {
            triggered_defending_player(context).is_some_and(predicate)
        }
        TargetRef::Commander => predicate(context.source_controller),
    }
}

fn relation_target_contains_id(
    target: &TargetRef,
    card_id: CardId,
    context: MatchContext<'_>,
) -> bool {
    match target {
        TargetRef::Source => context.source_card.id == card_id,
        TargetRef::Remembered | TargetRef::RememberedLki => {
            context.remembered_cards.contains(&card_id)
        }
        TargetRef::Imprinted => context.source_card.imprinted_cards.contains(&card_id),
        TargetRef::ChosenCard => context.source_card.chosen_cards.contains(&card_id),
        TargetRef::Targeted => context.targeted_cards.contains(&card_id),
        TargetRef::OtherYourBattlefield => context.game.is_some_and(|game| {
            card_id != context.source_card.id
                && game.card(card_id).zone == ZoneType::Battlefield
                && game.card(card_id).controller == context.source_controller
        }),
        TargetRef::Player
        | TargetRef::Opponent
        | TargetRef::Battlefield
        | TargetRef::YourGraveyard
        | TargetRef::ChosenPlayer
        | TargetRef::TriggeredPlayer
        | TargetRef::TriggeredCardController
        | TargetRef::TriggeredDefendingPlayer
        | TargetRef::TriggeredAttackedTarget => false,
        TargetRef::TriggeredTarget | TargetRef::TriggeredCard => {
            context.triggering_card == Some(card_id)
        }
        TargetRef::Commander => context.game.is_some_and(|game| {
            game.player_registered_commanders(context.source_controller)
                .contains(&card_id)
        }),
    }
}

fn matches_attacking_predicate(
    target: Option<&TargetRef>,
    card: &Card,
    context: MatchContext<'_>,
) -> bool {
    let Some(target) = target else {
        return context
            .combat
            .map_or(card.attacking_player.is_some(), |combat| {
                combat.is_attacking(card.id)
            });
    };
    if let Some(combat) = context.combat {
        return combat
            .attackers
            .iter()
            .find(|(attacker, _)| *attacker == card.id)
            .is_some_and(|(_, defender)| matches_defender_target(*defender, target, context));
    }
    card.attacking_player
        .is_some_and(|player| matches_player_target(player, target, context))
}

fn matches_blocking_predicate(
    target: Option<&TargetRef>,
    card: &Card,
    context: MatchContext<'_>,
) -> bool {
    let Some(target) = target else {
        return context
            .combat
            .map_or(card.damage_history.creature_blocked_this_combat, |combat| {
                combat.was_blocking(card.id)
            });
    };
    let Some(combat) = context.combat else {
        return false;
    };
    combat
        .blockers
        .iter()
        .filter(|(blocker, _)| *blocker == card.id)
        .any(|(_, attacker)| relation_target_contains_id(target, *attacker, context))
}

fn matches_blocked_by_valid_this_turn_target(
    target: &TargetRef,
    card: &Card,
    context: MatchContext<'_>,
) -> bool {
    let Some(combat) = context.combat else {
        return false;
    };
    combat
        .blockers
        .iter()
        .filter(|(_, attacker)| *attacker == card.id)
        .any(|(blocker, _)| relation_target_contains_id(target, *blocker, context))
}

fn matches_blocked_by_valid_this_turn_type(
    card_type: &CardSelectorType,
    card: &Card,
    context: MatchContext<'_>,
) -> bool {
    let (Some(combat), Some(game)) = (context.combat, context.game) else {
        return false;
    };
    combat
        .blockers
        .iter()
        .filter(|(_, attacker)| *attacker == card.id)
        .any(|(blocker, _)| matches_card_type_predicate(card_type, game.card(*blocker)))
}

fn matches_blocked_valid_this_turn_type(
    card_type: &CardSelectorType,
    card: &Card,
    context: MatchContext<'_>,
) -> bool {
    let (Some(combat), Some(game)) = (context.combat, context.game) else {
        return false;
    };
    combat
        .blockers
        .iter()
        .filter(|(blocker, _)| *blocker == card.id)
        .any(|(_, attacker)| matches_card_type_predicate(card_type, game.card(*attacker)))
}

fn matches_defender_target(
    defender: DefenderId,
    target: &TargetRef,
    context: MatchContext<'_>,
) -> bool {
    match defender {
        DefenderId::Player(player) => matches_player_target(player, target, context),
        DefenderId::Permanent(card_id) => relation_target_contains_id(target, card_id, context),
    }
}

fn matches_player_target(player: PlayerId, target: &TargetRef, context: MatchContext<'_>) -> bool {
    match target {
        TargetRef::Player => true,
        TargetRef::Opponent => player != context.source_controller,
        _ => relation_target_player_any(target, context, |target_player| player == target_player),
    }
}

fn triggered_defending_player(context: MatchContext<'_>) -> Option<PlayerId> {
    context
        .triggering_player
        .or_else(|| context.combat.and_then(|combat| combat.defending_player))
}

fn shares_creature_type(card: &Card, target: &Card) -> bool {
    card.is_creature()
        && target.is_creature()
        && card
            .type_line
            .subtypes
            .iter()
            .any(|subtype| target.type_line.has_subtype(subtype))
}

fn matches_entered_this_turn_from(zone: ZoneType, card: &Card, _context: MatchContext<'_>) -> bool {
    match zone {
        ZoneType::Battlefield => card.entered_this_turn(),
        _ => false,
    }
}

fn matches_card_color(color: CardColorSelector, card: &Card) -> bool {
    match color {
        CardColorSelector::White => card.color.has_white(),
        CardColorSelector::Blue => card.color.has_blue(),
        CardColorSelector::Black => card.color.has_black(),
        CardColorSelector::Red => card.color.has_red(),
        CardColorSelector::Green => card.color.has_green(),
    }
}

fn matches_numeric_comparison(
    property: NumericSelectorProperty,
    operator: SelectorCompareOperator,
    threshold: &SelectorNumericOperand,
    card: &Card,
    context: MatchContext<'_>,
) -> bool {
    let Some(threshold) = resolve_selector_operand(threshold, context) else {
        return true;
    };
    let Some(value) = resolve_numeric_property(property, card, context) else {
        return true;
    };
    compare_selector_value(value, operator, threshold)
}

fn resolve_numeric_property(
    property: NumericSelectorProperty,
    card: &Card,
    context: MatchContext<'_>,
) -> Option<i32> {
    match property {
        NumericSelectorProperty::ManaValue => Some(effective_mana_value(card, context)),
        NumericSelectorProperty::Power => Some(card.power()),
        NumericSelectorProperty::Toughness => Some(card.toughness()),
        NumericSelectorProperty::TargetCount => {
            Some((context.targeted_cards.len() + context.targeted_players.len()) as i32)
        }
        NumericSelectorProperty::ManaSpent => {
            Some(context.source_card.paying_mana_to_cast.len() as i32)
        }
    }
}

fn effective_mana_value(card: &Card, context: MatchContext<'_>) -> i32 {
    let mut mana_value = card.mana_cost.cmc();
    if let Some(sa) = context.spell_ability {
        if sa.source == Some(card.id) {
            mana_value += sa.x_mana_cost_paid as i32 * card.mana_cost.count_x() as i32;
        }
    }
    mana_value
}

fn matches_counter_comparison(
    operator: SelectorCompareOperator,
    threshold: &SelectorNumericOperand,
    counter_type: &str,
    card: &Card,
    context: MatchContext<'_>,
) -> bool {
    let Some(threshold) = resolve_selector_operand(threshold, context) else {
        return true;
    };
    use crate::ability::effects::parse_counter_type;
    let counter_type = parse_counter_type(counter_type);
    let count = card.counter_count(&counter_type);
    compare_selector_value(count, operator, threshold)
}

fn resolve_selector_operand(
    operand: &SelectorNumericOperand,
    context: MatchContext<'_>,
) -> Option<i32> {
    match operand {
        SelectorNumericOperand::Literal(value) => Some(*value),
        SelectorNumericOperand::Symbol(symbol) => {
            if symbol.eq_ignore_ascii_case("X") {
                if let Some(sa) = context.spell_ability {
                    return Some(sa.x_mana_cost_paid as i32);
                }
            }
            let value = context.source_card.get_s_var(symbol)?;
            if let Ok(parsed) = value.trim().parse::<i32>() {
                return Some(parsed);
            }
            if value == "TriggeredCard$CardManaCost" {
                let game = context.game?;
                let card = context.triggering_card?;
                return Some(game.card(card).mana_cost.cmc());
            }
            if value == "TriggeredCard$CardPower" {
                let game = context.game?;
                let card = context.triggering_card?;
                return Some(crate::lki::resolve_lki_power(game, card));
            }
            if value == "TriggeredCard$CardToughness" {
                let game = context.game?;
                let card = context.triggering_card?;
                return Some(crate::lki::resolve_lki_toughness(game, card));
            }
            if value.starts_with("Count$") || value.starts_with("PlayerCount") {
                let game = context.game?;
                let sa = crate::spellability::SpellAbility::new_empty(
                    Some(context.source_card.id),
                    context.source_controller,
                );
                return Some(crate::svar::resolve_svar_expression(
                    value,
                    game,
                    context.source_card.id,
                    context.source_controller,
                    &sa,
                ));
            }
            None
        }
    }
}

fn compare_selector_value(actual: i32, operator: SelectorCompareOperator, expected: i32) -> bool {
    match operator {
        SelectorCompareOperator::Eq => actual == expected,
        SelectorCompareOperator::Ne => actual != expected,
        SelectorCompareOperator::Lt => actual < expected,
        SelectorCompareOperator::Le => actual <= expected,
        SelectorCompareOperator::Gt => actual > expected,
        SelectorCompareOperator::Ge => actual >= expected,
    }
}

fn matches_raw_card_predicate(raw: &str, card: &Card, context: MatchContext<'_>) -> bool {
    crate::perf::increment(crate::perf::Metric::SelectorRawPredicates, 1);
    if let Some(result) = matches_domain_predicate(raw, card, context) {
        return result;
    }
    legacy_matches_card_atom(raw, card, context)
}

fn legacy_matches_card_atom(raw: &str, card: &Card, context: MatchContext<'_>) -> bool {
    let source = context.source_card;
    let raw = raw.trim();
    if raw.is_empty() {
        return true;
    }
    if let Some(result) = matches_domain_predicate(raw, card, context) {
        return result;
    }
    let (negated, value) = if let Some(stripped) = raw.strip_prefix('!') {
        (true, stripped)
    } else {
        (false, raw)
    };
    let value_lower = value.to_ascii_lowercase();
    if negated {
        let positive_match = match value_lower.as_str() {
            "token" => card.is_token,
            "creature" => card.is_creature(),
            "land" => card.is_land(),
            "artifact" => card.type_line.is_artifact(),
            "enchantment" => card.type_line.is_enchantment(),
            "legendary" => card.type_line.is_legendary(),
            "basic" => card.type_line.is_basic(),
            "snow" => card.type_line.is_snow(),
            _ => card.has_subtype(value),
        };
        return !positive_match;
    }

    match value_lower.as_str() {
        "self" | "strictlyself" | "card.self" => card.id == source.id,
        "other" | "strictlyother" => card.id != source.id,
        "youctrl" | "youcontrol" | "you" => card.controller == source.controller,
        "youown" => card.owner == source.controller,
        "youdontctrl" => card.controller != source.controller,
        "youdontown" => card.owner != source.controller,
        "isremembered" | "card.isremembered" => source.remembered_cards.contains(&card.id),
        "istriggerremembered" | "card.istriggerremembered" => {
            context.trigger_remembered_cards.contains(&card.id)
        }
        "effectsource" | "card.effectsource" => source.effect_source == Some(card.id),
        "oppctrl" | "opponentctrl" | "opponent" => card.controller != source.controller,
        "chosenctrl" => Some(card.controller) == source.chosen_player,
        "oppown" | "opponentown" => card.owner != source.controller,
        "targetedplayerown" | "targetedown" | "targetedowner" => {
            context.targeted_players.contains(&card.owner)
        }
        "iscommander" => card.is_commander,
        "legendary" => card.type_line.is_legendary(),
        "basic" => card.type_line.is_basic(),
        "snow" => card.type_line.is_snow(),
        "kicked" => card.kicked,
        "cameundercontrolsincelastupkeep" => card.came_under_control_since_last_upkeep(),
        "noncreature" => !card.is_creature(),
        "nonland" => !card.is_land(),
        "nonlegendary" => !card.type_line.is_legendary(),
        "nonbasic" => !card.type_line.is_basic(),
        "nonsnow" => !card.type_line.is_snow(),
        "token" => card.is_token,
        "nontoken" => !card.is_token,
        "tapped" => card.tapped,
        "untapped" => !card.tapped,
        "startedtheturnuntapped" => !card.started_turn_tapped,
        "startedtheturntapped" => card.started_turn_tapped,
        "multicolor" => card.color.is_multicolor(),
        "colorless" => card.color.is_colorless(),
        "whitesource" => matches_card_color(CardColorSelector::White, card),
        "bluesource" => matches_card_color(CardColorSelector::Blue, card),
        "blacksource" => matches_card_color(CardColorSelector::Black, card),
        "redsource" => matches_card_color(CardColorSelector::Red, card),
        "greensource" => matches_card_color(CardColorSelector::Green, card),
        "colorlesssource" => card.color.is_colorless(),
        "chosencolorsource" => matches_chosen_color_source(card, context),
        "attacking" => matches_context_predicate(&ContextPredicate::Attacking(None), card, context),
        "attackingyou" => matches_context_predicate(
            &ContextPredicate::Attacking(Some(TargetRef::Source)),
            card,
            context,
        ),
        "blocking" => matches_context_predicate(&ContextPredicate::Blocking(None), card, context),
        "blocked" => matches_context_predicate(&ContextPredicate::Blocked, card, context),
        "attackedthisturn" => {
            matches_context_predicate(&ContextPredicate::AttackedThisTurn, card, context)
        }
        "blockingsource" => {
            matches_context_predicate(&ContextPredicate::BlockingSource, card, context)
        }
        "blockedbysource" => {
            matches_context_predicate(&ContextPredicate::BlockedBySource, card, context)
        }
        "samename" => matches_relation_predicate(
            &RelationPredicate::SharesNameWith(TargetRef::Source),
            card,
            context,
        ),
        shares if shares.starts_with("sharesnamewith") => {
            raw_target_ref(&value["sharesNameWith".len()..]).is_some_and(|target| {
                matches_relation_predicate(
                    &RelationPredicate::SharesNameWith(target),
                    card,
                    context,
                )
            })
        }
        shares if shares.starts_with("doesnotsharenamewith") => {
            raw_target_ref(&value["doesNotShareNameWith".len()..]).is_some_and(|target| {
                matches_relation_predicate(
                    &RelationPredicate::DoesNotShareNameWith(target),
                    card,
                    context,
                )
            })
        }
        shares if shares.starts_with("sharescardtypewith") => {
            raw_target_ref(&value["sharesCardTypeWith".len()..]).is_some_and(|target| {
                matches_relation_predicate(
                    &RelationPredicate::SharesCardTypeWith(target),
                    card,
                    context,
                )
            })
        }
        shares if shares.starts_with("sharescolorwith") => {
            raw_target_ref(&value["SharesColorWith".len()..]).is_some_and(|target| {
                matches_relation_predicate(
                    &RelationPredicate::SharesColorWith(target),
                    card,
                    context,
                )
            })
        }
        shares if shares.starts_with("sharescmcwith") => {
            raw_target_ref(&value["SharesCMCWith".len()..]).is_some_and(|target| {
                matches_relation_predicate(
                    &RelationPredicate::SharesManaValueWith(target),
                    card,
                    context,
                )
            })
        }
        shares if shares.starts_with("sharescreaturetypewith") => {
            raw_target_ref(&value["sharesCreatureTypeWith".len()..]).is_some_and(|target| {
                matches_relation_predicate(
                    &RelationPredicate::SharesCreatureTypeWith(target),
                    card,
                    context,
                )
            })
        }
        attacking if attacking.starts_with("attacking ") => {
            raw_target_ref(&value["attacking ".len()..]).is_some_and(|target| {
                matches_context_predicate(&ContextPredicate::Attacking(Some(target)), card, context)
            })
        }
        blocked_by if blocked_by.starts_with("blockedbyvalidthisturn ") => {
            raw_blocked_by_valid_this_turn(&value["blockedByValidThisTurn ".len()..])
                .is_some_and(|predicate| matches_context_predicate(&predicate, card, context))
        }
        blocked if blocked.starts_with("blockedvalidthisturn ") => raw_card_selector_type(
            &value["blockedValidThisTurn ".len()..],
        )
        .is_some_and(|card_type| {
            matches_context_predicate(
                &ContextPredicate::BlockedValidThisTurn(card_type),
                card,
                context,
            )
        }),
        blocking_valid if blocking_valid.starts_with("blockingvalid ") => {
            raw_card_selector_type(&value["blockingValid ".len()..]).is_some_and(|card_type| {
                matches_context_predicate(
                    &ContextPredicate::BlockingValid(card_type),
                    card,
                    context,
                )
            })
        }
        blocking if blocking.starts_with("blocking ") => {
            raw_target_ref(&value["blocking ".len()..]).is_some_and(|target| {
                matches_context_predicate(&ContextPredicate::Blocking(Some(target)), card, context)
            })
        }
        controlled if controlled.starts_with("controlledby ") => {
            matches_controlled_by_reference(value["ControlledBy ".len()..].trim(), card, context)
        }
        attached if attached.starts_with("attachedto ") => {
            let relation = raw_attached_to_relation(value["AttachedTo ".len()..].trim());
            relation.is_some_and(|relation| matches_relation_predicate(&relation, card, context))
        }
        owned if owned.starts_with("ownedby ") => raw_target_ref(&value["OwnedBy ".len()..])
            .is_some_and(|target| {
                matches_relation_predicate(&RelationPredicate::OwnedBy(target), card, context)
            }),
        opponent if opponent.starts_with("opponentof ") => {
            raw_target_ref(&value["OpponentOf ".len()..]).is_some_and(|target| {
                matches_relation_predicate(&RelationPredicate::OpponentOf(target), card, context)
            })
        }
        targeting if targeting.starts_with("istargeting ") => {
            raw_target_ref(&value["IsTargeting ".len()..]).is_some_and(|target| {
                matches_relation_predicate(&RelationPredicate::IsTargeting(target), card, context)
            })
        }
        "inzonebattlefield" => card.zone == forge_foundation::ZoneType::Battlefield,
        "inzonegraveyard" => card.zone == forge_foundation::ZoneType::Graveyard,
        "inzonehand" => card.zone == forge_foundation::ZoneType::Hand,
        "inzoneexile" => card.zone == forge_foundation::ZoneType::Exile,
        "inzonestack" => card.zone == forge_foundation::ZoneType::Stack,
        "damagedby" => card
            .damage_sources_this_turn
            .contains(&context.source_card.id),
        "equippedby" | "enchantedby" | "attachedby" => {
            context.source_card.attached_to == Some(card.id)
        }
        "facedown" => matches_card_state(CardStateSelector::FaceDown, card, context),
        "paired" => matches_card_state(CardStateSelector::Paired, card, context),
        "pairedwith" => matches_card_state(CardStateSelector::PairedWithSource, card, context),
        "attached" => matches_card_state(CardStateSelector::Attached, card, context),
        "equipped" => matches_card_state(CardStateSelector::Equipped, card, context),
        "enchanted" => matches_card_state(CardStateSelector::Enchanted, card, context),
        "hascounters" => matches_card_state(CardStateSelector::HasCounters, card, context),
        "isimprinted" => matches_card_state(CardStateSelector::IsImprinted, card, context),
        "chosen" => matches_card_state(CardStateSelector::Chosen, card, context),
        "chosencard" | "chosencardstrict" => {
            matches_card_state(CardStateSelector::ChosenCard, card, context)
        }
        "namedcard" => matches_card_state(CardStateSelector::NamedCard, card, context),
        "chosencolor" => matches_card_state(CardStateSelector::ChosenColor, card, context),
        "thisturnentered" | "thisturnenteredfrom_battlefield" => {
            matches_card_state(CardStateSelector::EnteredThisTurn, card, context)
        }
        entered if entered.starts_with("enteredunder ") => {
            raw_target_ref(&value["EnteredUnder ".len()..]).is_some_and(|target| {
                matches_context_predicate(&ContextPredicate::EnteredUnder(target), card, context)
            })
        }
        "wasdealtdamagethisturn" => {
            matches_card_state(CardStateSelector::WasDealtDamageThisTurn, card, context)
        }
        dealt if dealt.starts_with("dealtcombatdamagethisturn") => {
            let Some(target_text) = value.split_once(' ').map(|(_, target)| target.trim()) else {
                return card
                    .damage_history
                    .damage_done_this_turn
                    .iter()
                    .any(|damage| damage.is_combat && damage.amount > 0);
            };
            let Some(target) = raw_target_ref(target_text) else {
                return false;
            };
            card.damage_history.damage_done_this_turn.iter().any(|damage| {
                damage.is_combat
                    && damage.amount > 0
                    && matches!(
                        damage.target,
                        Some(crate::card::card_damage_history::TrackedEntity::Player(player))
                            if relation_target_player_any(&target, context, |target_player| target_player == player)
                    )
            })
        }
        "historic" => matches_card_state(CardStateSelector::Historic, card, context),
        "modified" => matches_card_state(CardStateSelector::Modified, card, context),
        "issaddled" => matches_card_state(CardStateSelector::Saddled, card, context),
        "mayplaysource" => matches_card_state(CardStateSelector::MayPlaySource, card, context),
        "exiledwithsource" => {
            matches_context_predicate(&ContextPredicate::ExiledWithSource, card, context)
        }
        "toplibrary" => matches_context_predicate(&ContextPredicate::TopLibrary, card, context),
        "suspended" => matches_card_state(CardStateSelector::Suspended, card, context),
        "singletarget" => matches_card_state(CardStateSelector::SingleTarget, card, context),
        "promisedgift" => matches_card_state(CardStateSelector::PromisedGift, card, context),
        "isringbearer" => matches_card_state(CardStateSelector::RingBearer, card, context),
        "rememberedplayerctrl" => {
            matches_context_predicate(&ContextPredicate::RememberedPlayerCtrl, card, context)
        }
        "wascast" => card.was_cast(),
        "wascastbyyou" => card.was_cast() && card.controller == context.source_controller,
        was_cast_from if was_cast_from.starts_with("wascastfrom") => false,
        named if named.starts_with("named") => {
            card.card_name.eq_ignore_ascii_case(value[5..].trim())
        }
        _ if value.starts_with("counters_") => check_counter_condition(value, card),
        _ => {
            if value_lower.starts_with("cmc") {
                let original_rest = &value[3..];
                check_cmc_condition_with_context(original_rest, card, Some(context))
            } else if let Some(rest) = value_lower.strip_prefix("power") {
                check_power_condition(rest, card)
            } else if let Some(rest) = value_lower.strip_prefix("toughness") {
                check_toughness_condition(rest, card)
            } else if let Some(color) = Color::from_name(&value_lower) {
                card.color.has_color(color)
            } else if let Some(keyword_suffix) = value_lower.strip_prefix("with") {
                if keyword_suffix.strip_prefix("out").is_some() {
                    !card.has_keyword(&value[7..])
                } else if !keyword_suffix.is_empty() {
                    card.has_keyword(&value[4..])
                } else {
                    true
                }
            } else if let Some(negated_value) = value_lower.strip_prefix("non") {
                let positive_match = match negated_value {
                    "creature" => card.is_creature(),
                    "land" => card.is_land(),
                    "artifact" => card.type_line.is_artifact(),
                    "enchantment" => card.type_line.is_enchantment(),
                    "token" => card.is_token,
                    "colorless" => card.color.is_colorless(),
                    _ => {
                        if let Some(color) = Color::from_name(negated_value) {
                            card.color.has_color(color)
                        } else {
                            card.has_subtype(&value[3..])
                        }
                    }
                };
                !positive_match
            } else if value_lower == "chosentype" {
                source.chosen_type.as_ref().is_some_and(|ct| {
                    card.type_line.has_subtype(ct) || card.has_keyword("Changeling")
                })
            } else {
                let color_name = value.strip_suffix("Source").unwrap_or(value);
                if let Some(color) = Color::from_name(&color_name.to_lowercase()) {
                    card.color.has_color(color)
                } else if color_name.eq_ignore_ascii_case("Colorless") {
                    card.color.is_colorless()
                } else {
                    card.has_subtype(value)
                }
            }
        }
    }
}

fn matches_domain_predicate(raw: &str, card: &Card, context: MatchContext<'_>) -> Option<bool> {
    crate::ability::selector_domain::matches_selector_domain_predicate(raw, card, context)
        .or_else(|| {
            crate::cost::selector_domain::matches_selector_domain_predicate(raw, card, context)
        })
        .or_else(|| {
            crate::trigger::selector_domain::matches_selector_domain_predicate(raw, card, context)
        })
        .or_else(|| {
            crate::combat::selector_domain::matches_selector_domain_predicate(raw, card, context)
        })
}

fn raw_target_ref(value: &str) -> Option<TargetRef> {
    let value = value.trim();
    if value.is_empty()
        || value.eq_ignore_ascii_case("Self")
        || value.eq_ignore_ascii_case("Source")
        || value.eq_ignore_ascii_case("You")
        || value.eq_ignore_ascii_case("YouCtrl")
    {
        Some(TargetRef::Source)
    } else if value.eq_ignore_ascii_case("Remembered") {
        Some(TargetRef::Remembered)
    } else if value.eq_ignore_ascii_case("RememberedLKI") {
        Some(TargetRef::RememberedLki)
    } else if value.eq_ignore_ascii_case("Imprinted") {
        Some(TargetRef::Imprinted)
    } else if value.eq_ignore_ascii_case("ChosenCard") {
        Some(TargetRef::ChosenCard)
    } else if value.eq_ignore_ascii_case("ChosenPlayer") {
        Some(TargetRef::ChosenPlayer)
    } else if value.eq_ignore_ascii_case("Targeted") {
        Some(TargetRef::Targeted)
    } else if value.eq_ignore_ascii_case("TargetedPlayer")
        || value.eq_ignore_ascii_case("TargetedController")
    {
        Some(TargetRef::Targeted)
    } else if value.eq_ignore_ascii_case("Player") {
        Some(TargetRef::Player)
    } else if value.eq_ignore_ascii_case("Opponent") {
        Some(TargetRef::Opponent)
    } else if value.eq_ignore_ascii_case("Battlefield") {
        Some(TargetRef::Battlefield)
    } else if value.eq_ignore_ascii_case("OtherYourBattlefield") {
        Some(TargetRef::OtherYourBattlefield)
    } else if value.eq_ignore_ascii_case("YourGraveyard") {
        Some(TargetRef::YourGraveyard)
    } else if value.eq_ignore_ascii_case("TriggeredTarget") {
        Some(TargetRef::TriggeredTarget)
    } else if value.eq_ignore_ascii_case("TriggeredPlayer") {
        Some(TargetRef::TriggeredPlayer)
    } else if value.eq_ignore_ascii_case("TriggeredCard") {
        Some(TargetRef::TriggeredCard)
    } else if value.eq_ignore_ascii_case("TriggeredCardController") {
        Some(TargetRef::TriggeredCardController)
    } else if value.eq_ignore_ascii_case("TriggeredDefendingPlayer") {
        Some(TargetRef::TriggeredDefendingPlayer)
    } else if value.eq_ignore_ascii_case("TriggeredAttackedTarget") {
        Some(TargetRef::TriggeredAttackedTarget)
    } else if value.eq_ignore_ascii_case("Commander") {
        Some(TargetRef::Commander)
    } else {
        None
    }
}

fn raw_blocked_by_valid_this_turn(value: &str) -> Option<ContextPredicate> {
    if let Some(target) = raw_target_ref(value) {
        return Some(ContextPredicate::BlockedByValidThisTurn(target));
    }
    raw_card_selector_type(value).map(ContextPredicate::BlockedByValidThisTurnType)
}

fn raw_card_selector_type(value: &str) -> Option<CardSelectorType> {
    let value = value.trim();
    match value.to_ascii_lowercase().as_str() {
        "card" => Some(CardSelectorType::Card),
        "creature" => Some(CardSelectorType::Creature),
        "land" => Some(CardSelectorType::Land),
        "artifact" => Some(CardSelectorType::Artifact),
        "enchantment" => Some(CardSelectorType::Enchantment),
        "planeswalker" => Some(CardSelectorType::Planeswalker),
        "permanent" => Some(CardSelectorType::Permanent),
        "nonland" => Some(CardSelectorType::NonLand),
        "noncreature" => Some(CardSelectorType::NonCreature),
        _ if value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '\'') =>
        {
            Some(CardSelectorType::Subtype(value.to_string()))
        }
        _ => None,
    }
}

fn raw_attached_to_relation(value: &str) -> Option<RelationPredicate> {
    if let Some(target) = raw_target_ref(value) {
        return Some(RelationPredicate::AttachedTo(target));
    }
    let card_type = match value.to_ascii_lowercase().as_str() {
        "card" => CardSelectorType::Card,
        "creature" => CardSelectorType::Creature,
        "land" => CardSelectorType::Land,
        "artifact" => CardSelectorType::Artifact,
        "enchantment" => CardSelectorType::Enchantment,
        "permanent" => CardSelectorType::Permanent,
        _ => return None,
    };
    Some(RelationPredicate::AttachedToType(card_type))
}

/// Convenience wrapper: None means "no filter" -> always matches.
pub fn matches_valid_card_selector_opt(
    selector: Option<&CompiledSelector>,
    card: &Card,
    source: &Card,
) -> bool {
    match selector {
        None => true,
        Some(selector) => matches_valid_card_selector(selector, card, source),
    }
}

pub fn matches_valid_card_selector_opt_with_context(
    selector: Option<&CompiledSelector>,
    card: &Card,
    context: MatchContext<'_>,
) -> bool {
    match selector {
        None => true,
        Some(selector) => matches_valid_card_selector_with_context(selector, card, context),
    }
}

pub fn matches_valid_card_selector_opt_in_game(
    selector: Option<&CompiledSelector>,
    card: &Card,
    source: &Card,
    game: &GameState,
) -> bool {
    matches_valid_card_selector_opt_with_context(
        selector,
        card,
        MatchContext::from_source(source).with_game(game),
    )
}

#[cfg(debug_assertions)]
fn matches_single_valid_card(filter: &str, card: &Card, context: MatchContext<'_>) -> bool {
    // Handle comma-separated types with qualifiers (e.g. "Creature.YouCtrl,Artifact.YouCtrl")
    if filter.contains(',') {
        return filter
            .split(',')
            .any(|alt| matches_type_and_qualifiers(alt.trim(), card, context));
    }

    matches_type_and_qualifiers(filter, card, context)
}

#[cfg(debug_assertions)]
fn matches_type_and_qualifiers(filter: &str, card: &Card, context: MatchContext<'_>) -> bool {
    // Split on dots for compound filters (e.g. "Creature.Other", "Card.Self")
    let parts: Vec<&str> = filter.split('.').collect();
    if parts.is_empty() {
        return true;
    }

    let type_part = parts[0];
    let qualifiers = &parts[1..];

    matches_type_and_qualifier_parts(type_part, qualifiers, card, context)
}

#[cfg(debug_assertions)]
fn matches_type_and_qualifier_parts(
    type_part: &str,
    qualifiers: &[&str],
    card: &Card,
    context: MatchContext<'_>,
) -> bool {
    let source = context.source_card;
    // Check the type portion
    let type_matches = match type_part {
        "Card" | "Any" => true, // matches any card
        "Creature" => card.is_creature(),
        "Land" => card.is_land(),
        "Instant" => card.type_line.is_instant(),
        "Sorcery" => card.type_line.is_sorcery(),
        "Artifact" => card.type_line.is_artifact(),
        "Enchantment" => card.type_line.is_enchantment(),
        "Planeswalker" => card.type_line.is_planeswalker(),
        "nonland" | "nonLand" | "NonLand" => !card.is_land(),
        "noncreature" | "nonCreature" | "NonCreature" => !card.is_creature(),
        "Permanent" => card.is_permanent(),
        "Spell" => true, // used in some contexts
        named if named.to_ascii_lowercase().starts_with("named") => {
            card.card_name.eq_ignore_ascii_case(named[5..].trim())
        }
        // Player-type filters: players are not cards, so never match.
        "Player" | "You" | "Opponent" | "Each" | "ActivePlayer" | "NonActivePlayer" => false,
        _ => {
            // Try comma-separated types within the type portion (e.g. "Instant,Sorcery")
            if type_part.contains(',') {
                type_part.split(',').any(|t| match t.trim() {
                    "Creature" => card.is_creature(),
                    "Land" => card.is_land(),
                    "Instant" => card.type_line.is_instant(),
                    "Sorcery" => card.type_line.is_sorcery(),
                    "Artifact" => card.type_line.is_artifact(),
                    "Enchantment" => card.type_line.is_enchantment(),
                    "Planeswalker" => card.type_line.is_planeswalker(),
                    "Card" => true,
                    _ => false,
                })
            } else {
                // Try matching as subtype (e.g. "Zombie", "Wall", "Dragon").
                // This must be changeling-aware for creature types, matching
                // Java's CardType.hasStringType()/hasCreatureType() path.
                card.has_subtype(type_part)
            }
        }
    };

    if !type_matches {
        return false;
    }

    // Check qualifiers — handle compound "+" syntax (e.g. "Self+kicked", "YouCtrl+nonBlack")
    for &qualifier in qualifiers {
        // Split compound qualifiers on '+' (e.g. "Self+kicked" → ["Self", "kicked"])
        let sub_parts: Vec<&str> = qualifier.split('+').collect();
        for sub in &sub_parts {
            // Handle "!" prefix as negation (e.g. "!token" → "nontoken")
            let (negated, raw) = if let Some(stripped) = sub.strip_prefix('!') {
                (true, stripped)
            } else {
                (false, *sub)
            };
            let sub_lower = raw.to_ascii_lowercase();
            // If negated, invert the boolean result of the positive match.
            // "!token" is equivalent to "nontoken", "!Creature" to "nonCreature", etc.
            if negated {
                let positive_match = match sub_lower.as_str() {
                    "token" => card.is_token,
                    "creature" => card.is_creature(),
                    "land" => card.is_land(),
                    "artifact" => card.type_line.is_artifact(),
                    "enchantment" => card.type_line.is_enchantment(),
                    "legendary" => card.type_line.is_legendary(),
                    "basic" => card.type_line.is_basic(),
                    "snow" => card.type_line.is_snow(),
                    _ => {
                        // Try subtype match
                        card.has_subtype(raw)
                    }
                };
                if positive_match {
                    return false;
                }
                continue;
            }
            match sub_lower.as_str() {
                "self" => {
                    if card.id != source.id {
                        return false;
                    }
                }
                "strictlyself" => {
                    if card.id != source.id {
                        return false;
                    }
                }
                "other" | "strictlyother" => {
                    if card.id == source.id {
                        return false;
                    }
                }
                "youctrl" | "youcontrol" | "you" => {
                    if card.controller != source.controller {
                        return false;
                    }
                }
                "youdontctrl" => {
                    if card.controller == source.controller {
                        return false;
                    }
                }
                "youown" => {
                    if card.owner != source.controller {
                        return false;
                    }
                }
                "youdontown" => {
                    if card.owner == source.controller {
                        return false;
                    }
                }
                "isremembered" => {
                    if !source.remembered_cards.contains(&card.id) {
                        return false;
                    }
                }
                "istriggerremembered" => {
                    if !context.trigger_remembered_cards.contains(&card.id) {
                        return false;
                    }
                }
                "effectsource" => {
                    if source.effect_source != Some(card.id) {
                        return false;
                    }
                }
                "oppctrl" | "opponentctrl" | "opponent" => {
                    if card.controller == source.controller {
                        return false;
                    }
                }
                "chosenctrl" => {
                    if Some(card.controller) != source.chosen_player {
                        return false;
                    }
                }
                "oppown" | "opponentown" => {
                    if card.owner == source.controller {
                        return false;
                    }
                }
                "iscommander" => {
                    if !card.is_commander {
                        return false;
                    }
                }
                "isringbearer" => {
                    if !context.game.is_some_and(|game| {
                        game.player(card.controller).ring_bearer == Some(card.id)
                    }) {
                        return false;
                    }
                }
                "legendary" => {
                    if !card.type_line.is_legendary() {
                        return false;
                    }
                }
                "basic" => {
                    if !card.type_line.is_basic() {
                        return false;
                    }
                }
                "snow" => {
                    if !card.type_line.is_snow() {
                        return false;
                    }
                }
                "kicked" => {
                    if !card.kicked {
                        return false;
                    }
                }
                "cameundercontrolsincelastupkeep" => {
                    if !card.came_under_control_since_last_upkeep() {
                        return false;
                    }
                }
                "noncreature" => {
                    if card.is_creature() {
                        return false;
                    }
                }
                "nonland" => {
                    if card.is_land() {
                        return false;
                    }
                }
                "token" => {
                    if !card.is_token {
                        return false;
                    }
                }
                "nontoken" => {
                    if card.is_token {
                        return false;
                    }
                }
                "tapped" => {
                    if !card.tapped {
                        return false;
                    }
                }
                "untapped" => {
                    if card.tapped {
                        return false;
                    }
                }
                "startedtheturnuntapped" => {
                    if card.started_turn_tapped {
                        return false;
                    }
                }
                "startedtheturntapped" => {
                    if !card.started_turn_tapped {
                        return false;
                    }
                }
                "multicolor" => {
                    if !card.color.is_multicolor() {
                        return false;
                    }
                }
                "colorless" => {
                    if !card.color.is_colorless() {
                        return false;
                    }
                }
                "attacking"
                | "attackingyou"
                | "chosencolorsource"
                | "blocking"
                | "blocked"
                | "attackedthisturn"
                | "blockingsource"
                | "blockedbysource"
                | "toplibrary"
                | "exiledwithsource"
                | "rememberedplayerctrl" => {
                    if !legacy_matches_card_atom(raw, card, context) {
                        return false;
                    }
                }
                controlled if controlled.starts_with("controlledby ") => {
                    if !legacy_matches_card_atom(raw, card, context) {
                        return false;
                    }
                }
                "inzonebattlefield" => {
                    if card.zone != forge_foundation::ZoneType::Battlefield {
                        return false;
                    }
                }
                "inzonegraveyard" => {
                    if card.zone != forge_foundation::ZoneType::Graveyard {
                        return false;
                    }
                }
                "inzonehand" => {
                    if card.zone != forge_foundation::ZoneType::Hand {
                        return false;
                    }
                }
                "inzoneexile" => {
                    if card.zone != forge_foundation::ZoneType::Exile {
                        return false;
                    }
                }
                "damagedby" => {
                    // Check if this card was dealt damage by the source card this turn
                    if !card.damage_sources_this_turn.contains(&source.id) {
                        return false;
                    }
                }
                "equippedby" | "enchantedby" | "attachedby" => {
                    // Check if source is attached to this card
                    if source.attached_to != Some(card.id) {
                        return false;
                    }
                }
                "facedown"
                | "paired"
                | "pairedwith"
                | "equipped"
                | "enchanted"
                | "hascounters"
                | "isimprinted"
                | "chosen"
                | "chosencard"
                | "chosencardstrict"
                | "namedcard"
                | "chosencolor"
                | "thisturnentered"
                | "thisturnenteredfrom_battlefield"
                | "wasdealtdamagethisturn"
                | "historic"
                | "modified"
                | "issaddled"
                | "mayplaysource"
                | "suspended"
                | "singletarget"
                | "promisedgift" => {
                    if !legacy_matches_card_atom(raw, card, context) {
                        return false;
                    }
                }
                "wascast" => {
                    // Mirrors Java CardProperty.java:1923-1926 — card must have been
                    // cast (not put onto the battlefield by some other means).
                    if !card.was_cast() {
                        return false;
                    }
                }
                "wascastbyyou" => {
                    // Mirrors Java CardProperty.java:1923-1929: wasCast AND the
                    // spell's activating player equals source's controller.
                    // Rust doesn't track castSA.activatingPlayer separately; the
                    // card's controller at ETB time equals the caster for normal
                    // casts, which covers Sunderflock-style triggers.
                    if !card.was_cast() || card.controller != source.controller {
                        return false;
                    }
                }
                named if named.starts_with("named") => {
                    if !card.card_name.eq_ignore_ascii_case(raw[5..].trim()) {
                        return false;
                    }
                }
                _ => {
                    // Check counters_GE/GT/LT/LE/EQ patterns like "counters_GE3_P1P1"
                    if sub.starts_with("counters_") {
                        if !check_counter_condition(sub, card) {
                            return false;
                        }
                    } else if sub_lower.starts_with("cmc") {
                        // CMC comparisons: cmcEQ1, cmcLE3, cmcGE5
                        let original_rest = &sub[3..];
                        if !check_cmc_condition_with_context(original_rest, card, Some(context)) {
                            return false;
                        }
                    } else if let Some(rest) = sub_lower.strip_prefix("power") {
                        // Power comparisons: powerLE2, powerGE3, etc.
                        if !check_power_condition(rest, card) {
                            return false;
                        }
                    } else if let Some(rest) = sub_lower.strip_prefix("toughness") {
                        // Toughness comparisons: toughnessLE2, toughnessGE3, etc.
                        if !check_toughness_condition(rest, card) {
                            return false;
                        }
                    } else if let Some(color) = Color::from_name(&sub_lower) {
                        // Color names: white, blue, black, red, green
                        if !card.color.has_color(color) {
                            return false;
                        }
                    } else if let Some(kw) = sub_lower.strip_prefix("with") {
                        // "withFlying", "withoutFlying", etc.
                        if kw.strip_prefix("out").is_some() {
                            // "withoutFlying" — card must NOT have this keyword
                            let kw_name = &sub[7..]; // original case
                            if card.has_keyword(kw_name) {
                                return false;
                            }
                        } else if !kw.is_empty() {
                            // "withFlying" — card must have this keyword
                            let kw_name = &sub[4..]; // original case
                            if !card.has_keyword(kw_name) {
                                return false;
                            }
                        }
                    } else if let Some(negated) = sub_lower.strip_prefix("non") {
                        // Negated qualifier: "nonBlack", "nonArtifact", "nonFlying", etc.
                        let should_negate = match negated {
                            "creature" => card.is_creature(),
                            "land" => card.is_land(),
                            "artifact" => card.type_line.is_artifact(),
                            "enchantment" => card.type_line.is_enchantment(),
                            "legendary" => card.type_line.is_legendary(),
                            "basic" => card.type_line.is_basic(),
                            "snow" => card.type_line.is_snow(),
                            "token" => card.is_token,
                            "colorless" => card.color.is_colorless(),
                            _ => {
                                if let Some(color) = Color::from_name(negated) {
                                    card.color.has_color(color)
                                } else {
                                    // nonSubtype: e.g., "nonHuman", "nonWall"
                                    card.has_subtype(
                                        &sub[3..], // use original case for subtype
                                    )
                                }
                            }
                        };
                        if should_negate {
                            return false;
                        }
                    } else if sub_lower == "chosentype" {
                        // "ChosenType" — card must have the source card's chosen
                        // creature type. Changeling counts as all creature types.
                        // Mirrors Java CardTraitBase.isValid() ChosenType path.
                        let matches = if let Some(ref ct) = source.chosen_type {
                            card.type_line.has_subtype(ct) || card.has_keyword("Changeling")
                        } else {
                            false
                        };
                        if !matches {
                            return false;
                        }
                    } else if !sub.is_empty() {
                        // Color source check: "RedSource", "WhiteSource", "BlackSource", etc.
                        // Mirrors Java ForgeScript.cardStateHasProperty: strip "Source" suffix,
                        // then check card color. Also handles "nonRedSource" via the non- prefix above.
                        let color_name = sub.strip_suffix("Source").unwrap_or(sub);
                        if let Some(color) = Color::from_name(&color_name.to_lowercase()) {
                            if !card.color.has_color(color) {
                                return false;
                            }
                        } else if color_name.eq_ignore_ascii_case("Colorless") {
                            if !card.color.is_colorless() {
                                return false;
                            }
                        } else {
                            // Fall through: check as creature subtype (Wall, Zombie, etc.)
                            // Mirrors card_has_property behavior: unrecognized qualifiers
                            // are checked against the card's type_line subtypes.
                            if !card.has_subtype(sub) {
                                return false;
                            }
                        }
                    }
                }
            }
        }
    }

    true
}

/// Check if a player matches a filter expression like "You", "Opponent", "Each".
pub fn matches_valid_player(filter: &str, player: PlayerId, source_controller: PlayerId) -> bool {
    let filter = filter.trim();
    if filter.is_empty() {
        return true;
    }

    // Handle comma-separated alternatives
    if filter.contains(',') {
        return filter
            .split(',')
            .any(|part| matches_single_valid_player(part.trim(), player, source_controller));
    }

    matches_single_valid_player(filter, player, source_controller)
}

/// Convenience wrapper: None means "no filter" → always matches.
pub fn matches_valid_player_opt(
    filter: Option<&str>,
    player: PlayerId,
    source_controller: PlayerId,
) -> bool {
    match filter {
        None => true,
        Some(v) => matches_valid_player(v, player, source_controller),
    }
}

/// Match a precompiled selector against a player without reparsing the
/// comma-separated alternatives.
pub fn matches_valid_player_selector(
    selector: &CompiledSelector,
    player: PlayerId,
    source_controller: PlayerId,
) -> bool {
    let result = matches_player_selector_ir(&selector.ir, player, source_controller);
    #[cfg(debug_assertions)]
    debug_assert_eq!(
        result,
        matches_valid_player(&selector.as_raw(), player, source_controller),
        "compiled player selector diverged from string matcher for {:?}",
        selector.as_raw()
    );
    result
}

fn matches_player_selector_ir(
    selector: &Selector,
    player: PlayerId,
    source_controller: PlayerId,
) -> bool {
    if selector.alternatives.is_empty() {
        return true;
    }

    selector.alternatives.iter().any(|alternative| {
        alternative
            .predicates
            .iter()
            .all(|predicate| matches_player_predicate(predicate, player, source_controller))
    })
}

fn matches_player_predicate(
    predicate: &SelectorPredicate,
    player: PlayerId,
    source_controller: PlayerId,
) -> bool {
    match predicate {
        SelectorPredicate::Any | SelectorPredicate::Player => true,
        SelectorPredicate::PlayerController(controller)
        | SelectorPredicate::CardController(controller) => {
            matches_player_controller(*controller, player, source_controller)
        }
        SelectorPredicate::Raw(raw) => matches_single_valid_player(raw, player, source_controller),
        // Legacy player matching treats unknown card-oriented predicates as
        // permissive, so keep that behavior for mixed ValidTarget paths.
        SelectorPredicate::CardType(_)
        | SelectorPredicate::CardSupertype(_)
        | SelectorPredicate::CardIdentity(_)
        | SelectorPredicate::CardOwner(_)
        | SelectorPredicate::Tapped(_)
        | SelectorPredicate::StartedTurnTapped(_)
        | SelectorPredicate::CameUnderControlSinceLastUpkeep
        | SelectorPredicate::Zone(_)
        | SelectorPredicate::RememberedCard
        | SelectorPredicate::TriggerRememberedCard
        | SelectorPredicate::EffectSource
        | SelectorPredicate::Commander
        | SelectorPredicate::Legendary
        | SelectorPredicate::Kicked
        | SelectorPredicate::Token(_)
        | SelectorPredicate::Color(_)
        | SelectorPredicate::Multicolor
        | SelectorPredicate::Colorless
        | SelectorPredicate::SourceColor(_)
        | SelectorPredicate::SourceColorless
        | SelectorPredicate::ChosenColorSource
        | SelectorPredicate::CardState(_)
        | SelectorPredicate::Context(_)
        | SelectorPredicate::Relation(_)
        | SelectorPredicate::DamagedBy
        | SelectorPredicate::AttachedBy
        | SelectorPredicate::WasCast { .. }
        | SelectorPredicate::ChosenType
        | SelectorPredicate::Keyword { .. }
        | SelectorPredicate::NumericComparison { .. }
        | SelectorPredicate::NumericParity { .. }
        | SelectorPredicate::CounterComparison { .. }
        | SelectorPredicate::Not(_) => true,
    }
}

fn matches_player_controller(
    controller: ControllerSelector,
    player: PlayerId,
    source_controller: PlayerId,
) -> bool {
    match controller {
        ControllerSelector::You => player == source_controller,
        ControllerSelector::Opponent => player != source_controller,
    }
}

/// Convenience wrapper: None means "no filter" -> always matches.
pub fn matches_valid_player_selector_opt(
    selector: Option<&CompiledSelector>,
    player: PlayerId,
    source_controller: PlayerId,
) -> bool {
    match selector {
        None => true,
        Some(selector) => matches_valid_player_selector(selector, player, source_controller),
    }
}

/// Mirrors Java's `CardTraitBase.matchesValid(Object, String[], Card, Player)`.
///
/// Java uses polymorphic dispatch via `GameObject.isValid()` — both Card and
/// Player implement it. In Rust, we take both as Options and try card first,
/// then player, mirroring the `instanceof` chain in Java.
///
/// This eliminates the need for callers to guess whether a filter string can
/// match a player (the old `filter_can_match_player` heuristic).
pub fn matches_valid(
    filter: &str,
    card: Option<&Card>,
    player: Option<PlayerId>,
    source: &Card,
    source_controller: PlayerId,
) -> bool {
    if let Some(card) = card {
        matches_valid_card(filter, card, source)
    } else if let Some(player) = player {
        // Java parity: `Player.isValid` rejects card-oriented filter heads
        // (e.g. "Card.Self", "Permanent.YouCtrl"). Without this guard the
        // permissive fallback in `matches_single_valid_player` matches any
        // unknown head, causing triggers like Ward (`ValidTarget$ Card.Self`)
        // to fire on player targets.
        if !filter_head_can_match_player(filter) {
            return false;
        }
        matches_valid_player(filter, player, source_controller)
    } else {
        false
    }
}

fn filter_head_can_match_player(filter: &str) -> bool {
    filter.split(',').any(|alternative| {
        let head = alternative
            .trim()
            .split(['.', '+'])
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        matches!(
            head.as_str(),
            "" | "you"
                | "youctrl"
                | "youcontroller"
                | "opponent"
                | "oppctrl"
                | "opponentctrl"
                | "any"
                | "each"
                | "player"
                | "active"
                | "nonactive"
                | "remembered"
                | "isremembered"
                | "targetedplayer"
                | "playerctrl"
                | "playercontroller"
                | "controller"
                | "all"
        )
    })
}

fn matches_single_valid_player(
    filter: &str,
    player: PlayerId,
    source_controller: PlayerId,
) -> bool {
    let filter_lower = filter.to_ascii_lowercase();
    if let Some(rest) = filter_lower.strip_prefix("player.") {
        return matches_single_valid_player(rest, player, source_controller);
    }
    match filter_lower.as_str() {
        "you" | "youctrl" => player == source_controller,
        "opponent" | "oppctrl" | "opponentctrl" => player != source_controller,
        "any" | "each" | "player" | "player.ingame" => true,
        // "Active" / "NonActive" would need turn info — not currently supported
        _ => true, // unknown filter, match all (permissive fallback)
    }
}

/// Check a counter condition like "counters_GE3_P1P1".
/// Format: counters_{op}{num}_{counter_type}
fn check_counter_condition(condition: &str, card: &Card) -> bool {
    use crate::ability::effects::parse_counter_type;
    let rest = &condition["counters_".len()..];
    if rest.len() < 3 {
        return true;
    }
    let op = &rest[..2];
    let after_op = &rest[2..];
    let (num_str, counter_type_str) = match after_op.find('_') {
        Some(idx) => (&after_op[..idx], &after_op[idx + 1..]),
        None => return true,
    };
    let threshold: i32 = num_str.parse().unwrap_or(0);
    let counter_type = parse_counter_type(counter_type_str);
    let count = card.counter_count(&counter_type);
    match op {
        "GE" => count >= threshold,
        "GT" => count > threshold,
        "LE" => count <= threshold,
        "LT" => count < threshold,
        "EQ" => count == threshold,
        "NE" => count != threshold,
        _ => true,
    }
}

/// Check a CMC condition like "cmcEQ1", "cmcLE3", or "cmcLEY".
fn check_cmc_condition_with_context(
    rest: &str,
    card: &Card,
    context: Option<MatchContext<'_>>,
) -> bool {
    let cmc = context
        .map(|ctx| effective_mana_value(card, ctx))
        .unwrap_or_else(|| card.mana_cost.cmc());
    let lower = rest.to_ascii_lowercase();
    if lower.starts_with("eq") {
        if let Some(n) = parse_cmc_threshold(&rest[2..], context) {
            return cmc == n;
        }
    } else if lower.starts_with("le") {
        if let Some(n) = parse_cmc_threshold(&rest[2..], context) {
            return cmc <= n;
        }
    } else if lower.starts_with("ge") {
        if let Some(n) = parse_cmc_threshold(&rest[2..], context) {
            return cmc >= n;
        }
    } else if lower.starts_with("lt") {
        if let Some(n) = parse_cmc_threshold(&rest[2..], context) {
            return cmc < n;
        }
    } else if lower.starts_with("gt") {
        if let Some(n) = parse_cmc_threshold(&rest[2..], context) {
            return cmc > n;
        }
    } else if lower.starts_with("ne") {
        if let Some(n) = parse_cmc_threshold(&rest[2..], context) {
            return cmc != n;
        }
    }
    true // fallback: unknown format passes
}

fn parse_cmc_threshold(value: &str, context: Option<MatchContext<'_>>) -> Option<i32> {
    if let Ok(n) = value.parse::<i32>() {
        return Some(n);
    }
    let context = context?;
    let raw = context.source_card.get_s_var(value)?;
    if let Ok(n) = raw.trim().parse::<i32>() {
        return Some(n);
    }
    if raw.starts_with("Count$") || raw.starts_with("PlayerCount") {
        let game = context.game?;
        let sa = crate::spellability::SpellAbility::new_empty(
            Some(context.source_card.id),
            context.source_controller,
        );
        return Some(crate::svar::resolve_svar_expression(
            raw,
            game,
            context.source_card.id,
            context.source_controller,
            &sa,
        ));
    }
    None
}

/// Check a power condition like "LE2", "GE3", "EQ0".
fn check_power_condition(rest: &str, card: &Card) -> bool {
    let power = card.power();
    if let Some(num_str) = rest.strip_prefix("eq") {
        if let Ok(n) = num_str.parse::<i32>() {
            return power == n;
        }
    } else if let Some(num_str) = rest.strip_prefix("le") {
        if let Ok(n) = num_str.parse::<i32>() {
            return power <= n;
        }
    } else if let Some(num_str) = rest.strip_prefix("ge") {
        if let Ok(n) = num_str.parse::<i32>() {
            return power >= n;
        }
    } else if let Some(num_str) = rest.strip_prefix("lt") {
        if let Ok(n) = num_str.parse::<i32>() {
            return power < n;
        }
    } else if let Some(num_str) = rest.strip_prefix("gt") {
        if let Ok(n) = num_str.parse::<i32>() {
            return power > n;
        }
    } else if let Some(num_str) = rest.strip_prefix("ne") {
        if let Ok(n) = num_str.parse::<i32>() {
            return power != n;
        }
    }
    true // fallback: unknown format passes
}

/// Check a toughness condition like "LE2", "GE3", "EQ0".
fn check_toughness_condition(rest: &str, card: &Card) -> bool {
    let toughness = card.toughness();
    if let Some(num_str) = rest.strip_prefix("eq") {
        if let Ok(n) = num_str.parse::<i32>() {
            return toughness == n;
        }
    } else if let Some(num_str) = rest.strip_prefix("le") {
        if let Ok(n) = num_str.parse::<i32>() {
            return toughness <= n;
        }
    } else if let Some(num_str) = rest.strip_prefix("ge") {
        if let Ok(n) = num_str.parse::<i32>() {
            return toughness >= n;
        }
    } else if let Some(num_str) = rest.strip_prefix("lt") {
        if let Ok(n) = num_str.parse::<i32>() {
            return toughness < n;
        }
    } else if let Some(num_str) = rest.strip_prefix("gt") {
        if let Ok(n) = num_str.parse::<i32>() {
            return toughness > n;
        }
    } else if let Some(num_str) = rest.strip_prefix("ne") {
        if let Ok(n) = num_str.parse::<i32>() {
            return toughness != n;
        }
    }
    true // fallback: unknown format passes
}

// ── Common requirement checks ───────────────────────────────────────────────
//
// These mirror Java's `CardTraitBase.meetsCommonRequirements()` — shared
// validation logic used by triggers, static abilities, replacement effects,
// and cost adjustment. Previously duplicated in 4+ locations.

pub fn check_svar_requirement(
    game: &GameState,
    source: &Card,
    svar_source: &dyn HasSVars,
    check_name: &str,
    compare: &str,
) -> bool {
    let value = requirement_amount(source, svar_source, check_name, game);
    compare_requirement_amount(source, svar_source, compare, game, value)
}

fn check_condition_value(game: &GameState, condition: Option<&str>, source: &Card) -> bool {
    let Some(condition) = condition else {
        return true;
    };
    let controller = requirement_controller(game, source);
    match condition {
        "PlayerTurn" => game.active_player() == controller,
        "NotPlayerTurn" => game.active_player() != controller,
        "Threshold" => game.player_has_threshold(controller),
        "Hellbent" => game.player_has_hellbent(controller),
        "Metalcraft" => game.player_has_metalcraft(controller),
        "Delirium" => game.player_has_delirium(controller),
        "Ferocious" => game.player_has_ferocious(controller),
        "Desert" => game.player_has_desert(controller),
        "Blessing" => game.player_has_blessing(controller),
        "Monarch" => game.monarch == Some(controller),
        "Night" => game.is_night,
        "FatefulHour" => game.player(controller).life <= 5,
        _ => true, // unknown condition — permissive fallback
    }
}

fn meets_card_trait_requirements(
    requirements: &CardTraitRequirementsIr,
    game: &GameState,
    source: &Card,
    svar_source: &dyn HasSVars,
) -> bool {
    if requirements.is_empty() {
        return true;
    }

    let _perf_scope =
        crate::perf::ParamsLookupScopeGuard::enter(crate::perf::ParamsLookupScope::ValidFilter);
    let controller = requirement_controller(game, source);

    if !check_boolean_requirement(
        requirements.metalcraft.as_deref(),
        game.player_has_metalcraft(controller),
    ) {
        return false;
    }
    if !check_boolean_requirement(
        requirements.delirium.as_deref(),
        game.player_has_delirium(controller),
    ) {
        return false;
    }
    if !check_boolean_requirement(
        requirements.threshold.as_deref(),
        game.player_has_threshold(controller),
    ) {
        return false;
    }
    if !check_boolean_requirement(
        requirements.hellbent.as_deref(),
        game.player_has_hellbent(controller),
    ) {
        return false;
    }
    if !check_boolean_requirement(
        requirements.bloodthirst.as_deref(),
        game.player_has_bloodthirst(controller),
    ) {
        return false;
    }
    if !check_boolean_requirement(
        requirements.fateful_hour.as_deref(),
        game.player(controller).life <= 5,
    ) {
        return false;
    }
    if !check_boolean_requirement(
        requirements.monarch.as_deref(),
        game.monarch == Some(controller),
    ) {
        return false;
    }
    if let Some(revolt) = requirements.revolt.as_deref() {
        if revolt.eq_ignore_ascii_case("True") != game.player_has_revolt(controller) {
            return false;
        } else if revolt.eq_ignore_ascii_case("None")
            && game
                .alive_players()
                .into_iter()
                .any(|pid| game.player_has_revolt(pid))
        {
            return false;
        }
    }
    if !check_boolean_requirement(
        requirements.desert.as_deref(),
        game.player_has_desert(controller),
    ) {
        return false;
    }
    if !check_boolean_requirement(
        requirements.blessing.as_deref(),
        game.player_has_blessing(controller),
    ) {
        return false;
    }

    if let Some(day_time) = requirements.day_time.as_deref() {
        if day_time.eq_ignore_ascii_case("Day") {
            if !game.is_day() {
                return false;
            }
        } else if day_time.eq_ignore_ascii_case("Night") {
            if !game.is_night {
                return false;
            }
        } else if day_time.eq_ignore_ascii_case("Neither") && !game.is_neither_day_nor_night() {
            return false;
        }
    }

    if let Some(adamant) = requirements.adamant.as_deref() {
        let color_mask = ManaAtom::from_name(&adamant.to_ascii_lowercase());
        if adamant.eq_ignore_ascii_case("Any") {
            let has_three = [
                ManaAtom::WHITE,
                ManaAtom::BLUE,
                ManaAtom::BLACK,
                ManaAtom::RED,
                ManaAtom::GREEN,
            ]
            .into_iter()
            .any(|mask| paying_color_count(&source.paying_mana_to_cast, mask) >= 3);
            if !has_three {
                return false;
            }
        } else if paying_color_count(&source.paying_mana_to_cast, color_mask) < 3 {
            return false;
        }
    }

    if let Some(life_total) = requirements.life_total.as_deref() {
        let compare = requirements.life_amount.as_deref().unwrap_or("GE1");
        let life = player_life_for_requirement(game, source, life_total);
        if !compare_requirement_amount(source, svar_source, compare, game, life) {
            return false;
        }
    }

    if let Some(is_present) = requirements.is_present.as_deref() {
        let present_compare = requirements.present_compare.as_deref().unwrap_or("GE1");
        let present_player = requirements.present_player.as_deref().unwrap_or("Any");
        let present_zone = requirements
            .present_zone
            .as_deref()
            .and_then(parse_zone_name)
            .unwrap_or(ZoneType::Battlefield);
        let selector = requirements
            .is_present_selector
            .clone()
            .unwrap_or_else(|| cached_compiled_selector(is_present));
        let count = collect_present_cards(
            game,
            source,
            requirements.present_defined.as_deref(),
            present_player,
            present_zone,
        )
        .into_iter()
        .filter(|&cid| matches_valid_card_selector_in_game(&selector, game.card(cid), source, game))
        .count() as i32;
        if !compare_requirement_amount(source, svar_source, present_compare, game, count) {
            return false;
        }
    }

    if let Some(is_present) = requirements.is_present2.as_deref() {
        let present_compare = requirements.present_compare2.as_deref().unwrap_or("GE1");
        let present_player = requirements.present_player2.as_deref().unwrap_or("Any");
        let present_zone = requirements
            .present_zone2
            .as_deref()
            .and_then(parse_zone_name)
            .unwrap_or(ZoneType::Battlefield);
        let selector = requirements
            .is_present2_selector
            .clone()
            .unwrap_or_else(|| cached_compiled_selector(is_present));
        let count = collect_present_cards(game, source, None, present_player, present_zone)
            .into_iter()
            .filter(|&cid| {
                matches_valid_card_selector_in_game(&selector, game.card(cid), source, game)
            })
            .count() as i32;
        if !compare_requirement_amount(source, svar_source, present_compare, game, count) {
            return false;
        }
    }

    if let Some(defined_players) = requirements.check_defined_player.as_deref() {
        let players = crate::ability::ability_utils::get_defined_players(
            game,
            Some(source.id),
            defined_players,
            Some(controller),
        );
        let compare = requirements
            .defined_player_compare
            .as_deref()
            .unwrap_or("GE1");
        if !compare_requirement_amount(source, svar_source, compare, game, players.len() as i32) {
            return false;
        }
    }

    if let Some(check_name) = requirements.check_svar.as_deref() {
        let compare = requirements.svar_compare.as_deref().unwrap_or("GE1");
        if !check_svar_requirement(game, source, svar_source, check_name, compare) {
            return false;
        }
        if let Some(check_name) = requirements.check_second_svar.as_deref() {
            let compare = requirements.second_svar_compare.as_deref().unwrap_or("GE1");
            if !check_svar_requirement(game, source, svar_source, check_name, compare) {
                return false;
            }
        }
    }

    if let Some(mana_spent) = requirements.mana_spent.as_deref() {
        let colors = ManaAtom::from_name(&mana_spent.to_ascii_lowercase());
        if !has_all_spent_colors(source.colors_spent_to_cast, colors) {
            return false;
        }
    }
    if let Some(mana_not_spent) = requirements.mana_not_spent.as_deref() {
        let colors = ManaAtom::from_name(&mana_not_spent.to_ascii_lowercase());
        if has_all_spent_colors(source.colors_spent_to_cast, colors) {
            return false;
        }
    }

    if requirements.werewolf_transform_condition
        && !game.stack.get_spells_cast_last_turn().is_empty()
    {
        return false;
    }
    if requirements.werewolf_untransform_condition {
        let cast_last_turn = game.stack.get_spells_cast_last_turn();
        let mut condition_met = false;
        for pid in game.alive_players() {
            let count = cast_last_turn
                .iter()
                .filter(|&&cid| game.card(cid).controller == pid)
                .count();
            if count > 1 {
                condition_met = true;
                break;
            }
        }
        if !condition_met {
            return false;
        }
    }

    if let Some(class_level) = requirements.class_level.as_deref() {
        let min = class_level.parse::<i32>().unwrap_or(0);
        if source.class_level < min {
            return false;
        }
    }

    check_condition_value(game, requirements.condition.as_deref(), source)
}

/// Parse a zone name string into ZoneType.
fn parse_zone_name(name: &str) -> Option<ZoneType> {
    ZoneType::from_str_compat(name)
}
