use crate::prompt::{
    ActivatableAbilityInfo, AvailableAction, AvailableActionKind, Mana, ManaColor,
};

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

pub(crate) fn mana_ability_actions(
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
                kind: AvailableActionKind::ActivateAbility(ActivatableAbilityInfo {
                    card_id: card_id.to_string(),
                    ability_index,
                    description: description.to_string(),
                    is_mana_ability: true,
                    cost: cost.clone(),
                    produced_mana: choice.produced_mana,
                }),
            }
        })
        .collect()
}

struct ManaChoice {
    action_color: Option<&'static str>,
    produced_mana: Option<Vec<Mana>>,
}

fn split_mana_choices(
    produced_mana: Option<&str>,
    produced_mana_amount: Option<i32>,
) -> Vec<ManaChoice> {
    let Some(raw_produced_mana) = produced_mana else {
        return vec![prompt_choice()];
    };
    let tokens = produced_mana_tokens(raw_produced_mana);
    if tokens.is_empty() {
        return vec![prompt_choice()];
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
            return vec![prompt_choice()];
        }
        if is_any {
            return choices_for_letters(ANY_COLOR_LETTERS, amount);
        }
        let letters = unique_mana_letters(&mana_tokens);
        if !letters.is_empty() {
            return choices_for_letters(letters, amount);
        }
    }

    match mana_tokens_to_letters(&mana_tokens) {
        Some(letters) => vec![ManaChoice {
            action_color: None,
            produced_mana: Some(letters_to_mana(&letters, amount)),
        }],
        None => vec![prompt_choice()],
    }
}

fn prompt_choice() -> ManaChoice {
    ManaChoice {
        action_color: None,
        produced_mana: None,
    }
}

fn choices_for_letters(
    letters: impl IntoIterator<Item = &'static str>,
    amount: i32,
) -> Vec<ManaChoice> {
    letters
        .into_iter()
        .map(|letter| ManaChoice {
            action_color: Some(letter),
            produced_mana: Some(letters_to_mana(&[letter], amount)),
        })
        .collect()
}

fn letters_to_mana(letters: &[&str], amount: i32) -> Vec<Mana> {
    let amount = amount.max(1);
    let mut out: Vec<Mana> = Vec::new();
    for letter in letters {
        let Some(color) = letter_to_color(letter) else {
            continue;
        };
        match out.iter_mut().find(|mana| mana.color == color) {
            Some(mana) => mana.amount += amount,
            None => out.push(Mana { color, amount }),
        }
    }
    out
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

fn parse_card_and_index(rest: &str) -> Option<(&str, usize)> {
    let (card_id, index) = rest.rsplit_once(':')?;
    Some((card_id, index.parse().ok()?))
}

fn is_mana_letter(token: &str) -> bool {
    matches!(token, "W" | "U" | "B" | "R" | "G" | "C")
}

fn letter_to_color(letter: &str) -> Option<ManaColor> {
    match letter {
        "W" => Some(ManaColor::White),
        "U" => Some(ManaColor::Blue),
        "B" => Some(ManaColor::Black),
        "R" => Some(ManaColor::Red),
        "G" => Some(ManaColor::Green),
        "C" => Some(ManaColor::Colorless),
        _ => None,
    }
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
