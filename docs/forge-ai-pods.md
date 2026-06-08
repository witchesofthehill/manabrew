# Forge-AI multiplayer pods (Design B — relay-reserved AI seats)

Host a single game with **1 human + N Forge-AI opponents**, whose **decks the user
chooses**, with **no idle bot clients**. Generalizes the 1v1 Forge-AI seat (PR #138)
and lets `run_bot` be retired for AI games entirely.

## Why Design B

PR #138 ("bot-as-presence") works for 1v1: `run_bot` joins as a lobby presence and
the engine drives its seat with Forge's `LobbyPlayerAi`. For a pod that means N idle
`run_bot` clients — wasteful. Design B instead has the **relay reserve phantom AI
slots**: seats that count as connected/ready/deck-satisfied so the game can start,
but have no client. It works for N = 1 too, so once it lands, the bot-as-presence
mechanism can be dropped for AI games.

## Deck choice (the user picks the AI decks)

The mechanism already exists and is extended, not invented:

- Today: the client picks the AI's deck (`SpawnAiBotParams extends SetDeckSelectionParams`)
  and sends a `SpawnBotPayload { deck_name, deck, commander_name }` control message;
  the node spawns one `run_bot` with that deck.
- Design B: the client picks **N** AI decks (the same picker, N times) and sends them;
  the relay creates **N phantom AI slots carrying those decks**, so the AI decks travel
  the exact same path as human decks — **no node-side deck injection**.

## Protocol (`forge-agent-interface`)

```rust
// ClientMessage::CreateRoom — add:
ai_seats: Vec<AiSeat>,           // #[serde(default)]; the user-chosen AI opponents

pub struct AiSeat {              // name + the user-chosen deck
    pub name: String,
    pub deck: Deck,
    pub commander_name: Option<String>,
}

// ServerMessage::GameStarted — add:
ai_player_indices: Vec<usize>,   // #[serde(default)]; which seat indices are AI
```

## Relay (`forge-server`)

- **`RoomSlot`** (`room.rs:8`): add `is_bot: bool` (default false).
- **`create_room_sync`** (`lobby.rs:11`): for each `AiSeat`, push a phantom slot —
  `is_bot=true, connected=true, ready=true`, `selected_deck=Some(seat.deck)`,
  `selected_deck_name=Some(seat.name)`. The AI seats occupy deterministic positions
  (appended after the human seat at creation).
- **`all_ready`** (`room.rs:102`): unchanged — phantom slots are pre-`ready`, so the
  game starts once the human readies; they correctly count toward `min_players`.
- **`player_decks` / `player_usernames`** (`room.rs:227,264`): include the AI slots
  (they have real decks + names), so `player_order` and `player_decks` are
  index-aligned across human and AI seats.
- **`start_game_sync`** (`lobby.rs:296`): compute
  `ai_player_indices = players.iter().enumerate().filter(|(_,p)| p.is_bot).map(|(i,_)| i)`
  and include it in `GameStarted`.
- **Disconnect grace**: skip `is_bot` slots — they have no client to lose, so only the
  human's liveness gates the game (same as today).

## Node (`self-hosted-node`)

- **No `spawn_bot`** on this path — there are no bot clients.
- **CreateRoom**: forward the user's `AiSeat`s (from the extended `SpawnBotPayload`).
- **On `GameStarted`**: read `ai_player_indices`. Build `ordered_decks` / `commander_names`
  straight from `player_decks` for **all** seats (human and AI — the AI decks are already
  there). Mark `PlayerConfig.ai = true` for each AI index.
- **Plumbing**: `run_hosted_engine_game(_inner)` takes `ai_player_indices: Vec<usize>`
  (replacing #138's `ai_player_index: Option<usize>`); the inner loop sets
  `players[i].ai = true` for each.

## Harness (`forge-harness`)

No change — per-seat `ai:true` → `LobbyPlayerAi` already shipped in #138.

## Frontend (`src/`)

Extend the existing AI-deck picker (`hostedAiPlay` / the lobby's "play vs AI") to let
the user choose **N** opponents and their decks, and send them as `AiSeat`s. This is
the consuming layer; the backend above is engine-agnostic to it.

## Start / disconnect / game-over

- **Start**: human readies → `all_ready` true (AI slots pre-ready) → `GameStarted`.
- **Disconnect**: only the human can disconnect; existing grace/end logic applies; AI
  slots are excluded.
- **Game over**: unchanged.

## Resource note

N `AiController`s share one JVM per pod, evaluated **sequentially** (Forge asks each in
turn), so one pod is fine on the 3-CPU mini. With concurrent pods it is `MAX_GAMES × N`
AIs — gate with a `MAX_GAMES` / `ai_seats` sanity cap. Use `LobbyPlayerAi(name, null)`
(rules-based AI, not `USE_SIMULATION`) to keep per-decision CPU modest.

## Migration

Design B subsumes the 1v1 case (N = 1, no idle client). After it lands and is verified,
the #138 bot-as-presence path can be removed for AI games, leaving the protocol
`phase_eval` bot (#137) only for genuinely-remote / cross-engine play.
