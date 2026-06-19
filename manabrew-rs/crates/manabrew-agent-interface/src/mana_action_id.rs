use crate::prompt::{ActivatableAbilityInfo, AvailableAction, AvailableActionKind};

const ANY_COLOR_LETTERS: [&str; 5] = ["W", "U", "B", "R", "G"];

pub(crate) struct ParsedTapAction<'a> {
    pub(crate) card_id: &'a str,
    pub(crate) ability_index: Option<usize>,
    pub(crate) color: Option<&'a str>,
}

pub(crate) fn parse_tap_action_id(rest: &str) -> ParsedTapAction<'_> {
    if let Some((before_color, color)) = rest.rsplit_once(':') {
        if is_mana_letter(color) {
            if let Some((card_id, ability_index)) = parse_card_and_index(before_color) {
                return ParsedTapAction {
                    card_id,
                    ability_index: Some(ability_index),
                    color: Some(color),
                };
            }
        }
    }
    if let Some((card_id, ability_index)) = parse_card_and_index(rest) {
        return ParsedTapAction {
            card_id,
            ability_index: Some(ability_index),
            color: None,
        };
    }
    ParsedTapAction {
        card_id: rest,
        ability_index: None,
        color: None,
    }
}

pub(crate) fn priority_mana_actions(
    card_id: &str,
    ability_index: usize,
    description: &str,
    cost: Option<String>,
    produced_mana: Option<String>,
    produced_mana_amount: Option<i32>,
) -> Vec<AvailableAction> {
    split_mana_choices(produced_mana.as_deref(), produced_mana_amount)
        .into_iter()
        .map(|choice| {
            let id = match choice.action_color {
                Some(color) => format!("tap:{card_id}:{ability_index}:{color}"),
                None => format!("tap:{card_id}:{ability_index}"),
            };
            AvailableAction {
                id,
                kind: AvailableActionKind::ActivateAbility {
                    card_id: card_id.to_string(),
                    ability_index,
                    description: description.to_string(),
                    cost: cost.clone(),
                    is_mana_ability: true,
                    produced_mana: choice.produced_mana,
                },
            }
        })
        .collect()
}

pub(crate) fn payment_mana_ability_options(
    card_id: &str,
    ability_index: usize,
    description: &str,
    cost: Option<String>,
    produced_mana: Option<String>,
    produced_mana_amount: Option<i32>,
) -> Vec<ActivatableAbilityInfo> {
    split_mana_choices(produced_mana.as_deref(), produced_mana_amount)
        .into_iter()
        .map(|choice| ActivatableAbilityInfo {
            card_id: card_id.to_string(),
            ability_index,
            description: description.to_string(),
            is_mana_ability: true,
            cost: cost.clone(),
            produced_mana: choice.produced_mana,
            color: choice.action_color.map(str::to_string),
        })
        .collect()
}

struct ManaChoice {
    action_color: Option<&'static str>,
    produced_mana: Option<String>,
}

fn split_mana_choices(
    produced_mana: Option<&str>,
    produced_mana_amount: Option<i32>,
) -> Vec<ManaChoice> {
    let Some(raw_produced_mana) = produced_mana else {
        return vec![ManaChoice {
            action_color: None,
            produced_mana: None,
        }];
    };
    let tokens = produced_mana_tokens(raw_produced_mana);
    if tokens.is_empty() {
        return vec![ManaChoice {
            action_color: None,
            produced_mana: Some(raw_produced_mana.to_string()),
        }];
    }

    let is_combo = tokens.iter().any(|token| token == "COMBO");
    let mana_tokens: Vec<&str> = tokens
        .iter()
        .map(String::as_str)
        .filter(|token| *token != "COMBO")
        .collect();
    let is_any = mana_tokens.iter().any(|token| *token == "ANY");
    let amount = produced_mana_amount.unwrap_or(1).max(1);

    if is_any && !is_combo {
        return choices_for_letters(ANY_COLOR_LETTERS, amount);
    }
    if is_combo {
        if amount > 1 {
            return fixed_choice(raw_produced_mana);
        }
        if is_any {
            return choices_for_letters(ANY_COLOR_LETTERS, amount);
        }
        let letters = unique_mana_letters(&mana_tokens);
        if !letters.is_empty() {
            return choices_for_letters(letters, amount);
        }
    }

    let letters = mana_tokens_to_letters(&mana_tokens);
    if let Some(letters) = letters {
        return vec![ManaChoice {
            action_color: None,
            produced_mana: Some(mana_string(&letters, amount)),
        }];
    }

    fixed_choice(raw_produced_mana)
}

fn fixed_choice(produced_mana: &str) -> Vec<ManaChoice> {
    vec![ManaChoice {
        action_color: None,
        produced_mana: Some(produced_mana.to_string()),
    }]
}

fn choices_for_letters(
    letters: impl IntoIterator<Item = &'static str>,
    amount: i32,
) -> Vec<ManaChoice> {
    letters
        .into_iter()
        .map(|letter| ManaChoice {
            action_color: Some(letter),
            produced_mana: Some(mana_string(&[letter], amount)),
        })
        .collect()
}

fn produced_mana_tokens(produced_mana: &str) -> Vec<String> {
    produced_mana
        .split(|c: char| c.is_whitespace() || matches!(c, '{' | '}' | ',' | '/'))
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(|token| token.to_ascii_uppercase())
        .collect()
}

fn unique_mana_letters(tokens: &[&str]) -> Vec<&'static str> {
    let mut letters = Vec::new();
    for token in tokens {
        if let Some(letter) = mana_token_to_letter(token) {
            if !letters.contains(&letter) {
                letters.push(letter);
            }
        }
    }
    letters
}

fn mana_tokens_to_letters(tokens: &[&str]) -> Option<Vec<&'static str>> {
    tokens
        .iter()
        .map(|token| mana_token_to_letter(token))
        .collect()
}

fn mana_string(letters: &[&str], amount: i32) -> String {
    let amount = amount.max(1) as usize;
    (0..amount)
        .flat_map(|_| letters.iter().copied())
        .collect::<Vec<_>>()
        .join(" ")
}

fn parse_card_and_index(rest: &str) -> Option<(&str, usize)> {
    let (card_id, index) = rest.rsplit_once(':')?;
    Some((card_id, index.parse().ok()?))
}

fn is_mana_letter(token: &str) -> bool {
    matches!(token, "W" | "U" | "B" | "R" | "G" | "C")
}

fn mana_token_to_letter(token: &str) -> Option<&'static str> {
    match token {
        "WHITE" | "W" => Some("W"),
        "BLUE" | "U" => Some("U"),
        "BLACK" | "B" => Some("B"),
        "RED" | "R" => Some("R"),
        "GREEN" | "G" => Some("G"),
        "COLORLESS" | "C" => Some("C"),
        _ => None,
    }
}
