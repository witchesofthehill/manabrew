# License

This project is licensed under **AGPL-3.0-or-later**. The full legal text is in
[`LICENSE-AGPL-3.0-or-later`](./LICENSE-AGPL-3.0-or-later).

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
combination), so this is additive. Manabrew's own code is offered under
AGPL-3.0-or-later; the vendored `forge/` tree remains GPL-3.0-or-later under its
upstream terms — we do not, and cannot, relicense upstream's code. Earlier
contributions made under GPL-3.0-or-later combine with the AGPL code under
GPLv3 §13, so the network-source obligation applies to the work as a whole.

Full text: [`LICENSE-AGPL-3.0-or-later`](./LICENSE-AGPL-3.0-or-later).

## Distribution

The Tauri desktop installers, the web bundle, and any other built artifact of
this repository are distributed under AGPL-3.0-or-later, including all required
obligations (source availability, network-use source offer, license-text
inclusion, notice of modifications).

## Protocol — CC-BY-4.0

The protocol specification — the documentation under
`website/src/content/docs/protocol/` (published at <https://docs.manabrew.app/protocol/>) —
is published under
**Creative Commons Attribution 4.0 International (CC-BY-4.0)** so that third
parties may describe or implement against the same wire format without
depending on this repository. The license is declared in the overview page's
header.

## Contributing

Contributors are asked to add a `Signed-off-by:` trailer to every commit (the
[Developer Certificate of Origin](https://developercertificate.org/)
convention). All contributions to this repository are offered under
AGPL-3.0-or-later, except changes to the protocol specification under
`website/src/content/docs/protocol/`, which are offered under CC-BY-4.0.
