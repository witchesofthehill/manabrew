use std::collections::BTreeMap;

use forge_card_script::{parse_script_svar_numeric_expression, OwnedSVarNumericExpression};

use crate::ability::ability_factory::AbilityRecordType;
use crate::parsing::{Params, ParsedParams};

#[derive(Debug, Clone)]
pub struct ParsedSVar {
    pub raw: String,
    pub kind: ParsedSVarKind,
}

#[derive(Debug, Clone)]
pub enum ParsedSVarKind {
    Ability {
        record: AbilityRecordType,
        api: Option<String>,
        params: Params,
    },
    NumericExpression {
        expression: OwnedSVarNumericExpression,
    },
    ParamRecord {
        params: Params,
    },
    Number {
        value: String,
    },
    Count {
        raw: String,
    },
    Raw {
        value: String,
    },
}

#[derive(Debug, Clone, Default)]
pub struct ParsedSVarCache {
    entries: BTreeMap<String, ParsedSVar>,
}

impl ParsedSVarCache {
    pub fn get_or_parse(&mut self, name: &str, raw: &str) -> &ParsedSVar {
        let needs_parse = self
            .entries
            .get(name)
            .is_none_or(|cached| cached.raw != raw);
        if needs_parse {
            self.entries
                .insert(name.to_string(), ParsedSVar::parse(raw));
        }
        self.entries
            .get(name)
            .expect("parsed SVar cache entry inserted before lookup")
    }

    pub fn remove(&mut self, name: &str) {
        self.entries.remove(name);
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }
}

impl ParsedSVar {
    pub fn parse(raw: &str) -> Self {
        let trimmed = raw.trim();
        let params = ParsedParams::parse(trimmed);
        let kind = if let Some(record) = AbilityRecordType::from_parsed(&params) {
            let api = params.get(record.prefix()).map(str::to_string);
            ParsedSVarKind::Ability {
                record,
                api,
                params: Params::from_parsed(&params),
            }
        } else if let Some(expression) = parse_script_svar_numeric_expression(trimmed) {
            match expression.to_owned_expression() {
                OwnedSVarNumericExpression::Number(value) => ParsedSVarKind::Number { value },
                OwnedSVarNumericExpression::Count(raw) => ParsedSVarKind::Count { raw },
                expression => ParsedSVarKind::NumericExpression { expression },
            }
        } else if trimmed.contains('$') {
            ParsedSVarKind::ParamRecord {
                params: Params::from_parsed(&params),
            }
        } else {
            ParsedSVarKind::Raw {
                value: trimmed.to_string(),
            }
        };

        Self {
            raw: trimmed.to_string(),
            kind,
        }
    }
}
