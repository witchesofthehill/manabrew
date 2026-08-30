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
import { VERSION, PROTOCOL_VERSION, RELAY_PROTOCOL_VERSION } from "@manabrew/protocol";
```

`VERSION` is this package's own version, matching what you installed.

`PROTOCOL_VERSION` is the integer wire version a client must report to a relay
to interoperate. It is the major of `manabrew-relay-protocol`, so it only moves
on a breaking wire change, and most releases leave it alone.
`RELAY_PROTOCOL_VERSION` is that crate's full version, for anyone who needs to
tell two releases apart at the same wire version.
