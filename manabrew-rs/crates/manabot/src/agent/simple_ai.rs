use std::collections::{HashMap, HashSet, VecDeque};

use manabrew_agent_interface::game_view_dto::{
    CardDto, CardView, GameViewDto, StepKind, TargetingIntent, ZoneKind,
};
use manabrew_agent_interface::prompt::*;

use super::BotAgent;

mod roles;
use roles::Roles;

/// How many recent prompts to remember when detecting a stuck loop.
const LOOP_WINDOW: usize = 6;

fn bot_warn(msg: &str) {
    #[cfg(target_arch = "wasm32")]
    if web_sys::window()
        .and_then(|window| window.local_storage().ok().flatten())
        .and_then(|storage| storage.get_item("manabrew.debugPrompts").ok().flatten())
        .as_deref()
        == Some("1")
    {
        web_sys::console::warn_1(&format!("[wasm-bot] {msg}").into());
    }
    #[cfg(not(target_arch = "wasm32"))]
    tracing::debug!(target: "wasm-bot", "{msg}");
}

/// Baseline AI: casts spells when possible, otherwise passes priority, with a
/// memoized anti-loop heuristic so a stuck `ChooseAction` doesn't repeat the
/// same non-pass choice indefinitely.
#[derive(Default)]
pub struct SimpleAi {
    recent_prompts: VecDeque<String>,
    last_attack_declaration: Vec<(String, String)>,
    failed_attack_targets: HashSet<String>,
    view: Option<GameViewDto>,
    pending_view: Option<String>,
    card_locations: HashMap<String, (usize, usize)>,
    turn: Option<u32>,
    attempted_actions: HashSet<String>,
    payment_attempt: Option<String>,
    has_command_cards: bool,
}

struct Combatant {
    id: String,
    power: i32,
    lethal: i32,
    value: i32,
    deathtouch: bool,
    first_strike: bool,
    double_strike: bool,
    indestructible: bool,
    trample: bool,
}

impl SimpleAi {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn observe_lazy(&mut self, view_json: String) {
        self.pending_view = Some(view_json);
    }

    fn ensure_view(&mut self) {
        if let Some(json) = self.pending_view.take() {
            match serde_json::from_str::<GameViewDto>(&json) {
                Ok(view) => self.observe(view),
                Err(error) => bot_warn(&format!("invalid game view: {error}")),
            }
        }
    }

    fn needs_view(prompt: &PromptInput) -> bool {
        match prompt {
            PromptInput::ChooseAction(input) => input.actions.iter().any(|action| {
                !matches!(
                    &action.kind,
                    AvailableActionKind::UndoMana { .. }
                        | AvailableActionKind::ActivateAbility(ActivatableAbilityInfo {
                            is_mana_ability: true,
                            ..
                        })
                )
            }),
            PromptInput::PayManaCost(_)
            | PromptInput::RevealCards(_)
            | PromptInput::DiceRolled(_)
            | PromptInput::Reorder(_)
            | PromptInput::GameOver(_) => false,
            _ => true,
        }
    }

    /// Detects infinite response loops from the bot
    /// to avoid getting it stuck
    fn looping_on(&mut self, signature: String) -> bool {
        let seen = self.recent_prompts.contains(&signature);
        if seen {
            bot_warn(&format!(
                "loop-breaker engaged on repeated prompt: {signature}"
            ));
        }
        self.remember(signature);
        seen
    }

    fn looping_on_consecutive(&mut self, signature: String) -> bool {
        let consecutive = self.recent_prompts.back() == Some(&signature);
        if consecutive {
            bot_warn(&format!(
                "loop-breaker engaged on consecutive prompt: {signature}"
            ));
        }
        self.remember(signature);
        consecutive
    }

    fn remember(&mut self, signature: String) {
        self.recent_prompts.push_back(signature);
        while self.recent_prompts.len() > LOOP_WINDOW {
            self.recent_prompts.pop_front();
        }
    }

    fn fail_attack_target(&mut self, card_id: &str) {
        if let Some((_, target_id)) = self
            .last_attack_declaration
            .iter()
            .find(|(a, _)| a == card_id)
        {
            self.failed_attack_targets.insert(target_id.clone());
        }
    }

    fn card_zone(&self, id: &str) -> Option<ZoneKind> {
        let (zone_index, _) = *self.card_locations.get(id)?;
        self.view
            .as_ref()?
            .zones
            .get(zone_index)
            .map(|zone| zone.zone)
    }

    fn card(&self, id: &str) -> Option<&CardDto> {
        let (zone_index, card_index) = *self.card_locations.get(id)?;
        match self
            .view
            .as_ref()?
            .zones
            .get(zone_index)?
            .cards
            .get(card_index)?
        {
            CardView::Visible(card) => Some(card),
            CardView::Hidden { .. } => None,
        }
    }

    fn card_value(card: &CardDto) -> i32 {
        let power = card
            .power
            .as_deref()
            .and_then(|value| value.parse::<i32>().ok())
            .unwrap_or(0);
        let toughness = card
            .toughness
            .as_deref()
            .and_then(|value| value.parse::<i32>().ok())
            .unwrap_or(0);
        let keyword_value = card
            .keywords
            .iter()
            .map(|keyword| match keyword.to_ascii_lowercase().as_str() {
                "flying" => power * 2,
                "double strike" => power * 3,
                "first strike" | "lifelink" | "trample" => power,
                "deathtouch" => 4,
                "hexproof" | "indestructible" => 3,
                "vigilance" | "menace" => 2,
                _ => 0,
            })
            .sum::<i32>();
        power * 3 + toughness * 2 + card.cmc + keyword_value
    }

    fn action_key(action: &AvailableAction) -> String {
        match &action.kind {
            AvailableActionKind::Cast { card_id, mode, .. } => format!("cast:{card_id}:{mode:?}"),
            AvailableActionKind::ActivateAbility(info) => {
                format!("ability:{}:{}", info.card_id, info.description)
            }
            AvailableActionKind::UndoMana { card_id } => format!("undo:{card_id}"),
        }
    }

    fn prefers_creatures(&self, player_id: &str) -> bool {
        self.view.as_ref().is_some_and(|view| {
            view.zones
                .iter()
                .filter(|zone| matches!(zone.zone, ZoneKind::Command | ZoneKind::Battlefield))
                .flat_map(|zone| &zone.cards)
                .any(|card| {
                    matches!(
                        card,
                        CardView::Visible(card)
                            if card.owner_id == player_id
                                && card.text.to_ascii_lowercase().contains("creature spells")
                    )
                })
        })
    }

    fn land_colors(card: &CardDto) -> HashSet<char> {
        let mut colors = HashSet::new();
        for subtype in &card.subtypes {
            match subtype.as_str() {
                "Plains" => colors.insert('W'),
                "Island" => colors.insert('U'),
                "Swamp" => colors.insert('B'),
                "Mountain" => colors.insert('R'),
                "Forest" => colors.insert('G'),
                _ => false,
            };
        }
        for segment in card.text.split("Add ").skip(1) {
            for symbol in segment.split(['.', '\n']).next().unwrap_or("").chars() {
                if "WUBRG".contains(symbol) {
                    colors.insert(symbol);
                }
            }
        }
        colors
    }

    fn missing_colors(&self, player_id: &str) -> HashSet<char> {
        let have = self
            .battlefield(player_id)
            .filter(|card| card.types.iter().any(|ty| ty == "Land"))
            .flat_map(Self::land_colors)
            .collect::<HashSet<_>>();
        self.view
            .iter()
            .flat_map(|view| &view.zones)
            .filter(|zone| {
                matches!(zone.zone, ZoneKind::Hand | ZoneKind::Command)
                    && zone.owner_id == player_id
            })
            .flat_map(|zone| &zone.cards)
            .filter_map(|card| match card {
                CardView::Visible(card) => Some(card),
                CardView::Hidden { .. } => None,
            })
            .flat_map(|card| card.mana_cost.chars().filter(|c| "WUBRG".contains(*c)))
            .filter(|color| !have.contains(color))
            .collect()
    }

    fn is_land_play(&self, action: &AvailableAction) -> bool {
        match &action.kind {
            AvailableActionKind::Cast { card_id, label, .. } => {
                label.starts_with("Play ")
                    || self
                        .card(card_id)
                        .is_some_and(|card| card.types.iter().any(|ty| ty == "Land"))
            }
            _ => false,
        }
    }

    fn opponent_creatures(&self, player_id: &str) -> Vec<&CardDto> {
        self.view
            .iter()
            .flat_map(|view| &view.zones)
            .filter(|zone| zone.zone == ZoneKind::Battlefield && zone.owner_id != player_id)
            .flat_map(|zone| &zone.cards)
            .filter_map(|card| match card {
                CardView::Visible(card) if card.types.iter().any(|ty| ty == "Creature") => {
                    Some(card)
                }
                _ => None,
            })
            .collect()
    }

    fn mana_output(card: &CardDto) -> Option<([i32; 5], i32, i32)> {
        let mut colors = [0i32; 5];
        let mut any = 0;
        let mut amount = 0;
        for subtype in &card.subtypes {
            if let Some(i) = ["Plains", "Island", "Swamp", "Mountain", "Forest"]
                .iter()
                .position(|basic| basic == subtype)
            {
                colors[i] += 1;
                amount = amount.max(1);
            }
        }
        for segment in card.text.split("Add ").skip(1) {
            let clause = segment.split(['.', '\n']).next().unwrap_or("");
            let lower = clause.to_ascii_lowercase();
            let symbols = clause.matches('{').count() as i32;
            let mut produced = 0;
            for symbol in clause.chars() {
                if let Some(i) = "WUBRG".find(symbol) {
                    colors[i] += 1;
                    produced = produced.max(1);
                }
            }
            if lower.contains("any color")
                || lower.contains("any type")
                || lower.contains("any one color")
            {
                let count = if lower.starts_with("two") {
                    2
                } else if lower.starts_with("three") {
                    3
                } else {
                    1
                };
                any += count;
                produced = produced.max(count);
            }
            amount = amount.max(produced.max(symbols));
        }
        (amount > 0).then_some((colors, any, amount))
    }

    fn mana_sources(&self, player_id: &str) -> ([i32; 5], i32, i32) {
        let mut colors = [0i32; 5];
        let mut any = 0;
        let mut total = 0;
        for card in self.battlefield(player_id).filter(|card| !card.tapped) {
            let creature = card.types.iter().any(|ty| ty == "Creature");
            if creature && (card.summoning_sick || !card.text.contains("{T}: Add")) {
                continue;
            }
            if let Some((produced, wild, amount)) = Self::mana_output(card) {
                total += amount;
                any += wild;
                for i in 0..5 {
                    colors[i] += produced[i];
                }
            }
        }
        (colors, any, total)
    }

    fn affordable(&self, card: &CardDto, player_id: &str) -> bool {
        let cost = card
            .effective_mana_cost
            .as_deref()
            .unwrap_or(card.mana_cost.as_str());
        if cost.contains('X') || cost.contains('/') || cost.is_empty() {
            return true;
        }
        let (colors, any, total) = self.mana_sources(player_id);
        let tax = card.commander_tax.unwrap_or(0);
        if card.cmc + tax > total {
            return false;
        }
        let mut pips = [0i32; 5];
        for symbol in cost.chars() {
            if let Some(i) = "WUBRG".find(symbol) {
                pips[i] += 1;
            }
        }
        let short: i32 = (0..5).map(|i| (pips[i] - colors[i]).max(0)).sum();
        short <= any
    }

    fn roles(card: &CardDto) -> Roles {
        roles::lookup(&card.identity.name)
    }

    fn opponent_permanents(&self, player_id: &str) -> usize {
        self.view
            .iter()
            .flat_map(|view| &view.zones)
            .filter(|zone| zone.zone == ZoneKind::Battlefield && zone.owner_id != player_id)
            .flat_map(|zone| &zone.cards)
            .filter(|card| match card {
                CardView::Visible(card) => !card.types.iter().any(|ty| ty == "Land"),
                CardView::Hidden { .. } => false,
            })
            .count()
    }

    fn sane(&self, action: &AvailableAction, player_id: &str) -> bool {
        let AvailableActionKind::Cast { card_id, .. } = &action.kind else {
            return true;
        };
        if self.is_land_play(action) {
            return true;
        }
        let Some(card) = self.card(card_id) else {
            return true;
        };
        if !self.affordable(card, player_id) {
            return false;
        }
        let Some(view) = self.view.as_ref() else {
            return true;
        };
        let text = card.text.to_ascii_lowercase();
        let own_turn = view.active_player_id == player_id;
        let stack_empty = view.stack.is_empty();
        let foreign_stack = view
            .stack
            .iter()
            .any(|item| item.controller_id != player_id);
        let opponents = self.opponent_creatures(player_id);
        let roles = Self::roles(card);
        let creature_removal = text.contains("destroy target creature")
            || text.contains("exile target creature")
            || (text.contains("damage to target creature") && !text.contains("player"));
        if creature_removal && opponents.is_empty() {
            return false;
        }
        if roles.contains(Roles::REMOVAL)
            && !roles.contains(Roles::BURN)
            && self.opponent_permanents(player_id) == 0
        {
            return false;
        }
        if (roles.contains(Roles::COUNTERSPELL) || text.starts_with("counter target"))
            && !foreign_stack
        {
            return false;
        }
        if roles.contains(Roles::COMBAT_PUMP)
            && stack_empty
            && !card.types.iter().any(|ty| ty == "Creature")
            && !matches!(
                view.step,
                StepKind::CombatDeclareAttackers
                    | StepKind::CombatDeclareBlockers
                    | StepKind::CombatFirstStrikeDamage
            )
        {
            return false;
        }
        let wipe = roles.contains(Roles::SWEEPER)
            || text.contains("destroy all creatures")
            || text.contains("exile all creatures")
            || text.contains("each creature")
                && (text.contains("destroy") || text.contains("-x/-x"));
        if wipe {
            let mine: i32 = self
                .battlefield(player_id)
                .filter(|c| c.types.iter().any(|ty| ty == "Creature"))
                .map(Self::card_value)
                .sum();
            let theirs: i32 = opponents.iter().map(|c| Self::card_value(c)).sum();
            if mine >= theirs {
                return false;
            }
        }
        let instant = card.types.iter().any(|ty| ty == "Instant")
            || (card
                .keywords
                .iter()
                .any(|k| k.eq_ignore_ascii_case("flash"))
                && !card.types.iter().any(|ty| ty == "Creature"));
        if instant && stack_empty {
            let step = view.step;
            let quiet_own = own_turn && matches!(step, StepKind::Upkeep | StepKind::Draw);
            let quiet_theirs = !own_turn
                && matches!(
                    step,
                    StepKind::Untap
                        | StepKind::Upkeep
                        | StepKind::Draw
                        | StepKind::Main1
                        | StepKind::Main2
                        | StepKind::CombatBegin
                );
            if quiet_own || quiet_theirs {
                return false;
            }
        }
        true
    }

    fn land_choice_score(&self, card: &CardDto, player_id: &str, alternatives: &[&CardDto]) -> i32 {
        let mut supply = [0i32; 5];
        let lands = self.lands_in_play(player_id) as i32;
        for land in self
            .battlefield(player_id)
            .filter(|c| c.types.iter().any(|ty| ty == "Land"))
        {
            for color in Self::land_colors(land) {
                if let Some(i) = "WUBRG".find(color) {
                    supply[i] += 1;
                }
            }
        }
        let mut demand = [0i32; 5];
        for hand_card in self
            .view
            .iter()
            .flat_map(|view| &view.zones)
            .filter(|zone| {
                matches!(zone.zone, ZoneKind::Hand | ZoneKind::Command)
                    && zone.owner_id == player_id
            })
            .flat_map(|zone| &zone.cards)
            .filter_map(|card| match card {
                CardView::Visible(card) => Some(card),
                CardView::Hidden { .. } => None,
            })
            .filter(|c| !c.types.iter().any(|ty| ty == "Land") && c.cmc <= lands + 1)
        {
            let mut pips = [0i32; 5];
            for symbol in hand_card.mana_cost.chars() {
                if let Some(i) = "WUBRG".find(symbol) {
                    pips[i] += 1;
                }
            }
            for i in 0..5 {
                demand[i] = demand[i].max(pips[i]);
            }
        }
        let fixes = Self::land_colors(card)
            .into_iter()
            .filter_map(|color| "WUBRG".find(color))
            .filter(|&i| demand[i] > supply[i])
            .count()
            .min(2) as i32;
        let enters_tapped = card.text.contains("enters tapped");
        let untapped_alternative = alternatives
            .iter()
            .any(|other| other.id != card.id && !other.text.contains("enters tapped"));
        fixes * 20 - i32::from(enters_tapped && untapped_alternative) * 5
    }

    fn action_score(&self, action: &AvailableAction, player_id: &str) -> i32 {
        match &action.kind {
            AvailableActionKind::Cast { card_id, label, .. } => {
                let Some(card) = self.card(card_id) else {
                    return if label.starts_with("Play ") { 900 } else { 300 };
                };
                if label.starts_with("Play ")
                    || card.types.iter().any(|card_type| card_type == "Land")
                {
                    return 1_000 + self.land_choice_score(card, player_id, &[]);
                }
                let own_turn = self
                    .view
                    .as_ref()
                    .is_some_and(|view| view.active_player_id == player_id);
                let main_phase = self
                    .view
                    .as_ref()
                    .is_some_and(|view| matches!(view.step, StepKind::Main1 | StepKind::Main2));
                let permanent = card.types.iter().any(|card_type| {
                    matches!(
                        card_type.as_str(),
                        "Creature" | "Artifact" | "Enchantment" | "Planeswalker" | "Battle"
                    )
                });
                let instant = card.types.iter().any(|card_type| card_type == "Instant");
                let mut score = if own_turn && main_phase {
                    if permanent {
                        500
                    } else {
                        420
                    }
                } else if instant {
                    430
                } else {
                    250
                };
                score += Self::card_value(card) - card.cmc * 8;
                if self.card_zone(card_id) == Some(ZoneKind::Command) {
                    score += 160;
                }
                if self.prefers_creatures(player_id)
                    && card.types.iter().any(|card_type| card_type == "Creature")
                {
                    score += (120 - card.cmc * 12).max(0);
                }
                let text = card.text.to_ascii_lowercase();
                let roles = Self::roles(card);
                let ramp = Self::is_mana_source(card)
                    || roles.intersects(Roles::RAMP | Roles::MANA_DORK | Roles::LAND_FETCH)
                    || (text.contains("search your library for") && text.contains("land card"));
                if ramp && self.lands_in_play(player_id) < 6 {
                    score += 60;
                }
                if roles.contains(Roles::DRAW)
                    || text.contains("draw a card")
                    || text.contains("draw two")
                {
                    score += 35;
                }
                if roles.contains(Roles::REMOVAL) {
                    score += 30;
                }
                if roles.contains(Roles::TOKENS) {
                    score += 20;
                }
                if text.contains("whenever you cast")
                    && text.contains("creature spell")
                    && text.contains("draw")
                {
                    score += 180;
                }
                if text.contains("destroy target") || text.contains("exile target") {
                    score += 30;
                }
                if text.contains("create a") || text.contains("search your library") {
                    score += 20;
                }
                score
            }
            AvailableActionKind::ActivateAbility(info) if !info.is_mana_ability => {
                let text = info.description.to_ascii_lowercase();
                if text.contains("search your library") {
                    240
                } else if text.contains("draw") || text.contains("create") {
                    210
                } else if text.contains("destroy") || text.contains("exile") {
                    200
                } else if text.contains("sacrifice") || text.contains("pay ") {
                    80
                } else {
                    120
                }
            }
            _ => 0,
        }
    }

    fn wasted_activation(&self, info: &ActivatableAbilityInfo) -> bool {
        let text = info.description.to_ascii_lowercase();
        if info
            .cost
            .as_deref()
            .is_some_and(|cost| cost.to_ascii_lowercase().contains("sac"))
            || text.contains("any player may activate")
            || (text.contains(" loses ") && !text.contains("life"))
        {
            return true;
        }
        let main_phase = self
            .view
            .as_ref()
            .is_some_and(|view| matches!(view.step, StepKind::Main1 | StepKind::Main2));
        main_phase
            && text.contains("until end of turn")
            && (text.contains("gets +") || text.contains("get +") || text.contains("gains "))
    }

    fn has_keyword(card: &CardDto, keyword: &str) -> bool {
        card.keywords
            .iter()
            .any(|value| value.eq_ignore_ascii_case(keyword))
    }

    fn is_constructed_duel(&self) -> bool {
        !self.has_command_cards
            && self
                .view
                .as_ref()
                .is_some_and(|view| view.players.len() == 2)
    }

    fn blockers_to_keep(&self, player_id: &str, attackers: &[String]) -> HashSet<String> {
        let mut keep = HashSet::new();
        let Some(view) = &self.view else {
            return keep;
        };
        let life = view
            .players
            .iter()
            .find(|player| player.id == player_id)
            .map_or(20, |player| player.life);
        let mut threats = view
            .players
            .iter()
            .filter(|player| player.id != player_id)
            .map(|player| {
                let mut powers = view
                    .zones
                    .iter()
                    .filter(|zone| zone.zone == ZoneKind::Battlefield && zone.owner_id == player.id)
                    .flat_map(|zone| &zone.cards)
                    .filter_map(|card| match card {
                        CardView::Visible(card) if card.types.iter().any(|ty| ty == "Creature") => {
                            Some(Self::stat(card.power.as_deref()).max(0))
                        }
                        _ => None,
                    })
                    .collect::<Vec<_>>();
                powers.sort_unstable_by(|left, right| right.cmp(left));
                powers
            })
            .max_by_key(|powers| powers.iter().sum::<i32>())
            .unwrap_or_default();
        let mut incoming = threats.iter().sum::<i32>();
        if !Self::life_in_danger(life, incoming, false) {
            return keep;
        }
        let mut candidates = attackers
            .iter()
            .filter_map(|id| self.combatant(id))
            .filter(|creature| {
                !self
                    .card(&creature.id)
                    .is_some_and(|card| Self::has_keyword(card, "Vigilance"))
            })
            .collect::<Vec<_>>();
        candidates.sort_by_key(|creature| std::cmp::Reverse((creature.lethal, creature.power)));
        for creature in candidates {
            if !Self::life_in_danger(life, incoming, false) {
                break;
            }
            if threats.is_empty() {
                break;
            }
            incoming -= threats.remove(0);
            keep.insert(creature.id);
        }
        keep
    }

    fn battlefield<'a>(&'a self, player_id: &'a str) -> impl Iterator<Item = &'a CardDto> + 'a {
        self.view
            .iter()
            .flat_map(|view| &view.zones)
            .filter(move |zone| zone.zone == ZoneKind::Battlefield && zone.owner_id == player_id)
            .flat_map(|zone| &zone.cards)
            .filter_map(|card| match card {
                CardView::Visible(card) => Some(card),
                CardView::Hidden { .. } => None,
            })
    }

    fn is_mana_source(card: &CardDto) -> bool {
        card.types.iter().any(|ty| ty == "Land")
            || (!card.types.iter().any(|ty| ty == "Creature")
                && card.text.to_ascii_lowercase().contains("{t}: add"))
    }

    fn available_mana(&self, player_id: &str) -> i32 {
        self.battlefield(player_id)
            .filter(|card| !card.tapped && Self::is_mana_source(card))
            .count() as i32
    }

    fn lands_in_play(&self, player_id: &str) -> usize {
        self.battlefield(player_id)
            .filter(|card| card.types.iter().any(|ty| ty == "Land"))
            .count()
    }

    fn should_attack(&self, attacker_id: &str, target_id: &str) -> bool {
        let (Some(attacker), Some(me)) = (self.card(attacker_id), self.combatant(attacker_id))
        else {
            return true;
        };
        if me.power <= 0 {
            return false;
        }
        let Some(view) = &self.view else {
            return true;
        };
        let flying = Self::has_keyword(attacker, "Flying");
        let menace = Self::has_keyword(attacker, "Menace");
        let blockers: Vec<Combatant> = view
            .zones
            .iter()
            .filter(|zone| zone.zone == ZoneKind::Battlefield && zone.owner_id == target_id)
            .flat_map(|zone| &zone.cards)
            .filter_map(|card| match card {
                CardView::Visible(card)
                    if card.types.iter().any(|card_type| card_type == "Creature")
                        && !card.tapped
                        && (!flying
                            || Self::has_keyword(card, "Flying")
                            || Self::has_keyword(card, "Reach")) =>
                {
                    self.combatant(&card.id)
                }
                _ => None,
            })
            .collect();
        let losing = |blocker: &Combatant| {
            Self::can_destroy(blocker, &me) && !Self::can_destroy(&me, blocker)
        };
        if menace {
            let killers = blockers.iter().filter(|b| losing(b)).count();
            return killers < 2;
        }
        !blockers.iter().any(losing)
    }

    fn stat(value: Option<&str>) -> i32 {
        value
            .and_then(|value| value.parse::<i32>().ok())
            .unwrap_or(0)
    }

    fn combatant(&self, id: &str) -> Option<Combatant> {
        let card = self.card(id)?;
        Some(Combatant {
            id: id.to_string(),
            power: Self::stat(card.power.as_deref()).max(0),
            lethal: (Self::stat(card.toughness.as_deref()) - card.damage).max(1),
            value: Self::card_value(card),
            deathtouch: Self::has_keyword(card, "Deathtouch"),
            first_strike: Self::has_keyword(card, "First strike")
                || Self::has_keyword(card, "Double strike"),
            double_strike: Self::has_keyword(card, "Double strike"),
            indestructible: Self::has_keyword(card, "Indestructible"),
            trample: Self::has_keyword(card, "Trample"),
        })
    }

    fn can_destroy(striker: &Combatant, target: &Combatant) -> bool {
        if target.indestructible || striker.power <= 0 {
            return false;
        }
        let damage = if striker.double_strike {
            striker.power * 2
        } else {
            striker.power
        };
        let kills = striker.deathtouch || damage >= target.lethal;
        let struck_first = target.first_strike
            && !striker.first_strike
            && (target.deathtouch || target.power >= striker.lethal);
        kills && !struck_first
    }

    fn life_in_danger(life: i32, unblocked: i32, serious: bool) -> bool {
        let threshold = if serious { 1 } else { 4.min(life) };
        life - unblocked < threshold
    }

    fn declare_blockers(
        &self,
        attackers: &[manabrew_protocol::prompts::choose_blockers::BlockableAttackerDto],
        available_blocker_ids: &[String],
        player_id: &str,
    ) -> Vec<BlockAssignment> {
        let life = self.view.as_ref().map_or(20, |view| {
            view.players
                .iter()
                .find(|player| player.id == player_id)
                .map_or(20, |player| player.life)
        });
        let mut attackers = attackers
            .iter()
            .filter_map(|attacker| {
                let combatant = self.combatant(&attacker.attacker_id)?;
                let at_me = self
                    .card(&attacker.attacker_id)
                    .is_some_and(|card| card.attacking_player_id.as_deref() == Some(player_id));
                Some((attacker, combatant, at_me))
            })
            .collect::<Vec<_>>();
        attackers.sort_by_key(|(_, combatant, _)| {
            std::cmp::Reverse((!combatant.trample, combatant.power, combatant.value))
        });
        let mut blockers = available_blocker_ids
            .iter()
            .filter_map(|id| self.combatant(id))
            .collect::<Vec<_>>();
        blockers.sort_by_key(|blocker| (blocker.power, blocker.value));

        let mut assignments: Vec<BlockAssignment> = Vec::new();
        let mut blocked: HashSet<String> = HashSet::new();
        let mut used: HashSet<String> = HashSet::new();
        let unblocked_damage = |blocked: &HashSet<String>| {
            attackers
                .iter()
                .filter(|(attacker, _, at_me)| *at_me && !blocked.contains(&attacker.attacker_id))
                .map(|(_, combatant, _)| combatant.power)
                .sum::<i32>()
        };
        let candidates =
            |attacker: &manabrew_protocol::prompts::choose_blockers::BlockableAttackerDto,
             used: &HashSet<String>| {
                blockers
                    .iter()
                    .filter(|blocker| {
                        !used.contains(&blocker.id)
                            && attacker.valid_blocker_ids.contains(&blocker.id)
                    })
                    .collect::<Vec<_>>()
            };
        let assign = |attacker_id: &str,
                      blocker: &Combatant,
                      assignments: &mut Vec<BlockAssignment>,
                      blocked: &mut HashSet<String>,
                      used: &mut HashSet<String>| {
            assignments.push(BlockAssignment {
                blocker_id: blocker.id.clone(),
                attacker_id: attacker_id.to_string(),
            });
            blocked.insert(attacker_id.to_string());
            used.insert(blocker.id.clone());
        };

        let good_blocks = |assignments: &mut Vec<BlockAssignment>,
                           blocked: &mut HashSet<String>,
                           used: &mut HashSet<String>| {
            for (attacker, combatant, _) in &attackers {
                if attacker.min_blockers > 1 || blocked.contains(&attacker.attacker_id) {
                    continue;
                }
                let options = candidates(attacker, used);
                let safe = options
                    .iter()
                    .filter(|blocker| !Self::can_destroy(combatant, blocker))
                    .copied()
                    .collect::<Vec<_>>();
                let pick = safe
                    .iter()
                    .find(|blocker| Self::can_destroy(blocker, combatant))
                    .or_else(|| safe.iter().find(|_| !combatant.trample))
                    .copied();
                if let Some(blocker) = pick {
                    assign(&attacker.attacker_id, blocker, assignments, blocked, used);
                }
            }
        };
        let gang_blocks = |assignments: &mut Vec<BlockAssignment>,
                           blocked: &mut HashSet<String>,
                           used: &mut HashSet<String>| {
            for (attacker, combatant, _) in &attackers {
                if blocked.contains(&attacker.attacker_id)
                    || attacker.max_blockers.is_some_and(|max| max < 2)
                {
                    continue;
                }
                let options = candidates(attacker, used);
                let pair = options.iter().enumerate().find_map(|(index, first)| {
                    options[index + 1..].iter().find_map(|second| {
                        let kills = first.power + second.power >= combatant.lethal
                            && !combatant.indestructible;
                        let loses = [first, second]
                            .into_iter()
                            .filter(|blocker| Self::can_destroy(combatant, blocker))
                            .map(|blocker| blocker.value)
                            .max()
                            .unwrap_or(0);
                        let both_die = combatant.power >= first.lethal + second.lethal
                            || (combatant.deathtouch && combatant.power >= 2);
                        (kills && !both_die && loses <= combatant.value).then_some((first, second))
                    })
                });
                if let Some((first, second)) = pair {
                    assign(&attacker.attacker_id, first, assignments, blocked, used);
                    assign(&attacker.attacker_id, second, assignments, blocked, used);
                }
            }
        };
        let trade_blocks = |danger: bool,
                            assignments: &mut Vec<BlockAssignment>,
                            blocked: &mut HashSet<String>,
                            used: &mut HashSet<String>| {
            for (attacker, combatant, _) in &attackers {
                if attacker.min_blockers > 1 || blocked.contains(&attacker.attacker_id) {
                    continue;
                }
                let pick = candidates(attacker, used).into_iter().find(|blocker| {
                    Self::can_destroy(blocker, combatant)
                        && (danger || blocker.value <= combatant.value)
                });
                if let Some(blocker) = pick {
                    assign(&attacker.attacker_id, blocker, assignments, blocked, used);
                }
            }
        };
        let chump_blocks = |serious: bool,
                            assignments: &mut Vec<BlockAssignment>,
                            blocked: &mut HashSet<String>,
                            used: &mut HashSet<String>| {
            for (attacker, _, at_me) in &attackers {
                if !at_me
                    || blocked.contains(&attacker.attacker_id)
                    || !Self::life_in_danger(life, unblocked_damage(blocked), serious)
                {
                    continue;
                }
                let need = attacker.min_blockers.max(1) as usize;
                let picks = candidates(attacker, used)
                    .into_iter()
                    .take(need)
                    .collect::<Vec<_>>();
                if picks.len() < need {
                    continue;
                }
                for blocker in picks {
                    assign(&attacker.attacker_id, blocker, assignments, blocked, used);
                }
            }
        };

        good_blocks(&mut assignments, &mut blocked, &mut used);
        gang_blocks(&mut assignments, &mut blocked, &mut used);
        let danger = Self::life_in_danger(life, unblocked_damage(&blocked), false);
        trade_blocks(danger, &mut assignments, &mut blocked, &mut used);
        if danger {
            chump_blocks(false, &mut assignments, &mut blocked, &mut used);
        }
        if Self::life_in_danger(life, unblocked_damage(&blocked), true) {
            assignments.clear();
            blocked.clear();
            used.clear();
            chump_blocks(true, &mut assignments, &mut blocked, &mut used);
            trade_blocks(true, &mut assignments, &mut blocked, &mut used);
            good_blocks(&mut assignments, &mut blocked, &mut used);
            gang_blocks(&mut assignments, &mut blocked, &mut used);
        }
        for (attacker, _, _) in &attackers {
            if !attacker.must_be_blocked || blocked.contains(&attacker.attacker_id) {
                continue;
            }
            let need = attacker.min_blockers.max(1) as usize;
            let picks = candidates(attacker, &used)
                .into_iter()
                .take(need)
                .collect::<Vec<_>>();
            if picks.len() == need {
                for blocker in picks {
                    assign(
                        &attacker.attacker_id,
                        blocker,
                        &mut assignments,
                        &mut blocked,
                        &mut used,
                    );
                }
            }
        }
        assignments
    }

    fn damage_amount(text: &str) -> Option<i32> {
        let lower = text.to_ascii_lowercase();
        let at = lower.find("deals ")?;
        let rest = &lower[at + "deals ".len()..];
        let number = rest.split(' ').next()?;
        if !rest.contains("damage") {
            return None;
        }
        number.parse().ok()
    }

    fn damage_target_score(&self, target: &TargetRef, player_id: &str, damage: i32) -> i32 {
        match target.kind {
            TargetKind::Player => {
                if target.id == player_id {
                    return -1_000;
                }
                let life = self
                    .view
                    .as_ref()
                    .and_then(|view| view.players.iter().find(|player| player.id == target.id))
                    .map_or(20, |player| player.life);
                if damage >= life {
                    10_000
                } else {
                    1_000 + self.attack_target_score(&target.id) / 8
                }
            }
            TargetKind::Card => {
                let Some(card) = self.card(&target.id) else {
                    return 0;
                };
                if card.controller_id == player_id {
                    return -Self::card_value(card);
                }
                let lethal = (Self::stat(card.toughness.as_deref()) - card.damage).max(1);
                if card.types.iter().any(|ty| ty == "Creature") && lethal > damage {
                    Self::card_value(card) / 4
                } else {
                    1_000 + Self::card_value(card) * 4
                }
            }
            TargetKind::Spell => 0,
        }
    }

    fn target_score(&self, target: &TargetRef, player_id: &str, prompt_hostile: bool) -> i32 {
        let hostile = prompt_hostile
            || matches!(
                target.intent,
                Some(
                    TargetingIntent::Damage
                        | TargetingIntent::Destroy
                        | TargetingIntent::Sacrifice
                        | TargetingIntent::Exile
                        | TargetingIntent::Bounce
                        | TargetingIntent::Mill
                        | TargetingIntent::Discard
                        | TargetingIntent::Counter
                        | TargetingIntent::Tap
                        | TargetingIntent::Debuff
                        | TargetingIntent::LoseLife
                        | TargetingIntent::GainControl
                        | TargetingIntent::Fight
                        | TargetingIntent::Hostile
                )
            );
        match target.kind {
            TargetKind::Player => {
                let value = self.attack_target_score(&target.id);
                let own = target.id == player_id;
                if hostile == own {
                    -value
                } else {
                    value + 1_000
                }
            }
            TargetKind::Card => {
                let Some(card) = self.card(&target.id) else {
                    return 0;
                };
                let value = Self::card_value(card);
                let own = card.controller_id == player_id;
                if hostile == own {
                    -value
                } else {
                    value + 1_000
                }
            }
            TargetKind::Spell => self
                .view
                .as_ref()
                .and_then(|view| view.stack.iter().find(|item| item.id == target.id))
                .map_or(0, |item| {
                    if item.controller_id == player_id {
                        -1_000
                    } else {
                        1_000
                    }
                }),
        }
    }

    fn attack_target_score(&self, id: &str) -> i32 {
        let Some(view) = &self.view else {
            return 0;
        };
        let Some(player) = view.players.iter().find(|player| player.id == id) else {
            return self.card(id).map_or(0, Self::card_value);
        };
        let life = player.life.max(0);
        let board = view
            .zones
            .iter()
            .filter(|zone| zone.zone == ZoneKind::Battlefield && zone.owner_id == id)
            .flat_map(|zone| &zone.cards)
            .filter_map(|card| match card {
                CardView::Visible(card) if card.types.iter().any(|ty| ty == "Creature") => {
                    Some(Self::card_value(card))
                }
                _ => None,
            })
            .sum::<i32>();
        let life_deficit = (20 - life).max(0);
        board * 2 + life_deficit * life_deficit
    }
}

impl BotAgent for SimpleAi {
    fn observe(&mut self, view: GameViewDto) {
        self.pending_view = None;
        self.has_command_cards |= view
            .zones
            .iter()
            .any(|zone| zone.zone == ZoneKind::Command && zone.count > 0);
        if self.turn != Some(view.turn) {
            self.turn = Some(view.turn);
            self.attempted_actions.clear();
            self.payment_attempt = None;
            self.recent_prompts.clear();
            self.failed_attack_targets.clear();
        }
        self.card_locations.clear();
        for (zone_index, zone) in view.zones.iter().enumerate() {
            for (card_index, card) in zone.cards.iter().enumerate() {
                if let CardView::Visible(card) = card {
                    self.card_locations
                        .insert(card.id.clone(), (zone_index, card_index));
                }
            }
        }
        self.view = Some(view);
    }

    fn decide(&mut self, prompt: AgentPrompt) -> Option<PromptOutput> {
        if Self::needs_view(&prompt.input) {
            self.ensure_view();
        }
        let deciding_player_id = prompt.deciding_player_id.clone();
        let prompt_source_id = prompt
            .source_card
            .as_ref()
            .map_or_else(|| "none".to_string(), |card| card.id.clone());
        let prompt_source_text = prompt
            .source_ability_text
            .as_deref()
            .unwrap_or_default()
            .to_ascii_lowercase();
        match prompt.input {
        PromptInput::Mulligan(manabrew_protocol::prompts::mulligan::MulliganInput {
                hand_card_ids,
                mulligan_count,
            }) => {
                let lands = hand_card_ids
                    .iter()
                    .filter_map(|card_id| self.card(card_id))
                    .filter(|card| card.types.iter().any(|card_type| card_type == "Land"))
                    .count();
                let keep = mulligan_count >= 2 || (2..=5).contains(&lands);
                Some(PromptOutput::Mulligan(MulliganOutput::MulliganDecision { keep }))
            }
            PromptInput::MulliganPutBack(manabrew_protocol::prompts::mulligan_put_back::MulliganPutBackInput {
                mut hand_card_ids,
                count,
                ..
            }) => {
                let lands = hand_card_ids
                    .iter()
                    .filter_map(|card_id| self.card(card_id))
                    .filter(|card| card.types.iter().any(|card_type| card_type == "Land"))
                    .count();
                hand_card_ids.sort_by_key(|card_id| {
                    let Some(card) = self.card(card_id) else {
                        return 0;
                    };
                    if lands > 3 && card.types.iter().any(|card_type| card_type == "Land") {
                        -1
                    } else {
                        Self::card_value(card)
                    }
                });
                Some(PromptOutput::MulliganPutBack(MulliganPutBackOutput::MulliganPutBackDecision {
                    card_ids: hand_card_ids.into_iter().take(count).collect(),
                }))
            }
            PromptInput::ChooseAction(manabrew_protocol::prompts::choose_action::ChooseActionInput { actions }) => {
                let pick = actions
                    .iter()
                    .filter(|action| {
                        !matches!(&action.kind, AvailableActionKind::UndoMana { .. })
                            && !matches!(
                                &action.kind,
                                AvailableActionKind::ActivateAbility(info) if info.is_mana_ability
                            )
                            && !self.attempted_actions.contains(&Self::action_key(action))
                            && !matches!(
                                &action.kind,
                                AvailableActionKind::ActivateAbility(info) if self.wasted_activation(info)
                            )
                            && self.sane(action, &deciding_player_id)
                    })
                    .max_by_key(|action| self.action_score(action, &deciding_player_id));
                let pick = pick.map(|action| {
                    (action.id.clone(), Self::action_key(action))
                });
                self.payment_attempt = None;
                if let Some((_, key)) = &pick {
                    self.attempted_actions.insert(key.clone());
                }
                Some(PromptOutput::ChooseAction(match pick {
                    Some((action_id, _)) => ChooseActionOutput::Act { action_id },
                    None => ChooseActionOutput::Pass {
                        until: Some(PassUntil {
                            player_id: deciding_player_id.clone(),
                            phase: manabrew_protocol::game::StepKind::Main1,
                            through_combat: false,
                        }),
                        exhaust_stack: true,
                    },
                }))
            }
            PromptInput::ChooseAttackers(manabrew_protocol::prompts::choose_attackers::ChooseAttackersInput {
                attackers,
                attack_targets,
                ..
            }) => {
                let default_target = attack_targets
                    .iter()
                    .max_by_key(|target| self.attack_target_score(&target.id))
                    .map(|target| target.id.clone())
                    .unwrap_or_else(|| "player-1".to_string());
                let attack_power = attackers
                    .iter()
                    .filter_map(|attacker| self.card(&attacker.attacker_id))
                    .filter_map(|card| card.power.as_deref())
                    .filter_map(|power| power.parse::<i32>().ok())
                    .sum::<i32>();
                let lethal_target = self.view.as_ref().is_some_and(|view| {
                    view.players
                        .iter()
                        .find(|player| player.id == default_target)
                        .is_some_and(|player| player.life > 0 && attack_power >= player.life)
                });
                let signature = format!(
                    "attack:{}|{}",
                    attackers
                        .iter()
                        .map(|a| format!("{}:{}", a.attacker_id, a.valid_target_ids.join("+")))
                        .collect::<Vec<_>>()
                        .join(","),
                    attack_targets
                        .iter()
                        .map(|t| t.id.as_str())
                        .collect::<Vec<_>>()
                        .join(",")
                );
                let reprompted = self.looping_on_consecutive(signature);
                let keep = if lethal_target {
                    HashSet::new()
                } else {
                    self.blockers_to_keep(
                        &deciding_player_id,
                        &attackers.iter().map(|a| a.attacker_id.clone()).collect::<Vec<_>>(),
                    )
                };
                let mut assignments = Vec::new();
                if !reprompted {
                    for a in &attackers {
                        if keep.contains(&a.attacker_id) && !a.must_attack {
                            continue;
                        }
                        let target_id = match a
                            .valid_target_ids
                            .iter()
                            .filter(|target| !self.failed_attack_targets.contains(*target))
                            .max_by_key(|target| self.attack_target_score(target))
                        {
                            Some(t) => t.clone(),
                            None if a.valid_target_ids.is_empty() => default_target.clone(),
                            None => continue,
                        };
                        if a.must_attack
                            || (lethal_target && target_id == default_target)
                            || self.should_attack(&a.attacker_id, &target_id)
                        {
                            assignments.push(AttackAssignment {
                                attacker_id: a.attacker_id.clone(),
                                target_id,
                            });
                        }
                    }
                }
                self.last_attack_declaration = assignments
                    .iter()
                    .map(|a| (a.attacker_id.clone(), a.target_id.clone()))
                    .collect();
                Some(PromptOutput::ChooseAttackers(ChooseAttackersOutput::DeclareAttackers {
                    assignments,
                }))
            }
            PromptInput::ChooseBlockers(manabrew_protocol::prompts::choose_blockers::ChooseBlockersInput {
                attackers,
                available_blocker_ids,
                ..
            }) => {
                let assignments =
                    self.declare_blockers(&attackers, &available_blocker_ids, &deciding_player_id);
                Some(PromptOutput::ChooseBlockers(ChooseBlockersOutput::DeclareBlockers { assignments }))
            }
            PromptInput::ChooseBoardTargets(manabrew_protocol::prompts::choose_board_targets::ChooseBoardTargetsInput {
                candidates, hostile, min_targets, max_targets, chosen_targets, ..
            }) => {
                let take = (max_targets - chosen_targets).max(min_targets - chosen_targets).max(0)
                    as usize;
                let damage = prompt
                    .source_ability_text
                    .as_deref()
                    .and_then(Self::damage_amount)
                    .or_else(|| prompt.source_card.as_ref().and_then(|card| Self::damage_amount(&card.text)));
                let mut candidates = candidates;
                candidates.sort_by_key(|target| {
                    std::cmp::Reverse(match damage {
                        Some(damage) if hostile => {
                            self.damage_target_score(target, &deciding_player_id, damage)
                        }
                        _ => self.target_score(target, &deciding_player_id, hostile),
                    })
                });
                Some(PromptOutput::ChooseBoardTargets(ChooseBoardTargetsOutput::BoardTargets {
                    chosen: candidates.into_iter().take(take).collect(),
                }))
            }
            PromptInput::Scry(manabrew_protocol::prompts::scry::ScryInput { cards, zones, .. }) => {
                let mut zone_card_ids = vec![Vec::new(); zones.len()];
                let away = zones.iter().position(|zone| {
                    matches!(
                        zone,
                        manabrew_protocol::prompts::scry::ScryDestination::LibraryBottom
                            | manabrew_protocol::prompts::scry::ScryDestination::Graveyard
                    )
                });
                let lands = self.lands_in_play(&deciding_player_id);
                for card in &cards {
                    let land = card.types.iter().any(|ty| ty == "Land");
                    let keep = if land { lands < 7 } else { card.cmc as usize <= lands + 2 };
                    let zone = if keep { 0 } else { away.unwrap_or(0) };
                    zone_card_ids[zone].push(card.id.clone());
                }
                Some(PromptOutput::Scry(ScryOutput::ScryDecision { zone_card_ids }))
            }
            PromptInput::RevealCards(manabrew_protocol::prompts::reveal::RevealCardsInput { .. }) => Some(PromptOutput::RevealCards(RevealCardsOutput::RevealCardsAcknowledged)),
            PromptInput::ChooseBoolean(manabrew_protocol::prompts::choose_boolean::ChooseBooleanInput {
                presentation,
                confirm_label,
                deny_label,
            }) => {
                let signature = format!(
                    "bool:{prompt_source_id}|{}|{confirm_label}|{deny_label}",
                    presentation.title
                );
                let repeated = self.looping_on(signature);
                let title = presentation.title.to_ascii_lowercase();
                let always_accept = title.contains("cancel search")
                    || title.starts_with("do you want to draw")
                    || (title.contains("commander")
                        && title.contains("put it into the command zone"));
                let constructed_duel = self.is_constructed_duel();
                let duel_cost = title.starts_with("pay 1 life")
                    || title.starts_with("pay 2 life")
                    || title.starts_with("pay {e}")
                    || title.starts_with("pay return an artifact")
                    || title.starts_with("sacrifice ");
                let own_activation_cost = (title.starts_with("pay ") || title.starts_with("sacrifice "))
                    && (self
                        .attempted_actions
                        .iter()
                        .any(|key| key.starts_with(&format!("ability:{prompt_source_id}:")))
                        || (title.starts_with("sacrifice ") && self.payment_attempt.is_some()));
                let life = self.view.as_ref().and_then(|view| {
                    view.players
                        .iter()
                        .find(|player| player.id == deciding_player_id)
                        .map(|player| player.life)
                });
                let untapped_land = presentation
                    .text
                    .as_deref()
                    .is_some_and(|text| text.contains("enters tapped"))
                    && title.starts_with("pay ")
                    && life.is_some_and(|life| life >= 20);
                let accept_once = title.contains("search your library?")
                    || (constructed_duel && duel_cost)
                    || own_activation_cost
                    || untapped_land
                    || title.contains("sacrifice evolving wilds")
                    || title.contains("sacrifice bountiful landscape")
                    || title.contains("sacrifice strip mine")
                    || title.contains("exile simian spirit guide")
                    || title.starts_with("use triggered ability");
                let value = always_accept || (accept_once && !repeated);
                Some(PromptOutput::ChooseBoolean(ChooseBooleanOutput::Decision { value }))
            }
            PromptInput::ChooseFromSelection(manabrew_protocol::prompts::choose_from_selection::ChooseFromSelectionInput {
                presentation,
                options,
                min_total,
                max_total,
            }) => {
                let signature =
                    format!("select:{}|{min_total}|{max_total}|{}", presentation.title, options.len());
                let search = presentation.title.to_ascii_lowercase().contains("search");
                let own_activation = self
                    .attempted_actions
                    .iter()
                    .any(|key| key.starts_with(&format!("ability:{prompt_source_id}:")));
                let target = if search || self.looping_on(signature) {
                    max_total
                } else if own_activation {
                    min_total.max(1).min(max_total)
                } else {
                    min_total
                };
                let counterable = self.view.as_ref().is_some_and(|view| {
                    view.stack
                        .iter()
                        .any(|item| item.controller_id != deciding_player_id)
                });
                let mut order = (0..options.len())
                    .filter(|index| {
                        counterable
                            || !options[*index]
                                .label
                                .to_ascii_lowercase()
                                .contains("counter target")
                    })
                    .collect::<Vec<_>>();
                order.sort_by_key(|index| {
                    options[*index]
                        .label
                        .split(':')
                        .next()
                        .map_or(0, |cost| cost.matches('{').count())
                });
                let mut chosen_indices = Vec::new();
                let mut total = 0;
                while total < target {
                    let before = total;
                    for index in order.iter().copied() {
                        let option = &options[index];
                        if total + option.weight > target {
                            continue;
                        }
                        if !option.can_repeat && chosen_indices.contains(&index) {
                            continue;
                        }
                        chosen_indices.push(index);
                        total += option.weight;
                        if total == target {
                            break;
                        }
                    }
                    if total == before {
                        break;
                    }
                }
                Some(PromptOutput::ChooseFromSelection(ChooseFromSelectionOutput::SelectionDecision {
                    chosen_indices,
                }))
            }
            PromptInput::ChooseColor(manabrew_protocol::prompts::choose_color::ChooseColorInput { valid_colors, amount, repeat_allowed, .. }) => {
                let mut chosen: std::collections::BTreeMap<String, u32> = std::collections::BTreeMap::new();
                if repeat_allowed {
                    if let Some(c) = valid_colors.first() {
                        chosen.insert(c.clone(), amount);
                    }
                } else {
                    for c in valid_colors.iter().take(amount as usize) {
                        chosen.insert(c.clone(), 1);
                    }
                }
                Some(PromptOutput::ChooseColor(ChooseColorOutput::ColorDecision {
                    chosen_colors: chosen,
                }))
            }
            PromptInput::ChooseNumber(manabrew_protocol::prompts::choose_number::ChooseNumberInput { presentation, min, max }) => {
                let x_cost = presentation.title.to_ascii_lowercase().ends_with("for x");
                let chosen = if x_cost {
                    let fixed = prompt.source_card.as_ref().map_or(0, |card| card.cmc);
                    (self.available_mana(&deciding_player_id) - fixed).clamp(min.max(1), max)
                } else {
                    min.max(1).min(max)
                };
                Some(PromptOutput::ChooseNumber(ChooseNumberOutput::NumberDecision {
                    chosen_number: Some(chosen),
                }))
            }
            PromptInput::ChooseDamageAssignmentOrder(manabrew_protocol::prompts::choose_damage_assignment_order::ChooseDamageAssignmentOrderInput { mut blocker_ids, .. }) => {
                blocker_ids.sort_by_key(|blocker_id| {
                    self.card(blocker_id)
                        .and_then(|card| card.toughness.as_deref())
                        .and_then(|value| value.parse::<i32>().ok())
                        .unwrap_or(i32::MAX)
                });
                Some(PromptOutput::ChooseDamageAssignmentOrder(ChooseDamageAssignmentOrderOutput::DamageAssignmentOrderDecision {
                    ordered_blocker_ids: blocker_ids,
                }))
            }
            PromptInput::ChooseCombatDamageAssignment(manabrew_protocol::prompts::choose_combat_damage_assignment::ChooseCombatDamageAssignmentInput {
                blocker_ids,
                defender_id,
                total_damage,
                attacker_has_deathtouch,
                ..
            }) => {
                let mut remaining = total_damage.max(0);
                let mut assignments = Vec::new();
                for blocker_id in &blocker_ids {
                    if remaining == 0 {
                        break;
                    }
                    let lethal = if attacker_has_deathtouch {
                        1
                    } else {
                        self.card(blocker_id)
                            .and_then(|card| card.toughness.as_deref().map(|value| (value, card.damage)))
                            .and_then(|(value, damage)| value.parse::<i32>().ok().map(|toughness| toughness - damage))
                            .unwrap_or(remaining)
                            .max(1)
                    };
                    let damage = remaining.min(lethal);
                    remaining -= damage;
                    assignments.push(CombatDamageAssignmentEntry {
                        assignee_id: blocker_id.clone(),
                        damage,
                    });
                }
                if remaining > 0 {
                    if let Some(defender_id) = defender_id {
                        assignments.push(CombatDamageAssignmentEntry {
                            assignee_id: defender_id,
                            damage: remaining,
                        });
                    } else if let Some(last) = assignments.last_mut() {
                        last.damage += remaining;
                    }
                }
                Some(PromptOutput::ChooseCombatDamageAssignment(ChooseCombatDamageAssignmentOutput::CombatDamageAssignmentDecision { assignments }))
            }
            PromptInput::PayManaCost(input) => {
                let manual_action = input.actions.iter().find(|action| {
                    matches!(
                        &action.kind,
                        manabrew_protocol::prompts::common::PaymentActionKind::ActivateManaAbility(
                            info
                        ) if info
                            .cost
                            .as_deref()
                            .is_some_and(|cost| cost.chars().any(|c| c.is_ascii_digit()))
                    ) || matches!(
                        &action.kind,
                        manabrew_protocol::prompts::common::PaymentActionKind::UseResource {
                            resource:
                                manabrew_protocol::prompts::common::PaymentResourceKind::Waterbend,
                            ..
                        }
                    )
                });
                let payment = if input.can_confirm_from_pool {
                    self.failed_attack_targets.clear();
                    PayManaCostOutput::Pay { auto: false }
                } else if let Some(action) = manual_action {
                    PayManaCostOutput::Act {
                        action_id: action.id.clone(),
                    }
                } else {
                    if input.actions.is_empty()
                        || self.payment_attempt.as_deref() == Some(input.card_id.as_str())
                    {
                        self.fail_attack_target(&input.card_id);
                        self.payment_attempt = None;
                        PayManaCostOutput::Cancel
                    } else {
                        self.payment_attempt = Some(input.card_id.clone());
                        PayManaCostOutput::Pay { auto: true }
                    }
                };
                Some(PromptOutput::PayManaCost(payment))
            }
            PromptInput::ChooseCards(manabrew_protocol::prompts::choose_cards::ChooseCardsInput {
                presentation,
                mut cards,
                min,
                max,
            }) => {
                let title = presentation.title.to_ascii_lowercase();
                let discard = title.contains("discard");
                let hand_reorder = prompt_source_text.contains("from your hand on top")
                    || prompt_source_text.contains("from your hand on the bottom");
                let prefer_low = title.contains("sacrifice")
                    || discard
                    || title.contains("graveyard")
                    || title.contains("bottom")
                    || title.contains("kor skyfisher")
                    || title.contains("glint hawk")
                    || hand_reorder;
                let lands = self.lands_in_play(&deciding_player_id);
                let missing = self.missing_colors(&deciding_player_id);
                cards.sort_by_key(|card| {
                    let land = card.types.iter().any(|ty| ty == "Land");
                    let value = if land {
                        let fixes = Self::land_colors(card)
                            .iter()
                            .filter(|color| missing.contains(color))
                            .count() as i32;
                        if lands < 6 { 40 + fixes * 10 } else { fixes * 10 }
                    } else if prefer_low {
                        Self::card_value(card) - (card.cmc - lands as i32 - 3).max(0) * 10
                    } else {
                        Self::card_value(card)
                    };
                    if prefer_low { value } else { -value }
                });
                let count = if (discard || hand_reorder) && min == 0 {
                    max
                } else if prefer_low {
                    min
                } else {
                    max
                };
                Some(PromptOutput::ChooseCards(ChooseCardsOutput::ChooseCardsDecision {
                    chosen_card_ids: cards.iter().take(count).map(|card| card.id.clone()).collect(),
                }))
            }
            PromptInput::Reorder(manabrew_protocol::prompts::reorder::ReorderInput { items, .. }) => {
                Some(PromptOutput::Reorder(ReorderOutput::ReorderDecision {
                    ordered_ids: items.iter().map(|item| item.id.clone()).collect(),
                }))
            }
            PromptInput::GameOver(manabrew_protocol::prompts::game_over::GameOverInput { .. }) => None,
            // Display-only acknowledgements: the engine `await`s these so
            // every transport must produce an ack — keeps the engine's
            // broadcast loop polymorphic (no `if is_human` branching).
            PromptInput::DiceRolled(_) => Some(PromptOutput::DiceRolled(
                DiceRolledOutput::DiceRolledAcknowledged,
            )),
        }
    }
}
