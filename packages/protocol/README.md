# @manabrew/protocol

TypeScript types for the [Manabrew](https://manabrew.app) wire protocol — the
engine↔client message contract used by the Manabrew Magic: The Gathering client.

The types are generated from the Rust source of truth
([`manabrew-protocol`](https://crates.io/crates/manabrew-protocol)) and published
in lockstep with it, so both sides of the wire always agree.

- Protocol reference: <https://docs.manabrew.app/protocol/>
- Repository: <https://github.com/witchesofthehill/manabrew>

## Install

```sh
npm install @manabrew/protocol
```

## Usage

```ts
import type { Prompt, PromptInput, PromptOutput } from "@manabrew/protocol";
import { VERSION, PROTOCOL_VERSION } from "@manabrew/protocol";
```

`VERSION` is the package version; `PROTOCOL_VERSION` is the integer wire version
a client must match to interoperate.
