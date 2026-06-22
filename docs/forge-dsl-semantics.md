# Forge Card Script DSL — Runtime Semantics

> This document specifies the runtime behavior of the Forge card scripting
> language. It describes the execution model, not the syntax. For the
> syntactic grammar and parsing model, see `forge-dsl-grammar.md`.
>
> Cross-checked against the MTG Comprehensive Rules (April 17, 2026).
> Deviations from the CR are flagged inline where they occur; §11.1
> contains a consolidated list. Where Forge's implementation diverges
> from the CR, this document describes Forge's behavior. The CR remains
> the authoritative reference for Magic: The Gathering rules; this
> document is authoritative only for the Forge engine.

---

## 1. Conceptual Model

The Forge DSL is a **declarative, event-driven rule system**. It is not a
programming language. Card scripts do not specify control flow; they declare
rules that the engine evaluates against an evolving game state.

The runtime consists of three components:

- **GameState**: The complete, mutable state of the game — all zones
  (battlefield, hand, graveyard, library, exile, stack, command), all
  object properties (power, toughness, counters, controllers, keywords),
  player state (life, mana pool, poison), and turn/phase state.

- **Event Stream**: An ordered sequence of game events produced by
  actions and rule enforcement. Events are the sole input to triggers and
  replacement effects. Events are **immutable once emitted** — they
  describe what happened (or is about to happen), not what should happen.
  Replacement effects do not mutate existing events; they produce **new**
  event instances with modified parameters. The original event is
  discarded and never observed by triggers.

- **Rules**: The set of abilities (`A:`), triggers (`T:`), static
  abilities (`S:`), and replacement effects (`R:`) defined across all
  cards in the current GameState. Rules are evaluated by the engine
  against the event stream and current state. They do not execute
  themselves.

The system is **reactive**: the engine drives all execution. Card scripts
provide declarations that the engine consults at well-defined points in
the game loop. No rule runs unless the engine invokes it.

---

## 2. Rule Types

The four rule types differ in **when** they are evaluated, **what** they
observe, and **how** they affect state.

### 2.1 Abilities (`A:`)

Abilities are **effectful actions** that execute on the stack. They are
the sole mechanism by which card scripts mutate GameState (apart from
static ability layer application and cost payment).

There are two activation modes:

- **Activated abilities** (`AB$`): Placed on the stack when a player
  activates them. Require cost payment before they enter the stack.
- **Spell abilities** (`SP$`): Placed on the stack when the card is
  cast. They define the effect of an instant or sorcery, or the
  cast-triggered effect of a permanent spell.

Sub-abilities (`DB$`) are not independently activatable. They are
invoked only through SVar references from other abilities and resolve
as part of the parent ability's resolution chain.

### 2.2 Triggers (`T:`)

Triggers are **event matchers**. They observe the event stream and, when
a matching event occurs, produce an ability that is placed on the stack.

A trigger does not execute effects directly. It:

1. Tests whether an event matches its `Mode$` and filter params.
2. If matched, instantiates the ability referenced by its `Execute$` param.
3. Wraps that ability with trigger-specific context (the triggering
   objects) and places it on the stack.

Triggers are **passive**: they cannot fire unless the engine's trigger
evaluation step invokes them. A trigger that matches an event but whose
source has left its required `TriggerZones$` does not fire.

### 2.3 Static Abilities (`S:`)

Static abilities are **continuous, state-derived transformations**. They
do not use the stack. They do not respond to events. They apply
unconditionally and are recalculated whenever the engine checks static
abilities.

A static ability defines:

- A filter (`Affected$`) selecting which objects are modified.
- A set of modifications (keyword grants, P/T adjustments, type changes,
  restrictions, etc.).
- A layer at which the modifications apply (per the Comprehensive Rules
  layer system).

Static abilities are **pure** in the sense that they compute their
effect solely from the current GameState. They do not produce events,
do not consume events, and their evaluation has no side effects beyond
updating the derived state of affected objects.

Static ability evaluation may enable or disable other static abilities
(e.g., an ability that removes all abilities from a permanent). The
engine handles this through iterative re-evaluation within each layer,
continuing until a **fixpoint** is reached: the point at which applying
all active static abilities produces no further changes to the set of
active static abilities or their affected objects. If no fixpoint is
reached within a bounded number of iterations, the engine terminates
evaluation using implementation-defined safeguards (e.g., aborting
further iteration, or falling back to a stable approximation). The
specific behavior on non-convergence is not prescribed by the DSL.

### 2.4 Replacement Effects (`R:`)

Replacement effects **intercept and transform events** before they are
observed by triggers. They do not use the stack.

A replacement effect defines:

- An event type (`Event$`) to intercept.
- A filter (`ValidCard$` or other predicates) selecting which instances
  of that event type are intercepted.
- A replacement action (`ReplaceWith$`) that either produces a new event
  with modified parameters, replaces the event with a different outcome,
  or prevents the event entirely.

Replacement effects produce a **new event** with modified parameters (or
no event, in the case of prevention). The original event is discarded.
Triggers then evaluate against the replacement event, not the original.
If the event is prevented (no replacement event produced), the pipeline
stops: steps 3–4 (event finalization and trigger evaluation) are skipped
entirely. This ordering is an invariant (§9.1).

---

## 3. Execution Pipeline

When a game action produces an event, the engine processes it through
the following pipeline. Each step completes fully before the next begins.

```
 ┌─────────────────────────────┐
 │  1. Event Emitted           │
 └──────────┬──────────────────┘
            ▼
 ┌─────────────────────────────┐
 │  2. Replacement Effects     │  Intercept event; may produce
 │     (iterative application) │  modified event, or prevent it.
 └──────────┬──────────────────┘
            ▼
 ┌─────────────────────────────┐
 │  3. Event Finalized         │  The (possibly modified) event
 │                             │  becomes the input to triggers.
 └──────────┬──────────────────┘
            ▼
 ┌─────────────────────────────┐
 │  4. Trigger Evaluation      │  All matching triggers fire;
 │                             │  abilities placed on stack.
 └──────────┬──────────────────┘
            ▼
 ┌─────────────────────────────┐
 │  5. Stack Resolution        │  LIFO. Each resolved ability
 │     (see §4)                │  may emit new events → goto 1.
 └──────────┬──────────────────┘
            ▼
 ┌─────────────────────────────┐
 │  6. Static Re-evaluation    │  Continuous effects re-applied
 │     (layered)               │  across all affected objects.
 └─────────────────────────────┘
```

Steps 5 and 6 may produce new events, restarting the pipeline. The
engine continues until no new events remain and the stack is empty.

### 3.1 Replacement Effect Application (Step 2)

Replacement effects are applied through **iterative, layered
application**. The engine processes replacement effects in five layers,
evaluated sequentially:

| Order | Layer      | CR Reference | Behavior                                                                                                                |
| ----- | ---------- | ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 1     | CantHappen | —            | "Can't" effects that prevent the event entirely                                                                         |
| 2     | Control    | CR 616.1b    | Control-changing replacement effects                                                                                    |
| 3     | Copy       | CR 616.1c    | Copy-as-ETB replacement effects                                                                                         |
| 4     | Transform  | —            | "As this permanent transforms" replacement effects (e.g., choosing an opponent, becoming a copy, attaching to a player) |
| 5     | Other      | —            | All remaining replacement effects                                                                                       |

**CR deviation**: CR 616.1 specifies a different ordering that
distinguishes self-replacement effects (CR 614.15) as a separate first
step before control/copy/other. Forge groups replacements into five
flat layers for implementation tractability. The CantHappen layer has
no direct CR equivalent as a separate category — the CR treats "can't"
effects as ordinary replacement effects. The Transform layer handles
Forge-specific `Event$ Transform` replacement effects for DFC/transform
cards; these have no dedicated CR subsection.

For each layer, the engine iterates as follows:

a. Collect all applicable replacement effects in this layer for the
current event.
b. If the layer is `CantHappen` and any effect applies, the event is
prevented and the pipeline halts (step 3 of §3 is skipped). No
player ordering choice is required.
c. For all other layers, if multiple effects apply, the affected
player, or the controller of the affected object or objects (as
defined by the event type), chooses which to apply first. This
choice is a **deterministic input** — it is part of the player
decision sequence that determines the game trace (§9.3).
d. The chosen replacement produces a **new event** with modified
parameters. The original event is discarded.
e. The engine re-evaluates whether remaining replacement effects in
this layer still apply to the new event and continues applying them
until none remain in this layer, then proceeds to the next layer.

A replacement effect whose result is `Updated` causes the engine to
**restart replacement evaluation** from layer 1 with the new event
instance (not the original). This permits chaining: the new event
produced by one replacement becomes the input to subsequent replacement
evaluation.

### 3.2 Trigger Evaluation (Step 4)

When the finalized event reaches the trigger evaluation step, the engine
takes a **snapshot** of the current GameState. Trigger matching is
evaluated against this snapshot, not against a GameState that may be
concurrently modified by other trigger placement.

1. The engine iterates all active triggers in the game.
2. For each trigger, it checks (against the snapshot):
   - Does the trigger's `Mode$` match the event type?
   - Is the trigger's source in one of its `TriggerZones$`?
   - Do the trigger's filter params (`ValidCard$`, etc.) match the
     event's objects?
   - Has the trigger's activation limit been reached?
   - Is the trigger suppressed by a static ability?
3. Each matching trigger instantiates its `Execute$` ability, binds the
   triggering objects (e.g., `TriggeredCard`, `TriggeredPlayer`), and
   places the resulting ability on the stack.

The set of matching triggers and their ordering is determined from the
snapshot and does not change during the evaluation pass.

Triggers that are created during the current evaluation pass (e.g., by
a static ability that grants a trigger to a newly affected object) are
**not** evaluated in the same pass. They become active for subsequent
events only.

If the stack is **frozen** (cost payment or spell casting is in progress),
triggered abilities are deferred to a waiting queue. They are placed on
the stack when the stack unfreezes.

### 3.3 Static Re-evaluation (Step 6)

After each stack resolution, the engine re-evaluates all static abilities
across the entire GameState. This is a full recalculation, not
incremental:

1. All previously applied continuous effects are cleared.
2. All static abilities with mode `Continuous` are collected.
3. They are applied in **layer order** (see §6).
4. Within each layer, **dependency analysis** determines application
   order: if effect A would change the existence, text, or applicability
   of effect B, then A depends on B and B is applied first.
5. If a circular dependency exists, effects are applied in timestamp
   order (oldest first).
6. After all layers are applied, `Always` and `Immediate` triggers are
   evaluated.
7. State-based actions are evaluated after static ability re-evaluation
   and before the next event is processed.

---

## 4. Stack Semantics

The stack is the engine's mechanism for ordering and resolving abilities.

### 4.1 Structure

The stack is a **last-in, first-out (LIFO) deque** of ability instances.
Each entry on the stack is a fully instantiated ability with bound
targets, costs already paid, and context attached.

### 4.2 Entering the Stack

An ability enters the stack when:

- A player activates an activated ability (`AB$`) and pays its costs.
- A player casts a spell (the `SP$` ability enters the stack).
- A trigger fires and its `Execute$` ability is instantiated.

**Mana abilities are an exception**: they resolve immediately without
using the stack.

Before an ability enters the stack, the following steps occur in order:

1. All targets must be chosen and validated (§4.6).
2. All costs must be paid (§8).
3. The ability is copied (activated abilities use a fresh copy to
   prevent mutation of the template).

### 4.3 Resolution

The engine resolves the stack by repeatedly:

1. Popping the top ability.
2. Checking whether it has **fizzled**: an ability fizzles if and only if
   **all** of its targets have become illegal (see §4.6.3 for the
   `CantFizzle` exception). If at least one target
   remains legal, the ability resolves with only the remaining legal
   targets. All computations over targets use only the remaining legal
   targets; illegal targets are treated as absent.
3. If not fizzled, resolving the ability:
   a. Evaluating pre-conditions.
   b. Executing the ability's effect (the API-specific logic).
   c. Resolving the sub-ability chain (§5.3).
4. Firing an `AbilityResolves` event.
5. Removing the ability from the stack.
6. Re-evaluating static abilities.

An ability resolves even if its source object no longer exists (e.g.,
the creature that activated the ability has since been destroyed), unless
the ability explicitly requires its source to be present (e.g., abilities
that reference `Self` for ongoing effects).

Between each resolution, players receive priority. New abilities may be
added to the stack before the next resolution.

### 4.4 State Mutation Sources

**Only ability resolution, cost payment, and state-based actions (SBAs)
mutate base GameState.** This is a central invariant. Triggers do not
mutate state (they produce abilities). Static abilities modify derived
properties but do not change base state. Replacement effects produce new
events but do not directly alter GameState — the replacement event still
proceeds through the normal pipeline.

Cost payment (§8) mutates state as a precondition to stack entry.
State-based actions (e.g., a creature with 0 or less toughness is
destroyed, a player with 0 or less life loses the game) are checked and
applied by the engine at well-defined points outside the DSL's rule
system. SBAs are not expressible in card scripts; they are engine-level
invariants.

### 4.5 Frozen Stack

During cost payment or while a spell is being cast, the stack is
**frozen**. Abilities that would enter the stack during this period
(typically from triggers fired by cost payment) are deferred to a
waiting queue. When the stack unfreezes, all deferred abilities are
moved onto the stack in the order they were generated.

### 4.6 Targeting

Targeting is the mechanism by which an ability selects the game objects
it will affect. Not all abilities have targets — only those whose
`ParamRecord` contains a `ValidTgts$` param (or equivalent targeting
params) are targeted.

#### 4.6.1 Target Selection (on cast/activation)

Targets are chosen **when a spell is cast or an ability is activated**,
before the ability enters the stack. The process:

1. The engine determines the targeting player (from `TargetingPlayer$`
   if present, otherwise the activating player).
2. The targeting player selects objects that satisfy all of:
   - The `ValidTgts$` selector (e.g., `Creature`, `Any`,
     `Creature.OppCtrl`).
   - The zone constraint specified by `TgtZone$` (default: Battlefield).
     Phased-out objects are excluded at the zone level — they are treated
     as not existing and are never candidates.
   - All multi-target constraints (see §4.6.4).
   - The object's own targetability: neither a static `CantTarget`
     ability (§4.6.5) nor a keyword (hexproof, shroud, protection from
     the relevant quality) prevents this ability from targeting it.
3. The number of selected targets must satisfy `TargetMin$` and
   `TargetMax$` (defaults per grammar §10). These values may be dynamic
   expressions (e.g., `X`, `Count$`).
4. If insufficient legal targets exist to meet `TargetMin$`, the
   cast/activation attempt is illegal. No state changes occur (costs
   have not yet been paid); the player may make a different choice or
   take no action.
5. For abilities that distribute a quantity across targets (e.g.,
   `DividedAsYouChoose$` on a `DealDamage` ability), the targeting
   player also assigns the distribution at this time. The distribution
   is bound to the ability instance alongside the target choices.

Target choices (and distribution, if applicable) are bound to the
ability instance and stored with it on the stack. Sub-abilities may have
independent targeting requirements, evaluated recursively.

#### 4.6.2 Target Legality Check (on stack entry)

Before an ability is added to the stack, the engine validates that
targeting is legal: the correct number of targets has been chosen, and
each target satisfies the ability's constraints. If this check fails,
the ability does not enter the stack.

#### 4.6.3 Target Re-validation (on resolution)

When an ability resolves (§4.3), the engine re-checks every target for
legality (per CR 608.2b). A target has become **illegal** if any of the
following is true since the target was chosen:

- The object has left the zone it was in when targeted. This includes
  the case where an object was exiled and returned — it is a new game
  object (different timestamp/ID) and the original target no longer
  exists in any zone.
- The object's characteristics have changed such that it no longer
  matches the `ValidTgts$` selector (e.g., it is no longer a creature
  due to a type-changing effect).
- A static ability now prevents this ability from targeting this object.
  This covers both target-side changes (the target gained hexproof or
  protection relevant to the source) and source-side changes (a new
  restriction applies to what the source may target).
- A multi-target constraint is no longer satisfied for the remaining
  legal targets.

Per CR 608.2b, if the source of an ability has left its zone, its last
known information (LKI) should be used for legality determination.
Forge's fizzle check (`hasFizzled`) validates only targets, not the
source — the `source` parameter is passed but not consulted. This means
Forge does not check source-zone legality during fizzle evaluation at
all, which is more permissive than the CR requires.

The fizzle rule (§4.3 step 2) applies: if **all** targets are illegal,
the ability fizzles. If at least one remains legal, the ability resolves
using only the legal targets. Illegal targets are removed from the
target set before effect execution.

For abilities with divided distribution, the distribution is fixed at
target selection (§4.6.1 step 5); amounts assigned to illegal targets
are simply not applied, and they are not redistributed to remaining
legal targets.

An ability with the `CantFizzle` param does not fizzle even if all
targets become illegal. In this case, the ability resolves with an
empty target set: components that iterate over targets (e.g., damage
assignment) produce no effect, but non-targeted components of the same
ability (e.g., a sub-ability whose own params do not reference
`Targeted`) still execute normally.

#### 4.6.4 Multi-Target Constraints

When an ability targets multiple objects, additional params may constrain
the relationship between targets. These are checked both at selection
time and at resolution re-validation. Param names retain the historical
`CMC` suffix; semantically these refer to mana value per current
Comprehensive Rules.

| Param                              | Constraint                                        |
| ---------------------------------- | ------------------------------------------------- |
| `TargetUnique$`                    | No duplicate targets                              |
| `TargetsWithSameController$`       | All targets share a controller                    |
| `TargetsWithDifferentControllers$` | All targets have different controllers            |
| `TargetsWithSameCreatureType$`     | All targets share a creature type                 |
| `TargetsWithoutSameCreatureType$`  | All targets have different creature types         |
| `TargetsWithSameCardType$`         | All targets share a card type                     |
| `TargetsWithEqualToughness$`       | All targets have equal toughness                  |
| `TargetsWithDifferentCMC$`         | All targets have different mana values            |
| `MaxTotalTargetCMC$`               | Sum of targets' mana values does not exceed limit |
| `MaxTotalTargetPower$`             | Sum of targets' power does not exceed limit       |

This set is open and extensible.

#### 4.6.5 Targeting and Selectors

The `ValidTgts$` param uses the same selector syntax as other selector
params (grammar §4.5), but with a crucial behavioral difference:
selector evaluation for targeting includes a **targetability check**
that non-targeting selectors do not perform. An object may match a
selector (e.g., `Creature.OppCtrl`) but be untargetable due to hexproof,
protection, or a static `CantTarget` ability.

Conversely, non-targeting uses of the same selector (e.g., `ValidCards$`
on a `DestroyAll` effect) are **not** subject to the targetability
check. This is why effects like "destroy all creatures" affect
hexproof creatures: hexproof prevents targeting, not selection.

The `CantTarget` static ability mode (grammar §6) is enforced at both
target selection time (§4.6.1 step 2) and target re-validation (§4.6.3).
It is evaluated using the current derived state (post-static-ability
application) of both the target and the source at each checkpoint.

---

## 5. SVar Composition

SVars are the DSL's composition mechanism. They define **named,
reusable fragments** scoped to a single card face.

### 5.1 SVar Table

Each card face maintains a flat map from SVar names to SVar bodies
(raw strings). There is no nesting, scoping, or shadowing. All SVars
on a face are peers.

### 5.2 Resolution

SVar resolution is **late-bound**: an SVar reference (e.g.,
`Execute$ TrigDraw`) is resolved at the moment the engine needs its
value, not at parse time or card construction time.

Resolution proceeds as follows:

1. The engine encounters an SVar-reference param (e.g., `Execute$ Foo`).
2. It looks up `Foo` in the SVar table of the ability's host card
   (specifically, the card's current state — transforms, copies, and
   other state changes may alter the available SVars).
3. The SVar body is interpreted according to its form (§2.7 of the
   grammar document): as an ability, a param record, or a raw expression.
4. If the body is an ability, it is instantiated with the calling
   ability's context, captured at the time the reference is evaluated
   (activating player, targets, triggering objects).

If the SVar name is not found in the host card's SVar table, resolution
has failed. This is an **authoring error** in the card script. Handling
of unresolved SVars is implementation-defined: the engine may skip the
reference silently, log a diagnostic, or substitute a no-op ability.
The grammar and semantics do not prescribe a specific failure mode.

Implementations must detect both direct and indirect SVar recursion
(e.g., `Execute$ A` where SVar `A` references `Execute$ A`, or
`A → B → A`) and prevent unbounded expansion. Detection and handling
of such loops is implementation-defined (§10.1).

### 5.3 Sub-Ability Chains

Abilities may reference sub-abilities via `SubAbility$`,
`TrueSubAbility$`, `FalseSubAbility$`, and similar params. These
form a **resolution chain**: after the parent ability's effect executes,
the sub-ability is resolved in sequence.

```
A:SP$ DealDamage | SubAbility$ DBGainLife | ...
SVar:DBGainLife:DB$ GainLife | LifeAmount$ 3
```

Resolution order within a chain is **strictly sequential**: the parent
effect completes before the sub-ability begins. The entire chain
resolves as a single stack entry — sub-abilities do not independently
occupy the stack.

`TrueSubAbility$` and `FalseSubAbility$` introduce conditional
branching: the engine evaluates a runtime condition and selects exactly
one branch to resolve. The unchosen branch is discarded.

If any sub-ability in a chain fails to resolve (e.g., its SVar reference
is unresolved, or a precondition check fails), the chain **terminates**
at that point. Subsequent sub-abilities in the chain are not executed.
No rollback occurs for already-executed steps: the parent ability's
effect and any previously resolved sub-abilities in the chain retain
their state changes.

### 5.4 SVar Graph

The set of all SVars on a card face, together with the references
between them, forms a **directed graph**. Nodes are SVars; edges are
references (via `Execute$`, `SubAbility$`, etc.).

This graph may contain:

- **Chains**: linear sequences (`A → B → C`).
- **Fan-out**: one SVar referencing multiple others (e.g., `Choices$`
  in modal abilities).
- **Convergence**: multiple SVars referencing the same target.
- **Cycles**: `A → B → A`. The grammar does not forbid cycles. Cycle
  detection is the responsibility of the runtime. In practice, cycles
  indicate authoring errors.

### 5.5 Expression SVars

SVars whose body is a raw expression (not an ability) evaluate to a
scalar value at runtime. They are typically referenced by `Amount`-type
params.

```
SVar:X:Count$xPaid
SVar:Z:SVar$Z1/Plus.Z2
```

Expression evaluation may recursively reference other expression SVars,
forming an evaluation graph. The engine evaluates expressions by
recursive descent through the SVar table.

---

## 6. Static Ability Layer System

Static abilities that modify game object properties are applied in a
**fixed layer order** derived from the Magic: The Gathering Comprehensive
Rules (CR 613), with implementation deviations noted below. This ensures
deterministic results regardless of the order in which static abilities
entered the game.

The layers, in application order:

| Layer | Sublayer | Effect Type                                                           |
| ----- | -------- | --------------------------------------------------------------------- |
| 1     | —        | Copy effects, copiable values, mutate modifications, face-down status |
| 2     | —        | Control-changing effects                                              |
| 3     | —        | Text-changing effects                                                 |
| 4     | —        | Type-changing effects                                                 |
| 5     | —        | Color-changing effects                                                |
| 6     | —        | Ability-adding/removing effects (including keyword counters)          |
| 7     | 7a       | Characteristic-defining abilities that define power and/or toughness  |
| 7     | 7b       | Effects that set power and/or toughness to specific values            |
| 7     | 7c       | Effects that modify power and/or toughness (+N/+M, -N/-M, counters)   |
| 8     | —        | Game rule-changing effects (can't attack, can't block, etc.)          |

**CR deviation**: The CR defines 7 layers with sublayers 7a–7e under
layer 7. Forge's implementation adds an 8th layer for rule-changing
effects (restrictions, prohibitions). Additionally, Forge does not
implement sublayer 7d (P/T changes from counters as a separate
sublayer — these are folded into 7c) or sublayer 7e (P/T switching
effects like `Inside Out`).

Within a single layer, effects are applied in **timestamp order**
(oldest first), unless a dependency exists between them. If effect A
would change the existence, text, or applicability of effect B within
the same layer, then B depends on A and A is applied first.

Mutual dependencies (cycles) are resolved by falling back to timestamp
order.

---

## 7. Selectors at Runtime

Selectors are **pure query expressions** evaluated against the current
GameState. They define sets of game objects.

### 7.1 Evaluation

A selector is evaluated by:

1. Starting with the universe of all objects in the relevant zones.
2. For each part in a selector chain (`.` or `+` separated), filtering
   the set by that predicate.
3. For `&`-separated chains, intersecting the results.
4. For `,`-separated alternatives, taking the union.

The result is an unordered set of game objects. The result set **may be
empty**. All consumers of selector results (targeting, filtering,
counting) must handle the empty set safely: an empty selector result is
a valid outcome, not an error.

When iterating over selector results, the iteration order is
**implementation-defined** but must be **stable** within a single
evaluation: iterating the same result set twice in the same resolution
step must produce the same order.

### 7.2 Purity

Selector evaluation has **no side effects**. It reads GameState but does
not modify it. A selector evaluated twice against the same GameState
produces the same result.

### 7.3 Context Sensitivity

Some selector parts depend on runtime context:

- `YouCtrl`, `OppCtrl` depend on the current evaluating player.
- `Self` depends on the source card.
- `TriggeredCard` depends on the triggering event's bound objects.
- Comparison filters (`cmcLE3`) depend on the current derived
  properties of each candidate object (which may be affected by
  static abilities in higher layers).

---

## 8. Cost Semantics

Costs represent **preconditions and required state changes** that must
be satisfied before an ability enters the stack.

### 8.1 Cost Payment Order

Costs are paid in a **fixed priority order** designed to maximize
reversibility:

| Priority | Cost Type                                        | Reversibility        |
| -------- | ------------------------------------------------ | -------------------- |
| 0–4      | Tap self, pay mana                               | Fully undoable       |
| 5        | Most other costs (discard, exile from hand)      | Undoable with effort |
| 6–10     | Pay life, gain control                           | Difficult to undo    |
| 11–15    | Zone changes (sacrifice, exile from battlefield) | Irreversible         |
| 16+      | Untap                                            | Last                 |

The engine processes cost components left-to-right within each priority
tier. All components must be satisfied for the ability to enter the
stack. If any component cannot be paid, the engine performs a **rollback**:
state changes from previously paid cost components in this activation are
undone where possible, restoring GameState as closely as possible to its
pre-activation condition. For cost components with external or non-reversible side
effects (e.g., events already processed by replacement effects during
cost payment), rollback behavior is implementation-defined. No partial
cost payment persists in the visible GameState.

### 8.2 Cost as State Mutation

Cost payment is a **pre-stack state mutation**. Unlike ability
resolution, which occurs during stack resolution, costs are paid before
the ability enters the stack. This means:

- Sacrificed creatures leave the battlefield before the ability is on
  the stack.
- Life paid is lost before the ability can be responded to.
- Tapped permanents are tapped before priority passes.

Costs that produce events (e.g., sacrificing a creature produces a
zone-change event) follow the normal event pipeline: replacement effects
apply, and triggers are queued (but deferred until the stack unfreezes).

### 8.3 Mana Abilities

Mana abilities (abilities with API `Mana` and cost `T` or similar) are
a special case: they **resolve immediately**, bypassing the stack and
player priority entirely. Their effect is applied inline at the point
of activation. This permits mana abilities to be activated during cost
payment of another ability without freezing or unfreezing the stack.
Triggers may still be generated by mana ability activation (e.g.,
ability-specific triggers on the mana source), but they are deferred to
the waiting queue and not evaluated until the stack unfreezes.

---

## 9. Determinism and Ordering

### 9.1 Pipeline Ordering Invariants

The following ordering constraints are absolute and must be preserved:

1. **Replacement effects apply before triggers.** A trigger never
   observes an event that has not passed through replacement effect
   evaluation.

2. **Triggers are evaluated after the event is finalized.** The set of
   matching triggers is determined from the post-replacement event.

3. **Stack resolves strictly LIFO.** The most recently added ability
   always resolves first (assuming no new abilities are added between
   resolutions).

4. **Static abilities are re-evaluated after each stack resolution.**
   The derived state is always consistent with the current base state
   before the next resolution begins.

### 9.2 Simultaneous Trigger Ordering

When multiple triggers match the same event simultaneously, they are
ordered by the **Active Player, Non-Active Player (APNAP)** rule:

1. Triggers controlled by the active player are ordered first.
2. Among triggers controlled by the same player, the controller chooses
   the order.
3. Triggers controlled by non-active players follow, in turn order.

This ordering determines the order in which triggered abilities are
placed on the stack. Because the stack is LIFO, the last-placed trigger
resolves first.

### 9.3 Determinism Boundaries

The DSL execution model is **deterministic** given a fixed sequence of
player decisions. Non-determinism arises only from:

- Player choices (targets, ordering, optional effects).
- Replacement effect ordering choices (§3.1).
- Library order (shuffling).
- Coin flips and die rolls.

Replacement effect ordering choices made by players are part of the
deterministic input sequence: given the same choices, the same outcome
is produced.

Iteration over unordered collections (e.g., selector result sets) must
be stable within a single evaluation to preserve determinism.

Given identical inputs and identical player decisions, the same
GameState sequence is produced.

---

## 10. System Invariants

The following invariants hold at all times during execution:

1. **Events are immutable.** Once an event is emitted, its parameters
   are fixed. Replacement effects produce new, modified events — they
   do not mutate the original.

2. **Replacement effects transform events only.** They do not directly
   mutate GameState, produce abilities, or place objects on the stack.
   Their sole output is a (possibly modified) event.

3. **Static abilities are pure.** Evaluating a static ability reads
   GameState but does not modify base state. Static abilities affect
   only the derived layer of object properties. They do not produce
   events.

4. **Only ability resolution, cost payment, and state-based actions
   mutate base GameState.** No other part of the pipeline (trigger
   matching, static evaluation, replacement application, selector
   evaluation) modifies the base state of any game object. Event
   emission is not a GameState mutation — events are a separate data
   stream (§1).

5. **The stack is the sole serialization point for effects.** All
   player-interactive effects pass through the stack. This ensures that
   players always have the opportunity to respond before effects resolve.
   Mana abilities are the sole exception (§8.3).

6. **Selector evaluation is side-effect-free.** Evaluating a selector
   against GameState is a pure read operation. It may be performed at
   any point without altering program behavior.

7. **SVar resolution is scoped to the host card's current state.** An
   SVar lookup reads from the SVar table of the card as it currently
   exists. State-based changes to the card (transform, copy, exile) may
   alter the available SVars.

8. **Event processing is atomic per pipeline pass.** Intermediate states
   within a single pass through the execution pipeline (§3) are not
   observable by other rules. Triggers, static abilities, and replacement
   effects only observe the state at the well-defined evaluation points
   between pipeline steps.

9. **Effect application is atomic.** No rule observes partially applied
   effects. All effects of a resolved ability are applied atomically
   before subsequent evaluation (trigger matching, static re-evaluation,
   or the next stack resolution).

### 10.1 Termination

The DSL does not guarantee termination. Card scripts may produce
infinite loops through trigger chains that emit events which re-trigger
themselves, SVar graphs containing cycles, or replacement effects that
endlessly re-apply. The engine must implement guards against
non-termination (e.g., a maximum trigger count per event, a maximum
stack depth, or a maximum number of iterations per resolution cycle).
These guards are implementation-defined and not part of the DSL
specification.

---

## 11. Conformance: Implementation-Defined Behaviors

A conforming engine produces observable behavior consistent with §§1–10
for all well-formed inputs. The behaviors below are deliberately
under-specified: any handling strategy is conforming provided it does
not violate the invariants of §10.

Section references without a prefix are to this document; "Grammar §X"
references the companion grammar spec.

| Behavior                                               | Section      | Requirement / Freedom                                                                                  |
| ------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------ |
| Static ability fixpoint non-convergence                | §2.3         | Engine must bound iteration count; on non-convergence may abort or fall back to a stable approximation |
| Unresolved SVar reference                              | §5.2         | Resolution failure must not crash the engine; recovery strategy (skip, log, no-op) is free             |
| SVar recursion (direct or indirect)                    | §5.2         | Engine must detect and prevent unbounded expansion; detection strategy is free                         |
| Sub-ability chain failure handling                     | §5.3         | Chain terminates; whether failure is logged, silently skipped, or surfaced as error is free            |
| Selector iteration order                               | §7.1         | Must be stable within a single evaluation; specific order is free                                      |
| Cost rollback for non-reversible side effects          | §8.1         | Events already processed during cost payment may not be undoable; extent of rollback is free           |
| Replacement ordering when affected player is ambiguous | §3.1         | Tie-breaking rule (APNAP, timestamp, or other) is free                                                 |
| Termination guards                                     | §10.1        | Engine must implement guards against non-termination; thresholds and strategy are free                 |
| Amount `RawValue` fallback uninterpretable at runtime  | Grammar §4.8 | Authoring error; engine may error, default to 0, or skip                                               |

### 11.1 Known CR Deviations

The following behaviors intentionally differ from the MTG Comprehensive
Rules for implementation tractability:

| Section | Forge Behavior                                                                                                                     | CR Behavior                                                                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| §3.1    | 5-layer replacement model (CantHappen / Control / Copy / Transform / Other); CantHappen and Transform have no direct CR subsection | CR 616.1: self-replacement effects first, then control / copy / other by player choice; no CantHappen or Transform categories |
| §6      | 8 layers (1–6, 7a–7c, 8); sublayer 7d folded into 7c; 7e (P/T switch) unimplemented; layer 8 (rules) added                         | CR 613.1: 7 layers with sublayers 7a–7e; no layer 8                                                                           |
| §4.6.3  | Fizzle check validates only targets, not the source; source-zone legality is not checked                                           | CR 608.2b: if the source has left its zone, its LKI is used for legality determination                                        |
