package forge.harness.host;

import forge.game.Game;
import forge.game.combat.Combat;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.harness.common.SnapshotExtractor;

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
        final String activeSlot = "player-" + SnapshotExtractor.playerIndex(game, active);
        return activeSlot.equals(untilPlayer) && !current.isBefore(target);
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

    private static PhaseType parseStep(final String step) {
        switch (step) {
            case "untap": return PhaseType.UNTAP;
            case "upkeep": return PhaseType.UPKEEP;
            case "draw": return PhaseType.DRAW;
            case "main1": return PhaseType.MAIN1;
            case "begin_combat": return PhaseType.COMBAT_BEGIN;
            case "declare_attackers": return PhaseType.COMBAT_DECLARE_ATTACKERS;
            case "declare_blockers": return PhaseType.COMBAT_DECLARE_BLOCKERS;
            case "first_strike_damage": return PhaseType.COMBAT_FIRST_STRIKE_DAMAGE;
            case "combat_damage": return PhaseType.COMBAT_DAMAGE;
            case "end_combat": return PhaseType.COMBAT_END;
            case "main2": return PhaseType.MAIN2;
            case "end": return PhaseType.END_OF_TURN;
            case "cleanup": return PhaseType.CLEANUP;
            default: return null;
        }
    }
}
