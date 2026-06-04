package forge.harness.common;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import forge.game.Game;
import forge.game.card.Card;
import forge.game.card.CounterEnumType;
import forge.game.card.CounterType;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.spellability.SpellAbilityStackInstance;
import forge.game.zone.ZoneType;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Extracts a normalized StateSnapshot from the Java Forge game state.
 * Output format matches the Rust {@code StateSnapshot} struct exactly.
 */
public final class SnapshotExtractor {
    private SnapshotExtractor() {}

    private static final Gson GSON = new GsonBuilder().create();

    /**
     * Extract a snapshot and return it as a JSON string (single line).
     */
    public static String snapshotJson(Game game) {
        Map<String, Object> snapshot = extractSnapshot(game);
        return GSON.toJson(snapshot);
    }

    /**
     * Extract a normalized snapshot as a Map matching the Rust StateSnapshot.
     */
    public static Map<String, Object> extractSnapshot(Game game) {
        Map<String, Object> snapshot = new LinkedHashMap<>();

        snapshot.put("turn", game.getPhaseHandler().getTurn());
        snapshot.put("phase", phaseToRustName(game.getPhaseHandler().getPhase()));
        snapshot.put("active_player", playerIndex(game, game.getPhaseHandler().getPlayerTurn()));
        snapshot.put("priority_player", playerIndex(game, game.getPhaseHandler().getPriorityPlayer()));
        snapshot.put("game_over", game.isGameOver());

        // winner
        if (game.getOutcome() != null && !game.getOutcome().isDraw() && game.getOutcome().getWinningLobbyPlayer() != null) {
            String winnerName = game.getOutcome().getWinningLobbyPlayer().getName();
            for (Player p : game.getPlayers()) {
                if (p.getName().equals(winnerName)) {
                    snapshot.put("winner", playerIndex(game, p));
                    break;
                }
            }
        }
        if (!snapshot.containsKey("winner")) {
            snapshot.put("winner", null);
        }

        // players — use getRegisteredPlayers() to include lost players
        List<Map<String, Object>> players = new ArrayList<>();
        for (Player p : game.getRegisteredPlayers()) {
            players.add(snapshotPlayer(game, p));
        }
        snapshot.put("players", players);

        // stack
        List<String> stack = new ArrayList<>();
        for (SpellAbilityStackInstance si : game.getStack()) {
            if (si.getSourceCard() != null) {
                stack.add(normalizeCardName(si.getSourceCard().getName()));
            } else {
                stack.add(si.getStackDescription());
            }
        }
        Collections.sort(stack);
        snapshot.put("stack", stack);

        snapshot.put("timestamp_ms", System.currentTimeMillis());

        return snapshot;
    }

    private static Map<String, Object> snapshotPlayer(Game game, Player p) {
        Map<String, Object> ps = new LinkedHashMap<>();

        ps.put("name", p.getName());
        ps.put("index", playerIndex(game, p));
        ps.put("life", p.getLife());
        ps.put("poison", p.getPoisonCounters());
        ps.put("lands_played", p.getLandsPlayedThisTurn());
        ps.put("has_lost", p.hasLost());
        ps.put("has_won", isOutcomeWinner(game, p));

        // Battlefield — full card snapshots sorted alphabetically
        List<Card> bfCards = new ArrayList<>(p.getCardsIn(ZoneType.Battlefield));
        bfCards.sort(Comparator.<Card, String>comparing(c -> normalizeCardName(c.getName()))
                .thenComparingInt(c -> c.isCreature() ? c.getNetPower() : 0)
                .thenComparingInt(c -> c.isCreature() ? c.getNetToughness() : 0)
                .thenComparing(c -> {
                    // Deterministic counter string matching Rust BTreeMap order
                    TreeMap<String, Integer> counters = new TreeMap<>();
                    for (Map.Entry<CounterType, Integer> entry : c.getCounters().entrySet()) {
                        if (entry.getValue() > 0) {
                            counters.put(counterTypeName(entry.getKey()), entry.getValue());
                        }
                    }
                    return counters.toString();
                })
                .thenComparing(Card::isTapped)
                .thenComparingInt(Card::getDamage)
                .thenComparing(Card::hasSickness)
                .thenComparingInt(c -> playerIndex(game, c.getController())));
        List<Map<String, Object>> battlefield = new ArrayList<>();
        for (Card c : bfCards) {
            battlefield.add(snapshotCard(game, c));
        }
        ps.put("battlefield", battlefield);

        // Graveyard — sorted names
        List<String> graveyard = p.getCardsIn(ZoneType.Graveyard).stream()
                .map(c -> normalizeCardName(c.getName()))
                .sorted()
                .collect(Collectors.toList());
        ps.put("graveyard", graveyard);

        // Hand — sorted names
        List<String> hand = p.getCardsIn(ZoneType.Hand).stream()
                .map(c -> normalizeCardName(c.getName()))
                .sorted()
                .collect(Collectors.toList());
        ps.put("hand", hand);

        // Exile — sorted names
        List<String> exile = p.getCardsIn(ZoneType.Exile).stream()
                .map(c -> normalizeCardName(c.getName()))
                .sorted()
                .collect(Collectors.toList());
        ps.put("exile", exile);

        // Library size (don't reveal contents)
        ps.put("library_size", p.getCardsIn(ZoneType.Library).size());

        // Diagnostic: just the top card (next to be drawn). Rust's comparator
        // only checks the single top card, so match that here.
        List<String> libraryTop = new ArrayList<>();
        int libTopCount = 0;
        for (Card libCard : p.getCardsIn(ZoneType.Library)) {
            if (libTopCount >= 10) break;
            libraryTop.add(normalizeCardName(libCard.getName()));
            libTopCount++;
        }
        ps.put("library_top", libraryTop);

        return ps;
    }

    private static Map<String, Object> snapshotCard(Game game, Card c) {
        Map<String, Object> cs = new LinkedHashMap<>();

        cs.put("name", normalizeCardName(c.getName()));
        cs.put("tapped", c.isTapped());
        cs.put("power", c.isCreature() ? c.getNetPower() : null);
        cs.put("toughness", c.isCreature() ? c.getNetToughness() : null);
        cs.put("damage", c.getDamage());
        cs.put("summoning_sick", c.hasSickness());

        // Counters — sorted by counter type name
        Map<String, Integer> counters = new TreeMap<>();
        for (Map.Entry<CounterType, Integer> entry : c.getCounters().entrySet()) {
            if (entry.getValue() > 0) {
                counters.put(counterTypeName(entry.getKey()), entry.getValue());
            }
        }
        cs.put("counters", counters);

        // Controller index
        cs.put("controller", playerIndex(game, c.getController()));

        return cs;
    }

    public static String javaCardId(Card c) {
        return "engine-card-" + ParityCardMap.parityId(c);
    }

    private static boolean isOutcomeWinner(Game game, Player p) {
        return game.getOutcome() != null
                && !game.getOutcome().isDraw()
                && game.getOutcome().getWinningLobbyPlayer() != null
                && p.getName().equals(game.getOutcome().getWinningLobbyPlayer().getName());
    }

    private static String normalizeCardName(String name) {
        if (name != null && name.startsWith("Troll of Khazad-d") && name.endsWith("m")) {
            return "Troll of Khazad-d\u00fbm";
        }
        return name;
    }

    /**
     * Map a Java PhaseType to the Rust Debug format (e.g. UNTAP -> "Untap").
     * Rust uses format!("{:?}", phase) which gives the variant name.
     */
    public static String phaseToRustName(PhaseType phase) {
        if (phase == null) return "Untap";
        switch (phase) {
            case UNTAP: return "Untap";
            case UPKEEP: return "Upkeep";
            case DRAW: return "Draw";
            case MAIN1: return "Main1";
            case COMBAT_BEGIN: return "CombatBegin";
            case COMBAT_DECLARE_ATTACKERS: return "CombatDeclareAttackers";
            case COMBAT_DECLARE_BLOCKERS: return "CombatDeclareBlockers";
            case COMBAT_FIRST_STRIKE_DAMAGE: return "CombatFirstStrikeDamage";
            case COMBAT_DAMAGE: return "CombatDamage";
            case COMBAT_END: return "CombatEnd";
            case MAIN2: return "Main2";
            case END_OF_TURN: return "EndOfTurn";
            case CLEANUP: return "Cleanup";
            default: return phase.name();
        }
    }

    /**
     * Map a counter type to the same string used by the Rust snapshot.
     * Java's CounterEnumType.getName() returns abbreviated names (e.g. "LOYAL"),
     * while the Rust engine uses full lowercase names (e.g. "loyalty").
     * Special cases: P1P1 -> "+1/+1", M1M1 -> "-1/-1".
     */
    private static String counterTypeName(CounterType ct) {
        // Check for CounterEnumType to use its enum name
        if (ct instanceof CounterEnumType) {
            CounterEnumType cet = (CounterEnumType) ct;
            switch (cet) {
                case P1P1: return "+1/+1";
                case M1M1: return "-1/-1";
                default:
                    // Use the enum constant name in lowercase: LOYALTY -> "loyalty"
                    return cet.name().toLowerCase();
            }
        }
        // Fallback for keyword counters etc.
        return ct.getName().toLowerCase();
    }

    public static int playerIndex(Game game, Player p) {
        if (p == null) return 0;
        List<Player> players = game.getRegisteredPlayers();
        for (int i = 0; i < players.size(); i++) {
            if (players.get(i).equals(p)) return i;
        }
        return 0;
    }
}
