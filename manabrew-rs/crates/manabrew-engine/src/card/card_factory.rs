use forge_carddb::CardRules;

use super::card_assembly;
use super::Card;
use crate::ids::PlayerId;
use crate::spellability::SpellAbility;

/// Build a `Card` from card rules using the 3-phase card assembly
/// pipeline.
pub(crate) fn build_from_rules(rules: &CardRules, owner: PlayerId) -> Card {
    // Phase 1: Parse raw text into components.
    let mut components = card_assembly::parse_card_components(&rules.main_part);

    // Phase 2: Synthesize derived triggers/keywords (Magecraft, Exert, etc.).
    // Pass 0 as existing trigger count — keyword-generated triggers are added
    // by the constructor in Phase 3, so we don't know the count yet.
    card_assembly::synthesize_derived(&mut components, 0);

    // Phase 3: Assemble into Card.
    card_assembly::assemble_card(rules, owner, components)
}

/// Compatibility entrypoint for parity with Java `CardFactory`.
pub fn from_rules(rules: &CardRules, owner: PlayerId) -> Card {
    build_from_rules(rules, owner)
}

pub fn copy_spell_ability_and_possibly_host(
    game: &mut crate::game::GameState,
    target_sa: &SpellAbility,
    controller: PlayerId,
) -> SpellAbility {
    let mut copy = target_sa.clone();
    copy.activating_player = controller;
    copy.is_copy = true;
    copy.pay_costs = None;
    if target_sa.is_spell {
        if let Some(source_id) = target_sa.source {
            let original = game.card(source_id);
            let mut host = Card::new(
                crate::ids::CardId(0),
                String::new(),
                controller,
                forge_foundation::CardTypeLine::new(),
                forge_foundation::ManaCost::zero(),
                forge_foundation::ColorSet::COLORLESS,
                None,
                None,
                Vec::new(),
                Vec::new(),
            );
            crate::card::card_copy_service::copy_copiable_characteristics(original, &mut host);
            host.color_identity = original.color_identity;
            host.initial_loyalty.clone_from(&original.initial_loyalty);
            host.activated_abilities
                .clone_from(&original.activated_abilities);
            host.static_abilities.clone_from(&original.static_abilities);
            host.replacement_effects = original.copiable_replacement_effects();
            host.room_state = original.room_state;
            host.secondary_part.clone_from(&original.secondary_part);
            host.adventure_spell = original.adventure_spell;
            host.prototype_state.clone_from(&original.prototype_state);
            host.other_part.clone_from(&original.other_part);
            host.is_transformed = original.is_transformed;
            host.set_code.clone_from(&original.set_code);
            host.card_number.clone_from(&original.card_number);
            host.copied_spell = true;
            host.copied_permanent = Some(source_id);
            host.base_ability_count = host.activated_abilities.len();
            host.base_trigger_count = host.triggers.len();
            let room_state = host.room_state;
            let copied_id = game.create_card(host);
            copy.set_host_card_id(copied_id);
            game.move_card(copied_id, forge_foundation::ZoneType::Stack, controller);
            if let Some(state) = room_state {
                game.card_mut(copied_id).set_room_state(state);
            }
            let timestamp = game.card(copied_id).zone_timestamp;
            let mut current = Some(&mut copy);
            while let Some(ability) = current {
                ability.source_zone_timestamp = Some(timestamp);
                current = ability.sub_ability.as_deref_mut();
            }
            game.card_mut(copied_id).cast_sa = Some(Box::new(copy.clone()));
        }
    }
    copy
}

/// Java parity helper for `SpellAbility.cantBeCopied()` checks.
pub fn spell_ability_cant_be_copied(cards: &[Card], sa: &SpellAbility) -> bool {
    sa.source
        .map(|source| {
            crate::staticability::static_ability_cant_be_copied::cant_be_copied(
                cards,
                &cards[source.index()],
            )
        })
        .unwrap_or(false)
}
