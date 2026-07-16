use manabrew_hub::dto::PublishDeckRequest;
use manabrew_protocol::deck_dto::{Deck, DeckCard};

const MAX_AUTHOR_LEN: usize = 50;
const MAX_NAME_LEN: usize = 100;
const MAX_DESCRIPTION_LEN: usize = 500;
const MAX_MAIN_CARDS: usize = 600;
const MAX_SIDEBOARD_CARDS: usize = 100;
const MAX_COMMANDERS: usize = 2;
const MAX_EXTRA_BOARD_CARDS: usize = 200;
const MAX_CARD_NAME_LEN: usize = 200;
const MAX_RULES_TEXT_LEN: usize = 5000;
const MAX_SET_CODE_LEN: usize = 10;
const MAX_LABELS: usize = 50;
const MAX_LABEL_LEN: usize = 50;
const ALLOWED_IMAGE_HOSTS: [&str; 2] = ["scryfall.io", "scryfall.com"];

pub fn validate(request: &PublishDeckRequest) -> Result<(), String> {
    validate_line(&request.author, 1, MAX_AUTHOR_LEN, "author")?;
    let deck = &request.deck;
    validate_line(&deck.name, 1, MAX_NAME_LEN, "deck name")?;
    if let Some(description) = deck.description.as_deref() {
        if description.chars().count() > MAX_DESCRIPTION_LEN {
            return Err(format!(
                "description exceeds {MAX_DESCRIPTION_LEN} characters"
            ));
        }
        if description.chars().any(|c| c.is_control() && c != '\n') {
            return Err("description contains control characters".into());
        }
    }
    if let Some(cover) = deck.cover_card_name.as_deref() {
        if cover.chars().count() > MAX_CARD_NAME_LEN || cover.chars().any(char::is_control) {
            return Err("cover card name is invalid".into());
        }
    }
    validate_board(&deck.cards, 1, MAX_MAIN_CARDS, "main deck")?;
    validate_board(&deck.sideboard, 0, MAX_SIDEBOARD_CARDS, "sideboard")?;
    if let Some(commanders) = deck.commanders.as_deref() {
        validate_board(commanders, 0, MAX_COMMANDERS, "commanders")?;
    }
    for (board, label) in [
        (deck.maybeboard.as_deref(), "maybeboard"),
        (deck.attractions.as_deref(), "attractions"),
        (deck.contraptions.as_deref(), "contraptions"),
        (deck.schemes.as_deref(), "schemes"),
        (deck.planes.as_deref(), "planes"),
        (deck.tokens.as_deref(), "tokens"),
    ] {
        if let Some(cards) = board {
            validate_board(cards, 0, MAX_EXTRA_BOARD_CARDS, label)?;
        }
    }
    if let Some(companion) = deck.companion.as_ref() {
        validate_card(companion, "companion")?;
    }
    if let Some(labels) = deck.labels.as_deref() {
        if labels.len() > MAX_LABELS {
            return Err(format!("more than {MAX_LABELS} labels"));
        }
        for label in labels {
            validate_line(&label.name, 1, MAX_LABEL_LEN, "label")?;
        }
    }
    Ok(())
}

pub fn sanitize(deck: &mut Deck) {
    deck.version = None;
    deck.id = None;
    deck.playmat = None;
    deck.playmat_settings = None;
    deck.stack_positions = None;
}

fn validate_line(value: &str, min: usize, max: usize, field: &str) -> Result<(), String> {
    let trimmed = value.trim();
    let len = trimmed.chars().count();
    if len < min {
        return Err(format!("{field} is required"));
    }
    if len > max {
        return Err(format!("{field} exceeds {max} characters"));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(format!("{field} contains control characters"));
    }
    Ok(())
}

fn validate_board(cards: &[DeckCard], min: usize, max: usize, label: &str) -> Result<(), String> {
    if cards.len() < min {
        return Err(format!("{label} is empty"));
    }
    if cards.len() > max {
        return Err(format!("{label} exceeds {max} cards"));
    }
    for card in cards {
        validate_card(card, label)?;
    }
    Ok(())
}

fn validate_card(card: &DeckCard, board: &str) -> Result<(), String> {
    let name = &card.identity.name;
    let name_len = name.chars().count();
    if name_len == 0 || name_len > MAX_CARD_NAME_LEN {
        return Err(format!("{board} contains a card with an invalid name"));
    }
    if card.identity.set_code.chars().count() > MAX_SET_CODE_LEN {
        return Err(format!("{board} card {name} has an invalid set code"));
    }
    if card.rules.text.chars().count() > MAX_RULES_TEXT_LEN {
        return Err(format!("{board} card {name} has oversized rules text"));
    }
    let uris = &card.uris;
    for uri in [
        &uris.small,
        &uris.normal,
        &uris.large,
        &uris.png,
        &uris.art_crop,
        &uris.border_crop,
    ] {
        validate_image_uri(uri, name)?;
    }
    Ok(())
}

fn validate_image_uri(uri: &str, card_name: &str) -> Result<(), String> {
    if uri.is_empty() {
        return Ok(());
    }
    let Some(rest) = uri.strip_prefix("https://") else {
        return Err(format!("card {card_name} has a non-https image url"));
    };
    let host = rest.split('/').next().unwrap_or("");
    let allowed = ALLOWED_IMAGE_HOSTS
        .iter()
        .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")));
    if !allowed {
        return Err(format!(
            "card {card_name} has an image url outside scryfall"
        ));
    }
    Ok(())
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use manabrew_protocol::deck_dto::{CardImageUris, DeckCardIdentity};

    pub fn card(name: &str) -> DeckCard {
        DeckCard {
            identity: DeckCardIdentity {
                name: name.into(),
                set_code: "m21".into(),
                card_number: "1".into(),
                ..Default::default()
            },
            uris: CardImageUris {
                normal: "https://cards.scryfall.io/normal/front/x.jpg".into(),
                ..Default::default()
            },
            ..Default::default()
        }
    }

    pub fn request(author: &str, cards: usize) -> PublishDeckRequest {
        PublishDeckRequest {
            author: author.into(),
            deck: Deck {
                name: "Test Deck".into(),
                cards: (0..cards).map(|i| card(&format!("Card {i}"))).collect(),
                ..Default::default()
            },
        }
    }

    #[test]
    fn accepts_valid_request() {
        assert_eq!(validate(&request("tester", 60)), Ok(()));
    }

    #[test]
    fn rejects_bad_author() {
        assert!(validate(&request("", 60)).is_err());
        assert!(validate(&request("   ", 60)).is_err());
        assert!(validate(&request(&"x".repeat(51), 60)).is_err());
        assert!(validate(&request("a\u{7}b", 60)).is_err());
    }

    #[test]
    fn rejects_bad_deck_shape() {
        assert!(validate(&request("tester", 0)).is_err());
        assert!(validate(&request("tester", 601)).is_err());
        let mut oversized_name = request("tester", 1);
        oversized_name.deck.name = "x".repeat(101);
        assert!(validate(&oversized_name).is_err());
    }

    #[test]
    fn rejects_non_scryfall_image_urls() {
        let mut req = request("tester", 1);
        req.deck.cards[0].uris.normal = "https://evil.example/x.jpg".into();
        assert!(validate(&req).is_err());
        req.deck.cards[0].uris.normal = "data:image/png;base64,AAAA".into();
        assert!(validate(&req).is_err());
        req.deck.cards[0].uris.normal = "https://evil-scryfall.io/x.jpg".into();
        assert!(validate(&req).is_err());
        req.deck.cards[0].uris.normal = "https://cards.scryfall.io/x.jpg".into();
        assert_eq!(validate(&req), Ok(()));
    }

    #[test]
    fn sanitize_strips_editor_payload() {
        let mut deck = request("tester", 1).deck;
        deck.version = Some("1".into());
        deck.id = Some("local".into());
        deck.playmat = Some("data:image/png;base64,AAAA".into());
        sanitize(&mut deck);
        assert!(deck.version.is_none());
        assert!(deck.id.is_none());
        assert!(deck.playmat.is_none());
        assert!(deck.playmat_settings.is_none());
        assert!(deck.stack_positions.is_none());
    }
}
