# Security Policy

## Supported versions

Manabrew is pre-release software. Only the latest release and the current
`main` branch receive security fixes.

## Reporting a vulnerability

Please do **not** open a public issue for security vulnerabilities.

Report privately via
[GitHub's private vulnerability reporting](https://github.com/witchesofthehill/manabrew/security/advisories/new)
("Report a vulnerability" on the repository's Security tab), or by direct
message to the maintainers on [Discord](https://discord.gg/NqrKpbhtcd).

Include what you can: affected component (web client, desktop app, relay
server, self-hosted node), reproduction steps, and impact. You'll get an
acknowledgement as soon as a maintainer sees it, and credit in the fix's
release notes unless you prefer otherwise.

Of particular interest: anything reachable through the relay server or a
self-hosted node by untrusted players (message parsing, room handling,
resource exhaustion), and anything that lets a web page escape the game's
sandbox.
