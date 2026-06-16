//! Keyword-based ability and trigger generation for Card.
//!
//! These functions translate keywords like "Cycling", "Prowess", "Bushido", etc. into
//! concrete activated abilities and triggered abilities. They're called during card
//! initialization in `Card::from_rules()`.

use crate::ability::activated::parse_activated_ability;
use crate::card::svar_cache::ParsedSVarKind;
use crate::parsing::keys;
use crate::parsing::Params;
use crate::staticability::parse_static_ability;
use crate::trigger::parse_trigger;

use super::Card;

impl Card {
    fn parsed_svar_params(&mut self, name: &str) -> Option<Params> {
        match self.parsed_s_var(name)?.kind {
            ParsedSVarKind::Ability { params, .. } | ParsedSVarKind::ParamRecord { params } => {
                Some(params)
            }
            ParsedSVarKind::Number { .. }
            | ParsedSVarKind::Count { .. }
            | ParsedSVarKind::NumericExpression { .. }
            | ParsedSVarKind::Raw { .. } => None,
        }
    }

    /// Generate intrinsic mana abilities for basic land subtypes (Plains → {W}, etc.).
    /// Mirrors Java's `CardFactoryUtil.addIntrinsicAbilities()`.
    pub(crate) fn generate_basic_land_mana_abilities(&mut self) {
        const SUBTYPE_MANA: &[(&str, &str, &str)] = &[
            ("Plains", "W", "Add {W}."),
            ("Island", "U", "Add {U}."),
            ("Swamp", "B", "Add {B}."),
            ("Mountain", "R", "Add {R}."),
            ("Forest", "G", "Add {G}."),
        ];
        for &(subtype, letter, desc) in SUBTYPE_MANA {
            if self.type_line.has_subtype(subtype) {
                let already_produces = self.activated_abilities.iter().any(|ab| {
                    ab.is_mana_ability
                        && ab
                            .produced_ir
                            .as_ref()
                            .is_some_and(|ir| ir.as_script_text() == letter)
                });
                if !already_produces {
                    let raw = format!(
                        "AB$ Mana | Cost$ T | Produced$ {} | SpellDescription$ {}",
                        letter, desc
                    );
                    let idx = self.abilities.len();
                    self.abilities.push(raw.clone());
                    if let Some(ab) = parse_activated_ability(&raw, idx) {
                        self.activated_abilities.push(ab);
                    }
                }
            }
        }
    }

    /// Generate activated abilities from keywords (e.g. Cycling → AB$ Draw).
    /// Mirrors Java's `CardFactoryUtil.setupKeywordedAbilities()`.
    pub(super) fn generate_keyword_abilities(&mut self) {
        // Cycling: K:Cycling:{cost} → AB$ Draw | Cost$ {cost} Discard<1/CARDNAME> | ActivationZone$ Hand
        if let Some(cycling_cost) = self.get_keyword_cost("Cycling") {
            let ab_text = format!(
                "AB$ Draw | Cost$ {} Discard<1/CARDNAME> | ActivationZone$ Hand | NumCards$ 1 | Defined$ You",
                cycling_cost
            );
            let next_idx = self.activated_abilities.len();
            if let Some(ab) = parse_activated_ability(&ab_text, next_idx) {
                self.activated_abilities.push(ab);
            }
        }

        // TypeCycling: K:TypeCycling:{type}:{cost} → AB$ ChangeZone | Cost$ {cost} Discard<1/CARDNAME> | ActivationZone$ Hand
        // Mirrors Java CardFactoryUtil lines 3852-3864.
        for kw in self
            .keywords
            .iter_strings()
            .chain(self.granted_keywords.iter_strings())
        {
            if let Some(rest) = kw.strip_prefix("TypeCycling:") {
                let parts: Vec<&str> = rest.splitn(2, ':').collect();
                if parts.len() == 2 {
                    let cycle_type = parts[0].trim(); // e.g., "Swamp"
                    let mana_cost = parts[1].trim(); // e.g., "1"
                                                     // getTitleWithoutCost() = capitalize(descType) + "cycling"
                    let precost_desc = format!(
                        "{}cycling",
                        cycle_type
                            .chars()
                            .next()
                            .map(|c| c.to_uppercase().to_string())
                            .unwrap_or_default()
                            + &cycle_type[1..]
                    );
                    let ab_text = format!(
                        "AB$ ChangeZone | Cost$ {} Discard<1/CARDNAME> | ActivationZone$ Hand | PrecostDesc$ {} | Origin$ Library | Destination$ Hand | ChangeType$ {}",
                        mana_cost, precost_desc, cycle_type
                    );
                    let next_idx = self.activated_abilities.len();
                    if let Some(ab) = parse_activated_ability(&ab_text, next_idx) {
                        self.activated_abilities.push(ab);
                    }
                }
            }
        }

        // Equip: K:Equip:{cost}[...]
        // Forge keyword payload can include optional suffix data; we only need
        // the activation cost + default target filter to mirror Java baseline.
        for equip_raw in self
            .keywords
            .iter_strings()
            .chain(self.granted_keywords.iter_strings())
            .filter_map(|kw| crate::keyword::extract_keyword_cost_str(kw, "Equip"))
        {
            let payload = equip_raw.split(":::").next().unwrap_or(equip_raw).trim();
            let mut parts = payload.split(':');
            let equip_cost = parts.next().unwrap_or(payload).trim();
            let target_filter = parts
                .next()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("Creature.YouCtrl");
            if !equip_cost.is_empty() {
                let ab_text = format!(
                    "AB$ Attach | Cost$ {} | ValidTgts$ {} | SorcerySpeed$ True | SpellDescription$ Equip {}",
                    equip_cost, target_filter, equip_cost
                );
                let next_idx = self.activated_abilities.len();
                if let Some(ab) = parse_activated_ability(&ab_text, next_idx) {
                    self.activated_abilities.push(ab);
                }
            }
        }

        // Adapt: K:Adapt:N:cost → AB$ PutCounter with Adapt$ True gate.
        // Mirrors Java CardFactoryUtil lines 2665-2684.
        for kw in self
            .keywords
            .iter_strings()
            .chain(self.granted_keywords.iter_strings())
        {
            if let Some(rest) = crate::keyword::extract_keyword_cost_str(kw, "Adapt") {
                let parts: Vec<&str> = rest.splitn(2, ':').collect();
                if parts.len() == 2 {
                    let magnitude = parts[0].trim();
                    let mana_cost = parts[1].trim();
                    let ab_text = format!(
                        "AB$ PutCounter | Cost$ {} | Adapt$ True | CounterNum$ {} | CounterType$ P1P1 | StackDescription$ SpellDescription | SpellDescription$ Adapt {}",
                        mana_cost, magnitude, magnitude
                    );
                    let next_idx = self.activated_abilities.len();
                    if let Some(ab) = parse_activated_ability(&ab_text, next_idx) {
                        self.activated_abilities.push(ab);
                    }
                }
            }
        }

        // Crew: K:Crew:N → AB$ Animate (tap creatures with total power ≥N).
        // Mirrors Java CardFactoryUtil lines 3820-3835.
        // Uses tapXType<Any/Creature.Other+withTotalPowerGE{N}> matching Java's format.
        for kw in self
            .keywords
            .iter_strings()
            .chain(self.granted_keywords.iter_strings())
        {
            if let Some(n_str) = crate::keyword::extract_keyword_cost_str(kw, "Crew") {
                let n = n_str.trim();
                let ab_text = format!(
                    "AB$ Animate | Cost$ tapXType<Any/Creature.Other+withTotalPowerGE{{{}}}> | Defined$ Self | Types$ Artifact,Creature | Secondary$ True | SpellDescription$ Crew {}",
                    n, n
                );
                let next_idx = self.activated_abilities.len();
                if let Some(ab) = parse_activated_ability(&ab_text, next_idx) {
                    self.activated_abilities.push(ab);
                }
            }
        }

        // Station: K:Station:N → AB$ PutCounter (tap another creature to add charge counters).
        // Mirrors Java CardFactoryUtil lines 3587-3595.
        // The ability is sorcery-speed and puts charge counters equal to the tapped
        // creature's power onto this Spacecraft/Planet.
        for kw in self
            .keywords
            .iter_strings()
            .chain(self.granted_keywords.iter_strings())
        {
            if let Some(_n_str) = crate::keyword::extract_keyword_cost_str(kw, "Station") {
                let ab_text = "AB$ PutCounter | Cost$ tapXType<1/Creature.Other> | Defined$ Self | CounterType$ CHARGE | CounterNum$ StationX | SorcerySpeed$ True | CostDesc$ | SpellDescription$ Station";
                let next_idx = self.activated_abilities.len();
                if let Some(ab) = parse_activated_ability(ab_text, next_idx) {
                    self.activated_abilities.push(ab);
                }
                self.svars
                    .entry("StationX".to_string())
                    .or_insert_with(|| "TappedCards$TapPowerValue".to_string());
            }
        }

        // Embalm: K:Embalm:cost → AB$ CopyPermanent from graveyard.
        // Mirrors Java CardFactoryUtil lines 2879-2891.
        for kw in self
            .keywords
            .iter_strings()
            .chain(self.granted_keywords.iter_strings())
        {
            if let Some(cost_str) = crate::keyword::extract_keyword_cost_str(kw, "Embalm") {
                let cost = cost_str.trim();
                let ab_text = format!(
                    "AB$ CopyPermanent | Cost$ {} ExileFromGrave<1/CARDNAME> | ActivationZone$ Graveyard | SorcerySpeed$ True | Defined$ Self | SetColor$ White | AddTypes$ Zombie | SpellDescription$ Embalm",
                    cost
                );
                let next_idx = self.activated_abilities.len();
                if let Some(ab) = parse_activated_ability(&ab_text, next_idx) {
                    self.activated_abilities.push(ab);
                }
            }
        }

        // Eternalize: K:Eternalize:cost → AB$ CopyPermanent from graveyard as 4/4.
        // Mirrors Java CardFactoryUtil lines 3023-3052.
        for kw in self
            .keywords
            .iter_strings()
            .chain(self.granted_keywords.iter_strings())
        {
            if let Some(cost_str) = crate::keyword::extract_keyword_cost_str(kw, "Eternalize") {
                let cost = cost_str.trim();
                let ab_text = format!(
                    "AB$ CopyPermanent | Cost$ {} ExileFromGrave<1/CARDNAME> | ActivationZone$ Graveyard | SorcerySpeed$ True | Defined$ Self | SetColor$ Black | SetPower$ 4 | SetToughness$ 4 | AddTypes$ Zombie | SpellDescription$ Eternalize",
                    cost
                );
                let next_idx = self.activated_abilities.len();
                if let Some(ab) = parse_activated_ability(&ab_text, next_idx) {
                    self.activated_abilities.push(ab);
                }
            }
        }

        // Enlist: K:Enlist -> intrinsic optional attack cost static ability.
        if self
            .keywords
            .iter_strings()
            .chain(self.granted_keywords.iter_strings())
            .any(|k| k.eq_ignore_ascii_case("Enlist"))
        {
            let raw = "S:Mode$ OptionalAttackCost | ValidCard$ Card.Self | Cost$ Enlist<1/CARDNAME/creature> | Secondary$ True | Trigger$ TrigEnlist";
            if let Some(sa) = parse_static_ability(raw) {
                self.add_static_ability(sa);
            }
            self.svars.entry("TrigEnlist".to_string()).or_insert_with(|| {
                "DB$ Pump | NumAtt$ TriggerRemembered$CardPower | SpellDescription$ When you do, add its power to this creature's until end of turn.".to_string()
            });
        }

        // Morph / Megamorph: mark card as castable face-down for {3}.
        // The actual casting logic is in game_action_util (playable check + cost handling).
        if self
            .keywords
            .iter_strings()
            .chain(self.granted_keywords.iter_strings())
            .any(|k| k.starts_with("Morph:") || k.starts_with("Megamorph:"))
        {
            self.has_morph = true;
        }

        // Plot: K:Plot:{cost} → AB$ Plot | Cost$ {cost} | ActivationZone$ Hand | SorcerySpeed$ True
        // Mirrors Java CardFactoryUtil lines 3398-3449.
        // Exiles the card from hand; plotted cards can later be cast for free.
        if let Some(plot_cost) = self.get_keyword_cost("Plot") {
            let ab_text = format!(
                "AB$ Plot | Cost$ {} | ActivationZone$ Hand | SorcerySpeed$ True | Secondary$ True | SpellDescription$ Plot",
                plot_cost
            );
            let next_idx = self.activated_abilities.len();
            if let Some(ab) = parse_activated_ability(&ab_text, next_idx) {
                self.activated_abilities.push(ab);
            }
        }

        // Class: K:Class:{level}:{cost}:{params} → AB$ ClassLevelUp.
        // Mirrors Java CardFactoryUtil lines 2789-2799.
        let class_keywords: Vec<String> = self
            .keywords
            .iter_strings()
            .chain(self.granted_keywords.iter_strings())
            .filter(|kw| kw.starts_with("Class:"))
            .map(|kw| kw.to_string())
            .collect();
        for kw in class_keywords {
            if let Some(rest) = kw.strip_prefix("Class:") {
                let mut parts = rest.splitn(3, ':');
                let level = parts.next().unwrap_or_default().trim();
                let cost = parts.next().unwrap_or_default().trim();
                let params = parts.next().unwrap_or_default().trim();

                let Ok(level_num) = level.parse::<i32>() else {
                    continue;
                };
                if cost.is_empty() {
                    continue;
                }

                let ab_text = format!(
                    "AB$ ClassLevelUp | Cost$ {} | ClassLevel$ EQ{} | SorcerySpeed$ True | StackDescription$ SpellDescription | SpellDescription$ Level {}",
                    cost,
                    level_num - 1,
                    level_num
                );
                let next_idx = self.activated_abilities.len();
                if let Some(ab) = parse_activated_ability(&ab_text, next_idx) {
                    self.activated_abilities.push(ab);
                }

                if !params.is_empty() {
                    let parsed = Params::from_raw(params);
                    let mut desc_parts: Vec<String> = Vec::new();

                    if let Some(add_trigger) = parsed.get("AddTrigger") {
                        for svar_name in add_trigger
                            .split(" & ")
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                        {
                            if let Some(svar_params) = self.parsed_svar_params(svar_name) {
                                if let Some(desc) = svar_params.get(keys::TRIGGER_DESCRIPTION) {
                                    desc_parts.push(desc.to_string());
                                }
                            }
                        }
                    }

                    if let Some(add_static) = parsed.get("AddStaticAbility") {
                        for svar_name in add_static
                            .split(" & ")
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                        {
                            if let Some(svar_params) = self.parsed_svar_params(svar_name) {
                                if let Some(desc) = svar_params.get(keys::DESCRIPTION) {
                                    desc_parts.push(desc.to_string());
                                }
                            }
                        }
                    }

                    if let Some(add_replacement) = parsed.get("AddReplacementEffect") {
                        for svar_name in add_replacement
                            .split(" & ")
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                        {
                            if let Some(svar_params) = self.parsed_svar_params(svar_name) {
                                if let Some(desc) = svar_params.get(keys::DESCRIPTION) {
                                    desc_parts.push(desc.to_string());
                                }
                            }
                        }
                    }

                    let mut effect = format!(
                        "Mode$ Continuous | Affected$ Card.Self | ClassLevel$ {} | {}",
                        level_num, params
                    );
                    if !desc_parts.is_empty() {
                        effect.push_str(" | Description$ ");
                        effect.push_str(&desc_parts.join("\r\n"));
                    }
                    if let Some(st) = parse_static_ability(&effect) {
                        self.add_static_ability(st);
                    }
                }
            }
        }
    }

    pub fn ensure_crew_activated_ability(&mut self) {
        if self.activated_abilities.iter().any(|ab| {
            ab.spell_description
                .as_deref()
                .is_some_and(|desc| desc.starts_with("Crew"))
        }) {
            return;
        }
        for kw in self.keywords.iter_strings() {
            if let Some(n_str) = crate::keyword::extract_keyword_cost_str(kw, "Crew") {
                let n = n_str.trim();
                let ab_text = format!(
                    "AB$ Animate | Cost$ tapXType<Any/Creature.Other+withTotalPowerGE{{{}}}> | Defined$ Self | Types$ Artifact,Creature | Secondary$ True | SpellDescription$ Crew {}",
                    n, n
                );
                let next_idx = self.activated_abilities.len();
                if let Some(ab) = parse_activated_ability(&ab_text, next_idx) {
                    self.activated_abilities.push(ab);
                    self.base_ability_count = self.activated_abilities.len();
                }
                return;
            }
        }
    }

    /// Generate triggered abilities from keywords (e.g. Prowess, Bushido, Annihilator, etc.).
    /// Mirrors Java's `CardFactoryUtil.setupKeywordedTriggers()`.
    pub fn generate_keyword_triggers(&mut self) {
        let mut next_id = self.triggers.len() as u32;

        for kw in self.keywords.as_string_list() {
            self.generate_keyword_trigger_combat(&kw, &mut next_id);
            self.generate_keyword_trigger_zone(&kw, &mut next_id);
            self.generate_keyword_trigger_misc(&kw, &mut next_id);
        }
    }

    fn generate_keyword_trigger_combat(&mut self, kw: &str, next_id: &mut u32) {
        if kw == "Prowess" {
            let raw = "Mode$ SpellCast | ValidCard$ Card.nonCreature | ValidActivatingPlayer$ You | Execute$ TrigProwess | TriggerZones$ Battlefield | TriggerDescription$ Prowess";
            if let Some(mut trig) = parse_trigger(raw, next_id) {
                trig.execute = "TrigProwess".to_string();
                self.add_trigger(trig);
            }
            self.svars
                .entry("TrigProwess".to_string())
                .or_insert_with(|| "DB$ Pump | Defined$ Self | NumAtt$ 1 | NumDef$ 1".to_string());
        }

        if let Some(n_str) = crate::keyword::extract_keyword_cost_str(kw, "Bushido") {
            if n_str.parse::<i32>().is_ok() {
                let raw1 = format!(
                    "Mode$ Blocks | ValidCard$ Card.Self | Execute$ TrigBushido | TriggerZones$ Battlefield | TriggerDescription$ Bushido {n_str}"
                );
                if let Some(mut trig) = parse_trigger(&raw1, next_id) {
                    trig.execute = "TrigBushido".to_string();
                    self.add_trigger(trig);
                }
                let raw2 = format!(
                    "Mode$ AttackerBlocked | ValidCard$ Card.Self | Execute$ TrigBushido | TriggerZones$ Battlefield | TriggerDescription$ Bushido {n_str}"
                );
                if let Some(mut trig) = parse_trigger(&raw2, next_id) {
                    trig.execute = "TrigBushido".to_string();
                    self.add_trigger(trig);
                }
                self.svars
                    .entry("TrigBushido".to_string())
                    .or_insert_with(|| {
                        format!("DB$ Pump | Defined$ Self | NumAtt$ {n_str} | NumDef$ {n_str}")
                    });
            }
        }

        if let Some(n_str) = crate::keyword::extract_keyword_cost_str(kw, "Annihilator") {
            if n_str.parse::<i32>().is_ok() {
                let raw = format!(
                    "Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigAnnihilator | TriggerZones$ Battlefield | TriggerDescription$ Annihilator {n_str}"
                );
                if let Some(mut trig) = parse_trigger(&raw, next_id) {
                    trig.execute = "TrigAnnihilator".to_string();
                    self.add_trigger(trig);
                }
                self.svars
                    .entry("TrigAnnihilator".to_string())
                    .or_insert_with(|| {
                        format!("DB$ Sacrifice | Defined$ TriggeredDefendingPlayer | SacValid$ Permanent | Amount$ {n_str}")
                    });
            }
        }

        if let Some(n_str) = crate::keyword::extract_keyword_cost_str(kw, "Afflict") {
            if n_str.parse::<i32>().is_ok() {
                let raw = format!(
                    "Mode$ AttackerBlocked | ValidCard$ Card.Self | TriggerZones$ Battlefield | Secondary$ True | Execute$ TrigAfflict | TriggerDescription$ Afflict {n_str}"
                );
                if let Some(mut trig) = parse_trigger(&raw, next_id) {
                    trig.execute = "TrigAfflict".to_string();
                    self.add_trigger(trig);
                }
                self.svars
                    .entry("TrigAfflict".to_string())
                    .or_insert_with(|| {
                        format!("DB$ LoseLife | Defined$ TriggeredDefendingPlayer | LifeAmount$ {n_str}")
                    });
            }
        }

        if kw == "Exalted" {
            let raw = "Mode$ Attacks | ValidCard$ Creature.YouCtrl | Alone$ True | Execute$ TrigExalted | TriggerZones$ Battlefield | TriggerDescription$ Exalted";
            if let Some(mut trig) = parse_trigger(raw, next_id) {
                trig.execute = "TrigExalted".to_string();
                self.add_trigger(trig);
            }
            self.svars
                .entry("TrigExalted".to_string())
                .or_insert_with(|| {
                    "DB$ Pump | Defined$ TriggeredAttacker | NumAtt$ +1 | NumDef$ +1".to_string()
                });
        }

        if let Some(n_str) = crate::keyword::extract_keyword_cost_str(kw, "Renown") {
            if n_str.parse::<i32>().is_ok() {
                let raw = format!(
                    "Mode$ DamageDone | ValidSource$ Card.Self | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigRenown | TriggerZones$ Battlefield | TriggerDescription$ Renown {n_str}"
                );
                if let Some(mut trig) = parse_trigger(&raw, next_id) {
                    trig.execute = "TrigRenown".to_string();
                    self.add_trigger(trig);
                }
                self.svars
                    .entry("TrigRenown".to_string())
                    .or_insert_with(|| {
                        format!("DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ {n_str} | Renown$ True")
                    });
            }
        }

        if kw == "Flanking" {
            let raw = "Mode$ AttackerBlockedByCreature | ValidBlocked$ Card.Self | ValidCard$ Creature.withoutFlanking | Execute$ TrigFlanking | TriggerZones$ Battlefield | TriggerDescription$ Flanking";
            if let Some(mut trig) = parse_trigger(raw, next_id) {
                trig.execute = "TrigFlanking".to_string();
                self.add_trigger(trig);
            }
            self.svars
                .entry("TrigFlanking".to_string())
                .or_insert_with(|| {
                    "DB$ Pump | Defined$ TriggeredBlocker | NumAtt$ -1 | NumDef$ -1".to_string()
                });
        }

        if kw == "Extort" {
            let raw = "Mode$ SpellCast | ValidActivatingPlayer$ You | Execute$ TrigExtort | TriggerZones$ Battlefield | TriggerDescription$ Extort";
            if let Some(mut trig) = parse_trigger(raw, next_id) {
                trig.execute = "TrigExtort".to_string();
                trig.optional = true;
                self.add_trigger(trig);
            }
            self.svars.entry("TrigExtort".to_string()).or_insert_with(|| {
                "DB$ LoseLife | Defined$ Player.Opponent | LifeAmount$ 1 | SubAbility$ ExtortGain"
                    .to_string()
            });
            self.svars
                .entry("ExtortGain".to_string())
                .or_insert_with(|| "DB$ GainLife | Defined$ You | LifeAmount$ 1".to_string());
        }
    }

    fn generate_keyword_trigger_zone(&mut self, kw: &str, next_id: &mut u32) {
        self.generate_keyword_trigger_zone_graveyard(kw, next_id);
        self.generate_keyword_trigger_zone_battlefield(kw, next_id);
    }

    fn generate_keyword_trigger_zone_graveyard(&mut self, kw: &str, next_id: &mut u32) {
        if kw == "Undying" {
            let raw = "Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self+counters_EQ0_P1P1 | TriggerZones$ Battlefield | Execute$ TrigUndying | TriggerDescription$ Undying";
            if let Some(mut trig) = parse_trigger(raw, next_id) {
                trig.execute = "TrigUndying".to_string();
                self.add_trigger(trig);
            }
            self.svars.entry("TrigUndying".to_string()).or_insert_with(|| {
                "DB$ ChangeZone | Defined$ TriggeredNewCardLKICopy | Origin$ Graveyard | Destination$ Battlefield | WithCountersType$ P1P1".to_string()
            });
        }

        if kw == "Persist" {
            let raw = "Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self+counters_EQ0_M1M1 | TriggerZones$ Battlefield | Execute$ TrigPersist | TriggerDescription$ Persist";
            if let Some(mut trig) = parse_trigger(raw, next_id) {
                trig.execute = "TrigPersist".to_string();
                self.add_trigger(trig);
            }
            self.svars.entry("TrigPersist".to_string()).or_insert_with(|| {
                "DB$ ChangeZone | Defined$ TriggeredNewCardLKICopy | Origin$ Graveyard | Destination$ Battlefield | WithCountersType$ M1M1".to_string()
            });
        }

        if let Some(n_str) = crate::keyword::extract_keyword_cost_str(kw, "Afterlife") {
            if n_str.parse::<i32>().is_ok() {
                let raw = format!(
                    "Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self | TriggerZones$ Battlefield | Execute$ TrigAfterlife | TriggerDescription$ Afterlife {n_str}"
                );
                if let Some(mut trig) = parse_trigger(&raw, next_id) {
                    trig.execute = "TrigAfterlife".to_string();
                    self.add_trigger(trig);
                }
                self.svars
                    .entry("TrigAfterlife".to_string())
                    .or_insert_with(|| {
                        format!(
                            "DB$ Token | TokenAmount$ {n_str} | TokenScript$ wb_1_1_spirit_flying"
                        )
                    });
            }
        }

        if let Some(n_str) = crate::keyword::extract_keyword_cost_str(kw, "Modular") {
            if let Ok(n) = n_str.parse::<i32>() {
                self.etb_counters_p1p1 += n;

                let raw = format!(
                    "Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self | TriggerZones$ Battlefield | Execute$ TrigModular | TriggerDescription$ Modular {n_str}"
                );
                if let Some(mut trig) = parse_trigger(&raw, next_id) {
                    trig.execute = "TrigModular".to_string();
                    trig.optional = true;
                    self.add_trigger(trig);
                }
                self.svars
                    .entry("TrigModular".to_string())
                    .or_insert_with(|| "SP$ Charm | Choices$ ModularMove".to_string());
                self.svars
                    .entry("ModularMove".to_string())
                    .or_insert_with(|| {
                        format!("DB$ PutCounter | Defined$ Targeted | CounterType$ P1P1 | CounterNum$ {n_str} | Modular$ true | ValidTgts$ Creature.Artifact | SpellDescription$ Put +1/+1 counter(s) on target artifact creature")
                    });
            }
        }
    }

    fn generate_keyword_trigger_zone_battlefield(&mut self, kw: &str, next_id: &mut u32) {
        if kw == "Exploit" {
            let raw = "Mode$ ChangesZone | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigExploit | TriggerDescription$ Exploit";
            if let Some(mut trig) = parse_trigger(raw, next_id) {
                trig.execute = "TrigExploit".to_string();
                self.add_trigger(trig);
            }
            self.svars
                .entry("TrigExploit".to_string())
                .or_insert_with(|| {
                    "DB$ Sacrifice | SacValid$ Creature | Optional$ True | Exploit$ True"
                        .to_string()
                });
        }

        if let Some(n_str) = crate::keyword::extract_keyword_cost_str(kw, "Fabricate") {
            if n_str.parse::<i32>().is_ok() {
                let raw = format!(
                    "Mode$ ChangesZone | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigFabricate | Secondary$ True | TriggerDescription$ Fabricate {n_str}"
                );
                if let Some(mut trig) = parse_trigger(&raw, next_id) {
                    trig.execute = "TrigFabricate".to_string();
                    self.add_trigger(trig);
                }
                self.svars
                    .entry("TrigFabricate".to_string())
                    .or_insert_with(|| {
                        format!(
                            "DB$ Token | TokenAmount$ {n_str} | TokenScript$ c_1_1_a_servo \
                             | UnlessCost$ AddCounter<{n_str}/P1P1> | UnlessPayer$ You \
                             | SpellDescription$ Fabricate {n_str}"
                        )
                    });
            }
        }

        if kw == "Living Weapon" {
            let raw = "Mode$ ChangesZone | Destination$ Battlefield | ValidCard$ Card.Self | Secondary$ True | TriggerDescription$ Living Weapon";
            if let Some(mut trig) = parse_trigger(raw, next_id) {
                trig.execute = "TrigLivingWeapon".to_string();
                self.add_trigger(trig);
            }
            self.svars
                .entry("TrigLivingWeapon".to_string())
                .or_insert_with(|| {
                    "DB$ Token | TokenScript$ b_0_0_phyrexian_germ | TokenOwner$ You | RememberTokens$ True | SubAbility$ DBLivingWeaponAttach".to_string()
                });
            self.svars
                .entry("DBLivingWeaponAttach".to_string())
                .or_insert_with(|| {
                    "DB$ Attach | Defined$ Remembered | SubAbility$ DBLivingWeaponCleanup"
                        .to_string()
                });
            self.svars
                .entry("DBLivingWeaponCleanup".to_string())
                .or_insert_with(|| "DB$ Cleanup | ClearRemembered$ True".to_string());
        }

        if let Some(n_str) = crate::keyword::extract_keyword_cost_str(kw, "Bloodthirst") {
            if n_str.parse::<i32>().is_ok() {
                let raw = format!(
                    "Mode$ ChangesZone | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigBloodthirst | TriggerDescription$ Bloodthirst {n_str}"
                );
                if let Some(mut trig) = parse_trigger(&raw, next_id) {
                    trig.execute = "TrigBloodthirst".to_string();
                    self.add_trigger(trig);
                }
                self.svars
                    .entry("TrigBloodthirst".to_string())
                    .or_insert_with(|| {
                        format!("DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ {n_str} | Bloodthirst$ True")
                    });
            }
        }

        if kw == "Riot" {
            let raw = "Mode$ ChangesZone | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigRiot | TriggerDescription$ Riot";
            if let Some(mut trig) = parse_trigger(raw, next_id) {
                trig.execute = "TrigRiot".to_string();
                self.add_trigger(trig);
            }
            self.svars
                .entry("TrigRiot".to_string())
                .or_insert_with(|| "SP$ Charm | Choices$ RiotCounter,RiotHaste".to_string());
            self.svars
                .entry("RiotCounter".to_string())
                .or_insert_with(|| {
                    "DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ 1 | SpellDescription$ Put a +1/+1 counter on this creature".to_string()
                });
            self.svars
                .entry("RiotHaste".to_string())
                .or_insert_with(|| {
                    "DB$ Pump | Defined$ Self | KW$ Haste | SpellDescription$ This creature gains haste".to_string()
                });
        }

        if kw == "Unleash" {
            let raw = "Mode$ ChangesZone | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigUnleash | TriggerDescription$ Unleash";
            if let Some(mut trig) = parse_trigger(raw, next_id) {
                trig.execute = "TrigUnleash".to_string();
                self.add_trigger(trig);
            }
            self.svars
                .entry("TrigUnleash".to_string())
                .or_insert_with(|| {
                    "DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ 1".to_string()
                });
        }
    }

    fn generate_keyword_trigger_misc(&mut self, kw: &str, next_id: &mut u32) {
        if let Some(cost_str) = crate::keyword::extract_keyword_cost_str(kw, "Ward") {
            let raw = "Mode$ BecomesTarget | ValidSource$ SpellAbility.OppCtrl | ValidTarget$ Card.Self | Secondary$ True | TriggerZones$ Battlefield | TriggerDescription$ Ward";
            if let Some(mut trig) = parse_trigger(raw, next_id) {
                trig.execute = "TrigWard".to_string();
                self.add_trigger(trig);
            }
            self.svars.entry("TrigWard".to_string()).or_insert_with(|| {
                format!("DB$ Counter | Defined$ TriggeredSourceSA | UnlessCost$ {cost_str}")
            });
        }

        if let Some(rest) = kw.strip_prefix("Cumulative upkeep:") {
            let cost_spec = rest.split(':').next().unwrap_or(rest);
            let raw = "Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | TriggerZones$ Battlefield | TriggerDescription$ Cumulative upkeep";
            if let Some(mut trig) = parse_trigger(raw, next_id) {
                trig.execute = "TrigCumulativeUpkeep".to_string();
                self.add_trigger(trig);
            }
            self.svars
                .entry("TrigCumulativeUpkeep".to_string())
                .or_insert_with(|| {
                    format!("DB$ Sacrifice | SacValid$ Self | CumulativeUpkeep$ {cost_spec}")
                });
        }

        if let Some(cost_str) = crate::keyword::extract_keyword_cost_str(kw, "Echo") {
            let cost_spec = cost_str.split(':').next().unwrap_or(cost_str);
            let raw = "Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | TriggerZones$ Battlefield | IsPresent$ Card.Self+cameUnderControlSinceLastUpkeep | Secondary$ True | TriggerDescription$ Echo";
            if let Some(mut trig) = parse_trigger(raw, next_id) {
                trig.execute = "TrigEcho".to_string();
                self.add_trigger(trig);
            }
            self.svars
                .entry("TrigEcho".to_string())
                .or_insert_with(|| format!("DB$ Sacrifice | SacValid$ Self | Echo$ {cost_spec}"));
        }

        if let Some(madness_cost) = crate::keyword::extract_keyword_cost_str(kw, "Madness") {
            let raw = "Mode$ ChangesZone | Origin$ Hand | Destination$ Exile | ValidCard$ Card.Self | Secondary$ True | TriggerZones$ Exile | TriggerDescription$ You may cast this card for its madness cost.";
            if let Some(mut trig) = parse_trigger(raw, next_id) {
                trig.execute = "TrigMadnessPlay".to_string();
                self.add_trigger(trig);
            }
            self.svars
                .entry("TrigMadnessPlay".to_string())
                .or_insert_with(|| {
                    format!(
                        "DB$ Play | Defined$ Self | ValidSA$ Spell | PlayCost$ {} | Optional$ True | RememberPlayed$ True | SubAbility$ MadnessMoveToYard",
                        madness_cost
                    )
                });
            self.svars
                .entry("MadnessMoveToYard".to_string())
                .or_insert_with(|| {
                    "DB$ ChangeZone | Defined$ Self | Origin$ Exile | Destination$ Graveyard | TrackDiscarded$ True | ConditionDefined$ Remembered | ConditionPresent$ Card | ConditionCompare$ EQ0 | SubAbility$ MadnessCleanup".to_string()
                });
            self.svars
                .entry("MadnessCleanup".to_string())
                .or_insert_with(|| "DB$ Cleanup | ClearRemembered$ True".to_string());
        }

        if let Some(partner_name) = kw.strip_prefix("Partner with:") {
            let mut partner_name = partner_name.trim().to_string();
            let raw = format!(
                "Mode$ ChangesZone | Destination$ Battlefield | ValidCard$ Card.Self | Secondary$ True | TriggerDescription$ Partner with {}",
                partner_name
            );
            if let Some(mut trig) = parse_trigger(&raw, next_id) {
                trig.execute = "TrigPartnerWith".to_string();
                self.add_trigger(trig);
            }
            partner_name = partner_name.replace(',', ";");
            self.svars
                .entry("TrigPartnerWith".to_string())
                .or_insert_with(|| {
                    format!(
                        "DB$ ChangeZone | ValidTgts$ Player | Origin$ Library | Destination$ Hand | ChangeType$ Card.named{} | Hidden$ True | Chooser$ Targeted | Optional$ True",
                        partner_name
                    )
                });
        }
    }
}
