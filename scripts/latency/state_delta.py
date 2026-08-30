"""Rebuild a seat's game state from the patches the node sends.

Port of manabrew-rs/crates/manabrew-relay-protocol/src/state_delta.rs. Keep the
two in step: the sentinels and the order they are applied in are load-bearing.

State patches became the default on 2026-08-20 (#697). Captures from before that
carry full `state` envelopes and captures from after carry almost none, so a
reader that only understands `"kind":"state"` measures the wait for the next
full state and silently drops most games. That is what this exists to avoid.

    $v  replace this subtree with the wrapped value
    $k  keyed-array patch: element key -> sub-patch
    $d  removals: object field names, or element keys in a keyed array
    $o  the complete new key order, not a delta of it

Apply order is $d, then $k, then $o, then materialise by order. A patch that is
not an object (scalar, null, array) replaces outright, so a real null is a value
and never a delete marker.

`base` and `fingerprint` chain the patches but are opaque here: the sender is
the only authority on them, so nothing is verified against a recomputed hash.
Every `forPlayer` runs an independent chain, including "" for broadcast.
"""

LIT, KEYED, REM, ORD = "$v", "$k", "$d", "$o"


def element_key(value):
    if not isinstance(value, dict):
        return None
    if isinstance(value.get("id"), str):
        return value["id"]
    zone, owner = value.get("zone"), value.get("ownerId")
    if isinstance(zone, str) and isinstance(owner, str):
        return f"{zone}/{owner}"
    return None


def apply(previous, patch):
    if not isinstance(patch, dict):
        return patch
    if LIT in patch:
        return patch[LIT]
    if KEYED in patch or ORD in patch:
        return apply_keyed(previous, patch)
    result = dict(previous) if isinstance(previous, dict) else {}
    for key in patch.get(REM) or []:
        result.pop(key, None)
    for key, inner in patch.items():
        if key == REM:
            continue
        result[key] = apply(result.get(key), inner)
    return result


def apply_keyed(previous, patch):
    before = previous if isinstance(previous, list) else []
    order, elements = [], {}
    for value in before:
        key = element_key(value) or ""
        order.append(key)
        elements[key] = value
    for key in patch.get(REM) or []:
        elements.pop(key, None)
        order = [k for k in order if k != key]
    for key, inner in (patch.get(KEYED) or {}).items():
        if key not in elements:
            order.append(key)
        elements[key] = apply(elements.get(key), inner)
    new_order = patch.get(ORD)
    if isinstance(new_order, list):
        order = [k for k in new_order if isinstance(k, str)]
    return [elements[k] for k in order if k in elements]


def board_size(state):
    """Cards carrying `summoningSick`, the board-size proxy used throughout.

    Equals a `"summoningSick"` count over the raw line, checked against 7904
    pre-patch states, so figures stay comparable across the rollout.
    """
    zones = ((state or {}).get("gameView") or {}).get("zones")
    if not isinstance(zones, list):
        return 0
    total = 0
    for zone in zones:
        if not isinstance(zone, dict):
            continue
        for card in zone.get("cards") or []:
            if isinstance(card, dict) and "summoningSick" in card:
                total += 1
    return total


class SeatStates:
    """The per-seat chains, fed every state-bearing envelope in capture order."""

    def __init__(self):
        self.states = {}
        self.sizes = {}
        self.patched = False

    def observe(self, envelope):
        """Absorb one envelope; True if it was state-bearing (the engine answered)."""
        kind = envelope.get("kind")
        if kind == "state":
            seat = envelope.get("forPlayer") or ""
            self.states[seat] = envelope.get("state")
        elif kind == "stateDelta":
            self.patched = True
            seat = envelope.get("forPlayer") or ""
            if seat not in self.states:
                return True
            self.states[seat] = apply(self.states[seat], envelope.get("patch") or {})
        else:
            return False
        self.sizes[seat] = board_size(self.states[seat])
        return True

    def size_for(self, seat):
        return self.sizes.get(seat, 0)
