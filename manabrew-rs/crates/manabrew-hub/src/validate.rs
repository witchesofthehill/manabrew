use manabrew_protocol::deck_dto::{Deck, DeckCard};
use manabrew_protocol::game::PlaymatSettings;

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
const MAX_COLOR_LEN: usize = 32;
const ALLOWED_IMAGE_HOSTS: [&str; 2] = ["scryfall.io", "scryfall.com"];

pub fn validate(author: &str, deck: &Deck) -> Result<(), String> {
    validate_line(author, 1, MAX_AUTHOR_LEN, "author")?;
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

const MIN_HANDLE_LEN: usize = 3;
const MAX_HANDLE_LEN: usize = 24;

pub fn validate_handle(handle: &str) -> Result<(), String> {
    let len = handle.chars().count();
    if !(MIN_HANDLE_LEN..=MAX_HANDLE_LEN).contains(&len) {
        return Err(format!(
            "handle must be {MIN_HANDLE_LEN}-{MAX_HANDLE_LEN} characters"
        ));
    }
    if !handle
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("handle may only contain letters, digits, _ and -".into());
    }
    if handle.starts_with('-') || handle.ends_with('-') {
        return Err("handle may not start or end with -".into());
    }
    Ok(())
}

const MAX_GUEST_NAME_LEN: usize = 40;

pub fn validate_guest_name(name: &str) -> Result<(), String> {
    let trimmed = name.trim();
    let len = trimmed.chars().count();
    if len == 0 {
        return Err("username is required".into());
    }
    if len > MAX_GUEST_NAME_LEN {
        return Err(format!("username exceeds {MAX_GUEST_NAME_LEN} characters"));
    }
    if trimmed.chars().any(char::is_control) {
        return Err("username contains control characters".into());
    }
    Ok(())
}

pub fn strip_name_tag(name: &str) -> &str {
    let bytes = name.as_bytes();
    if bytes.len() >= 5 {
        let (base, tag) = bytes.split_at(bytes.len() - 5);
        if tag[0] == b'@' && tag[1..].iter().all(u8::is_ascii_digit) {
            return &name[..base.len()];
        }
    }
    name
}

pub fn sanitize(deck: &mut Deck) {
    deck.version = None;
    deck.id = None;
    deck.playmat_url = None;
    deck.stack_positions = None;
    if let Some(settings) = deck.playmat_settings.as_mut() {
        sanitize_playmat_settings(settings);
    }
}

fn sanitize_playmat_settings(settings: &mut PlaymatSettings) {
    settings.color = settings.color.take().filter(|it| it.len() <= MAX_COLOR_LEN);
    settings.border_color = settings
        .border_color
        .take()
        .filter(|it| it.len() <= MAX_COLOR_LEN);
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

    pub fn deck(cards: usize) -> Deck {
        Deck {
            name: "Test Deck".into(),
            cards: (0..cards).map(|i| card(&format!("Card {i}"))).collect(),
            ..Default::default()
        }
    }

    #[test]
    fn accepts_valid_request() {
        assert_eq!(validate("tester", &deck(60)), Ok(()));
    }

    #[test]
    fn rejects_bad_author() {
        let deck = deck(60);
        assert!(validate("", &deck).is_err());
        assert!(validate("   ", &deck).is_err());
        assert!(validate(&"x".repeat(51), &deck).is_err());
        assert!(validate("a\u{7}b", &deck).is_err());
    }

    #[test]
    fn rejects_bad_deck_shape() {
        assert!(validate("tester", &deck(0)).is_err());
        assert!(validate("tester", &deck(601)).is_err());
        let mut oversized_name = deck(1);
        oversized_name.name = "x".repeat(101);
        assert!(validate("tester", &oversized_name).is_err());
    }

    #[test]
    fn rejects_non_scryfall_image_urls() {
        let mut deck = deck(1);
        deck.cards[0].uris.normal = "https://evil.example/x.jpg".into();
        assert!(validate("tester", &deck).is_err());
        deck.cards[0].uris.normal = "data:image/png;base64,AAAA".into();
        assert!(validate("tester", &deck).is_err());
        deck.cards[0].uris.normal = "https://evil-scryfall.io/x.jpg".into();
        assert!(validate("tester", &deck).is_err());
        deck.cards[0].uris.normal = "https://cards.scryfall.io/x.jpg".into();
        assert_eq!(validate("tester", &deck), Ok(()));
    }

    #[test]
    fn sanitize_strips_editor_payload() {
        let mut deck = deck(1);
        deck.version = Some("1".into());
        deck.id = Some("local".into());
        deck.playmat_url = Some("https://elsewhere.example/x.webp".into());
        deck.playmat_asset_id = Some("2a1f7c8e-0000-4000-8000-000000000001".into());
        deck.playmat_settings = Some(PlaymatSettings {
            color: Some("x".repeat(MAX_COLOR_LEN + 1)),
            ..PlaymatSettings::default()
        });
        sanitize(&mut deck);
        assert!(deck.version.is_none());
        assert!(deck.id.is_none());
        assert!(deck.playmat_url.is_none());
        assert!(deck.stack_positions.is_none());
        assert_eq!(
            deck.playmat_asset_id.as_deref(),
            Some("2a1f7c8e-0000-4000-8000-000000000001")
        );
        assert!(deck.playmat_settings.expect("settings").color.is_none());
    }
}
