use std::sync::Arc;

use ordered_float::NotNan;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "deck/index.ts")]
pub enum CardFinish {
    Regular,
    Gloss,
    Etched,
    Prismatic,
    Cold,
    Opal,
    Rain,
    Heat,
    Pool,
    Holofoil,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "deck/index.ts")]
pub enum CardFramePreset {
    Printing,
    Modern,
    Retro,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "deck/index.ts")]
pub enum CardBorderPreset {
    Printing,
    Black,
    White,
    Silver,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "deck/index.ts")]
pub enum CardWearPreset {
    Fresh,
    Light,
    Played,
    Heavy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export, export_to = "deck/index.ts")]
pub enum CardWordingMode {
    #[serde(rename = "original")]
    Original,
    #[serde(rename = "oracle")]
    Oracle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export, export_to = "deck/index.ts")]
pub enum CardPrintingPreset {
    #[serde(rename = "match")]
    Match,
    #[serde(rename = "lea")]
    Lea,
    #[serde(rename = "leb")]
    Leb,
    #[serde(rename = "2ed")]
    Second,
    #[serde(rename = "3ed")]
    Third,
    #[serde(rename = "4ed")]
    Fourth,
    #[serde(rename = "leg")]
    Leg,
    #[serde(rename = "mir")]
    Mir,
    #[serde(rename = "7ed")]
    Seventh,
    #[serde(rename = "8ed")]
    Eighth,
    #[serde(rename = "plc")]
    Plc,
    #[serde(rename = "plc-colorshifted")]
    PlcColorshifted,
    #[serde(rename = "fut-regular")]
    FutRegular,
    #[serde(rename = "fut")]
    Fut,
    #[serde(rename = "m15")]
    M15,
    #[serde(rename = "m21")]
    M21,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export, export_to = "deck/index.ts")]
pub enum CardArtMode {
    #[serde(rename = "window")]
    Window,
    #[serde(rename = "behind-text")]
    BehindText,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export, export_to = "deck/index.ts")]
pub enum CardCollectorFormat {
    #[serde(rename = "number-first")]
    NumberFirst,
    #[serde(rename = "rarity-first")]
    RarityFirst,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export, export_to = "deck/index.ts")]
pub enum CardFutureTreatment {
    #[serde(rename = "regular")]
    Regular,
    #[serde(rename = "full-art")]
    FullArt,
    #[serde(rename = "clear")]
    Clear,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export, export_to = "deck/index.ts")]
pub enum CardSetSymbolMask {
    #[serde(rename = "auto")]
    Auto,
    #[serde(rename = "alpha")]
    Alpha,
    #[serde(rename = "ink")]
    Ink,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export, export_to = "deck/index.ts")]
pub enum CardSymbolStyle {
    #[serde(rename = "original")]
    Original,
    #[serde(rename = "modern")]
    Modern,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export, export_to = "deck/index.ts")]
pub enum CardPrintingBorder {
    #[serde(rename = "black")]
    Black,
    #[serde(rename = "white")]
    White,
    #[serde(rename = "silver")]
    Silver,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export, export_to = "deck/index.ts")]
pub enum CardSecurityStamp {
    #[serde(rename = "none")]
    None,
    #[serde(rename = "oval")]
    Oval,
    #[serde(rename = "triangle")]
    Triangle,
    #[serde(rename = "acorn")]
    Acorn,
    #[serde(rename = "circle")]
    Circle,
    #[serde(rename = "arena")]
    Arena,
    #[serde(rename = "heart")]
    Heart,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export, export_to = "deck/index.ts")]
pub enum CardPrintingColor {
    #[serde(rename = "W")]
    W,
    #[serde(rename = "U")]
    U,
    #[serde(rename = "B")]
    B,
    #[serde(rename = "R")]
    R,
    #[serde(rename = "G")]
    G,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(transparent)]
pub struct CardCosmeticNumber(NotNan<f64>);

impl CardCosmeticNumber {
    pub fn get(self) -> f64 {
        self.0.into_inner()
    }
}

impl<'de> Deserialize<'de> for CardCosmeticNumber {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = f64::deserialize(deserializer)?;
        if !value.is_finite() {
            return Err(serde::de::Error::custom("cosmetic number must be finite"));
        }
        NotNan::new(value)
            .map(Self)
            .map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "deck/index.ts")]
pub struct CardPrintingElementOverride {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub hidden: Option<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "offset"
    )]
    #[ts(optional, type = "[number, number]")]
    pub offset: Option<[CardCosmeticNumber; 2]>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "deck/index.ts")]
pub struct CardPrintingElements {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub artist: Option<CardPrintingElementOverride>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub legal: Option<CardPrintingElementOverride>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub collector: Option<CardPrintingElementOverride>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub mana_cost: Option<CardPrintingElementOverride>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub set_symbol: Option<CardPrintingElementOverride>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "deck/index.ts")]
pub struct CardPrintingOverrides {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "text"
    )]
    #[ts(optional)]
    pub artist: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "text"
    )]
    #[ts(optional)]
    pub legal_text: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "text"
    )]
    #[ts(optional)]
    pub collector_number: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "collector_total"
    )]
    #[ts(optional)]
    pub collector_total: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub collector_format: Option<CardCollectorFormat>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "language"
    )]
    #[ts(optional)]
    pub collector_language: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "set_code"
    )]
    #[ts(optional)]
    pub collector_set_code: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "set_code"
    )]
    #[ts(optional)]
    pub style_set_code: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "frame_colors"
    )]
    #[ts(optional)]
    pub frame_colors: Option<Vec<CardPrintingColor>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub future_treatment: Option<CardFutureTreatment>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "set_code"
    )]
    #[ts(optional)]
    pub set_symbol_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub set_symbol_mask: Option<CardSetSymbolMask>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub symbol_style: Option<CardSymbolStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub border_color: Option<CardPrintingBorder>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub security_stamp: Option<CardSecurityStamp>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub elements: Option<CardPrintingElements>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "deck/index.ts")]
pub struct CardArtPlacement {
    pub mode: CardArtMode,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "focal_point"
    )]
    #[ts(optional, type = "[number, number]")]
    pub focal_point: Option<[CardCosmeticNumber; 2]>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "zoom"
    )]
    #[ts(optional, type = "number")]
    pub zoom: Option<CardCosmeticNumber>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "paper_opacity"
    )]
    #[ts(optional, type = "number")]
    pub paper_opacity: Option<CardCosmeticNumber>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "deck/index.ts")]
pub struct CardPrintingFace {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub preset: Option<CardPrintingPreset>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub overrides: Option<CardPrintingOverrides>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub art: Option<CardArtPlacement>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "deck/index.ts")]
pub struct CardPrintingSelection {
    #[serde(deserialize_with = "version")]
    #[ts(type = "1")]
    pub version: u8,
    pub preset: CardPrintingPreset,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub overrides: Option<CardPrintingOverrides>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub art: Option<CardArtPlacement>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "faces"
    )]
    #[ts(optional)]
    pub faces: Option<Vec<CardPrintingFace>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "deck/index.ts")]
pub struct CardCoating {
    #[serde(deserialize_with = "unit_amount")]
    #[ts(type = "number")]
    pub amount: CardCosmeticNumber,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "deck/index.ts")]
pub struct CardPrintDots {
    #[serde(deserialize_with = "unit_amount")]
    #[ts(type = "number")]
    pub amount: CardCosmeticNumber,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "print_period"
    )]
    #[ts(optional, type = "number")]
    pub period: Option<CardCosmeticNumber>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "paper_opacity"
    )]
    #[ts(optional, type = "number")]
    pub variation: Option<CardCosmeticNumber>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "print_inset"
    )]
    #[ts(optional, type = "number")]
    pub inset: Option<CardCosmeticNumber>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub artwork: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "deck/index.ts")]
pub enum CardFinishCoverageArea {
    Full,
    Artwork,
    Left,
    Right,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "deck/index.ts")]
pub struct CardFinishCoverage {
    pub area: CardFinishCoverageArea,
    #[serde(deserialize_with = "unit_amount")]
    #[ts(type = "number")]
    pub amount: CardCosmeticNumber,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "deck/index.ts")]
pub struct CardCosmetics {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub finish: Option<CardFinish>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub frame: Option<CardFramePreset>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub border: Option<CardBorderPreset>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub wear: Option<CardWearPreset>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "wear_amount"
    )]
    #[ts(optional, type = "number")]
    pub wear_amount: Option<CardCosmeticNumber>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub wear_seed: Option<u32>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "rain_fog"
    )]
    #[ts(optional, type = "number")]
    pub rain_fog: Option<CardCosmeticNumber>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "heat_deformation"
    )]
    #[ts(optional, type = "number")]
    pub heat_deformation: Option<CardCosmeticNumber>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cardstock: Option<CardCoating>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub print_dots: Option<CardPrintDots>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub finish_coverage: Option<CardFinishCoverage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub wording: Option<CardWordingMode>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "printing"
    )]
    #[ts(optional, type = "CardPrintingSelection")]
    pub printing: Option<Arc<CardPrintingSelection>>,
}

impl CardPrintingElements {
    fn normalize(&mut self, inherited: bool) {
        for value in [
            &mut self.artist,
            &mut self.legal,
            &mut self.collector,
            &mut self.mana_cost,
            &mut self.set_symbol,
        ] {
            if let Some(element) = value {
                if !inherited
                    && element
                        .offset
                        .is_some_and(|v| v.iter().all(|n| n.get() == 0.0))
                {
                    element.offset = None;
                }
                if element.hidden.is_none() && element.offset.is_none() {
                    *value = None;
                }
            }
        }
    }
}

impl CardPrintingOverrides {
    fn normalize(&mut self, inherited: bool) {
        if let Some(elements) = &mut self.elements {
            elements.normalize(inherited);
            if *elements == CardPrintingElements::default() {
                self.elements = None;
            }
        }
    }
}

impl CardArtPlacement {
    fn normalize(&mut self, inherited: bool) -> Result<(), &'static str> {
        if self.mode == CardArtMode::Window && self.paper_opacity.is_some() {
            return Err("paperOpacity requires behind-text artwork");
        }
        if !inherited {
            if self
                .focal_point
                .is_some_and(|p| p.iter().all(|n| n.get() == 0.5))
            {
                self.focal_point = None;
            }
            if self.zoom.is_some_and(|n| n.get() == 1.0) {
                self.zoom = None;
            }
            if self.paper_opacity.is_some_and(|n| n.get() == 0.8) {
                self.paper_opacity = None;
            }
        }
        Ok(())
    }
}

fn normalize_layer(
    overrides: &mut Option<CardPrintingOverrides>,
    art: &mut Option<CardArtPlacement>,
    inherited: bool,
) -> Result<(), &'static str> {
    if let Some(value) = overrides {
        value.normalize(inherited);
        if *value == CardPrintingOverrides::default() {
            *overrides = None;
        }
    }
    if let Some(value) = art {
        value.normalize(inherited)?;
    }
    Ok(())
}

fn printing<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<Arc<CardPrintingSelection>>, D::Error> {
    let Some(mut value) = Option::<CardPrintingSelection>::deserialize(d)? else {
        return Ok(None);
    };
    normalize_layer(&mut value.overrides, &mut value.art, false)
        .map_err(serde::de::Error::custom)?;
    if let Some(faces) = &mut value.faces {
        for face in faces.iter_mut() {
            normalize_layer(&mut face.overrides, &mut face.art, true)
                .map_err(serde::de::Error::custom)?;
        }
        while faces
            .last()
            .is_some_and(|face| *face == CardPrintingFace::default())
        {
            faces.pop();
        }
        if faces.is_empty() {
            value.faces = None;
        }
    }
    if value.preset == CardPrintingPreset::Match
        && value.overrides.is_none()
        && value.art.is_none()
        && value.faces.is_none()
    {
        return Ok(None);
    }
    Ok(Some(Arc::new(value)))
}

impl CardCosmetics {
    pub fn normalize(mut self) -> Option<Self> {
        if self.frame == Some(CardFramePreset::Printing) {
            self.frame = None;
        }
        if self.border == Some(CardBorderPreset::Printing) {
            self.border = None;
        }
        if let Some(amount) = self.wear_amount {
            self.wear = None;
            if amount.get() == 0.0 {
                self.wear_amount = None;
            }
        } else if self.wear == Some(CardWearPreset::Fresh) {
            self.wear = None;
        }
        if self.wear.is_none() && self.wear_amount.is_none() || self.wear_seed == Some(0) {
            self.wear_seed = None;
        }
        if self.rain_fog.is_some_and(|n| n.get() == 1.0) {
            self.rain_fog = None;
        }
        if self.heat_deformation.is_some_and(|n| n.get() == 0.0) {
            self.heat_deformation = None;
        }
        if self
            .cardstock
            .as_ref()
            .is_some_and(|v| v.amount.get() == 0.0)
        {
            self.cardstock = None;
        }
        if let Some(dots) = &mut self.print_dots {
            if dots.period.is_some_and(|n| n.get() == 5.0) {
                dots.period = None;
            }
            if dots.variation.is_some_and(|n| n.get() == 0.5) {
                dots.variation = None;
            }
            if dots.inset.is_some_and(|n| n.get() == 0.0) {
                dots.inset = None;
            }
            if dots.artwork == Some(true) {
                dots.artwork = None;
            }
            if dots.amount.get() == 0.0 {
                self.print_dots = None;
            }
        }
        if self.wording == Some(CardWordingMode::Oracle) {
            self.wording = None;
        }
        if self
            .printing
            .as_ref()
            .is_some_and(|p| p.preset != CardPrintingPreset::Match)
        {
            self.frame = None;
        }
        (self != Self::default()).then_some(self)
    }

    pub fn deserialize_optional<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Option<Self>, D::Error> {
        Ok(Option::<Self>::deserialize(deserializer)?.and_then(Self::normalize))
    }
}

fn version<'de, D: serde::Deserializer<'de>>(d: D) -> Result<u8, D::Error> {
    let value = u8::deserialize(d)?;
    if value != 1 {
        return Err(serde::de::Error::custom("unsupported printing version"));
    }
    Ok(value)
}

fn faces<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<Vec<CardPrintingFace>>, D::Error> {
    let value = Option::<Vec<CardPrintingFace>>::deserialize(d)?;
    if value.as_ref().is_some_and(|v| v.len() > 2) {
        return Err(serde::de::Error::custom(
            "printing supports at most two faces",
        ));
    }
    Ok(value)
}

fn frame_colors<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<Vec<CardPrintingColor>>, D::Error> {
    let value = Option::<Vec<CardPrintingColor>>::deserialize(d)?;
    if let Some(colors) = &value {
        if colors.len() > 5
            || colors
                .iter()
                .enumerate()
                .any(|(i, c)| colors[..i].contains(c))
        {
            return Err(serde::de::Error::custom("invalid printing frame colors"));
        }
    }
    Ok(value)
}

fn collector_total<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<u32>, D::Error> {
    let value = Option::<u32>::deserialize(d)?;
    if value.is_some_and(|n| !(1..=99999).contains(&n)) {
        return Err(serde::de::Error::custom("invalid collector total"));
    }
    Ok(value)
}

fn unit_amount<'de, D: serde::Deserializer<'de>>(d: D) -> Result<CardCosmeticNumber, D::Error> {
    let value = CardCosmeticNumber::deserialize(d)?;
    if !(0.0..=1.0).contains(&value.get()) {
        return Err(serde::de::Error::custom("invalid cosmetic amount"));
    }
    Ok(value)
}

fn print_period<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<CardCosmeticNumber>, D::Error> {
    let value = Option::<CardCosmeticNumber>::deserialize(d)?;
    if value.is_some_and(|n| !(2.0..=16.0).contains(&n.get())) {
        return Err(serde::de::Error::custom("invalid print period"));
    }
    Ok(value)
}

fn print_inset<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<CardCosmeticNumber>, D::Error> {
    let value = Option::<CardCosmeticNumber>::deserialize(d)?;
    if value.is_some_and(|n| !(0.0..=0.2).contains(&n.get())) {
        return Err(serde::de::Error::custom("invalid print inset"));
    }
    Ok(value)
}

fn wear_amount<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<CardCosmeticNumber>, D::Error> {
    let value = Option::<CardCosmeticNumber>::deserialize(d)?;
    if value.is_some_and(|n| !(0.0..=1.0).contains(&n.get())) {
        return Err(serde::de::Error::custom("invalid wear_amount"));
    }
    Ok(value)
}

fn rain_fog<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<CardCosmeticNumber>, D::Error> {
    let value = Option::<CardCosmeticNumber>::deserialize(d)?;
    if value.is_some_and(|n| !(0.0..=2.0).contains(&n.get())) {
        return Err(serde::de::Error::custom("invalid rain_fog"));
    }
    Ok(value)
}

fn heat_deformation<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<CardCosmeticNumber>, D::Error> {
    let value = Option::<CardCosmeticNumber>::deserialize(d)?;
    if value.is_some_and(|n| !(0.0..=0.02).contains(&n.get())) {
        return Err(serde::de::Error::custom("invalid heat_deformation"));
    }
    Ok(value)
}

fn zoom<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<CardCosmeticNumber>, D::Error> {
    let value = Option::<CardCosmeticNumber>::deserialize(d)?;
    if value.is_some_and(|n| !(1.0..=8.0).contains(&n.get())) {
        return Err(serde::de::Error::custom("invalid zoom"));
    }
    Ok(value)
}

fn paper_opacity<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<CardCosmeticNumber>, D::Error> {
    let value = Option::<CardCosmeticNumber>::deserialize(d)?;
    if value.is_some_and(|n| !(0.0..=1.0).contains(&n.get())) {
        return Err(serde::de::Error::custom("invalid paper_opacity"));
    }
    Ok(value)
}

fn focal_point<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<[CardCosmeticNumber; 2]>, D::Error> {
    let value = Option::<[CardCosmeticNumber; 2]>::deserialize(d)?;
    if value.is_some_and(|v| v.iter().any(|n| !(0.0..=1.0).contains(&n.get()))) {
        return Err(serde::de::Error::custom("invalid focal_point"));
    }
    Ok(value)
}

fn offset<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<[CardCosmeticNumber; 2]>, D::Error> {
    let value = Option::<[CardCosmeticNumber; 2]>::deserialize(d)?;
    if value.is_some_and(|v| v.iter().any(|n| !(-100.0..=100.0).contains(&n.get()))) {
        return Err(serde::de::Error::custom("invalid offset"));
    }
    Ok(value)
}

fn text<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    let value = Option::<String>::deserialize(d)?;
    if value
        .as_ref()
        .is_some_and(|s| !(s.encode_utf16().count() <= 2048))
    {
        return Err(serde::de::Error::custom("invalid text"));
    }
    Ok(value)
}

fn set_code<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    let value = Option::<String>::deserialize(d)?;
    if value.as_ref().is_some_and(|s| {
        !(!s.is_empty()
            && s.len() <= 16
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'))
    }) {
        return Err(serde::de::Error::custom("invalid set_code"));
    }
    Ok(value)
}

fn language<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    let value = Option::<String>::deserialize(d)?;
    if value.as_ref().is_some_and(|s| {
        !((2..=5).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphabetic()))
    }) {
        return Err(serde::de::Error::custom("invalid language"));
    }
    Ok(value)
}
