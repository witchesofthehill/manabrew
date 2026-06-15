use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::Arc;

use forge_engine_core::agent::{
    BinaryChoiceKind, GameEntity, ManaCostAction, PlayCardMode, PlayOption, PlayerAgent,
    PriorityActionSpace, TargetChoice,
};
use forge_engine_core::card::Card;
use forge_engine_core::combat::DefenderId;
use forge_engine_core::game::GameState;
use forge_engine_core::ids::{CardId, PlayerId};
use forge_engine_core::mana::ManaPool;
use forge_engine_core::player::actions::player_action::STATIC_ALTERNATIVE_ABILITY_INDEX;
use forge_engine_core::player::actions::{AbilityRef, PlayerAction};
use forge_engine_core::replacement::replacement_handler::{apply_replacements, ReplacementEvent};
use forge_engine_core::spellability::AlternativeCost;
use forge_engine_core::spellability::SpellAbility;
use forge_foundation::PhaseType;

use crate::choice_space;
use crate::combat_choice_space;
use crate::gui_repro;
use crate::java_random::JavaRandom;
use crate::parity_card_map::ParityCardMap;
use crate::parity_order;

#[allow(dead_code)]
const ANSI_RESET: &str = "\x1b[0m";
#[allow(dead_code)]
const ANSI_DIM_GRAY: &str = "\x1b[90m";
#[allow(dead_code)]
const ANSI_YELLOW: &str = "\x1b[33m";
const PREFER_ACTION_WEIGHT: usize = 3;
const STACK_ACTION_SPACE_SKIP_THRESHOLD: usize = 20;

#[derive(Clone, Debug)]
pub enum VerboseMode {
    Off,
    All,
    Turns(Vec<u32>),
}

impl VerboseMode {
    /// Parse from an optional CLI value.
    /// `None` / not present → `Off`, `Some(None)` (bare `--verbose`) → `All`,
    /// `Some(Some("21,22"))` → `Turns([21, 22])`.
    pub fn from_flag(present: bool, value: Option<&str>) -> Self {
        if !present {
            return VerboseMode::Off;
        }
        match value {
            None => VerboseMode::All,
            Some("") => VerboseMode::All,
            Some(s) => {
                let turns: Vec<u32> = s.split(',').filter_map(|t| t.trim().parse().ok()).collect();
                if turns.is_empty() {
                    VerboseMode::All
                } else {
                    VerboseMode::Turns(turns)
                }
            }
        }
    }

    pub fn is_active(&self, current_turn: u32) -> bool {
        match self {
            VerboseMode::Off => false,
            VerboseMode::All => true,
            VerboseMode::Turns(turns) => turns.contains(&current_turn),
        }
    }

    /// True only for bare `--verbose` (all turns). Turn-specific modes
    /// should not trigger general progress logging.
    pub fn is_any(&self) -> bool {
        matches!(self, VerboseMode::All)
    }

    pub fn to_java_arg(&self) -> Option<String> {
        match self {
            VerboseMode::Off => None,
            VerboseMode::All => Some(String::new()),
            VerboseMode::Turns(turns) => Some(
                turns
                    .iter()
                    .map(|t| t.to_string())
                    .collect::<Vec<_>>()
                    .join(","),
            ),
        }
    }
}

pub struct DeterministicAgent {
    player_id: PlayerId,
    pub log: Vec<String>,
    pub verbose: VerboseMode,
    current_turn: u32,
    last_game_snapshot: Option<GameSnapshot>,
    rng: Rc<RefCell<JavaRandom>>,
    game_rng: Rc<RefCell<JavaRandom>>,
    prefer_actions: bool,
    parity_map: Arc<ParityCardMap>,
    parity_observer: Option<Arc<crate::runner::ParityObserver>>,
}

struct GameSnapshot {
    cards: Vec<Card>,
    player_names: Vec<(PlayerId, String)>,
    card_names: Vec<(CardId, String)>,
    card_is_land: Vec<(CardId, bool)>,
    card_owner_controller: Vec<(CardId, (u32, u32))>,
    ability_is_mana: Vec<((CardId, usize), bool)>,
    ability_texts: Vec<((CardId, usize), String)>,
    phase: PhaseType,
    stack_depth: usize,
}

#[derive(Clone, Copy)]
enum ActionChoice {
    Card(PlayOption),
    Ability(CardId, usize),
}

#[allow(private_interfaces)]
impl DeterministicAgent {
    fn shallow_snapshot_card(card: &Card) -> Card {
        card.clone_for_parity_snapshot()
    }

    fn shallow_cards(game: &GameState) -> Vec<Card> {
        game.cards.iter().map(Self::shallow_snapshot_card).collect()
    }

    fn shallow_replacement_game(game: &GameState) -> GameState {
        let player_names: Vec<String> = game.players.iter().map(|p| p.name.clone()).collect();
        let player_name_refs: Vec<&str> = player_names.iter().map(String::as_str).collect();
        let starting_life = game.players.first().map(|p| p.life).unwrap_or(20);
        let mut sim = GameState::new(&player_name_refs, starting_life);
        sim.players = game.players.clone();
        sim.cards = Self::shallow_cards(game);
        sim.turn = game.turn.clone();
        sim
    }

    pub fn new(
        player_id: PlayerId,
        verbose: VerboseMode,
        rng: Rc<RefCell<JavaRandom>>,
        game_rng: Rc<RefCell<JavaRandom>>,
        prefer_actions: bool,
        parity_map: Arc<ParityCardMap>,
        parity_observer: Option<Arc<crate::runner::ParityObserver>>,
    ) -> Self {
        Self {
            player_id,
            log: Vec::new(),
            verbose,
            current_turn: 0,
            last_game_snapshot: None,
            rng,
            game_rng,
            prefer_actions,
            parity_map,
            parity_observer,
        }
    }

    pub(crate) fn should_skip_priority_action_space(&self) -> bool {
        self.last_game_snapshot
            .as_ref()
            .is_some_and(|snap| snap.stack_depth >= STACK_ACTION_SPACE_SKIP_THRESHOLD)
    }

    pub fn rng_call_count(&self) -> u64 {
        self.rng.borrow().call_count
    }

    pub fn rng(&self) -> Rc<RefCell<JavaRandom>> {
        Rc::clone(&self.rng)
    }

    /// Look up a card name from the cached snapshot.
    fn card_name(&self, id: CardId) -> String {
        if let Some(ref snap) = self.last_game_snapshot {
            for (cid, name) in &snap.card_names {
                if *cid == id {
                    return name.clone();
                }
            }
        }
        format!("Card({})", id.0)
    }

    fn player_name(&self, id: PlayerId) -> String {
        if let Some(ref snap) = self.last_game_snapshot {
            for (pid, name) in &snap.player_names {
                if *pid == id {
                    return name.clone();
                }
            }
        }
        format!("Player{}", id.0 + 1)
    }

    fn defender_sort_key(&self, defender: DefenderId) -> (String, u32) {
        match defender {
            DefenderId::Player(pid) => (self.player_name(pid), pid.0),
            DefenderId::Permanent(cid) => (self.card_name(cid), self.parity_map.id(cid)),
        }
    }

    /// Check if a card is a land from the cached snapshot.
    fn is_land(&self, id: CardId) -> bool {
        if let Some(ref snap) = self.last_game_snapshot {
            for (cid, land) in &snap.card_is_land {
                if *cid == id {
                    return *land;
                }
            }
        }
        false
    }

    fn is_mana_ability(&self, card_id: CardId, ability_idx: usize) -> bool {
        if ability_idx == STATIC_ALTERNATIVE_ABILITY_INDEX {
            return false;
        }
        if let Some(ref snap) = self.last_game_snapshot {
            for ((cid, idx), is_mana) in &snap.ability_is_mana {
                if *cid == card_id && *idx == ability_idx {
                    return *is_mana;
                }
            }
        }
        false
    }

    /// Find the ability_index of the UnlockDoor activated ability on a Room card.
    /// Used by `action_sort_key` to produce the correct Java-matching sort key
    /// for Room unlock actions.
    fn unlock_door_ability_index(&self, card_id: CardId) -> usize {
        if let Some(ref snap) = self.last_game_snapshot {
            for ((cid, ability_idx), text) in &snap.ability_texts {
                if *cid != card_id {
                    continue;
                }
                if forge_engine_core::parsing::raw_get(text, forge_engine_core::parsing::keys::AB)
                    .map(|v| v.eq_ignore_ascii_case("UnlockDoor"))
                    .unwrap_or(false)
                {
                    return *ability_idx;
                }
            }
        }
        0
    }

    fn ability_sort_text(&self, card_id: CardId, ability_idx: usize) -> String {
        if ability_idx == STATIC_ALTERNATIVE_ABILITY_INDEX {
            return String::new();
        }
        if let Some(ref snap) = self.last_game_snapshot {
            for ((cid, idx), text) in &snap.ability_texts {
                if *cid == card_id && *idx == ability_idx {
                    return text.clone();
                }
            }
        }
        String::new()
    }

    fn target_owner_controller_key(&self, id: CardId) -> (u32, u32) {
        if let Some(ref snap) = self.last_game_snapshot {
            for (cid, owner_controller) in &snap.card_owner_controller {
                if *cid == id {
                    return *owner_controller;
                }
            }
            (u32::MAX, u32::MAX)
        } else {
            (u32::MAX, u32::MAX)
        }
    }

    fn predicted_damage_to_card(
        &self,
        game: &GameState,
        target: CardId,
        amount: i32,
        source: CardId,
        is_combat: bool,
    ) -> i32 {
        if amount <= 0 {
            return 0;
        }
        let mut sim = Self::shallow_replacement_game(game);
        let mut event = ReplacementEvent::DamageToCard {
            target,
            amount,
            source: Some(source),
            is_combat,
        };
        let _ = apply_replacements(&mut sim, &mut event);
        match event {
            ReplacementEvent::DamageToCard { amount, .. } => amount.max(0),
            _ => 0,
        }
    }

    fn damage_needed_to_kill(
        &self,
        game: &GameState,
        target: CardId,
        max_damage: i32,
        source: CardId,
        is_combat: bool,
    ) -> i32 {
        let target_card = game.card(target);
        let source_card = game.card(source);
        let mut kill_damage = (target_card.toughness() - target_card.damage).max(0);

        if target_card.has_keyword("Indestructible")
            && !source_card.has_wither()
            && !source_card.has_infect()
        {
            return max_damage + 1;
        }
        if source_card.has_deathtouch() && target_card.is_creature() {
            kill_damage = 1;
        }

        for damage in 1..=max_damage {
            if self.predicted_damage_to_card(game, target, damage, source, is_combat) >= kill_damage
            {
                return damage;
            }
        }

        max_damage + 1
    }

    fn play_option_label(&self, play: PlayOption) -> String {
        if self.is_land(play.card_id) {
            return format!("LAND:{}", self.card_name(play.card_id));
        }
        // MDFC back-face land — Java buckets as LAND via isLandAbility().
        if play.mode == PlayCardMode::BackFaceLand {
            return format!("LAND:{}", self.card_name(play.card_id));
        }
        // Java harness: Room UnlockDoor is a StaticAbilityApiBased where
        // isSpell()=false, isLandAbility()=false, isManaAbility()=false,
        // so actionBaseLabel() classifies it as "AB:".
        if play.mode == PlayCardMode::UnlockDoor {
            return format!("AB:{}", self.card_name(play.card_id));
        }
        let fb_tag = match play.mode {
            PlayCardMode::Alternative(AlternativeCost::Flashback) => "[FB]",
            _ => "",
        };
        format!("SPELL:{}{}", self.card_name(play.card_id), fb_tag)
    }

    fn play_option_sort_text(play: PlayOption) -> &'static str {
        match play.mode {
            PlayCardMode::Normal => "0",
            PlayCardMode::BackFaceLand => "0",
            PlayCardMode::RoomRightSplit => "0",
            PlayCardMode::Alternative(AlternativeCost::Flashback) => "Flashback",
            PlayCardMode::Alternative(AlternativeCost::Spectacle) => "Spectacle",
            PlayCardMode::Alternative(AlternativeCost::Evoke) => "Evoke",
            PlayCardMode::Alternative(AlternativeCost::Dash) => "Dash",
            PlayCardMode::Alternative(AlternativeCost::Blitz) => "Blitz",
            PlayCardMode::Alternative(AlternativeCost::Escape) => "Escape",
            PlayCardMode::Alternative(AlternativeCost::Overload) => "Overload",
            PlayCardMode::Alternative(AlternativeCost::Madness) => "Madness",
            PlayCardMode::Alternative(AlternativeCost::Foretell) => "Foretell",
            PlayCardMode::Alternative(AlternativeCost::Emerge) => "Emerge",
            PlayCardMode::Alternative(AlternativeCost::Suspend) => "Suspend",
            PlayCardMode::Alternative(AlternativeCost::Morph)
            | PlayCardMode::Alternative(AlternativeCost::Megamorph) => "Morph",
            PlayCardMode::Alternative(AlternativeCost::Bestow) => "Bestow",
            PlayCardMode::Alternative(AlternativeCost::Warp) => "0",
            PlayCardMode::Alternative(AlternativeCost::SacrificeAlt) => "0",
            PlayCardMode::Alternative(AlternativeCost::Plot) => "Plot",
            PlayCardMode::Alternative(AlternativeCost::Awaken) => "Awaken",
            PlayCardMode::Alternative(AlternativeCost::Disturb) => "Disturb",
            PlayCardMode::Alternative(AlternativeCost::Harmonize) => "Harmonize",
            PlayCardMode::Alternative(AlternativeCost::Freerunning) => "Freerunning",
            PlayCardMode::Alternative(AlternativeCost::Impending) => "Impending",
            PlayCardMode::Alternative(AlternativeCost::Mayhem) => "Mayhem",
            PlayCardMode::Alternative(AlternativeCost::MTMtE) => "MTMtE",
            PlayCardMode::Alternative(AlternativeCost::Mutate) => "Mutate",
            PlayCardMode::Alternative(AlternativeCost::Prowl) => "Prowl",
            PlayCardMode::Alternative(AlternativeCost::Sneak) => "Sneak",
            PlayCardMode::Alternative(AlternativeCost::Surge) => "Surge",
            PlayCardMode::Alternative(AlternativeCost::WebSlinging) => "WebSlinging",
            PlayCardMode::Alternative(AlternativeCost::Plotted) => "Plotted",
            // Host-card `Mode$ AlternativeCost` actions are represented in Rust
            // as `StaticAlternative`; parity uses the same explicit label.
            PlayCardMode::StaticAlternative => "StaticAlternative",
            PlayCardMode::ForetellExile => "ForetellExile",
            PlayCardMode::UnlockDoor => "0",
        }
    }

    /// Fallback tiebreaker for card play modes. Mirrors Java's use of
    /// `sa.toUnsuppressedString()` as the 5th sort key field.
    /// When variant is the same (e.g., Normal and Warp both return "0"),
    /// this ensures a deterministic ordering.
    fn play_option_fallback(&self, play: PlayOption) -> String {
        // Disambiguate multi-cost alt entries (e.g. intrinsic vs granted
        // Evoke) so the stable sort places them in a predictable order that
        // matches Java's SA text ordering.
        let idx_suffix = if play.alt_cost_index > 0 {
            format!(":{:03}", play.alt_cost_index)
        } else {
            String::new()
        };
        // Split cards expose one playable per face — Java's
        // `sa.toUnsuppressedString()` therefore differs per face (front vs
        // back oracle text). Mirror that by feeding the per-face name into
        // the fallback. We read it from `Card::full_name` (the canonical
        // "Front // Back" form for split-type cards) so the lookup stays
        // generic — no Room-specific SVars.
        let base: String = match play.mode {
            PlayCardMode::Normal => self
                .play_option_face_name(play)
                .unwrap_or_else(|| "0".to_string()),
            PlayCardMode::BackFaceLand => "1".to_string(),
            PlayCardMode::RoomRightSplit => self
                .play_option_face_name(play)
                .unwrap_or_else(|| "2".to_string()),
            PlayCardMode::Alternative(AlternativeCost::Warp) => "Warp".to_string(),
            PlayCardMode::StaticAlternative => "StaticAlternative".to_string(),
            // Other modes already have unique variant strings, so fallback rarely matters.
            _ => String::new(),
        };
        format!("{base}{idx_suffix}")
    }

    /// For a playable on a split card (`"Front // Back"` `full_name`), return
    /// the name of the face being cast — front for `Normal`, back for
    /// `RoomRightSplit`. Returns `None` for non-split cards or modes that
    /// don't pick a face.
    fn play_option_face_name(&self, play: PlayOption) -> Option<String> {
        let snap = self.last_game_snapshot.as_ref()?;
        let card = snap.cards.iter().find(|c| c.id == play.card_id)?;
        let (front, back) = card.full_name.split_once(" // ")?;
        Some(match play.mode {
            PlayCardMode::Normal => front.trim().to_string(),
            PlayCardMode::RoomRightSplit => back.trim().to_string(),
            _ => return None,
        })
    }

    fn action_sort_key(&self, choice: &ActionChoice) -> String {
        match *choice {
            ActionChoice::Card(play) => {
                // Room UnlockDoor: Java models this as a StaticAbilityApiBased
                // where isSpell()=false, so it sorts in the ability bucket (|1|)
                // with abilityDeclarationIndex as the variant, not the spell bucket.
                if play.mode == PlayCardMode::UnlockDoor {
                    let ability_idx = self.unlock_door_ability_index(play.card_id);
                    let sort_idx = self
                        .last_game_snapshot
                        .as_ref()
                        .map(|snap| {
                            parity_order::ability_declaration_sort_key(
                                &snap.cards,
                                &snap.ability_texts,
                                play.card_id,
                                ability_idx,
                            )
                        })
                        .unwrap_or_else(|| format!("{ability_idx:05}"));
                    return format!(
                        "AB:{}|1|{}|{}|{}",
                        self.card_name(play.card_id),
                        self.parity_map.id(play.card_id),
                        sort_idx,
                        self.ability_sort_text(play.card_id, ability_idx),
                    );
                }
                let label = self.play_option_label(play);
                format!(
                    "{}|0|{}|{}|{}",
                    label,
                    self.parity_map.id(play.card_id),
                    Self::play_option_sort_text(play),
                    self.play_option_fallback(play),
                )
            }
            ActionChoice::Ability(card_id, ability_idx) => {
                let sort_idx = self
                    .last_game_snapshot
                    .as_ref()
                    .map(|snap| {
                        parity_order::ability_declaration_sort_key(
                            &snap.cards,
                            &snap.ability_texts,
                            card_id,
                            ability_idx,
                        )
                    })
                    .unwrap_or_else(|| {
                        if ability_idx == STATIC_ALTERNATIVE_ABILITY_INDEX {
                            "-0001".to_string()
                        } else {
                            format!("{ability_idx:05}")
                        }
                    });
                format!(
                    "AB:{}|1|{}|{}|{}",
                    self.card_name(card_id),
                    self.parity_map.id(card_id),
                    sort_idx,
                    self.ability_sort_text(card_id, ability_idx),
                )
            }
        }
    }

    fn sorted_priority_action_choices(
        &self,
        action_space: &PriorityActionSpace,
    ) -> Vec<(String, ActionChoice)> {
        // Match Java harness ActionSpace: omit explicit mana abilities.
        // Activated-ability payability comes directly from engine action-space.
        let filtered_activatable = action_space
            .activatable
            .iter()
            .map(|a| (a.card_id, a.ability_index))
            .filter(|(card_id, ability_idx)| !self.is_mana_ability(*card_id, *ability_idx));
        let choices = action_space
            .playable
            .iter()
            .copied()
            .map(ActionChoice::Card)
            .chain(filtered_activatable.map(|(card_id, idx)| ActionChoice::Ability(card_id, idx)));
        let mut choices: Vec<(String, ActionChoice)> = choices
            .map(|choice| (self.action_sort_key(&choice), choice))
            .collect();
        choices.sort_by(|a, b| a.0.cmp(&b.0));
        choices
    }

    fn format_action_choice_for_log(&self, choice: ActionChoice) -> String {
        match choice {
            ActionChoice::Card(play) => format!(
                "CastSpell(PlayOption {{ card: {}@{}, mode: Normal }})",
                self.card_name(play.card_id),
                self.parity_map.id(play.card_id),
            ),
            ActionChoice::Ability(card_id, ability_idx) => format!(
                "ActivateAbility(AbilityRef {{ card: {}@{}, ability_index: {} }})",
                self.card_name(card_id),
                self.parity_map.id(card_id),
                if ability_idx == STATIC_ALTERNATIVE_ABILITY_INDEX {
                    "-1".to_string()
                } else {
                    ability_idx.to_string()
                },
            ),
        }
    }

    pub(crate) fn format_action_space_for_log(
        &self,
        action_space: &PriorityActionSpace,
    ) -> Option<String> {
        let mut rendered: Vec<String> = self
            .sorted_priority_action_choices(action_space)
            .into_iter()
            .enumerate()
            .map(|(idx, (_, choice))| {
                format!("#{idx} {}", self.format_action_choice_for_log(choice))
            })
            .collect();
        if rendered.is_empty() {
            return None;
        }
        rendered.push("PASS".to_string());
        Some(format!("[{}]", rendered.join(" | ")))
    }

    fn snapshot_card<'a>(&self, snap: &'a GameSnapshot, id: CardId) -> Option<&'a Card> {
        snap.cards.iter().find(|c| c.id == id)
    }

    fn snapshot_can_creature_block(
        &self,
        snap: &GameSnapshot,
        blocker_id: CardId,
        attacker_id: CardId,
    ) -> bool {
        let Some(attacker) = self.snapshot_card(snap, attacker_id) else {
            return false;
        };
        let Some(blocker) = self.snapshot_card(snap, blocker_id) else {
            return false;
        };

        if !blocker.can_block() {
            return false;
        }
        if attacker.has_flying() && !blocker.has_flying() && !blocker.has_reach() {
            return false;
        }
        if attacker.has_fear() && !blocker.type_line.is_artifact() && !blocker.color.has_black() {
            return false;
        }
        if attacker.has_intimidate()
            && !blocker.type_line.is_artifact()
            && !blocker.color.shares_color_with(attacker.color)
        {
            return false;
        }
        if attacker.has_shadow() != blocker.has_shadow() {
            return false;
        }
        if attacker.has_horsemanship() && !blocker.has_horsemanship() {
            return false;
        }
        if attacker.has_skulk() && blocker.power() > attacker.power() {
            return false;
        }
        if attacker.is_protected_from(blocker) {
            return false;
        }

        for source in snap.cards.iter().filter(|c| {
            c.zone == forge_foundation::ZoneType::Battlefield
                || c.zone == forge_foundation::ZoneType::Command
        }) {
            for sa in &source.static_abilities {
                if !sa.check_mode(&forge_engine_core::staticability::StaticMode::CantBlockBy) {
                    continue;
                }

                if let Some(valid_attacker) = sa.ir.valid_attacker.as_ref() {
                    if !forge_engine_core::card::valid_filter::matches_valid_card_selector(
                        valid_attacker,
                        attacker,
                        source,
                    ) {
                        continue;
                    }
                }

                if let Some(valid_blocker) = sa.ir.valid_blocker_text.as_deref() {
                    let blocker_matches = valid_blocker.split(',').any(|v| {
                        forge_engine_core::card::valid_filter::matches_valid_card(
                            v.trim(),
                            blocker,
                            source,
                        )
                    });
                    if !blocker_matches {
                        continue;
                    }
                }

                return false;
            }
        }

        true
    }

    fn legal_attackers_for_blocker(&self, blocker: CardId, attackers: &[CardId]) -> Vec<CardId> {
        let Some(ref snap) = self.last_game_snapshot else {
            return attackers.to_vec();
        };
        attackers
            .iter()
            .copied()
            .filter(|&attacker| self.snapshot_can_creature_block(snap, blocker, attacker))
            .collect()
    }

    fn snapshot_max_blockers_for_attacker(&self, snap: &GameSnapshot, attacker: CardId) -> usize {
        let Some(attacker_card) = self.snapshot_card(snap, attacker) else {
            return usize::MAX;
        };
        let mut max = usize::MAX;
        for source in snap.cards.iter().filter(|c| {
            c.zone == forge_foundation::ZoneType::Battlefield
                || c.zone == forge_foundation::ZoneType::Command
        }) {
            for st_ab in &source.static_abilities {
                if !st_ab.check_mode(&forge_engine_core::staticability::StaticMode::MinMaxBlocker) {
                    continue;
                }
                if !forge_engine_core::card::valid_filter::matches_valid_card_selector_opt(
                    st_ab.ir.valid_card.as_ref(),
                    attacker_card,
                    source,
                ) {
                    continue;
                }
                if let Some(max_text) = st_ab.ir.max_text.as_deref() {
                    if let Ok(value) = max_text.trim().parse::<usize>() {
                        max = max.min(value);
                    }
                }
            }
        }
        max
    }

    /// Pick a random index in [0, len) from the shared RNG.
    fn pick(&self, len: usize) -> usize {
        choice_space::pick_index(len, &mut self.rng.borrow_mut())
    }

    fn is_verbose(&self) -> bool {
        self.verbose.is_active(self.current_turn)
    }

    fn emit_callback(&self, name: &str, outcome: &str) {
        if let Some(ref observer) = self.parity_observer {
            observer.on_callback(
                name,
                outcome,
                self.player_id.0,
                self.current_turn,
                &format!(
                    "{:?}",
                    self.last_game_snapshot
                        .as_ref()
                        .map(|s| &s.phase)
                        .unwrap_or(&PhaseType::Untap)
                ),
                Vec::new(),
            );
        }
    }
}

impl PlayerAgent for DeterministicAgent {
    fn snapshot_state(&mut self, game: &GameState, _mana_pools: &[ManaPool]) {
        let split_priority_snapshot = forge_engine_core::perf::current_params_lookup_scope()
            == Some(forge_engine_core::perf::ParamsLookupScope::PrioritySnapshot);
        // Assign parity IDs for all currently existing cards as soon as we
        // observe state, so later parity_id reads are not first-touch dependent.
        {
            let _perf_scope = split_priority_snapshot
                .then(|| {
                    forge_engine_core::perf::ParamsLookupScopeGuard::enter(
                        forge_engine_core::perf::ParamsLookupScope::PrioritySnapshotSync,
                    )
                })
                .flatten();
            self.parity_map.sync_with_game(game);
        }

        let player_names: Vec<(PlayerId, String)> = game
            .players
            .iter()
            .map(|player| (player.id, player.name.clone()))
            .collect();
        let (card_names, card_is_land, card_owner_controller) = {
            let _perf_scope = split_priority_snapshot
                .then(|| {
                    forge_engine_core::perf::ParamsLookupScopeGuard::enter(
                        forge_engine_core::perf::ParamsLookupScope::PrioritySnapshotMetadata,
                    )
                })
                .flatten();
            let card_names: Vec<(CardId, String)> = game
                .cards
                .iter()
                .map(|c| {
                    let name = if c.face_down {
                        String::new()
                    } else {
                        c.card_name.clone()
                    };
                    (c.id, name)
                })
                .collect();
            let card_is_land: Vec<(CardId, bool)> =
                game.cards.iter().map(|c| (c.id, c.is_land())).collect();
            let card_owner_controller: Vec<(CardId, (u32, u32))> = game
                .cards
                .iter()
                .map(|c| (c.id, (c.owner.0, c.controller.0)))
                .collect();
            (card_names, card_is_land, card_owner_controller)
        };
        let (ability_is_mana, ability_texts) = {
            let _perf_scope = split_priority_snapshot
                .then(|| {
                    forge_engine_core::perf::ParamsLookupScopeGuard::enter(
                        forge_engine_core::perf::ParamsLookupScope::PrioritySnapshotAbility,
                    )
                })
                .flatten();
            let ability_is_mana: Vec<((CardId, usize), bool)> = game
                .cards
                .iter()
                .flat_map(|c| {
                    c.activated_abilities
                        .iter()
                        .map(move |ab| ((c.id, ab.ability_index), ab.is_mana_ability))
                })
                .collect();
            let ability_texts: Vec<((CardId, usize), String)> = game
                .cards
                .iter()
                .flat_map(|c| {
                    c.activated_abilities
                        .iter()
                        .map(move |ab| ((c.id, ab.ability_index), ab.ability_text.clone()))
                })
                .collect();
            (ability_is_mana, ability_texts)
        };
        let cards: Vec<Card> = {
            let _perf_scope = split_priority_snapshot
                .then(|| {
                    forge_engine_core::perf::ParamsLookupScopeGuard::enter(
                        forge_engine_core::perf::ParamsLookupScope::PrioritySnapshotCardClone,
                    )
                })
                .flatten();
            game.cards.iter().map(Self::shallow_snapshot_card).collect()
        };
        self.last_game_snapshot = Some(GameSnapshot {
            cards,
            player_names,
            card_names,
            card_is_land,
            card_owner_controller,
            ability_is_mana,
            ability_texts,
            phase: game.turn.phase,
            stack_depth: game.stack.len(),
        });
    }

    fn choose_targets_for(
        &mut self,
        sa: &mut forge_engine_core::spellability::SpellAbility,
        game: &GameState,
        mana_pools: &[ManaPool],
    ) -> bool {
        self.snapshot_state(game, mana_pools);
        if let Some(tr) = sa.target_restrictions.as_ref() {
            let min_targets = tr.get_min_targets(game, sa);
            let current_targets = sa.target_chosen.all_target_cards().len() as i32
                + sa.target_chosen.all_target_players().len() as i32
                + i32::from(sa.target_chosen.target_stack_entry.is_some());
            if current_targets == 0 && min_targets <= 0 {
                return true;
            }
        }
        let result =
            forge_engine_core::spellability::choose_targets_by_kind(self, sa, game, mana_pools);

        // Log the actual targets chosen for parity debugging.
        let mut target_names = Vec::new();
        for pid in sa.target_chosen.all_target_players() {
            target_names.push(format!("Player({})", pid.0));
        }
        if let Some(cid) = sa.target_chosen.target_card {
            target_names.push(format!(
                "{}@{}",
                self.card_name(cid),
                self.parity_map.id(cid)
            ));
        }
        for &cid in sa.target_chosen.divided_map.keys() {
            target_names.push(format!(
                "{}@{}",
                self.card_name(cid),
                self.parity_map.id(cid)
            ));
        }
        if let Some(stack_id) = sa.target_chosen.target_stack_entry {
            target_names.push(format!("Stack({})", stack_id));
        }
        if !target_names.is_empty() {
            self.emit_callback(
                "choose_targets_for(inner)",
                &format!("[{}]", target_names.join(", ")),
            );
        }
        result
    }

    fn mulligan_decision(
        &mut self,
        _player: PlayerId,
        _hand: &[CardId],
        _mulligan_count: u32,
    ) -> bool {
        true
    }

    fn choose_action(
        &mut self,
        _player: PlayerId,
        action_space: Option<&PriorityActionSpace>,
        request_action_space: &mut dyn FnMut() -> PriorityActionSpace,
    ) -> PlayerAction {
        if self.should_skip_priority_action_space() {
            return PlayerAction::PassPriority;
        }
        let requested_action_space;
        let action_space = match action_space {
            Some(action_space) => action_space,
            None => {
                requested_action_space = request_action_space();
                &requested_action_space
            }
        };
        let playable = &action_space.playable;
        let activatable = &action_space.activatable;
        if self.is_verbose() {
            let raw_playable: Vec<String> = playable
                .iter()
                .map(|play| {
                    format!(
                        "{} [{}]",
                        self.action_sort_key(&ActionChoice::Card(*play)),
                        match play.mode {
                            PlayCardMode::Normal => "Normal",
                            PlayCardMode::BackFaceLand => "BackFaceLand",
                            PlayCardMode::RoomRightSplit => "RoomRightSplit",
                            PlayCardMode::UnlockDoor => "UnlockDoor",
                            PlayCardMode::StaticAlternative => "StaticAlternative",
                            PlayCardMode::ForetellExile => "ForetellExile",
                            PlayCardMode::Alternative(_) => "Alternative",
                        }
                    )
                })
                .collect();
            let raw_activatable: Vec<String> = activatable
                .iter()
                .map(|a| {
                    format!(
                        "AB:{}@{}:{} mana={}",
                        self.card_name(a.card_id),
                        self.parity_map.id(a.card_id),
                        a.ability_index,
                        self.is_mana_ability(a.card_id, a.ability_index)
                    )
                })
                .collect();
            eprintln!(
                "[parity-agent p{}] raw playable({}): {}",
                self.player_id.0,
                playable.len(),
                raw_playable.join(" | ")
            );
            eprintln!(
                "[parity-agent p{}] raw activatable({}): {}",
                self.player_id.0,
                activatable.len(),
                raw_activatable.join(" | ")
            );
        }
        if playable.is_empty() && activatable.is_empty() {
            return PlayerAction::PassPriority;
        }

        let choices = self.sorted_priority_action_choices(action_space);
        if self.is_verbose() {
            let rendered: Vec<String> = choices
                .iter()
                .enumerate()
                .map(|(idx, (sort_key, choice))| match *choice {
                    ActionChoice::Card(play) => format!(
                        "#{idx}: {sort_key} [{}]",
                        match play.mode {
                            PlayCardMode::Normal => "Normal",
                            PlayCardMode::BackFaceLand => "BackFaceLand",
                            PlayCardMode::RoomRightSplit => "RoomRightSplit",
                            PlayCardMode::UnlockDoor => "UnlockDoor",
                            PlayCardMode::StaticAlternative => "StaticAlternative",
                            PlayCardMode::ForetellExile => "ForetellExile",
                            PlayCardMode::Alternative(_) => "Alternative",
                        }
                    ),
                    ActionChoice::Ability(card_id, ability_idx) => format!(
                        "#{idx}: AB:{}@{}:{}",
                        self.card_name(card_id),
                        self.parity_map.id(card_id),
                        ability_idx
                    ),
                })
                .collect();
            eprintln!(
                "[parity-agent p{}] actions({}): {}",
                self.player_id.0,
                choices.len(),
                rendered.join(" | ")
            );
        }
        if choices.is_empty() {
            return PlayerAction::PassPriority;
        }
        // Pick randomly:
        // - default: each action + pass are equally likely
        // - prefer-actions: each action has weight PREFER_ACTION_WEIGHT, pass has weight 1
        let chosen_idx = if self.prefer_actions {
            let idx = choice_space::pick_weighted_index_with_pass(
                choices.len(),
                PREFER_ACTION_WEIGHT,
                &mut self.rng.borrow_mut(),
            );
            if idx >= choices.len() {
                return PlayerAction::PassPriority;
            }
            idx
        } else {
            let idx = choice_space::pick_index_with_pass(choices.len(), &mut self.rng.borrow_mut());
            if idx >= choices.len() {
                return PlayerAction::PassPriority;
            }
            idx
        };

        match choices[chosen_idx].1 {
            ActionChoice::Card(chosen) => PlayerAction::CastSpell(chosen),
            ActionChoice::Ability(card_id, ability_idx) => {
                PlayerAction::ActivateAbility(AbilityRef {
                    card_id,
                    ability_index: ability_idx,
                })
            }
        }
    }

    fn pay_mana_cost(
        &mut self,
        _player: PlayerId,
        _card_id: CardId,
        _card_name: &str,
        _mana_cost: &str,
        _mana_cost_display: &str,
        _mana_cost_checkpoint: &str,
        _can_confirm_from_pool: bool,
        _allow_reserved_source_reuse: bool,
        _reserved_sacrifices: &[CardId],
        _mana_ability_options: &[forge_engine_core::agent::ManaAbilityOption],
        _tappable_lands: &[CardId],
        _untappable_lands: &[CardId],
        _mana_pool: &ManaPool,
    ) -> ManaCostAction {
        ManaCostAction::Pay { auto: true }
    }

    fn choose_attackers(
        &mut self,
        _player: PlayerId,
        available: &[CardId],
        possible_defenders: &[DefenderId],
    ) -> Vec<(CardId, DefenderId)> {
        let mut attackers = Vec::new();
        if !possible_defenders.is_empty() {
            let sorted_defenders = choice_space::sort_native(possible_defenders, |a, b| {
                self.defender_sort_key(*a).cmp(&self.defender_sort_key(*b))
            });
            let sorted_available = choice_space::sort_native(available, |a, b| {
                let an = self.card_name(*a);
                let bn = self.card_name(*b);
                an.cmp(&bn)
                    .then_with(|| self.parity_map.id(*a).cmp(&self.parity_map.id(*b)))
            });
            for &id in &sorted_available {
                let roll = choice_space::pick_index(2, &mut self.rng.borrow_mut());
                if self.is_verbose() {
                    eprintln!(
                        "[parity-agent p{}] atk roll {} -> {}",
                        self.player_id.0,
                        self.card_name(id),
                        roll
                    );
                }
                if roll == 1 {
                    let def_idx = choice_space::pick_index(
                        sorted_defenders.len(),
                        &mut self.rng.borrow_mut(),
                    );
                    if self.is_verbose() {
                        eprintln!(
                            "[parity-agent p{}] atk defender {} idx={}/{}",
                            self.player_id.0,
                            self.card_name(id),
                            def_idx,
                            sorted_defenders.len()
                        );
                    }
                    attackers.push((id, sorted_defenders[def_idx]));
                }
            }
        }
        if !attackers.is_empty() {
            let names: Vec<String> = attackers
                .iter()
                .map(|&(id, _)| self.card_name(id))
                .collect();
            let _joined = names.join(", ");
        }
        attackers
    }

    fn exert_attackers(&mut self, _player: PlayerId, attackers: &[CardId]) -> Vec<CardId> {
        if attackers.is_empty() {
            return vec![];
        }
        let mut out = Vec::new();
        let mut rng = self.rng.borrow_mut();
        for &attacker in attackers {
            if gui_repro::pick_bool(&mut rng) {
                out.push(attacker);
            }
        }
        out
    }

    fn enlist_attackers(&mut self, _player: PlayerId, attackers: &[CardId]) -> Vec<CardId> {
        if attackers.is_empty() {
            return vec![];
        }
        choice_space::pick_one(attackers, &mut self.rng.borrow_mut())
            .into_iter()
            .collect()
    }

    fn choose_blockers(
        &mut self,
        _player: PlayerId,
        attackers: &[CardId],
        available_blockers: &[CardId],
        max_blockers: Option<usize>,
    ) -> Vec<(CardId, CardId)> {
        let sorted_attackers = choice_space::sort_native(attackers, |a, b| {
            let an = self.card_name(*a);
            let bn = self.card_name(*b);
            an.cmp(&bn)
                .then_with(|| self.parity_map.id(*a).cmp(&self.parity_map.id(*b)))
        });
        let sorted_blockers = choice_space::sort_native(available_blockers, |a, b| {
            let an = self.card_name(*a);
            let bn = self.card_name(*b);
            an.cmp(&bn)
                .then_with(|| self.parity_map.id(*a).cmp(&self.parity_map.id(*b)))
        });

        let mut pairs = Vec::new();
        let mut blocker_counts_by_attacker: HashMap<CardId, usize> = HashMap::new();
        for &blocker in &sorted_blockers {
            // When BlockRestrict limit is reached, Java still iterates remaining
            // blockers with 0 legal options (consuming RNG for forced PASS).
            // Mirror this by continuing iteration but with empty legal attackers.
            let at_limit = max_blockers.is_some_and(|max| pairs.len() >= max);
            let mut legal_attackers = if at_limit {
                Vec::new() // no legal targets → forced PASS (consumes RNG)
            } else {
                self.legal_attackers_for_blocker(blocker, &sorted_attackers)
            };
            if let Some(ref snap) = self.last_game_snapshot {
                legal_attackers.retain(|attacker| {
                    let current = blocker_counts_by_attacker
                        .get(attacker)
                        .copied()
                        .unwrap_or(0);
                    current < self.snapshot_max_blockers_for_attacker(snap, *attacker)
                });
            }
            let choice = choice_space::pick_index_with_pass(
                legal_attackers.len(),
                &mut self.rng.borrow_mut(),
            );
            if choice > 0 && choice <= legal_attackers.len() {
                let attacker = legal_attackers[choice - 1];
                *blocker_counts_by_attacker.entry(attacker).or_default() += 1;
                pairs.push((blocker, attacker));
            }
        }
        if pairs.is_empty() {
            return pairs;
        }
        pairs
    }

    fn choose_blocker_for(
        &mut self,
        _player: PlayerId,
        attackers: &[CardId],
        blocker: CardId,
    ) -> Option<CardId> {
        let sorted_attackers = choice_space::sort_native(attackers, |a, b| {
            let an = self.card_name(*a);
            let bn = self.card_name(*b);
            an.cmp(&bn)
                .then_with(|| self.parity_map.id(*a).cmp(&self.parity_map.id(*b)))
        });
        let legal_attackers = self.legal_attackers_for_blocker(blocker, &sorted_attackers);
        if legal_attackers.is_empty() {
            // Java DeterministicController always rolls `nextInt(options.size() + 1)`.
            // When options is empty, that's `nextInt(1)` (consumes RNG, always 0).
            let _ = choice_space::pick_index_with_pass(0, &mut self.rng.borrow_mut());
            return None;
        }
        let attacker = combat_choice_space::pick_single_blocker_target(
            &legal_attackers,
            &mut self.rng.borrow_mut(),
        );
        attacker?;
        let attacker = attacker.unwrap();
        Some(attacker)
    }

    fn choose_damage_assignment_order(
        &mut self,
        _player: PlayerId,
        _attacker: CardId,
        blockers: &[CardId],
    ) -> Vec<CardId> {
        parity_order::sort_cards_by_name_then_id(
            blockers,
            |cid| self.card_name(cid),
            |cid| self.parity_map.id(cid),
        )
    }

    fn assign_combat_damage(
        &mut self,
        game: &GameState,
        _player: PlayerId,
        attacker: CardId,
        blockers_in_order: &[CardId],
        defender_id: Option<DefenderId>,
        damage_to_assign: i32,
    ) -> Vec<(Option<CardId>, i32)> {
        let mut out: Vec<(Option<CardId>, i32)> = Vec::new();
        if damage_to_assign <= 0 {
            return out;
        }

        let has_trample = game.card(attacker).has_trample();
        let can_assign_defender = has_trample && defender_id.is_some();
        let mut damage_left = damage_to_assign;
        let mut last_target: Option<CardId> = None;

        for &blocker in blockers_in_order {
            if damage_left <= 0 {
                break;
            }
            if game.card(blocker).zone != forge_foundation::ZoneType::Battlefield {
                continue;
            }
            if forge_engine_core::staticability::static_ability_colorless_damage_source::target_is_protected_from_source(
                &game.cards,
                game.card(blocker),
                game.card(attacker),
            ) {
                continue;
            }
            last_target = Some(blocker);
            let blocker_card = game.card(blocker);
            let lethal = if blocker_card.type_line.is_planeswalker() {
                blocker_card.counter_count(&forge_engine_core::card::CounterType::Loyalty)
            } else {
                self.damage_needed_to_kill(game, blocker, damage_left, attacker, true)
            };
            let assign = lethal.min(damage_left);
            if assign > 0 {
                out.push((Some(blocker), assign));
                damage_left -= assign;
            }
        }

        if damage_left > 0 {
            if can_assign_defender {
                out.push((None, damage_left));
            } else if let Some(last) = last_target {
                if let Some((_, d)) = out
                    .iter_mut()
                    .find(|(assignee, _)| assignee.map(|id| id == last).unwrap_or(false))
                {
                    *d += damage_left;
                } else {
                    out.push((Some(last), damage_left));
                }
            }
        }

        out
    }

    fn choose_target_spell(
        &mut self,
        _player: PlayerId,
        valid: &[u32],
        _source: Option<CardId>,
    ) -> Option<u32> {
        if valid.is_empty() {
            return None;
        }
        let target = choice_space::pick_one(valid, &mut self.rng.borrow_mut())?;
        Some(target)
    }

    fn choose_target_player(
        &mut self,
        _player: PlayerId,
        valid: &[PlayerId],
        _sa: Option<&forge_engine_core::spellability::SpellAbility>,
    ) -> Option<PlayerId> {
        if valid.is_empty() {
            return None;
        }
        let target = choice_space::pick_one(valid, &mut self.rng.borrow_mut())?;
        Some(target)
    }

    fn choose_target_card(
        &mut self,
        _player: PlayerId,
        valid: &[CardId],
        _sa: Option<&forge_engine_core::spellability::SpellAbility>,
    ) -> Option<CardId> {
        if valid.is_empty() {
            return None;
        }
        // Keep target ordering aligned with Java parity harness:
        // sort by card name, then owner/controller, then parity id.
        let sorted = choice_space::sort_native(valid, |a, b| {
            self.card_name(*a)
                .cmp(&self.card_name(*b))
                .then_with(|| {
                    self.target_owner_controller_key(*a)
                        .cmp(&self.target_owner_controller_key(*b))
                })
                .then_with(|| self.parity_map.id(*a).cmp(&self.parity_map.id(*b)))
        });
        let target = choice_space::pick_one(&sorted, &mut self.rng.borrow_mut())?;
        Some(target)
    }

    fn choose_target_card_from_zone(
        &mut self,
        _player: PlayerId,
        _zone: forge_foundation::ZoneType,
        valid: &[CardId],
        _sa: Option<&forge_engine_core::spellability::SpellAbility>,
    ) -> Option<CardId> {
        if valid.is_empty() {
            return None;
        }
        let sorted = choice_space::sort_native(valid, |a, b| {
            self.card_name(*a)
                .cmp(&self.card_name(*b))
                .then_with(|| {
                    self.target_owner_controller_key(*a)
                        .cmp(&self.target_owner_controller_key(*b))
                })
                .then_with(|| self.parity_map.id(*a).cmp(&self.parity_map.id(*b)))
        });
        choice_space::pick_one(&sorted, &mut self.rng.borrow_mut())
    }

    fn choose_target_any(
        &mut self,
        _player: PlayerId,
        valid_players: &[PlayerId],
        valid_cards: &[CardId],
        _sa: Option<&forge_engine_core::spellability::SpellAbility>,
    ) -> TargetChoice {
        let mut sorted: Vec<TargetChoice> = valid_players
            .iter()
            .copied()
            .map(TargetChoice::Player)
            .chain(valid_cards.iter().copied().map(TargetChoice::Card))
            .collect();
        // Keep target ordering aligned with Java parity harness:
        // players first by id/name, then cards by name, owner/controller, parity id.
        sorted.sort_by(|a, b| match (a, b) {
            (TargetChoice::Player(pa), TargetChoice::Player(pb)) => pa.0.cmp(&pb.0),
            (TargetChoice::Player(_), TargetChoice::Card(_)) => std::cmp::Ordering::Less,
            (TargetChoice::Card(_), TargetChoice::Player(_)) => std::cmp::Ordering::Greater,
            (TargetChoice::Card(ca), TargetChoice::Card(cb)) => self
                .card_name(*ca)
                .cmp(&self.card_name(*cb))
                .then_with(|| {
                    self.target_owner_controller_key(*ca)
                        .cmp(&self.target_owner_controller_key(*cb))
                })
                .then_with(|| self.parity_map.id(*ca).cmp(&self.parity_map.id(*cb))),
            _ => std::cmp::Ordering::Equal,
        });

        let total = sorted.len();

        if total == 0 {
            return TargetChoice::None;
        }

        let idx = self.pick(total);
        match sorted[idx] {
            TargetChoice::Player(pid) => TargetChoice::Player(pid),
            TargetChoice::Card(cid) => TargetChoice::Card(cid),
            TargetChoice::None => TargetChoice::None,
        }
    }

    fn choose_optional_trigger(
        &mut self,
        _player: PlayerId,
        _description: &str,
        _source: Option<CardId>,
        _api: Option<forge_engine_core::ability::api_type::ApiType>,
    ) -> bool {
        let accept = choice_space::pick_bool(&mut self.rng.borrow_mut());
        accept
    }

    fn confirm_action(
        &mut self,
        _player: PlayerId,
        _mode: Option<&str>,
        _message: &str,
        _options: &[String],
        _source: Option<CardId>,
        _api: Option<forge_engine_core::ability::api_type::ApiType>,
    ) -> bool {
        let accept = choice_space::pick_bool(&mut self.rng.borrow_mut());
        accept
    }

    fn confirm_replacement_effect(
        &mut self,
        _player: PlayerId,
        _question: &str,
        _effect_description: &str,
        _source: Option<CardId>,
    ) -> bool {
        let accept = choice_space::pick_bool(&mut self.rng.borrow_mut());
        accept
    }

    fn confirm_payment(
        &mut self,
        _player: PlayerId,
        _cost_kind: &str,
        _message: &str,
        _source: Option<CardId>,
        _api: Option<forge_engine_core::ability::api_type::ApiType>,
    ) -> bool {
        let accept = choice_space::pick_bool(&mut self.rng.borrow_mut());
        accept
    }

    fn pay_cost_to_prevent_effect(
        &mut self,
        _player: PlayerId,
        _cost_kind: &str,
        _message: &str,
        _source: Option<CardId>,
        _api: Option<forge_engine_core::ability::api_type::ApiType>,
        can_pay: bool,
    ) -> bool {
        // Java DeterministicController.payCostToPreventEffect short-circuits
        // to false when ComputerUtilCost.canPayCost reports the cost as
        // unpayable; otherwise it enters deterministic cost payment directly
        // (no separate boolean RNG). Mirror that gate here.
        can_pay
    }

    fn choose_binary(
        &mut self,
        _player: PlayerId,
        _question: &str,
        _kind: BinaryChoiceKind,
        _default_choice: Option<bool>,
        _source: Option<CardId>,
        _api: Option<forge_engine_core::ability::api_type::ApiType>,
    ) -> bool {
        let chosen_left = choice_space::pick_bool(&mut self.rng.borrow_mut());
        chosen_left
    }

    // ── Fixed overrides that sort alphabetically (matching Java) but use no RNG ──

    fn choose_legend_keep(&mut self, _player: PlayerId, duplicates: &[CardId]) -> CardId {
        // Sort by (card_name, parity_id) for deterministic cross-engine parity.
        // Both Java and Rust sort identically to avoid HashMap ordering issues.
        let sorted = choice_space::sort_native(duplicates, |a, b| {
            self.card_name(*a)
                .cmp(&self.card_name(*b))
                .then_with(|| self.parity_map.id(*a).cmp(&self.parity_map.id(*b)))
        });
        choice_space::pick_one(&sorted, &mut self.rng.borrow_mut()).unwrap_or(duplicates[0])
    }

    fn choose_sacrifice(
        &mut self,
        _player: PlayerId,
        valid: &[CardId],
        _source: Option<CardId>,
    ) -> Option<CardId> {
        if valid.is_empty() {
            return None;
        }
        let sorted = choice_space::sort_native(valid, |a, b| {
            self.card_name(*a)
                .cmp(&self.card_name(*b))
                .then_with(|| self.parity_map.id(*a).cmp(&self.parity_map.id(*b)))
        });
        // Match Java `choosePermanentsToSacrifice` which calls
        // `ChoiceSpace.pickManyCards(sorted, min=1, max=1, rng)`. The RNG
        // trajectory must match, so walk the same `pick_count` + `pick_index`
        // + `pick_many_unique` sequence even though we only return one card.
        let picked = gui_repro::pick_many_unique(&sorted, 1, 1, &mut self.rng.borrow_mut());
        picked.into_iter().next()
    }

    fn choose_discard(&mut self, _player: PlayerId, hand: &[CardId], num: usize) -> Vec<CardId> {
        if hand.is_empty() || num == 0 {
            return vec![];
        }
        // Sort by (card_name, parity_id) for deterministic cross-engine parity.
        let sorted = choice_space::sort_native(hand, |a, b| {
            self.card_name(*a)
                .cmp(&self.card_name(*b))
                .then_with(|| self.parity_map.id(*a).cmp(&self.parity_map.id(*b)))
        });
        gui_repro::pick_many_unique(&sorted, num, num, &mut self.rng.borrow_mut())
    }

    fn choose_discard_any_number(
        &mut self,
        _player: PlayerId,
        hand: &[CardId],
        min: usize,
        max: usize,
    ) -> Vec<CardId> {
        if hand.is_empty() {
            return vec![];
        }
        let sorted = choice_space::sort_native(hand, |a, b| {
            self.card_name(*a)
                .cmp(&self.card_name(*b))
                .then_with(|| self.parity_map.id(*a).cmp(&self.parity_map.id(*b)))
        });
        let clamped_max = max.min(sorted.len());
        gui_repro::pick_many_unique(&sorted, min, clamped_max, &mut self.rng.borrow_mut())
    }

    fn choose_random_discard(
        &mut self,
        _player: PlayerId,
        hand: &[CardId],
        num: usize,
    ) -> Vec<CardId> {
        if hand.is_empty() || num == 0 {
            return vec![];
        }
        // Reservoir sampling with the game RNG, mirroring Java's Aggregates.random()
        // which uses MyRandom.getRandom().nextInt(i) for reservoir replacement.
        // We use game_rng (not agent rng) to match Java's architecture where
        // Aggregates.random() uses MyRandom (the game-level RNG) rather than
        // the agent's decision RNG.
        // IMPORTANT: Do NOT sort — Java iterates cards in zone order (the order
        // they were added to hand), not alphabetically. Sorting would change the
        // reservoir sampling input sequence and produce different results.
        let count = num.min(hand.len());
        let mut rng = self.game_rng.borrow_mut();
        let mut result: Vec<CardId> = hand[..count].to_vec();
        for (offset, &card) in hand[count..].iter().enumerate() {
            let i = count + offset;
            let j = choice_space::pick_index(i + 1, &mut rng);
            if j < count {
                result[j] = card;
            }
        }
        result
    }

    fn choose_dig(
        &mut self,
        _game: &GameState,
        _player: PlayerId,
        valid: &[CardId],
        max: usize,
        optional: bool,
    ) -> Vec<CardId> {
        if valid.is_empty() || max == 0 {
            return vec![];
        }
        // Java DigEffect: min = (anyNumber || optional) ? 0 : max
        // When not optional, the player must take exactly `max` cards.
        let min = if optional { 0 } else { max };
        // Sort by (card_name, parity_id) for deterministic cross-engine parity.
        let sorted = choice_space::sort_native(valid, |a, b| {
            self.card_name(*a)
                .cmp(&self.card_name(*b))
                .then_with(|| self.parity_map.id(*a).cmp(&self.parity_map.id(*b)))
        });
        gui_repro::pick_many_unique(&sorted, min, max, &mut self.rng.borrow_mut())
    }

    fn choose_land_or_spell(&mut self, _player: PlayerId) -> Option<bool> {
        // TODO: engine does not currently expose a typed choice list here.
        None
    }

    fn choose_color(&mut self, _player: PlayerId, valid_colors: &[String]) -> Option<String> {
        let sorted = parity_order::sort_color_names_like_java(valid_colors);
        gui_repro::choose_color(&sorted, &mut self.rng.borrow_mut())
    }

    fn choose_colors(
        &mut self,
        _player: PlayerId,
        valid_colors: &[String],
        min: usize,
        max: usize,
    ) -> Vec<String> {
        let sorted = parity_order::sort_color_names_like_java(valid_colors);
        gui_repro::choose_colors(&sorted, min, max, &mut self.rng.borrow_mut())
    }

    fn choose_type(
        &mut self,
        _player: PlayerId,
        _type_category: &str,
        valid_types: &[String],
    ) -> Option<String> {
        gui_repro::choose_type(valid_types, &mut self.rng.borrow_mut())
    }

    fn choose_card_name(&mut self, _player: PlayerId, valid_names: &[String]) -> Option<String> {
        gui_repro::choose_card_name(valid_names, &mut self.rng.borrow_mut())
    }

    fn choose_counter_type(
        &mut self,
        _player: PlayerId,
        options: &[forge_engine_core::card::CounterType],
        _prompt: &str,
    ) -> Option<forge_engine_core::card::CounterType> {
        if options.is_empty() {
            return None;
        }
        let idx = choice_space::pick_index(options.len(), &mut self.rng.borrow_mut());
        Some(options[idx].clone())
    }

    fn choose_number(&mut self, _player: PlayerId, min: i32, max: i32) -> Option<i32> {
        Some(gui_repro::choose_number(
            min,
            max,
            &mut self.rng.borrow_mut(),
        ))
    }

    fn choose_number_for_keyword_cost(
        &mut self,
        _player: PlayerId,
        max: i32,
        _prompt: &str,
        _source: Option<CardId>,
    ) -> i32 {
        gui_repro::choose_number(0, max, &mut self.rng.borrow_mut())
    }

    fn choose_x_value(&mut self, _player: PlayerId, max_x: u32, _source: Option<CardId>) -> u32 {
        max_x
    }

    fn announce_requirements(
        &mut self,
        _player: PlayerId,
        _announce: &str,
        min: i32,
        max: i32,
        _source: Option<CardId>,
    ) -> Option<i32> {
        Some(gui_repro::pick_int_in_range(
            min,
            max,
            &mut self.rng.borrow_mut(),
        ))
    }

    /// Always pay life for phyrexian mana — matches Java's
    /// ComputerUtilMana.payManaCost() which auto-pays phyrexian
    /// shards with life when no colored mana source is available.
    fn choose_phyrexian_pay_life(
        &mut self,
        _player: PlayerId,
        _color: &str,
        _source: Option<CardId>,
    ) -> bool {
        true
    }

    fn choose_cards_for_effect(
        &mut self,
        _player: PlayerId,
        valid: &[CardId],
        min: usize,
        max: usize,
    ) -> Vec<CardId> {
        if valid.is_empty() {
            return vec![];
        }
        // Sort valid cards by (card_name, parity_id) for deterministic cross-engine parity.
        let sorted = choice_space::sort_native(valid, |a, b| {
            self.card_name(*a)
                .cmp(&self.card_name(*b))
                .then_with(|| self.parity_map.id(*a).cmp(&self.parity_map.id(*b)))
        });
        gui_repro::pick_many_unique(&sorted, min, max, &mut self.rng.borrow_mut())
    }

    fn choose_tap_type_for_cost(
        &mut self,
        _player: PlayerId,
        valid: &[CardId],
        min_total_power: i32,
        card_powers: &[(CardId, i32)],
        card_sort_powers: &[(CardId, i32)],
        _sa: Option<&forge_engine_core::spellability::SpellAbility>,
    ) -> Vec<CardId> {
        let mut candidates: Vec<(usize, CardId, i32, i32)> = valid
            .iter()
            .enumerate()
            .map(|(idx, &cid)| {
                let power = card_powers
                    .iter()
                    .find(|(card_id, _)| *card_id == cid)
                    .map(|(_, power)| *power)
                    .unwrap_or(0);
                let sort_power = card_sort_powers
                    .iter()
                    .find(|(card_id, _)| *card_id == cid)
                    .map(|(_, power)| *power)
                    .unwrap_or(power);
                (idx, cid, power, sort_power)
            })
            .collect();
        candidates.sort_by(|a, b| b.3.cmp(&a.3).then_with(|| a.0.cmp(&b.0)));

        let mut chosen = Vec::new();
        let mut total = 0;
        for (_, cid, power, _) in candidates {
            chosen.push(cid);
            total += power;
            if total >= min_total_power {
                break;
            }
        }
        chosen
    }

    fn choose_entities_for_effect(
        &mut self,
        _player: PlayerId,
        candidates: &[GameEntity],
        min: usize,
        max: usize,
    ) -> Vec<GameEntity> {
        if candidates.is_empty() {
            return vec![];
        }
        // Sort entities canonically: players first (by id), cards second (by name + parity_id).
        let mut sorted = candidates.to_vec();
        sorted.sort_by(|a, b| {
            let key = |e: &GameEntity| -> (u8, String, u32) {
                match e {
                    GameEntity::Player(pid) => (0, format!("P{}", pid.0), 0),
                    GameEntity::Card(cid) => (1, self.card_name(*cid), self.parity_map.id(*cid)),
                }
            };
            key(a).cmp(&key(b))
        });
        gui_repro::pick_many_unique(&sorted, min, max, &mut self.rng.borrow_mut())
    }

    fn choose_single_card_for_zone_change(
        &mut self,
        _game: &GameState,
        player: PlayerId,
        valid: &[CardId],
        _select_prompt: &str,
        _is_optional: bool,
    ) -> Option<CardId> {
        if valid.is_empty() {
            return None;
        }
        // Parity: Java DeterministicController calls ChoiceSpace.pickOne (single RNG draw).
        // Must NOT go through pick_many_unique (pick_count + pick_index) which consumes
        // multiple RNG values and desyncs subsequent picks.
        let sorted = choice_space::sort_native(valid, |a, b| {
            self.card_name(*a)
                .cmp(&self.card_name(*b))
                .then_with(|| self.parity_map.id(*a).cmp(&self.parity_map.id(*b)))
        });
        let _ = player;
        choice_space::pick_one(&sorted, &mut self.rng.borrow_mut())
    }

    fn choose_cards_for_zone_change(
        &mut self,
        _game: &GameState,
        player: PlayerId,
        valid: &[CardId],
        min: usize,
        max: usize,
        _select_prompt: &str,
    ) -> Vec<CardId> {
        let sorted = choice_space::sort_native(valid, |a, b| {
            self.card_name(*a)
                .cmp(&self.card_name(*b))
                .then_with(|| self.parity_map.id(*a).cmp(&self.parity_map.id(*b)))
        });
        self.choose_cards_for_effect(player, &sorted, min, max)
    }

    fn choose_mode(
        &mut self,
        _player: PlayerId,
        descriptions: &[String],
        min: usize,
        max: usize,
        _source_card_id: Option<CardId>,
    ) -> Vec<usize> {
        if descriptions.is_empty() {
            return vec![];
        }
        let mut rng = self.rng.borrow_mut();
        let count = gui_repro::pick_count(min, max, descriptions.len(), &mut rng);
        let mut pool: Vec<usize> = (0..descriptions.len()).collect();
        let mut out = Vec::with_capacity(count);
        for _ in 0..count {
            if pool.is_empty() {
                break;
            }
            let idx = choice_space::pick_index(pool.len(), &mut rng);
            out.push(pool.remove(idx));
        }
        out
    }

    fn choose_spell_abilities_for_effect(
        &mut self,
        _player: PlayerId,
        abilities: &[SpellAbility],
        num: usize,
    ) -> Vec<usize> {
        if abilities.is_empty() || num == 0 {
            return vec![];
        }
        let count = num.min(abilities.len());
        let mut pool: Vec<usize> = (0..abilities.len()).collect();
        let mut out = Vec::with_capacity(count);
        let mut rng = self.rng.borrow_mut();
        for _ in 0..count {
            if pool.is_empty() {
                break;
            }
            let idx = choice_space::pick_index(pool.len(), &mut rng);
            out.push(pool.remove(idx));
        }
        out
    }

    fn choose_single_entity_for_effect(
        &mut self,
        _player: PlayerId,
        valid: &[GameEntity],
        _is_optional: bool,
    ) -> Option<GameEntity> {
        if valid.is_empty() {
            return None;
        }
        // Sort to match Java's deterministic ordering for the harness picker:
        // players first (by player_id), then cards by (name, parity_id).
        // Mirrors how `chooseSingleEntityForEffect` iterates a Java
        // `FCollectionView` whose insertion order Java's harness preserves.
        let sorted = choice_space::sort_native(valid, |a, b| {
            let key = |entity: &GameEntity| -> (u8, String, u32) {
                match entity {
                    GameEntity::Player(p) => (0, format!("P{}", p.0), 0),
                    GameEntity::Card(c) => (1, self.card_name(*c), self.parity_map.id(*c)),
                }
            };
            key(a).cmp(&key(b))
        });
        choice_space::pick_one(&sorted, &mut self.rng.borrow_mut())
    }

    fn get_ability_to_play(
        &mut self,
        _player: PlayerId,
        abilities: &[SpellAbility],
    ) -> Option<usize> {
        if abilities.is_empty() {
            return None;
        }
        let idx = choice_space::pick_index(abilities.len(), &mut self.rng.borrow_mut());
        Some(idx)
    }

    fn choose_scry(
        &mut self,
        _game: &GameState,
        _player: PlayerId,
        cards: &[CardId],
    ) -> Vec<CardId> {
        let mut out = Vec::new();
        let mut rng = self.rng.borrow_mut();
        for &cid in cards {
            if gui_repro::pick_bool(&mut rng) {
                out.push(cid);
            }
        }
        out
    }

    fn choose_surveil(
        &mut self,
        _game: &GameState,
        _player: PlayerId,
        cards: &[CardId],
    ) -> Vec<CardId> {
        let mut out = Vec::new();
        let mut rng = self.rng.borrow_mut();
        for &cid in cards {
            if gui_repro::pick_bool(&mut rng) {
                out.push(cid);
            }
        }
        out
    }

    fn choose_reorder_library(
        &mut self,
        _game: &GameState,
        _player: PlayerId,
        cards: &[CardId],
    ) -> Vec<CardId> {
        // Java's DeterministicController.orderMoveToZoneList returns cards as-is
        // (no RNG consumed), so we must do the same to stay in sync.
        cards.to_vec()
    }

    fn notify(&mut self, event: forge_engine_core::agent::notification::GameNotification) {
        use forge_engine_core::agent::notification::GameNotification;
        match &event {
            GameNotification::Event(log_event) => {
                if self.log.len() >= 500 {
                    self.log.remove(0);
                }
                self.log.push(log_event.message.clone());
                if self.is_verbose() {
                    eprintln!(
                        "[parity-agent-rust p{}] notify: {}",
                        self.player_id.0, log_event.message
                    );
                }
            }
            GameNotification::TurnChanged {
                active_player,
                turn_number,
            } => {
                self.current_turn = *turn_number;
                if self.is_verbose() {
                    eprintln!(
                        "[parity-agent-rust p{}] === Turn {} (P{} active) ===",
                        self.player_id.0, turn_number, active_player.0
                    );
                }
            }
            GameNotification::PhaseChanged { phase } => {
                if self.is_verbose() {
                    eprintln!(
                        "[parity-agent-rust p{}] --- Phase: {:?} ---",
                        self.player_id.0, phase
                    );
                }
            }
            _ => {}
        }
    }

    fn choose_single_replacement_effect(
        &mut self,
        _player: PlayerId,
        descriptions: &[String],
    ) -> usize {
        let sorted = parity_order::sort_replacement_descriptions_with_indices(descriptions);
        if sorted.is_empty() {
            return 0;
        }
        let picked = choice_space::pick_index(sorted.len(), &mut self.rng.borrow_mut());
        sorted[picked].0
    }

    fn reveal_cards(
        &mut self,
        _game: &GameState,
        _player: PlayerId,
        _cards: &[CardId],
        _zone: forge_foundation::ZoneType,
        _owner: PlayerId,
        _message_prefix: Option<&str>,
    ) {
    }
}
