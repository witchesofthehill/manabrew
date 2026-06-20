package forge.harness.host;

import forge.harness.common.SnapshotExtractor;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import forge.card.ColorSet;
import forge.card.MagicColor;
import forge.game.Game;
import forge.ai.ComputerUtilCombat;
import forge.game.card.Card;
import forge.game.card.CounterEnumType;
import forge.game.card.CounterType;
import forge.game.combat.Combat;
import forge.game.cost.Cost;
import forge.game.cost.CostAdjustment;
import forge.game.keyword.KeywordInterface;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import forge.game.spellability.SpellAbilityStackInstance;
import forge.game.spellability.TargetChoices;
import forge.game.zone.ZoneType;
import forge.item.IPaperCard;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

public final class InteractiveSnapshotExtractor {
    private InteractiveSnapshotExtractor() {}

    private static final Gson GSON = new GsonBuilder().create();

    public static String snapshotJson(
            final Game game,
            final SpellAbility castingAbility,
            final String gameId,
            final int viewer
    ) {
        return GSON.toJson(buildGameView(game, castingAbility, gameId, viewer));
    }

    private static Map<String, Object> buildGameView(
            final Game game,
            final SpellAbility castingAbility,
            final String gameId,
            final int viewer
    ) {
        final Map<String, Object> base = SnapshotExtractor.extractSnapshot(game);

        final List<Map<String, Object>> players = new ArrayList<>();
        final List<Map<String, Object>> battlefield = new ArrayList<>();
        final List<String> concededPlayerIds = new ArrayList<>();
        for (final Player player : game.getRegisteredPlayers()) {
            final int index = SnapshotExtractor.playerIndex(game, player);
            players.add(toPlayer(game, player, index, viewer));
            for (final Card card : player.getCardsIn(ZoneType.Battlefield)) {
                battlefield.add(toCard(game, card, index, "battlefield", false));
            }
            if (player.conceded()) {
                concededPlayerIds.add("player-" + index);
            }
        }

        final String activePlayerId = "player-" + asIndex(base.get("active_player"));

        final Map<String, Object> view = new LinkedHashMap<>();
        view.put("gameId", gameId);
        view.put("turn", base.get("turn"));
        view.put("step", normalizeStep((String) base.get("phase")));
        view.put("combatAssignments", snapshotCombat(game));
        view.put("activePlayerId", activePlayerId);
        view.put("priorityPlayerId", "player-" + asIndex(base.get("priority_player")));
        view.put("players", players);
        view.put("battlefield", battlefield);
        view.put("stack", snapshotStack(game, castingAbility, activePlayerId));
        view.put("gameOver", base.get("game_over"));
        final Object winner = base.get("winner");
        if (winner != null) {
            view.put("winnerId", "player-" + winner);
        }
        view.put("concededPlayerIds", concededPlayerIds);
        final Player monarch = game.getMonarch();
        if (monarch != null) {
            view.put("monarchId", "player-" + SnapshotExtractor.playerIndex(game, monarch));
        }
        final Player initiative = game.getHasInitiative();
        if (initiative != null) {
            view.put("initiativeHolderId", "player-" + SnapshotExtractor.playerIndex(game, initiative));
        }
        return view;
    }

    private static int asIndex(final Object value) {
        return value instanceof Number ? ((Number) value).intValue() : 0;
    }

    private static Map<String, Object> toPlayer(
            final Game game,
            final Player player,
            final int index,
            final int viewer
    ) {
        final Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", "player-" + index);
        out.put("name", player.getName());
        out.put("isHuman", index == viewer);
        out.put("life", player.getLife());
        out.put("poison", player.getPoisonCounters());
        out.put("hand", richCards(game, player.getCardsIn(ZoneType.Hand), index, "hand", true));
        out.put("graveyard", richCards(game, player.getCardsIn(ZoneType.Graveyard), index, "graveyard", false));
        out.put("exile", richCards(game, player.getCardsIn(ZoneType.Exile), index, "exile", false));
        // Drop engine-internal effect objects (e.g. the "Commander Effect"
        // DetachedCardEffect that hosts command-zone statics) — they are
        // immutable EFFECT pieces, not real cards, and the client can't
        // resolve them back to a deck entry.
        final List<Card> commandZone = new ArrayList<>();
        for (final Card card : player.getCardsIn(ZoneType.Command)) {
            if (!card.isImmutable()) {
                commandZone.add(card);
            }
        }
        out.put("commandZone", richCards(game, commandZone, index, "command", true));
        out.put("libraryCount", player.getCardsIn(ZoneType.Library).size());
        out.put("manaPool", manaPool(player));
        out.put("commanderDamage", commanderDamage(game, player));
        out.put("energyCounters", player.getCounters(CounterEnumType.ENERGY));
        out.put("radiationCounters", player.getCounters(CounterEnumType.RAD));
        out.put("hasCityBlessing", player.hasBlessing());
        out.put("ringLevel", player.getNumRingTemptedYou());
        out.put("speed", player.getSpeed());
        return out;
    }

    private static Map<String, Integer> manaPool(final Player player) {
        final Map<String, Integer> pool = new LinkedHashMap<>();
        pool.put("W", player.getManaPool().getAmountOfColor(MagicColor.WHITE));
        pool.put("U", player.getManaPool().getAmountOfColor(MagicColor.BLUE));
        pool.put("B", player.getManaPool().getAmountOfColor(MagicColor.BLACK));
        pool.put("R", player.getManaPool().getAmountOfColor(MagicColor.RED));
        pool.put("G", player.getManaPool().getAmountOfColor(MagicColor.GREEN));
        pool.put("C", player.getManaPool().getAmountOfColor(MagicColor.COLORLESS));
        return pool;
    }

    private static Map<String, Integer> commanderDamage(final Game game, final Player player) {
        final Map<String, Integer> out = new LinkedHashMap<>();
        for (final Map.Entry<Card, Integer> entry : player.getCommanderDamage()) {
            if (entry.getValue() != null && entry.getValue() > 0) {
                out.put(SnapshotExtractor.javaCardId(entry.getKey()), entry.getValue());
            }
        }
        return out;
    }

    private static List<Map<String, Object>> richCards(
            final Game game,
            final Iterable<Card> cards,
            final int ownerIndex,
            final String zoneId,
            final boolean castable
    ) {
        final List<Map<String, Object>> out = new ArrayList<>();
        for (final Card card : cards) {
            out.add(toCard(game, card, ownerIndex, zoneId, castable));
        }
        return out;
    }

    static com.google.gson.JsonElement cardDtoJson(final Game game, final Card card, final boolean castable) {
        final int ownerIndex = card.getOwner() != null ? SnapshotExtractor.playerIndex(game, card.getOwner()) : 0;
        return GSON.toJsonTree(toCard(game, card, ownerIndex, promptZoneId(card), castable));
    }

    private static String promptZoneId(final Card card) {
        if (card.getZone() == null) {
            return "";
        }
        switch (card.getZone().getZoneType()) {
            case Battlefield: return "battlefield";
            case Hand: return "hand";
            case Graveyard: return "graveyard";
            case Exile: return "exile";
            case Command: return "command";
            case Library: return "library";
            case Stack: return "stack";
            default: return "";
        }
    }

    private static Map<String, Object> toCard(
            final Game game,
            final Card card,
            final int ownerIndex,
            final String zoneId,
            final boolean castable
    ) {
        final Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", SnapshotExtractor.javaCardId(card));
        out.put("name", normalizeCardName(card.getName()));
        final IPaperCard paper = card.getPaperCard();
        out.put("setCode", paper != null ? paper.getEdition() : card.getSetCode());
        out.put("cardNumber", paper != null ? paper.getCollectorNumber() : "");
        out.put("color", colorString(card.getColor()));
        out.put("manaCost", card.getManaCost() == null ? "" : card.getManaCost().toString());
        out.put("cmc", card.getCMC());
        out.put("types", coreTypes(card));
        out.put("subtypes", subtypes(card));
        out.put("supertypes", supertypes(card));
        if (card.isCreature()) {
            final int power = card.getNetPower();
            final int toughness = card.getNetToughness();
            out.put("power", String.valueOf(power));
            out.put("toughness", String.valueOf(toughness));
            out.put("basePower", power);
            out.put("baseToughness", toughness);
        }
        out.put("text", card.getOracleText());
        out.put("isPlayable", false);
        out.put("controllerId", "player-" + SnapshotExtractor.playerIndex(game, card.getController()));
        out.put("ownerId", "player-" + ownerIndex);
        out.put("zoneId", zoneId);
        out.put("tapped", card.isTapped());
        out.put("keywords", keywords(card));
        out.put("counters", counterMap(card));
        out.put("damage", card.getDamage());
        out.put("summoningSick", card.hasSickness());
        out.put("isToken", card.isToken());
        out.put("isCopy", card.isCloned());
        out.put("isDoubleFaced", card.isDoubleFaced());
        out.put("isTransformed", card.isTransformed());
        out.put("isFaceDown", card.isFaceDown());
        out.put("isBestowed", card.isBestowed());
        out.put("phasedOut", card.isPhasedOut());
        out.put("exerted", card.getExertedThisTurn() > 0);
        out.put("isRingBearer", card.isRingBearer());
        out.put("isCrewed", card.getTimesCrewedThisTurn() > 0);
        out.put("isMadnessExiled", card.isMadness());
        out.put("isPlotted", card.isPlotted());
        out.put("isWarpExiled", card.isWarped());
        out.put("foil", card.hasPaperFoil());

        final Card attachedTo = card.getAttachedTo();
        if (attachedTo != null) {
            out.put("attachedTo", SnapshotExtractor.javaCardId(attachedTo));
        }
        final List<String> attachmentIds = new ArrayList<>();
        for (final Card attachment : card.getAttachedCards()) {
            attachmentIds.add(SnapshotExtractor.javaCardId(attachment));
        }
        out.put("attachmentIds", attachmentIds);

        final String flashback = keywordCost(card, "Flashback");
        if (flashback != null) {
            out.put("flashbackCost", flashback);
        }
        final String kicker = keywordCost(card, "Kicker");
        if (kicker != null) {
            out.put("kickerCost", kicker);
        }
        final String madness = keywordCost(card, "Madness");
        if (madness != null) {
            out.put("madnessCost", madness);
        }

        final Combat combat = game.getCombat();
        if (combat != null) {
            final boolean attacking = combat.isAttacking(card);
            if (attacking) {
                out.put("isAttacking", true);
                final Player defender = combat.getDefenderPlayerByAttacker(card);
                if (defender != null) {
                    out.put("attackingPlayerId",
                            "player-" + SnapshotExtractor.playerIndex(game, defender));
                }
            }
            // AI combat eval invoked from snapshot extraction, a context Forge
            // never calls it from; an escaped exception kills the game thread.
            if (attacking || combat.isBlocking(card)) {
                boolean wouldDie = false;
                try {
                    wouldDie = ComputerUtilCombat.combatantWouldBeDestroyed(card.getController(), card, combat);
                } catch (final RuntimeException ignored) {
                    wouldDie = false;
                }
                if (wouldDie) {
                    out.put("wouldDieInCombat", true);
                }
            }
        }
        if (castable) {
            final String effective = effectiveManaCost(card);
            if (effective != null) {
                out.put("effectiveManaCost", effective);
            }
        }
        return out;
    }

    private static String keywordCost(final Card card, final String name) {
        for (final KeywordInterface keyword : card.getKeywords()) {
            final String original = keyword.getOriginal();
            if (original == null || !original.startsWith(name)) {
                continue;
            }
            final String rest = original.substring(name.length());
            if (!rest.startsWith(":")) {
                continue;
            }
            final String body = rest.substring(1);
            final int next = body.indexOf(':');
            final String cost = (next >= 0 ? body.substring(0, next) : body).trim();
            if (!cost.isEmpty()) {
                return cost;
            }
        }
        return null;
    }

    // CostAdjustment is a cast-time op: it needs an activating player (else NPE)
    // and mutates the SpellAbility, so set/restore the activator, skip face-down
    // casts (which would flip the card), run on a copied cost, and swallow any
    // failure back to the printed cost. null = no reduction (UI keeps printed).
    private static String effectiveManaCost(final Card card) {
        if (card.isLand()) {
            return null;
        }
        final SpellAbility sa = card.getFirstSpellAbility();
        if (sa == null || !sa.isSpell() || sa.isCastFaceDown() || sa.getPayCosts() == null) {
            return null;
        }
        final Player previousActivator = sa.getActivatingPlayer();
        try {
            if (sa.getActivatingPlayer() == null) {
                sa.setActivatingPlayer(card.getController());
            }
            final Cost adjusted = CostAdjustment.adjust(sa.getPayCosts().copy(), sa, false);
            if (adjusted == null || adjusted.getCostMana() == null) {
                return null;
            }
            final String effective = adjusted.getCostMana().getMana().toString();
            final String printed = card.getManaCost() == null ? "" : card.getManaCost().toString();
            return effective.isEmpty() || effective.equals(printed) ? null : effective;
        } catch (final RuntimeException error) {
            return null;
        } finally {
            sa.setActivatingPlayer(previousActivator);
        }
    }

    private static String colorString(final ColorSet colors) {
        final StringBuilder sb = new StringBuilder();
        if (colors.hasWhite()) {
            sb.append('W');
        }
        if (colors.hasBlue()) {
            sb.append('U');
        }
        if (colors.hasBlack()) {
            sb.append('B');
        }
        if (colors.hasRed()) {
            sb.append('R');
        }
        if (colors.hasGreen()) {
            sb.append('G');
        }
        return sb.toString();
    }

    private static List<String> coreTypes(final Card card) {
        final List<String> out = new ArrayList<>();
        for (final Object type : card.getType().getCoreTypes()) {
            out.add(String.valueOf(type));
        }
        return out;
    }

    private static List<String> subtypes(final Card card) {
        final List<String> out = new ArrayList<>();
        for (final String subtype : card.getType().getSubtypes()) {
            out.add(subtype);
        }
        return out;
    }

    private static List<String> supertypes(final Card card) {
        final List<String> out = new ArrayList<>();
        for (final Object supertype : card.getType().getSupertypes()) {
            out.add(String.valueOf(supertype));
        }
        return out;
    }

    private static List<String> keywords(final Card card) {
        final List<String> out = new ArrayList<>();
        for (final KeywordInterface keyword : card.getKeywords()) {
            out.add(keyword.getOriginal());
        }
        return out;
    }

    private static Map<String, Integer> counterMap(final Card card) {
        final Map<String, Integer> counters = new TreeMap<>();
        for (final Map.Entry<CounterType, Integer> entry : card.getCounters().entrySet()) {
            if (entry.getValue() > 0) {
                counters.put(uiCounterName(entry.getKey()), entry.getValue());
            }
        }
        return counters;
    }

    private static List<Map<String, Object>> snapshotCombat(final Game game) {
        final List<Map<String, Object>> out = new ArrayList<>();
        final Combat combat = game.getCombat();
        if (combat == null) {
            return out;
        }
        for (final Card attacker : combat.getAttackers()) {
            for (final Card blocker : combat.getBlockers(attacker)) {
                final Map<String, Object> block = new LinkedHashMap<>();
                block.put("blockerId", SnapshotExtractor.javaCardId(blocker));
                block.put("attackerId", SnapshotExtractor.javaCardId(attacker));
                out.add(block);
            }
        }
        return out;
    }

    private static List<Map<String, Object>> snapshotStack(
            final Game game,
            final SpellAbility castingAbility,
            final String activePlayerId
    ) {
        final List<Map<String, Object>> out = new ArrayList<>();
        final List<SpellAbilityStackInstance> entries = new ArrayList<>();
        for (final SpellAbilityStackInstance item : game.getStack()) {
            entries.add(item);
        }
        Collections.reverse(entries);
        int index = 0;
        for (final SpellAbilityStackInstance item : entries) {
            final Map<String, Object> stackItem = new LinkedHashMap<>();
            stackItem.put("id", stackItemId(item));
            final Card source = item.getSourceCard();
            stackItem.put("sourceId", source == null
                    ? "engine-stack-source-" + index
                    : SnapshotExtractor.javaCardId(source));
            final SpellAbility sa = item.getSpellAbility();
            stackItem.put("controllerId", sa != null && sa.getActivatingPlayer() != null
                    ? "player-" + SnapshotExtractor.playerIndex(game, sa.getActivatingPlayer())
                    : activePlayerId);
            stackItem.put("name", source == null
                    ? item.getStackDescription()
                    : normalizeCardName(source.getName()));
            stackItem.put("text", item.getStackDescription());
            if (source != null) {
                final IPaperCard paper = source.getPaperCard();
                stackItem.put("setCode", paper != null ? paper.getEdition() : source.getSetCode());
                stackItem.put("cardNumber", paper != null ? paper.getCollectorNumber() : "");
                stackItem.put("isPermanentSpell", item.isSpell() && source.isPermanent());
            } else {
                stackItem.put("setCode", "");
                stackItem.put("cardNumber", "");
                stackItem.put("isPermanentSpell", false);
            }
            stackItem.put("isCasting", false);
            stackItem.put("targets", stackTargets(game, item.getSpellAbility()));
            out.add(stackItem);
            index++;
        }
        final Map<String, Object> casting = castingStackEntry(game, castingAbility, activePlayerId);
        if (casting != null) {
            out.add(casting);
        }
        return out;
    }

    private static Map<String, Object> castingStackEntry(
            final Game game,
            final SpellAbility castingAbility,
            final String activePlayerId
    ) {
        if (castingAbility == null) {
            return null;
        }
        if (!castingAbility.isSpell()) {
            return null;
        }
        final Card source = castingAbility.getHostCard();
        if (source == null) {
            return null;
        }
        for (final SpellAbilityStackInstance item : game.getStack()) {
            if (item.getSpellAbility() == castingAbility || item.getSourceCard() == source) {
                return null;
            }
        }
        final Map<String, Object> stackItem = new LinkedHashMap<>();
        stackItem.put("id", "casting-" + castingAbility.getId());
        stackItem.put("sourceId", SnapshotExtractor.javaCardId(source));
        stackItem.put("controllerId", castingAbility.getActivatingPlayer() != null
                ? "player-" + SnapshotExtractor.playerIndex(game, castingAbility.getActivatingPlayer())
                : activePlayerId);
        stackItem.put("name", normalizeCardName(source.getName()));
        stackItem.put("text", castingAbility.getStackDescription());
        final IPaperCard paper = source.getPaperCard();
        stackItem.put("setCode", paper != null ? paper.getEdition() : source.getSetCode());
        stackItem.put("cardNumber", paper != null ? paper.getCollectorNumber() : "");
        stackItem.put("isPermanentSpell", castingAbility.isSpell() && source.isPermanent());
        stackItem.put("isCasting", true);
        stackItem.put("targets", stackTargets(game, castingAbility));
        return stackItem;
    }

    private static List<Map<String, Object>> stackTargets(final Game game, final SpellAbility ability) {
        final List<Map<String, Object>> out = new ArrayList<>();
        if (ability == null) {
            return out;
        }
        final TargetChoices targets = ability.getTargets();
        if (targets == null) {
            return out;
        }
        int targetIndex = 0;
        for (final Card card : targets.getTargetCards()) {
            out.add(stackTarget("card", SnapshotExtractor.javaCardId(card), targetIndex));
            targetIndex++;
        }
        for (final Player player : targets.getTargetPlayers()) {
            out.add(stackTarget("player", "player-" + SnapshotExtractor.playerIndex(game, player), targetIndex));
            targetIndex++;
        }
        return out;
    }

    private static Map<String, Object> stackTarget(final String kind, final String id, final int targetIndex) {
        final Map<String, Object> target = new LinkedHashMap<>();
        target.put("kind", kind);
        target.put("id", id);
        target.put("nodeIndex", 0);
        target.put("targetIndex", targetIndex);
        target.put("hostile", true);
        target.put("intent", "hostile");
        return target;
    }

    static String stackItemId(final SpellAbilityStackInstance item) {
        return "engine-stack-" + item.getId();
    }

    static String normalizeCardName(final String name) {
        if (name != null && name.startsWith("Troll of Khazad-d") && name.endsWith("m")) {
            return "Troll of Khazad-dûm";
        }
        return name;
    }

    private static String normalizeStep(final String phase) {
        if (phase == null) {
            return "untap";
        }
        switch (phase) {
            case "Untap": return "untap";
            case "Upkeep": return "upkeep";
            case "Draw": return "draw";
            case "Main1": return "main1";
            case "CombatBegin": return "begin_combat";
            case "CombatDeclareAttackers": return "declare_attackers";
            case "CombatDeclareBlockers": return "declare_blockers";
            case "CombatFirstStrikeDamage": return "first_strike_damage";
            case "CombatDamage": return "combat_damage";
            case "CombatEnd": return "end_combat";
            case "Main2": return "main2";
            case "EndOfTurn": return "end";
            case "Cleanup": return "cleanup";
            default: return "untap";
        }
    }

    private static String uiCounterName(final CounterType counterType) {
        if (counterType instanceof CounterEnumType) {
            final CounterEnumType counterEnumType = (CounterEnumType) counterType;
            switch (counterEnumType) {
                case P1P1: return "P1P1";
                case M1M1: return "M1M1";
                default: return pascalCase(counterEnumType.name());
            }
        }
        return pascalCase(counterType.getName());
    }

    private static String pascalCase(final String name) {
        if (name == null || name.isEmpty()) {
            return "";
        }
        return Character.toUpperCase(name.charAt(0)) + name.substring(1).toLowerCase();
    }
}
