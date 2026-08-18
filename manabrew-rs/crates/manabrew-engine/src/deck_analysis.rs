use std::collections::BTreeSet;

use forge_card_script::raw_get;
use forge_carddb::{CardFace, CardRules};

fn classify_line(line: &str, roles: &mut BTreeSet<&'static str>) {
    let api = raw_get(line, "SP")
        .or_else(|| raw_get(line, "AB"))
        .or_else(|| raw_get(line, "DB"));
    let Some(api) = api else { return };

    match api {
        "Mana" => {
            roles.insert("ramp");
        }
        "Draw" => {
            roles.insert("card-draw");
        }
        "Counter" => {
            roles.insert("counterspell");
            roles.insert("interaction");
        }
        "Destroy" | "Damage" | "Exile" | "Sacrifice" => {
            roles.insert("interaction");
            roles.insert("removal");
        }
        "Discard" => {
            roles.insert("discard");
            roles.insert("interaction");
        }
        "GainLife" => {
            roles.insert("lifegain");
        }
        "Token" | "CopyPermanent" => {
            roles.insert("token-maker");
        }
        "PutCounter" | "PutCounterAll" => {
            roles.insert("counters");
        }
        "Pump" | "PumpAll" | "PreventDamage" | "Regenerate" => {
            roles.insert("protection");
        }
        "ChangeZone" | "ChangeZoneAll" => {
            let origin = raw_get(line, "Origin").unwrap_or_default();
            let destination = raw_get(line, "Destination").unwrap_or_default();
            if origin.contains("Library")
                && (destination.contains("Hand") || destination.contains("Battlefield"))
            {
                roles.insert("tutor");
            } else if origin.contains("Graveyard") {
                roles.insert("recursion");
            } else if destination.contains("Exile")
                || destination.contains("Graveyard")
                || destination.contains("Hand")
            {
                roles.insert("interaction");
                roles.insert("removal");
            }
        }
        _ => {}
    }
}

fn classify_face(face: &CardFace, roles: &mut BTreeSet<&'static str>) {
    for line in face
        .abilities
        .iter()
        .chain(&face.static_abilities)
        .chain(&face.triggers)
        .chain(&face.replacements)
        .chain(face.svars.values())
    {
        classify_line(line, roles);
    }
}

pub fn classify_card_roles(card: &CardRules) -> Vec<String> {
    let mut roles = BTreeSet::new();
    classify_face(&card.main_part, &mut roles);
    if let Some(face) = &card.other_part {
        classify_face(face, &mut roles);
    }
    roles.into_iter().map(str::to_string).collect()
}
