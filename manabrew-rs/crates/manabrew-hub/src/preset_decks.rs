use std::fs;
use std::io;
use std::path::Path;

use manabrew_protocol::deck_dto::{
    CardBackFaceSummary, CardImageUris, CardPart, CardRulesSummary, Deck, DeckCard,
    DeckCardIdentity, DeckFormat,
};
use serde::Deserialize;

pub struct PresetDeck {
    pub key: String,
    pub deck: Deck,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PresetDeckFile {
    label: String,
    desc: String,
    color: String,
    format: Option<String>,
    commander: Option<String>,
    cover_card_name: Option<String>,
    cards: Vec<PresetDeckCard>,
    #[serde(default)]
    sideboard: Vec<PresetDeckCard>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PresetDeckCard {
    name: String,
    count: u32,
    set: String,
    card_number: String,
    #[serde(default)]
    mana_cost: String,
    #[serde(default)]
    colors: Vec<String>,
    #[serde(default)]
    color_identity: Vec<String>,
    #[serde(default)]
    cmc: f32,
    #[serde(default)]
    types: Vec<String>,
    #[serde(default)]
    subtypes: Vec<String>,
    #[serde(default)]
    supertypes: Vec<String>,
    #[serde(default)]
    text: String,
    layout: Option<String>,
    power: Option<String>,
    toughness: Option<String>,
    #[serde(default)]
    uris: CardImageUris,
    back_face: Option<CardBackFaceSummary>,
    all_parts: Option<Vec<CardPart>>,
}

pub fn load_preset_decks(directory: &Path) -> io::Result<Vec<PresetDeck>> {
    let keys: Vec<String> =
        serde_json::from_str(&fs::read_to_string(directory.join("index.json"))?)
            .map_err(invalid_data)?;
    keys.into_iter()
        .map(|key| {
            let path = directory.join(format!("{key}.json"));
            let file: PresetDeckFile =
                serde_json::from_str(&fs::read_to_string(path)?).map_err(invalid_data)?;
            Ok(PresetDeck {
                deck: expand_preset_deck(&key, file)?,
                key,
            })
        })
        .collect()
}

fn expand_preset_deck(key: &str, preset: PresetDeckFile) -> io::Result<Deck> {
    let commander_name = preset.commander.as_deref().map(front_face_name);
    let format = preset
        .format
        .as_deref()
        .map(parse_preset_format)
        .transpose()?
        .unwrap_or(DeckFormat::Standard);
    let mut cards = Vec::new();
    let mut sideboard = Vec::new();
    let mut commander = None;
    let mut index = 0;
    for (entry, in_sideboard) in preset
        .cards
        .iter()
        .map(|entry| (entry, false))
        .chain(preset.sideboard.iter().map(|entry| (entry, true)))
    {
        let name = front_face_name(&entry.name).to_string();
        for _ in 0..entry.count {
            let card = DeckCard {
                identity: DeckCardIdentity {
                    id: format!("preset:{key}:{index}:{name}"),
                    name: name.clone(),
                    set_code: entry.set.clone(),
                    card_number: entry.card_number.clone(),
                    oracle_id: None,
                    foil: Some(false),
                },
                rules: CardRulesSummary {
                    color: entry.colors.join(""),
                    color_identity: entry.color_identity.clone(),
                    mana_cost: entry.mana_cost.clone(),
                    cmc: entry.cmc,
                    types: entry.types.clone(),
                    subtypes: entry.subtypes.clone(),
                    supertypes: entry.supertypes.clone(),
                    keywords: None,
                    power: entry.power.clone(),
                    toughness: entry.toughness.clone(),
                    text: entry.text.clone(),
                    layout: entry.layout.clone(),
                    is_double_faced: entry.back_face.as_ref().map(|_| true),
                    back_face: entry.back_face.clone(),
                },
                uris: entry.uris.clone(),
                all_parts: entry.all_parts.clone(),
            };
            index += 1;
            if in_sideboard {
                sideboard.push(card);
            } else if commander.is_none() && commander_name == Some(name.as_str()) {
                commander = Some(card);
            } else {
                cards.push(card);
            }
        }
    }
    if commander_name.is_some() && commander.is_none() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("preset commander missing from cards: {}", preset.label),
        ));
    }
    Ok(Deck {
        id: Some(key.to_string()),
        name: preset.label,
        description: Some(preset.desc),
        color: Some(preset.color),
        format: Some(format),
        cards,
        sideboard,
        commanders: commander.map(|card| vec![card]),
        cover_card_name: preset
            .cover_card_name
            .as_deref()
            .map(front_face_name)
            .or(commander_name)
            .map(str::to_string),
        version: None,
        attractions: None,
        contraptions: None,
        schemes: None,
        planes: None,
        companion: None,
        maybeboard: None,
        draft: None,
        labels: None,
        cover_card_face: None,
        playmat: None,
        playmat_settings: None,
        stack_positions: None,
        tokens: None,
    })
}

fn front_face_name(name: &str) -> &str {
    name.split_once(" // ").map_or(name, |(front, _)| front)
}

fn parse_preset_format(format: &str) -> io::Result<DeckFormat> {
    if format == "historicBrawl" {
        return Ok(DeckFormat::Brawl);
    }
    serde_json::from_value(serde_json::Value::String(format.to_string())).map_err(invalid_data)
}

fn invalid_data(error: serde_json::Error) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, error)
}
