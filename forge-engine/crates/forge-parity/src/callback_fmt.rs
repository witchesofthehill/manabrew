//! Central formatting for parity callback outcomes.
//!
//! Every callback result passes through [`ParityFormat::parity_fmt`] before
//! being stored in a [`CallbackRecord`]. This is the **single place** that
//! controls how values appear in the parity log — change formatting here and
//! both the investigation side-by-side display and the verbose agent log update.
//!
//! The goal is to produce strings that are:
//! 1. **Human-readable** — card names instead of opaque IDs.
//! 2. **Cross-engine comparable** — identical format on both Rust and Java.
//! 3. **Stable** — uses parity IDs, not engine-internal indices.
//!
//! ## Card identity format
//!
//! Cards are rendered as `Name@parityId`, e.g. `Mountain@3`.
//! This matches the Java side's `ParityCardMap.appendKey()` format.

use forge_engine_core::ability::api_type::ApiType;
use forge_engine_core::agent::{
    BinaryChoiceKind, CombatCostAction, GameEntity, ManaCostAction, PlayOption, RollSwapChoice,
    TargetChoice,
};
use forge_engine_core::combat::DefenderId;
use forge_engine_core::game::GameState;
use forge_engine_core::ids::{CardId, PlayerId};
use forge_engine_core::mana::ManaPool;
use forge_engine_core::player::actions::player_action::{
    AbilityRef, PlayerAction, STATIC_ALTERNATIVE_ABILITY_INDEX,
};
use forge_engine_core::spellability::SpellAbility;
use forge_foundation::mana::ManaAtom;
use forge_foundation::{ManaCost, ZoneType};

use crate::parity_order;

use crate::parity_card_map::ParityCardMap;

// ── Formatting context ──────────────────────────────────────────────────────

/// Everything the formatter needs to resolve IDs to names.
pub struct FmtCtx<'a> {
    pub game: &'a GameState,
    pub parity_map: &'a ParityCardMap,
}

impl<'a> FmtCtx<'a> {
    /// Format a single card as `Name@parityId`.
    pub fn card(&self, cid: CardId) -> String {
        let name = &self.game.card(cid).card_name;
        let pid = self.parity_map.id(cid);
        format!("{name}@{pid}")
    }

    /// Format an optional card.
    pub fn opt_card(&self, cid: Option<CardId>) -> String {
        match cid {
            Some(c) => self.card(c),
            None => "None".to_string(),
        }
    }

    /// Format a player reference.
    pub fn player(&self, pid: PlayerId) -> String {
        format!("Player({})", pid.0)
    }

    /// Format a list of cards as `[Name@1, Name@2]`.
    pub fn card_list(&self, cards: &[CardId]) -> String {
        let items: Vec<String> = cards.iter().map(|&c| self.card(c)).collect();
        format!("[{}]", items.join(", "))
    }
}

// ── The central formatting trait ────────────────────────────────────────────

/// Trait that controls how a callback return value is rendered for the parity log.
///
/// Implement this for every return type used in `parity_agent_callback!`.
/// The output must match the format produced by Java's `onCallback` second arg.
pub trait ParityFormat {
    fn parity_fmt(&self, ctx: &FmtCtx<'_>) -> String;
}

// ── Primitive impls (no card IDs to resolve) ────────────────────────────────

impl ParityFormat for bool {
    fn parity_fmt(&self, _ctx: &FmtCtx<'_>) -> String {
        self.to_string()
    }
}

impl ParityFormat for u32 {
    fn parity_fmt(&self, _ctx: &FmtCtx<'_>) -> String {
        self.to_string()
    }
}

impl ParityFormat for usize {
    fn parity_fmt(&self, _ctx: &FmtCtx<'_>) -> String {
        self.to_string()
    }
}

impl ParityFormat for CardId {
    fn parity_fmt(&self, ctx: &FmtCtx<'_>) -> String {
        ctx.card(*self)
    }
}

impl ParityFormat for PlayerId {
    fn parity_fmt(&self, ctx: &FmtCtx<'_>) -> String {
        ctx.player(*self)
    }
}

// ── Option<T> ───────────────────────────────────────────────────────────────

impl<T: ParityFormat> ParityFormat for Option<T> {
    fn parity_fmt(&self, ctx: &FmtCtx<'_>) -> String {
        match self {
            Some(v) => format!("Some({})", v.parity_fmt(ctx)),
            None => "None".to_string(),
        }
    }
}

// ── Vec<T> ──────────────────────────────────────────────────────────────────

impl<T: ParityFormat> ParityFormat for Vec<T> {
    fn parity_fmt(&self, ctx: &FmtCtx<'_>) -> String {
        let items: Vec<String> = self.iter().map(|v| v.parity_fmt(ctx)).collect();
        format!("[{}]", items.join(", "))
    }
}

// ── Tuple (CardId, DefenderId) — for choose_attackers ───────────────────────

impl ParityFormat for (CardId, DefenderId) {
    fn parity_fmt(&self, ctx: &FmtCtx<'_>) -> String {
        let (card, defender) = self;
        format!("({}, {:?})", ctx.card(*card), defender)
    }
}

// ── Tuple (CardId, CardId) — for choose_blockers ────────────────────────────

impl ParityFormat for (CardId, CardId) {
    fn parity_fmt(&self, ctx: &FmtCtx<'_>) -> String {
        let (a, b) = self;
        format!("({}, {})", ctx.card(*a), ctx.card(*b))
    }
}

// ── Tuple (Option<CardId>, i32) — for assign_combat_damage ──────────────────

impl ParityFormat for (Option<CardId>, i32) {
    fn parity_fmt(&self, ctx: &FmtCtx<'_>) -> String {
        let (target, dmg) = self;
        let target_str = match target {
            Some(c) => ctx.card(*c),
            None => "defender".to_string(),
        };
        format!("{}={}", target_str, dmg)
    }
}

// ── String / Option<String> ─────────────────────────────────────────────────

impl ParityFormat for String {
    fn parity_fmt(&self, _ctx: &FmtCtx<'_>) -> String {
        self.clone()
    }
}

// ── i32 / Option<i32> ───────────────────────────────────────────────────────

impl ParityFormat for i32 {
    fn parity_fmt(&self, _ctx: &FmtCtx<'_>) -> String {
        self.to_string()
    }
}

impl ParityFormat for () {
    fn parity_fmt(&self, _ctx: &FmtCtx<'_>) -> String {
        "()".to_string()
    }
}

// ── Game entity types ───────────────────────────────────────────────────────

impl ParityFormat for GameEntity {
    fn parity_fmt(&self, ctx: &FmtCtx<'_>) -> String {
        match self {
            GameEntity::Player(pid) => ctx.player(*pid),
            GameEntity::Card(cid) => format!("Card({})", ctx.card(*cid)),
        }
    }
}

impl ParityFormat for TargetChoice {
    fn parity_fmt(&self, ctx: &FmtCtx<'_>) -> String {
        match self {
            TargetChoice::Player(pid) => ctx.player(*pid),
            TargetChoice::Card(cid) => format!("Card({})", ctx.card(*cid)),
            TargetChoice::None => "None".to_string(),
        }
    }
}

// ── Play / action types ─────────────────────────────────────────────────────

impl ParityFormat for PlayOption {
    fn parity_fmt(&self, ctx: &FmtCtx<'_>) -> String {
        let card = ctx.card(self.card_id);
        // Java's DeterministicController always formats play actions as
        // `mode: Normal` regardless of alternative costs (Evoke, Flashback,
        // etc.), because Java surfaces alt costs via the underlying
        // SpellAbility, not a distinct PlayOption. Match that for parity.
        let _ = self.mode;
        format!("PlayOption {{ card: {card}, mode: Normal }}")
    }
}

impl ParityFormat for AbilityRef {
    fn parity_fmt(&self, ctx: &FmtCtx<'_>) -> String {
        let card = ctx.card(self.card_id);
        let ability_index = if self.ability_index == STATIC_ALTERNATIVE_ABILITY_INDEX {
            "-1".to_string()
        } else {
            self.ability_index.to_string()
        };
        format!("AbilityRef {{ card: {card}, ability_index: {ability_index} }}")
    }
}

impl ParityFormat for PlayerAction {
    fn parity_fmt(&self, ctx: &FmtCtx<'_>) -> String {
        match self {
            PlayerAction::PassPriority => "PassPriority".to_string(),
            PlayerAction::CastSpell(opt) => {
                format!("CastSpell({})", opt.parity_fmt(ctx))
            }
            PlayerAction::ActivateAbility(aref) => {
                format!("ActivateAbility({})", aref.parity_fmt(ctx))
            }
            PlayerAction::ActivateMana(cid, idx) => {
                format!("ActivateMana({}, {:?})", ctx.card(*cid), idx)
            }
            // For other variants, fall back to Debug but resolve card IDs where possible.
            other => format!("{:?}", other),
        }
    }
}

// ── Cost action types ───────────────────────────────────────────────────────

impl ParityFormat for CombatCostAction {
    fn parity_fmt(&self, ctx: &FmtCtx<'_>) -> String {
        match self {
            CombatCostAction::TapLand(cid) => format!("TapLand({})", ctx.card(*cid)),
            CombatCostAction::UntapLand(cid) => format!("UntapLand({})", ctx.card(*cid)),
            CombatCostAction::Pay => "Pay".to_string(),
            CombatCostAction::Decline => "Decline".to_string(),
        }
    }
}

impl ParityFormat for ManaCostAction {
    fn parity_fmt(&self, ctx: &FmtCtx<'_>) -> String {
        match self {
            ManaCostAction::TapLand {
                card_id,
                mana_ability_index,
                express_choice,
            } => {
                let card_ref = ctx.game.card(*card_id);
                let card = ctx.card(*card_id);
                // Match Java `AutoPay.describeStep()`: "TapLand" only for lands,
                // "ActivateManaAbility" for non-land mana sources (signets etc.).
                let action = if card_ref.is_land() {
                    "TapLand"
                } else {
                    "ActivateManaAbility"
                };
                let idx = mana_ability_index.map(|i| i as i32).unwrap_or(-1);
                let express = match express_choice {
                    Some(ec) => fmt_mana_atom(*ec),
                    None => "null".to_string(),
                };
                format!(
                    "{action} {{ card: {card}, mana_ability_index: {idx}, express_choice: {express} }}"
                )
            }
            ManaCostAction::UntapLand(cid) => format!("UntapLand({})", ctx.card(*cid)),
            ManaCostAction::Pay { auto } => {
                if *auto {
                    "Pay { auto: true }".to_string()
                } else {
                    "Pay".to_string()
                }
            }
            ManaCostAction::AttemptedAndFailed => "Cancel".to_string(),
        }
    }
}

fn fmt_mana_atom(atom: u16) -> String {
    match atom {
        ManaAtom::WHITE => "W".to_string(),
        ManaAtom::BLUE => "U".to_string(),
        ManaAtom::BLACK => "B".to_string(),
        ManaAtom::RED => "R".to_string(),
        ManaAtom::GREEN => "G".to_string(),
        ManaAtom::COLORLESS => "C".to_string(),
        _ => fmt_mana_atom_set(atom),
    }
}

fn fmt_mana_atom_set(atom: u16) -> String {
    let mut colors = Vec::new();
    if atom & ManaAtom::WHITE != 0 {
        colors.push("white".to_string());
    }
    if atom & ManaAtom::BLUE != 0 {
        colors.push("blue".to_string());
    }
    if atom & ManaAtom::BLACK != 0 {
        colors.push("black".to_string());
    }
    if atom & ManaAtom::RED != 0 {
        colors.push("red".to_string());
    }
    if atom & ManaAtom::GREEN != 0 {
        colors.push("green".to_string());
    }
    if colors.is_empty() {
        return "?".to_string();
    }
    parity_order::sort_color_names_like_java(&colors)
        .iter()
        .filter_map(|color| match color.as_str() {
            "white" => Some("W"),
            "blue" => Some("U"),
            "black" => Some("B"),
            "red" => Some("R"),
            "green" => Some("G"),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join(" ")
}

// ── Dice / roll types ───────────────────────────────────────────────────────

impl ParityFormat for RollSwapChoice {
    fn parity_fmt(&self, _ctx: &FmtCtx<'_>) -> String {
        format!("{:?}", self)
    }
}

pub trait CallbackArgDisplay {
    fn callback_arg_display(&self, ctx: Option<&FmtCtx<'_>>) -> String;
}

impl<T: CallbackArgDisplay + ?Sized> CallbackArgDisplay for &T {
    fn callback_arg_display(&self, ctx: Option<&FmtCtx<'_>>) -> String {
        (**self).callback_arg_display(ctx)
    }
}
impl<T: CallbackArgDisplay + ?Sized> CallbackArgDisplay for &mut T {
    fn callback_arg_display(&self, ctx: Option<&FmtCtx<'_>>) -> String {
        (**self).callback_arg_display(ctx)
    }
}

impl CallbackArgDisplay for [CardId] {
    fn callback_arg_display(&self, ctx: Option<&FmtCtx<'_>>) -> String {
        if let Some(ctx) = ctx {
            ctx.card_list(self)
        } else {
            self.len().to_string()
        }
    }
}

impl CallbackArgDisplay for [PlayerId] {
    fn callback_arg_display(&self, ctx: Option<&FmtCtx<'_>>) -> String {
        if let Some(ctx) = ctx {
            let items: Vec<String> = self.iter().map(|p| ctx.player(*p)).collect();
            format!("[{}]", items.join(", "))
        } else {
            self.len().to_string()
        }
    }
}

impl CallbackArgDisplay for [(CardId, i32)] {
    fn callback_arg_display(&self, ctx: Option<&FmtCtx<'_>>) -> String {
        if let Some(ctx) = ctx {
            let items: Vec<String> = self
                .iter()
                .map(|(card, power)| format!("{}={power}", ctx.card(*card)))
                .collect();
            format!("[{}]", items.join(", "))
        } else {
            self.len().to_string()
        }
    }
}

macro_rules! impl_slice_len {
    ($($ty:ty),*) => {
        $(impl CallbackArgDisplay for [$ty] {
            fn callback_arg_display(&self, _ctx: Option<&FmtCtx<'_>>) -> String { self.len().to_string() }
        })*
    }
}
impl_slice_len!(
    PlayOption,
    DefenderId,
    String,
    u32,
    i32,
    GameEntity,
    SpellAbility,
    ManaPool,
    (CardId, usize),
    forge_engine_core::card::CounterType,
    forge_engine_core::agent::ManaAbilityOption
);

impl<T: CallbackArgDisplay> CallbackArgDisplay for Option<T> {
    fn callback_arg_display(&self, ctx: Option<&FmtCtx<'_>>) -> String {
        match self {
            Some(v) => v.callback_arg_display(ctx),
            None => "None".to_string(),
        }
    }
}

// Primitives
impl CallbackArgDisplay for bool {
    fn callback_arg_display(&self, _ctx: Option<&FmtCtx<'_>>) -> String {
        self.to_string()
    }
}
impl CallbackArgDisplay for u32 {
    fn callback_arg_display(&self, _ctx: Option<&FmtCtx<'_>>) -> String {
        self.to_string()
    }
}
impl CallbackArgDisplay for u16 {
    fn callback_arg_display(&self, _ctx: Option<&FmtCtx<'_>>) -> String {
        self.to_string()
    }
}
impl CallbackArgDisplay for i32 {
    fn callback_arg_display(&self, _ctx: Option<&FmtCtx<'_>>) -> String {
        self.to_string()
    }
}
impl CallbackArgDisplay for usize {
    fn callback_arg_display(&self, _ctx: Option<&FmtCtx<'_>>) -> String {
        self.to_string()
    }
}
impl CallbackArgDisplay for str {
    fn callback_arg_display(&self, _ctx: Option<&FmtCtx<'_>>) -> String {
        self.to_string()
    }
}
impl CallbackArgDisplay for PlayerId {
    fn callback_arg_display(&self, ctx: Option<&FmtCtx<'_>>) -> String {
        if let Some(ctx) = ctx {
            ctx.player(*self)
        } else {
            format!("P{}", self.0)
        }
    }
}
impl CallbackArgDisplay for CardId {
    fn callback_arg_display(&self, ctx: Option<&FmtCtx<'_>>) -> String {
        if let Some(ctx) = ctx {
            ctx.card(*self)
        } else {
            format!("{:?}", self)
        }
    }
}
impl CallbackArgDisplay for ZoneType {
    fn callback_arg_display(&self, _ctx: Option<&FmtCtx<'_>>) -> String {
        format!("{:?}", self)
    }
}
impl CallbackArgDisplay for DefenderId {
    fn callback_arg_display(&self, _ctx: Option<&FmtCtx<'_>>) -> String {
        format!("{:?}", self)
    }
}
impl CallbackArgDisplay for BinaryChoiceKind {
    fn callback_arg_display(&self, _ctx: Option<&FmtCtx<'_>>) -> String {
        format!("{:?}", self)
    }
}
impl CallbackArgDisplay for ApiType {
    fn callback_arg_display(&self, _ctx: Option<&FmtCtx<'_>>) -> String {
        format!("{:?}", self)
    }
}

impl CallbackArgDisplay for GameState {
    fn callback_arg_display(&self, _ctx: Option<&FmtCtx<'_>>) -> String {
        "_".to_string()
    }
}
impl CallbackArgDisplay for SpellAbility {
    fn callback_arg_display(&self, _ctx: Option<&FmtCtx<'_>>) -> String {
        "_".to_string()
    }
}
impl CallbackArgDisplay for ManaPool {
    fn callback_arg_display(&self, _ctx: Option<&FmtCtx<'_>>) -> String {
        "_".to_string()
    }
}
impl CallbackArgDisplay for ManaCost {
    fn callback_arg_display(&self, _ctx: Option<&FmtCtx<'_>>) -> String {
        "_".to_string()
    }
}
