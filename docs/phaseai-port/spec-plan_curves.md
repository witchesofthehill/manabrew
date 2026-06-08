# Port Spec — `phase-ai/src/plan/curves.rs` → `forge-ai/src/plan/curves.rs`

Source: `https://raw.githubusercontent.com/phase-rs/phase/main/crates/phase-ai/src/plan/curves.rs`
Target engine: manabrew / Forge-DSL (`forge-engine`).

---

## 1. What it does (the AI logic)

`curves.rs` performs **static plan derivation**. Given a precomputed
`DeckFeatures` prior (archetype + per-strategy commitment scores), it produces a
`PlanSnapshot` that models a deck's *expected curve* over the first **15 turns**:

- `expected_lands[15]`  — projected lands in play per turn.
- `expected_mana[15]`   — projected available mana per turn (lands + dorks/rituals).
- `expected_threats[15]` — projected number of deployed threats per turn.
- `tempo_class`         — coarse `TempoClass` (Ramp / Aggro / Control / Midrange / Combo).

The snapshot is **derived once per game** (Phase comment: consumed by
`AiSession::from_game`) and cached; it does **not** read game state. Live
realization against the actual board is a separate concern (`plan/mod.rs::PlanState`),
**out of scope** for this file.

Entry point: `pub fn derive_snapshot(features: &DeckFeatures) -> PlanSnapshot`.

The four projections are independent pure functions of `DeckFeatures`:

- **`tempo_class_for`** — priority-ordered branch ladder (order is load-bearing):
  1. `landfall.commitment > 0.5 || mana_ramp.commitment > 0.5` → **Ramp**
  2. `tribal.commitment > TRIBAL_AGGRO_TEMPO_FLOOR` → **Aggro** (after Ramp, so ramp+tribal = Ramp)
  3. `aggro_pressure.commitment >= AGGRO_PRESSURE_TEMPO_FLOOR` → **Aggro**
  4. `tokens_wide.commitment >= TOKENS_WIDE_TEMPO_FLOOR` → **Aggro**
  5. `control.commitment > 0.55 && control.reactive_tempo > 0.35` → **Control**
  6. `aristocrats.commitment > 0.5` → **Midrange**
  7. `plus_one_counters.commitment > 0.5` → **Midrange**
  8. fallthrough → map `features.archetype` 1:1 to `TempoClass`.

- **`expected_lands_for`** — baseline one land/turn capped at 6 (`turn.min(6)`);
  if `wants_ramp_curve` (`landfall.commitment > 0.5 || mana_ramp.commitment > 0.3`)
  apply a single `+1` from turn index 2 onward (skip(2)): turns idx 2–3 uncapped
  `saturating_add(1)`, turns idx ≥4 `saturating_add(1).min(8)`. Single gate prevents
  double-bumping when both landfall+ramp are high.

- **`expected_mana_for`** (`pub(crate)`) — starts from `expected_lands_for`; if
  `mana_ramp.commitment > 0.3` add per-turn bonus by turn number: turns 2|3 → `+1`,
  turns 4..=6 → `+2`, else `0`, each `saturating_add(bonus).min(10)`.

- **`expected_threats_for`** — baseline by archetype: Aggro `turn.saturating_sub(1).min(5)`,
  Control `turn.saturating_sub(3).min(4)`, else `turn.saturating_sub(2).min(5)`. Then:
  - `tribal.commitment > TRIBAL_MULLIGAN_FLOOR` → `+1` on turns 2–4.
  - `aggro_pressure.commitment >= AGGRO_PRESSURE_MULLIGAN_FLOOR` → `+1` on turns 1–3.
  - `control.commitment > 0.55` → `-1` (saturating) on turns 3 and 4.

**All thresholds, caps, bonuses, and branch order must be carried over verbatim.**

---

## 2. Engine types/APIs it reads — manabrew equivalents

**Key finding: this module reads NO Phase engine types whatsoever.** It is
fully engine-agnostic. It operates entirely on phase-ai's own derived prior
(`DeckFeatures`) and phase-ai's own `PlanSnapshot`/`TempoClass`. There is no
`GameState`, `Card`, `PlayerState`, mana, combat, IR, or sim coupling. Nothing
in `api-state.md` / `api-ir.md` / `api-combat-mana.md` / `api-sim.md` is touched.

Therefore there is **nothing to remap to a manabrew engine API**, and **no
engine type with a missing equivalent**. The port is a 1:1 transcription whose
only dependencies are other (already-to-be-ported) phase-ai modules — see §4.

The only "external" symbols are:

| Symbol read | Origin (phase-ai, not engine) | manabrew equivalent |
|---|---|---|
| `DeckFeatures` + sub-features (`.archetype`, `.landfall.commitment`, `.mana_ramp.commitment`, `.tribal.commitment`, `.aggro_pressure.commitment`, `.tokens_wide.commitment`, `.control.commitment`, `.control.reactive_tempo`, `.aristocrats.commitment`, `.plus_one_counters.commitment`) | `crate::features` | ported `forge-ai/src/features` (sibling module — must exist first) |
| `DeckArchetype` (Aggro/Control/Combo/Ramp/Midrange) | `crate::deck_profile` | ported `forge-ai/src/deck_profile` |
| `PlanSnapshot`, `TempoClass` | `super` (`plan/mod.rs`) | ported `forge-ai/src/plan/mod.rs` |
| Threshold consts: `AGGRO_TEMPO_FLOOR`, `MULLIGAN_FLOOR` (aggro_pressure); `COMMITMENT_FLOOR` (tokens_wide); `AGGRO_TEMPO_FLOOR`, `MULLIGAN_FLOOR` (tribal) | `crate::features::*` | same consts in ported feature modules |

> NOTE for implementer: the **numeric values** of the five imported threshold
> constants live in the respective feature modules (`aggro_pressure.rs`,
> `tokens_wide.rs`, `tribal.rs`), NOT in this file. They must be ported there and
> kept verbatim; `curves.rs` only references them by name. The inline literals
> in this file (`0.5`, `0.3`, `0.55`, `0.35`, caps `6/8/10`, mana bonuses `1/2`,
> threat sub/min `1/2/3/4/5`, turn windows) are the load-bearing constants this
> file owns.

---

## 3. Faithful-port plan — Rust skeleton

Bodies below are the verbatim engine-agnostic logic; transcribe as-is. Only the
import paths change (`crate::` → the forge-ai crate layout). Field/variant names
on `DeckFeatures`/`DeckArchetype`/`TempoClass`/`PlanSnapshot` must match whatever
the ported sibling modules expose (keep Phase's names to minimize drift).

```rust
use crate::deck_profile::DeckArchetype;
use crate::features::aggro_pressure::{
    AGGRO_TEMPO_FLOOR as AGGRO_PRESSURE_TEMPO_FLOOR,
    MULLIGAN_FLOOR as AGGRO_PRESSURE_MULLIGAN_FLOOR,
};
use crate::features::tokens_wide::COMMITMENT_FLOOR as TOKENS_WIDE_TEMPO_FLOOR;
use crate::features::tribal::{
    AGGRO_TEMPO_FLOOR as TRIBAL_AGGRO_TEMPO_FLOOR, MULLIGAN_FLOOR as TRIBAL_MULLIGAN_FLOOR,
};
use crate::features::DeckFeatures;

use super::{PlanSnapshot, TempoClass};

const SCHEDULE_LEN: usize = 15;

pub fn derive_snapshot(features: &DeckFeatures) -> PlanSnapshot {
    let tempo_class = tempo_class_for(features);
    let expected_lands = expected_lands_for(features);
    let expected_mana = expected_mana_for(features);
    let expected_threats = expected_threats_for(features);

    PlanSnapshot {
        expected_lands,
        expected_mana,
        expected_threats,
        tempo_class,
    }
}

fn tempo_class_for(features: &DeckFeatures) -> TempoClass {
    if features.landfall.commitment > 0.5 || features.mana_ramp.commitment > 0.5 {
        return TempoClass::Ramp;
    }
    if features.tribal.commitment > TRIBAL_AGGRO_TEMPO_FLOOR {
        return TempoClass::Aggro;
    }
    if features.aggro_pressure.commitment >= AGGRO_PRESSURE_TEMPO_FLOOR {
        return TempoClass::Aggro;
    }
    if features.tokens_wide.commitment >= TOKENS_WIDE_TEMPO_FLOOR {
        return TempoClass::Aggro;
    }
    if features.control.commitment > 0.55 && features.control.reactive_tempo > 0.35 {
        return TempoClass::Control;
    }
    if features.aristocrats.commitment > 0.5 {
        return TempoClass::Midrange;
    }
    if features.plus_one_counters.commitment > 0.5 {
        return TempoClass::Midrange;
    }
    match features.archetype {
        DeckArchetype::Aggro => TempoClass::Aggro,
        DeckArchetype::Control => TempoClass::Control,
        DeckArchetype::Combo => TempoClass::Combo,
        DeckArchetype::Ramp => TempoClass::Ramp,
        DeckArchetype::Midrange => TempoClass::Midrange,
    }
}

fn expected_lands_for(features: &DeckFeatures) -> [u8; SCHEDULE_LEN] {
    let mut lands = [0u8; SCHEDULE_LEN];
    for (turn_idx, slot) in lands.iter_mut().enumerate() {
        let turn = (turn_idx + 1) as u8;
        *slot = turn.min(6);
    }
    let wants_ramp_curve =
        features.landfall.commitment > 0.5 || features.mana_ramp.commitment > 0.3;
    if wants_ramp_curve {
        for (turn_idx, slot) in lands.iter_mut().enumerate().skip(2) {
            if turn_idx < 4 {
                *slot = slot.saturating_add(1);
            } else {
                *slot = slot.saturating_add(1).min(8);
            }
        }
    }
    lands
}

pub(crate) fn expected_mana_for(features: &DeckFeatures) -> [u8; SCHEDULE_LEN] {
    let mut mana = expected_lands_for(features);
    if features.mana_ramp.commitment > 0.3 {
        for (turn_idx, slot) in mana.iter_mut().enumerate() {
            let bonus: u8 = match turn_idx + 1 {
                2 | 3 => 1,
                4..=6 => 2,
                _ => 0,
            };
            *slot = slot.saturating_add(bonus).min(10);
        }
    }
    mana
}

fn expected_threats_for(features: &DeckFeatures) -> [u8; SCHEDULE_LEN] {
    let mut threats = [0u8; SCHEDULE_LEN];
    for (turn_idx, slot) in threats.iter_mut().enumerate() {
        let turn = (turn_idx + 1) as u8;
        *slot = match features.archetype {
            DeckArchetype::Aggro => turn.saturating_sub(1).min(5),
            DeckArchetype::Control => turn.saturating_sub(3).min(4),
            _ => turn.saturating_sub(2).min(5),
        };
    }
    if features.tribal.commitment > TRIBAL_MULLIGAN_FLOOR {
        for (turn_idx, slot) in threats.iter_mut().enumerate() {
            let turn = turn_idx + 1;
            if (2..=4).contains(&turn) {
                *slot = slot.saturating_add(1);
            }
        }
    }
    if features.aggro_pressure.commitment >= AGGRO_PRESSURE_MULLIGAN_FLOOR {
        for (turn_idx, slot) in threats.iter_mut().enumerate() {
            let turn = turn_idx + 1;
            if (1..=3).contains(&turn) {
                *slot = slot.saturating_add(1);
            }
        }
    }
    if features.control.commitment > 0.55 {
        for (turn_idx, slot) in threats.iter_mut().enumerate() {
            let turn = turn_idx + 1;
            if turn == 3 || turn == 4 {
                *slot = slot.saturating_sub(1);
            }
        }
    }
    threats
}
```

### Required shapes in sibling modules (for this file to compile)

- `plan/mod.rs`:
  ```rust
  pub struct PlanSnapshot {
      pub expected_lands: [u8; 15],
      pub expected_mana: [u8; 15],
      pub expected_threats: [u8; 15],
      pub tempo_class: TempoClass,
  }
  pub enum TempoClass { Ramp, Aggro, Control, Midrange, Combo }   // PartialEq for tests
  ```
- `deck_profile.rs`: `pub enum DeckArchetype { Aggro, Control, Combo, Ramp, Midrange }`.
- `features/mod.rs`: `pub struct DeckFeatures` (`Default`) with public fields
  `archetype: DeckArchetype`, and sub-features each exposing the read fields:
  `landfall.commitment`, `mana_ramp.commitment`, `tribal.commitment`,
  `aggro_pressure.commitment`, `tokens_wide.commitment`,
  `control.{commitment, reactive_tempo}`, `aristocrats.commitment`,
  `plus_one_counters.commitment` (all `f32`/`f64` — Phase compares against `f64`
  literals; keep the same float type the ported `DeckFeatures` uses).
- Threshold consts in the three feature modules (names per §2 import block).

### Tests
Phase ships a `#[cfg(test)] mod tests` (≈12 tests) exercising the bumps,
idempotency guard, and tempo-class branches. Per manabrew AGENTS.md "No unit
tests unless explicitly asked" — **do not port the test module** unless the
implementer is told to. If ported, it needs `Default`/constructor parity on the
feature structs (`LandfallFeature`, `ManaRampFeature`, `TribalFeature`,
`AristocratsFeature`, `ControlFeature`, `AggroPressureFeature`) with the exact
fields the tests set.

---

## 4. Dependencies on other phase-ai modules

This file sits at the **top** of the plan-derivation chain and depends on:

- `crate::features` (and submodules `aggro_pressure`, `tokens_wide`, `tribal`,
  `control`, `aristocrats`, `plus_one_counters`, `landfall`, `mana_ramp`) — the
  `DeckFeatures` prior and the five threshold constants. **Must be ported first.**
- `crate::deck_profile` — `DeckArchetype`. **Must be ported first.**
- `super` = `plan/mod.rs` — `PlanSnapshot`, `TempoClass` (and downstream
  `PlanState` live realization, which `curves.rs` does not call).

Nothing depends on `curves.rs` except `plan/mod.rs` (re-export) and the
`AiSession` that calls `derive_snapshot` once per game.

---

## 5. Risks — adaptation vs. infeasible

- **Engine coupling: NONE.** This is the lowest-risk file in the whole port —
  zero `forge-engine` API surface. It will compile against manabrew the moment
  its three phase-ai sibling deps exist. Nothing here is infeasible on the
  Forge-DSL engine.
- **Real risk is upstream, not here.** The faithfulness of `curves.rs` is
  entirely inherited from `DeckFeatures` accuracy. Those feature extractors
  (`features/*.rs`) DO read engine/card data (mana costs, types, keywords, card
  scripts) and are where the Forge-DSL-vs-Phase adaptation actually happens. Port
  and validate those first; `curves.rs` is a pure transform on top.
- **Constant drift.** The five imported threshold constants are defined
  elsewhere. If the feature modules are ported with different threshold values,
  the tempo-class ladder silently changes behavior. Carry those consts verbatim
  and keep the `as` import-aliases so the comparison semantics stay identical.
- **Float type consistency.** Phase compares `commitment`/`reactive_tempo`
  against `f64` literals (`0.5`, `0.3`, `0.55`, `0.35`). Keep the feature fields
  the same float width to avoid `f32`/`f64` comparison surprises at the
  boundaries (`>` vs `>=` are also load-bearing — note branch 1/5/6/7 use `>`,
  branches 3/4 and the aggro/tribal floors use `>=`).
- **Branch order is semantic.** The `tempo_class_for` ladder order encodes hybrid
  precedence (ramp > tribal-aggro > aggro-pressure > tokens-wide > control >
  aristocrats > +1/+1 > archetype). Do not reorder for "tidiness."
- **Array length.** `SCHEDULE_LEN = 15` is baked into `PlanSnapshot`'s array
  types; keep them in lockstep.

---

### Summary (return value)
- **Ported size:** ~190 LOC core (3 small fns + dispatch), ~360 LOC with Phase's test module (tests optional per repo policy).
- **Key deps:** phase-ai siblings only — `features` (+ 8 sub-features & 5 threshold consts), `deck_profile::DeckArchetype`, `plan/mod.rs::{PlanSnapshot, TempoClass}`. Zero forge-engine APIs.
- **Main risk:** none in this file (fully engine-agnostic); faithfulness is inherited from the upstream `DeckFeatures` extractors and the verbatim threshold constants — port those first/correctly.
