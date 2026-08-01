package forge.harness.host;

import forge.game.Game;
import forge.game.combat.Combat;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.spellability.SpellAbilityStackInstance;
import forge.harness.common.SnapshotExtractor;

import java.util.HashSet;
import java.util.Set;

final class PriorityFastForward {
    private PriorityFastForward() {}
    static boolean reachedTarget(final Game game, final String untilPlayer, final String untilPhase) {
        final PhaseType target = parseStep(untilPhase);
        if (target == null) {
            return true;
        }
        final PhaseType current = game.getPhaseHandler().getPhase();
        final Player active = game.getPhaseHandler().getPlayerTurn();
        if (current == null || active == null) {
            return true;
        }
        if (targetPlayerHasLost(game, untilPlayer)) {
            return true;
        }
        final String activeSlot = "player-" + SnapshotExtractor.playerIndex(game, active);
        return activeSlot.equals(untilPlayer) && !current.isBefore(target);
    }

    /**
     * Without this, an extra turn will be swallowed by the PassUntil
     * The engine would fast forward to opponents phase without even showing to the client
     */
    static boolean invalidatedByExtraTurn(
            final Game game, final Player holder, final String untilPlayer, final int declaredTurn) {
        final Player active = game.getPhaseHandler().getPlayerTurn();
        if (active != holder || !active.isExtraTurn()) {
            return false;
        }
        if (game.getPhaseHandler().getTurn() == declaredTurn) {
            return false;
        }
        return !("player-" + SnapshotExtractor.playerIndex(game, holder)).equals(untilPlayer);
    }

    /**
     * The client computes the pass-until target from a linear phase model —
     * each phase at most once per turn. An inserted extra phase (Moraug,
     * Aggravated Assault) is the only thing that steps the phase sequence
     * backward within a turn, and it means the held target was computed
     * against the wrong model: without this, the hold would silently
     * fast-forward through the repeated combat.
     */
    static boolean invalidatedByExtraPhase(final PhaseType current, final PhaseType maxSeen) {
        return current != null && maxSeen != null && current.isBefore(maxSeen);
    }

    /** A held target on a player who has left the game would never be reached. */
    private static boolean targetPlayerHasLost(final Game game, final String untilPlayer) {
        for (final Player p : game.getRegisteredPlayers()) {
            if (("player-" + SnapshotExtractor.playerIndex(game, p)).equals(untilPlayer)) {
                return p.hasLost();
            }
        }
        return false;
    }

    static Set<Integer> stackIds(final Game game) {
        final Set<Integer> ids = new HashSet<>();
        for (final SpellAbilityStackInstance si : game.getStack()) {
            ids.add(si.getId());
        }
        return ids;
    }

    /**
     * An exhaust-stack pass ends when the stack has emptied, or as soon as any
     * new object appears on it — a response or a fresh trigger both deserve a
     * priority window (the holder may want to counter it).
     */
    static boolean exhaustEnded(final Game game, final Set<Integer> declaredIds) {
        if (game.getStack().isEmpty()) {
            return true;
        }
        for (final SpellAbilityStackInstance si : game.getStack()) {
            if (!declaredIds.contains(si.getId())) {
                return true;
            }
        }
        return false;
    }

    /** Auto-pass (skip the prompt) only with an empty stack outside active combat. */
    static boolean canSkip(final Game game) {
        final PhaseType current = game.getPhaseHandler().getPhase();
        if (current == null) {
            return false;
        }
        if (isActiveCombat(game, current)) {
            return false;
        }
        return game.getStack().isEmpty();
    }

    private static boolean isActiveCombat(final Game game, final PhaseType current) {
        final Combat combat = game.getCombat();
        if (combat == null || combat.getAttackers().isEmpty()) {
            return false;
        }
        switch (current) {
            case COMBAT_DECLARE_ATTACKERS:
            case COMBAT_DECLARE_BLOCKERS:
            case COMBAT_FIRST_STRIKE_DAMAGE:
            case COMBAT_DAMAGE:
            case COMBAT_END:
                return true;
            default:
                return false;
        }
    }

    /** Keep in sync with the protocol StepKind serde names (manabrew-protocol game/mod.rs). */
    private static PhaseType parseStep(final String step) {
        switch (step) {
            case "untap": return PhaseType.UNTAP;
            case "upkeep": return PhaseType.UPKEEP;
            case "draw": return PhaseType.DRAW;
            case "main1": return PhaseType.MAIN1;
            case "combatBegin": return PhaseType.COMBAT_BEGIN;
            case "combatDeclareAttackers": return PhaseType.COMBAT_DECLARE_ATTACKERS;
            case "combatDeclareBlockers": return PhaseType.COMBAT_DECLARE_BLOCKERS;
            case "combatFirstStrikeDamage": return PhaseType.COMBAT_FIRST_STRIKE_DAMAGE;
            case "combatDamage": return PhaseType.COMBAT_DAMAGE;
            case "combatEnd": return PhaseType.COMBAT_END;
            case "main2": return PhaseType.MAIN2;
            case "endOfTurn": return PhaseType.END_OF_TURN;
            case "cleanup": return PhaseType.CLEANUP;
            default: return null;
        }
    }
}
