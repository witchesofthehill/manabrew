//! Semantic names for Forge `Cost$` token identifiers.
//!
//! The raw card script still uses strings like `Sac<...>` and `T`; this enum
//! keeps those spellings in the parsing layer so cost execution can dispatch on
//! typed variants.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CostTokenKind {
    AddCounter,
    AddMana,
    Behold,
    BeholdExile,
    Blight,
    ChooseCard,
    ChooseColor,
    ChooseCreatureType,
    CollectEvidence,
    DamageYou,
    Discard,
    Draw,
    Enlist,
    Exert,
    Exile,
    ExileAnyGrave,
    ExileCtrlOrGrave,
    ExiledMoveToGrave,
    ExileFromGrave,
    ExileFromHand,
    ExileFromStack,
    ExileFromTop,
    ExileSameGrave,
    FlipCoin,
    Forage,
    GainControl,
    GainLife,
    Mana,
    Mandatory,
    Mill,
    PayEnergy,
    PayLife,
    PayShards,
    PromiseGift,
    PutCardToLibFromBattlefield,
    PutCardToLibFromGrave,
    PutCardToLibFromHand,
    PutCardToLibFromSameGrave,
    RemoveAnyCounter,
    Return,
    Reveal,
    RevealChosen,
    RevealFromExile,
    RevealOrChoose,
    RollDice,
    Sac,
    SubCounter,
    Tap,
    TapXType,
    Unattach,
    Untap,
    UntapYType,
    Waterbend,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CostToken<'a> {
    pub kind: CostTokenKind,
    pub inner: Option<&'a str>,
}

impl CostTokenKind {
    pub fn parse(token: &str) -> Option<CostToken<'_>> {
        Self::parse_exact(token).or_else(|| Self::parse_prefixed(token))
    }

    fn parse_exact(token: &str) -> Option<CostToken<'_>> {
        let kind = match token {
            "T" | "Tap" => Self::Tap,
            "Q" | "Untap" => Self::Untap,
            "Mandatory" => Self::Mandatory,
            "Forage" => Self::Forage,
            token if token.starts_with("PromiseGift") => Self::PromiseGift,
            _ => return None,
        };
        Some(CostToken { kind, inner: None })
    }

    fn parse_prefixed(token: &str) -> Option<CostToken<'_>> {
        if let Some(inner) = token.strip_prefix("Exert<") {
            return Some(CostToken {
                kind: Self::Exert,
                inner: inner.strip_suffix('>'),
            });
        }

        // Longer prefixes must stay before shorter prefixes when the names
        // overlap, matching Forge's original if/else parser.
        let prefixes = [
            (Self::Mana, "Mana<"),
            (Self::Sac, "Sac<"),
            (Self::Discard, "Discard<"),
            (Self::PayLife, "PayLife<"),
            (Self::SubCounter, "SubCounter<"),
            (Self::AddCounter, "AddCounter<"),
            (Self::PayEnergy, "PayEnergy<"),
            (Self::PayShards, "PayShards<"),
            (Self::ChooseColor, "ChooseColor<"),
            (Self::ChooseCreatureType, "ChooseCreatureType<"),
            (Self::FlipCoin, "FlipCoin<"),
            (Self::RollDice, "RollDice<"),
            (Self::ExileFromHand, "ExileFromHand<"),
            (Self::ExileFromGrave, "ExileFromGrave<"),
            (Self::ExileFromTop, "ExileFromTop<"),
            (Self::ExileFromStack, "ExileFromStack<"),
            (Self::ExileAnyGrave, "ExileAnyGrave<"),
            (Self::ExileSameGrave, "ExileSameGrave<"),
            (Self::ExileCtrlOrGrave, "ExileCtrlOrGrave<"),
            (Self::ExiledMoveToGrave, "ExiledMoveToGrave<"),
            (Self::Exile, "Exile<"),
            (Self::Return, "Return<"),
            (Self::TapXType, "tapXType<"),
            (Self::UntapYType, "untapYType<"),
            (Self::DamageYou, "DamageYou<"),
            (Self::Draw, "Draw<"),
            (Self::Mill, "Mill<"),
            (Self::Reveal, "Reveal<"),
            (Self::ChooseCard, "ChooseCard<"),
            (Self::RevealFromExile, "RevealFromExile<"),
            (Self::RevealOrChoose, "RevealOrChoose<"),
            (Self::RevealChosen, "RevealChosen<"),
            (Self::BeholdExile, "BeholdExile<"),
            (Self::Behold, "Behold<"),
            (Self::GainLife, "GainLife<"),
            (Self::GainControl, "GainControl<"),
            (Self::RemoveAnyCounter, "RemoveAnyCounter<"),
            (Self::Unattach, "Unattach<"),
            (Self::Waterbend, "Waterbend<"),
            (Self::AddMana, "AddMana<"),
            (Self::CollectEvidence, "CollectEvidence<"),
            (Self::PutCardToLibFromHand, "PutCardToLibFromHand<"),
            (
                Self::PutCardToLibFromSameGrave,
                "PutCardToLibFromSameGrave<",
            ),
            (Self::PutCardToLibFromGrave, "PutCardToLibFromGrave<"),
            (
                Self::PutCardToLibFromBattlefield,
                "PutCardToLibFromBattlefield<",
            ),
            (Self::Enlist, "Enlist<"),
            (Self::Blight, "Blight<"),
        ];

        prefixes.iter().find_map(|(kind, prefix)| {
            token
                .strip_prefix(prefix)
                .and_then(|inner| inner.strip_suffix('>'))
                .map(|inner| CostToken {
                    kind: *kind,
                    inner: Some(inner),
                })
        })
    }
}
