# ManaBrew Engine — Board-State Read API (for AI evaluation)

All paths relative to `forge-engine/crates/`. The engine is index-arena based:
`CardId(u32)` / `PlayerId(u32)` are typed indices, not references. `&Game`
(aka `GameState`) owns everything; read through its accessors.

## IDs — `forge-engine/src/ids.rs`
- `struct CardId(pub u32)` — ids.rs:5; `.index() -> usize` ids.rs:12
- `struct PlayerId(pub u32)` — ids.rs:9; `.index() -> usize` ids.rs:18
- Both are `Copy, Eq, Ord, Hash`.

## GameState — `forge-engine/src/game.rs:92`
Public fields:
- `cards: Vec<Card>` — game.rs:94 (the card arena; index with `CardId.index()`)
- `players: Vec<PlayerState>` — game.rs:95
- `stack: MagicStack` — game.rs:102
- `turn: TurnState` — game.rs:114
- `player_order: Vec<PlayerId>` — game.rs:117 (turn sequence)
- `game_over: bool` — game.rs:120
- `winner: Option<PlayerId>` — game.rs:121
- `monarch: Option<PlayerId>` — game.rs:133
- `initiative_holder: Option<PlayerId>` — game.rs:136
- `is_night: bool` — game.rs:110
- (`zones` is private — use accessors below)

Accessors:
- `card(&self, CardId) -> &Card` — game.rs:263
- `card_mut(&mut self, CardId) -> &mut Card` — game.rs:267
- `player(&self, PlayerId) -> &PlayerState` — game.rs:271
- `player_mut(&mut self, PlayerId) -> &mut PlayerState` — game.rs:275
- `zone(&self, ZoneType, PlayerId) -> &Zone` — game.rs:279
- `cards_in_zone(&self, ZoneType, PlayerId) -> &[CardId]` — game.rs:520  ← primary board scan
- `creatures_on_battlefield(&self, PlayerId) -> Vec<CardId>` — game.rs:525
- `lands_on_battlefield(&self, PlayerId) -> Vec<CardId>` — game.rs:578
- `active_player(&self) -> PlayerId` — game.rs:458
- `is_day(&self) -> bool` — game.rs:462

## TurnState — `forge-engine/src/phase/mod.rs:145`
- `turn_number: u32` :146
- `active_player: PlayerId` :147
- `phase: PhaseType` :148
- `priority_player: PlayerId` :149
- `num_players: u32` :150
- `combat_attackers_declared: bool` :153
- `combat_blockers_declared: bool` :154
- `combat_block_assignments: Vec<(CardId /*blocker*/, CardId /*attacker*/)>` :156
- `drawn_for_turn: bool` :159

### PhaseType — `forge-foundation/src/phase.rs:5`
Variants in order: `Untap, Upkeep, Draw, Main1, CombatBegin,
CombatDeclareAttackers, CombatDeclareBlockers, CombatFirstStrikeDamage,
CombatDamage, CombatEnd, Main2, EndOfTurn, Cleanup`. Const `TURN_ORDER` :23.

## Zone — `forge-engine/src/zone/mod.rs:29`
- `zone_type: ZoneType` :30
- `owner: PlayerId` :31
- `cards: Vec<CardId>` :32  ← ordered card list (same slice `cards_in_zone` returns)

### ZoneType — `forge-foundation/src/zone.rs:5`
Variants: `Hand, Library, Graveyard, Battlefield, Exile, Flashback, Command,
Stack, Sideboard, Ante, Merged, SchemeDeck, PlanarDeck, AttractionDeck,
Junkyard, ContraptionDeck, Subgame, ExtraHand, None`.
- `is_hidden(self) -> bool` :29

## Card — `forge-engine/src/card/mod.rs:197`
Key public fields:
- `id: CardId` :198
- `card_name: String` :201 ; `full_name: String` :205
- `owner: PlayerId` :208 ; `controller: PlayerId` :209
- `zone: ZoneType` :212
- `type_line: CardTypeLine` :215
- `mana_cost: ManaCost` :218 ; `color: ColorSet` :221 ; `color_identity: ColorSet` :228
- `base_power: Option<i32>` :231 ; `base_toughness: Option<i32>` :232
- `tapped: bool` :257
- `summoning_sick: bool` :288
- `damage: i32` :292
- `counters: BTreeMap<CounterType, i32>` :301
- `face_down: bool` :264 ; `flipped: bool` :263 ; `exerted: bool` :291
- `paired_with: Option<CardId>` :274

Accessors (compute layered/effective values — prefer these over raw fields):
- `power(&self) -> i32` — mod.rs:988 (base + statics + counters)
- `toughness(&self) -> i32` — mod.rs:1000
- `lethal_damage(&self) -> bool` — mod.rs:1011 (`damage >= toughness()`)
- `can_be_dealt_damage(&self) -> bool` — mod.rs:1015
- `is_creature(&self) -> bool` — mod.rs:1022
- `is_land(&self) -> bool` — mod.rs:1026
- `is_permanent(&self) -> bool` — mod.rs:1030
- `counter_count(&self, &CounterType) -> i32` — mod.rs:1505

Keywords:
- `has_keyword(&self, &str) -> bool` — mod.rs:1261
- `has_keyword_enum(&self, Kw) -> bool` — mod.rs:1269 (respects cant_have/granted/pump)
- Convenience bools: `has_haste` :1281, `has_flying` :1285, `has_reach` :1289,
  `has_first_strike` :1293, `has_double_strike` :1297, `has_trample` :1301,
  `has_deathtouch` :1305, `has_lifelink` :1309, `has_vigilance` :1313,
  `has_defender` :1317.

### CardTypeLine — `forge-foundation/src/card_type.rs:153`
- `core_types: BTreeSet<CoreType>` :153
- `is_permanent` :210, `is_creature` :214, `is_land` :218, `is_artifact` :230,
  `is_enchantment` :234, `is_planeswalker` :238.
(`Card::is_creature/is_land` wrap these but also account for bestow.)

## PlayerState — `forge-engine/src/player/state.rs:12`
- `id: PlayerId` :13 ; `name: String` :14
- `life: i32` :16 ; `starting_life: i32` :17
- `life_gained_this_turn: i32` :19 ; `life_lost_this_turn: i32` :22
- `poison_counters: i32` :25
- `lands_played_this_turn: i32` :27 ; `max_land_plays_per_turn: i32` :29
- `spells_cast_this_turn: i32` :30
- `max_hand_size: i32` :35
- `has_lost: bool` :45 ; `has_won: bool` :46 ; `has_conceded: bool` :47 ; `outcome: Option<PlayerOutcome>` :48
- `energy_counters: i32` :62
- `team_number: i32` :80
- Commander: `commanders: Vec<CardId>` :51 ; `commander_damage_received: HashMap<u32,i32>` :50
  (keyed by source commander id as u32) ; `commander_casts: HashMap<u32,u32>` :52 ;
  `commander_damage_enabled: bool` :53.

Hand/zone contents for a player: there is no `hand()` helper — use
`game.cards_in_zone(ZoneType::Hand, player_id)` (len = hand size), and likewise
`Battlefield` / `Graveyard` / `Command` / `Library`.

## Command zone / commander
- Commander card ids: `PlayerState.commanders` (player/state.rs:51).
- Command-zone contents: `game.cards_in_zone(ZoneType::Command, player_id)`.
- Commander-damage dealt to a player: `PlayerState.commander_damage_received`
  (state.rs:50), enabled only when `commander_damage_enabled` (state.rs:53).
- Deeper commander logic lives in `forge-engine/src/player/commander.rs`.

## Typical AI read pattern
```rust
for &pid in &game.player_order {
    let p = game.player(pid);            // life, poison, etc.
    for &cid in game.cards_in_zone(ZoneType::Battlefield, pid) {
        let c = game.card(cid);
        if c.is_creature() {
            let pow = c.power();         // layered
            let tuf = c.toughness();
            let trample = c.has_trample();
            let dead = c.lethal_damage();
        }
    }
}
let over = game.game_over;               // winner = game.winner
```
