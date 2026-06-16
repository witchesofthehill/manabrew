use std::collections::BTreeMap;

use crate::agent::types::PlayOption;
use crate::card::Card;
use crate::ids::CardId;
use crate::ids::PlayerId;
use crate::player::actions::{
    ActivateAbilityAction, ActivateManaAction, CastSpellAction, PassPriorityAction, PlayerAction,
    UndoManaAction,
};
use crate::replacement::parse_replacement_effect;
use crate::staticability::parse_static_ability;
use crate::trigger::{parse_trigger, Trigger};
use forge_foundation::{CardTypeLine, ColorSet, ManaCost};

pub fn build_priority_actions(
    playable: &[PlayOption],
    tappable_lands: &[CardId],
    untappable_lands: &[CardId],
    activatable: &[(CardId, usize)],
) -> Vec<PlayerAction> {
    let mut actions = Vec::with_capacity(
        playable.len() + tappable_lands.len() + untappable_lands.len() + activatable.len() + 1,
    );
    actions.extend(
        playable
            .iter()
            .map(|option| PlayerAction::from(CastSpellAction { play: *option })),
    );
    actions.extend(
        tappable_lands
            .iter()
            .map(|card_id| PlayerAction::from(ActivateManaAction { card_id: *card_id })),
    );
    actions.extend(
        untappable_lands
            .iter()
            .map(|card_id| PlayerAction::from(UndoManaAction { card_id: *card_id })),
    );
    actions.extend(activatable.iter().map(|(card_id, ability_index)| {
        PlayerAction::from(ActivateAbilityAction {
            card_id: *card_id,
            ability_index: *ability_index,
        })
    }));
    actions.push(PassPriorityAction.into());
    actions
}

pub fn new_player_effect_card(
    owner: PlayerId,
    name: impl Into<String>,
    set_code: Option<String>,
) -> Card {
    let mut effect = Card::new(
        CardId(0),
        name.into(),
        owner,
        CardTypeLine::parse("Effect"),
        ManaCost::parse("0"),
        ColorSet::COLORLESS,
        None,
        None,
        vec![],
        vec![],
    );
    effect.set_controller(owner);
    effect.set_code = set_code;
    effect
}

pub fn add_static_ability(effect: &mut Card, raw: &str) -> bool {
    parse_static_ability(raw)
        .map(|ability| effect.add_static_ability(ability))
        .unwrap_or(false)
}

pub fn add_trigger_ability<I, K, V>(effect: &mut Card, raw: &str, svars: I) -> bool
where
    I: IntoIterator<Item = (K, V)>,
    K: Into<String>,
    V: Into<String>,
{
    let mut changed = false;
    for (key, value) in svars {
        effect.set_s_var(key, value);
    }
    let mut next_trigger_id = 0;
    if let Some(trigger) = parse_trigger(raw, &mut next_trigger_id) {
        changed |= effect.add_trigger(trigger);
    }
    changed
}

pub fn add_trigger(effect: &mut Card, trigger: Trigger) -> bool {
    effect.add_trigger(trigger)
}

pub fn add_replacement_effect(effect: &mut Card, raw: &str) -> bool {
    parse_replacement_effect(raw)
        .map(|replacement| effect.add_replacement_effect(replacement))
        .unwrap_or(false)
}

pub fn add_spell_ability(
    effect: &mut Card,
    key: impl Into<String>,
    raw: impl Into<String>,
) -> bool {
    let key = key.into();
    let raw = raw.into();
    effect.set_s_var(&key, &raw);
    true
}

pub fn set_svars(effect: &mut Card, svars: BTreeMap<String, String>) {
    effect.set_svars_map(svars);
}
