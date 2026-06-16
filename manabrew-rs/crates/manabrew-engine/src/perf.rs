//! Opt-in hot-path instrumentation for the Rust engine.
//!
//! Disabled by default. Set `manabrew_engine_PERF=1` to collect counters and
//! timings. Set `manabrew_engine_PERF_TRACE=1` to emit every increment, or
//! `manabrew_engine_PERF_REPORT_EVERY=N` to print a summary every N continuous
//! effect recomputations.

use std::cell::{Cell, RefCell};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy)]
pub enum Metric {
    ContinuousEffectsCalls,
    ContinuousEffectsNs,
    ContinuousStaticSourceClones,
    ContinuousTargetVecs,
    ParamsParses,
    ParamsLookups,
    ParamsUnscopedLookups,
    ContinuousParamsLookups,
    ActionSpaceParamsLookups,
    ActionSpacePlayableParamsLookups,
    ActionSpaceActivatableParamsLookups,
    ActionSpaceManaSourceParamsLookups,
    ActionSpaceUntapParamsLookups,
    TriggerParamsLookups,
    ReplacementParamsLookups,
    CostParamsLookups,
    TargetParamsLookups,
    AbilityBuildParamsLookups,
    StaticAbilityParamsLookups,
    ValidFilterParamsLookups,
    SelectorParses,
    SelectorMatches,
    SelectorRawPredicates,
    GameLoopParamsLookups,
    PhaseParamsLookups,
    PriorityParamsLookups,
    PrioritySbaParamsLookups,
    PriorityTriggerParamsLookups,
    PrioritySnapshotsTaken,
    PrioritySnapshotParamsLookups,
    PrioritySnapshotSyncParamsLookups,
    PrioritySnapshotMetadataParamsLookups,
    PrioritySnapshotAbilityParamsLookups,
    PrioritySnapshotCardCloneParamsLookups,
    PriorityChoiceParamsLookups,
    PriorityExecutionParamsLookups,
    StackResolutionParamsLookups,
    CombatParamsLookups,
    SpellAbilityClones,
    StackEntryClones,
    GameStateTargetingClones,
    SnapshotClones,
    CardStateCollectionClones,
}

static CONTINUOUS_EFFECTS_CALLS: AtomicU64 = AtomicU64::new(0);
static CONTINUOUS_EFFECTS_NS: AtomicU64 = AtomicU64::new(0);
static CONTINUOUS_STATIC_SOURCE_CLONES: AtomicU64 = AtomicU64::new(0);
static CONTINUOUS_TARGET_VECS: AtomicU64 = AtomicU64::new(0);
static PARAMS_PARSES: AtomicU64 = AtomicU64::new(0);
static PARAMS_LOOKUPS: AtomicU64 = AtomicU64::new(0);
static PARAMS_UNSCOPED_LOOKUPS: AtomicU64 = AtomicU64::new(0);
static CONTINUOUS_PARAMS_LOOKUPS: AtomicU64 = AtomicU64::new(0);
static ACTION_SPACE_PARAMS_LOOKUPS: AtomicU64 = AtomicU64::new(0);
static ACTION_SPACE_PLAYABLE_PARAMS_LOOKUPS: AtomicU64 = AtomicU64::new(0);
static ACTION_SPACE_ACTIVATABLE_PARAMS_LOOKUPS: AtomicU64 = AtomicU64::new(0);
static ACTION_SPACE_MANA_SOURCE_PARAMS_LOOKUPS: AtomicU64 = AtomicU64::new(0);
static ACTION_SPACE_UNTAP_PARAMS_LOOKUPS: AtomicU64 = AtomicU64::new(0);
static TRIGGER_PARAMS_LOOKUPS: AtomicU64 = AtomicU64::new(0);
static REPLACEMENT_PARAMS_LOOKUPS: AtomicU64 = AtomicU64::new(0);
static COST_PARAMS_LOOKUPS: AtomicU64 = AtomicU64::new(0);
static TARGET_PARAMS_LOOKUPS: AtomicU64 = AtomicU64::new(0);
static ABILITY_BUILD_PARAMS_LOOKUPS: AtomicU64 = AtomicU64::new(0);
static STATIC_ABILITY_PARAMS_LOOKUPS: AtomicU64 = AtomicU64::new(0);
static VALID_FILTER_PARAMS_LOOKUPS: AtomicU64 = AtomicU64::new(0);
static SELECTOR_PARSES: AtomicU64 = AtomicU64::new(0);
static SELECTOR_MATCHES: AtomicU64 = AtomicU64::new(0);
static SELECTOR_RAW_PREDICATES: AtomicU64 = AtomicU64::new(0);
static GAME_LOOP_PARAMS_LOOKUPS: AtomicU64 = AtomicU64::new(0);
static PHASE_PARAMS_LOOKUPS: AtomicU64 = AtomicU64::new(0);
static PRIORITY_PARAMS_LOOKUPS: AtomicU64 = AtomicU64::new(0);
static PRIORITY_SBA_PARAMS_LOOKUPS: AtomicU64 = AtomicU64::new(0);
static PRIORITY_TRIGGER_PARAMS_LOOKUPS: AtomicU64 = AtomicU64::new(0);
static PRIORITY_SNAPSHOTS_TAKEN: AtomicU64 = AtomicU64::new(0);
static PRIORITY_SNAPSHOT_PARAMS_LOOKUPS: AtomicU64 = AtomicU64::new(0);
static PRIORITY_SNAPSHOT_SYNC_PARAMS_LOOKUPS: AtomicU64 = AtomicU64::new(0);
static PRIORITY_SNAPSHOT_METADATA_PARAMS_LOOKUPS: AtomicU64 = AtomicU64::new(0);
static PRIORITY_SNAPSHOT_ABILITY_PARAMS_LOOKUPS: AtomicU64 = AtomicU64::new(0);
static PRIORITY_SNAPSHOT_CARD_CLONE_PARAMS_LOOKUPS: AtomicU64 = AtomicU64::new(0);
static PRIORITY_CHOICE_PARAMS_LOOKUPS: AtomicU64 = AtomicU64::new(0);
static PRIORITY_EXECUTION_PARAMS_LOOKUPS: AtomicU64 = AtomicU64::new(0);
static STACK_RESOLUTION_PARAMS_LOOKUPS: AtomicU64 = AtomicU64::new(0);
static COMBAT_PARAMS_LOOKUPS: AtomicU64 = AtomicU64::new(0);
static SPELL_ABILITY_CLONES: AtomicU64 = AtomicU64::new(0);
static STACK_ENTRY_CLONES: AtomicU64 = AtomicU64::new(0);
static GAME_STATE_TARGETING_CLONES: AtomicU64 = AtomicU64::new(0);
static SNAPSHOT_CLONES: AtomicU64 = AtomicU64::new(0);
static CARD_STATE_COLLECTION_CLONES: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParamsLookupScope {
    Continuous,
    ActionSpace,
    ActionSpacePlayable,
    ActionSpaceActivatable,
    ActionSpaceManaSource,
    ActionSpaceUntap,
    Trigger,
    Replacement,
    Cost,
    Target,
    AbilityBuild,
    StaticAbility,
    ValidFilter,
    GameLoop,
    Phase,
    Priority,
    PrioritySba,
    PriorityTrigger,
    PrioritySnapshot,
    PrioritySnapshotSync,
    PrioritySnapshotMetadata,
    PrioritySnapshotAbility,
    PrioritySnapshotCardClone,
    PriorityChoice,
    PriorityExecution,
    StackResolution,
    Combat,
}

thread_local! {
    static PARAMS_LOOKUP_SCOPE: Cell<Option<ParamsLookupScope>> = const { Cell::new(None) };
    static WALL_START: RefCell<Option<Instant>> = const { RefCell::new(None) };
    static TURN_WALL_MS: RefCell<Vec<u64>> = const { RefCell::new(Vec::new()) };
}

fn enabled_cell() -> bool {
    std::env::var_os("manabrew_engine_PERF").is_some()
}

pub fn enabled() -> bool {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    *ENABLED.get_or_init(enabled_cell)
}

fn trace_enabled() -> bool {
    static TRACE_ENABLED: OnceLock<bool> = OnceLock::new();
    *TRACE_ENABLED.get_or_init(|| std::env::var_os("manabrew_engine_PERF_TRACE").is_some())
}

fn report_every() -> Option<u64> {
    static REPORT_EVERY: OnceLock<Option<u64>> = OnceLock::new();
    *REPORT_EVERY.get_or_init(|| {
        std::env::var("manabrew_engine_PERF_REPORT_EVERY")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|&n| n > 0)
    })
}

fn counter(metric: Metric) -> &'static AtomicU64 {
    match metric {
        Metric::ContinuousEffectsCalls => &CONTINUOUS_EFFECTS_CALLS,
        Metric::ContinuousEffectsNs => &CONTINUOUS_EFFECTS_NS,
        Metric::ContinuousStaticSourceClones => &CONTINUOUS_STATIC_SOURCE_CLONES,
        Metric::ContinuousTargetVecs => &CONTINUOUS_TARGET_VECS,
        Metric::ParamsParses => &PARAMS_PARSES,
        Metric::ParamsLookups => &PARAMS_LOOKUPS,
        Metric::ParamsUnscopedLookups => &PARAMS_UNSCOPED_LOOKUPS,
        Metric::ContinuousParamsLookups => &CONTINUOUS_PARAMS_LOOKUPS,
        Metric::ActionSpaceParamsLookups => &ACTION_SPACE_PARAMS_LOOKUPS,
        Metric::ActionSpacePlayableParamsLookups => &ACTION_SPACE_PLAYABLE_PARAMS_LOOKUPS,
        Metric::ActionSpaceActivatableParamsLookups => &ACTION_SPACE_ACTIVATABLE_PARAMS_LOOKUPS,
        Metric::ActionSpaceManaSourceParamsLookups => &ACTION_SPACE_MANA_SOURCE_PARAMS_LOOKUPS,
        Metric::ActionSpaceUntapParamsLookups => &ACTION_SPACE_UNTAP_PARAMS_LOOKUPS,
        Metric::TriggerParamsLookups => &TRIGGER_PARAMS_LOOKUPS,
        Metric::ReplacementParamsLookups => &REPLACEMENT_PARAMS_LOOKUPS,
        Metric::CostParamsLookups => &COST_PARAMS_LOOKUPS,
        Metric::TargetParamsLookups => &TARGET_PARAMS_LOOKUPS,
        Metric::AbilityBuildParamsLookups => &ABILITY_BUILD_PARAMS_LOOKUPS,
        Metric::StaticAbilityParamsLookups => &STATIC_ABILITY_PARAMS_LOOKUPS,
        Metric::ValidFilterParamsLookups => &VALID_FILTER_PARAMS_LOOKUPS,
        Metric::SelectorParses => &SELECTOR_PARSES,
        Metric::SelectorMatches => &SELECTOR_MATCHES,
        Metric::SelectorRawPredicates => &SELECTOR_RAW_PREDICATES,
        Metric::GameLoopParamsLookups => &GAME_LOOP_PARAMS_LOOKUPS,
        Metric::PhaseParamsLookups => &PHASE_PARAMS_LOOKUPS,
        Metric::PriorityParamsLookups => &PRIORITY_PARAMS_LOOKUPS,
        Metric::PrioritySbaParamsLookups => &PRIORITY_SBA_PARAMS_LOOKUPS,
        Metric::PriorityTriggerParamsLookups => &PRIORITY_TRIGGER_PARAMS_LOOKUPS,
        Metric::PrioritySnapshotsTaken => &PRIORITY_SNAPSHOTS_TAKEN,
        Metric::PrioritySnapshotParamsLookups => &PRIORITY_SNAPSHOT_PARAMS_LOOKUPS,
        Metric::PrioritySnapshotSyncParamsLookups => &PRIORITY_SNAPSHOT_SYNC_PARAMS_LOOKUPS,
        Metric::PrioritySnapshotMetadataParamsLookups => &PRIORITY_SNAPSHOT_METADATA_PARAMS_LOOKUPS,
        Metric::PrioritySnapshotAbilityParamsLookups => &PRIORITY_SNAPSHOT_ABILITY_PARAMS_LOOKUPS,
        Metric::PrioritySnapshotCardCloneParamsLookups => {
            &PRIORITY_SNAPSHOT_CARD_CLONE_PARAMS_LOOKUPS
        }
        Metric::PriorityChoiceParamsLookups => &PRIORITY_CHOICE_PARAMS_LOOKUPS,
        Metric::PriorityExecutionParamsLookups => &PRIORITY_EXECUTION_PARAMS_LOOKUPS,
        Metric::StackResolutionParamsLookups => &STACK_RESOLUTION_PARAMS_LOOKUPS,
        Metric::CombatParamsLookups => &COMBAT_PARAMS_LOOKUPS,
        Metric::SpellAbilityClones => &SPELL_ABILITY_CLONES,
        Metric::StackEntryClones => &STACK_ENTRY_CLONES,
        Metric::GameStateTargetingClones => &GAME_STATE_TARGETING_CLONES,
        Metric::SnapshotClones => &SNAPSHOT_CLONES,
        Metric::CardStateCollectionClones => &CARD_STATE_COLLECTION_CLONES,
    }
}

fn name(metric: Metric) -> &'static str {
    match metric {
        Metric::ContinuousEffectsCalls => "continuous_effects.calls",
        Metric::ContinuousEffectsNs => "continuous_effects.ns",
        Metric::ContinuousStaticSourceClones => "continuous_effects.static_source_clones",
        Metric::ContinuousTargetVecs => "continuous_effects.target_vecs",
        Metric::ParamsParses => "params.parses",
        Metric::ParamsLookups => "params.lookups",
        Metric::ParamsUnscopedLookups => "params.lookups.unscoped",
        Metric::ContinuousParamsLookups => "params.lookups.continuous",
        Metric::ActionSpaceParamsLookups => "params.lookups.action_space",
        Metric::ActionSpacePlayableParamsLookups => "params.lookups.action_space_playable",
        Metric::ActionSpaceActivatableParamsLookups => "params.lookups.action_space_activatable",
        Metric::ActionSpaceManaSourceParamsLookups => "params.lookups.action_space_mana_source",
        Metric::ActionSpaceUntapParamsLookups => "params.lookups.action_space_untap",
        Metric::TriggerParamsLookups => "params.lookups.trigger",
        Metric::ReplacementParamsLookups => "params.lookups.replacement",
        Metric::CostParamsLookups => "params.lookups.cost",
        Metric::TargetParamsLookups => "params.lookups.target",
        Metric::AbilityBuildParamsLookups => "params.lookups.ability_build",
        Metric::StaticAbilityParamsLookups => "params.lookups.static_ability",
        Metric::ValidFilterParamsLookups => "params.lookups.valid_filter",
        Metric::SelectorParses => "selector.parses",
        Metric::SelectorMatches => "selector.matches",
        Metric::SelectorRawPredicates => "selector.raw_predicates",
        Metric::GameLoopParamsLookups => "params.lookups.game_loop",
        Metric::PhaseParamsLookups => "params.lookups.phase",
        Metric::PriorityParamsLookups => "params.lookups.priority",
        Metric::PrioritySbaParamsLookups => "params.lookups.priority_sba",
        Metric::PriorityTriggerParamsLookups => "params.lookups.priority_trigger",
        Metric::PrioritySnapshotsTaken => "priority.snapshots_taken",
        Metric::PrioritySnapshotParamsLookups => "params.lookups.priority_snapshot",
        Metric::PrioritySnapshotSyncParamsLookups => "params.lookups.priority_snapshot_sync",
        Metric::PrioritySnapshotMetadataParamsLookups => {
            "params.lookups.priority_snapshot_metadata"
        }
        Metric::PrioritySnapshotAbilityParamsLookups => "params.lookups.priority_snapshot_ability",
        Metric::PrioritySnapshotCardCloneParamsLookups => {
            "params.lookups.priority_snapshot_card_clone"
        }
        Metric::PriorityChoiceParamsLookups => "params.lookups.priority_choice",
        Metric::PriorityExecutionParamsLookups => "params.lookups.priority_execution",
        Metric::StackResolutionParamsLookups => "params.lookups.stack_resolution",
        Metric::CombatParamsLookups => "params.lookups.combat",
        Metric::SpellAbilityClones => "spell_ability.clones",
        Metric::StackEntryClones => "stack_entry.clones",
        Metric::GameStateTargetingClones => "game_state.targeting_clones",
        Metric::SnapshotClones => "snapshot.clones",
        Metric::CardStateCollectionClones => "card_state.collection_clones",
    }
}

pub fn increment(metric: Metric, amount: u64) {
    if !enabled() || amount == 0 {
        return;
    }
    let total = counter(metric).fetch_add(amount, Ordering::Relaxed) + amount;
    if trace_enabled() {
        eprintln!("[forge-perf] {} +{} total={}", name(metric), amount, total);
    }
    if matches!(metric, Metric::ContinuousEffectsCalls) {
        if let Some(every) = report_every() {
            if total % every == 0 {
                print_summary();
            }
        }
    }
}

pub fn increment_params_lookup() {
    increment(Metric::ParamsLookups, 1);
    if !enabled() {
        return;
    }
    PARAMS_LOOKUP_SCOPE.with(|scope| match scope.get() {
        Some(ParamsLookupScope::Continuous) => increment(Metric::ContinuousParamsLookups, 1),
        Some(ParamsLookupScope::ActionSpace) => increment(Metric::ActionSpaceParamsLookups, 1),
        Some(ParamsLookupScope::ActionSpacePlayable) => {
            increment(Metric::ActionSpacePlayableParamsLookups, 1)
        }
        Some(ParamsLookupScope::ActionSpaceActivatable) => {
            increment(Metric::ActionSpaceActivatableParamsLookups, 1)
        }
        Some(ParamsLookupScope::ActionSpaceManaSource) => {
            increment(Metric::ActionSpaceManaSourceParamsLookups, 1)
        }
        Some(ParamsLookupScope::ActionSpaceUntap) => {
            increment(Metric::ActionSpaceUntapParamsLookups, 1)
        }
        Some(ParamsLookupScope::Trigger) => increment(Metric::TriggerParamsLookups, 1),
        Some(ParamsLookupScope::Replacement) => increment(Metric::ReplacementParamsLookups, 1),
        Some(ParamsLookupScope::Cost) => increment(Metric::CostParamsLookups, 1),
        Some(ParamsLookupScope::Target) => increment(Metric::TargetParamsLookups, 1),
        Some(ParamsLookupScope::AbilityBuild) => increment(Metric::AbilityBuildParamsLookups, 1),
        Some(ParamsLookupScope::StaticAbility) => increment(Metric::StaticAbilityParamsLookups, 1),
        Some(ParamsLookupScope::ValidFilter) => increment(Metric::ValidFilterParamsLookups, 1),
        Some(ParamsLookupScope::GameLoop) => increment(Metric::GameLoopParamsLookups, 1),
        Some(ParamsLookupScope::Phase) => increment(Metric::PhaseParamsLookups, 1),
        Some(ParamsLookupScope::Priority) => increment(Metric::PriorityParamsLookups, 1),
        Some(ParamsLookupScope::PrioritySba) => increment(Metric::PrioritySbaParamsLookups, 1),
        Some(ParamsLookupScope::PriorityTrigger) => {
            increment(Metric::PriorityTriggerParamsLookups, 1)
        }
        Some(ParamsLookupScope::PrioritySnapshot) => {
            increment(Metric::PrioritySnapshotParamsLookups, 1)
        }
        Some(ParamsLookupScope::PrioritySnapshotSync) => {
            increment(Metric::PrioritySnapshotSyncParamsLookups, 1)
        }
        Some(ParamsLookupScope::PrioritySnapshotMetadata) => {
            increment(Metric::PrioritySnapshotMetadataParamsLookups, 1)
        }
        Some(ParamsLookupScope::PrioritySnapshotAbility) => {
            increment(Metric::PrioritySnapshotAbilityParamsLookups, 1)
        }
        Some(ParamsLookupScope::PrioritySnapshotCardClone) => {
            increment(Metric::PrioritySnapshotCardCloneParamsLookups, 1)
        }
        Some(ParamsLookupScope::PriorityChoice) => {
            increment(Metric::PriorityChoiceParamsLookups, 1)
        }
        Some(ParamsLookupScope::PriorityExecution) => {
            increment(Metric::PriorityExecutionParamsLookups, 1)
        }
        Some(ParamsLookupScope::StackResolution) => {
            increment(Metric::StackResolutionParamsLookups, 1)
        }
        Some(ParamsLookupScope::Combat) => increment(Metric::CombatParamsLookups, 1),
        None => increment(Metric::ParamsUnscopedLookups, 1),
    });
}

pub fn increment_params_parse() {
    increment(Metric::ParamsParses, 1);
}

pub fn increment_priority_snapshot() {
    increment(Metric::PrioritySnapshotsTaken, 1);
}

pub struct ParamsLookupScopeGuard {
    previous: Option<ParamsLookupScope>,
}

impl ParamsLookupScopeGuard {
    pub fn enter(scope: ParamsLookupScope) -> Option<Self> {
        if !enabled() {
            return None;
        }
        Some(PARAMS_LOOKUP_SCOPE.with(|current| {
            let previous = current.replace(Some(scope));
            Self { previous }
        }))
    }
}

pub fn current_params_lookup_scope() -> Option<ParamsLookupScope> {
    if !enabled() {
        return None;
    }
    PARAMS_LOOKUP_SCOPE.with(|current| current.get())
}

impl Drop for ParamsLookupScopeGuard {
    fn drop(&mut self) {
        PARAMS_LOOKUP_SCOPE.with(|current| current.set(self.previous));
    }
}

pub fn add_duration(metric: Metric, duration: Duration) {
    let nanos = duration.as_nanos().min(u128::from(u64::MAX)) as u64;
    increment(metric, nanos);
}

fn reset_wall_start() {
    if !enabled() {
        return;
    }
    WALL_START.with(|start| *start.borrow_mut() = Some(Instant::now()));
}

fn wall_total_ms() -> u64 {
    WALL_START.with(|start| {
        start
            .borrow()
            .map(|instant| instant.elapsed().as_millis() as u64)
            .unwrap_or(0)
    })
}

pub fn record_turn_wall(duration: Duration) {
    if !enabled() {
        return;
    }
    TURN_WALL_MS.with(|turn_wall_ms| turn_wall_ms.borrow_mut().push(duration.as_millis() as u64));
}

fn turn_wall_ms_summary() -> String {
    TURN_WALL_MS.with(|turn_wall_ms| {
        let turn_wall_ms = turn_wall_ms.borrow();
        let mut out = String::from("[");
        for (idx, ms) in turn_wall_ms.iter().enumerate() {
            if idx > 0 {
                out.push(',');
            }
            out.push_str(&ms.to_string());
        }
        out.push(']');
        out
    })
}

pub struct ScopeTimer {
    metric: Metric,
    start: Instant,
}

impl ScopeTimer {
    pub fn start(call_metric: Metric, duration_metric: Metric) -> Option<Self> {
        if !enabled() {
            return None;
        }
        increment(call_metric, 1);
        Some(Self {
            metric: duration_metric,
            start: Instant::now(),
        })
    }
}

impl Drop for ScopeTimer {
    fn drop(&mut self) {
        add_duration(self.metric, self.start.elapsed());
    }
}

pub struct SummaryGuard;

impl SummaryGuard {
    pub fn new() -> Option<Self> {
        if !enabled() {
            return None;
        }
        reset_wall_start();
        Some(Self)
    }
}

impl Drop for SummaryGuard {
    fn drop(&mut self) {
        print_summary();
    }
}

pub fn print_summary() {
    if !enabled() {
        return;
    }
    let calls = CONTINUOUS_EFFECTS_CALLS.load(Ordering::Relaxed);
    let continuous_ns = CONTINUOUS_EFFECTS_NS.load(Ordering::Relaxed);
    let continuous_avg_us = if calls == 0 {
        0
    } else {
        continuous_ns / calls / 1_000
    };
    let turn_wall_ms = turn_wall_ms_summary();
    eprintln!(
        concat!(
            "[forge-perf] summary ",
            "wall_total_ms={} turn_wall_ms={} ",
            "continuous_calls={} continuous_total_us={} continuous_avg_us={} ",
            "static_source_clones={} target_vecs={} params_parses={} params_lookups={} ",
            "params_unscoped_lookups={} ",
            "continuous_params_lookups={} action_space_params_lookups={} ",
            "action_space_playable_params_lookups={} ",
            "action_space_activatable_params_lookups={} ",
            "action_space_mana_source_params_lookups={} ",
            "action_space_untap_params_lookups={} ",
            "trigger_params_lookups={} replacement_params_lookups={} ",
            "cost_params_lookups={} target_params_lookups={} ",
            "ability_build_params_lookups={} static_ability_params_lookups={} ",
            "valid_filter_params_lookups={} selector_parses={} selector_matches={} ",
            "selector_raw_predicates={} game_loop_params_lookups={} ",
            "phase_params_lookups={} priority_params_lookups={} ",
            "priority_sba_params_lookups={} priority_trigger_params_lookups={} ",
            "priority_snapshots_taken={} ",
            "priority_snapshot_params_lookups={} ",
            "priority_snapshot_sync_params_lookups={} ",
            "priority_snapshot_metadata_params_lookups={} ",
            "priority_snapshot_ability_params_lookups={} ",
            "priority_snapshot_card_clone_params_lookups={} ",
            "priority_choice_params_lookups={} ",
            "priority_execution_params_lookups={} ",
            "stack_resolution_params_lookups={} combat_params_lookups={} ",
            "spell_ability_clones={} stack_entry_clones={} ",
            "game_state_targeting_clones={} snapshot_clones={} ",
            "card_state_collection_clones={}"
        ),
        wall_total_ms(),
        turn_wall_ms,
        calls,
        continuous_ns / 1_000,
        continuous_avg_us,
        CONTINUOUS_STATIC_SOURCE_CLONES.load(Ordering::Relaxed),
        CONTINUOUS_TARGET_VECS.load(Ordering::Relaxed),
        PARAMS_PARSES.load(Ordering::Relaxed),
        PARAMS_LOOKUPS.load(Ordering::Relaxed),
        PARAMS_UNSCOPED_LOOKUPS.load(Ordering::Relaxed),
        CONTINUOUS_PARAMS_LOOKUPS.load(Ordering::Relaxed),
        ACTION_SPACE_PARAMS_LOOKUPS.load(Ordering::Relaxed),
        ACTION_SPACE_PLAYABLE_PARAMS_LOOKUPS.load(Ordering::Relaxed),
        ACTION_SPACE_ACTIVATABLE_PARAMS_LOOKUPS.load(Ordering::Relaxed),
        ACTION_SPACE_MANA_SOURCE_PARAMS_LOOKUPS.load(Ordering::Relaxed),
        ACTION_SPACE_UNTAP_PARAMS_LOOKUPS.load(Ordering::Relaxed),
        TRIGGER_PARAMS_LOOKUPS.load(Ordering::Relaxed),
        REPLACEMENT_PARAMS_LOOKUPS.load(Ordering::Relaxed),
        COST_PARAMS_LOOKUPS.load(Ordering::Relaxed),
        TARGET_PARAMS_LOOKUPS.load(Ordering::Relaxed),
        ABILITY_BUILD_PARAMS_LOOKUPS.load(Ordering::Relaxed),
        STATIC_ABILITY_PARAMS_LOOKUPS.load(Ordering::Relaxed),
        VALID_FILTER_PARAMS_LOOKUPS.load(Ordering::Relaxed),
        SELECTOR_PARSES.load(Ordering::Relaxed),
        SELECTOR_MATCHES.load(Ordering::Relaxed),
        SELECTOR_RAW_PREDICATES.load(Ordering::Relaxed),
        GAME_LOOP_PARAMS_LOOKUPS.load(Ordering::Relaxed),
        PHASE_PARAMS_LOOKUPS.load(Ordering::Relaxed),
        PRIORITY_PARAMS_LOOKUPS.load(Ordering::Relaxed),
        PRIORITY_SBA_PARAMS_LOOKUPS.load(Ordering::Relaxed),
        PRIORITY_TRIGGER_PARAMS_LOOKUPS.load(Ordering::Relaxed),
        PRIORITY_SNAPSHOTS_TAKEN.load(Ordering::Relaxed),
        PRIORITY_SNAPSHOT_PARAMS_LOOKUPS.load(Ordering::Relaxed),
        PRIORITY_SNAPSHOT_SYNC_PARAMS_LOOKUPS.load(Ordering::Relaxed),
        PRIORITY_SNAPSHOT_METADATA_PARAMS_LOOKUPS.load(Ordering::Relaxed),
        PRIORITY_SNAPSHOT_ABILITY_PARAMS_LOOKUPS.load(Ordering::Relaxed),
        PRIORITY_SNAPSHOT_CARD_CLONE_PARAMS_LOOKUPS.load(Ordering::Relaxed),
        PRIORITY_CHOICE_PARAMS_LOOKUPS.load(Ordering::Relaxed),
        PRIORITY_EXECUTION_PARAMS_LOOKUPS.load(Ordering::Relaxed),
        STACK_RESOLUTION_PARAMS_LOOKUPS.load(Ordering::Relaxed),
        COMBAT_PARAMS_LOOKUPS.load(Ordering::Relaxed),
        SPELL_ABILITY_CLONES.load(Ordering::Relaxed),
        STACK_ENTRY_CLONES.load(Ordering::Relaxed),
        GAME_STATE_TARGETING_CLONES.load(Ordering::Relaxed),
        SNAPSHOT_CLONES.load(Ordering::Relaxed),
        CARD_STATE_COLLECTION_CLONES.load(Ordering::Relaxed),
    );
}

pub fn reset_counters() {
    if !enabled() {
        return;
    }
    reset_wall_start();
    TURN_WALL_MS.with(|turn_wall_ms| turn_wall_ms.borrow_mut().clear());
    for metric in [
        Metric::ContinuousEffectsCalls,
        Metric::ContinuousEffectsNs,
        Metric::ContinuousStaticSourceClones,
        Metric::ContinuousTargetVecs,
        Metric::ParamsParses,
        Metric::ParamsLookups,
        Metric::ParamsUnscopedLookups,
        Metric::ContinuousParamsLookups,
        Metric::ActionSpaceParamsLookups,
        Metric::ActionSpacePlayableParamsLookups,
        Metric::ActionSpaceActivatableParamsLookups,
        Metric::ActionSpaceManaSourceParamsLookups,
        Metric::ActionSpaceUntapParamsLookups,
        Metric::TriggerParamsLookups,
        Metric::ReplacementParamsLookups,
        Metric::CostParamsLookups,
        Metric::TargetParamsLookups,
        Metric::AbilityBuildParamsLookups,
        Metric::StaticAbilityParamsLookups,
        Metric::ValidFilterParamsLookups,
        Metric::SelectorParses,
        Metric::SelectorMatches,
        Metric::SelectorRawPredicates,
        Metric::GameLoopParamsLookups,
        Metric::PhaseParamsLookups,
        Metric::PriorityParamsLookups,
        Metric::PrioritySbaParamsLookups,
        Metric::PriorityTriggerParamsLookups,
        Metric::PrioritySnapshotsTaken,
        Metric::PrioritySnapshotParamsLookups,
        Metric::PrioritySnapshotSyncParamsLookups,
        Metric::PrioritySnapshotMetadataParamsLookups,
        Metric::PrioritySnapshotAbilityParamsLookups,
        Metric::PrioritySnapshotCardCloneParamsLookups,
        Metric::PriorityChoiceParamsLookups,
        Metric::PriorityExecutionParamsLookups,
        Metric::StackResolutionParamsLookups,
        Metric::CombatParamsLookups,
        Metric::SpellAbilityClones,
        Metric::StackEntryClones,
        Metric::GameStateTargetingClones,
        Metric::SnapshotClones,
        Metric::CardStateCollectionClones,
    ] {
        counter(metric).store(0, Ordering::Relaxed);
    }
}
