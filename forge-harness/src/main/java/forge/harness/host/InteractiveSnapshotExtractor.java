package forge.harness.host;

import forge.harness.common.SnapshotExtractor;
import forge.harness.protocol.CardDto;
import forge.harness.protocol.CardIdentity;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import forge.card.ColorSet;
import forge.card.MagicColor;
import forge.game.Game;
import forge.game.GameEntity;
import forge.ai.ComputerUtilCombat;
import forge.game.card.Card;
import forge.game.card.CardCollectionView;
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

        final Player viewerPlayer = playerForIndex(game, viewer);
        final List<Map<String, Object>> players = new ArrayList<>();
        final List<Object> zones = new ArrayList<>();
        for (final Player player : game.getRegisteredPlayers()) {
            final int index = SnapshotExtractor.playerIndex(game, player);
            final String ownerId = "player-" + index;
            players.add(toPlayer(game, player, index, viewer));
            zones.add(zoneWithVisibility("hand", ownerId, game,
                    player.getCardsIn(ZoneType.Hand), index, true, viewerPlayer, false));
            zones.add(visibleZone("graveyard", ownerId, game, player.getCardsIn(ZoneType.Graveyard), index, false));
            zones.add(zoneWithVisibility("exile", ownerId, game,
                    player.getCardsIn(ZoneType.Exile), index, false, viewerPlayer, true));
            final List<Card> commandZone = new ArrayList<>();
            for (final Card card : player.getCardsIn(ZoneType.Command)) {
                if (!card.isImmutable()) {
                    commandZone.add(card);
                }
            }
            zones.add(visibleZone("command", ownerId, game, commandZone, index, true));
            // Library bulk stays hidden (count only); the top card is included
            // when the viewer may see it (Augur/Courser-style statics), so
            // `count >= cards.length`.
            final List<JsonObject> libraryCards = new ArrayList<>();
            final CardCollectionView library = player.getCardsIn(ZoneType.Library);
            if (!library.isEmpty() && shownTo(library.get(0), viewerPlayer)) {
                libraryCards.add(visibleCard(toCard(game, library.get(0), index, true)));
            }
            zones.add(zoneEntry("library", ownerId, libraryCards, library.size()));
        }
        final Map<String, List<JsonObject>> battlefieldByController = new LinkedHashMap<>();
        for (final Player player : game.getRegisteredPlayers()) {
            final int ownerIndex = SnapshotExtractor.playerIndex(game, player);
            for (final Card card : player.getCardsIn(ZoneType.Battlefield)) {
                final String controllerId =
                        "player-" + SnapshotExtractor.playerIndex(game, card.getController());
                final CardDto dto = toCard(game, card, ownerIndex, false);
                if (card.isFaceDown() && !faceShownTo(card, viewerPlayer)) {
                    redact(dto);
                }
                battlefieldByController
                        .computeIfAbsent(controllerId, key -> new ArrayList<>())
                        .add(visibleCard(dto));
            }
        }
        for (final Player player : game.getRegisteredPlayers()) {
            final String controllerId = "player-" + SnapshotExtractor.playerIndex(game, player);
            final List<JsonObject> cards =
                    battlefieldByController.getOrDefault(controllerId, new ArrayList<>());
            zones.add(zoneEntry("battlefield", controllerId, cards, cards.size()));
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
        view.put("zones", zones);
        view.put("stack", snapshotStack(game, castingAbility, activePlayerId));
        view.put("gameOver", base.get("game_over"));
        view.put("dayTime", dayTime(game));
        final Object winner = base.get("winner");
        if (winner != null) {
            view.put("winnerId", "player-" + winner);
        }
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
        out.put("status", player.conceded() ? "conceded" : player.hasLost() ? "lost" : "playing");
        out.put("isHuman", index == viewer);
        out.put("life", player.getLife());
        out.put("counters", playerCounters(player));
        out.put("manaPool", manaPool(player));
        out.put("commanderDamage", commanderDamage(game, player));
        out.put("hasCityBlessing", player.hasBlessing());
        out.put("ringLevel", player.getNumRingTemptedYou());
        out.put("speed", player.getSpeed());
        return out;
    }

    private static Map<String, Integer> playerCounters(final Player player) {
        final Map<String, Integer> counters = new LinkedHashMap<>();
        putIfPositive(counters, "poison", player.getPoisonCounters());
        putIfPositive(counters, "energy", player.getCounters(CounterEnumType.ENERGY));
        putIfPositive(counters, "experience", player.getCounters(CounterEnumType.EXPERIENCE));
        putIfPositive(counters, "radiation", player.getCounters(CounterEnumType.RAD));
        putIfPositive(counters, "ticket", player.getCounters(CounterEnumType.TICKET));
        return counters;
    }

    private static void putIfPositive(final Map<String, Integer> map, final String key, final int value) {
        if (value > 0) {
            map.put(key, value);
        }
    }

    private static Map<String, Object> visibleZone(
            final String zone,
            final String ownerId,
            final Game game,
            final Iterable<Card> cards,
            final int ownerIndex,
            final boolean castable
    ) {
        final List<JsonObject> views = new ArrayList<>();
        for (final Card card : cards) {
            views.add(visibleCard(toCard(game, card, ownerIndex, castable)));
        }
        return zoneEntry(zone, ownerId, views, views.size());
    }

    private static Map<String, Object> zoneEntry(
            final String zone,
            final String ownerId,
            final List<JsonObject> cards,
            final int count
    ) {
        final Map<String, Object> out = new LinkedHashMap<>();
        out.put("zone", zone);
        out.put("ownerId", ownerId);
        out.put("cards", cards);
        out.put("count", count);
        return out;
    }

    private static JsonObject visibleCard(final CardDto dto) {
        final JsonObject obj = GSON.toJsonTree(dto).getAsJsonObject();
        obj.addProperty("visibility", "visible");
        return obj;
    }

    private static JsonObject hiddenCard(final Card card) {
        final JsonObject obj = new JsonObject();
        obj.addProperty("visibility", "hidden");
        obj.addProperty("id", SnapshotExtractor.javaCardId(card));
        return obj;
    }

    private static Map<String, Object> zoneWithVisibility(
            final String zone,
            final String ownerId,
            final Game game,
            final Iterable<Card> cards,
            final int ownerIndex,
            final boolean castable,
            final Player viewerPlayer,
            final boolean keepHiddenEntries
    ) {
        final List<JsonObject> views = new ArrayList<>();
        int count = 0;
        for (final Card card : cards) {
            count++;
            if (shownTo(card, viewerPlayer)) {
                views.add(visibleCard(toCard(game, card, ownerIndex, castable)));
            } else if (keepHiddenEntries) {
                views.add(hiddenCard(card));
            }
        }
        return zoneEntry(zone, ownerId, views, count);
    }

    /** Forge's per-viewer visibility oracle; null viewer = spectator (public info only). */
    private static boolean shownTo(final Card card, final Player viewerPlayer) {
        if (viewerPlayer != null) {
            return card.getView().canBeShownTo(viewerPlayer.getView());
        }
        final ZoneType zone = card.getZone() == null ? null : card.getZone().getZoneType();
        if (zone == ZoneType.Exile || zone == ZoneType.Merged) {
            return !card.isFaceDown();
        }
        return zone == ZoneType.Battlefield
                || zone == ZoneType.Graveyard
                || zone == ZoneType.Command
                || zone == ZoneType.Stack
                || zone == ZoneType.Flashback;
    }

    /** CR 707.7: a face-down permanent's face is visible to its controller. */
    private static boolean faceShownTo(final Card card, final Player viewerPlayer) {
        if (viewerPlayer == null) {
            return false;
        }
        return card.getController() == viewerPlayer
                || card.getView().canFaceDownBeShownTo(viewerPlayer.getView());
    }

    private static void redact(final CardDto dto) {
        dto.identity = new CardIdentity("", "", "", false);
        dto.text = "";
        dto.manaCost = "";
        dto.flashbackCost = null;
        dto.kickerCost = null;
        dto.effectiveManaCost = null;
        dto.madnessCost = null;
    }

    private static Player playerForIndex(final Game game, final int viewer) {
        if (viewer < 0) {
            return null;
        }
        for (final Player player : game.getRegisteredPlayers()) {
            if (SnapshotExtractor.playerIndex(game, player) == viewer) {
                return player;
            }
        }
        return null;
    }

    private static String dayTime(final Game game) {
        if (game.isNeitherDayNorNight()) {
            return "neither";
        }
        return game.isNight() ? "night" : "day";
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

    static CardDto cardDto(final Game game, final Card card, final boolean castable) {
        final int ownerIndex = card.getOwner() != null ? SnapshotExtractor.playerIndex(game, card.getOwner()) : 0;
        return toCard(game, card, ownerIndex, castable);
    }

    private static List<String> mergedCardIds(final Card card) {
        final List<String> ids = new ArrayList<>();
        if (card.hasMergedCard()) {
            for (final Card merged : card.getMergedCards()) {
                if (merged != card) {
                    ids.add(SnapshotExtractor.javaCardId(merged));
                }
            }
        }
        return ids;
    }

    private static CardDto toCard(
            final Game game,
            final Card card,
            final int ownerIndex,
            final boolean castable
    ) {
        final CardDto dto = new CardDto();
        dto.id = SnapshotExtractor.javaCardId(card);
        final IPaperCard paper = card.getPaperCard();
        final String name = card.isFaceDown() && paper != null ? paper.getName() : card.getName();
        dto.identity = new CardIdentity(
                normalizeCardName(name),
                paper != null ? paper.getEdition() : card.getSetCode(),
                paper != null ? paper.getCollectorNumber() : "",
                card.isToken());
        dto.color = colorString(card.getColor());
        dto.manaCost = card.getManaCost() == null ? "" : card.getManaCost().toString();
        dto.cmc = card.getCMC();
        dto.types = coreTypes(card);
        dto.subtypes = subtypes(card);
        dto.supertypes = supertypes(card);
        if (card.isCreature()) {
            dto.power = String.valueOf(card.getNetPower());
            dto.toughness = String.valueOf(card.getNetToughness());
            dto.basePower = card.getBasePower();
            dto.baseToughness = card.getBaseToughness();
        }
        dto.text = card.getOracleText();
        dto.controllerId = "player-" + SnapshotExtractor.playerIndex(game, card.getController());
        dto.ownerId = "player-" + ownerIndex;
        dto.tapped = card.isTapped();
        dto.keywords = keywords(card);
        dto.counters = counterMap(card);
        dto.mergedCardIds = mergedCardIds(card);
        dto.damage = card.getDamage();
        dto.summoningSick = card.hasSickness();
        dto.isCopy = card.isCloned();
        dto.isDoubleFaced = card.isDoubleFaced();
        dto.isTransformed = card.isTransformed();
        dto.isFaceDown = card.isFaceDown();
        dto.isBestowed = card.isBestowed();
        dto.phasedOut = card.isPhasedOut();
        dto.exerted = card.getExertedThisTurn() > 0;
        dto.isRingBearer = card.isRingBearer();
        dto.isCrewed = card.getTimesCrewedThisTurn() > 0;
        dto.isMadnessExiled = card.isMadness();
        dto.isPlotted = card.isPlotted();
        dto.isWarpExiled = card.isWarped();
        dto.foil = card.hasPaperFoil();

        final Card attachedTo = card.getAttachedTo();
        if (attachedTo != null) {
            dto.attachedTo = SnapshotExtractor.javaCardId(attachedTo);
        }
        final List<String> attachmentIds = new ArrayList<>();
        for (final Card attachment : card.getAttachedCards()) {
            attachmentIds.add(SnapshotExtractor.javaCardId(attachment));
        }
        dto.attachmentIds = attachmentIds;

        dto.flashbackCost = keywordCost(card, "Flashback");
        dto.kickerCost = keywordCost(card, "Kicker");
        dto.madnessCost = keywordCost(card, "Madness");

        final Combat combat = game.getCombat();
        if (combat != null) {
            final boolean attacking = combat.isAttacking(card);
            if (attacking) {
                dto.isAttacking = true;
                final Player defender = combat.getDefenderPlayerByAttacker(card);
                if (defender != null) {
                    dto.attackingPlayerId = "player-" + SnapshotExtractor.playerIndex(game, defender);
                }
                final GameEntity target = combat.getDefenderByAttacker(card);
                if (target instanceof Player) {
                    dto.attackTargetId =
                            "player-" + SnapshotExtractor.playerIndex(game, (Player) target);
                } else if (target instanceof Card) {
                    dto.attackTargetId = SnapshotExtractor.javaCardId((Card) target);
                }
            }
            // AI combat eval invoked from snapshot extraction, a context Forge
            // never calls it from; an escaped exception kills the game thread.
            if (attacking || combat.isBlocking(card)) {
                try {
                    dto.wouldDieInCombat =
                            ComputerUtilCombat.combatantWouldBeDestroyed(card.getController(), card, combat);
                } catch (final RuntimeException ignored) {
                    dto.wouldDieInCombat = false;
                }
            }
        }
        if (castable) {
            dto.effectiveManaCost = effectiveManaCost(card);
        }
        return dto;
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
        for (final com.google.common.collect.Multiset.Entry<CounterType> entry : card.getCounters().entrySet()) {
            if (entry.getCount() > 0) {
                counters.put(uiCounterName(entry.getElement()), entry.getCount());
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
            final String name = source == null
                    ? item.getStackDescription()
                    : normalizeCardName(source.getName());
            stackItem.put("identity", stackIdentity(name, source));
            stackItem.put("text", item.getStackDescription());
            stackItem.put("isPermanentSpell", source != null && item.isSpell() && source.isPermanent());
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
        stackItem.put("identity", stackIdentity(normalizeCardName(source.getName()), source));
        stackItem.put("text", castingAbility.getStackDescription());
        stackItem.put("isPermanentSpell", castingAbility.isSpell() && source.isPermanent());
        stackItem.put("isCasting", true);
        stackItem.put("targets", stackTargets(game, castingAbility));
        return stackItem;
    }

    private static List<Map<String, Object>> stackTargets(final Game game, final SpellAbility ability) {
        final List<Map<String, Object>> out = new ArrayList<>();
        // Mirror Forge's StackItemView (and the Rust collect_stack_targets): targets
        // live per ability node, so walk the sub-ability chain, not just the root.
        for (SpellAbility sa = ability; sa != null; sa = sa.getSubAbility()) {
            final TargetChoices targets = sa.getTargets();
            if (targets == null) {
                continue;
            }
            final String oracle = sa.getStackDescription();
            for (final Card card : targets.getTargetCards()) {
                out.add(stackTarget("card", SnapshotExtractor.javaCardId(card), oracle));
            }
            for (final Player player : targets.getTargetPlayers()) {
                out.add(stackTarget("player", "player-" + SnapshotExtractor.playerIndex(game, player), oracle));
            }
        }
        return out;
    }

    private static Map<String, Object> stackIdentity(final String name, final Card source) {
        final IPaperCard paper = source == null ? null : source.getPaperCard();
        final Map<String, Object> identity = new LinkedHashMap<>();
        identity.put("name", name);
        identity.put("setCode", source == null ? "" : (paper != null ? paper.getEdition() : source.getSetCode()));
        identity.put("cardNumber", source == null ? "" : (paper != null ? paper.getCollectorNumber() : ""));
        identity.put("isToken", source != null && source.isToken());
        return identity;
    }

    private static Map<String, Object> stackTarget(final String kind, final String id, final String oracle) {
        final Map<String, Object> target = new LinkedHashMap<>();
        target.put("kind", kind);
        target.put("id", id);
        target.put("intent", "hostile");
        if (oracle != null && !oracle.isEmpty()) {
            target.put("oracle", oracle);
        }
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
            case "CombatBegin": return "combatBegin";
            case "CombatDeclareAttackers": return "combatDeclareAttackers";
            case "CombatDeclareBlockers": return "combatDeclareBlockers";
            case "CombatFirstStrikeDamage": return "combatFirstStrikeDamage";
            case "CombatDamage": return "combatDamage";
            case "CombatEnd": return "combatEnd";
            case "Main2": return "main2";
            case "EndOfTurn": return "endOfTurn";
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
