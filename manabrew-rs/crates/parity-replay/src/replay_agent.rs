use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use forge_foundation::ZoneType;
use manabrew_agent_interface::agent_impl::Responder;
use manabrew_engine::ids::PlayerId;
use manabrew_engine::maintenance::MaintenanceEdit;
use manabrew_protocol::game::{CardDto, GameViewDto};
use manabrew_protocol::prompts::choose_action::ChooseActionOutput;
use manabrew_protocol::prompts::choose_attackers::ChooseAttackersOutput;
use manabrew_protocol::prompts::choose_blockers::ChooseBlockersOutput;
use manabrew_protocol::prompts::choose_board_targets::ChooseBoardTargetsOutput;
use manabrew_protocol::prompts::choose_cards::ChooseCardsOutput;
use manabrew_protocol::prompts::common::{AvailableAction, AvailableActionKind, TargetKind};
use manabrew_protocol::prompts::reorder_cards::ReorderCardsOutput;
use manabrew_protocol::prompts::{PromptInput, PromptOutput};
use manabrew_protocol::transport::{AgentMessage, AgentPrompt, ClientToServerMessage};

use crate::diff::{diff_views, FieldDiff};
use crate::trace::Decision;

pub struct Divergence {
    pub decision_index: usize,
    pub turn: u32,
    pub step: String,
    pub deciding_player: String,
    pub prompt_kind: String,
    pub diffs: Vec<FieldDiff>,
}

impl Divergence {
    pub fn is_library_boundary(&self) -> bool {
        !self.diffs.is_empty() && self.diffs.iter().all(|d| d.library_dependent)
    }
}

pub struct ReplayContext {
    decisions: Vec<Decision>,
    cursor: usize,
    pub clean_decisions: usize,
    pub diffed_decisions: usize,
    pub divergences: Vec<Divergence>,
    pub remap_misses: usize,
    pub desyncs: usize,
    pub abort: Arc<AtomicBool>,
    keep_going: bool,
    max_divergences: usize,
    done: bool,
}

impl ReplayContext {
    pub fn new(
        decisions: Vec<Decision>,
        abort: Arc<AtomicBool>,
        keep_going: bool,
        max_divergences: usize,
    ) -> Self {
        Self {
            decisions,
            cursor: 0,
            clean_decisions: 0,
            diffed_decisions: 0,
            divergences: Vec::new(),
            remap_misses: 0,
            desyncs: 0,
            abort,
            keep_going,
            max_divergences,
            done: false,
        }
    }

    pub fn total_decisions(&self) -> usize {
        self.decisions.len()
    }

    pub fn first_divergence(&self) -> Option<&Divergence> {
        self.divergences.first()
    }

    fn advance_to(&mut self, kind: &str, turn: u32, step: &str, player: &str) -> Option<usize> {
        let mut fallback = None;
        for i in self.cursor..self.decisions.len() {
            if input_kind(&self.decisions[i].prompt.input) != kind {
                continue;
            }
            if fallback.is_none() {
                fallback = Some(i);
            }
            if let Some(state) = &self.decisions[i].state_before {
                if state.turn == turn
                    && state.step == step
                    && self.decisions[i].prompt.deciding_player_id == player
                {
                    self.cursor = i + 1;
                    return Some(i);
                }
            }
        }
        if let Some(i) = fallback {
            self.cursor = i + 1;
        }
        fallback
    }
}

pub struct ReplayAgent {
    ctx: Rc<RefCell<ReplayContext>>,
    latest_view: Option<GameViewDto>,
    reconcile: bool,
    pending_edits: Vec<MaintenanceEdit>,
}

impl ReplayAgent {
    pub fn new(ctx: Rc<RefCell<ReplayContext>>, reconcile: bool) -> Self {
        Self {
            ctx,
            latest_view: None,
            reconcile,
            pending_edits: Vec::new(),
        }
    }
}

impl Responder for ReplayAgent {
    fn present(&mut self, message: &AgentMessage) {
        if let AgentMessage::State(update) = message {
            self.latest_view = Some(update.game_view.clone());
        }
    }

    fn take_maintenance_edits(&mut self) -> Vec<MaintenanceEdit> {
        std::mem::take(&mut self.pending_edits)
    }

    fn respond(&mut self, prompt: AgentPrompt) -> ClientToServerMessage {
        let live_kind = input_kind(&prompt.input);
        let (turn, step) = self
            .latest_view
            .as_ref()
            .map(|v| (v.turn, v.step.clone()))
            .unwrap_or((0, String::new()));
        let mut ctx = self.ctx.borrow_mut();

        if ctx.done {
            return pass();
        }

        let Some(index) = ctx.advance_to(live_kind, turn, &step, &prompt.deciding_player_id) else {
            ctx.desyncs += 1;
            return safe_default(&prompt);
        };

        let recorded_state = ctx.decisions[index].state_before.clone();
        let matched_player = ctx.decisions[index].prompt.deciding_player_id.clone();
        let mut new_edits: Vec<MaintenanceEdit> = Vec::new();
        if let (Some(rust_view), Some(trace_view)) =
            (self.latest_view.as_ref(), recorded_state.as_ref())
        {
            ctx.diffed_decisions += 1;
            let on_path = trace_view.turn == rust_view.turn
                && trace_view.step == rust_view.step
                && matched_player == prompt.deciding_player_id;
            let diffs = if on_path {
                diff_views(rust_view, trace_view)
            } else {
                vec![FieldDiff {
                    path: "<off trace path>".into(),
                    rust: format!("turn {} {}", rust_view.turn, rust_view.step),
                    trace: format!("turn {} {}", trace_view.turn, trace_view.step),
                    library_dependent: false,
                }]
            };
            if diffs.is_empty() {
                ctx.clean_decisions += 1;
            } else {
                ctx.divergences.push(Divergence {
                    decision_index: index,
                    turn: trace_view.turn,
                    step: trace_view.step.clone(),
                    deciding_player: prompt.deciding_player_id.clone(),
                    prompt_kind: live_kind.to_string(),
                    diffs,
                });
                if self.reconcile && on_path {
                    new_edits = reconcile_edits(rust_view, trace_view);
                }
                let stop = !ctx.keep_going || ctx.divergences.len() >= ctx.max_divergences;
                if stop {
                    ctx.done = true;
                    ctx.abort.store(true, Ordering::Relaxed);
                    return safe_default(&prompt);
                }
            }
        }
        self.pending_edits.append(&mut new_edits);

        let recorded_response = ctx.decisions[index].response.clone();
        let recorded_prompt = ctx.decisions[index].prompt.clone();
        let mut miss = false;
        let action = remap_response(
            recorded_response,
            &recorded_prompt,
            recorded_state.as_ref(),
            &prompt,
            self.latest_view.as_ref(),
            &mut miss,
        );
        if miss {
            ctx.remap_misses += 1;
        }
        ClientToServerMessage::Response { action }
    }
}

fn name_multiset(cards: &[CardDto]) -> HashMap<String, u32> {
    let mut out: HashMap<String, u32> = HashMap::new();
    for card in cards {
        *out.entry(card.identity.name.clone()).or_default() += 1;
    }
    out
}

fn reconcile_edits(rust: &GameViewDto, trace: &GameViewDto) -> Vec<MaintenanceEdit> {
    let mut edits = Vec::new();
    for trace_player in &trace.players {
        let Some(index) = trace_player
            .id
            .strip_prefix("player-")
            .and_then(|n| n.parse().ok())
        else {
            continue;
        };
        let Some(rust_player) = rust.player(&trace_player.id) else {
            continue;
        };
        let player = PlayerId(index);
        if rust_player.life != trace_player.life {
            edits.push(MaintenanceEdit::SetLife {
                player,
                life: trace_player.life,
            });
        }
        if rust_player.poison != trace_player.poison {
            edits.push(MaintenanceEdit::SetPoison {
                player,
                poison: trace_player.poison,
            });
        }
        let zones: [(ZoneType, &Vec<CardDto>, &Vec<CardDto>); 4] = [
            (ZoneType::Hand, &rust_player.hand, &trace_player.hand),
            (
                ZoneType::Graveyard,
                &rust_player.graveyard,
                &trace_player.graveyard,
            ),
            (ZoneType::Exile, &rust_player.exile, &trace_player.exile),
            (
                ZoneType::Command,
                &rust_player.command_zone,
                &trace_player.command_zone,
            ),
        ];
        for (zone, rust_cards, trace_cards) in zones {
            if name_multiset(rust_cards) != name_multiset(trace_cards) {
                edits.push(MaintenanceEdit::SetZone {
                    player,
                    zone,
                    card_names: trace_cards
                        .iter()
                        .map(|c| c.identity.name.clone())
                        .collect(),
                });
            }
        }

        let owned = |cards: &[CardDto]| -> HashMap<String, u32> {
            let mut out: HashMap<String, u32> = HashMap::new();
            for card in cards.iter().filter(|c| c.owner_id == trace_player.id) {
                *out.entry(card.identity.name.clone()).or_default() += 1;
            }
            out
        };
        if owned(&rust.battlefield) != owned(&trace.battlefield) {
            edits.push(MaintenanceEdit::SetZone {
                player,
                zone: ZoneType::Battlefield,
                card_names: trace
                    .battlefield
                    .iter()
                    .filter(|c| c.owner_id == trace_player.id)
                    .map(|c| c.identity.name.clone())
                    .collect(),
            });
        }
    }
    edits
}

fn pass() -> ClientToServerMessage {
    ClientToServerMessage::Response {
        action: PromptOutput::ChooseAction(ChooseActionOutput::Pass { until: None }),
    }
}

fn safe_default(prompt: &AgentPrompt) -> ClientToServerMessage {
    use manabrew_protocol::prompts::dice_rolled::DiceRolledOutput;
    use manabrew_protocol::prompts::mulligan::MulliganOutput;
    use manabrew_protocol::prompts::reveal::RevealCardsOutput;
    let action = match &prompt.input {
        PromptInput::DiceRolled(_) => {
            PromptOutput::DiceRolled(DiceRolledOutput::DiceRolledAcknowledged)
        }
        PromptInput::RevealCards(_) => {
            PromptOutput::RevealCards(RevealCardsOutput::RevealCardsAcknowledged)
        }
        PromptInput::Mulligan(_) => {
            PromptOutput::Mulligan(MulliganOutput::MulliganDecision { keep: true })
        }
        _ => PromptOutput::ChooseAction(ChooseActionOutput::Pass { until: None }),
    };
    ClientToServerMessage::Response { action }
}

struct NameIndex {
    id_to_name: HashMap<String, String>,
    name_to_ids: HashMap<String, Vec<String>>,
}

impl NameIndex {
    fn from_view(view: &GameViewDto) -> Self {
        let mut id_to_name = HashMap::new();
        let mut name_to_ids: HashMap<String, Vec<String>> = HashMap::new();
        for c in view.all_zone_cards() {
            id_to_name.insert(c.id.clone(), c.identity.name.clone());
            name_to_ids
                .entry(c.identity.name.clone())
                .or_default()
                .push(c.id.clone());
        }
        Self {
            id_to_name,
            name_to_ids,
        }
    }
}

fn remap_card_id(
    recorded_id: &str,
    recorded: Option<&NameIndex>,
    live: Option<&NameIndex>,
    used: &mut HashMap<String, usize>,
    miss: &mut bool,
) -> String {
    if recorded_id.starts_with("player-") || recorded_id.starts_with("stack-") {
        return recorded_id.to_string();
    }
    let name = recorded.and_then(|r| r.id_to_name.get(recorded_id));
    let Some(name) = name else {
        *miss = true;
        return recorded_id.to_string();
    };
    let Some(ids) = live.and_then(|l| l.name_to_ids.get(name)) else {
        *miss = true;
        return recorded_id.to_string();
    };
    let slot = used.entry(name.clone()).or_insert(0);
    let chosen = ids.get(*slot).or_else(|| ids.first());
    match chosen {
        Some(id) => {
            *slot += 1;
            id.clone()
        }
        None => {
            *miss = true;
            recorded_id.to_string()
        }
    }
}

fn remap_response(
    recorded: PromptOutput,
    recorded_prompt: &AgentPrompt,
    recorded_state: Option<&GameViewDto>,
    live_prompt: &AgentPrompt,
    live_view: Option<&GameViewDto>,
    miss: &mut bool,
) -> PromptOutput {
    let recorded_index = recorded_state.map(NameIndex::from_view);
    let live_index = live_view.map(NameIndex::from_view);
    let mut used: HashMap<String, usize> = HashMap::new();

    match recorded {
        PromptOutput::ChooseAction(ChooseActionOutput::Act { action_id }) => {
            match remap_action(
                &action_id,
                recorded_prompt,
                recorded_index.as_ref(),
                live_prompt,
                live_index.as_ref(),
            ) {
                Some(id) => PromptOutput::ChooseAction(ChooseActionOutput::Act { action_id: id }),
                None => {
                    *miss = true;
                    PromptOutput::ChooseAction(ChooseActionOutput::Pass { until: None })
                }
            }
        }
        PromptOutput::ChooseAttackers(ChooseAttackersOutput::DeclareAttackers {
            mut assignments,
        }) => {
            for a in &mut assignments {
                a.attacker_id = remap_card_id(
                    &a.attacker_id,
                    recorded_index.as_ref(),
                    live_index.as_ref(),
                    &mut used,
                    miss,
                );
                a.target_id = remap_card_id(
                    &a.target_id,
                    recorded_index.as_ref(),
                    live_index.as_ref(),
                    &mut used,
                    miss,
                );
            }
            PromptOutput::ChooseAttackers(ChooseAttackersOutput::DeclareAttackers { assignments })
        }
        PromptOutput::ChooseBlockers(ChooseBlockersOutput::DeclareBlockers { mut assignments }) => {
            for a in &mut assignments {
                a.blocker_id = remap_card_id(
                    &a.blocker_id,
                    recorded_index.as_ref(),
                    live_index.as_ref(),
                    &mut used,
                    miss,
                );
                a.attacker_id = remap_card_id(
                    &a.attacker_id,
                    recorded_index.as_ref(),
                    live_index.as_ref(),
                    &mut used,
                    miss,
                );
            }
            PromptOutput::ChooseBlockers(ChooseBlockersOutput::DeclareBlockers { assignments })
        }
        PromptOutput::ChooseBoardTargets(ChooseBoardTargetsOutput::BoardTargets { mut chosen }) => {
            for target in &mut chosen {
                if target.kind == TargetKind::Card {
                    target.id = remap_card_id(
                        &target.id,
                        recorded_index.as_ref(),
                        live_index.as_ref(),
                        &mut used,
                        miss,
                    );
                }
            }
            PromptOutput::ChooseBoardTargets(ChooseBoardTargetsOutput::BoardTargets { chosen })
        }
        PromptOutput::ChooseCards(ChooseCardsOutput::ChooseCardsDecision { chosen_card_ids }) => {
            let ids = chosen_card_ids
                .iter()
                .map(|id| {
                    remap_card_id(
                        id,
                        recorded_index.as_ref(),
                        live_index.as_ref(),
                        &mut used,
                        miss,
                    )
                })
                .collect();
            PromptOutput::ChooseCards(ChooseCardsOutput::ChooseCardsDecision {
                chosen_card_ids: ids,
            })
        }
        PromptOutput::ReorderCards(ReorderCardsOutput::ReorderDecision { ordered_card_ids }) => {
            let ids = ordered_card_ids
                .iter()
                .map(|id| {
                    remap_card_id(
                        id,
                        recorded_index.as_ref(),
                        live_index.as_ref(),
                        &mut used,
                        miss,
                    )
                })
                .collect();
            PromptOutput::ReorderCards(ReorderCardsOutput::ReorderDecision {
                ordered_card_ids: ids,
            })
        }
        other => other,
    }
}

fn remap_action(
    recorded_action_id: &str,
    recorded_prompt: &AgentPrompt,
    recorded_index: Option<&NameIndex>,
    live_prompt: &AgentPrompt,
    live_index: Option<&NameIndex>,
) -> Option<String> {
    let PromptInput::ChooseAction(recorded_input) = &recorded_prompt.input else {
        return None;
    };
    let PromptInput::ChooseAction(live_input) = &live_prompt.input else {
        return None;
    };
    let recorded_action = recorded_input
        .actions
        .iter()
        .find(|a| a.id == recorded_action_id)?;
    let recorded_name = action_card_name(recorded_action, recorded_index);
    let recorded_tag = kind_tag(&recorded_action.kind);

    let matched = live_input.actions.iter().find(|a| {
        kind_tag(&a.kind) == recorded_tag && action_card_name(a, live_index) == recorded_name
    });
    matched.map(|a| a.id.clone())
}

fn action_card_name(action: &AvailableAction, index: Option<&NameIndex>) -> Option<String> {
    let card_id = action_card_id(&action.kind)?;
    index.and_then(|i| i.id_to_name.get(card_id).cloned())
}

fn action_card_id(kind: &AvailableActionKind) -> Option<&str> {
    match kind {
        AvailableActionKind::Cast { card_id, .. } => Some(card_id),
        AvailableActionKind::ActivateAbility(info) => Some(&info.card_id),
        AvailableActionKind::UndoMana { card_id } => Some(card_id),
        AvailableActionKind::Delve { card_id } => Some(card_id),
        AvailableActionKind::Undelve { card_id } => Some(card_id),
    }
}

fn kind_tag(kind: &AvailableActionKind) -> &'static str {
    match kind {
        AvailableActionKind::Cast { .. } => "cast",
        AvailableActionKind::ActivateAbility(_) => "activateAbility",
        AvailableActionKind::UndoMana { .. } => "undoMana",
        AvailableActionKind::Delve { .. } => "delve",
        AvailableActionKind::Undelve { .. } => "undelve",
    }
}

fn input_kind(input: &PromptInput) -> &'static str {
    match input {
        PromptInput::Mulligan(_) => "mulligan",
        PromptInput::MulliganPutBack(_) => "mulliganPutBack",
        PromptInput::ChooseAction(_) => "chooseAction",
        PromptInput::ChooseAttackers(_) => "chooseAttackers",
        PromptInput::ChooseBlockers(_) => "chooseBlockers",
        PromptInput::ChooseBoardTargets(_) => "chooseBoardTargets",
        PromptInput::ChooseBoolean(_) => "chooseBoolean",
        PromptInput::ChooseFromSelection(_) => "chooseFromSelection",
        PromptInput::GameOver(_) => "gameOver",
        PromptInput::RevealCards(_) => "revealCards",
        PromptInput::Scry(_) => "scry",
        PromptInput::ChooseColor(_) => "chooseColor",
        PromptInput::ChooseNumber(_) => "chooseNumber",
        PromptInput::ChooseDamageAssignmentOrder(_) => "chooseDamageAssignmentOrder",
        PromptInput::ChooseCombatDamageAssignment(_) => "chooseCombatDamageAssignment",
        PromptInput::PayManaCost(_) => "payManaCost",
        PromptInput::ChooseCards(_) => "chooseCards",
        PromptInput::ReorderCards(_) => "reorderCards",
        PromptInput::DiceRolled(_) => "diceRolled",
    }
}
