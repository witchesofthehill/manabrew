# License

> **Proposal under discussion — see [#189](https://github.com/witchesofthehill/manabrew/issues/189).**
> This relicensing is pending consent from existing contributors and is not yet
> in effect. Until it lands, the repository remains GPL-3.0-or-later as recorded
> in [`LICENSE-GPL-3.0-or-later`](./LICENSE-GPL-3.0-or-later).

The proposed baseline is **AGPL-3.0-or-later for the whole project**.

## Engine and project — AGPL-3.0-or-later

The rules engine is a Rust rewrite of [Forge](https://github.com/Card-Forge/forge)
and vendors the Forge codebase in-tree as an oracle and architectural
reference. It is therefore a derivative of GPL-3.0-or-later code.

The project self-hosts network play, and a GPL engine run as a network service
does not trigger GPL's distribution clause — so improvements to a hosted
instance need never be shared back. AGPL-3.0-or-later closes that gap: §13
requires that users interacting with the engine over a network be offered the
corresponding source.

AGPL-3.0-or-later is compatible with GPL-3.0-or-later (GPLv3 §13 permits the
combination), so this is additive. ManaBrew's own code is offered under
AGPL-3.0-or-later; the vendored `forge/` tree remains GPL-3.0-or-later under its
upstream terms — we do not, and cannot, relicense upstream's code.

Full text: [`LICENSE-AGPL-3.0-or-later`](./LICENSE-AGPL-3.0-or-later).

## Distribution

The Tauri desktop installers, the web bundle, and any other built artifact of
this repository are distributed under AGPL-3.0-or-later, including all required
obligations (source availability, network-use source offer, license-text
inclusion, notice of modifications).

## Protocol — CC-BY-4.0

`docs/PROTOCOL.md` is published under
**Creative Commons Attribution 4.0 International (CC-BY-4.0)** so that third
parties may describe or implement against the same wire format without
depending on this repository. The license is declared in the file's header.
(Whether the protocol should move to CC-BY-SA is a separate question tracked in
[#189](https://github.com/witchesofthehill/manabrew/issues/189); this proposal
leaves it as CC-BY.)

## Contributing

Contributors are asked to add a `Signed-off-by:` trailer to every commit (the
[Developer Certificate of Origin](https://developercertificate.org/)
convention). Under this proposal, all contributions are offered under
AGPL-3.0-or-later, except changes to `docs/PROTOCOL.md`, which are offered under
CC-BY-4.0.
