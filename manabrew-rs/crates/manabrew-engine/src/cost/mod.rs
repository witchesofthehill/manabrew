pub mod cost_add_mana;
pub mod cost_adjustment;
pub mod cost_behold;
pub mod cost_behold_exile;
pub mod cost_blight;
pub mod cost_choose_color;
pub mod cost_choose_creature_type;
pub mod cost_collect_evidence;
pub mod cost_damage;
pub mod cost_discard;
pub mod cost_draw;
pub mod cost_enlist;
pub mod cost_exert;
pub mod cost_exile;
pub mod cost_exile_ctrl_or_grave;
pub mod cost_exile_from_stack;
pub mod cost_exiled_move_to_grave;
pub mod cost_flip_coin;
pub mod cost_forage;
pub mod cost_gain_control;
pub mod cost_gain_life;
pub mod cost_mill;
mod cost_parser;
pub mod cost_part;
pub mod cost_part_mana;
pub mod cost_part_with_list;
pub mod cost_part_with_trigger;
pub mod cost_pay_energy;
pub mod cost_pay_life;
pub mod cost_pay_shards;
pub mod cost_payment;
pub mod cost_promise_gift;
pub mod cost_put_card_to_lib;
pub mod cost_put_counter;
pub mod cost_remove_any_counter;
pub mod cost_remove_counter;
pub mod cost_return;
pub mod cost_reveal;
pub mod cost_reveal_chosen;
pub mod cost_roll_dice;
pub mod cost_sacrifice;
pub mod cost_sub_counter;
pub mod cost_tap;
pub mod cost_tap_type;
pub mod cost_unattach;
pub mod cost_untap;
pub mod cost_untap_type;
pub mod cost_waterbend;
pub mod individual_cost_payment_instance;
pub mod payment_decision;
pub mod selector_domain;
pub mod trait_cost_decision_maker;
pub mod trait_cost_visitor;

use forge_foundation::{ManaCost, ZoneType};
use serde::{Deserialize, Serialize};

use crate::ability::effects::matches_change_type;
use crate::card::{Card, CounterType};
use crate::game::GameState;
use crate::ids::{CardId, PlayerId};
use crate::mana::ManaPool;
use crate::parsing::CostTokenKind;
use crate::spellability::SpellAbility;
use crate::staticability::static_ability_cant_sacrifice::cant_sacrifice;

/// Sentinel passed through [`resolve_dynamic_amount`] for the legacy `X`
/// pathway. Kept for the few outer-API consumers (`GameLoop::pay_life_cost`,
/// `AmountSpec::X.resolve`) that still receive an `i32`. New code should use
/// `AmountSpec::X` directly.
pub(crate) const DYNAMIC_X_SENTINEL: i32 = i32::MIN;

pub fn resolve_dynamic_amount(
    game: &GameState,
    source: CardId,
    player: PlayerId,
    amount: i32,
) -> i32 {
    if amount != DYNAMIC_X_SENTINEL {
        return amount;
    }
    let source_card = game.card(source);

    if let Some(paid_x) = source_card
        .svars
        .get("XPaid")
        .and_then(|s| s.parse::<i32>().ok())
    {
        return paid_x;
    }

    if let Some(x_expr) = source_card.get_s_var("X") {
        if x_expr == "Count$xPaid" || x_expr == "Count$XPaid" {
            return source_card
                .svars
                .get("XPaid")
                .and_then(|s| s.parse::<i32>().ok())
                .unwrap_or(0);
        }
        if let Ok(n) = x_expr.parse::<i32>() {
            return n;
        }
        if x_expr.starts_with("Count$") {
            return crate::ability::effects::resolve_count_svar(x_expr, game, source, player);
        }
    }

    0
}

/// The amount slot of a [`CostPart`]. Replaces the legacy `i32` (with
/// `DYNAMIC_X_SENTINEL`) once consumers are migrated. Mirrors Java's
/// `CostPart.convertAmount` + `AbilityUtils.calculateAmount` split:
/// literals resolve trivially, `X` reads `XPaid` / `SVar:X`, named SVar
/// identifiers walk the host card's SVar table at call time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AmountSpec {
    Literal(i32),
    X,
    /// SVar name on the host card (e.g. `Y` in `ExileFromHand<Y/Card.Blue>`
    /// — the only legitimate source today is the `RaiseCost` SVar walker
    /// in `cost_adjustment`). Reserved for explicit, audited parser sites.
    Svar(String),
}

impl AmountSpec {
    /// Parse a script amount token (`"3"`, `"X"`). Strips any trailing
    /// `/extra` suffix so DSL forms like `Draw<1/You>` parse as `1`. Non-int,
    /// non-X tokens fall back to `Literal(default)` — `Self::Svar` is reserved
    /// for explicit parsers that want SVar-chain resolution (only
    /// `cost_adjustment` today).
    pub fn parse_or(raw: &str, default: i32) -> Self {
        let head = raw.split('/').next().unwrap_or(raw).trim();
        if head.is_empty() {
            return Self::Literal(default);
        }
        if head.eq_ignore_ascii_case("X") {
            Self::X
        } else if let Ok(n) = head.parse::<i32>() {
            Self::Literal(n)
        } else {
            Self::Literal(default)
        }
    }

    /// Resolve to an `i32` at call time. `X` reads `XPaid`/`SVar:X` via the
    /// legacy `resolve_dynamic_amount` flow; `Svar(name)` walks the host's
    /// SVar chain to its first numeric value.
    pub fn resolve(&self, game: &GameState, source: CardId, player: PlayerId) -> i32 {
        match self {
            Self::Literal(n) => *n,
            Self::X => resolve_dynamic_amount(game, source, player, DYNAMIC_X_SENTINEL),
            Self::Svar(name) => resolve_named_svar(game, source, player, name),
        }
    }

    pub fn as_literal(&self) -> Option<i32> {
        match self {
            Self::Literal(n) => Some(*n),
            _ => None,
        }
    }

    pub fn is_x(&self) -> bool {
        matches!(self, Self::X)
    }
}

impl Default for AmountSpec {
    fn default() -> Self {
        Self::Literal(0)
    }
}

impl From<i32> for AmountSpec {
    fn from(n: i32) -> Self {
        Self::Literal(n)
    }
}

impl std::fmt::Display for AmountSpec {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Literal(n) => write!(f, "{n}"),
            Self::X => f.write_str("X"),
            Self::Svar(name) => f.write_str(name),
        }
    }
}

/// Walk a named SVar on the host card to its first numeric value.
/// Used by `AmountSpec::Svar(name).resolve()` (and, transitively, by the
/// `RaiseCost` parser once it routes through `AmountSpec`).
fn resolve_named_svar(game: &GameState, source: CardId, player: PlayerId, name: &str) -> i32 {
    let host = game.card(source);
    let mut current = name.to_string();
    for _ in 0..8 {
        let Some(raw) = host.svars.get(&current) else {
            return 0;
        };
        if let Some(rest) = raw.strip_prefix("SVar$") {
            let next = rest.split('/').next().unwrap_or("").trim();
            if next.is_empty() {
                return 0;
            }
            current = next.to_string();
            continue;
        }
        if let Some(num_str) = raw.strip_prefix("Number$") {
            return num_str.trim().parse().unwrap_or(0);
        }
        if let Ok(n) = raw.trim().parse::<i32>() {
            return n;
        }
        if raw.starts_with("Count$") {
            return crate::ability::effects::resolve_count_svar(raw, game, source, player);
        }
        return 0;
    }
    0
}

/// A single component of an ability cost.
/// Mirrors Java's CostPart hierarchy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RevealFrom {
    Hand,
    Exile,
    HandOrBattlefield,
    All,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CostPart {
    /// Tap the source permanent. {T}
    Tap,
    /// Pay mana. Mirrors Java `CostPartMana`.
    Mana {
        cost: ManaCost,
        /// Minimum value for X in the mana cost (parsed from restriction "XMin<N>").
        #[serde(default)]
        x_min: i32,
        /// When true, the base mana cost is augmented by the exiled creature's mana cost.
        #[serde(default)]
        is_exiled_creature_cost: bool,
        /// When true, the base mana cost is augmented by the enchanted creature's mana cost.
        #[serde(default)]
        is_enchanted_creature_cost: bool,
        /// When true, the base mana cost is multiplied by an SVar-determined count.
        #[serde(default)]
        is_cost_pay_any_number_of_times: bool,
        /// Maximum number of permanents that can be tapped to reduce the mana cost
        /// via the Waterbend mechanic. Mirrors Java's `CostPartMana.maxWaterbend`.
        #[serde(default)]
        max_waterbend: Option<String>,
    },
    /// Pay life. Mirrors CostPayLife.
    PayLife(AmountSpec),
    /// Sacrifice permanents. type_filter "CARDNAME" means sacrifice self.
    Sacrifice {
        amount: AmountSpec,
        type_filter: String,
    },
    /// Discard cards. type_filter "CARDNAME" means discard self.
    Discard {
        amount: AmountSpec,
        type_filter: String,
    },
    /// Remove counters from a permanent (e.g. SubCounter<1/DREAM/NICKNAME>).
    SubCounter {
        amount: AmountSpec,
        counter_type: CounterType,
        type_filter: String,
    },
    /// Add counters to the source permanent (e.g. AddCounter<1/LOYALTY>). Mirrors CostPutCounter.
    AddCounter {
        amount: AmountSpec,
        counter_type: CounterType,
    },
    /// Exile cards from a specific zone (own zone) as cost. Mirrors CostExile.
    Exile {
        amount: AmountSpec,
        type_filter: String,
        from: ZoneType,
    },
    /// Exile cards from any player's graveyard as cost (ExileAnyGrave). Mirrors CostExile zoneMode=-1.
    ExileFromAnyGrave {
        amount: AmountSpec,
        type_filter: String,
    },
    /// Exile cards from the same graveyard as cost (ExileSameGrave). Mirrors CostExile zoneMode=0.
    ExileFromSameGrave {
        amount: AmountSpec,
        type_filter: String,
    },
    /// Return permanents to owner's hand as cost. Mirrors CostReturn.
    Return {
        amount: AmountSpec,
        type_filter: String,
    },
    /// Tap other permanents of a type as cost (tapXType<n/filter>). Mirrors CostTapType.
    /// When `min_total_power` is Some(N), tap any number of creatures whose total power >= N
    /// (used by Crew). When None, tap exactly `amount` matching permanents.
    TapType {
        amount: AmountSpec,
        type_filter: String,
        min_total_power: Option<i32>,
    },
    /// Untap permanents as cost. Mirrors CostUntap.
    Untap,
    /// Untap other permanents of a type as cost (untapYType<n/filter>). Mirrors CostUntapType.
    UntapType {
        amount: AmountSpec,
        type_filter: String,
        can_untap_source: bool,
    },
    /// Pay energy counters. Mirrors CostPayEnergy.
    PayEnergy(AmountSpec),
    /// Pay shard counters. Mirrors CostPayShards.
    PayShards(AmountSpec),
    /// Deal damage to the source's controller as cost. Mirrors CostDamage.
    DamageYou(AmountSpec),
    /// Draw cards as cost. Mirrors CostDraw.
    Draw(AmountSpec),
    /// Mill cards as cost. Mirrors CostMill.
    Mill(AmountSpec),
    /// Reveal cards as cost. Mirrors CostReveal.
    Reveal {
        amount: AmountSpec,
        type_filter: String,
        from: RevealFrom,
    },
    /// Exert permanent(s) as cost. Mirrors CostExert.
    Exert {
        amount: AmountSpec,
        type_filter: String,
    },
    /// Opponent gains life as cost. Mirrors CostGainLife.
    GainLife(AmountSpec),
    /// Gain control of permanents matching type_filter as cost. Mirrors CostGainControl.
    GainControl {
        amount: AmountSpec,
        type_filter: String,
    },
    /// Remove any counter type from permanents matching type_filter. Mirrors CostRemoveAnyCounter.
    /// `counter_type` is None means any counter type.
    RemoveAnyCounter {
        amount: AmountSpec,
        type_filter: String,
        counter_type: Option<CounterType>,
    },
    /// Unattach equipment as a cost. Mirrors CostUnattach.
    /// `type_filter` can be "CARDNAME" (source is the equipment), "OriginalHost",
    /// or a card filter expression (source is the equipped creature, filter matches equipment).
    Unattach {
        type_filter: String,
        description: Option<String>,
    },
    /// Move cards from exile to graveyard as cost. Mirrors CostExiledMoveToGrave.
    ExiledMoveToGrave {
        amount: AmountSpec,
        type_filter: String,
    },
    /// Add mana to the pool as a cost (AddMana<amount/type>). Mirrors CostAddMana.
    /// Always payable. Payment adds the specified mana to the activating player's pool.
    AddMana {
        amount: AmountSpec,
        mana_type: String,
    },
    /// Waterbend cost (Waterbend<N>). Mirrors CostWaterbend.
    /// Pay N generic mana, but you can tap your artifacts and creatures to help (each tapped = {1}).
    Waterbend { amount: AmountSpec },
    /// Choose one or more colors as a cost. Mirrors CostChooseColor.
    ChooseColor(AmountSpec),
    /// Choose a creature type as a cost. Mirrors CostChooseCreatureType.
    ChooseCreatureType(AmountSpec),
    /// Flip one or more coins as a cost. Mirrors CostFlipCoin.
    FlipCoin(AmountSpec),
    /// Roll dice as a cost. Mirrors CostRollDice.
    RollDice {
        amount: AmountSpec,
        sides: i32,
        result_svar: String,
    },
    /// Exile spells from stack as a cost. Mirrors CostExileFromStack.
    ExileFromStack {
        amount: AmountSpec,
        type_filter: String,
    },
    /// Collect evidence N (exile cards from your graveyard with total MV >= N).
    CollectEvidence(AmountSpec),
    /// Forage: exile 3 from your graveyard or sacrifice a Food.
    Forage,
    /// Put card(s) to library from a zone as a cost. Mirrors CostPutCardToLib.
    PutCardToLib {
        amount: AmountSpec,
        lib_pos: i32,
        type_filter: String,
        from: ZoneType,
        same_zone: bool,
    },
    /// Enlist another creature as a cost. Mirrors CostEnlist.
    Enlist {
        amount: AmountSpec,
        type_filter: String,
    },
    /// Promise gift to an opponent as a cost. Mirrors CostPromiseGift.
    PromiseGift,
    /// Reveal previously chosen player/type as a cost. Mirrors CostRevealChosen.
    RevealChosen { reveal_type: String },
    /// Behold (reveal from hand/battlefield), optionally exile revealed cards.
    Behold {
        amount: AmountSpec,
        type_filter: String,
        exile: bool,
    },
    /// Blight N = put N -1/-1 counters on creature(s) you control.
    Blight(AmountSpec),
    /// Exile from battlefield or graveyard as a combined cost (craft).
    ExileCtrlOrGrave {
        amount: AmountSpec,
        type_filter: String,
    },
}

impl CostPart {
    /// Payment ordering — mirrors Java's CostPart.paymentOrder.
    /// Lower numbers are paid first.
    fn payment_order(&self) -> i32 {
        match self {
            CostPart::Tap => -1,
            CostPart::Untap => 20,
            CostPart::Mana {
                is_exiled_creature_cost,
                ..
            } => {
                if *is_exiled_creature_cost {
                    200
                } else {
                    0
                }
            }
            CostPart::PayEnergy(_) => 7,
            CostPart::PayShards(_) => 7,
            CostPart::SubCounter { .. } => 8,
            CostPart::AddCounter { .. } => 6,
            CostPart::PayLife(_) => 7,
            CostPart::DamageYou(_) => 8,
            CostPart::GainLife(_) => 5,
            CostPart::Reveal { from, .. } => match from {
                RevealFrom::Hand => 5,
                RevealFrom::HandOrBattlefield => 5,
                _ => -1,
            },
            CostPart::Draw(_) => 20,
            CostPart::Mill(_) => 20,
            CostPart::Discard { .. } => 10,
            CostPart::Sacrifice { .. } => 15,
            CostPart::Exile { from, .. } => {
                if *from == ZoneType::Library {
                    20
                } else {
                    15
                }
            }
            CostPart::ExileFromAnyGrave { .. } => 15,
            CostPart::ExileFromSameGrave { .. } => 15,
            CostPart::Return { .. } => 10,
            CostPart::TapType { .. } => 18,
            CostPart::UntapType { .. } => 18,
            CostPart::GainControl { .. } => 8,
            CostPart::RemoveAnyCounter { .. } => 8,
            CostPart::Unattach { .. } => 5,
            CostPart::ExiledMoveToGrave { .. } => 15,
            CostPart::AddMana { .. } => 5,
            CostPart::Waterbend { .. } => 0,
            CostPart::Exert { .. } => 5,
            CostPart::ChooseColor(_) => 8,
            CostPart::ChooseCreatureType(_) => 5,
            CostPart::FlipCoin(_) => 22,
            CostPart::RollDice { .. } => 5,
            CostPart::ExileFromStack { .. } => 15,
            CostPart::CollectEvidence(_) => 15,
            CostPart::Forage => 5,
            CostPart::PutCardToLib { .. } => 10,
            CostPart::Enlist { .. } => 5,
            CostPart::PromiseGift => -1,
            CostPart::RevealChosen { .. } => 20,
            CostPart::Behold { .. } => 5,
            CostPart::Blight(_) => 6,
            CostPart::ExileCtrlOrGrave { .. } => 15,
        }
    }
}

/// The complete cost to activate an ability.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cost {
    pub parts: Vec<CostPart>,
    pub has_tap: bool,
    pub mandatory: bool,
}

impl Cost {
    pub fn has_tap_cost(&self) -> bool {
        self.has_tap
    }

    pub fn has_no_mana_cost(&self) -> bool {
        !self
            .parts
            .iter()
            .any(|p| matches!(p, CostPart::Mana { .. }))
    }

    pub fn has_mana_cost(&self) -> bool {
        !self.has_no_mana_cost()
    }

    pub fn has_specific_cost_type(&self, probe: &CostPart) -> bool {
        let tag = std::mem::discriminant(probe);
        self.parts.iter().any(|p| std::mem::discriminant(p) == tag)
    }

    pub fn has_only_specific_cost_type(&self, probe: &CostPart) -> bool {
        let tag = std::mem::discriminant(probe);
        self.parts.iter().all(|p| std::mem::discriminant(p) == tag)
    }

    pub fn sort(&mut self) {
        self.parts.sort_by_key(|p| p.payment_order());
    }

    pub fn copy(&self) -> Self {
        self.clone()
    }

    pub fn copy_with_no_mana(&self) -> Self {
        let mut out = self.clone();
        out.parts.retain(|p| !matches!(p, CostPart::Mana { .. }));
        out
    }

    pub fn copy_with_defined_mana(&self, mana_cost: ManaCost) -> Self {
        let mut out = self.clone();
        out.parts.retain(|p| !matches!(p, CostPart::Mana { .. }));
        out.parts.push(CostPart::Mana {
            cost: mana_cost,
            x_min: 0,
            is_exiled_creature_cost: false,
            is_enchanted_creature_cost: false,
            is_cost_pay_any_number_of_times: false,
            max_waterbend: None,
        });
        out.sort();
        out
    }

    pub fn refund_paid_cost(&self, game: &mut GameState, source: CardId, player: PlayerId) {
        for part in self.parts.iter().rev() {
            crate::cost::cost_part::refund(game, source, player, part);
        }
    }

    pub fn to_string_alt(&self) -> String {
        to_simple_string(self)
    }

    pub fn to_simple_string(&self) -> String {
        to_simple_string(self)
    }

    pub fn is_zero_cost(&self) -> bool {
        self.parts.is_empty()
            || (self.parts.len() == 1
                && matches!(&self.parts[0], CostPart::Mana { cost: mana, .. } if mana.is_zero()))
    }
}

pub fn convert_amount_type_to_words(amount: i32, amount_expr: &str, noun: &str) -> String {
    if amount_expr == "X" {
        format!("X {}", noun)
    } else if amount == 1 {
        format!("a {}", noun)
    } else {
        format!("{} {}s", amount, noun)
    }
}

pub fn convert_int_and_type_to_words(amount: i32, noun: &str) -> String {
    convert_amount_type_to_words(amount, &amount.to_string(), noun)
}

pub fn merge_to(dst: &mut Cost, src: &Cost) {
    dst.parts.extend(src.parts.clone());
    dst.has_tap = dst.has_tap || src.has_tap;
    dst.mandatory = dst.mandatory || src.mandatory;
    dst.sort();
}

pub fn add(cost: &mut Cost, part: CostPart) {
    cost.has_tap = cost.has_tap || matches!(part, CostPart::Tap);
    cost.parts.push(part);
    cost.sort();
}

pub fn apply_text_change_effects(cost: &mut Cost, game: &GameState, host: CardId) {
    for part in &mut cost.parts {
        crate::cost::cost_part::apply_text_change_effects(part, game, host);
    }
}

pub fn has_x_in_any_cost_part(cost: &Cost) -> bool {
    cost.parts.iter().any(|p| match p {
        CostPart::Mana { cost, .. } => cost.count_x() > 0,
        _ => cost_part::convert_amount(p).is_some_and(AmountSpec::is_x),
    })
}

pub fn get_max_for_non_mana_x(
    cost: &Cost,
    game: &GameState,
    ability: &SpellAbility,
    payer: PlayerId,
    effect: bool,
) -> Option<i32> {
    let mut val: Option<i32> = None;
    for p in &cost.parts {
        if !cost_part::convert_amount(p).is_some_and(AmountSpec::is_x) {
            continue;
        }
        let part_max = cost_part::get_max_amount_x(game, ability, payer, p, effect);
        val = match (val, part_max) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        };
    }
    if let Some(v) = val {
        if v <= 0
            && cost.has_mana_cost()
            && cost.parts.iter().any(|p| cost_part_mana::get_x_min(p) > 0)
        {
            return None;
        }
    }
    val
}

pub fn to_simple_string(cost: &Cost) -> String {
    let mut out = Vec::new();
    for part in &cost.parts {
        match part {
            CostPart::Tap => out.push("{T}".to_string()),
            CostPart::Untap => out.push("{Q}".to_string()),
            CostPart::Mana { cost, .. } => out.push(format!("{}", cost)),
            CostPart::PayLife(v) => out.push(format!("Pay {} life", v)),
            _ => out.push(format!("{:?}", part)),
        }
    }
    out.join(", ")
}

/// Cost rendered for a player-facing prompt. Life uses the `{LIFE}` token so the
/// UI can draw a heart; mana keeps its `{...}` symbols.
pub fn to_prompt_string(cost: &Cost) -> String {
    let mut out = Vec::new();
    for part in &cost.parts {
        match part {
            CostPart::Tap => out.push("{T}".to_string()),
            CostPart::Untap => out.push("{Q}".to_string()),
            CostPart::Mana { cost, .. } => out.push(format!("{}", cost)),
            CostPart::PayLife(v) => out.push(format!("{} {{LIFE}}", v)),
            _ => out.push(format!("{:?}", part)),
        }
    }
    out.join(", ")
}

/// Parse a Cost$ value from the DSL.
///
/// Examples:
/// - `"T"` → tap
/// - `"1 G"` → mana cost {1}{G}
/// - `"T 1 G"` → tap + mana
/// - `"Sac<1/CARDNAME>"` → sacrifice self
/// - `"PayLife<3>"` → pay 3 life
/// - `"Exile<1/Creature>"` → exile a creature from battlefield
/// - `"ExileFromHand<1/Card>"` → exile from hand
/// - `"Return<1/CARDNAME>"` → return self to hand
/// - `"tapXType<1/Creature>"` → tap a creature
/// - `"AddCounter<1/LOYALTY>"` → add a loyalty counter
/// - `"SubCounter<1/LOYALTY/CARDNAME>"` → remove loyalty counter
pub fn parse_cost(raw: &str) -> Cost {
    let tokens = split_cost_tokens(raw);
    let mut parts = Vec::new();
    let mut has_tap = false;
    let mut mandatory = false;
    let mut mana_tokens: Vec<&str> = Vec::new();

    // Pre-scan for untap cost (Q/Untap), mirroring Java's pre-scan for hasUntapInPrice.
    let has_untap = tokens.iter().any(|token| {
        CostTokenKind::parse(token).is_some_and(|parsed| parsed.kind == CostTokenKind::Untap)
    });

    for token in &tokens {
        match cost_parser::parse_cost_token(token) {
            cost_parser::TokenResult::Part(part) => parts.push(part),
            cost_parser::TokenResult::Tap => {
                parts.push(CostPart::Tap);
                has_tap = true;
            }
            cost_parser::TokenResult::Mandatory => {
                mandatory = true;
            }
            cost_parser::TokenResult::Mana => {
                mana_tokens.push(token);
            }
        }
    }

    // Post-process: set can_untap_source on UntapType parts.
    // Mirrors Java: canUntapSource = !hasUntapInPrice
    for part in &mut parts {
        if let CostPart::UntapType {
            can_untap_source, ..
        } = part
        {
            *can_untap_source = !has_untap;
        }
    }

    // If we have mana tokens, combine them into a ManaCost
    if !mana_tokens.is_empty() {
        let mana_str = mana_tokens.join(" ");
        let mana_cost = ManaCost::parse(&mana_str);
        if mana_cost.cmc() > 0 || !mana_str.is_empty() {
            parts.push(CostPart::Mana {
                cost: mana_cost,
                x_min: 0,
                is_exiled_creature_cost: false,
                is_enchanted_creature_cost: false,
                is_cost_pay_any_number_of_times: false,
                max_waterbend: None,
            });
        }
    }

    // Sort by payment order
    parts.sort_by_key(|p| p.payment_order());

    Cost {
        parts,
        has_tap,
        mandatory,
    }
}

/// Parse `"amount/filter"` inner content, returning (amount, filter).
/// If there's no slash, defaults to amount=1 and filter=inner.
pub(super) fn parse_amount_filter(inner: &str) -> (AmountSpec, String) {
    if let Some(slash_idx) = inner.find('/') {
        let amt = AmountSpec::parse_or(&inner[..slash_idx], 1);
        let rest = &inner[slash_idx + 1..];
        let filter = if let Some(desc_idx) = rest.find('/') {
            rest[..desc_idx].to_string()
        } else {
            rest.to_string()
        };
        (amt, filter)
    } else {
        (AmountSpec::Literal(1), inner.to_string())
    }
}

pub(super) fn parse_amount_filter_dynamic(inner: &str) -> (AmountSpec, String) {
    if let Some(slash_idx) = inner.find('/') {
        let amt = AmountSpec::parse_or(&inner[..slash_idx], 1);
        let rest = &inner[slash_idx + 1..];
        let filter = if let Some(desc_idx) = rest.find('/') {
            rest[..desc_idx].to_string()
        } else {
            rest.to_string()
        };
        (amt, filter)
    } else {
        (AmountSpec::parse_or(inner, 1), inner.to_string())
    }
}

/// Split cost string on spaces, keeping `<...>` groups together.
fn split_cost_tokens(raw: &str) -> Vec<&str> {
    let mut tokens = Vec::new();
    let mut start = 0;
    let mut depth = 0;
    let bytes = raw.as_bytes();

    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'<' => depth += 1,
            b'>' => {
                if depth > 0 {
                    depth -= 1;
                }
            }
            b' ' if depth == 0 => {
                let token = raw[start..i].trim();
                if !token.is_empty() {
                    tokens.push(token);
                }
                start = i + 1;
            }
            _ => {
                // This is a character-parsing loop, not a semantic dispatch
                // No warning needed here — we're just walking through characters
            }
        }
        i += 1;
    }
    // Last token
    let token = raw[start..].trim();
    if !token.is_empty() {
        tokens.push(token);
    }
    tokens
}

/// Check if a card matches a type filter string.
/// Thin wrapper around `matches_change_type` for use by individual cost modules.
pub fn matches_type_filter(game: &GameState, cid: CardId, type_filter: &str) -> bool {
    matches_change_type(game.card(cid), type_filter, &[])
}

/// Find valid sacrifice targets on the battlefield for a player, filtered by type.
/// Mirrors Java's `CostSacrifice.getMaxAmountX()` + `CardLists.getValidCards()`.
pub fn get_sacrifice_targets(game: &GameState, player: PlayerId, type_filter: &str) -> Vec<CardId> {
    game.cards_in_zone(ZoneType::Battlefield, player)
        .to_vec()
        .into_iter()
        .filter(|&cid| matches_change_type(game.card(cid), type_filter, &[]))
        .collect()
}

/// Find cards that can have counters removed for `SubCounter<.../Type/...>`.
pub fn get_sub_counter_targets(
    game: &GameState,
    player: PlayerId,
    source: CardId,
    type_filter: &str,
) -> Vec<CardId> {
    if type_filter.eq_ignore_ascii_case("OriginalHost") {
        return Vec::new();
    }
    let source_card = game.card(source);
    game.cards_in_zone(ZoneType::Battlefield, player)
        .to_vec()
        .into_iter()
        .filter(|&cid| {
            if type_filter == "Card" || type_filter.is_empty() {
                return true;
            }
            let selector = crate::parsing::cached_compiled_selector(type_filter);
            crate::card::valid_filter::matches_valid_card_selector_in_game(
                &selector,
                game.card(cid),
                source_card,
                game,
            )
        })
        .collect()
}

/// Find valid sacrifice targets for a cost, filtered both by type and
/// CantSacrifice-style legality before RNG selection.
pub fn get_sacrifice_targets_for_cost(
    game: &GameState,
    player: PlayerId,
    type_filter: &str,
    ability: Option<&SpellAbility>,
) -> Vec<CardId> {
    let static_sources = static_ability_source_cards(game);
    get_sacrifice_targets(game, player, type_filter)
        .into_iter()
        .filter(|&cid| !cant_sacrifice(&static_sources, game.card(cid), ability, true))
        .collect()
}

/// Find valid exile/return targets in a given zone for a player, filtered by type.
pub fn get_zone_targets(
    game: &GameState,
    player: PlayerId,
    zone: ZoneType,
    type_filter: &str,
) -> Vec<CardId> {
    game.cards_in_zone(zone, player)
        .to_vec()
        .into_iter()
        .filter(|&cid| {
            if type_filter == "Card" || type_filter.is_empty() {
                true
            } else {
                matches_change_type(game.card(cid), type_filter, &[])
            }
        })
        .collect()
}

/// Find cards in exile across all players matching a type filter.
/// Used by ExiledMoveToGrave and can_pay checks.
pub fn get_exiled_targets(game: &GameState, type_filter: &str) -> Vec<CardId> {
    game.players
        .iter()
        .flat_map(|p| game.cards_in_zone(ZoneType::Exile, p.id).to_vec())
        .filter(|&cid| {
            type_filter == "Card"
                || type_filter.is_empty()
                || matches_change_type(game.card(cid), type_filter, &[])
        })
        .collect()
}

/// Find valid tap-type targets (untapped permanents matching filter, excluding source).
pub fn get_tap_type_targets(
    game: &GameState,
    player: PlayerId,
    type_filter: &str,
    exclude: CardId,
) -> Vec<CardId> {
    game.cards_in_zone(ZoneType::Battlefield, player)
        .to_vec()
        .into_iter()
        .filter(|&cid| {
            if cid == exclude {
                return false;
            }
            let card = game.card(cid);
            if card.tapped {
                return false;
            }
            if type_filter == "Card" || type_filter.is_empty() {
                true
            } else {
                matches_change_type(card, type_filter, &[])
            }
        })
        .collect()
}

/// Find cards available to enlist: untapped, non-attacking, non-summoning-sick creatures you control.
pub fn get_enlist_targets(game: &GameState, player: PlayerId) -> Vec<CardId> {
    game.cards_in_zone(ZoneType::Battlefield, player)
        .to_vec()
        .into_iter()
        .filter(|&cid| {
            let c = game.card(cid);
            // Mirror Java CostEnlist.getCardsForEnlisting():
            // c.canTap() && !c.isSick() && !c.isAttacking()
            // where isSick() is false for creatures with haste.
            c.is_creature()
                && !c.tapped
                && !c.phased_out
                && (!c.summoning_sick || c.has_haste())
                && c.attacking_player.is_none()
        })
        .collect()
}

pub fn matches_exile_from_stack_filter(
    game: &GameState,
    card_id: CardId,
    source: CardId,
    _player: PlayerId,
    type_filter: &str,
) -> bool {
    if type_filter == "All" || type_filter.is_empty() {
        return true;
    }
    let card = game.card(card_id);
    let source_card = game.card(source);
    for clause in type_filter.split(';') {
        let clause = clause.trim();
        if clause.is_empty() {
            continue;
        }
        let normalized = normalize_stack_clause_for_valid_cards(clause);
        let selector = crate::parsing::cached_compiled_selector(&normalized);
        if crate::card::valid_filter::matches_valid_card_selector_in_game(
            &selector,
            card,
            source_card,
            game,
        ) {
            return true;
        }
    }
    false
}

fn is_valid_cards_type_token(token: &str) -> bool {
    matches!(
        token,
        "Card"
            | "Permanent"
            | "Creature"
            | "Land"
            | "Artifact"
            | "Enchantment"
            | "Planeswalker"
            | "Instant"
            | "Sorcery"
            | "Plains"
            | "Island"
            | "Swamp"
            | "Mountain"
            | "Forest"
    )
}

fn normalize_stack_clause_for_valid_cards(clause: &str) -> String {
    let mut tokens: Vec<&str> = clause
        .split(['.', '+'])
        .map(str::trim)
        .filter(|s| !s.is_empty() && !s.eq_ignore_ascii_case("Spell"))
        .collect();

    if tokens.is_empty() {
        return "Card".to_string();
    }

    let type_idx = tokens
        .iter()
        .position(|t| is_valid_cards_type_token(t))
        .unwrap_or(usize::MAX);

    if type_idx == usize::MAX {
        let mut out = String::from("Card");
        for t in tokens.drain(..) {
            out.push('.');
            out.push_str(t);
        }
        return out;
    }

    let type_part = tokens[type_idx].to_string();
    let mut qualifiers: Vec<&str> = Vec::with_capacity(tokens.len().saturating_sub(1));
    qualifiers.extend(tokens[..type_idx].iter().copied());
    qualifiers.extend(tokens[type_idx + 1..].iter().copied());

    if qualifiers.is_empty() {
        type_part
    } else {
        format!("{}.{}", type_part, qualifiers.join("."))
    }
}

pub fn strip_exile_type_modifiers(type_filter: &str) -> String {
    let mut t = type_filter.to_string();
    if t.contains("FromTopGrave") {
        t = t.replace("FromTopGrave", "");
    }
    if let Some((left, _)) = t.split_once("+withTotalCMCEQ") {
        t = left.to_string();
    }
    if let Some((left, _)) = t.split_once("+withTotalCMCGE") {
        t = left.to_string();
    }
    if t.contains("+withSharedCardType") {
        t = t.replace("+withSharedCardType", "");
    }
    if let Some((left, _)) = t.split_once("+withTypesGE") {
        t = left.to_string();
    }
    t
}

pub fn normalize_exile_base_filter(type_filter: &str) -> String {
    let t = strip_exile_type_modifiers(type_filter);
    if t.is_empty() || t.eq_ignore_ascii_case("All") || t.contains('X') {
        "Card".to_string()
    } else {
        t
    }
}

pub(crate) fn parse_exile_total_cmc_eq(type_filter: &str) -> Option<&str> {
    type_filter
        .split_once("+withTotalCMCEQ")
        .map(|(_, rhs)| rhs.trim())
}

pub(crate) fn parse_exile_total_cmc_ge(type_filter: &str) -> Option<&str> {
    type_filter
        .split_once("+withTotalCMCGE")
        .map(|(_, rhs)| rhs.trim())
}

pub(crate) fn parse_exile_types_ge(type_filter: &str) -> Option<i32> {
    type_filter
        .split_once("+withTypesGE")
        .and_then(|(_, rhs)| rhs.trim().parse::<i32>().ok())
}

pub(crate) fn exile_requires_shared_card_type(type_filter: &str) -> bool {
    type_filter.contains("+withSharedCardType")
}

pub(crate) fn reveal_candidates(
    game: &GameState,
    player: PlayerId,
    source: CardId,
    type_filter: &str,
    from: &RevealFrom,
) -> Vec<CardId> {
    let mut cards: Vec<CardId> = match from {
        RevealFrom::Hand => game.cards_in_zone(ZoneType::Hand, player).to_vec(),
        RevealFrom::Exile => game.cards_in_zone(ZoneType::Exile, player).to_vec(),
        RevealFrom::HandOrBattlefield => {
            let mut v = game.cards_in_zone(ZoneType::Hand, player).to_vec();
            v.extend(
                game.cards_in_zone(ZoneType::Battlefield, player)
                    .iter()
                    .copied(),
            );
            v
        }
        RevealFrom::All => {
            let mut v = game.cards_in_zone(ZoneType::Hand, player).to_vec();
            v.extend(
                game.cards_in_zone(ZoneType::Battlefield, player)
                    .iter()
                    .copied(),
            );
            v.extend(
                game.cards_in_zone(ZoneType::Graveyard, player)
                    .iter()
                    .copied(),
            );
            v.extend(
                game.cards_in_zone(ZoneType::Library, player)
                    .iter()
                    .copied(),
            );
            v.extend(game.cards_in_zone(ZoneType::Exile, player).iter().copied());
            v
        }
    };

    // Spell costs can't pay reveal from the source card itself while in hand.
    if matches!(
        from,
        RevealFrom::Hand | RevealFrom::HandOrBattlefield | RevealFrom::All
    ) && game.card(source).zone == ZoneType::Hand
    {
        cards.retain(|&cid| cid != source);
    }

    if type_filter == "Card" || type_filter.is_empty() || type_filter == "Hand" {
        return cards;
    }

    cards
        .into_iter()
        .filter(|&cid| matches_change_type(game.card(cid), type_filter, &[]))
        .collect()
}

/// Check if a cost can be paid by the given player for the given source card.
/// `available_mana` is the total mana available (pool + untapped sources).
pub fn can_pay(
    cost: &Cost,
    game: &GameState,
    available_mana: Option<&ManaPool>,
    source: CardId,
    player: PlayerId,
    ability: Option<&SpellAbility>,
) -> bool {
    let _perf_scope =
        crate::perf::ParamsLookupScopeGuard::enter(crate::perf::ParamsLookupScope::Cost);
    for part in &cost.parts {
        if !can_pay_part_distributed(part, game, available_mana, source, player, ability) {
            return false;
        }
    }
    true
}

/// Java parity helper: canPay(cost, ability-context).
pub fn can_pay_with_ability(
    cost: &Cost,
    game: &GameState,
    available_mana: &ManaPool,
    source: CardId,
    player: PlayerId,
    ability: Option<&SpellAbility>,
) -> bool {
    can_pay(cost, game, Some(available_mana), source, player, ability)
}

pub fn can_pay_with_ability_and_reserved(
    cost: &Cost,
    game: &GameState,
    available_mana: &ManaPool,
    source: CardId,
    player: PlayerId,
    ability: Option<&SpellAbility>,
    reserved_sacrifices: &[CardId],
) -> bool {
    for part in &cost.parts {
        match part {
            CostPart::Sacrifice {
                type_filter,
                amount,
            } => {
                if type_filter == "CARDNAME"
                    || type_filter == "NICKNAME"
                    || type_filter == "OriginalHost"
                {
                    if !cost_sacrifice::can_pay(game, available_mana, source, player, ability, part)
                    {
                        return false;
                    }
                    continue;
                }

                let mut valid = get_sacrifice_targets_for_cost(game, player, type_filter, ability);
                valid.retain(|cid| !reserved_sacrifices.contains(cid));
                if type_filter.eq_ignore_ascii_case("All") {
                    if valid.is_empty() {
                        return false;
                    }
                } else if (valid.len() as i32) < amount.resolve(game, source, player) {
                    return false;
                }
            }
            _ => {
                if !can_pay_part_distributed(
                    part,
                    game,
                    Some(available_mana),
                    source,
                    player,
                    ability,
                ) {
                    return false;
                }
            }
        }
    }
    true
}

/// Check if a cost can be paid ignoring mana requirements.
/// Used for mana ability availability checks (to avoid circular dependency).
pub fn can_pay_ignoring_mana(
    cost: &Cost,
    game: &GameState,
    source: CardId,
    player: PlayerId,
) -> bool {
    can_pay(cost, game, None, source, player, None)
}

/// Check if a cost can be paid ignoring mana requirements while preserving
/// the full spell/ability context for non-mana legality checks.
///
/// This is needed for action-space generation paths that separately validate
/// mana production (for example when some permanents are reserved to be
/// sacrificed and therefore cannot also be tapped for mana), but still need
/// `ValidCause$ Activated` / `ValidCause$ Spell` statics such as Yasharn to
/// see the real ability being paid.
pub fn can_pay_ignoring_mana_with_ability(
    cost: &Cost,
    game: &GameState,
    source: CardId,
    player: PlayerId,
    ability: &SpellAbility,
) -> bool {
    can_pay(cost, game, None, source, player, Some(ability))
}

/// Check if a cost can be paid ignoring mana requirements, for a spell.
/// Passes a minimal SpellAbility with `is_spell = true` so that CantSacrifice
/// checks (e.g. Yasharn) can properly evaluate `ValidCause$ Spell` restrictions.
pub fn can_pay_ignoring_mana_for_spell(
    cost: &Cost,
    game: &GameState,
    source: CardId,
    player: PlayerId,
) -> bool {
    let mut stub = SpellAbility::new_empty(Some(source), player);
    stub.is_spell = true;
    can_pay(cost, game, None, source, player, Some(&stub))
}

fn can_pay_part_distributed(
    part: &CostPart,
    game: &GameState,
    available_mana: Option<&ManaPool>,
    source: CardId,
    player: PlayerId,
    ability: Option<&SpellAbility>,
) -> bool {
    let empty_pool = ManaPool::new();
    let pool = available_mana.unwrap_or(&empty_pool);

    match part {
        CostPart::Tap => cost_tap::can_pay(game, pool, source, player, ability, part),
        CostPart::Untap => cost_untap::can_pay(game, pool, source, player, ability, part),
        CostPart::Mana { .. } => {
            available_mana.is_none()
                || cost_part_mana::can_pay(game, pool, source, player, ability, part)
        }
        CostPart::PayLife(_) => cost_pay_life::can_pay(game, pool, source, player, ability, part),
        CostPart::Sacrifice { .. } => {
            cost_sacrifice::can_pay(game, pool, source, player, ability, part)
        }
        CostPart::Discard { .. } => {
            cost_discard::can_pay(game, pool, source, player, ability, part)
        }
        CostPart::SubCounter { .. } => {
            cost_remove_counter::can_pay(game, pool, source, player, ability, part)
        }
        CostPart::AddCounter { .. } => {
            cost_put_counter::can_pay(game, pool, source, player, ability, part)
        }
        CostPart::Exile { .. }
        | CostPart::ExileFromAnyGrave { .. }
        | CostPart::ExileFromSameGrave { .. } => {
            cost_exile::can_pay(game, pool, source, player, ability, part)
        }
        CostPart::Return { .. } => cost_return::can_pay(game, pool, source, player, ability, part),
        CostPart::TapType { .. } => {
            cost_tap_type::can_pay(game, pool, source, player, ability, part)
        }
        CostPart::UntapType { .. } => {
            cost_untap_type::can_pay(game, pool, source, player, ability, part)
        }
        CostPart::PayEnergy(_) => {
            cost_pay_energy::can_pay(game, pool, source, player, ability, part)
        }
        CostPart::PayShards(_) => {
            cost_pay_shards::can_pay(game, pool, source, player, ability, part)
        }
        CostPart::DamageYou(_) => cost_damage::can_pay(game, pool, source, player, ability, part),
        CostPart::Draw(_) => cost_draw::can_pay(game, pool, source, player, ability, part),
        CostPart::Mill(_) => cost_mill::can_pay(game, pool, source, player, ability, part),
        CostPart::Reveal { .. } => cost_reveal::can_pay(game, pool, source, player, ability, part),
        CostPart::Exert { .. } => cost_exert::can_pay(game, pool, source, player, ability, part),
        CostPart::GainLife(_) => cost_gain_life::can_pay(game, pool, source, player, ability, part),
        CostPart::GainControl { .. } => {
            cost_gain_control::can_pay(game, pool, source, player, ability, part)
        }
        CostPart::RemoveAnyCounter { .. } => {
            cost_remove_any_counter::can_pay(game, pool, source, player, ability, part)
        }
        CostPart::Unattach { .. } => {
            cost_unattach::can_pay(game, pool, source, player, ability, part)
        }
        CostPart::ExiledMoveToGrave { .. } => {
            cost_exiled_move_to_grave::can_pay(game, pool, source, player, ability, part)
        }
        CostPart::AddMana { .. } => {
            cost_add_mana::can_pay(game, pool, source, player, ability, part)
        }
        CostPart::Waterbend { .. } => {
            cost_waterbend::can_pay(game, available_mana, source, player, part)
        }
        CostPart::ChooseColor(_) => {
            cost_choose_color::can_pay(game, pool, source, player, ability, part)
        }
        CostPart::ChooseCreatureType(_) => {
            cost_choose_creature_type::can_pay(game, pool, source, player, ability, part)
        }
        CostPart::FlipCoin(_) => cost_flip_coin::can_pay(game, pool, source, player, ability, part),
        CostPart::RollDice { .. } => {
            cost_roll_dice::can_pay(game, pool, source, player, ability, part)
        }
        CostPart::ExileFromStack { .. } => {
            cost_exile_from_stack::can_pay(game, pool, source, player, ability, part)
        }
        CostPart::CollectEvidence(_) => {
            cost_collect_evidence::can_pay(game, pool, source, player, ability, part)
        }
        CostPart::Forage => cost_forage::can_pay(game, pool, source, player, ability, part),
        CostPart::PutCardToLib { .. } => {
            cost_put_card_to_lib::can_pay(game, pool, source, player, ability, part)
        }
        CostPart::Enlist { .. } => cost_enlist::can_pay(game, pool, source, player, ability, part),
        CostPart::PromiseGift => {
            cost_promise_gift::can_pay(game, pool, source, player, ability, part)
        }
        CostPart::RevealChosen { .. } => {
            cost_reveal_chosen::can_pay(game, pool, source, player, ability, part)
        }
        CostPart::Behold { exile, .. } => {
            if *exile {
                cost_behold_exile::can_pay(game, pool, source, player, ability, part)
            } else {
                cost_behold::can_pay(game, pool, source, player, ability, part)
            }
        }
        CostPart::Blight(_) => cost_blight::can_pay(game, source, player, part),
        CostPart::ExileCtrlOrGrave { .. } => {
            cost_exile_ctrl_or_grave::can_pay(game, source, player, ability, part)
        }
    }
}
pub fn static_ability_source_cards(game: &GameState) -> Vec<Card> {
    use std::collections::HashSet;

    let mut ids: HashSet<CardId> = HashSet::new();
    for p in &game.players {
        for &zone in &[
            ZoneType::Battlefield,
            ZoneType::Graveyard,
            ZoneType::Exile,
            ZoneType::Command,
        ] {
            for &cid in game.cards_in_zone(zone, p.id) {
                ids.insert(cid);
            }
        }
    }
    for entry in game.stack.iter() {
        if let Some(cid) = entry.spell_ability.source {
            ids.insert(cid);
        }
    }

    ids.into_iter().map(|cid| game.card(cid).clone()).collect()
}

pub(crate) fn shares_creature_type(game: &GameState, a: CardId, b: CardId) -> bool {
    let ca = game.card(a);
    let cb = game.card(b);
    ca.shares_creature_type_with(cb)
}

pub(crate) fn shares_card_type(game: &GameState, a: CardId, b: CardId) -> bool {
    let ca = game.card(a);
    let cb = game.card(b);
    ca.type_line
        .core_types
        .iter()
        .any(|t| cb.type_line.core_types.contains(t))
}

pub(crate) fn cmc_can_sum_to(target: i32, values: &[i32]) -> bool {
    if target < 0 {
        return false;
    }
    let mut reachable: std::collections::BTreeSet<i32> = std::collections::BTreeSet::new();
    reachable.insert(0);
    for &v in values {
        if v < 0 {
            continue;
        }
        let mut next = reachable.clone();
        for &r in &reachable {
            let nv = r + v;
            if nv <= target {
                next.insert(nv);
            }
        }
        reachable = next;
        if reachable.contains(&target) {
            return true;
        }
    }
    reachable.contains(&target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_tap_only() {
        let cost = parse_cost("T");
        assert!(cost.has_tap);
        assert_eq!(cost.parts.len(), 1);
        assert!(matches!(cost.parts[0], CostPart::Tap));
    }

    #[test]
    fn parse_mana_only() {
        let cost = parse_cost("1 G");
        assert!(!cost.has_tap);
        assert_eq!(cost.parts.len(), 1);
        match &cost.parts[0] {
            CostPart::Mana { cost: mc, .. } => assert_eq!(mc.cmc(), 2),
            _ => panic!("expected Mana cost part"),
        }
    }

    #[test]
    fn parse_tap_and_mana() {
        let cost = parse_cost("T 1 G");
        assert!(cost.has_tap);
        assert_eq!(cost.parts.len(), 2);
        // Tap should come first (payment_order = -1)
        assert!(matches!(cost.parts[0], CostPart::Tap));
        assert!(matches!(cost.parts[1], CostPart::Mana { .. }));
    }

    #[test]
    fn parse_sacrifice() {
        let cost = parse_cost("Sac<1/CARDNAME>");
        assert_eq!(cost.parts.len(), 1);
        match &cost.parts[0] {
            CostPart::Sacrifice {
                amount,
                type_filter,
            } => {
                assert_eq!(amount.as_literal(), Some(1));
                assert_eq!(type_filter, "CARDNAME");
            }
            _ => panic!("expected Sacrifice cost part"),
        }
    }

    #[test]
    fn parse_pay_life() {
        let cost = parse_cost("PayLife<3>");
        assert_eq!(cost.parts.len(), 1);
        match &cost.parts[0] {
            CostPart::PayLife(n) => assert_eq!(n.as_literal(), Some(3)),
            _ => panic!("expected PayLife cost part"),
        }
    }

    #[test]
    fn parse_compound_cost() {
        let cost = parse_cost("T Sac<1/CARDNAME>");
        assert!(cost.has_tap);
        assert_eq!(cost.parts.len(), 2);
        // Tap first (order -1), then sacrifice (order 15)
        assert!(matches!(cost.parts[0], CostPart::Tap));
        assert!(matches!(cost.parts[1], CostPart::Sacrifice { .. }));
    }

    #[test]
    fn parse_sacrifice_creature() {
        let cost = parse_cost("B Sac<1/Creature>");
        assert_eq!(cost.parts.len(), 2);
        // Mana (order 0) before Sacrifice (order 15)
        assert!(matches!(cost.parts[0], CostPart::Mana { .. }));
        match &cost.parts[1] {
            CostPart::Sacrifice {
                amount,
                type_filter,
            } => {
                assert_eq!(amount.as_literal(), Some(1));
                assert_eq!(type_filter, "Creature");
            }
            _ => panic!("expected Sacrifice cost part"),
        }
    }

    #[test]
    fn payment_order_sorting() {
        // PayLife, Tap, Mana, Sacrifice — should sort to: Tap, Mana, PayLife, Sacrifice
        let cost = parse_cost("PayLife<2> T 1 G Sac<1/CARDNAME>");
        assert_eq!(cost.parts.len(), 4);
        assert!(matches!(cost.parts[0], CostPart::Tap));
        assert!(matches!(cost.parts[1], CostPart::Mana { .. }));
        assert!(matches!(cost.parts[2], CostPart::PayLife(_)));
        assert!(matches!(cost.parts[3], CostPart::Sacrifice { .. }));
    }

    #[test]
    fn parse_exile_from_hand() {
        let cost = parse_cost("ExileFromHand<1/Card>");
        assert_eq!(cost.parts.len(), 1);
        match &cost.parts[0] {
            CostPart::Exile {
                amount,
                type_filter,
                from,
            } => {
                assert_eq!(amount.as_literal(), Some(1));
                assert_eq!(type_filter, "Card");
                assert_eq!(*from, ZoneType::Hand);
            }
            _ => panic!("expected Exile cost part"),
        }
    }

    #[test]
    fn parse_add_counter() {
        let cost = parse_cost("AddCounter<1/LOYALTY>");
        assert_eq!(cost.parts.len(), 1);
        match &cost.parts[0] {
            CostPart::AddCounter {
                amount,
                counter_type,
            } => {
                assert_eq!(amount.as_literal(), Some(1));
                assert_eq!(*counter_type, CounterType::Loyalty);
            }
            _ => panic!("expected AddCounter cost part"),
        }
    }

    #[test]
    fn parse_return() {
        let cost = parse_cost("Return<1/CARDNAME>");
        assert_eq!(cost.parts.len(), 1);
        match &cost.parts[0] {
            CostPart::Return {
                amount,
                type_filter,
            } => {
                assert_eq!(amount.as_literal(), Some(1));
                assert_eq!(type_filter, "CARDNAME");
            }
            _ => panic!("expected Return cost part"),
        }
    }

    #[test]
    fn parse_tap_type() {
        let cost = parse_cost("tapXType<2/Creature>");
        assert_eq!(cost.parts.len(), 1);
        match &cost.parts[0] {
            CostPart::TapType {
                amount,
                type_filter,
                min_total_power,
            } => {
                assert_eq!(amount.as_literal(), Some(2));
                assert_eq!(type_filter, "Creature");
                assert_eq!(*min_total_power, None);
            }
            _ => panic!("expected TapType cost part"),
        }
    }

    #[test]
    fn parse_tap_type_with_total_power() {
        let cost = parse_cost("tapXType<Any/Creature.Other+withTotalPowerGE{3}>");
        assert_eq!(cost.parts.len(), 1);
        match &cost.parts[0] {
            CostPart::TapType {
                amount,
                type_filter,
                min_total_power,
            } => {
                assert_eq!(amount.as_literal(), Some(1)); // "Any" defaults to 1
                assert_eq!(type_filter, "Creature.Other");
                assert_eq!(*min_total_power, Some(3));
            }
            _ => panic!("expected TapType cost part"),
        }
    }

    #[test]
    fn parse_pay_energy() {
        let cost = parse_cost("PayEnergy<3>");
        assert_eq!(cost.parts.len(), 1);
        match &cost.parts[0] {
            CostPart::PayEnergy(n) => assert_eq!(n.as_literal(), Some(3)),
            _ => panic!("expected PayEnergy cost part"),
        }
    }

    #[test]
    fn parse_explicit_mana_token() {
        let cost = parse_cost("Mana<2 G>");
        assert_eq!(cost.parts.len(), 1);
        assert!(matches!(cost.parts[0], CostPart::Mana { .. }));
    }

    #[test]
    fn parse_collect_evidence() {
        let cost = parse_cost("CollectEvidence<6>");
        assert_eq!(cost.parts.len(), 1);
        assert!(
            matches!(&cost.parts[0], CostPart::CollectEvidence(n) if n.as_literal() == Some(6))
        );
    }

    #[test]
    fn parse_forage() {
        let cost = parse_cost("Forage");
        assert_eq!(cost.parts.len(), 1);
        assert!(matches!(cost.parts[0], CostPart::Forage));
    }

    #[test]
    fn parse_put_card_to_lib_from_grave() {
        let cost = parse_cost("PutCardToLibFromGrave<1/0/Card>");
        assert_eq!(cost.parts.len(), 1);
        match &cost.parts[0] {
            CostPart::PutCardToLib {
                amount,
                lib_pos,
                type_filter,
                from,
                same_zone,
            } => {
                assert_eq!(amount.as_literal(), Some(1));
                assert_eq!(*lib_pos, 0);
                assert_eq!(type_filter, "Card");
                assert_eq!(*from, ZoneType::Graveyard);
                assert!(!same_zone);
            }
            _ => panic!("expected PutCardToLib cost part"),
        }
    }

    #[test]
    fn parse_exile_from_stack() {
        let cost = parse_cost("ExileFromStack<1/Spell>");
        assert_eq!(cost.parts.len(), 1);
        match &cost.parts[0] {
            CostPart::ExileFromStack {
                amount,
                type_filter,
            } => {
                assert_eq!(amount.as_literal(), Some(1));
                assert_eq!(type_filter, "Spell");
            }
            _ => panic!("expected ExileFromStack cost part"),
        }
    }

    #[test]
    fn parse_exile_ctrl_or_grave() {
        let cost = parse_cost("ExileCtrlOrGrave<2/Artifact>");
        assert_eq!(cost.parts.len(), 1);
        match &cost.parts[0] {
            CostPart::ExileCtrlOrGrave {
                amount,
                type_filter,
            } => {
                assert_eq!(amount.as_literal(), Some(2));
                assert_eq!(type_filter, "Artifact");
            }
            _ => panic!("expected ExileCtrlOrGrave cost part"),
        }
    }
}
