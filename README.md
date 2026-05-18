<h1 align="center">manabrew</h1>

<p align="center">
  <strong>A modern, multiplayer-first client for Magic: The Gathering — powered by a Rust port of the <a href="https://github.com/Card-Forge/forge">Forge</a> rules engine.</strong>
</p>

<p align="center">
  <a href="https://manabrew.app"><img alt="Open app" src="https://img.shields.io/badge/Open%20app-manabrew.app-7c3aed?style=for-the-badge&logo=tauri&logoColor=white"></a>
  &nbsp;
  <a href="https://discord.gg/CES3KNVt"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join-5865F2?style=for-the-badge&logo=discord&logoColor=white"></a>
  &nbsp;
  <a href="./CONTRIBUTING.md"><img alt="Contributing" src="https://img.shields.io/badge/Contributing-Guide-24292f?style=for-the-badge&logo=github&logoColor=white"></a>
  &nbsp;
  <a href="./LICENSE.md"><img alt="License: GPL 3.0+" src="https://img.shields.io/badge/License-GPL%203.0%2B-2ea44f?style=for-the-badge&logo=gnu&logoColor=white"></a>
</p>

<table align="center">
  <tr>
    <td align="center" width="25%">
      <a href="./images/deckEdit.jpeg"><img src="./images/deckEdit.jpeg" alt="Deck editor" width="100%"/></a>
    </td>
    <td align="center" width="25%">
      <a href="./images/play.jpeg"><img src="./images/play.jpeg" alt="In-game play" width="100%"/></a>
    </td>
    <td align="center" width="25%">
      <a href="./images/vsSelection.jpeg"><img src="./images/vsSelection.jpeg" alt="Versus selection" width="100%"/></a>
    </td>
    <td align="center" width="25%">
      <a href="./images/battleground.png"><img src="./images/battleground.png" alt="Battleground" width="100%"/></a>
    </td>
  </tr>
</table>

> [!NOTE]
> This is unofficial fan software. It is not affiliated with, endorsed by, or
> sponsored by Wizards of the Coast LLC or by the Forge project. Magic: The
> Gathering, card names, rules text, and related marks are property of Wizards
> of the Coast LLC. Forge is developed by the Forge contributors. Card images
> are not shipped by this project.

---

## Community

- **App** — try the live build at <https://manabrew.app>.
- **Discord** — chat with the team and other players at
  <https://discord.gg/CES3KNVt>. Best place to ask questions, share decks,
  report rough edges, and follow development.

## Contents

- [What This Is](#what-this-is)
- [Current Status](#current-status)
- [Getting Started](#getting-started)
- [Common Commands](#common-commands)
- [Architecture](#architecture)
- [Parity Harness](#parity-harness)
- [Compiled IR and SVars](#compiled-ir-and-svars)
- [Background](#background) — Why this exists, Why Rust, Relationship with
  Forge
- [Contributing](#contributing)
- [AI-Assisted Development](#ai-assisted-development)
- [Project Philosophy](#project-philosophy)
- [License](#license)

---

## What This Is

- A Rust implementation of Forge's game engine, kept close to the Java source
  for behavioral parity.
- A React/Tauri client for local play, web play, deck management, and
  multiplayer.
- A differential parity harness that runs Rust and Java Forge side by side and
  reports the first gameplay divergence.
- A modern UI/runtime stack that can also interoperate with the Java Forge
  engine, either bundled behind Tauri for local play or hosted by a self-hosted
  room server.
- A GPL community project intended to be developed in the open.

> [!TIP]
> **Forge-engine interop:** `manabrew` is not limited to the Rust port. The
> same client/protocol stack can drive a Java Forge-backed game session, so
> Forge gameplay can run through the modern Tauri/web and self-hosted-room
> experience while the Rust engine continues moving toward parity.

## Current Status

`manabrew` is pre-release software. The Java Forge backend path gives the modern
client stack a way to run Forge-backed games today; the Rust engine is playable
for selected matchups and is actively being brought into parity. The most mature
part of the project is the development loop: we can run the Rust engine against
the Java Forge reference with the same decks, same seed, and same deterministic
choices, then fix divergences at the mechanic level.

Public release is being prepared. Some release-readiness work is still in
progress, including security cleanup, issue triage, naming, contributor
onboarding, and packaging.

---

## Getting Started

### Prerequisites

- Node.js 22.12+ recommended
- Yarn v1
- Rust stable
- Java 18 and Maven for Java Forge parity runs
- Platform prerequisites for [Tauri](https://tauri.app/start/prerequisites/)

### Install

```bash
yarn install
```

### Run The Desktop App

```bash
yarn dev
```

### Run The Web Build

```bash
yarn dev:web
```

### Build

```bash
yarn build
```

### Check Formatting, Types, And Lints

```bash
yarn lint:all
```

## Common Commands

| Command                | What it does                                           |
| ---------------------- | ------------------------------------------------------ |
| `yarn dev`             | Start the Tauri desktop app in development mode        |
| `yarn dev:web`         | Build the WASM engine and start the web client         |
| `yarn build`           | Build the desktop app                                  |
| `yarn build:web`       | Build the web app                                      |
| `yarn build:harness`   | Build the Java Forge parity harness                    |
| `yarn parity`          | Run named parity scenarios                             |
| `yarn parity:test --`  | Run the parity binary with custom arguments            |
| `yarn parity:gui`      | Start the engine debugger                              |
| `yarn lint:all`        | Run frontend lint/typecheck and Rust fmt/clippy checks |
| `yarn import-deck ...` | Import a deck from Archidekt or Moxfield               |

---

## Architecture

```text
React UI                    src/
Tauri desktop shell          src-tauri/
Web/WASM engine bridge       forge-engine/crates/forge-wasm/
Headless runtime             forge-engine/crates/self-hosted-node/
Relay / lobby server         forge-engine/crates/forge-server/
Agent protocol DTOs          forge-engine/crates/forge-agent-interface/
Rust rules engine            forge-engine/crates/forge-engine/
Card database + script IR    forge-engine/crates/forge-carddb/
Forge Java reference         forge/
Parity harness               forge-engine/crates/forge-parity/
```

The deeper engine workspace map is in
[forge-engine/README.md](./forge-engine/README.md).

## Parity Harness

Most engine work starts with a failing parity run:

```bash
yarn build:harness
yarn parity:test -- --deck1 red_burn --deck2 green_stompy --seed 42 --max-turns 20
```

The harness runs Rust and Java Forge with the same inputs, compares trace
snapshots, and reports the first mismatch. A good fix restores the missing
general rule in Rust by reading the corresponding Java file, not by special
casing the card that exposed the bug.

Start here:

- [Parity Testing Guide](./docs/PARITY_TESTING.md)
- [Engine Bugfix Workflow](./docs/agents/ENGINE_BUGFIX_WORKFLOW.md)
- [Parity Philosophy](./docs/agents/PARITY_PHILOSOPHY.md)

## Compiled IR and SVars

Forge card scripts are still the compatibility contract. The Rust engine is
gradually adding typed, compiled representations for the parts of that DSL where
raw string interpretation is risky or expensive: produced mana, defined-object
references, numeric expressions, selectors, costs, and similar engine-critical
domains.

This is the first deliberate divergence from Forge's mostly interpreted runtime
model. It is a performance and maintainability divergence, not a behavior
divergence. SVar resolution remains late-bound: SVars are parsed lazily and
looked up from the current host-card state when needed.

See [Forge Parity and IR](./docs/FORGE_PARITY_AND_IR.md) and the SVar semantics
in [docs/forge-dsl-semantics.md](./docs/forge-dsl-semantics.md).

---

## Background

<details>
<summary><strong>Why This Exists</strong></summary>

The immediate reason is mundane: a few friends in different countries wanted to
play Magic online together. We tried the existing options. Each of them is good
at what it aims for, and Forge in particular is the project this work is built
on. None of them, though, quite fit what we wanted — a modern, open,
multiplayer-first home for a small group like ours. So we built one.

Forge itself remains the foundation. It has accumulated years of rules knowledge
and card-script coverage, and we did not want to discard that work or compete
with it by guessing from scratch.

`manabrew` exists to bring Forge's rules model into runtime shapes that are hard
for the Java/Swing stack to cover directly: web/WASM play, self-hosted
multiplayer, modern desktop UI, deterministic parity testing, and typed internal
representations for high-risk script semantics.

The project is therefore both conservative and experimental: conservative about
game behavior, where Java Forge remains the oracle; experimental about runtime,
tooling, UI, and deployment.

</details>

<details>
<summary><strong>Why Rust?</strong></summary>

Forge has years of rules knowledge and a very large card-script corpus. Rust
lets us explore a different runtime shape while preserving that knowledge:

- desktop app through Tauri;
- web/WASM builds for browser-based play;
- headless engine hosts for self-hosted multiplayer;
- deterministic traces for debugging, regression testing, and AI work;
- typed internal representations for hot or high-risk card-script semantics.

The goal is to carry Forge's rules knowledge into new deployment shapes while
keeping the Java implementation as the reference point for correctness.

</details>

<details>
<summary><strong>Relationship With Forge</strong></summary>

Forge is the foundation of this project.

- The Java Forge source under `forge/` is the reference implementation.
- The Rust engine mirrors Forge's rules structure and consumes Forge card
  scripts.
- The parity harness exists to keep behavior faithful to Forge, not to invent a
  different interpretation of the game.
- The repository is GPL-3.0-or-later because the engine and bundled card data
  are derivative of Forge.

The intent is to be a good-neighbor port and companion project. We do not expect
Forge maintainers to review or support this work, but we want the framing,
naming, and attributions to make the relationship explicit and courteous.

See [Forge Parity and IR](./docs/FORGE_PARITY_AND_IR.md) and
[Third-Party Notices](./THIRD-PARTY-NOTICES.md). For related projects and
ecosystem context, see [Ecosystem](./docs/ECOSYSTEM.md).

</details>

---

## Contributing

Contributions are welcome once the repository is public. The most useful early
contributions are small, well-scoped parity fixes, documentation improvements,
UI bug fixes, and reproducible issue reports.

Before opening a PR, read [CONTRIBUTING.md](./CONTRIBUTING.md). In short:

- work from an issue or open one first for larger changes;
- use Conventional Commit messages;
- sign commits with a DCO `Signed-off-by:` trailer;
- for engine fixes, read the Java Forge counterpart before editing Rust;
- run `yarn lint:all` before asking for review;
- do not bundle card images or secrets.

## AI-Assisted Development

This repository has been built with substantial AI assistance, especially for
mechanical porting, parity investigation, trace analysis, documentation, and
large-scale inventory work. AI output is treated as code written by a
contributor: it must be reviewed, tested, and grounded in Forge's Java behavior.

See [AI Usage](./docs/AI_USAGE.md).

## Project Philosophy

The short version:

- Correctness beats novelty for engine behavior.
- Forge is the oracle.
- Ports should fix mechanics, not individual cards.
- Public releases should be honest about what works and what does not.
- The project should be non-commercial, self-hostable, and respectful of the
  communities and rights-holders around the game.

See [Project Philosophy](./docs/PROJECT_PHILOSOPHY.md).

## License

Source code in this repository is licensed under GPL-3.0-or-later, except where
a file states otherwise. `docs/PROTOCOL.md` is published under CC-BY-4.0 so
other implementations can describe or implement the same wire format.

See [LICENSE.md](./LICENSE.md), [LICENSE-GPL-3.0-or-later](./LICENSE-GPL-3.0-or-later),
and [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).

---

<div align="center">
  <sub>Built with care by the ManaBrew contributors · GPL-3.0-or-later · Forge is the oracle.</sub>
</div>
