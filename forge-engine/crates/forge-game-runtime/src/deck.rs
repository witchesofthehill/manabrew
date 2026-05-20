use forge_agent_interface::deck_dto::{Deck, DeckCard as WireDeckCard};
use forge_carddb::{CardDatabase, CardRules};
use forge_engine_core::card::{Card, CardInstance};
use forge_engine_core::game::GameState;
use forge_engine_core::ids::PlayerId;
use forge_engine_core::player::RegisteredPlayer;
use forge_foundation::{CoreType, ZoneType};

#[derive(Debug, Clone)]
pub struct DeckCardIdentity {
    pub name: String,
    pub set_code: String,
    pub card_number: String,
    pub section: Option<String>,
}

pub fn deck_to_identities(deck: &Deck) -> Vec<DeckCardIdentity> {
    let mut out: Vec<DeckCardIdentity> = Vec::new();
    let push_pile = |out: &mut Vec<DeckCardIdentity>, list: &[WireDeckCard], section: &str| {
        for c in list {
            out.push(DeckCardIdentity {
                name: c.identity.name.clone(),
                set_code: c.identity.set_code.clone(),
                card_number: c.identity.card_number.clone(),
                section: Some(section.to_string()),
            });
        }
    };
    push_pile(&mut out, &deck.cards, "main");
    push_pile(&mut out, &deck.sideboard, "sideboard");
    if let Some(list) = &deck.commanders {
        push_pile(&mut out, list, "commander");
    }
    if let Some(list) = &deck.attractions {
        push_pile(&mut out, list, "attractions");
    }
    if let Some(list) = &deck.contraptions {
        push_pile(&mut out, list, "contraptions");
    }
    if let Some(list) = &deck.schemes {
        push_pile(&mut out, list, "schemes");
    }
    if let Some(list) = &deck.planes {
        push_pile(&mut out, list, "planes");
    }
    out
}

#[derive(Debug, Clone)]
pub struct PreparedRegisteredPlayer {
    pub registered: RegisteredPlayer,
    pub cards: Vec<(CardInstance, ZoneType)>,
}

pub fn prepare_registered_player(
    name: impl Into<String>,
    db: &CardDatabase,
    identities: &[DeckCardIdentity],
) -> PreparedRegisteredPlayer {
    let mut registered = RegisteredPlayer::new(name);
    let cards = prepare_cards_from_identities(db, identities, &mut registered);
    PreparedRegisteredPlayer { registered, cards }
}

pub fn prepare_cards_from_identities(
    db: &CardDatabase,
    identities: &[DeckCardIdentity],
    registered: &mut RegisteredPlayer,
) -> Vec<(CardInstance, ZoneType)> {
    let mut cards = Vec::new();
    for identity in identities {
        if let Some(rules) = lookup_card_rules(db, &identity.name) {
            let mut card = card_rules_to_instance(rules, PlayerId(0));
            if !identity.set_code.is_empty() {
                card.set_code = Some(identity.set_code.clone());
            }
            if !identity.card_number.is_empty() {
                card.card_number = Some(identity.card_number.clone());
            }
            let destination = deck_zone_for_identity(identity.section.as_deref(), &card);
            register_card_name(registered, &card.card_name, destination);
            cards.push((card, destination));
        }
    }
    cards
}

pub fn force_commander_by_name(
    player: &mut PreparedRegisteredPlayer,
    commander_name: &str,
) -> bool {
    if player
        .registered
        .commanders
        .iter()
        .any(|name| name == commander_name)
    {
        return true;
    }

    let Some((card, zone)) = player
        .cards
        .iter_mut()
        .find(|(card, _)| card.card_name == commander_name)
    else {
        return false;
    };

    *zone = ZoneType::Command;
    card.is_commander = true;
    player
        .registered
        .commanders
        .push(commander_name.to_string());
    player
        .registered
        .current_deck
        .retain(|name| name != commander_name);
    player
        .registered
        .original_deck
        .retain(|name| name != commander_name);
    true
}

pub fn instantiate_registered_players(
    game: &mut GameState,
    prepared_players: Vec<PreparedRegisteredPlayer>,
) {
    for (idx, prepared) in prepared_players.into_iter().enumerate() {
        let pid = PlayerId(idx as u32);
        game.initialize_registered_player_cards(pid, &prepared.registered, prepared.cards, None);
    }
}

pub fn register_card_name(
    registered: &mut RegisteredPlayer,
    card_name: &str,
    destination: ZoneType,
) {
    let name = card_name.to_string();
    match destination {
        ZoneType::Library => {
            registered.original_deck.push(name.clone());
            registered.current_deck.push(name);
        }
        ZoneType::Command => registered.commanders.push(name),
        ZoneType::Battlefield => registered.cards_on_battlefield.push(name),
        ZoneType::SchemeDeck => registered.schemes.push(name),
        ZoneType::PlanarDeck => registered.planes.push(name),
        ZoneType::AttractionDeck => registered.attractions.push(name),
        ZoneType::ContraptionDeck => registered.contraptions.push(name),
        ZoneType::Sideboard => {}
        _ => {}
    }
}

pub fn lookup_card_rules<'a>(db: &'a CardDatabase, raw_name: &str) -> Option<&'a CardRules> {
    db.get_by_card_name(raw_name).or_else(|| {
        raw_name
            .split_once(" // ")
            .and_then(|(front_face, _)| db.get_by_card_name(front_face.trim()))
    })
}

pub fn fallback_deck_zone_for_card(card: &Card) -> ZoneType {
    if card
        .type_line
        .subtypes
        .iter()
        .any(|subtype| subtype.eq_ignore_ascii_case("Attraction"))
    {
        ZoneType::AttractionDeck
    } else if card
        .type_line
        .subtypes
        .iter()
        .any(|subtype| subtype.eq_ignore_ascii_case("Contraption"))
    {
        ZoneType::ContraptionDeck
    } else if card.type_line.core_types.contains(&CoreType::Scheme) {
        ZoneType::SchemeDeck
    } else if card.type_line.core_types.contains(&CoreType::Plane) {
        ZoneType::PlanarDeck
    } else {
        ZoneType::Library
    }
}

pub fn deck_zone_for_identity(section: Option<&str>, card: &Card) -> ZoneType {
    match section {
        Some("main") => ZoneType::Library,
        Some("sideboard") => ZoneType::Sideboard,
        Some("commander") => ZoneType::Command,
        Some("attractions") => ZoneType::AttractionDeck,
        Some("contraptions") => ZoneType::ContraptionDeck,
        Some("schemes") => ZoneType::SchemeDeck,
        Some("planes") => ZoneType::PlanarDeck,
        _ => fallback_deck_zone_for_card(card),
    }
}

pub fn card_rules_to_instance(rules: &CardRules, owner: PlayerId) -> CardInstance {
    CardInstance::from_rules(rules, owner)
}
