# manabrew Rust engine — Ability IR / Effect API (for effect classification)

All paths under `forge-engine/crates/forge-engine/src/` unless noted. This is the
API an AI/classification module calls to answer "what does this card/effect DO".

## TL;DR classification path

A card's behavior is keyed by one enum: **`ApiType`** (the `SP$/AB$/DB$` API verb).
Every spell ability carries `Option<ApiType>` plus a giant lowered `SpellAbilityIr`
of all its params. To classify a card:

1. Get its `SpellAbility`s (`CardState::get_spell_abilities` / `get_intrinsic_spell_abilities`).
2. Read `sa.api` (the primary verb) and walk `sa.sub_ability` for chained effects.
3. Inspect `sa.ir` fields and/or `sa.param_value(key)` for the operands (amount, valid filter, zones, counter type, …).
4. For mana/ramp, check `sa.is_mana_ability` / `sa.mana_part` (`ProducedMana`).

---

## 1. The verb: `ApiType`

- `enum ApiType` — `ability/api_type.rs:11` (~210 variants, `Copy + Eq + Hash + Serialize`).
- `ApiType::smart_value_of(&str) -> Option<ApiType>` — `api_type.rs:225` (case-insensitive, resolves aliases).
- `ApiType::name(&self) -> &'static str` — `api_type.rs:234`.
- Alias table (e.g. `ControlGain`→`GainControl`, `LifeSet`→`SetLife`, `Replace`→`ReplaceEffect`) — `api_type.rs:461`.

### Variant → category cheat-sheet (the classes you asked for)

| Category      | Relevant `ApiType` variants |
|---------------|------------------------------|
| removal       | `Destroy`, `DealDamage`, `Fight`, `Sacrifice`, `ChangeZone` (to exile), `RemoveFromGame`, `RemoveFromCombat` |
| board wipe    | `DestroyAll`, `DamageAll`, `SacrificeAll`, `ChangeZoneAll`, `EachDamage` |
| tutor / dig   | `ChangeZone` (Origin Library→Hand/Battlefield, hidden), `Dig`, `DigUntil`, `DigMultiple`, `Seek`, `Learn` |
| ramp          | `Mana`, `ManaReflected`, plus `is_mana_ability` / `mana_part` (see §5); land-fetch = `ChangeZone` with land `ChangeType` |
| draw          | `Draw`, `Investigate` (token that draws), `Discover` |
| counterspell  | `Counter` |
| sac outlet    | `Sacrifice` activated with a `Cost$ Sac<...>` (cost side; see §6) |
| copy          | `CopyPermanent`, `CopySpellAbility`, `Clone` |
| pump          | `Pump`, `PumpAll`, `Animate`, `PutCounter` (+1/+1) |
| lifegain      | `GainLife`, `SetLife` (up), `ExchangeLife` |
| discard       | `Discard`, `RevealHand` |
| bounce        | `ChangeZone` (Destination Hand from Battlefield), `ChangeZoneAll` |
| counters      | `PutCounter`, `PutCounterAll`, `RemoveCounter`, `Proliferate`, `MoveCounter` |
| tokens        | `Token`, `Amass`, `Manifest`, `Cloak`, `Investigate`, `MakeCard` |

There is **no built-in `ApiType`→category function**; the AI module builds that
map. The classification then refines with the IR operands below.

---

## 2. The runtime object: `SpellAbility`

`struct SpellAbility` — `spellability/mod.rs:99`. Key fields for classification:

- `pub api: Option<ApiType>` — `mod.rs:104` — the effect verb. `None` for DB/SVar glue leafs.
- `pub ir: SpellAbilityIr` — `mod.rs:125` — fully lowered params (see §3). `#[serde(skip)]`.
- `pub sub_ability: Option<Box<SpellAbility>>` — `mod.rs:138` — chained DB$ effects; **walk this** for multi-effect cards.
- `pub pay_costs: Option<Cost>` — `mod.rs:135` — activation cost (sac/tap/mana side; see §6).
- `pub target_restrictions: Option<TargetRestrictions>` — `mod.rs:129` — what it can target.
- `pub mana_part: Option<AbilityManaPart>` — `mod.rs:223`; `pub is_mana_ability: bool` — `mod.rs:256`.
- `pub is_spell / is_trigger / is_activated: bool` — `mod.rs:143-147`.
- `pub ability_text: String` — `mod.rs:117` (raw pipe-delimited params, fallback).

### SpellAbility helper methods
- `param_value(&self, key: &str) -> Option<&str>` — `mod.rs:421` (reads back from `ir`; use `keys::*`).
- `param_is_true(&self, key: &str) -> bool` — `mod.rs:350`.
- `find_sub_ability_by_type(&self, api: ApiType) -> Option<&SpellAbility>` — `mod.rs:676` (walks the `sub_ability` chain).
- `can_this_produce(&self) -> bool` — `mod.rs:691` (mana ability test via `mana_part`).

### Predicate helpers (`spellability/spell_ability_predicates.rs`)
- `is_api(api) -> impl Fn(&SpellAbility)->bool` — `:11`.
- `has_sub_ability_api(api) -> impl Fn(&SpellAbility)->bool` — `:18` (true if any sub-ability in the chain has `api`).
- `is_valid(&[&str]) -> impl Fn(&SpellAbility)->bool` — `:34` (matches `Key$ Value` / flag restrictions).

---

## 3. The lowered params: `SpellAbilityIr`

`struct SpellAbilityIr` — `ability/ability_ir.rs:78` (~400 fields, `Default`).
Built by `SpellAbilityIr::from_parsed(api: Option<ApiType>, params: &ParsedParams) -> Self` — `ability_ir.rs:551`.

This is the structured operand bag. Fields most useful for classification:

- `effect: Option<EffectIr>` — `ability_ir.rs:81` — strongly-typed amount for the
  common numeric APIs (see §4). `None` for APIs not yet lowered (most of them).
- Filters / "what it hits": `valid_filter_text`/`valid_filter_selector` (`Valid$`),
  `valid_tgts_text`/`valid_tgts_selector` (`ValidTgts$`), `valid_cards_text`,
  `change_type`/`change_type_selector` (`ChangeType$`), `all_valid_text` — `ability_ir.rs:88-141`.
  `*_selector` are compiled `CompiledSelector`; `*_text` are the raw strings.
- Zones (for removal/bounce/tutor/mill direction): `origin_zone`/`origin_zones`,
  `destination_zone`/`destination_zone_2` (`Origin$`/`Destination$`), `zone1`/`zone2` — `ability_ir.rs:133-139`. `ZoneType` from `forge-foundation`.
- Counters: `counter_type: Option<CounterType>`, `counter_type_text`, `with_counters_type`, `with_counters_amount` — `ability_ir.rs:201-247`.
- Amount strings (when not lowered to `EffectIr`): `amount`, `num_dmg_text`, `num_cards_text`, `damage_amount_text` — `ability_ir.rs:119,436-437,245`.
- Targets / definedness: `defined: Option<DefinedExpr>`, `defined_player`, `targeting_player` — `ability_ir.rs:125-126,497`.
- Tokens: `token_script`, `token_name_text`, `token_power/_toughness`, `token_types_text` — `ability_ir.rs:191-196`.
- Mana: `produced_ir: Option<ProducedMana>`, `mana_ability: bool` — `ability_ir.rs:84,365`.
- Branch/repeat/charm glue: `mode`, `true_sub_ability`/`false_sub_ability`, `branch_condition_svar`, `repeat*` — `ability_ir.rs:115-116,503,345-355`.
- `pw_ability: bool` (planeswalker loyalty ability) — `ability_ir.rs:425`.

### `EffectIr` (typed numeric effects)
`enum EffectIr` — `ability_ir.rs:16`:
`DamageAll | DealDamage | Draw | GainLife | LifeSet | LoseLife | Mill | Poison`,
each wrapping `NumericAmountIr` except `DealDamage(DealDamageIr)`.
- `struct DealDamageIr { amount: Option<AmountExpr>, valid_targets: Option<String>, damage_map: bool }` — `ability_ir.rs:1227`.
- `struct NumericAmountIr { amount: Option<AmountExpr> }` — `ability_ir.rs:1244`.
- `fn lower_effect_ir(api, params) -> Option<EffectIr>` — `ability_ir.rs:1272` (only the 8 APIs above are lowered today; everything else → `None`, fall back to `param_value` / `ir.*_text`).

### Supporting operand types
- `enum AmountExpr { Literal(i32), SVar(String), Count(..), Raw(String) }` — `parsing/amount.rs:2`; `AmountExpr::parse(&str)` — `:21`.
- `struct DefinedExpr { refs: Vec<DefinedRef> }` — `ability_ir.rs:1099`; `DefinedExpr::parse(&str)` — `:1104`.
- `enum DefinedRef` — `ability_ir.rs:1117` (`SelfCard, You, Opponent, Targeted, Remembered, Sacrificed, …`, `Unsupported(String)` catch-all).
- `enum ProducedMana { Any, Chosen, Combo(..), Special(String), Fixed(Vec<String>), Raw(String) }` — `ability/produced_mana.rs:11`; helpers `is_any_like()` `:88`, `is_choice_like()` `:98`, `fixed_tokens()` `:118`.
- `enum NumericParamIr { Integer(i32), Amount(AmountExpr), SVarReference(Vec<String>), Raw(String) }` — `ability_ir.rs:1200`.

---

## 4. Implemented vs. parseable

- `pub const IMPLEMENTED_API_TYPES: &[ApiType]` — `ability/effects/effect_resolver.rs:27` (≈205 of the ~210 variants are wired to a resolver). Built by the `effect_dispatch!` macro at `effect_resolver.rs:23`; the authoritative `ApiType → *_effect.rs` table is the macro body starting `effect_resolver.rs:70`.
- The dispatch table doubles as a "verb → handler struct" map if you need to inspect a specific effect's resolver (e.g. `ApiType::DealDamage => damage_deal_effect::DamageDealEffect`).
- Effect resolvers implement `trait SpellAbilityEffect` — `ability/spell_ability_effect.rs:32` (assoc fn `resolve(ctx, sa)`); useful helpers there: `get_target_cards(game, sa) -> Vec<CardId>` `:117`.

---

## 5. Mana / ramp detection

- `SpellAbility::is_mana_ability: bool` — `mod.rs:256`; `can_this_produce()` — `mod.rs:691`.
- `CardState::get_mana_abilities() -> FCollectionView<SpellAbility>` — `card/card_state.rs:337` (filters `is_mana_ability`); `get_non_mana_abilities()` — `:345`.
- `sa.mana_part: Option<AbilityManaPart>` holds the `ProducedMana` (colors/amount). Built in `ability/ability_factory.rs:567` (`build_mana_part`) when params have `Produced$`.
- `matches_valid_sa` treats `manaability` as `sa.is_mana_ability || sa.api == Some(ApiType::Mana)` — `spellability/valid_sa.rs:101`.

## 6. Costs (sac outlet / activated removal)

The "outlet" semantics live on the **cost** side, not the API:
- `sa.pay_costs: Option<Cost>` — `mod.rs:135`. Parse via `ability_factory::parse_ability_cost` — `ability/ability_factory.rs:592`.
- Inspect cost parts for `Sac<…>`, `Tap`, mana, etc. to classify sac outlets / activated abilities. (Cost framework lives in `cost/`.)

---

## 7. Getting abilities off a card

- `CardState::get_spell_abilities(&self) -> FCollectionView<SpellAbility>` — `card/card_state.rs:333`.
- `CardState::get_intrinsic_spell_abilities(&self) -> Vec<SpellAbility>` — `card/card_state.rs:357` (filters `is_activated || is_trigger || is_spell` — the printed abilities, what you want for static classification).
- Build from raw script: `ability_factory::build_spell_ability_from_host_card` — `ability/ability_factory.rs:237`; record kind via `AbilityRecordType::from_parsed` — `:78` (`SP`/`AB`/`ST`/`DB`).
- Pure card-script parse (no engine, in `forge-card-script` crate `lib.rs`): `ParsedCardScript::parse(raw)` `:350`, `.abilities()` → `ScriptAbility` `:381`; per-ability params via `ParsedParams::parse(raw)` `:485`, `.get(key)` `:575`, `.semantic_get(key)` `:568`. The first token of each ability line (`SP$`/`AB$`/`DB$ <Verb>`) is the `ApiType` string.

---

## Recommended classifier shape

```
for sa in card.get_intrinsic_spell_abilities() {
    let mut cur = Some(&sa);
    while let Some(s) = cur {
        if let Some(api) = s.api {            // primary verb
            classify(api, &s.ir, &s.pay_costs); // refine with operands
        }
        cur = s.sub_ability.as_deref();        // walk chained effects
    }
}
```
Key refinements: `DestroyAll`/`DamageAll`/`SacrificeAll` ⇒ board wipe;
`ChangeZone` direction via `ir.origin_zone`/`ir.destination_zone` distinguishes
tutor (Library→Hand) vs bounce (Battlefield→Hand) vs exile-removal; `ir.valid_*`/
`change_type` gives the affected object filter; `EffectIr`/`ir.*_text` give magnitude.
