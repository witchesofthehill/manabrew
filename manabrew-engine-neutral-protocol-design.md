# Manabrew Engine-Neutral Protocol Design

## Purpose

This document proposes an engine-neutral Manabrew protocol shape for Magic-style
rules engines and clients. It is not an adapter-specific compatibility note. The
goal is a wire contract that multiple independent engines can implement without
leaking engine internals, while still giving clients enough structure to render
legal choices, payments, combat, targeting, logs, and multiplayer relay flows.

Evidence base:

- Manabrew protocol docs at upstream commit `1386825c57c5457485507ebf41a55e5cf1605280`.
- Generated protocol JSON and Rust protocol sources from the same commit.
- Current Manabrew stated goals: transport-agnostic JSON, opaque ids, prompts
  without embedded game state, vendor-prefixed extensions, and soft handling of
  unknown prompt types.

## Design Principles

1. **Engine authority stays absolute.** The client renders state and submits
   selected decisions. It never derives legality, costs, targets, damage
   assignment, or hidden information.
2. **The protocol describes prompt decisions, not engine actions.** An engine may keep
   internal action tables, but the public wire shape must use protocol-level
   decision outputs correlated to prompts.
3. **Targets and choices are distinct.** A rules target is not the same thing as
   a card chosen for discard, sacrifice, reordering, payment, or display.
4. **Prompts are stable contracts.** Every response is validated by `promptId`,
   prompt family, deciding player, and response shape.
5. **Transport wrappers do not change payload semantics.** Direct responses and
   relayed responses wrap the same `PromptResponse` object.
6. **Core shapes are typed; extensions are namespaced.** Engines can innovate
   through declared vendor extensions, but core clients can ignore unknown
   extension fields safely.
7. **State is sequenced and audience-aware.** Clients need enough metadata to
   reject stale prompts, order display events, and avoid leaking private state.

## Top-Level Messages

The protocol should define payloads independently from the transport that
carries them:

```ts
type ProtocolMessage =
  | Hello # Must add
  | StateUpdate
  | DisplayEvent
  | AgentPrompt
  | PromptResponse
  | ProtocolError; # Must add
```

For multiplayer relay, wrap the same payloads:

```ts
type RelayEnvelope =
  | { kind: "state"; forPlayer: PlayerId; state: StateUpdate }
  | { kind: "display"; forPlayerIds?: PlayerId[]; event: DisplayEvent }
  | { kind: "prompt"; forPlayer: PlayerId; prompt: AgentPrompt }
  | { kind: "response"; fromPlayer: PlayerId; response: PromptResponse }
  | { kind: "error"; forPlayer?: PlayerId; error: ProtocolError };
```

`forPlayer` and `fromPlayer` are relay routing metadata. They must not replace
`decidingPlayerId` or `promptId` inside the prompt/response payload.

## Version And Capabilities

Every session should begin with a capability handshake:

```ts
type Hello = {
  kind: "hello";
  protocolVersion: string;
  implementation: {
    name: string;
    version?: string;
  };
  capabilities: {
    // I don't think we can implement capabilities on hello for V1, skip
    promptTypes: string[];
    outputTypes: string[];
    displayEventTypes: string[];
    actionTypes: string[];
    extensions?: string[];
  };
};
```

Compatibility rule:

- Major protocol version mismatch is fatal.
- Unknown prompt/output/display types are soft errors unless declared required
  by the sender.
- Vendor extensions use namespaced strings such as `example-engine.foo` or
  `manabrew.foo`, and unknown extension fields are ignored. # note: For V1, forget extensions

## Identifiers

All ids are opaque strings scoped to one game session:

```ts
type PlayerId = string;
type ObjectId = string;
type CardId = string;
type StackObjectId = string;
type ZoneId = string;
type PromptId = number;
type StateSeq = number;
```

Clients must not infer type or ownership from id prefixes. If a payload needs
the kind, it carries the kind explicitly.

## State Model

`StateUpdate` is the only authoritative game-state message:

```ts
type StateUpdate = {
  kind: "state";
  gameId: string;
  stateSeq: StateSeq; // note: For V1, no state sequence. Theres only one prompt, to a list of players, at a given time
  view: GameView;
};
```

`GameView` should be a recipient-specific public/private projection:

```ts
type GameView = {
  gameId: string;
  turn: number;
  step: string;
  activePlayerId: PlayerId;
  priorityPlayerId?: PlayerId;
  players: PlayerView[];
  zones: ZoneView[];
  battlefield: ObjectView[];
  stack: StackObjectView[];
  combat?: CombatView;
  gameOver: boolean;
  winnerIds?: PlayerId[];
  markers?: Record<string, unknown>;
};
```

note: For V1, aguably, we could make the zones generic.
A zone is a map with a typed key.
In this case, the keys are the magic zones:
battlefield, graveyard, exile, hand, library, etc..

Cards and permanents should distinguish object identity from visibility:

```ts
type ObjectView = {
  id: ObjectId;
  visibility: "visible" | "hidden" | "partial";
  identity?: CardIdentity;
  characteristics?: CardCharacteristics;
  controllerId?: PlayerId;
  ownerId?: PlayerId;
  zoneId: ZoneId;
  status?: ObjectStatus;
  attachments?: ObjectId[];
  counters?: Record<string, number>;
  x?: Record<string, unknown>;
};
```

node: mmmh this is slop?

This avoids requiring engines to fabricate visible card fields for hidden cards.

## Prompt Envelope

Prompts do not carry `GameView`; they refer to the latest state by sequence:

```ts
type AgentPrompt = {
  kind: "prompt";
  promptId: PromptId;
  stateSeq: StateSeq;
  decidingPlayerId: PlayerId;
  subjectPlayerId?: PlayerId;
  source?: ObjectRef;
  input: PromptInput;
  expiresAtStateSeq?: StateSeq;
};
```

Semantics:

- `decidingPlayerId` is the player authorized to submit the response.
- `subjectPlayerId` is the player whose game choice is being made, if different.
- Engines reject responses with stale `promptId`, wrong player, wrong prompt
  family, or wrong shape.

## Prompt Response

The direct response shape is:

```ts
type PromptResponse = {
  kind: "response";
  promptId: PromptId;
  stateSeq?: StateSeq;
  respondingPlayerId?: PlayerId;
  output: PromptOutput;
};
```

`respondingPlayerId` is optional in direct in-process transports but useful for
audit logs and relays. Relay `fromPlayer` must match it if both are present.

## References

Use references by purpose:

```ts
type ObjectRef =
  | { kind: "card"; id: ObjectId; zoneId?: ZoneId; label?: string }
  | { kind: "permanent"; id: ObjectId; label?: string }
  | { kind: "spell"; id: StackObjectId; label?: string }
  | { kind: "player"; id: PlayerId; label?: string };

type TargetRef = {
  object: ObjectRef;
  targetRole?: "source" | "target" | "assignee" | "defender";
  intent?: string;
  oracle?: string;
};
```

node: what is the difference between ObjectRef and target ref? when is one supposed to use one and not the other?

`TargetRef` is only for rules-significant targets or target-like combat/damage
assignments. Non-target choices use `ObjectRef`.

## Core Prompt Families

### Choose Action

```ts
type ChooseActionInput = {
  type: "chooseAction";
  actions: AvailableAction[];
  pass?: PassOption;
  concede?: boolean;
};

type AvailableAction =
  | {
      id: string;
      type: "playCard";
      object: ObjectRef;
      playKind: "castSpell" | "playLand";
      label: string;
    }
  | {
      id: string;
      type: "activateAbility";
      source: ObjectRef;
      abilityIndex?: number;
      label: string;
      isManaAbility?: boolean;
    }
  | { id: string; type: "specialAction"; source?: ObjectRef; label: string; rulesTag?: string }
  | { id: string; type: "customAction"; extension: string; label: string; payload?: unknown };

type PassUntil = {
  playerId?: PlayerId;
  step?: string;
  stateSeq?: StateSeq;
};

type ChooseActionOutput =
  | { type: "act"; actionId: string }
  | { type: "pass"; until?: PassUntil }
  | { type: "concede" };
```

note: keep pass until like it is right now.
Also, we should add a key: exhaustStack: boolean to one time pass the full X cards on the stack.

Engines must reject `actionId`s they did not advertise in the matching prompt.
`customAction` requires a declared capability.

### Choose Targets

```ts
type ChooseTargetsInput = {
  type: "chooseTargets";
  candidates: TargetRef[];
  min: number;
  max: number;
  chosen?: TargetRef[];
  label?: string;
};

type ChooseTargetsOutput = {
  type: "targetsChosen";
  chosen: TargetRef[];
};
```

### Choose Objects

```ts
type ChooseObjectsInput = {
  type: "chooseObjects";
  purpose: "discard" | "sacrifice" | "tap" | "keep" | "exile" | "choose" | "payCost" | string;
  objects: ObjectRef[];
  min: number;
  max: number;
  ordered?: boolean;
};

type ChooseObjectsOutput = {
  type: "objectsChosen";
  chosen: ObjectRef[];
};
```

This is the primitive for non-target decisions.

### Distribute Cards

```ts
type CardDestination = {
  zone: "library" | "graveyard" | "exile" | "hand" | string;
  zoneId?: ZoneId;
  ownerId?: PlayerId;
  position?: "top" | "bottom" | "specific";
  index?: number;
};

type DistributeCardsInput = {
  type: "distributeCards";
  purpose: "scry" | "surveil" | "dig" | "mulliganPutBack" | "reorder" | string;
  cards: ObjectRef[];
  destinations: CardDestination[];
  constraints?: {
    minPerDestination?: Record<string, number>;
    maxPerDestination?: Record<string, number>;
    preserveRelativeOrder?: boolean;
  };
};

type DistributeCardsOutput = {
  type: "cardsDistributed";
  assignments: Array<{ card: ObjectRef; destination: CardDestination; order?: number }>;
};
```

This generalizes scry/surveil/dig/reorder without forcing every workflow into a
separate bespoke prompt.

### Pay Mana

```ts
type PoolMana = {
  id: string;
  color: "W" | "U" | "B" | "R" | "G" | "C";
  source?: ObjectRef;
  restrictions?: string[];
  selected?: boolean;
};

type PayManaInput = {
  type: "payMana";
  cost: string;
  subject?: ObjectRef;
  pool: PoolMana[];
  actions: AvailableAction[];
  canAutoPay?: boolean;
};

type PayManaOutput =
  | { type: "usePoolMana"; manaId: string }
  | { type: "unusePoolMana"; manaId: string }
  | { type: "act"; actionId: string }
  | { type: "confirmPayment"; auto?: boolean }
  | { type: "cancelPayment" };
```

`auto: true` is meaningful only when the engine advertises `canAutoPay`.

### Scalar Choices

Keep simple scalar prompts:

```ts
type ChooseNumberInput = { type: "chooseNumber"; min: number; max: number; label?: string };
type ChooseNumberOutput = { type: "numberChosen"; value: number };

type ChooseBooleanInput = {
  type: "chooseBoolean";
  label: string;
  confirmLabel?: string;
  denyLabel?: string;
};
type ChooseBooleanOutput = { type: "booleanChosen"; value: boolean };

type ChooseColorInput = {
  type: "chooseColor";
  colors: string[];
  min: number;
  max: number;
  repeatAllowed?: boolean;
};
type ChooseColorOutput = { type: "colorsChosen"; colors: Record<string, number> };

type ChooseOptionInput = {
  type: "chooseOption";
  options: string[];
  min: number;
  max: number;
  label?: string;
};
type ChooseOptionOutput = { type: "optionsChosen"; indices: number[] };
```

### Combat

Combat needs general damage assignment rather than attacker-only assumptions:

```ts
type DeclareAttackersInput = {
  type: "declareAttackers";
  attackers: Array<{ attacker: ObjectRef; validDefenders: ObjectRef[]; required?: boolean }>;
  defenders: ObjectRef[];
};

type DeclareAttackersOutput = {
  type: "attackersDeclared";
  assignments: Array<{ attacker: ObjectRef; defender: ObjectRef; bandId?: string }>;
};

type DeclareBlockersInput = {
  type: "declareBlockers";
  blockers: ObjectRef[];
  attackers: Array<{
    attacker: ObjectRef;
    validBlockers: ObjectRef[];
    minBlockers?: number;
    maxBlockers?: number;
  }>;
};

type DeclareBlockersOutput = {
  type: "blockersDeclared";
  assignments: Array<{ blocker: ObjectRef; attacker: ObjectRef }>;
};

type AssignDamageInput = {
  type: "assignDamage";
  damageSource: ObjectRef;
  assignees: ObjectRef[];
  assignmentControllerId: PlayerId;
  totalDamage: number;
  reason: "combatAttacker" | "combatBlocker" | "trample" | "banding" | "effect" | string;
  constraints?: Record<string, unknown>;
};

type AssignDamageOutput = {
  type: "damageAssigned";
  assignments: Array<{ assignee: ObjectRef; damage: number }>;
};
```

Damage assignment order should not be a mandatory modern primitive. If an engine
supports a rules variant that needs ordering, it can use `ChooseObjectsInput`
with `ordered: true` or advertise an extension.

### Acknowledgements And Terminal Prompts

Display acknowledgements should be separate from game choices when possible:

```ts
type AcknowledgeInput = {
  type: "acknowledge";
  eventId: string;
  label?: string;
};

type AcknowledgeOutput = {
  type: "acknowledged";
  eventId: string;
};

type GameOverInput = {
  type: "gameOver";
};
```

`gameOver` takes no response.

## Display Events

Display events are non-authoritative, ordered, and audience-aware:

```ts
type DisplayEvent = {
  kind: "display";
  eventId: string;
  stateSeq: StateSeq;
  audience?: PlayerId[];
  type: string;
  payload: unknown;
};
```

Clients may drop unknown display event types after logging a soft error.

## Error Semantics

Engines should return structured errors:

```ts
type ProtocolError = {
  kind: "error";
  code:
    | "stalePrompt"
    | "promptIdMismatch"
    | "wrongPlayer"
    | "wrongPromptFamily"
    | "invalidShape"
    | "unsupportedPrompt"
    | "unsupportedResponse"
    | "unsupportedExtension";
  message: string;
  promptId?: PromptId;
  stateSeq?: StateSeq;
};
```

Clients should treat these as recoverable unless the engine marks the session
terminated.

## Conformance Levels

`core`:

- `StateUpdate`, `DisplayEvent`, `AgentPrompt`, `PromptResponse`, `ProtocolError`.
- Opaque ids, state sequence, prompt id, deciding player validation.
- Scalar choices, action choice, target choice, object choice, and game over.

`magic-core`:

- Mana payment, card distribution, declare attackers/blockers, damage
  assignment, reveal/acknowledge.

`relay`:

- Relay envelopes, audience fields, reconnect snapshot behavior, and replay-safe
  display sequencing.

## Design Review Checklist

Before adding a new prompt type, ask:

1. Is this a rules target, a non-target object choice, a scalar choice, a card
   destination workflow, a payment step, or a display acknowledgement?
2. Can an existing primitive express it without losing legality semantics?
3. Does the response carry only client decisions, not engine-private actions?
4. Can the engine validate `promptId`, `stateSeq`, player authorization, prompt
   family, and response shape?
5. If this is engine-specific, is it declared as a namespaced capability?

## Assumptions And Confidence

- Confirmed: the pinned Manabrew protocol already intends transport-agnostic
  JSON, opaque ids, prompts without game state, and ignored unknown extension
  fields. Confidence: high.
- Inference: a general Manabrew protocol should prefer generic primitives for
  object choices, card distribution, and damage assignment over engine-specific
  action ids. Confidence: high.
- Assumption: Manabrew wants to support multiple MTG engines, not only its
  reference engine. Confidence: medium-high, based on the protocol docs saying
  any conforming engine/client pair should work.
- Contradicting evidence: if Manabrew intentionally wants reference-engine
  action ids as the stable public API, this design is too strict and should be
  narrowed to a reference-engine client protocol instead.
