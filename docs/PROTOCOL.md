<!--
SPDX-License-Identifier: CC-BY-4.0
Copyright (c) 2024-present manabrew contributors
This document may be reused under the Creative Commons Attribution 4.0
International license. https://creativecommons.org/licenses/by/4.0/
-->

# Card Game Engine Protocol

**Status:** draft
**Version:** 0.3
**License:** CC-BY-4.0

This document specifies a JSON wire format between a card-game frontend and
an engine backend. It is published independently of any reference
implementation and may be implemented by any engine.

The current vocabulary maps onto Magic: The Gathering mechanics for
interoperability with the reference engine, but the message envelope,
identifier scheme, and prompt/action structure are not intrinsically tied to
any particular game system.

This revision (0.2) tightens the spec against the reference implementation
after a discrepancy audit. Where the spec defers to the reference
implementation for exhaustive enumeration, that deferral is explicit.

---

## 1. Goals and non-goals

### Goals

- Define a transport-agnostic JSON message format such that a frontend
  written against this specification can talk to any conforming engine.
- Make the wire format complete enough to drive interactive gameplay
  (priority, targeting, combat, cost payment, library manipulation, dice
  mechanics, opening-hand procedure).
- Be implementable without reference to any particular engine's internals.

### Non-goals

- Card behavior. The protocol carries already-resolved decisions; it does
  not specify how the engine decides which actions are legal or how spells
  resolve.
- Card data sources. Card text, mana costs, and oracle data are read by the
  engine from its own card database; the protocol carries already-rendered
  values. Card image URLs, oracle rulings, and printing-specific metadata
  are not transmitted by this protocol; consumers are expected to fetch
  them separately (e.g., from Scryfall).
- Replay or persistence formats.

---

## 2. Transport

The protocol is transport-agnostic. JSON messages defined below MAY be
carried over any of:

- A platform-native invocation channel (e.g. Tauri `invoke()` with matching
  `#[tauri::command]` handlers). The reference desktop client uses this
  for solo-play sessions.
- A WebSocket connection (`ws://` or `wss://`) with one JSON document per
  text frame. Used for multiplayer relay and as the web-frontend transport.
- Web Worker `postMessage` exchange. Used by the reference web client when
  the engine runs in a `wasm` worker.
- An in-process channel (e.g. Rust `mpsc`) carrying serialized JSON. Used
  by the reference test harness and embedded engine deployments.

A single session MUST use one transport for the duration of the session.
Cross-transport sessions are out of scope.

### 2.1 Multiplayer relay

When more than one client participates in a single game session, a relay
server sits between the engine host and the remote clients. The reference
relay is `manabrew-rs/crates/manabrew-server/`. The relay protocol has two
layers.

**Outer layer — lobby/room control.** The relay defines two top-level
enums, both serialized with a `type` discriminator field:

- `ClientMessage` (client → server): `Authenticate`, `ListRooms`,
  `ListPlayers`, `CreateRoom`, `JoinRoom`, `LeaveRoom`, `SetReady`,
  `SetDeckSelection`, `StartGame`, `BroadcastState`, `TurnChange`.
- `ServerMessage` (server → client): `AuthResult`, `RoomList`,
  `PlayerList`, `RoomCreated`, `PlayerJoined`, `PlayerLeft`,
  `PlayerConnected`, `PlayerDisconnected`, `ReadyStateChanged`,
  `RoomUpdate`, `GameStarted`, `StateUpdate`, `TurnChanged`, `Error`.

Example (client requests room creation):

```json
{
  "type": "CreateRoom",
  "room_name": "kitchen-table",
  "max_players": 2,
  "format": "commander",
  "hosted": false
}
```

**Inner layer — game-message envelope.** Game-state messages (prompts,
responses, logs, snapshots) are not first-class members of the lobby
enums. Instead, they are carried as an opaque JSON `state` value inside:

- `ClientMessage::BroadcastState { state: <json> }` (client → server)
- `ServerMessage::StateUpdate { from_player, state: <json> }` (server →
  client)

The inner `state` value is itself a JSON object with a `kind` discriminator:

| `kind`      | Direction                      | Payload                                                                            |
| ----------- | ------------------------------ | ---------------------------------------------------------------------------------- |
| `prompt`    | engine host → remote client    | `{ "kind": "prompt", "forPlayer": "<player-N>", "prompt": <AgentPrompt> }`         |
| `response`  | remote client → engine host    | `{ "kind": "response", "fromPlayer": "<player-N>", "action": <PlayerAction> }`     |
| `log`       | engine host → all              | `{ "kind": "log", "fromPlayer": "<player-N>", "entry": <GameLogEntryDto> }`        |
| `snapshot`  | engine host → joining observer | `{ "kind": "snapshot", "fromPlayer": "<player-N>", "entry": <GameSnapshotEntry> }` |
| `roomRelay` | any → any                      | room-control messages (e.g. bot lifecycle) — implementation defined                |

Implementations MAY define additional `kind` values; consumers MUST ignore
unknown `kind` values rather than treating them as errors.

The full `ClientMessage` / `ServerMessage` schema is implementation defined
beyond what this section describes; this specification only requires that
`BroadcastState` and `StateUpdate` exist and carry the inner envelope shown
above.

---

## 3. Identifier scheme

The protocol uses opaque string identifiers. The reference encoding is:

| Form         | Refers to                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| `card-{n}`   | A card instance, where `{n}` is a non-negative integer assigned by the engine and unique within a session |
| `player-{n}` | A player slot, where `{n}` is the zero-based seat index                                                   |
| `stack-{n}`  | A stack object, where `{n}` is a non-negative integer unique within a session                             |

Implementations MAY use other encodings provided they are stable strings
unique within a session. Frontends MUST treat identifiers as opaque and MUST
NOT attempt to derive game-state meaning from their textual form.

---

## 4. Message types

The protocol defines two top-level message families:

- **Engine → Frontend:** `AgentPrompt`. The engine asks for a decision (or
  emits a display-only state update).
- **Frontend → Engine:** `PlayerAction`. The frontend answers a prompt.

Display-only events (card played, turn changed, cards revealed) are not $TODO: Reveal, card played, potentially slop. Reveal is engine side and it's a property of a card (same with face down) and card played can be inferred.
top-level messages; they are bundled into the `displayEvents` array of the
prompt that follows them.

---

## 5. `AgentPrompt`

```jsonc
{
  "type": "<promptType>",
  "displayEvents": [
    /* zero or more DisplayEvent objects */
  ],
  "gameView": {
    /* GameViewDto */
  },
  // ...prompt-type-specific fields
}
```

The `type` field is the discriminator. The `gameView` field is a complete
visible-state snapshot from the prompted player's perspective.

### 5.1 `displayEvents`

Each entry is a JSON object with a `kind` discriminator:

| `kind`        | Required fields                                                  | Meaning                       |
| ------------- | ---------------------------------------------------------------- | ----------------------------- |
| `cardPlayed`  | `cardId`, `cardName`, `setCode`, `playerId`                      | A card was cast or played     |
| `turnChanged` | `activePlayerId`, `activePlayerName`, `turnNumber`               | Turn progressed               |
| `revealCards` | `cards` (array of `CardDto`), `zone`, `ownerPlayerId`, `message` | Cards became publicly visible |

`displayEvents` carry transitional UI hints. They MUST NOT be required to
correctly answer the prompt; the `gameView` is authoritative.

### 5.2 Prompt types

The reference implementation defines the following prompt types, grouped by
the user-facing concept they represent. Implementations SHOULD support all
types they emit, MUST gracefully ignore types they do not recognize, and
MAY emit additional types (consumers MUST treat unknown `type` values as
non-fatal and MAY surface them to a debug channel).

#### Game lifecycle (display-only)

- `stateUpdate` — animation hook between events; no decision required
- `gameOver` — game ended; no decision required

#### Opening hand

- `mulligan` — keep or redraw
- `mulliganPutBack` — London mulligan: choose cards to put on the bottom

#### Priority

- `chooseAction` — cast a spell, activate an ability, tap for mana, or pass

#### Combat

- `chooseAttackers` — declare attackers
- `chooseBlockers` — declare blockers
- `chooseExertAttackers` — choose which attackers to exert
- `chooseEnlistAttackers` — choose which creatures enlist
- `chooseDamageAssignmentOrder` — order blockers/attackers for damage assignment
- `chooseCombatDamageAssignment` — assign exact damage amounts
- `payCombatCost` — pay combat-only costs

#### Targeting

- `chooseTargetCard` — pick a card
- `chooseTargetPlayer` — pick a player
- `chooseTargetAny` — pick a card or player
- `chooseTargetSpell` — pick a stack object
- `chooseTargetCardFromZone` — pick a card visible only because of this prompt

#### Modal / multi-mode

- `chooseMode` — pick one or more modes for a modal spell

#### Cost payment

- `payManaCost` — pay mana
- `specifyManaCombo` — disambiguate hybrid / Phyrexian payment
- `choosePhyrexian` — Phyrexian mana: pay 2 life or a colored mana
- `chooseKicker` — whether to pay a kicker cost
- `chooseBuyback` — whether to pay a buyback cost
- `chooseMultikicker` — how many times to pay multikicker
- `chooseReplicate` — how many times to pay replicate
- `chooseAlternativeCost` — choose between alternative costs (cycling, flashback, etc.)
- `chooseDelve` — exile cards from graveyard for Delve
- `chooseConvoke` — tap creatures for Convoke
- `chooseImprovise` — tap artifacts for Improvise
- `helpPayAssist` — help pay for a spell with Assist
- `payCostToPreventEffect` — pay a cost to prevent an effect (Fog effects, etc.)

#### Library manipulation

- `scry` — order top-N library between top and bottom
- `surveil` — order top-N library between top and graveyard
- `dig` — pick from look-at-top-N results
- `reorderLibrary` — reorder cards in the library

#### Card selection

- `revealCards` — acknowledge revealed cards
- `chooseDiscard` — pick cards to discard
- `chooseCardsForEffect` — pick cards from a list

#### Scalar choices

- `chooseColor` — pick a color
- `chooseType` — pick a card type
- `chooseCardName` — pick a card name
- `chooseNumber` — pick a number

#### Triggered abilities

- `chooseOptionalTrigger` — yes/no on an optional trigger

#### Explore

- `exploreDecision` — Explore: put nonland in graveyard or on top of library

#### Dice mechanics

- `firstPlayerRoll` — display-only: first-player roll-off result
- `diceRolled` — display-only: dice were rolled
- `chooseRollToIgnore` — choose which die to drop
- `chooseRollToSwap` — choose a die to swap
- `chooseRollToModify` — choose a die to modify
- `chooseDiceToReroll` — pick dice to reroll
- `chooseRollSwapValue` — pick the value to swap into a die

The complete set of currently-defined types is the union above. Future
versions of this specification MAY add types.

### 5.3 Prompt fields by type

For each prompt type other than `stateUpdate` and `gameOver`, the JSON object
includes both `gameView` and a set of decision-specific fields. Examples:

#### `chooseAction`

```jsonc
{
  "type": "chooseAction",
  "gameView": { ... },
  "playableCardIds": ["card-12", "card-19"],
  "playableOptions": [/* PlayOption objects */],
  "tappableLandIds": ["card-3"],
  "untappableLandIds": [],
  "activatableAbilityIds": [/* ActivatableAbility entries */],
  "manaAbilityOptions": [/* ActivatableAbility entries */],
  "availablePlayerActions": [/* canonical engine PlayerAction objects */]
}
```

#### `chooseTargetCard`

```jsonc
{
  "type": "chooseTargetCard",
  "gameView": { ... },
  "validCardIds": ["card-7", "card-11"],
  "sourceCardId": "card-21",
  "hostile": true,
  "intent": "damage"
}
```

The `hostile` field is retained for backward compatibility; `intent` is the
preferred classification (see §5.4).

#### `chooseAttackers`

```jsonc
{
  "type": "chooseAttackers",
  "gameView": { ... },
  "availableAttackerIds": ["card-4", "card-9"],
  "possibleDefenderIds": [
    { "kind": "player",       "id": "player-1", "label": "Alice" },
    { "kind": "planeswalker", "id": "card-15",  "label": "Liliana, the Last Hope" }
  ]
}
```

`possibleDefenderIds[].label` is a human-readable display label; consumers
that don't render labels MUST tolerate its presence.

The complete per-type field schemas are described in the reference Rust
implementation at `manabrew-rs/crates/manabrew-agent-interface/src/prompt.rs`.
A future revision of this specification will inline the full schemas; for
this draft, the reference implementation is authoritative for fields not
shown above.

### 5.4 `TargetingIntent`

`intent` is a frontend rendering hint included on targeting prompts. Defined
values:

```
damage | destroy | sacrifice | exile | bounce | mill | discard | counter |
tap | untap | copy | buff | debuff | heal | loseLife | reveal | draw |
gainControl | fight | attach | attack | block | hostile | friendly
```

`intent` is hint-only. Engines MAY emit `hostile` as a conservative default
when classification is not available. Frontends use `intent` to choose
pointer styling and color cues; behavior MUST NOT depend on it.

---

## 6. `GameViewDto`

A snapshot of the game state from one player's perspective.

```jsonc
{
  "gameId": "<string>",
  "turn": 5,
  "step": "main1",
  "activePlayerId": "player-0",
  "priorityPlayerId": "player-0",
  "players": [
    /* PlayerDto */
  ],
  "myHand": [
    /* CardDto */
  ],
  "battlefield": [
    /* CardDto */
  ],
  "stack": [
    /* StackObjectDto */
  ],
  "exile": [
    /* CardDto */
  ],
  "graveyard": [
    /* CardDto */
  ],
  "opponentGraveyard": [
    /* CardDto */
  ],
  "opponentExile": [
    /* CardDto */
  ],
  "myCommandZone": [
    /* CardDto */
  ],
  "opponentCommandZone": [
    /* CardDto */
  ],
  "combatAssignments": [{ "blockerId": "card-9", "attackerId": "card-4" }],
  "monarchId": "player-0",
  "initiativeHolderId": null,
  "gameOver": false,
  "winnerId": null,
}
```

### 6.1 `step`

The `step` field is one of the following thirteen `snake_case` strings:

```
untap | upkeep | draw | main1 | begin_combat | declare_attackers |
declare_blockers | first_strike_damage | combat_damage | end_combat |
main2 | end | cleanup
```

Note: prior drafts of this specification rendered the multi-word steps in
camelCase (`beginCombat`, `declareAttackers`, etc.) and omitted
`first_strike_damage`. The reference implementation uses snake_case for
multi-word step names and emits `first_strike_damage` between
`declare_blockers` and `combat_damage` whenever a creature with first
strike or double strike is in combat.

### 6.2 Two-player framing

The current shape (`myHand`, `opponentGraveyard`, `myCommandZone`, …)
presumes two players. Multi-opponent formats (Commander pods, Two-Headed
Giant) are expected to require a generalized addressing scheme in a future
revision. Implementations producing multi-opponent state SHOULD continue to
populate the two-player fields with the prompted player's hand/zones and
the "primary" opponent's zones for compatibility, and MAY add per-player
state in extension fields.

### 6.3 `PlayerDto`

```jsonc
{
  "id": "player-0",
  "name": "Alice",
  "isHuman": true,
  "life": 20,
  "poison": 0,
  "handCount": 7,
  "libraryCount": 53,
  "graveyardCount": 0,
  "exileCount": 0,
  "manaPool": { "W": 1, "U": 0, "B": 0, "R": 0, "G": 0, "C": 0 },
  "commanderDamage": { "card-3": 7 },
  "energyCounters": 0,
  "radiationCounters": 0,
  "ringLevel": 0,
  "speed": 0,
  "hasCityBlessing": false,
}
```

`manaPool` is keyed by single-character color symbols: `W`, `U`, `B`, `R`,
`G`, `C` (colorless). All listed fields are required.

### 6.4 `CardDto`

#### Required fields

Always present in every `CardDto`:

| Field                                     | Type       | Meaning                                        |
| ----------------------------------------- | ---------- | ---------------------------------------------- |
| `id`                                      | `card-N`   | Card instance identifier                       |
| `name`                                    | string     | Oracle name                                    |
| `setCode`                                 | string     | Set code of the printing                       |
| `cardNumber`                              | string     | Collector number                               |
| `color`                                   | string     | Color string (e.g. `"WG"`, `""` for colorless) |
| `manaCost`                                | string     | Printed mana cost (e.g. `"{2}{R}{R}"`)         |
| `cmc`                                     | int        | Mana value (see vocabulary note below)         |
| `types`, `subtypes`, `supertypes`         | string[]   | Card type line components                      |
| `text`                                    | string     | Oracle text                                    |
| `controllerId`, `ownerId`                 | `player-N` | Controller and owner                           |
| `zoneId`                                  | string     | Current zone identifier                        |
| `tapped`                                  | bool       | Tapped state                                   |
| `damage`                                  | int        | Marked damage                                  |
| `summoningSick`                           | bool       | Summoning sickness (CR 302.1)                  |
| `keywords`                                | string[]   | Active keyword abilities                       |
| `isPlayable`, `isSelected`, `isChoosable` | bool       | UI selection flags (see §6.6)                  |

#### Conditionally-present fields

The following are omitted from serialization when not applicable. Field
omission semantics:

- Optional reference fields (`Option<T>`) are omitted when `null`/`None`.
- Boolean flags that default to `false` are omitted when `false`.
- Array fields that default to empty are omitted when empty.

| Field                                          | Type                  | Notes                                                                 |
| ---------------------------------------------- | --------------------- | --------------------------------------------------------------------- |
| `power`, `toughness`                           | string                | P/T values for creatures and similar permanents                       |
| `basePower`, `baseToughness`                   | int                   | Base values for buff/debuff color-coding                              |
| `flashbackCost`, `kickerCost`, `madnessCost`   | string                | Alternative-cost strings, when the card has them                      |
| `effectiveManaCost`                            | string                | Cost after static-ability adjustments, when different from `manaCost` |
| `attachedTo`                                   | `card-N`              | Equipment / Aura host                                                 |
| `attachmentIds`                                | `card-N`[]            | IDs of cards attached to this permanent                               |
| `counters`                                     | `Record<string, int>` | Counter type → count (only non-zero entries)                          |
| `isToken`                                      | bool                  | True for tokens                                                       |
| `isDoubleFaced`, `isTransformed`, `isFaceDown` | bool                  | DFC / morph / manifest state                                          |
| `isBestowed`                                   | bool                  | Currently attached as an Aura via Bestow                              |
| `isCrewed`                                     | bool                  | Successfully crewed this turn                                         |
| `isAttacking`                                  | bool                  | Attacking this combat                                                 |
| `attackingPlayerId`                            | `player-N`            | When `isAttacking`, which defender                                    |
| `phasedOut`                                    | bool                  | Phased out                                                            |
| `exerted`                                      | bool                  | Exerted (won't untap next untap step)                                 |
| `isMadnessExiled`, `isPlotted`, `isWarpExiled` | bool                  | Mechanic-specific exile states                                        |
| `foil`                                         | bool                  | Foil printing                                                         |

#### Fields not included in this protocol

The protocol does NOT carry:

- `imageUrl` — consumers fetch card images out-of-band (Scryfall is the
  reference source).
- `colorIdentity` — derived from `manaCost` and rules text on the consumer
  side if needed.

### 6.5 `StackObjectDto`

```jsonc
{
  "id": "stack-3",
  "sourceId": "card-21",
  "controllerId": "player-0",
  "name": "Lightning Bolt",
  "text": "Lightning Bolt deals 3 damage to any target.",
  "isPermanentSpell": false,
  "isCasting": false,
  "setCode": "m21",
  "cardNumber": "162",
  "targets": [
    {
      "kind": "player",
      "id": "player-1",
      "nodeIndex": 0,
      "targetIndex": 0,
      "hostile": true,
      "intent": "damage",
    },
  ],
}
```

`setCode` and `cardNumber` are optional (omitted for tokens / engine-internal
sources without a printing).

The `targets` array contains `StackTargetDto` entries with these fields:

| Field         | Type              | Meaning                                                                                           |
| ------------- | ----------------- | ------------------------------------------------------------------------------------------------- |
| `kind`        | string            | One of `card`, `player`, `planeswalker`, `stack` (see `StackTargetKindDto` in the reference impl) |
| `id`          | string            | Identifier, format depending on `kind`                                                            |
| `nodeIndex`   | int               | Index of the sub-ability within the spell's ability tree (for chained abilities)                  |
| `targetIndex` | int               | Index of this target within its sub-ability's target list                                         |
| `hostile`     | bool              | Backward-compatibility flag; prefer `intent`                                                      |
| `intent`      | `TargetingIntent` | Semantic classification of this target (see §5.4)                                                 |

The `nodeIndex` / `targetIndex` pair lets consumers correlate stack-object
targets with the originating spell's ability tree, which matters for spells
with multiple sub-abilities (modal spells, multi-mode targeting, etc.).

### 6.6 Vocabulary notes

The protocol carries forward conventions from the reference engine whose
names predate, or differ from, current MTG comprehensive-rules terminology.
Implementations MUST accept the field names as given.

**Renamed concepts:**

- `cmc` is the integer mana value (CR 202.3b). The MTG rules renamed
  "converted mana cost" to "mana value" in 2020; the field name is retained
  for compatibility with the reference implementation. Future protocol
  versions MAY rename this field.
- `summoningSick` carries summoning-sickness state (CR 302.1) as a boolean.

**Two-player sugar:**

- `myHand` / `opponentGraveyard` / `myCommandZone` / `opponentCommandZone`
  are two-player-centric. See §6.2.

**UI selection flags on `CardDto`:**

- `isPlayable` — engine reports this card is currently a legal play target
  for the prompted decision.
- `isSelected` — frontend has marked this card as selected (echoed back by
  the engine for prompt-aware UIs).
- `isChoosable` — engine reports this card is one of the legal choices for
  the active selection prompt.

**Mechanic-specific flags:**

- `isBestowed` — Aura currently attached via the Bestow mechanic.
- `isCrewed` — Vehicle has been crewed this turn.
- `isPlotted` — exiled face-up via the Plot mechanic; castable later for
  free.
- `isWarpExiled` — exiled via Warp; castable from exile for normal cost.
- `isMadnessExiled` — exiled as part of Madness payment.
- `phasedOut` — phased out (CR 702.26).
- `exerted` — exerted, won't untap next untap step.

**Rendering hints:**

- `basePower` / `baseToughness` — pre-modifier P/T values, for buff/debuff
  color-coding in the UI.

**Combat:**

- `attackingPlayerId` — when a creature `isAttacking`, this names the
  defender (player or planeswalker) the creature is attacking.

---

## 7. `PlayerAction`

A `PlayerAction` is sent by the frontend in response to an `AgentPrompt`.
The shape of the action MUST match the shape invited by the prompt's
`type`: e.g., a `chooseTargetCard` prompt expects an action naming a
`cardId` from the prompt's `validCardIds`.

Discriminator: `kind` (string). The reference implementation defines the
following action types, grouped by the prompt family they answer.

#### Universal

- `pass` — pass priority. Optional `untilPhase` field requests auto-pass
  through subsequent steps until the named phase.
- `concede` — concede the game.
- `engineAction` — wrap a canonical engine-defined action by index (used
  for `chooseAction` prompts whose `availablePlayerActions` array indexes
  into the engine's action space).
- `restoreSnapshot` — restore from a debugging checkpoint (development
  builds only).

#### Opening hand

- `mulliganDecision` — `{ "kind": "mulliganDecision", "keep": <bool> }`
- `mulliganPutBackDecision` — `{ "kind": "mulliganPutBackDecision", "cardIds": [...] }`

#### Priority / spells / abilities

- `playCard` — `{ "kind": "playCard", "cardId": "<card-N>", "mode": "<string>?" }`
- `activateAbility` — `{ "kind": "activateAbility", "cardId": "<card-N>", "abilityIndex": <int> }`
- `tapLand` — `{ "kind": "tapLand", "cardId": "<card-N>", "abilityIndex": <int>?, "color": "<symbol>?" }`
- `untapLand` — `{ "kind": "untapLand", "cardId": "<card-N>" }`

#### Combat

- `declareAttackers` — `{ "kind": "declareAttackers", "assignments": [{ "attackerId": "...", "defenderId": "..." }] }`
- `declareBlockers` — `{ "kind": "declareBlockers", "assignments": [{ "blockerId": "...", "attackerId": "..." }] }`
- `damageAssignmentOrderDecision` — order blockers/attackers
- `combatDamageAssignmentDecision` — exact damage amounts
- `exertDecision` — choose attackers to exert
- `enlistDecision` — choose creatures to enlist
- `payCombatCost` — pay combat-only costs
- `declineCombatCost` — decline an optional combat cost

#### Targeting

- `targetCard` — `{ "kind": "targetCard", "cardId": "<card-N>?" }`
- `targetPlayer` — `{ "kind": "targetPlayer", "playerId": "<player-N>?" }`
- `targetAny` — `{ "kind": "targetAny", "target": <TargetAnyChoice> }`
- `targetSpell` — `{ "kind": "targetSpell", "spellId": "<stack-N>?" }`

#### Cost payment

- `payManaCost` — `{ "kind": "payManaCost", "auto": <bool> }`
- `cancelManaCost` — abort a cost-payment session
- `manaComboDecision` — disambiguate hybrid / Phyrexian
- `phyrexianDecision` — pay 2 life vs colored mana
- `kickerDecision`, `buybackDecision`, `multikickerDecision`, `replicateDecision`
- `alternativeCostDecision` — choose alternative cost by index
- `delveDecision`, `convokeDecision`, `improviseDecision` — choose cards/permanents to tap or exile
- `assistDecision` — `{ "kind": "assistDecision", "amountToPay": <int> }`
- `payCostToPreventEffectDecision` — `{ "kind": "payCostToPreventEffectDecision", "accept": <bool> }`

#### Library manipulation

- `scryDecision` — `{ "kind": "scryDecision", "bottomCardIds": [...] }`
- `surveilDecision` — `{ "kind": "surveilDecision", "graveyardCardIds": [...] }`
- `digDecision` — `{ "kind": "digDecision", "chosenCardIds": [...] }`
- `reorderLibraryDecision` — `{ "kind": "reorderLibraryDecision", "orderedCardIds": [...] }`

#### Card selection

- `discardDecision` — `{ "kind": "discardDecision", "discardedCardIds": [...] }`
- `chooseCardsDecision` — `{ "kind": "chooseCardsDecision", "chosenCardIds": [...] }`
- `revealCardsAcknowledged` — acknowledge a `revealCards` prompt

#### Modal / scalar

- `modeDecision` — `{ "kind": "modeDecision", "chosenIndices": [...] }`
- `colorDecision`, `typeDecision`, `cardNameDecision`, `numberDecision`

#### Triggered abilities / explore

- `optionalTriggerDecision` — `{ "kind": "optionalTriggerDecision", "accept": <bool> }`
- `exploreResponse` — `{ "kind": "exploreResponse", "putInGraveyard": <bool> }`

#### Dice

- `firstPlayerRollAcknowledged` — acknowledge first-player roll-off
- `diceRolledAcknowledged` — acknowledge a roll
- `rollToIgnoreDecision`, `rollToSwapDecision`, `rollToModifyDecision`,
  `diceToRerollDecision`, `rollSwapValueDecision`

The complete enumeration in this revision is the union above. Implementations
MAY add action variants; consumers MUST accept actions whose shape matches a
prompt the engine emitted.

The full Rust definitions are in
`manabrew-rs/crates/manabrew-agent-interface/src/prompt.rs` (the
`PlayerAction` enum starting around line 752). A future revision of this
specification will inline the full per-variant field schema.

---

## 8. Conformance

### 8.1 Engine conformance

A conforming engine MUST:

- Emit `AgentPrompt` messages with discriminator `type` set to one of the
  values listed in §5.2, or to a vendor-extension type whose name does not
  collide with any value in §5.2.
- Include a complete `gameView` snapshot in every prompt that requires a
  decision.
- Use the identifier scheme described in §3, or an alternative that
  satisfies the per-session uniqueness contract.
- Accept any `PlayerAction` whose shape matches a prompt the engine
  emitted.

### 8.2 Frontend conformance

A conforming frontend MUST:

- Render any `gameView` snapshot it receives without assuming
  engine-specific extensions.
- Treat identifiers as opaque (per §3).
- Send a `PlayerAction` response to every prompt that requires one (i.e.,
  every prompt other than `stateUpdate`, `gameOver`, `firstPlayerRoll`,
  `diceRolled` — the display-only types).
- Treat unknown prompt `type` values as a soft error and surface them to
  the user; it MUST NOT crash on unknown variants.

### 8.3 Extensions

Implementations MAY include additional fields beyond those specified.
Conforming consumers MUST ignore unknown fields. Extension fields SHOULD
use a vendor prefix (e.g., `x-vendor-feature`) to avoid collisions with
future revisions of this specification.

---

## 9. Reference implementation

A reference implementation is maintained alongside this specification:

- Rust prompt and game-state types: `manabrew-rs/crates/manabrew-agent-interface/src/`
- Rust `PlayerAction` enumeration: `manabrew-rs/crates/manabrew-agent-interface/src/prompt.rs`
- Rust relay envelope: `manabrew-rs/crates/manabrew-server/src/protocol.rs`
- TypeScript counterpart types: `src/types/` (`manabrew.ts`, `promptType.ts`,
  `gameSnapshot.ts`)

The reference implementation is licensed under GPL-3.0-or-later. **This
specification is licensed under CC-BY-4.0.** Independent re-implementations
of this specification under any license are explicitly invited.

---

## 10. Open questions / future revisions

The following items are known to be incomplete in v0.2 and are expected to
be addressed in a future revision:

1. **Multi-opponent addressing.** The two-player `myHand` / `opponent…`
   sugar does not generalize cleanly to multi-opponent games (§6.2).

2. **Inline schemas for all prompt and action variants.** §5.3 and §7
   reference the Rust implementation rather than inlining exhaustive
   per-variant field schemas. A future revision will inline them.

3. **Vocabulary cleanup.** `cmc`, `summoningSick`, and the two-player
   framing are retained for compatibility but may be renamed in a future
   major revision.

4. **Card data fetching boundary.** This specification carries
   already-rendered `CardDto` values and explicitly does not transmit
   `imageUrl` or `colorIdentity` (§6.4). Whether the protocol should grow
   to support card data fetching (oracle text variants, image URLs,
   rulings) is undecided.

5. **Versioning handshake.** Future versions are expected to add an
   `Authenticate`-time version exchange so frontends and engines can
   negotiate compatible feature sets.

6. **Relay envelope formalization.** §2.1 describes the inner-envelope
   `kind` discriminator informally. The full schema for each `kind`
   payload (in particular `roomRelay` sub-types and `log` entry shapes)
   is not yet inlined.

7. **Stack target normalization.** The `nodeIndex` / `targetIndex` pair on
   `StackTargetDto` (§6.5) is implementation-driven; a future revision
   should specify the exact semantics for how multi-mode and chained
   abilities map to these indices.

Comments on this specification are welcomed via the project's issue tracker.
