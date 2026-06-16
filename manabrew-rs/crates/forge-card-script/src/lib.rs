use std::ops::Range;

use smallvec::SmallVec;
use winnow::prelude::*;
use winnow::token::take_till;
use winnow::Result;

const AB: &str = "AB";
const SP: &str = "SP";
const DB: &str = "DB";
const ST: &str = "ST";

pub type ParamEntries<'a> = SmallVec<[ParamEntry<'a>; 8]>;
pub type ParamDiagnostics<'a> = SmallVec<[ParamDiagnostic<'a>; 4]>;
pub type ScriptLines<'a> = SmallVec<[ScriptLine<'a>; 32]>;
pub type ScriptDiagnostics<'a> = SmallVec<[ScriptDiagnostic<'a>; 8]>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParamEntry<'a> {
    pub key: &'a str,
    pub value: &'a str,
    pub key_span: Range<usize>,
    pub value_span: Range<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SemanticParam<'a> {
    pub key: &'a str,
    pub raw_value: &'a str,
    pub value: SemanticParamValue<'a>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SemanticParamValue<'a> {
    AbilityRecord(&'a str),
    Symbol(&'a str),
    ProducedMana(SemanticProducedMana<'a>),
    Boolean(bool),
    Integer(i32),
    Amount(SemanticAmount<'a>),
    ZoneList(SmallVec<[&'a str; 4]>),
    Selector(SemanticSelector<'a>),
    Reference(SemanticSelector<'a>),
    SVarReference(SmallVec<[&'a str; 4]>),
    Cost(&'a str),
    Text(&'a str),
    DelimitedList(SmallVec<[&'a str; 4]>),
    Transform(SemanticTransform<'a>),
    Comparison(SemanticComparison<'a>),
    Expression(&'a str),
    Raw(&'a str),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SemanticParamValueKind {
    AbilityRecord,
    Symbol,
    ProducedMana,
    Boolean,
    Integer,
    Amount,
    ZoneList,
    Selector,
    Reference,
    SVarReference,
    Cost,
    Text,
    DelimitedList,
    Transform,
    Comparison,
    Expression,
    Raw,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SemanticAmount<'a> {
    Literal(i32),
    X,
    Any,
    All,
    SVar(&'a str),
    Expression(&'a str),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SemanticProducedMana<'a> {
    Any,
    Chosen,
    Combo(SemanticProducedManaCombo<'a>),
    Special(&'a str),
    Fixed(SmallVec<[&'a str; 4]>),
    Raw(&'a str),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SemanticProducedManaCombo<'a> {
    Any,
    Chosen,
    ColorIdentity,
    Colors(SmallVec<[&'a str; 4]>),
    Raw(&'a str),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SemanticSelector<'a> {
    pub alternatives: SmallVec<[SemanticSelectorAlternative<'a>; 2]>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SemanticSelectorAlternative<'a> {
    pub raw: &'a str,
    pub parts: SmallVec<[SemanticSelectorPart<'a>; 4]>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SemanticSelectorPart<'a> {
    pub separator: Option<char>,
    pub value: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SemanticTransform<'a> {
    pub from: &'a str,
    pub to: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SemanticComparison<'a> {
    pub left: &'a str,
    pub operator: SemanticComparisonOperator,
    pub right: &'a str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SemanticComparisonOperator {
    Eq,
    Ne,
    Gt,
    Ge,
    Lt,
    Le,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedParams<'a> {
    raw: &'a str,
    entries: ParamEntries<'a>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedParamsReport<'a> {
    pub params: ParsedParams<'a>,
    pub diagnostics: ParamDiagnostics<'a>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParamDiagnostic<'a> {
    pub kind: ParamDiagnosticKind,
    pub span: Range<usize>,
    pub segment: &'a str,
    pub key: Option<&'a str>,
    pub previous_value: Option<&'a str>,
    pub value: Option<&'a str>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParamDiagnosticKind {
    MissingDelimiter,
    EmptyKey,
    DuplicateKeySameValue,
    DuplicateKeyDifferentValue,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedCardScript<'a> {
    raw: &'a str,
    lines: ScriptLines<'a>,
    diagnostics: ScriptDiagnostics<'a>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScriptLine<'a> {
    pub line_no: usize,
    pub span: Range<usize>,
    pub raw: &'a str,
    pub kind: ScriptLineKind<'a>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScriptLineKind<'a> {
    Blank,
    Comment(&'a str),
    Field(ScriptField<'a>),
    Keyword(&'a str),
    Ability(ScriptAbility<'a>),
    Trigger(ScriptParamRecord<'a>),
    StaticAbility(ScriptParamRecord<'a>),
    Replacement(ScriptParamRecord<'a>),
    SVar(ScriptSVar<'a>),
    AlternateFace,
    AlternateMode(&'a str),
    SpecializeFace { color: &'a str },
    IgnoredMetadata(ScriptField<'a>),
    Unknown(ScriptField<'a>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScriptField<'a> {
    pub key: &'a str,
    pub value: Option<&'a str>,
    pub key_span: Range<usize>,
    pub value_span: Option<Range<usize>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScriptAbility<'a> {
    pub record: Option<ScriptAbilityRecord>,
    pub api_raw: Option<&'a str>,
    pub params: ParsedParams<'a>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScriptAbilityRecord {
    Activated,
    Spell,
    SubAbility,
    StaticAbility,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScriptParamRecord<'a> {
    pub params: ParsedParams<'a>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScriptSVar<'a> {
    pub name: &'a str,
    pub value: &'a str,
    pub name_span: Range<usize>,
    pub value_span: Range<usize>,
    pub value_kind: ScriptSVarValue<'a>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScriptSVarValue<'a> {
    Ability(ScriptAbility<'a>),
    Params(ScriptParamRecord<'a>),
    NumericExpression(ScriptSVarNumericExpression<'a>),
    Raw(&'a str),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScriptSVarNumericExpression<'a> {
    Number(&'a str),
    Count(&'a str),
    PlayerCount(&'a str),
    TriggerCount(&'a str),
    SVarReference {
        name: &'a str,
        operators: &'a str,
    },
    Remembered {
        property: &'a str,
    },
    RememberedSize {
        operators: &'a str,
    },
    DiscardedValid {
        filter: &'a str,
        times: i32,
    },
    ObjectProperty {
        object: ScriptSVarObjectRef<'a>,
        property: &'a str,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScriptSVarObjectRef<'a> {
    Sacrificed,
    TriggeredCard,
    CardList(&'a str),
    PlayerList(&'a str),
    SpellAbility(&'a str),
    PaidHash(&'a str),
    ReplaceCount,
    RuntimeValue(&'a str),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OwnedSVarNumericExpression {
    Number(String),
    Count(String),
    PlayerCount(String),
    TriggerCount(String),
    SVarReference {
        name: String,
        operators: String,
    },
    Remembered {
        property: String,
    },
    RememberedSize {
        operators: String,
    },
    DiscardedValid {
        filter: String,
        times: i32,
    },
    ObjectProperty {
        object: OwnedSVarObjectRef,
        property: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OwnedSVarObjectRef {
    Sacrificed,
    TriggeredCard,
    CardList(String),
    PlayerList(String),
    SpellAbility(String),
    PaidHash(String),
    ReplaceCount,
    RuntimeValue(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScriptDiagnostic<'a> {
    pub kind: ScriptDiagnosticKind,
    pub span: Range<usize>,
    pub line_no: usize,
    pub segment: &'a str,
    pub key: Option<&'a str>,
    pub previous_value: Option<&'a str>,
    pub value: Option<&'a str>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScriptDiagnosticKind {
    MissingColon,
    EmptyKey,
    UnknownField,
    MissingAbilityRecord,
    MissingSVarName,
    Param(ParamDiagnosticKind),
}

impl<'a> ParsedCardScript<'a> {
    pub fn parse(raw: &'a str) -> Self {
        let mut lines = SmallVec::new();
        let mut diagnostics = SmallVec::new();
        let mut offset = 0;

        for (idx, segment) in raw.split_inclusive('\n').enumerate() {
            let line = segment
                .strip_suffix('\n')
                .map(|s| s.strip_suffix('\r').unwrap_or(s))
                .unwrap_or(segment);
            let line_no = idx + 1;
            let parsed = parse_script_line(line, line_no, offset, &mut diagnostics);
            lines.push(parsed);
            offset += segment.len();
        }

        Self {
            raw,
            lines,
            diagnostics,
        }
    }

    pub fn raw(&self) -> &'a str {
        self.raw
    }

    pub fn lines(&self) -> &[ScriptLine<'a>] {
        &self.lines
    }

    pub fn diagnostics(&self) -> &[ScriptDiagnostic<'a>] {
        &self.diagnostics
    }

    pub fn abilities(&self) -> impl Iterator<Item = &ScriptAbility<'a>> {
        self.lines.iter().filter_map(|line| match &line.kind {
            ScriptLineKind::Ability(ability) => Some(ability),
            ScriptLineKind::SVar(svar) => match &svar.value_kind {
                ScriptSVarValue::Ability(ability) => Some(ability),
                _ => None,
            },
            _ => None,
        })
    }
}

impl ScriptAbilityRecord {
    pub fn key(self) -> &'static str {
        match self {
            Self::Activated => AB,
            Self::Spell => SP,
            Self::SubAbility => DB,
            Self::StaticAbility => ST,
        }
    }
}

impl SemanticParamValue<'_> {
    pub fn kind(&self) -> SemanticParamValueKind {
        match self {
            Self::AbilityRecord(_) => SemanticParamValueKind::AbilityRecord,
            Self::Symbol(_) => SemanticParamValueKind::Symbol,
            Self::ProducedMana(_) => SemanticParamValueKind::ProducedMana,
            Self::Boolean(_) => SemanticParamValueKind::Boolean,
            Self::Integer(_) => SemanticParamValueKind::Integer,
            Self::Amount(_) => SemanticParamValueKind::Amount,
            Self::ZoneList(_) => SemanticParamValueKind::ZoneList,
            Self::Selector(_) => SemanticParamValueKind::Selector,
            Self::Reference(_) => SemanticParamValueKind::Reference,
            Self::SVarReference(_) => SemanticParamValueKind::SVarReference,
            Self::Cost(_) => SemanticParamValueKind::Cost,
            Self::Text(_) => SemanticParamValueKind::Text,
            Self::DelimitedList(_) => SemanticParamValueKind::DelimitedList,
            Self::Transform(_) => SemanticParamValueKind::Transform,
            Self::Comparison(_) => SemanticParamValueKind::Comparison,
            Self::Expression(_) => SemanticParamValueKind::Expression,
            Self::Raw(_) => SemanticParamValueKind::Raw,
        }
    }
}

impl<'a> ParamEntry<'a> {
    pub fn semantic(&self) -> SemanticParam<'a> {
        SemanticParam {
            key: self.key,
            raw_value: self.value,
            value: parse_semantic_param_value(self.key, self.value),
        }
    }
}

impl ScriptSVarNumericExpression<'_> {
    pub fn to_owned_expression(&self) -> OwnedSVarNumericExpression {
        match self {
            Self::Number(value) => OwnedSVarNumericExpression::Number((*value).to_string()),
            Self::Count(raw) => OwnedSVarNumericExpression::Count((*raw).to_string()),
            Self::PlayerCount(raw) => OwnedSVarNumericExpression::PlayerCount((*raw).to_string()),
            Self::TriggerCount(raw) => OwnedSVarNumericExpression::TriggerCount((*raw).to_string()),
            Self::SVarReference { name, operators } => OwnedSVarNumericExpression::SVarReference {
                name: (*name).to_string(),
                operators: (*operators).to_string(),
            },
            Self::Remembered { property } => OwnedSVarNumericExpression::Remembered {
                property: (*property).to_string(),
            },
            Self::RememberedSize { operators } => OwnedSVarNumericExpression::RememberedSize {
                operators: (*operators).to_string(),
            },
            Self::DiscardedValid { filter, times } => OwnedSVarNumericExpression::DiscardedValid {
                filter: (*filter).to_string(),
                times: *times,
            },
            Self::ObjectProperty { object, property } => {
                OwnedSVarNumericExpression::ObjectProperty {
                    object: object.to_owned_ref(),
                    property: (*property).to_string(),
                }
            }
        }
    }
}

impl ScriptSVarObjectRef<'_> {
    pub fn to_owned_ref(&self) -> OwnedSVarObjectRef {
        match self {
            Self::Sacrificed => OwnedSVarObjectRef::Sacrificed,
            Self::TriggeredCard => OwnedSVarObjectRef::TriggeredCard,
            Self::CardList(defined) => OwnedSVarObjectRef::CardList((*defined).to_string()),
            Self::PlayerList(defined) => OwnedSVarObjectRef::PlayerList((*defined).to_string()),
            Self::SpellAbility(defined) => OwnedSVarObjectRef::SpellAbility((*defined).to_string()),
            Self::PaidHash(key) => OwnedSVarObjectRef::PaidHash((*key).to_string()),
            Self::ReplaceCount => OwnedSVarObjectRef::ReplaceCount,
            Self::RuntimeValue(key) => OwnedSVarObjectRef::RuntimeValue((*key).to_string()),
        }
    }
}

impl<'a> ParsedParams<'a> {
    pub fn parse(raw: &'a str) -> Self {
        let mut entries = SmallVec::new();
        let mut offset = 0;

        for part in raw.split('|') {
            if let Some(entry) = parse_entry(part, offset) {
                entries.push(entry);
            }
            offset += part.len() + 1;
        }

        Self { raw, entries }
    }

    pub fn parse_with_diagnostics(raw: &'a str) -> ParsedParamsReport<'a> {
        let mut entries: ParamEntries<'a> = SmallVec::new();
        let mut diagnostics = SmallVec::new();
        let mut offset = 0;

        for part in raw.split('|') {
            let (trimmed, trimmed_offset) = trim_with_offset(part, offset);
            if !trimmed.is_empty() {
                if !trimmed.contains('$') {
                    diagnostics.push(ParamDiagnostic {
                        kind: ParamDiagnosticKind::MissingDelimiter,
                        span: trimmed_offset..trimmed_offset + trimmed.len(),
                        segment: trimmed,
                        key: None,
                        previous_value: None,
                        value: None,
                    });
                } else if let Some(entry) = parse_entry(part, offset) {
                    if entry.key.is_empty() {
                        diagnostics.push(ParamDiagnostic {
                            kind: ParamDiagnosticKind::EmptyKey,
                            span: entry.key_span.clone(),
                            segment: trimmed,
                            key: None,
                            previous_value: None,
                            value: Some(entry.value),
                        });
                    }
                    if let Some(existing) =
                        entries.iter().rfind(|existing| existing.key == entry.key)
                    {
                        let kind = if existing.value == entry.value {
                            ParamDiagnosticKind::DuplicateKeySameValue
                        } else {
                            ParamDiagnosticKind::DuplicateKeyDifferentValue
                        };
                        diagnostics.push(ParamDiagnostic {
                            kind,
                            span: entry.key_span.clone(),
                            segment: trimmed,
                            key: Some(entry.key),
                            previous_value: Some(existing.value),
                            value: Some(entry.value),
                        });
                    }
                    entries.push(entry);
                }
            }
            offset += part.len() + 1;
        }

        ParsedParamsReport {
            params: Self { raw, entries },
            diagnostics,
        }
    }

    pub fn raw(&self) -> &'a str {
        self.raw
    }

    pub fn entries(&self) -> &[ParamEntry<'a>] {
        &self.entries
    }

    pub fn semantic_entries(&self) -> impl Iterator<Item = SemanticParam<'a>> + '_ {
        self.entries.iter().map(ParamEntry::semantic)
    }

    pub fn semantic_get(&self, key: &str) -> Option<SemanticParam<'a>> {
        self.entries
            .iter()
            .rfind(|entry| entry.key == key)
            .map(ParamEntry::semantic)
    }

    pub fn get(&self, key: &str) -> Option<&'a str> {
        self.entries
            .iter()
            .rfind(|entry| entry.key == key)
            .map(|entry| entry.value)
    }

    pub fn has(&self, key: &str) -> bool {
        self.get(key).is_some()
    }

    pub fn has_any(&self, keys: &[&str]) -> bool {
        self.entries.iter().any(|entry| keys.contains(&entry.key))
    }

    pub fn duplicates(&self) -> impl Iterator<Item = &ParamEntry<'a>> {
        self.entries.iter().enumerate().filter_map(|(idx, entry)| {
            if self.entries[..idx]
                .iter()
                .any(|existing| existing.key == entry.key)
            {
                Some(entry)
            } else {
                None
            }
        })
    }
}

pub fn raw_get<'a>(raw: &'a str, key: &str) -> Option<&'a str> {
    raw_entries(raw).fold(None, |found, entry| {
        if entry.key == key {
            Some(entry.value)
        } else {
            found
        }
    })
}

pub fn raw_has_key(raw: &str, key: &str) -> bool {
    raw_get(raw, key).is_some()
}

pub fn raw_has_any(raw: &str, keys: &[&str]) -> bool {
    raw_entries(raw).any(|entry| keys.contains(&entry.key))
}

fn raw_entries(raw: &str) -> impl Iterator<Item = ParamEntry<'_>> {
    let mut offset = 0;
    raw.split('|').filter_map(move |part| {
        let entry = parse_entry(part, offset);
        offset += part.len() + 1;
        entry
    })
}

fn parse_script_line<'a>(
    line: &'a str,
    line_no: usize,
    line_offset: usize,
    diagnostics: &mut ScriptDiagnostics<'a>,
) -> ScriptLine<'a> {
    let (trimmed, trimmed_offset) = trim_with_offset(line, line_offset);
    let span = line_offset..line_offset + line.len();

    if trimmed.is_empty() {
        return ScriptLine {
            line_no,
            span,
            raw: line,
            kind: ScriptLineKind::Blank,
        };
    }

    if let Some(comment) = trimmed.strip_prefix('#') {
        return ScriptLine {
            line_no,
            span,
            raw: line,
            kind: ScriptLineKind::Comment(comment.trim()),
        };
    }

    if trimmed == "ALTERNATE" {
        return ScriptLine {
            line_no,
            span,
            raw: line,
            kind: ScriptLineKind::AlternateFace,
        };
    }

    let Some(field) = parse_script_field(trimmed, trimmed_offset) else {
        diagnostics.push(ScriptDiagnostic {
            kind: ScriptDiagnosticKind::MissingColon,
            span: trimmed_offset..trimmed_offset + trimmed.len(),
            line_no,
            segment: trimmed,
            key: None,
            previous_value: None,
            value: None,
        });
        return ScriptLine {
            line_no,
            span,
            raw: line,
            kind: ScriptLineKind::Unknown(ScriptField {
                key: trimmed,
                value: None,
                key_span: trimmed_offset..trimmed_offset + trimmed.len(),
                value_span: None,
            }),
        };
    };

    if field.key.is_empty() {
        diagnostics.push(ScriptDiagnostic {
            kind: ScriptDiagnosticKind::EmptyKey,
            span: field.key_span.clone(),
            line_no,
            segment: trimmed,
            key: None,
            previous_value: None,
            value: field.value,
        });
    }

    let kind = classify_script_field(field, line_no, diagnostics);
    ScriptLine {
        line_no,
        span,
        raw: line,
        kind,
    }
}

fn parse_script_field<'a>(line: &'a str, line_offset: usize) -> Option<ScriptField<'a>> {
    let colon = line.find(':')?;
    if colon == 0 {
        return None;
    }

    let key_raw = &line[..colon];
    let value_raw = &line[colon + 1..];
    let key_leading = key_raw.len() - key_raw.trim_start().len();
    let key = key_raw.trim();
    let key_start = line_offset + key_leading;

    let value_leading = value_raw.len() - value_raw.trim_start().len();
    let value = value_raw.trim();
    let value_start = line_offset + colon + 1 + value_leading;

    Some(ScriptField {
        key,
        value: Some(value),
        key_span: key_start..key_start + key.len(),
        value_span: Some(value_start..value_start + value.len()),
    })
}

fn classify_script_field<'a>(
    field: ScriptField<'a>,
    line_no: usize,
    diagnostics: &mut ScriptDiagnostics<'a>,
) -> ScriptLineKind<'a> {
    match field.key {
        "A" => ScriptLineKind::Ability(parse_script_ability(
            field.value.unwrap_or(""),
            line_no,
            field
                .value_span
                .clone()
                .unwrap_or_else(|| field.key_span.end..field.key_span.end),
            diagnostics,
        )),
        "T" => ScriptLineKind::Trigger(parse_script_param_record(
            field.value.unwrap_or(""),
            line_no,
            field
                .value_span
                .clone()
                .unwrap_or_else(|| field.key_span.end..field.key_span.end),
            diagnostics,
        )),
        "S" => ScriptLineKind::StaticAbility(parse_script_param_record(
            field.value.unwrap_or(""),
            line_no,
            field
                .value_span
                .clone()
                .unwrap_or_else(|| field.key_span.end..field.key_span.end),
            diagnostics,
        )),
        "R" => ScriptLineKind::Replacement(parse_script_param_record(
            field.value.unwrap_or(""),
            line_no,
            field
                .value_span
                .clone()
                .unwrap_or_else(|| field.key_span.end..field.key_span.end),
            diagnostics,
        )),
        "SVar" => ScriptLineKind::SVar(parse_script_svar(field, line_no, diagnostics)),
        "K" => ScriptLineKind::Keyword(field.value.unwrap_or("")),
        "ALTERNATE" => ScriptLineKind::AlternateFace,
        "AlternateMode" => ScriptLineKind::AlternateMode(field.value.unwrap_or("")),
        key if key.starts_with("SPECIALIZE") => ScriptLineKind::SpecializeFace {
            color: field.value.unwrap_or(""),
        },
        "Name" | "ManaCost" | "Types" | "PT" | "Colors" | "Defense" | "Draft" | "FlavorName"
        | "Loyalty" | "Lights" | "MeldPair" | "Oracle" | "Text" | "Variant" => {
            ScriptLineKind::Field(field)
        }
        "AI" | "DeckHints" | "DeckNeeds" | "DeckHas" | "HandLifeModifier" => {
            ScriptLineKind::IgnoredMetadata(field)
        }
        key if key.starts_with("SETCOLORID") => ScriptLineKind::IgnoredMetadata(field),
        _ => {
            diagnostics.push(ScriptDiagnostic {
                kind: ScriptDiagnosticKind::UnknownField,
                span: field.key_span.clone(),
                line_no,
                segment: field.value.unwrap_or(field.key),
                key: Some(field.key),
                previous_value: None,
                value: field.value,
            });
            ScriptLineKind::Unknown(field)
        }
    }
}

fn parse_script_ability<'a>(
    raw: &'a str,
    line_no: usize,
    value_span: Range<usize>,
    diagnostics: &mut ScriptDiagnostics<'a>,
) -> ScriptAbility<'a> {
    let report = ParsedParams::parse_with_diagnostics(raw);
    record_param_report_diagnostics(&report, line_no, value_span.start, diagnostics);
    let ParsedParamsReport {
        params: parsed_params,
        diagnostics: _,
    } = report;

    let record = ability_record(&parsed_params);
    if record.is_none() && !raw.trim().is_empty() {
        diagnostics.push(ScriptDiagnostic {
            kind: ScriptDiagnosticKind::MissingAbilityRecord,
            span: value_span,
            line_no,
            segment: raw,
            key: None,
            previous_value: None,
            value: None,
        });
    }

    let api_raw = record.and_then(|record| parsed_params.get(record.key()));

    ScriptAbility {
        record,
        api_raw,
        params: parsed_params,
    }
}

fn parse_script_param_record<'a>(
    raw: &'a str,
    line_no: usize,
    value_span: Range<usize>,
    diagnostics: &mut ScriptDiagnostics<'a>,
) -> ScriptParamRecord<'a> {
    let report = ParsedParams::parse_with_diagnostics(raw);
    record_param_report_diagnostics(&report, line_no, value_span.start, diagnostics);
    let ParsedParamsReport {
        params: parsed_params,
        diagnostics: _,
    } = report;
    ScriptParamRecord {
        params: parsed_params,
    }
}

fn parse_script_svar<'a>(
    field: ScriptField<'a>,
    line_no: usize,
    diagnostics: &mut ScriptDiagnostics<'a>,
) -> ScriptSVar<'a> {
    let raw = field.value.unwrap_or("");
    let value_span = field
        .value_span
        .clone()
        .unwrap_or_else(|| field.key_span.end..field.key_span.end);
    let (name, value, name_span, nested_value_span) = if let Some(colon) = raw.find(':') {
        let name_raw = &raw[..colon];
        let value_raw = &raw[colon + 1..];
        let name_leading = name_raw.len() - name_raw.trim_start().len();
        let name = name_raw.trim();
        let name_start = value_span.start + name_leading;
        let value_leading = value_raw.len() - value_raw.trim_start().len();
        let value = value_raw.trim();
        let nested_value_start = value_span.start + colon + 1 + value_leading;
        (
            name,
            value,
            name_start..name_start + name.len(),
            nested_value_start..nested_value_start + value.len(),
        )
    } else {
        let name = raw.trim();
        (name, "", value_span.clone(), value_span.end..value_span.end)
    };

    if name.is_empty() {
        diagnostics.push(ScriptDiagnostic {
            kind: ScriptDiagnosticKind::MissingSVarName,
            span: name_span.clone(),
            line_no,
            segment: raw,
            key: Some(field.key),
            previous_value: None,
            value: None,
        });
    }

    let value_kind = if looks_like_ability_record(value) {
        ScriptSVarValue::Ability(parse_script_ability(
            value,
            line_no,
            nested_value_span.clone(),
            diagnostics,
        ))
    } else if let Some(expression) = parse_script_svar_numeric_expression(value) {
        ScriptSVarValue::NumericExpression(expression)
    } else if looks_like_param_record(value) {
        ScriptSVarValue::Params(parse_script_param_record(
            value,
            line_no,
            nested_value_span.clone(),
            diagnostics,
        ))
    } else {
        ScriptSVarValue::Raw(value)
    };

    ScriptSVar {
        name,
        value,
        name_span,
        value_span: nested_value_span,
        value_kind,
    }
}

fn ability_record(params: &ParsedParams<'_>) -> Option<ScriptAbilityRecord> {
    if params.has(AB) {
        Some(ScriptAbilityRecord::Activated)
    } else if params.has(SP) {
        Some(ScriptAbilityRecord::Spell)
    } else if params.has(DB) {
        Some(ScriptAbilityRecord::SubAbility)
    } else if params.has(ST) {
        Some(ScriptAbilityRecord::StaticAbility)
    } else {
        None
    }
}

pub fn parse_script_svar_numeric_expression<'a>(
    value: &'a str,
) -> Option<ScriptSVarNumericExpression<'a>> {
    let value = value.trim();
    if let Some(rest) = value.strip_prefix("Number$") {
        return Some(ScriptSVarNumericExpression::Number(rest.trim()));
    }
    if value.starts_with("Count$") {
        return Some(ScriptSVarNumericExpression::Count(value));
    }
    if value.starts_with("PlayerCount") && value.contains('$') {
        return Some(ScriptSVarNumericExpression::PlayerCount(value));
    }
    if value.starts_with("TriggerCount$") || value.starts_with("TriggerCountMax$") {
        return Some(ScriptSVarNumericExpression::TriggerCount(value));
    }
    if let Some(property) = value.strip_prefix("Remembered$") {
        return Some(ScriptSVarNumericExpression::Remembered { property });
    }
    if let Some(rest) = value.strip_prefix("RememberedSize") {
        return Some(ScriptSVarNumericExpression::RememberedSize {
            operators: rest.strip_prefix('/').unwrap_or(rest),
        });
    }
    if let Some(rest) = value.strip_prefix("Discarded$Valid ") {
        let mut parts = rest.split("/Times.");
        let filter = parts.next().unwrap_or("").trim();
        let times = parts
            .next()
            .and_then(|raw| raw.trim().parse::<i32>().ok())
            .unwrap_or(0);
        return Some(ScriptSVarNumericExpression::DiscardedValid { filter, times });
    }

    let (object, property) = value.split_once('$')?;
    if object.is_empty() || property.is_empty() {
        return None;
    }
    if object == "SVar" {
        let (name, operators) = property.split_once('/').unwrap_or((property, ""));
        let name = name.trim();
        if name.is_empty() {
            return None;
        }
        return Some(ScriptSVarNumericExpression::SVarReference { name, operators });
    }
    let object = match object {
        "Sacrificed" => ScriptSVarObjectRef::Sacrificed,
        "TriggeredCard" => ScriptSVarObjectRef::TriggeredCard,
        _ if is_player_property_svar_object(object)
            && is_player_property_svar_property(property) =>
        {
            ScriptSVarObjectRef::PlayerList(object)
        }
        _ if is_card_property_svar_object(object) => ScriptSVarObjectRef::CardList(object),
        _ if is_player_property_svar_object(object) => ScriptSVarObjectRef::PlayerList(object),
        _ if is_spell_ability_property_svar_object(object) => {
            ScriptSVarObjectRef::SpellAbility(object)
        }
        _ if is_paid_hash_property_svar_object(object) => ScriptSVarObjectRef::PaidHash(object),
        "ReplaceCount" => ScriptSVarObjectRef::ReplaceCount,
        _ if is_runtime_value_svar_object(object) => ScriptSVarObjectRef::RuntimeValue(object),
        _ => return None,
    };
    Some(ScriptSVarNumericExpression::ObjectProperty { object, property })
}

fn is_card_property_svar_object(object: &str) -> bool {
    matches!(
        object,
        "Targeted"
            | "TargetedCard"
            | "ThisTargetedCard"
            | "ParentTargeted"
            | "Remembered"
            | "RememberedLKI"
            | "DelayTriggerRemembered"
            | "DelayTriggerRememberedLKI"
            | "TriggerRemembered"
            | "Imprinted"
            | "Discarded"
            | "TriggeredAttacker"
            | "TriggeredAttackers"
            | "TriggeredBlocker"
            | "TriggeredTarget"
            | "TriggeredTargets"
            | "TriggeredNewCard"
            | "TriggeredNewCardLKICopy"
            | "ReplacedCard"
            | "ReplacedCardLKI"
            | "ReplacedSource"
            | "SpellTargeted"
            | "AllTargeted"
            | "Revealed"
            | "Enchanted"
            | "Equipped"
            | "ExiledWith"
            | "TargetedObjects"
            | "TargetedObjectsDistinct"
            | "TargetedByTarget"
            | "ChosenCard"
            | "Collected"
            | "Crewed"
            | "Emerged"
            | "ExiledCards"
            | "ImprintedLKI"
            | "OriginalHost"
            | "TriggeredCardLKI"
            | "TriggeredDevoured"
            | "TriggeredExploited"
            | "TriggeredSource"
            | "Explorer"
            | "Explored"
    )
}

fn is_player_property_svar_object(object: &str) -> bool {
    matches!(
        object,
        "Player"
            | "Players"
            | "Opponent"
            | "Opponents"
            | "You"
            | "Controller"
            | "TargetedPlayer"
            | "ThisTargetedPlayer"
            | "TriggeredPlayer"
            | "TargetedController"
            | "ThisTargetedController"
            | "ParentTargetedController"
            | "TargetedOwner"
            | "ThisTargetedOwner"
            | "TriggeredTarget"
            | "TriggeredTargets"
            | "TriggeredTargetController"
            | "TriggeredTargetsController"
            | "TriggeredAttackerController"
            | "TriggeredBlockerController"
            | "TriggeredActivator"
            | "TriggeredCardController"
            | "DefendingPlayer"
            | "TriggeredDefendingPlayer"
    )
}

fn is_player_property_svar_property(property: &str) -> bool {
    let property = property.split('/').next().unwrap_or(property);
    property.starts_with("CardsIn")
        || property.starts_with("CreaturesIn")
        || property.starts_with("Life")
        || property.starts_with("Valid")
        || property.starts_with("Counters.")
        || property.starts_with("HasProperty")
        || property.starts_with("Condition")
        || matches!(
            property,
            "StartingLife"
                | "Speed"
                | "TopOfLibraryCMC"
                | "LandsPlayed"
                | "SpellsCastThisTurn"
                | "CardsDrawn"
                | "CardsDiscardedThisTurn"
                | "ExploredThisTurn"
                | "AttackersDeclared"
                | "DamageToOppsThisTurn"
                | "NonCombatDamageDealtThisTurn"
                | "PoisonCounters"
                | "EnergyCounters"
                | "ManaExpendedThisTurn"
                | "RingTemptedYou"
                | "OpponentsAttackedThisTurn"
                | "OpponentsAttackedThisCombat"
                | "BeenDealtCombatDamageSinceLastTurn"
                | "AttractionsVisitedThisTurn"
        )
}

fn is_spell_ability_property_svar_object(object: &str) -> bool {
    matches!(
        object,
        "Self"
            | "Parent"
            | "Remembered"
            | "Imprinted"
            | "EffectSource"
            | "TriggeredSpellAbility"
            | "TriggeredAbility"
            | "SpellAbility"
    )
}

fn is_paid_hash_property_svar_object(object: &str) -> bool {
    matches!(
        object,
        "SacCost"
            | "DiscardCost"
            | "Exiled"
            | "Tapped"
            | "Untapped"
            | "TappedForConvoke"
            | "Convoked"
    )
}

fn is_runtime_value_svar_object(object: &str) -> bool {
    matches!(object, "DungeonsCompleted" | "ManaFrom")
        || object.starts_with("TriggerObjects")
        || object.starts_with("TriggeredPlayers")
        || object.contains('>')
}

pub fn parse_semantic_param_value<'a>(key: &str, value: &'a str) -> SemanticParamValue<'a> {
    let value = value.trim();

    if matches!(key, AB | SP | DB | ST) {
        return SemanticParamValue::AbilityRecord(value);
    }
    if matches!(key, "Mode" | "Event") || key.ends_with("Mode") || key.ends_with("Logic") {
        return SemanticParamValue::Symbol(value);
    }
    if is_text_key(key) {
        return SemanticParamValue::Text(value);
    }
    if is_cost_key(key) {
        return SemanticParamValue::Cost(value);
    }
    if let Some(transform) = parse_transform(value) {
        return SemanticParamValue::Transform(transform);
    }
    if let Some(value) = parse_bool(value) {
        return SemanticParamValue::Boolean(value);
    }
    if is_post_bool_text_key(key) {
        return SemanticParamValue::Text(value);
    }
    if key == "Produced" {
        return SemanticParamValue::ProducedMana(parse_produced_mana(value));
    }
    if is_symbol_key(key) {
        return SemanticParamValue::Symbol(value);
    }
    if is_zone_key(key) {
        return SemanticParamValue::ZoneList(split_csv(value));
    }
    if is_svar_reference_key(key) {
        return SemanticParamValue::SVarReference(split_csv(value));
    }
    if is_amount_key(key) {
        return SemanticParamValue::Amount(parse_amount(value));
    }
    if is_reference_key(key) {
        return SemanticParamValue::Reference(parse_selector(value));
    }
    if is_selector_key(key) {
        return SemanticParamValue::Selector(parse_selector(value));
    }
    if let Ok(number) = value.parse::<i32>() {
        return SemanticParamValue::Integer(number);
    }
    if let Some(comparison) = parse_comparison(value) {
        return SemanticParamValue::Comparison(comparison);
    }
    if looks_like_expression_key(key) || looks_like_expression_value(value) {
        return SemanticParamValue::Expression(value);
    }
    if is_delimited_list_key(key) || value.contains(',') {
        return SemanticParamValue::DelimitedList(split_csv(value));
    }

    SemanticParamValue::Raw(value)
}

fn parse_bool(value: &str) -> Option<bool> {
    if value.eq_ignore_ascii_case("true") {
        Some(true)
    } else if value.eq_ignore_ascii_case("false") {
        Some(false)
    } else {
        None
    }
}

fn parse_transform(value: &str) -> Option<SemanticTransform<'_>> {
    let (from, to) = value.split_once("->")?;
    let from = from.trim();
    let to = to.trim();
    if from.is_empty() || to.is_empty() {
        return None;
    }
    Some(SemanticTransform { from, to })
}

fn parse_comparison(value: &str) -> Option<SemanticComparison<'_>> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }

    if let Some((left, op, right)) = parse_spaced_comparison(value) {
        return Some(SemanticComparison {
            left,
            operator: op,
            right,
        });
    }

    if let Some((left, op, right)) = parse_split_compact_comparison(value) {
        return Some(SemanticComparison {
            left,
            operator: op,
            right,
        });
    }

    if let Some((op, right)) = parse_compact_operator_rhs(value) {
        return Some(SemanticComparison {
            left: "",
            operator: op,
            right,
        });
    }

    None
}

fn parse_spaced_comparison(value: &str) -> Option<(&str, SemanticComparisonOperator, &str)> {
    let mut parts = value.split_whitespace();
    let left = parts.next()?;
    let op = parse_comparison_operator(parts.next()?)?;
    let right = parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    Some((left, op, right))
}

fn parse_split_compact_comparison(value: &str) -> Option<(&str, SemanticComparisonOperator, &str)> {
    let mut parts = value.split_whitespace();
    let left = parts.next()?;
    let op_rhs = parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    let (op, right) = parse_compact_operator_rhs(op_rhs)?;
    Some((left, op, right))
}

fn parse_compact_operator_rhs(value: &str) -> Option<(SemanticComparisonOperator, &str)> {
    for (raw_op, op) in [
        ("GTE", SemanticComparisonOperator::Ge),
        ("LTE", SemanticComparisonOperator::Le),
        ("GE", SemanticComparisonOperator::Ge),
        ("LE", SemanticComparisonOperator::Le),
        ("GT", SemanticComparisonOperator::Gt),
        ("LT", SemanticComparisonOperator::Lt),
        ("NE", SemanticComparisonOperator::Ne),
        ("EQ", SemanticComparisonOperator::Eq),
    ] {
        if let Some(right) = value.strip_prefix(raw_op) {
            let right = right.trim();
            if !right.is_empty() {
                return Some((op, right));
            }
        }
    }

    None
}

fn parse_comparison_operator(value: &str) -> Option<SemanticComparisonOperator> {
    match value {
        "EQ" | "==" => Some(SemanticComparisonOperator::Eq),
        "NE" | "!=" => Some(SemanticComparisonOperator::Ne),
        "GT" | ">" => Some(SemanticComparisonOperator::Gt),
        "GE" | ">=" => Some(SemanticComparisonOperator::Ge),
        "LT" | "<" => Some(SemanticComparisonOperator::Lt),
        "LE" | "<=" => Some(SemanticComparisonOperator::Le),
        _ => None,
    }
}

fn parse_amount(value: &str) -> SemanticAmount<'_> {
    if let Ok(number) = value.parse::<i32>() {
        SemanticAmount::Literal(number)
    } else if value == "X" {
        SemanticAmount::X
    } else if value.eq_ignore_ascii_case("Any") {
        SemanticAmount::Any
    } else if value.eq_ignore_ascii_case("All") {
        SemanticAmount::All
    } else if is_svar_name(value) {
        SemanticAmount::SVar(value)
    } else {
        SemanticAmount::Expression(value)
    }
}

fn parse_produced_mana(value: &str) -> SemanticProducedMana<'_> {
    if value.eq_ignore_ascii_case("Any") {
        SemanticProducedMana::Any
    } else if value.eq_ignore_ascii_case("Chosen") {
        SemanticProducedMana::Chosen
    } else if let Some(rest) = value.strip_prefix("Special ") {
        SemanticProducedMana::Special(rest)
    } else if value.starts_with("Combo") {
        let rest = value.strip_prefix("Combo").unwrap_or("").trim();
        if rest.eq_ignore_ascii_case("Any") {
            SemanticProducedMana::Combo(SemanticProducedManaCombo::Any)
        } else if rest.eq_ignore_ascii_case("Chosen") {
            SemanticProducedMana::Combo(SemanticProducedManaCombo::Chosen)
        } else if rest.eq_ignore_ascii_case("ColorIdentity") {
            SemanticProducedMana::Combo(SemanticProducedManaCombo::ColorIdentity)
        } else {
            let colors: SmallVec<[&str; 4]> = rest
                .split_whitespace()
                .filter(|part| is_produced_mana_atom(part))
                .collect();
            if !colors.is_empty() && colors.len() == rest.split_whitespace().count() {
                SemanticProducedMana::Combo(SemanticProducedManaCombo::Colors(colors))
            } else {
                SemanticProducedMana::Combo(SemanticProducedManaCombo::Raw(rest))
            }
        }
    } else {
        let tokens: SmallVec<[&str; 4]> = value
            .split_whitespace()
            .filter(|part| is_produced_mana_atom(part))
            .collect();
        if !tokens.is_empty() && tokens.len() == value.split_whitespace().count() {
            SemanticProducedMana::Fixed(tokens)
        } else {
            SemanticProducedMana::Raw(value)
        }
    }
}

fn is_produced_mana_atom(value: &str) -> bool {
    matches!(value.trim(), "W" | "U" | "B" | "R" | "G" | "C")
}

fn parse_selector(raw: &str) -> SemanticSelector<'_> {
    let alternatives = split_csv(raw)
        .into_iter()
        .flat_map(|alternative| split_spaced_ampersand(alternative).into_iter())
        .map(|alternative| {
            let alternative = alternative.trim();
            SemanticSelectorAlternative {
                raw: alternative,
                parts: parse_selector_parts(alternative),
            }
        })
        .collect();
    SemanticSelector { alternatives }
}

fn split_spaced_ampersand(raw: &str) -> SmallVec<[&str; 4]> {
    if raw.contains(" & ") {
        split_on(raw, '&')
    } else {
        let mut parts = SmallVec::new();
        parts.push(raw);
        parts
    }
}

fn parse_selector_parts(raw: &str) -> SmallVec<[SemanticSelectorPart<'_>; 4]> {
    let mut parts = SmallVec::new();
    let mut start = 0;
    let mut separator = None;

    for (idx, ch) in raw.char_indices() {
        if ch == '.' || ch == '+' {
            push_selector_part(raw, start, idx, separator, &mut parts);
            start = idx + ch.len_utf8();
            separator = Some(ch);
        }
    }
    push_selector_part(raw, start, raw.len(), separator, &mut parts);
    parts
}

fn push_selector_part<'a>(
    raw: &'a str,
    start: usize,
    end: usize,
    separator: Option<char>,
    parts: &mut SmallVec<[SemanticSelectorPart<'a>; 4]>,
) {
    let part = raw[start..end].trim();
    if !part.is_empty() {
        parts.push(SemanticSelectorPart {
            separator,
            value: part,
        });
    }
}

fn split_csv(raw: &str) -> SmallVec<[&str; 4]> {
    split_on(raw, ',')
}

fn split_on(raw: &str, delimiter: char) -> SmallVec<[&str; 4]> {
    raw.split(delimiter)
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect()
}

fn is_text_key(key: &str) -> bool {
    key.ends_with("Description")
        || key.ends_with("Desc")
        || key.ends_with("Prompt")
        || key.ends_with("Message")
        || key.ends_with("Title")
        || matches!(
            key,
            "Description"
                | "ChangeColorWord"
                | "ChangeTypeWord"
                | "ChoiceTitle"
                | "ChoiceTitleAppend"
                | "SpellDescription"
                | "StackDescription"
                | "TriggerDescription"
                | "CostDesc"
                | "FromDraftNotes"
                | "ListTitle"
                | "MayPlayText"
                | "PrecostDesc"
                | "Name"
                | "NewName"
                | "DefinedName"
                | "SpellbookName"
                | "Image"
                | "OptionQuestion"
                | "OrString"
                | "RoomName"
                | "RememberedDescription"
        )
}

fn is_post_bool_text_key(key: &str) -> bool {
    matches!(key, "Primary" | "Secondary")
}

fn is_cost_key(key: &str) -> bool {
    key == "Cost" || key == "Incorporate" || key.ends_with("Cost") || key.ends_with("CostDesc")
}

fn is_symbol_key(key: &str) -> bool {
    matches!(
        key,
        "AILogic"
            | "AIManaPref"
            | "Activation"
            | "ActivationPhases"
            | "AfterPhase"
            | "AtRandom"
            | "Attributes"
            | "ActivePhases"
            | "Announce"
            | "AddsKeywordsUntil"
            | "AIPhyrexianPayment"
            | "AtEOTTrig"
            | "ConditionManaSpent"
            | "DayTime"
            | "DividedAsYouChoose"
            | "ExtraPhase"
            | "FollowedBy"
            | "Duration"
            | "HasColorCreatureInPlay"
            | "Layer"
            | "Step"
            | "Modifier"
            | "Phase"
            | "PreventionEffect"
            | "Produced"
            | "ChoiceRestriction"
            | "CounterType2"
            | "ReplacementResult"
            | "ReflectProperty"
            | "ReplaceWith"
            | "Replacement"
            | "Result"
            | "LoseControl"
            | "Exclude"
            | "ChangeColorWordsTo"
            | "ManaSpent"
            | "ManaNotSpent"
            | "Reveal"
            | "FaceDown"
            | "NewState"
            | "Phases"
            | "RemovePhase"
            | "Revolt"
            | "ShowChoice"
            | "UnlessAI"
            | "UnlessSwitched"
    ) || key.ends_with("Duration")
        || key.ends_with("Effect")
        || key.ends_with("Logic")
        || key.starts_with("Remember")
}

fn is_zone_key(key: &str) -> bool {
    key.ends_with("Zone")
        || key.ends_with("Zones")
        || key.contains("Zone")
        || key.ends_with("Destination")
        || matches!(
            key,
            "AtEOT"
                | "ExcludedDestinations"
                | "ExcludedOrigins"
                | "ExileOnMoved"
                | "ForgetOnMoved"
                | "LeaveBattlefield"
                | "ReplaceGraveyard"
                | "OriginAlternative"
                | "Origin"
                | "Destination"
                | "DestinationAlternative"
                | "NewDestination"
                | "ActivationZone"
                | "ActiveZones"
                | "TriggerZones"
                | "ChoiceZone"
                | "PresentZone"
                | "EffectZone"
        )
}

fn is_selector_key(key: &str) -> bool {
    key.starts_with("Valid")
        || key.contains("Valid")
        || key.ends_with("Valid")
        || key.ends_with("Type")
        || key.ends_with("Types")
        || key.ends_with("Cards")
        || key.ends_with("Choices")
        || key.ends_with("Players")
        || key.ends_with("Restrictions")
        || key.ends_with("Tgts")
        || key.ends_with("Objects")
        || matches!(
            key,
            "Affected"
                | "AffectedZone"
                | "AttachedTo"
                | "AISearchGoal"
                | "ChangeType"
                | "ChangeValid"
                | "ConditionNotPresent"
                | "ConditionPresent"
                | "ConditionPresent2"
                | "Choices"
                | "DefinedCard"
                | "Filter"
                | "GainsAbilitiesOf"
                | "GainsTriggerAbsOf"
                | "IsPresent"
                | "IsPresent2"
                | "ManaRestriction"
                | "RepeatPresent"
                | "RepeatTypesFrom"
                | "SacValid"
                | "SharedRestrictions"
                | "Target"
                | "TargetRelativeToCause"
                | "TargetRestriction"
                | "TargetsWithControllerProperty"
                | "Type"
                | "Types"
                | "VoteCard"
        )
        || key.starts_with("IsPresent")
}

fn is_reference_key(key: &str) -> bool {
    key == "Defined"
        || key.starts_with("Defined")
        || key.ends_with("Defined")
        || key.ends_with("DefinedPlayer")
        || key.ends_with("Controller")
        || key.ends_with("Owner")
        || key.ends_with("Payer")
        || key.ends_with("Player")
        || key.ends_with("Source")
        || key.ends_with("Target")
        || key.ends_with("Decider")
        || key.ends_with("Defender")
        || key.ends_with("Damage")
        || matches!(
            key,
            "Activator"
                | "Attacked"
                | "Caster"
                | "Attacking"
                | "AttachAfter"
                | "Blocking"
                | "Choser"
                | "Chooser"
                | "DefinedPlayer"
                | "Flipper"
                | "ForgetImprinted"
                | "ForgetOnCast"
                | "ForceReveal"
                | "GainControl"
                | "MustAttack"
                | "Object"
                | "Optional"
                | "OptionalDecider"
                | "MayLookAt"
                | "Player"
                | "Placer"
                | "PresentPlayer2"
                | "Separator"
                | "ShowCurrentCard"
                | "StartingWith"
                | "TargetingPlayer"
                | "Tapper"
                | "TempRemember"
                | "AddTriggersFrom"
                | "DeclaresBlockers"
                | "TokenBlocking"
                | "TokenAttacking"
                | "TokenOwner"
                | "TokenRemembered"
                | "ToEachOther"
                | "UnblockCreaturesBlockedOnlyBy"
                | "UnlessPayer"
                | "Guesser"
                | "ConditionLifeTotal"
                | "ConditionPlayerContains"
        )
}

fn is_svar_reference_key(key: &str) -> bool {
    key == "Execute"
        || key == "sVars"
        || key.ends_with("SubAbility")
        || key.ends_with("SubAbilities")
        || key.ends_with("SVar")
        || key.ends_with("SVarName")
        || key.ends_with("Abilities")
        || key.ends_with("Ability")
        || key.ends_with("Pile")
        || key.ends_with("Subs")
        || matches!(
            key,
            "AddAbility"
                | "AddSVars"
                | "AddStaticAbility"
                | "AddTrigger"
                | "AddTriggers"
                | "FalseSubAbility"
                | "GuessCorrect"
                | "GuessWrong"
                | "Highest"
                | "Lowest"
                | "MustHaveInHand"
                | "NotLowest"
                | "NextRoom"
                | "RepeatSubAbility"
                | "Replacements"
                | "ReplacementEffects"
                | "StaticAbilities"
                | "SubAbility"
                | "TokenScript"
                | "Trigger"
                | "Triggers"
                | "TriggersWhenSpent"
                | "TrueSubAbility"
        )
}

fn is_amount_key(key: &str) -> bool {
    key.ends_with("Amount")
        || key.ends_with("CMC")
        || key.ends_with("HandSize")
        || key.ends_with("Power")
        || key.ends_with("Toughness")
        || key.starts_with("Num")
        || key.ends_with("Num")
        || key.ends_with("Limit")
        || key.ends_with("Min")
        || key.ends_with("Max")
        || matches!(
            key,
            "Amount"
                | "Additional"
                | "AdjustLandPlays"
                | "ChangeNum"
                | "CounterNum"
                | "DigNum"
                | "LifeAmount"
                | "LibraryPosition"
                | "Max"
                | "Min"
                | "MaxRevealed"
                | "NumAtt"
                | "NumCards"
                | "NumDmg"
                | "NumDef"
                | "Power"
                | "PowerUp"
                | "RevealNumber"
                | "SetPower"
                | "SetToughness"
                | "MaxRepeat"
                | "SetChosenNumber"
                | "TokenPower"
                | "TokenToughness"
                | "Toughness"
                | "Value"
                | "VarValue"
        )
}

fn is_delimited_list_key(key: &str) -> bool {
    key.ends_with("List")
        || key.ends_with("Names")
        || key.ends_with("Colors")
        || key.ends_with("Color")
        || key.ends_with("Keyword")
        || key.ends_with("Keywords")
        || key.ends_with("KWs")
        || key.ends_with("Counters")
        || matches!(
            key,
            "AddKeyword"
                | "AddColor"
                | "Attributes"
                | "ChooseEach"
                | "Color"
                | "Colors"
                | "ClearNotedCardsFor"
                | "ForgetCounter"
                | "Gains"
                | "KW"
                | "Keywords"
                | "Names"
                | "NoteCardsFor"
                | "PumpKeywords"
                | "SetColor"
                | "XColor"
                | "VarName"
                | "WithCounters"
        )
}

fn looks_like_expression_key(key: &str) -> bool {
    key.ends_with("Compare")
        || key.ends_with("Condition")
        || key.ends_with("Formula")
        || key.contains("ThisTurn")
        || key.starts_with("CheckOn")
        || key == "Expression"
        || key == "LifeTotal"
        || key == "Condition"
}

fn looks_like_expression_value(value: &str) -> bool {
    value.starts_with("Count$")
        || value.starts_with("Remembered$")
        || value.starts_with("Triggered$")
        || value.contains("/Plus.")
        || value.contains("/Minus.")
        || value.contains("/Times.")
        || value.contains("/Twice")
        || value.contains("/Half")
}

fn is_svar_name(raw: &str) -> bool {
    let mut chars = raw.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first == '_' || first.is_ascii_alphabetic())
        && chars.all(|c| c == '_' || c.is_ascii_alphanumeric())
}

fn looks_like_ability_record(raw: &str) -> bool {
    raw_has_any(raw, &[AB, SP, DB, ST])
}

fn looks_like_param_record(raw: &str) -> bool {
    raw.contains('$')
}

fn record_param_report_diagnostics<'a>(
    report: &ParsedParamsReport<'a>,
    line_no: usize,
    base_offset: usize,
    diagnostics: &mut ScriptDiagnostics<'a>,
) {
    for diagnostic in &report.diagnostics {
        diagnostics.push(ScriptDiagnostic {
            kind: ScriptDiagnosticKind::Param(diagnostic.kind),
            span: base_offset + diagnostic.span.start..base_offset + diagnostic.span.end,
            line_no,
            segment: diagnostic.segment,
            key: diagnostic.key,
            previous_value: diagnostic.previous_value,
            value: diagnostic.value,
        });
    }
}

fn parse_entry<'a>(part: &'a str, part_offset: usize) -> Option<ParamEntry<'a>> {
    let (trimmed, trimmed_offset) = trim_with_offset(part, part_offset);
    if trimmed.is_empty() {
        return None;
    }

    let mut input = trimmed;
    let key_raw = key_text.parse_next(&mut input).ok()?;
    let key_end = trimmed.len() - input.len();
    dollar.parse_next(&mut input).ok()?;

    let value_start_in_trimmed = if let Some(rest) = input.strip_prefix(' ') {
        input = rest;
        key_end + 2
    } else {
        key_end + 1
    };

    let key_leading = key_raw.len() - key_raw.trim_start().len();
    let key = key_raw.trim();
    let key_start = trimmed_offset + key_leading;
    let key_span = key_start..key_start + key.len();

    let value_raw = input;
    let value_leading = value_raw.len() - value_raw.trim_start().len();
    let value = value_raw.trim();
    let value_start = trimmed_offset + value_start_in_trimmed + value_leading;
    let value_span = value_start..value_start + value.len();

    Some(ParamEntry {
        key,
        value,
        key_span,
        value_span,
    })
}

fn key_text<'a>(input: &mut &'a str) -> Result<&'a str> {
    take_till(0.., '$').parse_next(input)
}

fn dollar(input: &mut &str) -> Result<char> {
    '$'.parse_next(input)
}

fn trim_with_offset(s: &str, offset: usize) -> (&str, usize) {
    let leading = s.len() - s.trim_start().len();
    (s.trim(), offset + leading)
}
