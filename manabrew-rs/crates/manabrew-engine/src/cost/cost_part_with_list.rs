//! Shared list-payment helpers for parity with Java `CostPartWithList`.

use crate::spellability::SpellAbility;

pub fn reset_lists(lki_list: &mut Vec<String>, card_list: &mut Vec<String>) {
    lki_list.clear();
    card_list.clear();
}

pub fn report_paid_cards_to(
    sa: Option<&mut SpellAbility>,
    lki_key: &str,
    card_key: &str,
    lki_list: &[String],
    card_list: &[String],
) {
    if let Some(sa) = sa {
        for v in lki_list {
            sa.add_cost_to_hash_list(lki_key, v);
        }
        for v in card_list {
            sa.add_cost_to_hash_list(card_key, v);
        }
    }
}

pub fn execute_payment<T, F>(
    lki_list: &mut Vec<T>,
    card_list: &mut Vec<T>,
    selected: &[T],
    mut f: F,
) where
    T: Clone,
    F: FnMut(&T) -> Option<T>,
{
    for selected_item in selected {
        lki_list.push(selected_item.clone());
        if let Some(new_item) = f(selected_item) {
            card_list.push(new_item);
        }
    }
}

pub fn pay_as_decided<T, F>(
    sa: Option<&mut SpellAbility>,
    lki_key: &str,
    card_key: &str,
    lki_list: &mut Vec<T>,
    card_list: &mut Vec<T>,
    selected: &[T],
    f: F,
) -> bool
where
    T: Clone + ToString,
    F: FnMut(&T) -> Option<T>,
{
    execute_payment(lki_list, card_list, selected, f);

    let lki_vals: Vec<String> = lki_list.iter().map(ToString::to_string).collect();
    let card_vals: Vec<String> = card_list.iter().map(ToString::to_string).collect();
    report_paid_cards_to(sa, lki_key, card_key, &lki_vals, &card_vals);
    true
}
