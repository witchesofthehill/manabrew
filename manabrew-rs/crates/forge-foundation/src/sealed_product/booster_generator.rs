use rand::Rng;

use super::booster_slots::BoosterSlots;
use super::paper_card::PaperCard;
use super::print_sheet::PrintSheet;
use super::rarity::Rarity;
use super::sealed_template::SealedTemplate;
use super::sealed_template_with_slots::SealedTemplateWithSlots;
use crate::color::ColorSet;

pub struct BoosterGenerator;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FoilRarity {
    Rare,
    Uncommon,
    Common,
    Special,
}

impl BoosterGenerator {
    pub fn get_booster_pack<R: Rng + ?Sized>(
        template: &SealedTemplate,
        pool: &[PaperCard],
        rng: &mut R,
    ) -> Vec<PaperCard> {
        let mut result: Vec<PaperCard> =
            Vec::with_capacity(template.number_of_cards_expected() as usize);

        let foil_supported = template.foil_type.supports_foil();
        let mut has_foil = foil_supported
            && !template.slots.is_empty()
            && rng.gen_bool(template.foil_chance.clamp(0.0, 1.0));
        let foil_at_end_of_pack = has_foil && template.foil_always_in_common_slot;

        let foil_rarity = if has_foil {
            roll_foil_rarity(template, rng)
        } else {
            FoilRarity::Common
        };

        let foil_slot = if has_foil {
            pick_foil_slot(template, foil_rarity, rng)
        } else {
            String::new()
        };

        let is_pls = edition_code_matches(template, "PLS");

        let mut replace_common = !template.slots.is_empty()
            && template.chance_replace_common_with > 0.0
            && template.slot_replace_common_with.is_some()
            && rng.gen_bool(template.chance_replace_common_with.clamp(0.0, 1.0));

        let mut held_foils: Vec<PaperCard> = Vec::new();

        for (raw_slot, slot_count) in &template.slots {
            let mut slot_type = raw_slot.clone();
            let convert_card_foil = slot_type.ends_with('+');
            if convert_card_foil {
                slot_type.pop();
            }

            let head = slot_head(&slot_type).to_string();
            let mut num_cards = *slot_count as i32;

            let foil_in_this_slot = has_foil && head == foil_slot;
            if (!foil_at_end_of_pack && foil_in_this_slot)
                || (foil_at_end_of_pack && has_foil && head.starts_with(BoosterSlots::COMMON))
            {
                num_cards -= 1;
            }

            if is_pls
                && head.starts_with(BoosterSlots::RARE)
                && foil_slot.starts_with(BoosterSlots::SPECIAL)
            {
                num_cards -= 1;
            }

            if replace_common && head.starts_with(BoosterSlots::COMMON) {
                if let Some(replace_spec) = template.slot_replace_common_with.as_deref() {
                    num_cards -= 1;
                    let sub_sheet = Self::make_sheet(replace_spec, pool);
                    if let Some(sub) = sub_sheet.pick_one(rng) {
                        result.push(sub);
                    }
                    replace_common = false;
                }
            }

            let sheet = Self::make_sheet(&slot_type, pool);
            let take = num_cards.max(0) as usize;
            let mut picks = sheet.random(take, true, rng);
            if convert_card_foil {
                for c in &mut picks {
                    *c = c.with_foil();
                }
            }
            result.extend(picks);

            if foil_in_this_slot {
                if !foil_at_end_of_pack {
                    has_foil = false;
                    if let Some(foil_card) = sheet.pick_one(rng) {
                        result.push(foil_card.with_foil());
                    }
                } else if let Some(foil_card) = sheet.pick_one(rng) {
                    held_foils.push(foil_card.with_foil());
                }
            }
        }

        if has_foil && foil_at_end_of_pack {
            result.extend(held_foils);
        }

        if let Some(must) = template.booster_must_contain.as_deref() {
            if !must.is_empty() && !result.iter().any(|c| name_matches(c, must)) {
                ensure_guaranteed_card_in_booster(&mut result, template, must, pool, rng);
            }
        }
        if let Some(sheet_key) = template
            .booster_replace_slot_from_print_sheet
            .as_deref()
            .filter(|s| !s.is_empty())
        {
            replace_card_from_extra_sheet(&mut result, sheet_key, rng);
        }
        if let Some(spec) = template
            .sheet_replace_card_from_sheet
            .as_deref()
            .filter(|s| !s.is_empty())
        {
            run_sheet_replace_card_from_sheet(&mut result, spec, rng);
        }
        if let Some(spec) = template
            .sheet_replace_card_from_sheet2
            .as_deref()
            .filter(|s| !s.is_empty())
        {
            run_sheet_replace_card_from_sheet(&mut result, spec, rng);
        }

        result
    }

    pub fn get_booster_pack_with_slots<R: Rng + ?Sized>(
        template: &SealedTemplateWithSlots,
        pool: &[PaperCard],
        rng: &mut R,
    ) -> Vec<PaperCard> {
        let resolved = template.resolve(rng);
        Self::get_booster_pack(&resolved, pool, rng)
    }

    pub fn make_sheet(sheet_key: &str, pool: &[PaperCard]) -> PrintSheet {
        let mut ps = PrintSheet::new(sheet_key.to_string());

        let split = split_with_parens(sheet_key, ' ');
        let head_with_qualifiers = split[0].to_string();
        let set_pred: Box<dyn Fn(&PaperCard) -> bool> = if split.len() > 1 {
            let sets: Vec<String> = split[1].split_whitespace().map(|s| s.to_string()).collect();
            Box::new(move |c: &PaperCard| sets.iter().any(|s| s.eq_ignore_ascii_case(&c.set_code)))
        } else {
            Box::new(|_| true)
        };

        let mut operators: Vec<String> = split_with_parens(&head_with_qualifiers, ':')
            .into_iter()
            .map(str::to_string)
            .collect();

        let mut substituted_src: Option<Vec<PaperCard>> = None;
        let mut whole_sheet = false;
        let mut active_set_pred: Box<dyn Fn(&PaperCard) -> bool> = set_pred;
        operators.retain(|op| {
            let lower = op.to_ascii_lowercase();
            if !lower.starts_with("fromsheet") && !lower.starts_with("wholesheet") {
                if lower.starts_with("promo") {
                    let inner = strip_call_arg(op, "promo(");
                    let names: Vec<String> = split_with_parens(&inner, ',')
                        .into_iter()
                        .map(|s| s.trim().trim_matches('"').to_string())
                        .filter(|s| !s.is_empty())
                        .collect();
                    let chosen: Vec<PaperCard> = pool
                        .iter()
                        .filter(|c| names.iter().any(|n| n.eq_ignore_ascii_case(&c.name)))
                        .cloned()
                        .collect();
                    substituted_src = Some(chosen);
                    return false;
                }
                return true;
            }
            let prefix_len = if lower.starts_with("fromsheet") {
                "fromSheet(".len()
            } else {
                whole_sheet = true;
                "wholeSheet(".len()
            };
            let inner_start = op
                .find('(')
                .map(|i| i + 1)
                .unwrap_or(prefix_len.min(op.len()));
            let inner = op[inner_start..]
                .trim_end_matches(')')
                .trim_matches(|c: char| c == '"' || c == ' ')
                .to_string();
            match super::print_sheet_registry::get(&inner) {
                Some(sheet) => {
                    substituted_src = Some(sheet.to_flat_list());
                    active_set_pred = Box::new(|_| true);
                }
                None => {
                    if super::print_sheet_registry::is_populated() {
                        eprintln!(
                            "[booster_generator] sheet `{inner}` not found in print-sheet registry"
                        );
                    }
                }
            }
            false
        });

        let extra_pred = build_extra_predicate(&mut operators);

        if whole_sheet {
            if let Some(src) = substituted_src.as_ref() {
                ps.add_all(src.clone());
            }
            return ps;
        }

        let src_storage: Vec<PaperCard>;
        let src: &[PaperCard] = if let Some(s) = substituted_src.as_ref() {
            s.as_slice()
        } else {
            src_storage = pool.to_vec();
            &src_storage[..]
        };

        let main = operators.first().map(|s| s.trim().to_string());
        let main_lc = main.as_deref().map(str::to_ascii_lowercase);

        let pick_with =
            |sheet: &mut PrintSheet, pred: Box<dyn Fn(&PaperCard) -> bool>, weight: u32| {
                for c in src
                    .iter()
                    .filter(|c| active_set_pred(c) && pred(c) && extra_pred(c))
                {
                    sheet.add_weighted(c.clone(), weight);
                }
            };

        match main_lc.as_deref() {
            None | Some("") => {
                pick_with(&mut ps, Box::new(|_| true), 1);
            }
            Some(s) if s.eq_ignore_ascii_case(BoosterSlots::ANY) => {
                pick_with(&mut ps, Box::new(|_| true), 1);
            }
            Some(s) if s.eq_ignore_ascii_case(BoosterSlots::COMMON) => {
                pick_with(
                    &mut ps,
                    Box::new(|c: &PaperCard| c.rarity == Rarity::Common),
                    1,
                );
            }
            Some(s) if s.eq_ignore_ascii_case(BoosterSlots::UNCOMMON) => {
                pick_with(
                    &mut ps,
                    Box::new(|c: &PaperCard| c.rarity == Rarity::Uncommon),
                    1,
                );
            }
            Some(s) if s.eq_ignore_ascii_case(BoosterSlots::RARE) => {
                pick_with(
                    &mut ps,
                    Box::new(|c: &PaperCard| c.rarity == Rarity::Rare),
                    1,
                );
            }
            Some(s) if s.eq_ignore_ascii_case(BoosterSlots::MYTHIC) => {
                pick_with(
                    &mut ps,
                    Box::new(|c: &PaperCard| c.rarity == Rarity::Mythic),
                    1,
                );
            }
            Some(s) if s.eq_ignore_ascii_case(BoosterSlots::UNCOMMON_RARE) => {
                pick_with(
                    &mut ps,
                    Box::new(|c: &PaperCard| c.rarity == Rarity::Rare),
                    1,
                );
                pick_with(
                    &mut ps,
                    Box::new(|c: &PaperCard| c.rarity == Rarity::Uncommon),
                    3,
                );
            }
            Some(s) if s.eq_ignore_ascii_case(BoosterSlots::RARE_MYTHIC) => {
                pick_with(
                    &mut ps,
                    Box::new(|c: &PaperCard| c.rarity == Rarity::Mythic),
                    1,
                );
                pick_with(
                    &mut ps,
                    Box::new(|c: &PaperCard| c.rarity == Rarity::Rare),
                    2,
                );
            }
            Some(s) if s.eq_ignore_ascii_case(BoosterSlots::UNCOMMON_RARE_MYTHIC) => {
                pick_with(
                    &mut ps,
                    Box::new(|c: &PaperCard| c.rarity == Rarity::Mythic),
                    1,
                );
                pick_with(
                    &mut ps,
                    Box::new(|c: &PaperCard| c.rarity == Rarity::Rare),
                    2,
                );
                pick_with(
                    &mut ps,
                    Box::new(|c: &PaperCard| c.rarity == Rarity::Uncommon),
                    4,
                );
            }
            Some(s) if s.eq_ignore_ascii_case(BoosterSlots::SPECIAL) => {
                pick_with(
                    &mut ps,
                    Box::new(|c: &PaperCard| c.rarity == Rarity::Special),
                    1,
                );
            }
            Some(s) if s.eq_ignore_ascii_case(BoosterSlots::TIME_SHIFTED) => {
                pick_with(
                    &mut ps,
                    Box::new(|c: &PaperCard| c.rarity == Rarity::Special),
                    1,
                );
            }
            Some(s) if s.eq_ignore_ascii_case(BoosterSlots::DUAL_FACED_CARD) => {
                let any_dfc = src.iter().any(|c| c.is_double_faced);
                if any_dfc {
                    pick_with(&mut ps, Box::new(|c: &PaperCard| c.is_double_faced), 1);
                } else {
                    pick_with(
                        &mut ps,
                        Box::new(|c: &PaperCard| matches!(c.rarity, Rarity::Rare | Rarity::Mythic)),
                        1,
                    );
                }
            }
            Some(s)
                if s.eq_ignore_ascii_case(BoosterSlots::BASIC_LAND)
                    || s.eq_ignore_ascii_case(BoosterSlots::LAND) =>
            {
                pick_with(
                    &mut ps,
                    Box::new(|c: &PaperCard| c.rarity == Rarity::BasicLand),
                    1,
                );
            }
            Some(other) => {
                eprintln!(
                    "[booster_generator] unknown slot operator `{other}` in `{sheet_key}` — falling back to Any",
                );
                pick_with(&mut ps, Box::new(|_| true), 1);
            }
        }

        ps
    }
}

fn roll_foil_rarity<R: Rng + ?Sized>(template: &SealedTemplate, rng: &mut R) -> FoilRarity {
    let is_tsp = edition_code_matches(template, "TSP");
    let is_vma = edition_code_matches(template, "VMA");
    let is_pls = edition_code_matches(template, "PLS");
    loop {
        let r = rng.gen_range(1..=10);
        match r {
            1 => return FoilRarity::Rare,
            2..=3 => return FoilRarity::Uncommon,
            4..=6 => return FoilRarity::Common,
            7 => {
                if is_tsp {
                    return FoilRarity::Special;
                }
            }
            8 => {
                if is_vma && template.has_slot(BoosterSlots::SPECIAL) && rng.gen_range(0..53) <= 7 {
                    return FoilRarity::Special;
                }
            }
            9 => {
                if template.has_slot(BoosterSlots::DUAL_FACED_CARD) {
                    return FoilRarity::Special;
                }
            }
            10 => {
                if is_pls && template.has_slot(BoosterSlots::SPECIAL) && rng.gen_range(0..53) <= 3 {
                    return FoilRarity::Special;
                }
            }
            _ => return FoilRarity::Common,
        }
    }
}

fn edition_code_matches(template: &SealedTemplate, code: &str) -> bool {
    template
        .name
        .as_deref()
        .map(|n| {
            n.split_whitespace()
                .next()
                .unwrap_or("")
                .eq_ignore_ascii_case(code)
        })
        .unwrap_or(false)
}

fn pick_foil_slot<R: Rng + ?Sized>(
    template: &SealedTemplate,
    foil: FoilRarity,
    rng: &mut R,
) -> String {
    let default_slot = template
        .slots
        .get(rng.gen_range(0..template.slots.len()))
        .map(|(s, _)| slot_head(s).to_string())
        .unwrap_or_default();

    match foil {
        FoilRarity::Rare => {
            if template.has_slot(BoosterSlots::RARE_MYTHIC) {
                BoosterSlots::RARE_MYTHIC.to_string()
            } else if template.has_slot(BoosterSlots::RARE) {
                BoosterSlots::RARE.to_string()
            } else if template.has_slot(BoosterSlots::UNCOMMON_RARE) {
                BoosterSlots::UNCOMMON_RARE.to_string()
            } else {
                default_slot
            }
        }
        FoilRarity::Uncommon => {
            if template.has_slot(BoosterSlots::UNCOMMON) {
                BoosterSlots::UNCOMMON.to_string()
            } else if template.has_slot(BoosterSlots::UNCOMMON_RARE) {
                BoosterSlots::UNCOMMON_RARE.to_string()
            } else {
                default_slot
            }
        }
        FoilRarity::Common => {
            if template.has_slot(BoosterSlots::BASIC_LAND) && rng.gen_range(0..130) <= 20 {
                BoosterSlots::BASIC_LAND.to_string()
            } else {
                BoosterSlots::COMMON.to_string()
            }
        }
        FoilRarity::Special => {
            if template.has_slot(BoosterSlots::TIME_SHIFTED) {
                BoosterSlots::TIME_SHIFTED.to_string()
            } else if template.has_slot(BoosterSlots::DUAL_FACED_CARD) {
                BoosterSlots::DUAL_FACED_CARD.to_string()
            } else if template.has_slot(BoosterSlots::SPECIAL) {
                BoosterSlots::SPECIAL.to_string()
            } else {
                default_slot
            }
        }
    }
}

fn slot_head(s: &str) -> &str {
    let end = s.find([' ', ':', '!']).unwrap_or(s.len());
    &s[..end]
}

fn split_with_parens(s: &str, sep: char) -> Vec<&str> {
    let mut depth = 0i32;
    let mut start = 0usize;
    let mut out = Vec::new();
    for (i, c) in s.char_indices() {
        match c {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            ch if ch == sep && depth == 0 => {
                out.push(&s[start..i]);
                start = i + ch.len_utf8();
            }
            _ => {}
        }
    }
    out.push(&s[start..]);
    out
}

type CardPred = Box<dyn Fn(&PaperCard) -> bool>;

fn build_extra_predicate(operators: &mut Vec<String>) -> CardPred {
    let mut conditions: Vec<CardPred> = Vec::new();

    let mut keep: Vec<String> = Vec::with_capacity(operators.len());
    for raw in operators.drain(..) {
        let mut op = raw.trim().to_string();
        if op.is_empty() {
            continue;
        }
        if op.ends_with('s') && !op.ends_with("(s)") {
            op.pop();
        }
        let invert = op.starts_with('!');
        if invert {
            op.remove(0);
        }
        let lower = op.to_ascii_lowercase();
        let pred: Option<CardPred> = if lower.eq_ignore_ascii_case(BoosterSlots::LAND)
            || lower.eq_ignore_ascii_case(BoosterSlots::BASIC_LAND)
        {
            Some(Box::new(|c: &PaperCard| c.rarity == Rarity::BasicLand))
        } else if lower.eq_ignore_ascii_case(BoosterSlots::DUAL_FACED_CARD) {
            Some(Box::new(|c: &PaperCard| c.is_double_faced))
        } else if lower.eq_ignore_ascii_case(BoosterSlots::TIME_SHIFTED)
            || lower.eq_ignore_ascii_case(BoosterSlots::SPECIAL)
        {
            Some(Box::new(|c: &PaperCard| c.rarity == Rarity::Special))
        } else if lower.eq_ignore_ascii_case(BoosterSlots::MYTHIC) {
            Some(Box::new(|c: &PaperCard| c.rarity == Rarity::Mythic))
        } else if lower.eq_ignore_ascii_case(BoosterSlots::RARE) {
            Some(Box::new(|c: &PaperCard| c.rarity == Rarity::Rare))
        } else if lower.eq_ignore_ascii_case(BoosterSlots::UNCOMMON) {
            Some(Box::new(|c: &PaperCard| c.rarity == Rarity::Uncommon))
        } else if lower.eq_ignore_ascii_case(BoosterSlots::COMMON) {
            Some(Box::new(|c: &PaperCard| c.rarity == Rarity::Common))
        } else if lower.starts_with("name(") {
            let inner = strip_call_arg(&op, "name(");
            let names: Vec<String> = split_with_parens(&inner, ',')
                .into_iter()
                .map(|s| s.trim().trim_matches('"').to_string())
                .filter(|s| !s.is_empty())
                .collect();
            Some(Box::new(move |c: &PaperCard| {
                names.iter().any(|n| n.eq_ignore_ascii_case(&c.name))
            }))
        } else if lower.starts_with("fromsets(") {
            let inner = strip_call_arg(&op, "fromSets(");
            let sets: Vec<String> = inner
                .split(',')
                .map(|s| s.trim().trim_matches('"').to_string())
                .filter(|s| !s.is_empty())
                .collect();
            Some(Box::new(move |c: &PaperCard| {
                sets.iter().any(|s| s.eq_ignore_ascii_case(&c.set_code))
            }))
        } else if lower.starts_with("fromsheet(") {
            let inner = strip_call_arg(&op, "fromSheet(");
            let cards: Vec<PaperCard> = match super::print_sheet_registry::get(&inner) {
                Some(sheet) => sheet.to_flat_list(),
                None => Vec::new(),
            };
            Some(Box::new(move |c: &PaperCard| cards.iter().any(|x| x == c)))
        } else if lower.starts_with("color(") {
            let inner = strip_call_arg(&op, "color(");
            let target = match inner.to_ascii_lowercase().as_str() {
                "white" => Some(ColorSet::WHITE),
                "blue" => Some(ColorSet::BLUE),
                "black" => Some(ColorSet::BLACK),
                "red" => Some(ColorSet::RED),
                "green" => Some(ColorSet::GREEN),
                "colorless" => Some(ColorSet::COLORLESS),
                _ => {
                    eprintln!("[booster_generator] unknown color `{inner}` in :color()");
                    None
                }
            };
            target.map(|cs| -> Box<dyn Fn(&PaperCard) -> bool> {
                if cs == ColorSet::COLORLESS {
                    Box::new(|c: &PaperCard| c.colors == ColorSet::COLORLESS)
                } else {
                    Box::new(move |c: &PaperCard| c.colors.has_any_color(cs.mask()))
                }
            })
        } else {
            keep.push(raw_with_invert(invert, &op));
            continue;
        };

        if let Some(mut p) = pred {
            if invert {
                p = Box::new(move |c: &PaperCard| !p(c));
            }
            conditions.push(p);
        }
    }
    *operators = keep;

    if conditions.is_empty() {
        return Box::new(|_| true);
    }
    Box::new(move |c: &PaperCard| conditions.iter().all(|p| p(c)))
}

fn raw_with_invert(invert: bool, op: &str) -> String {
    if invert {
        format!("!{op}")
    } else {
        op.to_string()
    }
}

fn strip_call_arg(op: &str, prefix: &str) -> String {
    let after = &op[prefix.len()..];
    after
        .trim_end_matches(')')
        .trim_matches(|c: char| c == '(' || c == ')' || c == '"' || c == ' ')
        .to_string()
}

fn name_matches(card: &PaperCard, spec: &str) -> bool {
    spec.split(',')
        .map(|s| s.trim().trim_matches('"'))
        .any(|n| n.eq_ignore_ascii_case(&card.name))
}

fn replace_card_in_booster(booster: &mut [PaperCard], mut to_add: PaperCard) {
    let target_rarity = to_add.rarity;
    let matches = |c: &PaperCard| match target_rarity {
        Rarity::BasicLand => c.rarity == Rarity::BasicLand,
        Rarity::Common => c.rarity == Rarity::Common,
        Rarity::Uncommon => c.rarity == Rarity::Uncommon,
        Rarity::Rare | Rarity::Mythic => matches!(c.rarity, Rarity::Rare | Rarity::Mythic),
        _ => c.rarity == Rarity::Special,
    };
    if let Some(idx) = booster.iter().position(matches) {
        if booster[idx].foil {
            to_add.foil = true;
        }
        booster[idx] = to_add;
    }
}

fn replace_card_from_extra_sheet<R: Rng + ?Sized>(
    booster: &mut [PaperCard],
    sheet_key: &str,
    rng: &mut R,
) {
    let sheet = match super::print_sheet_registry::get(sheet_key) {
        Some(s) => s,
        None => {
            if super::print_sheet_registry::is_populated() {
                eprintln!(
                    "[booster_generator] replaceSlotFromPrintSheet: sheet `{sheet_key}` not registered"
                );
            }
            return;
        }
    };
    if let Some(picked) = sheet.pick_one(rng) {
        replace_card_in_booster(booster, picked);
    }
}

fn run_sheet_replace_card_from_sheet<R: Rng + ?Sized>(
    booster: &mut [PaperCard],
    spec: &str,
    rng: &mut R,
) {
    let (a, b) = match spec.split_once('_') {
        Some(parts) => parts,
        None => {
            eprintln!("[booster_generator] sheetReplaceCardFromSheet bad spec `{spec}`");
            return;
        }
    };
    let replace_this = match super::print_sheet_registry::get(a) {
        Some(s) => s,
        None => return,
    };
    let target = match super::print_sheet_registry::get(b) {
        Some(s) => s,
        None => return,
    };
    let mut indices: Vec<usize> = booster
        .iter()
        .enumerate()
        .filter_map(|(i, c)| {
            if replace_this.contains(c) {
                Some(i)
            } else {
                None
            }
        })
        .collect();
    if indices.is_empty() {
        return;
    }
    let picks = target.random(indices.len(), false, rng);
    for (idx_pos, sheet_idx) in indices.drain(..).enumerate() {
        if let Some(card) = picks.get(idx_pos) {
            let was_foil = booster[sheet_idx].foil;
            let mut next = card.clone();
            next.foil = was_foil;
            booster[sheet_idx] = next;
        }
    }
}

fn ensure_guaranteed_card_in_booster<R: Rng + ?Sized>(
    booster: &mut [PaperCard],
    template: &SealedTemplate,
    spec: &str,
    pool: &[PaperCard],
    rng: &mut R,
) {
    let names: Vec<String> = spec
        .split(',')
        .map(|s| s.trim().trim_matches('"').to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if names.is_empty() {
        return;
    }
    if booster
        .iter()
        .any(|c| names.iter().any(|n| n.eq_ignore_ascii_case(&c.name)))
    {
        return;
    }
    let mut possible: Vec<PaperCard> = Vec::new();
    for (slot, _) in &template.slots {
        let sheet = BoosterGenerator::make_sheet(slot, pool);
        for card in sheet.to_flat_list() {
            if names.iter().any(|n| n.eq_ignore_ascii_case(&card.name))
                && !possible.iter().any(|p| p == &card)
            {
                possible.push(card);
            }
        }
    }
    if possible.is_empty() {
        return;
    }
    let pick = possible[rng.gen_range(0..possible.len())].clone();
    replace_card_in_booster(booster, pick);
}

#[cfg(test)]
mod tests {
    use super::super::foil_type::FoilType;
    use super::*;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    fn pool() -> Vec<PaperCard> {
        let mut v = Vec::new();
        for i in 0..100 {
            v.push(PaperCard::new(
                format!("Common {i}"),
                "TST",
                format!("c{i}"),
                Rarity::Common,
            ));
        }
        for i in 0..40 {
            v.push(PaperCard::new(
                format!("Uncommon {i}"),
                "TST",
                format!("u{i}"),
                Rarity::Uncommon,
            ));
        }
        for i in 0..53 {
            v.push(PaperCard::new(
                format!("Rare {i}"),
                "TST",
                format!("r{i}"),
                Rarity::Rare,
            ));
        }
        for i in 0..15 {
            v.push(PaperCard::new(
                format!("Mythic {i}"),
                "TST",
                format!("m{i}"),
                Rarity::Mythic,
            ));
        }
        for i in 0..5 {
            v.push(PaperCard::new(
                format!("Forest {i}"),
                "TST",
                format!("l{i}"),
                Rarity::BasicLand,
            ));
        }
        v
    }

    fn no_foil_template() -> SealedTemplate {
        let mut t = SealedTemplate::generic_draft_booster();
        t.foil_chance = 0.0;
        t.foil_type = FoilType::NotSupported;
        t
    }

    #[test]
    fn opens_15_card_booster() {
        let mut rng = StdRng::seed_from_u64(42);
        let pack = BoosterGenerator::get_booster_pack(&no_foil_template(), &pool(), &mut rng);
        assert_eq!(pack.len(), 15);
        let commons = pack.iter().filter(|c| c.rarity == Rarity::Common).count();
        let uncommons = pack.iter().filter(|c| c.rarity == Rarity::Uncommon).count();
        let lands = pack
            .iter()
            .filter(|c| c.rarity == Rarity::BasicLand)
            .count();
        assert_eq!(commons, 10);
        assert_eq!(uncommons, 3);
        assert_eq!(lands, 1);
    }

    #[test]
    fn mythic_ratio_matches_java_print_sheet() {
        let mut rng = StdRng::seed_from_u64(7);
        let template = no_foil_template();
        let pool = pool();
        let n = 5_000;
        let mut mythic_packs = 0;
        for _ in 0..n {
            let pack = BoosterGenerator::get_booster_pack(&template, &pool, &mut rng);
            if pack.iter().any(|c| c.rarity == Rarity::Mythic) {
                mythic_packs += 1;
            }
        }
        let ratio = mythic_packs as f64 / n as f64;
        assert!(
            (0.10..0.15).contains(&ratio),
            "mythic ratio off: {ratio} (expected ~0.124)"
        );
    }

    #[test]
    fn from_sheet_resolves_via_registry() {
        use super::super::print_sheet::PrintSheet;
        use super::super::print_sheet_registry;

        let lands: Vec<PaperCard> = (0..5)
            .map(|i| {
                PaperCard::new(
                    format!("Land {i}"),
                    "TST",
                    format!("l{i}"),
                    Rarity::BasicLand,
                )
            })
            .collect();
        let commons: Vec<PaperCard> = (0..30)
            .map(|i| {
                PaperCard::new(
                    format!("Common {i}"),
                    "TST",
                    format!("c{i}"),
                    Rarity::Common,
                )
            })
            .collect();

        let mut land_sheet = PrintSheet::new("TST Lands");
        land_sheet.add_all(lands.clone());
        let mut card_sheet = PrintSheet::new("TST cards");
        card_sheet.add_all(commons.clone());

        print_sheet_registry::clear();
        print_sheet_registry::register("TST Lands", land_sheet);
        print_sheet_registry::register("TST cards", card_sheet);

        let mut tpl = SealedTemplate::new(
            Some("TST".into()),
            vec![
                (
                    "Common:fromSheet(TST cards):!fromSheet(TST Lands)".into(),
                    10,
                ),
                ("fromSheet(TST Lands)".into(), 1),
            ],
        );
        tpl.foil_chance = 0.0;
        tpl.foil_type = FoilType::NotSupported;

        let pool: Vec<PaperCard> = lands.iter().chain(commons.iter()).cloned().collect();

        let mut rng = StdRng::seed_from_u64(99);
        let pack = BoosterGenerator::get_booster_pack(&tpl, &pool, &mut rng);
        assert_eq!(pack.len(), 11);
        let common_count = pack.iter().filter(|c| c.rarity == Rarity::Common).count();
        let land_count = pack
            .iter()
            .filter(|c| c.rarity == Rarity::BasicLand)
            .count();
        assert_eq!(common_count, 10);
        assert_eq!(land_count, 1);

        print_sheet_registry::clear();
    }

    #[test]
    fn booster_must_contain_swaps_in_named_card() {
        use super::super::print_sheet_registry;

        let mut pool: Vec<PaperCard> = (0..20)
            .map(|i| {
                PaperCard::new(
                    format!("Common {i}"),
                    "TST",
                    format!("c{i}"),
                    Rarity::Common,
                )
            })
            .collect();
        for i in 0..3 {
            pool.push(PaperCard::new(
                format!("Rare {i}"),
                "TST",
                format!("r{i}"),
                Rarity::Rare,
            ));
        }
        for i in 0..3 {
            pool.push(PaperCard::new(
                format!("Uncommon {i}"),
                "TST",
                format!("u{i}"),
                Rarity::Uncommon,
            ));
        }
        let forced = PaperCard::new("Forced Legend", "TST", "leg1", Rarity::Rare);
        pool.push(forced.clone());
        pool.push(PaperCard::new("Forest 0", "TST", "l0", Rarity::BasicLand));

        let mut tpl = no_foil_template();
        tpl.booster_must_contain = Some("Forced Legend".to_string());

        print_sheet_registry::clear();

        let mut rng = StdRng::seed_from_u64(3);
        let mut hits = 0;
        for _ in 0..50 {
            let pack = BoosterGenerator::get_booster_pack(&tpl, &pool, &mut rng);
            if pack.iter().any(|c| c.name == "Forced Legend") {
                hits += 1;
            }
        }
        assert_eq!(
            hits, 50,
            "boosterMustContain failed to inject the named card"
        );
    }

    #[test]
    fn modern_template_produces_foils() {
        let mut rng = StdRng::seed_from_u64(11);
        let template = SealedTemplate::generic_draft_booster();
        let pool = pool();
        let mut foil_packs = 0;
        let n = 1_000;
        for _ in 0..n {
            let pack = BoosterGenerator::get_booster_pack(&template, &pool, &mut rng);
            if pack.iter().any(|c| c.foil) {
                foil_packs += 1;
            }
        }
        let ratio = foil_packs as f64 / n as f64;
        assert!(
            (0.27..0.40).contains(&ratio),
            "foil ratio off: {ratio} (expected ~0.333)"
        );
    }
}
