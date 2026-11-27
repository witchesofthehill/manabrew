# AI Usage

`manabrew` has been developed with substantial AI assistance. This is an
explicit part of the project workflow, not something hidden from contributors.

## Scope

Manabrew Engine and its parity tools are deprecated. Do not use an agent to
investigate, port, test, or propose changes to them unless the maintainer
explicitly requests that work. For gameplay reports, investigate the active
Forge runtime and the client code that drives it. See [AGENTS.md](../AGENTS.md).

## Where AI is not enough

AI is not a rules authority. Check gameplay claims against the Magic rules
and the active Forge implementation. Verify changes with a focused reproduction
on the affected runtime.

## Contributor expectations

If you use AI in a contribution:

- review the generated diff yourself;
- remove invented abstractions and speculative error handling;
- check file placement against the project's conventions;
- report the exact checks you ran;
- be ready to explain the change in review.

You do not need to disclose every prompt. You should disclose AI involvement
when it materially shaped the implementation, investigation, or docs.

## AI and public trust

The project should not imply that AI output is a substitute for maintainership.
AI speeds up mechanical work, but maintainers remain responsible for correctness,
licensing, review, security, and public communication.
