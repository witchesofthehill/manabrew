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
import java.util.stream.Collectors;

/**
 * Adds UI-only ordered card data to the parity snapshot used by interactive sessions.
 */
public final class InteractiveSnapshotExtractor {
    private InteractiveSnapshotExtractor() {}

    private static final Gson GSON = new GsonBuilder().create();

    public static String snapshotJson(final Game game) {
        return snapshotJson(game, null);
    }

    public static String snapshotJson(final Game game, final SpellAbility castingAbility) {
        return GSON.toJson(extractSnapshot(game, castingAbility));
    }

    public static Map<String, Object> extractSnapshot(final Game game) {
        return extractSnapshot(game, null);
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> extractSnapshot(final Game game, final SpellAbility castingAbility) {
        final Map<String, Object> snapshot = SnapshotExtractor.extractSnapshot(game);
        final List<Map<String, Object>> players = new ArrayList<>();
        final Object basePlayers = snapshot.get("players");
        int index = 0;
        for (final Player player : game.getRegisteredPlayers()) {
            final Map<String, Object> basePlayer = basePlayers instanceof List && index < ((List<?>) basePlayers).size()
                    ? new LinkedHashMap<>((Map<String, Object>) ((List<?>) basePlayers).get(index))
                    : new LinkedHashMap<>();
            players.add(snapshotInteractivePlayer(game, player, basePlayer));
            index++;
        }
        snapshot.put("players", players);
        snapshot.put("stack", snapshotStack(game, castingAbility));
        snapshot.put("combat", snapshotCombat(game));
        final Player monarch = game.getMonarch();
        snapshot.put("monarch", monarch == null ? null : SnapshotExtractor.playerIndex(game, monarch));
        final Player initiative = game.getHasInitiative();
        snapshot.put("initiative", initiative == null ? null : SnapshotExtractor.playerIndex(game, initiative));
        return snapshot;
    }

    private static Map<String, Object> snapshotInteractivePlayer(
            final Game game,
            final Player player,
            final Map<String, Object> basePlayer
    ) {
        final Map<String, Object> out = new LinkedHashMap<>(basePlayer);
        out.put("ring_level", player.getNumRingTemptedYou());
        out.put("has_conceded", player.conceded());
        out.put("energy", player.getCounters(CounterEnumType.ENERGY));
        out.put("radiation", player.getCounters(CounterEnumType.RAD));
        out.put("speed", player.getSpeed());
        out.put("city_blessing", player.hasBlessing());
        out.put("mana_pool", manaPool(player));
        out.put("commander_damage", commanderDamage(game, player));
        out.put("battlefield_cards", richCards(game, player.getCardsIn(ZoneType.Battlefield), false));
        out.put("hand_cards", richCards(game, player.getCardsIn(ZoneType.Hand), true));
        out.put("graveyard_cards", richCards(game, player.getCardsIn(ZoneType.Graveyard), false));
        out.put("exile_cards", richCards(game, player.getCardsIn(ZoneType.Exile), false));
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
        out.put("command_zone", commandZone.stream()
                .map(card -> normalizeCardName(card.getName()))
                .collect(Collectors.toList()));
        out.put("command_zone_cards", richCards(game, commandZone, true));
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
            final boolean castable
    ) {
        final List<Map<String, Object>> out = new ArrayList<>();
        for (final Card card : cards) {
            out.add(richCard(game, card, castable));
        }
        return out;
    }

    private static Map<String, Object> richCard(final Game game, final Card card, final boolean castable) {
        final Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", SnapshotExtractor.javaCardId(card));
        out.put("name", normalizeCardName(card.getName()));
        final IPaperCard paper = card.getPaperCard();
        out.put("setCode", paper != null ? paper.getEdition() : card.getSetCode());
        out.put("cardNumber", paper != null ? paper.getCollectorNumber() : "");
        out.put("manaCost", card.getManaCost() == null ? "" : card.getManaCost().toString());
        out.put("cmc", card.getCMC());
        out.put("color", colorString(card.getColor()));
        out.put("text", card.getOracleText());
        out.put("types", coreTypes(card));
        out.put("subtypes", subtypes(card));
        out.put("supertypes", supertypes(card));
        out.put("keywords", keywords(card));
        out.put("isToken", card.isToken());
        out.put("isCopy", card.isCloned());
        out.put("isDoubleFaced", card.isDoubleFaced());
        out.put("isTransformed", card.isTransformed());
        out.put("isFaceDown", card.isFaceDown());
        out.put("isBestowed", card.isBestowed());
        out.put("phasedOut", card.isPhasedOut());
        out.put("isRingBearer", card.isRingBearer());
        out.put("exerted", card.getExertedThisTurn() > 0);
        out.put("isCrewed", card.getTimesCrewedThisTurn() > 0);
        out.put("isMadnessExiled", card.isMadness());
        out.put("isPlotted", card.isPlotted());
        out.put("isWarpExiled", card.isWarped());
        out.put("foil", card.hasPaperFoil());
        out.put("tapped", card.isTapped());
        out.put("power", card.isCreature() ? card.getNetPower() : null);
        out.put("toughness", card.isCreature() ? card.getNetToughness() : null);
        out.put("damage", card.getDamage());
        out.put("summoning_sick", card.hasSickness());
        out.put("counters", counterMap(card));
        out.put("controller", SnapshotExtractor.playerIndex(game, card.getController()));

        final Card attachedTo = card.getAttachedTo();
        if (attachedTo != null) {
            out.put("attachedTo", SnapshotExtractor.javaCardId(attachedTo));
        }
        final List<String> attachmentIds = new ArrayList<>();
        for (final Card attachment : card.getAttachedCards()) {
            attachmentIds.add(SnapshotExtractor.javaCardId(attachment));
        }
        out.put("attachmentIds", attachmentIds);

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

    private static List<Map<String, Object>> snapshotStack(final Game game, final SpellAbility castingAbility) {
        final List<Map<String, Object>> out = new ArrayList<>();
        final List<SpellAbilityStackInstance> entries = new ArrayList<>();
        for (final SpellAbilityStackInstance item : game.getStack()) {
            entries.add(item);
        }
        Collections.reverse(entries);
        for (final SpellAbilityStackInstance item : entries) {
            final Map<String, Object> stackItem = new LinkedHashMap<>();
            stackItem.put("id", stackItemId(item));
            final Card source = item.getSourceCard();
            stackItem.put("name", source == null
                    ? item.getStackDescription()
                    : normalizeCardName(source.getName()));
            stackItem.put("description", item.getStackDescription());
            final SpellAbility sa = item.getSpellAbility();
            if (sa != null && sa.getActivatingPlayer() != null) {
                stackItem.put("controller", SnapshotExtractor.playerIndex(game, sa.getActivatingPlayer()));
            }
            if (source != null) {
                stackItem.put("sourceId", SnapshotExtractor.javaCardId(source));
                final IPaperCard paper = source.getPaperCard();
                stackItem.put("setCode", paper != null ? paper.getEdition() : source.getSetCode());
                stackItem.put("cardNumber", paper != null ? paper.getCollectorNumber() : "");
                stackItem.put("isPermanentSpell", item.isSpell() && source.isPermanent());
            }
            stackItem.put("isCasting", false);
            stackItem.put("targets", stackTargets(game, item.getSpellAbility()));
            out.add(stackItem);
        }
        final Map<String, Object> casting = castingStackEntry(game, castingAbility);
        if (casting != null) {
            out.add(casting);
        }
        return out;
    }

    private static Map<String, Object> castingStackEntry(final Game game, final SpellAbility castingAbility) {
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
        stackItem.put("name", normalizeCardName(source.getName()));
        stackItem.put("description", castingAbility.getStackDescription());
        if (castingAbility.getActivatingPlayer() != null) {
            stackItem.put("controller", SnapshotExtractor.playerIndex(game, castingAbility.getActivatingPlayer()));
        }
        stackItem.put("sourceId", SnapshotExtractor.javaCardId(source));
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
        for (final Card card : targets.getTargetCards()) {
            final Map<String, Object> target = new LinkedHashMap<>();
            target.put("kind", "card");
            target.put("id", SnapshotExtractor.javaCardId(card));
            out.add(target);
        }
        for (final Player player : targets.getTargetPlayers()) {
            final Map<String, Object> target = new LinkedHashMap<>();
            target.put("kind", "player");
            target.put("id", "player-" + SnapshotExtractor.playerIndex(game, player));
            out.add(target);
        }
        return out;
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
