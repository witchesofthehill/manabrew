//! Java-parity token info helpers.

use crate::card::Card;

pub fn make_one_token(card: &Card) -> Card {
    let mut token = card.clone();
    token.is_token = true;
    token
}
