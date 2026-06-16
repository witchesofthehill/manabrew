//! Java-parity helpers for `CardState` behavior.
//!
//! Rust now exposes a concrete `CardState` contract for Java parity while
//! still keeping adapter helpers for the existing `Card`-centric engine.

use std::collections::{HashMap, HashSet};

use forge_foundation::{CardStateName, CardTypeLine, ColorSet, ManaCost};

use crate::ability::activated::parse_activated_ability;
use crate::card::trait_card_trait_changes::CardTraitChanges as ICardTraitChanges;
use crate::card::{card_copy_service, card_property, Card};
use crate::core::HasSVars;
use crate::game_object::GameObject;
use crate::ids::PlayerId;
use crate::keyword::keyword_collection::KeywordCollection;
use crate::keyword::keyword_interface::KeywordInterface;
use crate::keyword::trait_keywords_change::KeywordsChange as IKeywordsChange;
use crate::replacement::ReplacementEffect;
use crate::spellability::SpellAbility;
use crate::staticability::StaticAbility;
use crate::trigger::Trigger;
use crate::util::{HasName, ITranslatable};

use crate::card_trait_base::CardTraitBase;

pub type CardType = CardTypeLine;
pub type CardTypeView = CardTypeLine;
pub type FCollection<T> = Vec<T>;
pub type FCollectionView<T> = Vec<T>;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum CardRarity {
    #[default]
    Unknown,
}

pub struct CardEdition;
impl CardEdition {
    pub const UNKNOWN_CODE: &'static str = "UNKNOWN";
}

#[derive(Debug, Clone, Default)]
pub struct LandTraitChanges;

impl LandTraitChanges {
    pub fn new() -> Self {
        Self
    }
}

impl ICardTraitChanges for LandTraitChanges {
    fn change_text(&mut self) {}
    fn copy(&self, _host: crate::ids::CardId, _lki: bool) -> Box<dyn ICardTraitChanges> {
        Box::new(self.clone())
    }
}

impl IKeywordsChange for LandTraitChanges {
    fn apply_keywords(&self, _list: &mut KeywordCollection) {}
    fn copy(&self) -> Box<dyn IKeywordsChange> {
        Box::new(self.clone())
    }
}

/// Port of Java `CardState`.
#[derive(Debug, Clone)]
pub struct CardState {
    pub state_name: CardStateName,
    pub name: String,
    pub r#type: CardType,
    pub changed_type: Option<CardTypeView>,
    pub mana_cost: ManaCost,
    pub perpetual_adjusted_mana_cost: Option<ManaCost>,
    pub color: ColorSet,
    pub oracle_text: String,
    pub functional_variant_name: Option<String>,
    pub flavor_name: Option<String>,
    pub base_power: i32,
    pub base_toughness: i32,
    pub base_power_string: Option<String>,
    pub base_toughness_string: Option<String>,
    pub base_loyalty: String,
    pub base_defense: String,
    pub intrinsic_keywords: KeywordCollection,
    pub attraction_lights: Option<HashSet<i32>>,
    pub abilities: FCollection<SpellAbility>,
    pub triggers: FCollection<Trigger>,
    pub replacement_effects: FCollection<ReplacementEffect>,
    pub static_abilities: FCollection<StaticAbility>,
    pub image_key: String,
    pub s_vars: HashMap<String, String>,
    pub ability_for_trigger: HashMap<String, SpellAbility>,
    pub cached_keywords: KeywordCollection,
    pub rarity: CardRarity,
    pub set_code: String,
    pub card: Card,
    pub land_ability: Option<SpellAbility>,
    pub aura_ability: Option<SpellAbility>,
    pub permanent_ability: Option<SpellAbility>,
    pub loyalty_rep: Option<ReplacementEffect>,
    pub defense_rep: Option<ReplacementEffect>,
    pub saga_rep: Option<ReplacementEffect>,
    pub adventure_rep: Option<ReplacementEffect>,
    pub omen_rep: Option<ReplacementEffect>,
    pub manifest_up: Option<SpellAbility>,
    pub cloak_up: Option<SpellAbility>,
    pub land_trait_changes: LandTraitChanges,
}

impl CardState {
    pub fn new(card: Card, name: CardStateName) -> Self {
        Self {
            state_name: name,
            name: String::new(),
            r#type: CardTypeLine::default(),
            changed_type: None,
            mana_cost: ManaCost::no_cost(),
            perpetual_adjusted_mana_cost: None,
            color: ColorSet::COLORLESS,
            oracle_text: String::new(),
            functional_variant_name: None,
            flavor_name: None,
            base_power: 0,
            base_toughness: 0,
            base_power_string: None,
            base_toughness_string: None,
            base_loyalty: String::new(),
            base_defense: String::new(),
            intrinsic_keywords: KeywordCollection::new(),
            attraction_lights: None,
            abilities: Vec::new(),
            triggers: Vec::new(),
            replacement_effects: Vec::new(),
            static_abilities: Vec::new(),
            image_key: String::new(),
            s_vars: HashMap::new(),
            ability_for_trigger: HashMap::new(),
            cached_keywords: KeywordCollection::new(),
            rarity: CardRarity::Unknown,
            set_code: CardEdition::UNKNOWN_CODE.to_string(),
            card,
            land_ability: None,
            aura_ability: None,
            permanent_ability: None,
            loyalty_rep: None,
            defense_rep: None,
            saga_rep: None,
            adventure_rep: None,
            omen_rep: None,
            manifest_up: None,
            cloak_up: None,
            land_trait_changes: LandTraitChanges::new(),
        }
    }

    pub fn get_card(&self) -> &Card {
        &self.card
    }
    pub fn get_name(&self) -> &str {
        &self.name
    }
    pub fn set_name(&mut self, name: String) {
        self.name = name;
    }
    pub fn get_state_name(&self) -> CardStateName {
        self.state_name
    }
    pub fn get_type_with_changes(&self) -> &CardTypeView {
        self.changed_type.as_ref().unwrap_or(&self.r#type)
    }
    pub fn update_types(&mut self) {
        self.changed_type = Some(self.r#type.clone());
    }
    pub fn update_types_for_view(&self) {}
    pub fn get_type(&self) -> &CardTypeView {
        &self.r#type
    }
    pub fn add_type(&mut self, type_value: String) {
        self.r#type.add_type(&type_value);
    }
    pub fn add_types<I: IntoIterator<Item = String>>(&mut self, type_values: I) {
        for t in type_values {
            self.r#type.add_type(&t);
        }
    }
    pub fn set_type(&mut self, type_value: CardType) {
        self.r#type = type_value;
    }
    pub fn remove_card_types_with_sanitize(&mut self, _sanitize: bool) {
        self.r#type.core_types.clear();
        self.r#type.subtypes.clear();
    }
    pub fn get_mana_cost(&self) -> &ManaCost {
        &self.mana_cost
    }
    pub fn set_mana_cost(&mut self, mana_cost: ManaCost) {
        self.mana_cost = mana_cost;
    }
    pub fn calculate_perpetual_adjusted_mana_cost_for_state(&mut self) {}
    pub fn get_perpetual_adjusted_mana_cost(&self) -> &ManaCost {
        self.perpetual_adjusted_mana_cost
            .as_ref()
            .unwrap_or(&self.mana_cost)
    }
    pub fn get_color(&self) -> ColorSet {
        self.color
    }
    pub fn add_color(&mut self, color: ColorSet) {
        self.color = self.color.union(color);
    }
    pub fn set_color(&mut self, color: ColorSet) {
        self.color = color;
    }
    pub fn get_oracle_text(&self) -> &str {
        &self.oracle_text
    }
    pub fn set_oracle_text(&mut self, oracle_text: String) {
        self.oracle_text = oracle_text;
    }
    pub fn get_functional_variant_name(&self) -> Option<&str> {
        self.functional_variant_name.as_deref()
    }
    pub fn set_functional_variant_name(&mut self, functional_variant_name: Option<String>) {
        self.functional_variant_name = functional_variant_name.filter(|s| !s.is_empty());
    }
    pub fn get_flavor_name(&self) -> Option<&str> {
        self.flavor_name.as_deref()
    }
    pub fn set_flavor_name(&mut self, flavor_name: Option<String>) {
        self.flavor_name = flavor_name;
    }
    pub fn get_base_power(&self) -> i32 {
        self.base_power
    }
    pub fn set_base_power(&mut self, base_power: i32) {
        self.base_power = base_power;
    }
    pub fn get_base_toughness(&self) -> i32 {
        self.base_toughness
    }
    pub fn set_base_toughness(&mut self, base_toughness: i32) {
        self.base_toughness = base_toughness;
    }
    pub fn get_base_power_string(&self) -> Option<&str> {
        self.base_power_string.as_deref()
    }
    pub fn get_base_toughness_string(&self) -> Option<&str> {
        self.base_toughness_string.as_deref()
    }
    pub fn set_base_power_string(&mut self, value: Option<String>) {
        self.base_power_string = value;
    }
    pub fn set_base_toughness_string(&mut self, value: Option<String>) {
        self.base_toughness_string = value;
    }
    pub fn get_base_loyalty(&self) -> &str {
        &self.base_loyalty
    }
    pub fn set_base_loyalty(&mut self, value: String) {
        self.base_loyalty = value;
    }
    pub fn get_base_defense(&self) -> &str {
        &self.base_defense
    }
    pub fn set_base_defense(&mut self, value: String) {
        self.base_defense = value;
    }
    pub fn get_attraction_lights(&self) -> Option<&HashSet<i32>> {
        self.attraction_lights.as_ref()
    }
    pub fn set_attraction_lights(&mut self, attraction_lights: Option<HashSet<i32>>) {
        self.attraction_lights = attraction_lights;
    }
    pub fn get_cached_keywords(
        &self,
    ) -> Vec<&crate::keyword::keyword_instance::KeywordInstanceData> {
        self.cached_keywords.get_values()
    }
    pub fn set_cached_keywords(&mut self, collection: KeywordCollection) {
        self.cached_keywords = collection;
    }
    pub fn has_keyword_enum(&self, key: crate::keyword::keyword_instance::Keyword) -> bool {
        self.cached_keywords.contains_keyword(key)
    }
    pub fn get_intrinsic_keywords(
        &self,
    ) -> Vec<&crate::keyword::keyword_instance::KeywordInstanceData> {
        self.intrinsic_keywords.get_values()
    }
    pub fn has_intrinsic_keyword_state(&self, keyword: &str) -> bool {
        self.intrinsic_keywords.contains(keyword)
    }
    pub fn set_intrinsic_keywords(
        &mut self,
        _intrinsic_keywords: Vec<KeywordInterface>,
        _lki: bool,
    ) {
    }
    pub fn update_keywords_cache_for_state(&mut self) {
        self.cached_keywords = self.intrinsic_keywords.clone();
    }
    pub fn add_intrinsic_keyword_with_init_traits(
        &mut self,
        keyword: String,
        _init_traits: bool,
    ) -> Option<KeywordInterface> {
        if self.intrinsic_keywords.add(&keyword) {
            Some(KeywordInterface::new(
                crate::keyword::Keyword::smart_value_of(&keyword),
                keyword,
            ))
        } else {
            None
        }
    }
    pub fn add_intrinsic_keywords_for_state(
        &mut self,
        keywords: Vec<String>,
        init_traits: bool,
    ) -> bool {
        let mut changed = false;
        for k in keywords {
            changed |= self
                .add_intrinsic_keyword_with_init_traits(k, init_traits)
                .is_some();
        }
        changed
    }
    pub fn remove_intrinsic_keyword_for_state(&mut self, keyword: &str) -> bool {
        self.intrinsic_keywords.remove(keyword)
    }
    pub fn get_spell_abilities(&self) -> FCollectionView<SpellAbility> {
        crate::perf::increment(crate::perf::Metric::CardStateCollectionClones, 1);
        self.abilities.clone()
    }
    pub fn get_mana_abilities(&self) -> FCollectionView<SpellAbility> {
        crate::perf::increment(crate::perf::Metric::CardStateCollectionClones, 1);
        self.abilities
            .clone()
            .into_iter()
            .filter(|sa| sa.is_mana_ability)
            .collect()
    }
    pub fn get_non_mana_abilities(&self) -> FCollectionView<SpellAbility> {
        crate::perf::increment(crate::perf::Metric::CardStateCollectionClones, 1);
        self.abilities
            .clone()
            .into_iter()
            .filter(|sa| !sa.is_mana_ability)
            .collect()
    }
    pub fn update_spell_abilities(&self, _new_col: &mut FCollection<SpellAbility>) {}
    pub fn get_land_trait_changes(&self) -> &LandTraitChanges {
        &self.land_trait_changes
    }
    pub fn get_intrinsic_spell_abilities(&self) -> Vec<SpellAbility> {
        crate::perf::increment(crate::perf::Metric::CardStateCollectionClones, 1);
        self.abilities
            .clone()
            .into_iter()
            .filter(|sa| sa.is_activated || sa.is_trigger || sa.is_spell)
            .collect()
    }
    pub fn get_first_ability(&self) -> Option<SpellAbility> {
        self.get_intrinsic_spell_abilities().into_iter().next()
    }
    pub fn get_first_spell_ability(&self) -> Option<SpellAbility> {
        self.get_non_mana_abilities().into_iter().next()
    }
    pub fn get_first_spell_ability_with_fallback(&self) -> Option<SpellAbility> {
        self.get_first_spell_ability()
            .or_else(|| self.get_first_ability())
    }
    pub fn get_aura_spell(&self) -> Option<SpellAbility> {
        self.aura_ability.clone()
    }
    pub fn has_spell_ability_id(&self, id: i32) -> bool {
        self.get_spell_abilities()
            .iter()
            .any(|sa| sa.source_trigger_id == Some(id as u32))
    }
    pub fn add_spell_ability_state(&mut self, ability: SpellAbility) -> bool {
        self.abilities.push(ability);
        true
    }
    pub fn get_triggers(&self) -> FCollectionView<Trigger> {
        crate::perf::increment(crate::perf::Metric::CardStateCollectionClones, 1);
        self.triggers.clone()
    }
    pub fn has_trigger_id(&self, id: i32) -> bool {
        self.get_triggers().iter().any(|t| t.id == id as u32)
    }
    pub fn add_trigger_state(&mut self, trigger: Trigger) -> bool {
        self.triggers.push(trigger);
        true
    }
    pub fn get_static_abilities(&self) -> FCollectionView<StaticAbility> {
        crate::perf::increment(crate::perf::Metric::CardStateCollectionClones, 1);
        self.static_abilities.clone()
    }
    pub fn add_static_ability_state(&mut self, static_ability: StaticAbility) -> bool {
        self.static_abilities.push(static_ability);
        true
    }
    pub fn remove_static_ability_state(&mut self, _static_ability: StaticAbility) -> bool {
        false
    }
    pub fn get_replacement_effects(&self) -> FCollectionView<ReplacementEffect> {
        crate::perf::increment(crate::perf::Metric::CardStateCollectionClones, 1);
        self.replacement_effects.clone()
    }
    pub fn add_replacement_effect_state(&mut self, replacement_effect: ReplacementEffect) -> bool {
        self.replacement_effects.push(replacement_effect);
        true
    }
    pub fn has_replacement_effect_id(&self, id: i32) -> bool {
        self.get_replacement_effect(id).is_some()
    }
    pub fn get_replacement_effect(&self, id: i32) -> Option<ReplacementEffect> {
        let _ = id;
        None
    }
    pub fn get_foil(&self) -> i32 {
        self.get_svar("Foil")
            .and_then(|s| s.parse().ok())
            .unwrap_or(0)
    }
    pub fn copy_from_state(&mut self, _source: &CardState, _lki: bool) {}
    pub fn copy_from_with_trait_base(
        &mut self,
        _source: &CardState,
        _lki: bool,
        _ctb: &CardTraitBase,
    ) {
    }
    pub fn add_abilities_from_state(&mut self, _source: &CardState, _lki: bool) {}
    pub fn copy(&self, host: Card, name: CardStateName, _lki: bool) -> CardState {
        CardState::new(host, name)
    }
    pub fn get_rarity(&self) -> CardRarity {
        self.rarity
    }
    pub fn set_rarity(&mut self, rarity: CardRarity) {
        self.rarity = rarity;
    }
    pub fn get_set_code(&self) -> &str {
        &self.set_code
    }
    pub fn set_set_code(&mut self, set_code: String) {
        self.set_code = set_code;
    }
    pub fn get_image_key(&self) -> &str {
        &self.image_key
    }
    pub fn set_image_key(&mut self, image_key: String) {
        self.image_key = image_key;
    }
    pub fn get_traits(&self) -> Vec<CardTraitBase> {
        Vec::new()
    }
    pub fn reset_original_host(&mut self, _old_host: Card) {}
    pub fn update_changed_text(&mut self) {}
    pub fn change_text_intrinsic(
        &mut self,
        _color_map: HashMap<String, String>,
        _type_map: HashMap<String, String>,
    ) {
    }
    pub fn has_chapter(&self) -> bool {
        self.get_triggers().iter().any(|t| t.ir.chapter.is_some())
    }
    pub fn get_final_chapter_nr(&self) -> i32 {
        0
    }
    pub fn get_manifest_up(&self) -> Option<SpellAbility> {
        self.manifest_up.clone()
    }
    pub fn get_cloak_up(&self) -> Option<SpellAbility> {
        self.cloak_up.clone()
    }
    pub fn get_ability_for_trigger(&self, svar: String) -> Option<SpellAbility> {
        self.ability_for_trigger.get(&svar).cloned()
    }
}

impl HasSVars for CardState {
    fn get_svar(&self, name: &str) -> Option<&str> {
        self.s_vars.get(name).map(String::as_str)
    }

    fn set_svar(&mut self, name: String, value: String) {
        self.s_vars.insert(name, value);
    }

    fn set_svars(&mut self, new_svars: HashMap<String, String>) {
        self.s_vars = new_svars;
    }

    fn get_svars(&self) -> &HashMap<String, String> {
        &self.s_vars
    }

    fn remove_svar(&mut self, var: &str) {
        self.s_vars.remove(var);
    }
}

impl GameObject for CardState {
    fn is_valid_single(
        &self,
        restriction: &str,
        _source_controller: PlayerId,
        _source: &Card,
        _spell_ability: &CardTraitBase,
    ) -> bool {
        self.has_property(restriction, _source_controller, _source, _spell_ability)
    }

    fn has_property(
        &self,
        property: &str,
        source_controller: PlayerId,
        _source: &Card,
        _spell_ability: &CardTraitBase,
    ) -> bool {
        match property {
            "Card" | "card" => true,
            "Permanent" => self.r#type.is_permanent(),
            "Creature" => self.r#type.is_creature(),
            "Land" => self.r#type.is_land(),
            "Artifact" => self.r#type.is_artifact(),
            "Enchantment" => self.r#type.is_enchantment(),
            "Planeswalker" => self.r#type.is_planeswalker(),
            "Instant" => self.r#type.is_instant(),
            "Sorcery" => self.r#type.is_sorcery(),
            "Basic" => self.r#type.is_basic(),
            "Legendary" => self.r#type.is_legendary(),
            "YouCtrl" => self.card.controller == source_controller,
            "OppCtrl" => self.card.controller != source_controller,
            _ => false,
        }
    }
}

impl HasName for CardState {
    fn get_name(&self) -> &str {
        &self.name
    }
}

impl ITranslatable for CardState {
    fn get_translation_key(&self) -> String {
        self.flavor_name
            .clone()
            .unwrap_or_else(|| self.name.clone())
    }

    fn get_untranslated_type(&self) -> String {
        self.r#type.to_string()
    }

    fn get_translated_name(&self) -> String {
        self.get_translation_key()
    }
}

pub fn update_types(card: &mut Card) {
    card.type_line = CardTypeLine::parse(&card.type_line.to_string());
}

pub fn update_types_for_view(card: &mut Card) {
    let _ = card.type_line.to_string();
}

pub fn add_type(card: &mut Card, ty: &str) {
    card.type_line.add_type(ty);
}

pub fn remove_type(card: &mut Card, ty: &str) {
    card.type_line
        .supertypes
        .retain(|st| !st.name().eq_ignore_ascii_case(ty));
    card.type_line
        .core_types
        .retain(|ct| !ct.name().eq_ignore_ascii_case(ty));
    card.type_line
        .subtypes
        .retain(|s| !s.eq_ignore_ascii_case(ty));
}

pub fn remove_card_types(card: &mut Card) {
    card.type_line.core_types.clear();
    card.type_line.subtypes.clear();
}

pub fn calculate_perpetual_adjusted_mana_cost(card: &mut Card) {
    card.update_mana_cost_for_view();
}

pub fn add_color(card: &mut Card, color: ColorSet) {
    card.color = card.color.union(color);
}

pub fn has_keyword(card: &Card, keyword: &str) -> bool {
    if card
        .cant_have_keywords
        .contains(&keyword.to_ascii_lowercase())
    {
        return false;
    }
    card.keywords.contains_string_ignore_case(keyword)
        || card.granted_keywords.contains_string_ignore_case(keyword)
        || card.pump_keywords.contains_string_ignore_case(keyword)
}

pub fn has_intrinsic_keyword(card: &Card, keyword: &str) -> bool {
    card.keywords.contains_string_ignore_case(keyword)
}

pub fn update_keywords_cache(card: &mut Card) {
    // Only collapse duplicates of "redundant" keywords (Flying, Trample, ...).
    // Stackable keywords like Cascade or Annihilator must keep every instance
    // because they trigger once per copy on the source.
    let mut seen = HashSet::new();
    let keywords = card.keywords.as_string_list();
    card.keywords.clear();
    for kw in keywords {
        let parsed = crate::keyword::keyword_collection::parse_keyword_string(&kw).0;
        let stackable = !parsed.is_multiple_redundant();
        let key = kw.to_ascii_lowercase();
        if stackable || seen.insert(key) {
            card.keywords.add(&kw);
        }
    }
}

pub fn add_intrinsic_keyword(card: &mut Card, keyword: &str) -> bool {
    if keyword.trim().is_empty() {
        return false;
    }
    card.keywords.add(keyword)
}

pub fn add_intrinsic_keywords<'a>(
    card: &mut Card,
    keywords: impl IntoIterator<Item = &'a str>,
) -> bool {
    let mut changed = false;
    for kw in keywords {
        changed |= add_intrinsic_keyword(card, kw);
    }
    changed
}

pub fn remove_intrinsic_keyword(card: &mut Card, keyword: &str) -> bool {
    card.keywords.remove(keyword)
}

pub fn apply_spell_ability(
    layer: &crate::card::card_trait_changes::CardTraitChanges,
    list: Vec<SpellAbility>,
) -> Vec<SpellAbility> {
    layer.apply_spell_ability(list)
}

pub fn apply_trigger(
    layer: &crate::card::card_trait_changes::CardTraitChanges,
    list: Vec<Trigger>,
) -> Vec<Trigger> {
    layer.apply_trigger(list)
}

pub fn apply_replacement_effect(
    layer: &crate::card::card_trait_changes::CardTraitChanges,
    list: Vec<ReplacementEffect>,
) -> Vec<ReplacementEffect> {
    layer.apply_replacement_effect(list)
}

pub fn apply_static_ability(
    layer: &crate::card::card_trait_changes::CardTraitChanges,
    list: Vec<StaticAbility>,
) -> Vec<StaticAbility> {
    layer.apply_static_ability(list)
}

pub fn apply_keywords(
    layer: &crate::card::card_trait_changes::CardTraitChanges,
    mut list: crate::keyword::keyword_collection::KeywordCollection,
) -> crate::keyword::keyword_collection::KeywordCollection {
    if layer.remove_all {
        list.clear();
    }
    list
}

pub fn copy(from: &Card, to: &mut Card) {
    copy_from(from, to);
}

pub fn has_spell_ability(card: &Card, sa: &SpellAbility) -> bool {
    card.activated_abilities
        .iter()
        .any(|ab| ab.ability_text == sa.ability_text)
}

pub fn add_spell_ability(card: &mut Card, sa: &SpellAbility) -> bool {
    card.abilities.push(sa.ability_text.clone());
    if let Some(parsed) = parse_activated_ability(&sa.ability_text, card.activated_abilities.len())
    {
        card.activated_abilities.push(parsed);
        return true;
    }
    false
}

pub fn has_trigger(card: &Card, trigger_id: u32) -> bool {
    card.triggers.iter().any(|t| t.id == trigger_id)
}

pub fn add_trigger(card: &mut Card, mut trig: Trigger) -> bool {
    trig.bind_host_card_id(card.id);
    card.triggers.push(trig);
    true
}

pub fn add_static_ability(card: &mut Card, st_ab: StaticAbility) -> bool {
    card.static_abilities.push(st_ab);
    true
}

pub fn remove_static_ability(card: &mut Card, mode: crate::staticability::StaticMode) -> bool {
    let before = card.static_abilities.len();
    card.static_abilities.retain(|sa| !sa.check_mode(&mode));
    before != card.static_abilities.len()
}

pub fn add_replacement_effect(card: &mut Card, mut re: ReplacementEffect) -> bool {
    re.set_host_card(card);
    card.replacement_effects.push(re);
    true
}

pub fn has_replacement_effect(card: &Card) -> bool {
    !card.replacement_effects.is_empty()
}

pub fn has_s_var(card: &Card, key: &str) -> bool {
    card.svars.contains_key(key) || card.granted_svars.contains_key(key)
}

pub fn remove_s_var(card: &mut Card, key: &str) {
    card.svars.remove(key);
}

pub fn copy_from(source: &Card, target: &mut Card) {
    target.changed_card_traits = source.changed_card_traits.clone();
    target.changed_card_traits_by_text = source.changed_card_traits_by_text.clone();

    target
        .svars
        .retain(|k, _| !k.starts_with("TextColor:") && !k.starts_with("TextType:"));
    target.copy_changed_text_from(source);

    target.update_type_cache();
}

pub fn add_abilities_from(source: &Card, target: &mut Card) {
    // Reuse copy-service for copiable characteristics.
    card_copy_service::copy_copiable_characteristics(source, target);

    target
        .activated_abilities
        .extend(source.activated_abilities.iter().cloned());
    target.triggers.extend(source.triggers.iter().cloned());
    target
        .replacement_effects
        .extend(source.replacement_effects.iter().cloned());
    target
        .static_abilities
        .extend(source.static_abilities.iter().cloned());
}

pub fn has_property(card: &Card, property: &str) -> bool {
    card_property::card_has_property(card, property, card.controller)
}

pub fn reset_original_host(card: &mut Card) {
    card.effect_source = None;
}

pub fn update_changed_text(card: &mut Card) {
    card.update_rules_view();
}

pub fn change_text_intrinsic(card: &mut Card) {
    card.update_changed_text();
}

pub fn has_chapter(card: &Card) -> bool {
    card.triggers
        .iter()
        .any(|t| t.ir.chapter.is_some() || t.description.to_ascii_lowercase().contains("chapter"))
}

pub fn set_type(card: &mut Card, type_line: &str) {
    card.type_line = CardTypeLine::parse(type_line);
}
