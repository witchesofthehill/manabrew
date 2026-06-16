//! Token-level parser for individual cost tokens.
//!
//! Extracted from the monolithic `parse_cost` if/else chain in `mod.rs`.
//! Each prefix gets its own small parse function; `parse_cost_token` dispatches.

use forge_foundation::{ManaCost, ZoneType};

use super::{AmountSpec, CostPart, RevealFrom};
use crate::ability::effects::parse_counter_type;
use crate::parsing::CostTokenKind;

/// Result of attempting to parse a single cost token.
pub(super) enum TokenResult {
    /// Successfully parsed into a CostPart.
    Part(CostPart),
    /// Token sets the tap flag.
    Tap,
    /// Token sets the mandatory flag.
    Mandatory,
    /// Token is a mana symbol (accumulate for later).
    Mana,
}

/// Parse a single cost token into a `TokenResult`.
pub(super) fn parse_cost_token(token: &str) -> TokenResult {
    let Some(parsed) = CostTokenKind::parse(token) else {
        return TokenResult::Mana;
    };

    let part = match parsed.kind {
        CostTokenKind::Tap => return TokenResult::Tap,
        CostTokenKind::Untap => CostPart::Untap,
        CostTokenKind::Mandatory => return TokenResult::Mandatory,
        CostTokenKind::Forage => CostPart::Forage,
        CostTokenKind::PromiseGift => CostPart::PromiseGift,
        CostTokenKind::Exert if parsed.inner.is_none() => CostPart::Exert {
            amount: AmountSpec::Literal(1),
            type_filter: "CARDNAME".to_string(),
        },
        kind => {
            let Some(inner) = parsed.inner else {
                return TokenResult::Mana;
            };
            let Some(part) = (match kind {
                CostTokenKind::AddCounter => parse_add_counter(inner),
                CostTokenKind::AddMana => parse_add_mana(inner),
                CostTokenKind::Behold => parse_behold(inner),
                CostTokenKind::BeholdExile => parse_behold_exile(inner),
                CostTokenKind::Blight => parse_blight(inner),
                CostTokenKind::ChooseCard => parse_choose_card(inner),
                CostTokenKind::ChooseColor => parse_choose_color(inner),
                CostTokenKind::ChooseCreatureType => parse_choose_creature_type(inner),
                CostTokenKind::CollectEvidence => parse_collect_evidence(inner),
                CostTokenKind::DamageYou => parse_damage_you(inner),
                CostTokenKind::Discard => parse_discard(inner),
                CostTokenKind::Draw => parse_draw(inner),
                CostTokenKind::Enlist => parse_enlist(inner),
                CostTokenKind::Exert => parse_exert(inner),
                CostTokenKind::Exile => parse_exile_battlefield(inner),
                CostTokenKind::ExileAnyGrave => parse_exile_any_grave(inner),
                CostTokenKind::ExileCtrlOrGrave => parse_exile_ctrl_or_grave(inner),
                CostTokenKind::ExiledMoveToGrave => parse_exiled_move_to_grave(inner),
                CostTokenKind::ExileFromGrave => parse_exile_from_grave(inner),
                CostTokenKind::ExileFromHand => parse_exile_from_hand(inner),
                CostTokenKind::ExileFromStack => parse_exile_from_stack(inner),
                CostTokenKind::ExileFromTop => parse_exile_from_top(inner),
                CostTokenKind::ExileSameGrave => parse_exile_same_grave(inner),
                CostTokenKind::FlipCoin => parse_flip_coin(inner),
                CostTokenKind::GainControl => parse_gain_control(inner),
                CostTokenKind::GainLife => parse_gain_life(inner),
                CostTokenKind::Mana => parse_mana_cost(inner),
                CostTokenKind::Mill => parse_mill(inner),
                CostTokenKind::PayEnergy => parse_pay_energy(inner),
                CostTokenKind::PayLife => parse_pay_life(inner),
                CostTokenKind::PayShards => parse_pay_shards(inner),
                CostTokenKind::PutCardToLibFromBattlefield => {
                    parse_put_card_to_lib_from_battlefield(inner)
                }
                CostTokenKind::PutCardToLibFromGrave => parse_put_card_to_lib_from_grave(inner),
                CostTokenKind::PutCardToLibFromHand => parse_put_card_to_lib_from_hand(inner),
                CostTokenKind::PutCardToLibFromSameGrave => {
                    parse_put_card_to_lib_from_same_grave(inner)
                }
                CostTokenKind::RemoveAnyCounter => parse_remove_any_counter(inner),
                CostTokenKind::Return => parse_return(inner),
                CostTokenKind::Reveal => parse_reveal(inner),
                CostTokenKind::RevealChosen => parse_reveal_chosen(inner),
                CostTokenKind::RevealFromExile => parse_reveal_from_exile(inner),
                CostTokenKind::RevealOrChoose => parse_reveal_or_choose(inner),
                CostTokenKind::RollDice => parse_roll_dice(inner),
                CostTokenKind::Sac => parse_sacrifice(inner),
                CostTokenKind::SubCounter => parse_sub_counter(inner),
                CostTokenKind::TapXType => parse_tap_type(inner),
                CostTokenKind::Unattach => parse_unattach(inner),
                CostTokenKind::UntapYType => parse_untap_type(inner),
                CostTokenKind::Waterbend => parse_waterbend(inner),
                CostTokenKind::Mandatory
                | CostTokenKind::Forage
                | CostTokenKind::PromiseGift
                | CostTokenKind::Tap
                | CostTokenKind::Untap => unreachable!(),
            }) else {
                return TokenResult::Mana;
            };
            part
        }
    };

    TokenResult::Part(part)
}

// ---------------------------------------------------------------------------
// Individual parsers
// ---------------------------------------------------------------------------

fn parse_mana_cost(inner: &str) -> Option<CostPart> {
    let split: Vec<&str> = inner.splitn(2, '\\').collect();
    let mana_text = split[0];
    let restriction = if split.len() > 1 {
        Some(split[1])
    } else {
        None
    };
    let mana_cost = ManaCost::parse(mana_text);

    let mut x_min = 0i32;
    let mut is_exiled_creature_cost = false;
    let mut is_enchanted_creature_cost = false;
    let mut is_cost_pay_any_number_of_times = false;

    if let Some(r) = restriction {
        if let Some(rest) = r.strip_prefix("XMin") {
            x_min = rest.parse::<i32>().unwrap_or(0);
        }
        is_exiled_creature_cost = r.eq_ignore_ascii_case("Exiled");
        is_enchanted_creature_cost = r.eq_ignore_ascii_case("EnchantedCost");
        is_cost_pay_any_number_of_times = r.eq_ignore_ascii_case("NumTimes");
    }

    Some(CostPart::Mana {
        cost: mana_cost,
        x_min,
        is_exiled_creature_cost,
        is_enchanted_creature_cost,
        is_cost_pay_any_number_of_times,
        max_waterbend: None,
    })
}

fn parse_sacrifice(inner: &str) -> Option<CostPart> {
    let (amount, filter) = super::parse_amount_filter(inner);
    Some(CostPart::Sacrifice {
        amount,
        type_filter: filter,
    })
}

fn parse_discard(inner: &str) -> Option<CostPart> {
    let (amount, filter) = super::parse_amount_filter(inner);
    Some(CostPart::Discard {
        amount,
        type_filter: filter,
    })
}

fn parse_pay_life(inner: &str) -> Option<CostPart> {
    let amount = AmountSpec::parse_or(inner, 0);
    Some(CostPart::PayLife(amount))
}

fn parse_sub_counter(inner: &str) -> Option<CostPart> {
    let mut it = inner.split('/');
    let amount = it
        .next()
        .map(|s| AmountSpec::parse_or(s, 1))
        .unwrap_or(AmountSpec::Literal(1));
    let counter_type_str = it.next().unwrap_or("P1P1");
    let type_filter = it.next().unwrap_or("CARDNAME").to_string();
    Some(CostPart::SubCounter {
        amount,
        counter_type: parse_counter_type(counter_type_str),
        type_filter,
    })
}

fn parse_add_counter(inner: &str) -> Option<CostPart> {
    let mut it = inner.split('/');
    let amount = it
        .next()
        .map(|s| AmountSpec::parse_or(s, 1))
        .unwrap_or(AmountSpec::Literal(1));
    let counter_type_str = it.next().unwrap_or("LOYALTY");
    Some(CostPart::AddCounter {
        amount,
        counter_type: parse_counter_type(counter_type_str),
    })
}

fn parse_pay_energy(inner: &str) -> Option<CostPart> {
    let amount = AmountSpec::parse_or(inner, 1);
    Some(CostPart::PayEnergy(amount))
}

fn parse_pay_shards(inner: &str) -> Option<CostPart> {
    let amount = AmountSpec::parse_or(inner, 1);
    Some(CostPart::PayShards(amount))
}

fn parse_choose_color(inner: &str) -> Option<CostPart> {
    let amount = AmountSpec::parse_or(inner, 1);
    Some(CostPart::ChooseColor(amount))
}

fn parse_choose_creature_type(inner: &str) -> Option<CostPart> {
    let amount = AmountSpec::parse_or(inner, 1);
    Some(CostPart::ChooseCreatureType(amount))
}

fn parse_flip_coin(inner: &str) -> Option<CostPart> {
    let amount = AmountSpec::parse_or(inner, 1);
    Some(CostPart::FlipCoin(amount))
}

fn parse_roll_dice(inner: &str) -> Option<CostPart> {
    let mut it = inner.splitn(4, '/');
    let amount = it
        .next()
        .map(|s| AmountSpec::parse_or(s, 1))
        .unwrap_or(AmountSpec::Literal(1));
    let sides = it.next().and_then(|s| s.parse::<i32>().ok()).unwrap_or(6);
    let result_svar = it.next().unwrap_or("").to_string();
    Some(CostPart::RollDice {
        amount,
        sides,
        result_svar,
    })
}

fn parse_exile_battlefield(inner: &str) -> Option<CostPart> {
    let (amount, filter) = super::parse_amount_filter(inner);
    Some(CostPart::Exile {
        amount,
        type_filter: filter,
        from: ZoneType::Battlefield,
    })
}

fn parse_exile_from_hand(inner: &str) -> Option<CostPart> {
    let (amount, filter) = super::parse_amount_filter(inner);
    Some(CostPart::Exile {
        amount,
        type_filter: filter,
        from: ZoneType::Hand,
    })
}

fn parse_exile_from_grave(inner: &str) -> Option<CostPart> {
    let (amount, filter) = super::parse_amount_filter(inner);
    Some(CostPart::Exile {
        amount,
        type_filter: filter,
        from: ZoneType::Graveyard,
    })
}

fn parse_exile_from_top(inner: &str) -> Option<CostPart> {
    let (amount, filter) = super::parse_amount_filter(inner);
    Some(CostPart::Exile {
        amount,
        type_filter: filter,
        from: ZoneType::Library,
    })
}

fn parse_exile_any_grave(inner: &str) -> Option<CostPart> {
    let (amount, filter) = super::parse_amount_filter(inner);
    Some(CostPart::ExileFromAnyGrave {
        amount,
        type_filter: filter,
    })
}

fn parse_exile_same_grave(inner: &str) -> Option<CostPart> {
    let (amount, filter) = super::parse_amount_filter_dynamic(inner);
    Some(CostPart::ExileFromSameGrave {
        amount,
        type_filter: filter,
    })
}

fn parse_exile_ctrl_or_grave(inner: &str) -> Option<CostPart> {
    let (amount, filter) = super::parse_amount_filter(inner);
    Some(CostPart::ExileCtrlOrGrave {
        amount,
        type_filter: filter,
    })
}

fn parse_exile_from_stack(inner: &str) -> Option<CostPart> {
    let (amount, filter) = super::parse_amount_filter_dynamic(inner);
    Some(CostPart::ExileFromStack {
        amount,
        type_filter: filter,
    })
}

fn parse_return(inner: &str) -> Option<CostPart> {
    let (amount, filter) = super::parse_amount_filter(inner);
    Some(CostPart::Return {
        amount,
        type_filter: filter,
    })
}

fn parse_tap_type(inner: &str) -> Option<CostPart> {
    let (amount, filter) = super::parse_amount_filter(inner);
    let (final_filter, min_total_power) = if let Some(idx) = filter.find("+withTotalPowerGE") {
        let power_str = &filter[idx + "+withTotalPowerGE".len()..];
        let power: i32 = power_str
            .trim_start_matches('{')
            .trim_end_matches('}')
            .parse()
            .unwrap_or(0);
        (filter[..idx].to_string(), Some(power))
    } else {
        (filter, None)
    };
    Some(CostPart::TapType {
        amount,
        type_filter: final_filter,
        min_total_power,
    })
}

fn parse_untap_type(inner: &str) -> Option<CostPart> {
    let (amount, filter) = super::parse_amount_filter(inner);
    Some(CostPart::UntapType {
        amount,
        type_filter: filter,
        // Default to true; post-processing in parse_cost sets the real value
        // based on whether the cost also has an Untap (Q) part.
        can_untap_source: true,
    })
}

fn parse_damage_you(inner: &str) -> Option<CostPart> {
    let amount = AmountSpec::parse_or(inner, 1);
    Some(CostPart::DamageYou(amount))
}

fn parse_draw(inner: &str) -> Option<CostPart> {
    let amount = AmountSpec::parse_or(inner, 1);
    Some(CostPart::Draw(amount))
}

fn parse_mill(inner: &str) -> Option<CostPart> {
    let amount = AmountSpec::parse_or(inner, 1);
    Some(CostPart::Mill(amount))
}

fn parse_reveal(inner: &str) -> Option<CostPart> {
    let (amount, filter) = super::parse_amount_filter(inner);
    Some(CostPart::Reveal {
        amount,
        type_filter: filter,
        from: RevealFrom::All,
    })
}

fn parse_choose_card(inner: &str) -> Option<CostPart> {
    let (amount, filter) = super::parse_amount_filter(inner);
    Some(CostPart::Reveal {
        amount,
        type_filter: filter,
        from: RevealFrom::Hand,
    })
}

fn parse_reveal_from_exile(inner: &str) -> Option<CostPart> {
    let (amount, filter) = super::parse_amount_filter(inner);
    Some(CostPart::Reveal {
        amount,
        type_filter: filter,
        from: RevealFrom::Exile,
    })
}

fn parse_reveal_or_choose(inner: &str) -> Option<CostPart> {
    let (amount, filter) = super::parse_amount_filter(inner);
    Some(CostPart::Reveal {
        amount,
        type_filter: filter,
        from: RevealFrom::HandOrBattlefield,
    })
}

fn parse_reveal_chosen(inner: &str) -> Option<CostPart> {
    let reveal_type = inner.split('/').next().unwrap_or("Player").to_string();
    Some(CostPart::RevealChosen { reveal_type })
}

fn parse_behold(inner: &str) -> Option<CostPart> {
    let (amount, filter) = super::parse_amount_filter_dynamic(inner);
    Some(CostPart::Behold {
        amount,
        type_filter: filter,
        exile: false,
    })
}

fn parse_behold_exile(inner: &str) -> Option<CostPart> {
    let (amount, filter) = super::parse_amount_filter_dynamic(inner);
    Some(CostPart::Behold {
        amount,
        type_filter: filter,
        exile: true,
    })
}

fn parse_exert(inner: &str) -> Option<CostPart> {
    let (amount, filter) = super::parse_amount_filter_dynamic(inner);
    Some(CostPart::Exert {
        amount,
        type_filter: filter,
    })
}

fn parse_gain_life(inner: &str) -> Option<CostPart> {
    let head = inner.split('/').next().unwrap_or(inner);
    Some(CostPart::GainLife(AmountSpec::parse_or(head, 1)))
}

fn parse_gain_control(inner: &str) -> Option<CostPart> {
    let (amount, filter) = super::parse_amount_filter(inner);
    Some(CostPart::GainControl {
        amount,
        type_filter: filter,
    })
}

fn parse_remove_any_counter(inner: &str) -> Option<CostPart> {
    let mut it = inner.split('/');
    let amount = it
        .next()
        .map(|s| AmountSpec::parse_or(s, 1))
        .unwrap_or(AmountSpec::Literal(1));
    let counter_str = it.next().unwrap_or("Any");
    let type_filter = it.next().unwrap_or("Permanent").to_string();
    let counter_type = if counter_str.eq_ignore_ascii_case("Any") || counter_str.is_empty() {
        None
    } else {
        Some(parse_counter_type(counter_str))
    };
    Some(CostPart::RemoveAnyCounter {
        amount,
        type_filter,
        counter_type,
    })
}

/// Parse `Unattach<Type/Description>`.
/// Java: `abCostParse(parse, 2)` splits into [type, description].
/// The constructor passes `("1", type, desc)` to `CostPartWithList`.
fn parse_unattach(inner: &str) -> Option<CostPart> {
    let (type_filter, description) = if let Some(slash_idx) = inner.find('/') {
        let tf = inner[..slash_idx].to_string();
        let desc = inner[slash_idx + 1..].to_string();
        (tf, if desc.is_empty() { None } else { Some(desc) })
    } else {
        (inner.to_string(), None)
    };
    Some(CostPart::Unattach {
        type_filter,
        description,
    })
}

fn parse_waterbend(inner: &str) -> Option<CostPart> {
    let amount = AmountSpec::parse_or(inner, 0);
    Some(CostPart::Waterbend { amount })
}

fn parse_add_mana(inner: &str) -> Option<CostPart> {
    let (amount, mana_type) = super::parse_amount_filter(inner);
    Some(CostPart::AddMana { amount, mana_type })
}

fn parse_exiled_move_to_grave(inner: &str) -> Option<CostPart> {
    let (amount, filter) = super::parse_amount_filter(inner);
    Some(CostPart::ExiledMoveToGrave {
        amount,
        type_filter: filter,
    })
}

fn parse_collect_evidence(inner: &str) -> Option<CostPart> {
    let amount = AmountSpec::parse_or(inner, 1);
    Some(CostPart::CollectEvidence(amount))
}

fn parse_put_card_to_lib_from_hand(inner: &str) -> Option<CostPart> {
    parse_put_card_to_lib(inner, ZoneType::Hand, false)
}

fn parse_put_card_to_lib_from_grave(inner: &str) -> Option<CostPart> {
    parse_put_card_to_lib(inner, ZoneType::Graveyard, false)
}

fn parse_put_card_to_lib_from_same_grave(inner: &str) -> Option<CostPart> {
    parse_put_card_to_lib(inner, ZoneType::Graveyard, true)
}

fn parse_put_card_to_lib_from_battlefield(inner: &str) -> Option<CostPart> {
    parse_put_card_to_lib(inner, ZoneType::Battlefield, false)
}

fn parse_put_card_to_lib(inner: &str, from: ZoneType, same_zone: bool) -> Option<CostPart> {
    let mut it = inner.splitn(4, '/');
    let amount = it
        .next()
        .map(|s| AmountSpec::parse_or(s, 1))
        .unwrap_or(AmountSpec::Literal(1));
    let lib_pos = it.next().and_then(|s| s.parse::<i32>().ok()).unwrap_or(0);
    let type_filter = it.next().unwrap_or("Card").to_string();
    Some(CostPart::PutCardToLib {
        amount,
        lib_pos,
        type_filter,
        from,
        same_zone,
    })
}

fn parse_enlist(inner: &str) -> Option<CostPart> {
    let pieces: Vec<&str> = inner.split('/').collect();
    let amount = pieces
        .first()
        .map(|s| AmountSpec::parse_or(s, 1))
        .unwrap_or(AmountSpec::Literal(1));
    let filter = if pieces.len() >= 3 {
        pieces[2]
    } else {
        pieces.get(1).copied().unwrap_or("")
    }
    .to_string();
    Some(CostPart::Enlist {
        amount,
        type_filter: filter,
    })
}

fn parse_blight(inner: &str) -> Option<CostPart> {
    let amount = AmountSpec::parse_or(inner, 1);
    Some(CostPart::Blight(amount))
}
