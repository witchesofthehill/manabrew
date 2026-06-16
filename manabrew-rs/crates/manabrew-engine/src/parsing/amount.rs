#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AmountExpr {
    Literal(i32),
    X,
    SVar(String),
    Raw(String),
}

impl AmountExpr {
    pub fn from_semantic(amount: &crate::parsing::SemanticAmount<'_>) -> Self {
        match amount {
            crate::parsing::SemanticAmount::Literal(value) => Self::Literal(*value),
            crate::parsing::SemanticAmount::X => Self::X,
            crate::parsing::SemanticAmount::SVar(name) => Self::SVar((*name).to_string()),
            crate::parsing::SemanticAmount::Any
            | crate::parsing::SemanticAmount::All
            | crate::parsing::SemanticAmount::Expression(_) => Self::Raw(amount_to_raw(amount)),
        }
    }

    pub fn parse(raw: &str) -> Self {
        let trimmed = raw.trim();
        if let Ok(value) = trimmed.parse::<i32>() {
            Self::Literal(value)
        } else if trimmed == "X" {
            Self::X
        } else if trimmed.is_empty() {
            Self::Raw(String::new())
        } else if is_svar_name(trimmed) {
            Self::SVar(trimmed.to_string())
        } else {
            Self::Raw(trimmed.to_string())
        }
    }

    pub fn resolve_for_spell_ability(
        &self,
        game: &crate::game::GameState,
        sa: &crate::spellability::SpellAbility,
        default: i32,
    ) -> i32 {
        match self {
            Self::Literal(value) => *value,
            Self::X => crate::svar::resolve_numeric_value(game, sa, "X", default),
            Self::SVar(name) | Self::Raw(name) => {
                crate::svar::resolve_numeric_value(game, sa, name, default)
            }
        }
    }
}

fn amount_to_raw(amount: &crate::parsing::SemanticAmount<'_>) -> String {
    match amount {
        crate::parsing::SemanticAmount::Literal(value) => value.to_string(),
        crate::parsing::SemanticAmount::X => "X".to_string(),
        crate::parsing::SemanticAmount::Any => "Any".to_string(),
        crate::parsing::SemanticAmount::All => "All".to_string(),
        crate::parsing::SemanticAmount::SVar(name)
        | crate::parsing::SemanticAmount::Expression(name) => (*name).to_string(),
    }
}

fn is_svar_name(raw: &str) -> bool {
    let mut chars = raw.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first == '_' || first.is_ascii_alphabetic())
        && chars.all(|c| c == '_' || c.is_ascii_alphanumeric())
}
