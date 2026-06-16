use forge_foundation::ZoneType;

use crate::card::card_util;
use crate::game::GameState;
use crate::ids::CardId;
use crate::spellability::target_restrictions::TargetKind;
use crate::spellability::SpellAbility;
use crate::staticability::StaticMode;

#[derive(Clone, Debug, PartialEq, Eq)]
struct MustTargetRestriction {
    valid_target: String,
    zone: ZoneType,
}

pub fn filter_must_target_cards(
    game: &GameState,
    sa: &SpellAbility,
    targets: Vec<CardId>,
) -> Vec<CardId> {
    if targets.is_empty() {
        return targets;
    }
    let restrictions = get_restrictions(game, sa);
    if restrictions.is_empty() {
        return targets;
    }

    // Keep only unresolved restrictions where at least one current choice can satisfy it.
    let unresolved: Vec<MustTargetRestriction> = restrictions
        .into_iter()
        .filter(|r| {
            targets
                .iter()
                .any(|&cid| card_matches_restriction(game, cid, r))
        })
        .collect();

    if unresolved.is_empty() {
        return targets;
    }

    targets
        .into_iter()
        .filter(|&cid| {
            unresolved
                .iter()
                .any(|r| card_matches_restriction(game, cid, r))
        })
        .collect()
}

pub fn must_target_cards_required(game: &GameState, sa: &SpellAbility, targets: &[CardId]) -> bool {
    let restrictions = get_restrictions(game, sa);
    if restrictions.is_empty() {
        return false;
    }
    restrictions.iter().any(|r| {
        targets
            .iter()
            .any(|&cid| card_matches_restriction(game, cid, r))
    })
}

/// Mirrors Java's `StaticAbilityMustTarget.meetsMustTargetRestriction(spellAbility)`.
/// This is checked *after* target choices are made and can invalidate the cast
/// if a required MustTarget card was targetable but not chosen.
pub fn meets_must_target_restriction(game: &GameState, sa: &SpellAbility) -> bool {
    if sa.is_copy {
        return true;
    }

    let mut restrictions = get_restrictions(game, sa);
    if restrictions.is_empty() {
        return true;
    }

    let mut current = Some(sa);
    let mut uses_targeting = false;
    while let Some(node) = current {
        if node.uses_targeting() && !node.ir.targeting_player {
            uses_targeting = true;
            let choices = get_targetable_card_choices(game, node);
            is_restrictions_met(game, &mut restrictions, &choices, node);
        }
        current = node.sub_ability.as_deref();
    }

    !uses_targeting || restrictions.is_empty()
}

fn get_restrictions(game: &GameState, sa: &SpellAbility) -> Vec<MustTargetRestriction> {
    if sa.is_copy {
        return Vec::new();
    }
    let Some(src_id) = sa.source else {
        return Vec::new();
    };
    // Java applies card-target filtering only when caster controls the spell.
    if sa.activating_player != game.card(src_id).controller {
        return Vec::new();
    }

    let mut out = Vec::new();
    for source in game
        .cards
        .iter()
        .filter(|c| c.zone == ZoneType::Battlefield)
    {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&StaticMode::MustTarget))
        {
            if let Some(valid_sa) = st_ab.ir.valid_sa.as_deref() {
                if !spell_ability_matches(valid_sa, sa, sa.activating_player, source.controller) {
                    continue;
                }
            }
            let Some(valid_target) = st_ab.ir.valid_target_text.clone() else {
                continue;
            };
            let zone = st_ab
                .ir
                .valid_zone
                .first()
                .copied()
                .unwrap_or(ZoneType::Battlefield);
            let r = MustTargetRestriction { valid_target, zone };
            if !out.contains(&r) {
                out.push(r);
            }
        }
    }
    out
}

fn is_restrictions_met(
    game: &GameState,
    restrictions: &mut Vec<MustTargetRestriction>,
    choices: &[CardId],
    sa: &SpellAbility,
) {
    let mut i = restrictions.len();
    while i > 0 {
        i -= 1;
        let restriction = &restrictions[i];

        let already_targeted = sa
            .target_chosen
            .target_card
            .map(|cid| card_matches_restriction(game, cid, restriction))
            .unwrap_or(false);
        if already_targeted {
            restrictions.remove(i);
            continue;
        }

        let can_target_matching = choices
            .iter()
            .any(|&cid| card_matches_restriction(game, cid, restriction));
        if !can_target_matching {
            restrictions.remove(i);
        }
    }
}

fn get_targetable_card_choices(game: &GameState, sa: &SpellAbility) -> Vec<CardId> {
    let Some(tr) = sa.target_restrictions.as_ref() else {
        return Vec::new();
    };

    match &tr.target_kind {
        TargetKind::Any
        | TargetKind::Creature(_)
        | TargetKind::Permanent(_)
        | TargetKind::CardInZone { .. } => card_util::get_valid_cards_to_target(game, sa),
        TargetKind::Player | TargetKind::Spell | TargetKind::None => Vec::new(),
    }
}

fn card_matches_restriction(game: &GameState, cid: CardId, r: &MustTargetRestriction) -> bool {
    let card = game.card(cid);
    if card.zone != r.zone {
        return false;
    }
    let t = r.valid_target.as_str();
    if t.eq_ignore_ascii_case("Card") || t.eq_ignore_ascii_case("Permanent") {
        return true;
    }
    if t.eq_ignore_ascii_case("Creature") {
        return card.is_creature();
    }
    if t.eq_ignore_ascii_case("Land") {
        return card.is_land();
    }
    if t.eq_ignore_ascii_case("Artifact") {
        return card.type_line.is_artifact();
    }
    if t.eq_ignore_ascii_case("Enchantment") {
        return card.type_line.is_enchantment();
    }
    if t.eq_ignore_ascii_case("Planeswalker") {
        return card.type_line.is_planeswalker();
    }
    if t.eq_ignore_ascii_case("Instant") {
        return card.type_line.is_instant();
    }
    if t.eq_ignore_ascii_case("Sorcery") {
        return card.type_line.is_sorcery();
    }
    card.type_line.has_subtype(t)
}

fn spell_ability_matches(
    valid_sa: &str,
    sa: &SpellAbility,
    activating_player: crate::ids::PlayerId,
    source_controller: crate::ids::PlayerId,
) -> bool {
    let tokens: Vec<&str> = valid_sa
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    if tokens.is_empty() {
        return true;
    }
    tokens.iter().any(|tok| {
        let lower = tok.to_ascii_lowercase();
        let parts: Vec<&str> = lower.split('.').collect();
        let base = parts.first().copied().unwrap_or("");
        let ctrl_ok = if parts.len() > 1 {
            match parts[1] {
                "oppctrl" | "opponentctrl" => activating_player != source_controller,
                "youctrl" | "youcontrol" => activating_player == source_controller,
                _ => true,
            }
        } else {
            true
        };
        if !ctrl_ok {
            return false;
        }
        match base {
            "spell" => sa.is_spell,
            "activated" => sa.is_activated,
            "istargeting" => sa.target_restrictions.is_some(),
            "xcost" => sa.cost_has_x(),
            _ => false,
        }
    })
}
