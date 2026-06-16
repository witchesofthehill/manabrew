use std::borrow::Cow;

use serde::{Deserialize, Serialize};

use crate::parsing::{
    keys, parse_semantic_param_value, SemanticParamValue, SemanticProducedMana,
    SemanticProducedManaCombo,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProducedMana {
    Any,
    Chosen,
    Combo(ProducedManaCombo),
    Special(String),
    Fixed(Vec<String>),
    Raw(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProducedManaCombo {
    Any,
    Chosen,
    ColorIdentity,
    Colors(Vec<String>),
    Raw(String),
}

impl ProducedMana {
    pub fn from_semantic(value: &SemanticProducedMana<'_>) -> Self {
        match value {
            SemanticProducedMana::Any => Self::Any,
            SemanticProducedMana::Chosen => Self::Chosen,
            SemanticProducedMana::Combo(combo) => Self::Combo(match combo {
                SemanticProducedManaCombo::Any => ProducedManaCombo::Any,
                SemanticProducedManaCombo::Chosen => ProducedManaCombo::Chosen,
                SemanticProducedManaCombo::ColorIdentity => ProducedManaCombo::ColorIdentity,
                SemanticProducedManaCombo::Colors(colors) => ProducedManaCombo::Colors(
                    colors.iter().map(|value| (*value).to_string()).collect(),
                ),
                SemanticProducedManaCombo::Raw(raw) => ProducedManaCombo::Raw((*raw).to_string()),
            }),
            SemanticProducedMana::Special(kind) => Self::Special((*kind).to_string()),
            SemanticProducedMana::Fixed(tokens) => {
                Self::Fixed(tokens.iter().map(|value| (*value).to_string()).collect())
            }
            SemanticProducedMana::Raw(raw) => Self::Raw((*raw).to_string()),
        }
    }

    pub fn from_raw_boundary(raw: &str) -> Self {
        match parse_semantic_param_value(keys::PRODUCED, raw) {
            SemanticParamValue::ProducedMana(produced) => Self::from_semantic(&produced),
            _ => Self::Raw(raw.trim().to_string()),
        }
    }

    pub fn as_script_text(&self) -> Cow<'_, str> {
        match self {
            Self::Any => Cow::Borrowed("Any"),
            Self::Chosen => Cow::Borrowed("Chosen"),
            Self::Combo(ProducedManaCombo::Any) => Cow::Borrowed("Combo Any"),
            Self::Combo(ProducedManaCombo::Chosen) => Cow::Borrowed("Combo Chosen"),
            Self::Combo(ProducedManaCombo::ColorIdentity) => Cow::Borrowed("Combo ColorIdentity"),
            Self::Combo(ProducedManaCombo::Colors(colors)) => Cow::Owned(if colors.is_empty() {
                "Combo".to_string()
            } else {
                format!("Combo {}", colors.join(" "))
            }),
            Self::Combo(ProducedManaCombo::Raw(raw)) => Cow::Owned(if raw.is_empty() {
                "Combo".to_string()
            } else {
                format!("Combo {raw}")
            }),
            Self::Special(kind) => Cow::Owned(format!("Special {kind}")),
            Self::Fixed(tokens) => match tokens.as_slice() {
                [single] => Cow::Borrowed(single.as_str()),
                _ => Cow::Owned(tokens.join(" ")),
            },
            Self::Raw(raw) => Cow::Borrowed(raw.as_str()),
        }
    }

    pub fn is_combo_color_identity(&self) -> bool {
        matches!(self, Self::Combo(ProducedManaCombo::ColorIdentity))
    }

    pub fn is_any_like(&self) -> bool {
        match self {
            Self::Any | Self::Combo(ProducedManaCombo::Any) => true,
            Self::Raw(raw) => raw
                .split_whitespace()
                .any(|tok| tok.eq_ignore_ascii_case("Any")),
            _ => false,
        }
    }

    pub fn is_choice_like(&self) -> bool {
        match self {
            Self::Any | Self::Combo(_) => true,
            Self::Raw(raw) => {
                raw.contains(',')
                    || raw
                        .split_whitespace()
                        .any(|tok| tok.eq_ignore_ascii_case("Any"))
            }
            _ => false,
        }
    }

    pub fn special_kind(&self) -> Option<&str> {
        match self {
            Self::Special(kind) => Some(kind),
            _ => None,
        }
    }

    pub fn fixed_tokens(&self) -> Option<&[String]> {
        match self {
            Self::Fixed(tokens) => Some(tokens),
            _ => None,
        }
    }
}
