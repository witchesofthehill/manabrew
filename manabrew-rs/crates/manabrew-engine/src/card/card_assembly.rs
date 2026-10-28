//! Card assembly pipeline — separates parsing from behavior rewrites.
//!
//! Splits the old monolithic `Card::from_rules` into three phases:
//!
//! 1. **`parse_card_components`** — pure parsing, no side effects
//! 2. **`synthesize_derived`** — behavior rewrites (SpellCastOrCopy duplication,
//!    AlternativeCost keyword extraction, Exert trigger synthesis)
//! 3. **`assemble_card`** — combines components into a `Card`
//!
//! This mirrors Java's separation between `AbilityFactory` (parsing),
//! `TriggerHandler` (registration), and `Card` (construction).

use forge_carddb::CardRules;
use forge_foundation::CardStateName;

use crate::ids::{CardId, PlayerId};
use crate::parsing::parse_classified_or_warn;
use crate::replacement::{parse_replacement_effect, ReplacementEffect};
use crate::staticability::{parse_static_ability, StaticAbility};
use crate::trigger::{parse_trigger, Trigger};

use super::{Card, CardOtherPart};

/// Devoid as a CDA colorless override across all zones — mirrors
/// `CardFactoryUtil.addKeywordAbility("Devoid", ...)`.
fn intrinsic_color(face: &forge_carddb::CardFace) -> forge_foundation::ColorSet {
    if face.keywords.iter().any(|k| k == "Devoid") {
        return forge_foundation::ColorSet::COLORLESS;
    }
    face.resolved_color()
}

// ── Phase 1: Parse ──────────────────────────────────────────────────────────

/// Parsed components from a card face's raw text, before any rewrites.
pub(crate) struct ParsedComponents {
    pub triggers: Vec<Trigger>,
    pub static_abilities: Vec<StaticAbility>,
    pub replacement_effects: Vec<ReplacementEffect>,
    /// Raw trigger lines that contained `Mode$ SpellCastOrCopy`,
    /// needed for Magecraft duplication in Phase 2.
    pub spell_cast_or_copy_raw: Vec<String>,
}

/// Phase 1: Parse triggers, static abilities, and replacement effects from
/// a card face's raw text lines.
pub(crate) fn parse_card_components(face: &forge_carddb::CardFace) -> ParsedComponents {
    let mut next_trigger_id = 0u32;
    let mut triggers = Vec::new();
    let mut spell_cast_or_copy_raw = Vec::new();

    for raw in &face.triggers {
        if let Some(trig) =
            parse_classified_or_warn(parse_trigger(raw, &mut next_trigger_id), "Trigger", raw)
        {
            triggers.push(trig);
            if raw.contains("Mode$ SpellCastOrCopy") {
                spell_cast_or_copy_raw.push(raw.clone());
            }
        }
    }

    // Parse static abilities from S: lines (need S$ prefix for the parser)
    let mut static_abilities = Vec::new();
    for raw in &face.static_abilities {
        let prefixed = format!("S$ {raw}");
        if let Some(sa) =
            parse_classified_or_warn(parse_static_ability(&prefixed), "StaticAbility", raw)
        {
            static_abilities.push(sa);
        }
    }

    // Parse replacement effects from R: lines (need R$ prefix for the parser)
    let replacement_effects: Vec<ReplacementEffect> = face
        .replacements
        .iter()
        .filter_map(|raw| {
            let prefixed = format!("R$ {raw}");
            parse_classified_or_warn(
                parse_replacement_effect(&prefixed),
                "ReplacementEffect",
                raw,
            )
        })
        .collect();

    ParsedComponents {
        triggers,
        static_abilities,
        replacement_effects,
        spell_cast_or_copy_raw,
    }
}

// ── Phase 2: Synthesize ─────────────────────────────────────────────────────

/// Phase 2: Apply behavior rewrites that derive new triggers/keywords from
/// parsed components.
///
/// - Duplicate `SpellCastOrCopy` triggers as `SpellCopied` (Magecraft)
/// - Synthesize `Exerted` triggers from `OptionalAttackCost` with Exert cost
pub(crate) fn synthesize_derived(components: &mut ParsedComponents, existing_trigger_count: usize) {
    let mut next_trig_id = (existing_trigger_count + components.triggers.len()) as u32;

    // Duplicate SpellCastOrCopy triggers as SpellCopied (for Magecraft)
    for raw in &components.spell_cast_or_copy_raw {
        let converted = raw.replace("Mode$ SpellCastOrCopy", "Mode$ SpellCopied");
        if let Some(trig) = parse_trigger(&converted, &mut next_trig_id) {
            components.triggers.push(trig);
        }
    }

    // OptionalAttackCost with Exert + Trigger$: register an Exerted trigger
    for sa in &components.static_abilities {
        if !sa.check_mode(&crate::staticability::StaticMode::OptionalAttackCost) {
            continue;
        }
        let has_exert = sa
            .ir
            .cost
            .as_deref()
            .map(|c| c.contains("Exert"))
            .unwrap_or(false);
        if has_exert {
            if let Some(svar_name) = sa.ir.trigger_text.as_deref() {
                let raw = format!(
                    "Mode$ Exerted | ValidCard$ Card.Self | Execute$ {svar_name} | TriggerZones$ Battlefield"
                );
                if let Some(mut trig) = parse_trigger(&raw, &mut next_trig_id) {
                    trig.execute = svar_name.to_string();
                    components.triggers.push(trig);
                }
            }
        }
    }
}

// ── Phase 3: Assemble ───────────────────────────────────────────────────────

/// Phase 3: Combine parsed + synthesized components into a `Card`.
pub(crate) fn assemble_card(
    rules: &CardRules,
    owner: PlayerId,
    components: ParsedComponents,
) -> Card {
    let face = &rules.main_part;

    let full_name = rules.name();
    let mut card = Card::new(
        CardId(0),
        face.name.clone(),
        owner,
        face.type_line.clone(),
        face.mana_cost.clone(),
        intrinsic_color(face),
        face.int_power,
        face.int_toughness,
        face.keywords.clone(),
        face.abilities.clone(),
    );
    // Set the full combined name for split/room cards (e.g. "A // B").
    // card_name stays as the front face; full_name is used for hand/graveyard/lookup.
    card.full_name = full_name;
    card.oracle_text = face.oracle_text.replace("\\n", "\n");
    // Preserve rules-level color identity (CR 903.4: includes mana symbols in
    // oracle text, e.g. Ashling, the Limitless mentions {W}{U}{B}{R}{G} so its
    // identity is five-colour even though its mana cost is just {2}{R}).
    card.color_identity = rules.color_identity;
    card.attraction_lights = face.attraction_lights.clone();
    card.initial_loyalty = face.initial_loyalty.clone();

    for (k, v) in &face.svars {
        card.svars.entry(k.clone()).or_insert_with(|| v.clone());
    }

    for trig in components.triggers {
        card.add_trigger(trig);
    }
    card.generate_keyword_chapter_triggers();
    if card.type_line.has_subtype("Saga") && card.has_chapter() {
        let read_ahead = card.has_keyword("Read ahead");
        let replacement = if read_ahead {
            super::card_factory_util::make_read_ahead(&card, true)
        } else {
            super::card_factory_util::make_etb_counter("etbCounter:LORE:1", &card, true)
        };
        if let Some(replacement) = replacement {
            card.add_replacement_effect(replacement);
        }
        if read_ahead {
            let raw = "S$ Mode$ DisableTriggers | ValidCard$ Card.Self+ThisTurnEntered | ValidTrigger$ Triggered.ChapterNotLore | Secondary$ True | Description$ Chapter abilities of this Saga can't trigger the turn it entered the battlefield unless it has exactly the number of lore counters on it specified in the chapter symbol of that ability.";
            if let Some(static_ability) = crate::staticability::parse_static_ability(raw) {
                card.add_static_ability(static_ability);
            }
        }
    }

    // Java parity: convert ETBReplacement keywords into intrinsic
    // Event$ Moved replacement effects after SVars are available.
    super::card_factory_util::add_etb_keyword_replacements(&mut card);

    // Java parity: convert Dredge:N keywords into Draw replacement effects.
    super::card_factory_util::add_dredge_replacement(&mut card);

    // Java parity: convert Madness:{cost} keywords into Moved replacement effects.
    super::card_factory_util::add_madness_replacement(&mut card);

    // Java parity: convert Flashback:{cost} keywords into Moved replacement effects
    // that exile the card instead of putting it into the graveyard from the stack.
    super::card_factory_util::add_flashback_replacement(&mut card);

    super::card_factory_util::add_harmonize_replacement(&mut card);

    // Add parsed static abilities and replacement effects.
    for sa in components.static_abilities {
        card.add_static_ability(sa);
    }
    for re in components.replacement_effects {
        card.add_replacement_effect(re);
    }
    if rules.split_type == forge_foundation::CardSplitType::Split
        && card.type_line.has_subtype("Room")
    {
        if let Some(other_face) = &rules.other_part {
            card.activated_abilities.clear();
            card.triggers.clear();
            card.static_abilities.clear();
            card.replacement_effects.clear();
            let faces = [(face, CardStateName::LeftSplit), (other_face, CardStateName::RightSplit)].map(|(face, state_name)| {
                let mut parsed = parse_card_components(face);
                synthesize_derived(&mut parsed, card.triggers.len());
                let mut state = crate::card::card_state::CardState::new(card.clone(), state_name);
                state.set_name(face.name.clone());
                state.s_vars.extend(face.svars.iter().map(|(key, value)| (key.clone(), value.clone())));
                for (index, trigger) in parsed.triggers.iter_mut().enumerate() {
                    trigger.id = (card.triggers.len() + index) as u32;
                    trigger.base.set_card_state(state.clone());
                }
                for ability in &mut parsed.static_abilities {
                    ability.base.set_card_state(&state);
                    ability.svars.extend(face.svars.iter().map(|(key, value)| (key.clone(), value.clone())));
                }
                for replacement in &mut parsed.replacement_effects {
                    replacement.base.set_card_state(state.clone());
                }
                let room_face = CardOtherPart {
                    name: face.name.clone(),
                    oracle_text: face.oracle_text.replace("\\n", "\n"),
                    is_modal: false,
                    type_line: face.type_line.clone(),
                    mana_cost: face.mana_cost.clone(),
                    color: intrinsic_color(face),
                    base_power: face.int_power,
                    base_toughness: face.int_toughness,
                    keywords: crate::keyword::keyword_collection::KeywordCollection::from_strings(&face.keywords),
                    abilities: face.abilities.clone(),
                    triggers: parsed.triggers.clone(),
                    static_abilities: parsed.static_abilities.clone(),
                    replacement_effects: parsed.replacement_effects.clone(),
                    svars: face.svars.clone(),
                };
                for raw in &face.abilities {
                    let text = format!("{raw} | CardState$ {state_name:?}");
                    if let Some(ability) = crate::ability::activated::parse_activated_ability(&text, card.activated_abilities.len()) {
                        card.activated_abilities.push(ability);
                    }
                }
                let cost = face.mana_cost.to_string().replace('{', "").replace('}', " ");
                let text = format!("AB$ UnlockDoor | Unlock$ True | Cost$ {cost} | SorcerySpeed$ True | CardState$ {state_name:?} | SpellDescription$ Unlock {}", face.name);
                if let Some(ability) = crate::ability::activated::parse_activated_ability(&text, card.activated_abilities.len()) {
                    card.activated_abilities.push(ability);
                }
                for trigger in parsed.triggers { card.add_trigger(trigger); }
                for replacement in parsed.replacement_effects { card.add_replacement_effect(replacement); }
                for (key, value) in &face.svars { card.svars.entry(key.clone()).or_insert_with(|| value.clone()); }
                room_face
            });
            card.room_faces = Some(Box::new(faces));
            card.update_rooms();
        }
    }

    // Double-faced cards
    if rules.split_type.is_dual_faced()
        || rules.split_type == forge_foundation::CardSplitType::Adventure
    {
        if let Some(ref back_face) = rules.other_part {
            let mut back_trigger_id = 0u32;
            let back_triggers: Vec<_> = back_face
                .triggers
                .iter()
                .filter_map(|raw| {
                    parse_classified_or_warn(
                        parse_trigger(raw, &mut back_trigger_id),
                        "Trigger",
                        raw,
                    )
                })
                .collect();

            let back_static_abilities: Vec<StaticAbility> = back_face
                .static_abilities
                .iter()
                .filter_map(|raw| {
                    parse_classified_or_warn(
                        parse_static_ability(&format!("S$ {raw}")),
                        "StaticAbility",
                        raw,
                    )
                })
                .collect();

            let back_replacement_effects: Vec<ReplacementEffect> = back_face
                .replacements
                .iter()
                .filter_map(|raw| {
                    parse_classified_or_warn(
                        parse_replacement_effect(&format!("R$ {raw}")),
                        "ReplacementEffect",
                        raw,
                    )
                })
                .collect();

            let mut other = CardOtherPart {
                name: back_face.name.clone(),
                oracle_text: back_face.oracle_text.replace("\\n", "\n"),
                is_modal: rules.split_type == forge_foundation::CardSplitType::Modal,
                type_line: back_face.type_line.clone(),
                mana_cost: back_face.mana_cost.clone(),
                color: intrinsic_color(back_face),
                base_power: back_face.int_power,
                base_toughness: back_face.int_toughness,
                keywords: crate::keyword::keyword_collection::KeywordCollection::from_strings(
                    &back_face.keywords,
                ),
                abilities: back_face.abilities.clone(),
                triggers: back_triggers,
                static_abilities: back_static_abilities,
                replacement_effects: back_replacement_effects,
                svars: back_face.svars.clone(),
            };
            if rules.split_type == forge_foundation::CardSplitType::Adventure {
                if let Some(replacement) =
                    super::card_factory_util::setup_adventure_ability(&mut card)
                {
                    other.replacement_effects.push(replacement);
                }
                card.secondary_part = Some(other);
            } else {
                card.other_part = Some(other);
            }
        }
    }

    // Parsed triggers and any constructor-time synthetic abilities/triggers have
    // now all been attached. Refresh the base counts so continuous-layer reset
    // logic does not strip real printed abilities from hidden-zone cards.
    card.refresh_action_specs();
    card.base_ability_count = card.activated_abilities.len();
    card.base_trigger_count = card.triggers.len();

    card
}
