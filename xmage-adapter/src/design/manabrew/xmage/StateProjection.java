package design.manabrew.xmage;

import com.google.gson.*;
import java.util.*;
import mage.view.*;

import static design.manabrew.xmage.Main.*;

final class StateProjection {
    private StateProjection() {}

    static JsonObject project(UUID gameId, GameView view) {
        JsonObject state = object("gameId", gameId.toString());
        state.addProperty("turn", Math.max(0, view.getTurn()));
        state.addProperty("step", view.getStep() == null ? "pregame" : switch (view.getStep()) {
            case UNTAP -> "untap";
            case UPKEEP -> "upkeep";
            case DRAW -> "draw";
            case PRECOMBAT_MAIN -> "main1";
            case BEGIN_COMBAT -> "combatBegin";
            case DECLARE_ATTACKERS -> "combatDeclareAttackers";
            case DECLARE_BLOCKERS -> "combatDeclareBlockers";
            case FIRST_COMBAT_DAMAGE -> "combatFirstStrikeDamage";
            case COMBAT_DAMAGE -> "combatDamage";
            case END_COMBAT -> "combatEnd";
            case POSTCOMBAT_MAIN -> "main2";
            case END_TURN -> "endOfTurn";
            case CLEANUP -> "cleanup";
        });
        state.addProperty("activePlayerId", view.getActivePlayerId() == null ? "" : view.getActivePlayerId().toString());
        state.addProperty("priorityPlayerId", view.getPlayers().stream().filter(PlayerView::hasPriority)
                .map(p -> p.getPlayerId().toString()).findFirst().orElse(""));
        state.addProperty("gameOver", false);
        state.addProperty("dayTime", "neither");
        JsonArray players = new JsonArray();
        JsonArray zones = new JsonArray();
        Map<String, String> playerNames = new HashMap<>();
        for (PlayerView player : view.getPlayers()) playerNames.put(player.getName(), player.getPlayerId().toString());
        Map<String, List<CardView>> battlefield = new LinkedHashMap<>();
        for (PlayerView player : view.getPlayers()) battlefield.put(player.getPlayerId().toString(), new ArrayList<>());
        Set<UUID> seen = new HashSet<>();
        for (PlayerView player : view.getPlayers()) {
            for (PermanentView card : player.getBattlefield().values()) {
                if (!seen.add(card.getId())) continue;
                String controller = playerNames.get(card.getNameController());
                if (controller == null) throw new IllegalStateException("Unknown battlefield controller");
                battlefield.get(controller).add(card);
            }
        }
        for (PlayerView player : view.getPlayers()) {
            String id = player.getPlayerId().toString();
            JsonObject out = object("id", id);
            out.addProperty("name", player.getName());
            out.addProperty("status", player.hasLeft() ? "lost" : "playing");
            out.addProperty("isHuman", player.isHuman());
            out.addProperty("life", player.getLife());
            JsonObject counters = new JsonObject();
            for (CounterView counter : player.getCounters()) {
                String key = counter.getName().toLowerCase(Locale.ROOT);
                if (Set.of("poison", "energy", "experience", "radiation", "ticket").contains(key)) counters.addProperty(key, counter.getCount());
            }
            out.add("counters", counters);
            ManaPoolView pool = player.getManaPool();
            JsonObject mana = new JsonObject();
            mana.addProperty("W", pool.getWhite()); mana.addProperty("U", pool.getBlue());
            mana.addProperty("B", pool.getBlack()); mana.addProperty("R", pool.getRed());
            mana.addProperty("G", pool.getGreen()); mana.addProperty("C", pool.getColorless());
            out.add("manaPool", mana);
            out.add("commanderDamage", new JsonObject());
            out.addProperty("hasCityBlessing", false);
            out.addProperty("hasEnduringStory", false);
            out.addProperty("ringLevel", 0);
            out.addProperty("speed", 0);
            players.add(out);
            if (player.isMonarch()) state.addProperty("monarchId", id);
            if (player.isInitiative()) state.addProperty("initiativeHolderId", id);
            zones.add(zone("battlefield", id, battlefield.get(id), battlefield.get(id).size(), playerNames, view));
            Collection<CardView> hand = view.getMyPlayer() != null && player.getPlayerId().equals(view.getMyPlayer().getPlayerId()) ? view.getMyHand().values() : List.of();
            zones.add(zone("hand", id, hand, player.getHandCount(), playerNames, view));
            zones.add(zone("library", id, List.of(), player.getLibraryCount(), playerNames, view));
            zones.add(zone("graveyard", id, player.getGraveyard().values(), player.getGraveyard().size(), playerNames, view));
            zones.add(zone("exile", id, player.getExile().values(), player.getExile().size(), playerNames, view));
        }
        state.add("players", players);
        state.add("zones", zones);
        JsonArray stack = new JsonArray();
        for (CardView card : view.getStack().values()) {
            JsonObject out = object("id", card.getId().toString());
            out.add("identity", card.hideInfo() ? object("name", "Face-down spell") : identity(card));
            out.addProperty("sourceId", card.getParentId() == null ? "" : card.getParentId().toString());
            out.addProperty("text", card.hideInfo() ? "" : NativeText.plain(String.join("<br>", card.getRules())));
            out.addProperty("isCasting", !card.isPaid());
            out.addProperty("isPermanentSpell", !card.isAbility() && !card.isInstant() && !card.isSorcery());
            JsonArray targets = new JsonArray();
            if (card.getTargets() != null) for (UUID target : card.getTargets()) targets.add(target(view, target));
            out.add("targets", targets);
            stack.add(out);
        }
        state.add("stack", stack);
        JsonArray combat = new JsonArray();
        for (CombatGroupView group : view.getCombat()) {
            for (UUID attacker : group.getAttackers().keySet()) {
                for (UUID blocker : group.getBlockers().keySet()) {
                    JsonObject assignment = object("attackerId", attacker.toString());
                    assignment.addProperty("blockerId", blocker.toString());
                    combat.add(assignment);
                }
            }
        }
        state.add("combatAssignments", combat);
        JsonObject update = new JsonObject();
        update.add("gameView", state);
        update.add("unavailableFields", JSON.toJsonTree(List.of(
                "gameView.dayTime", "gameView.players.*.commanderDamage", "gameView.players.*.hasCityBlessing",
                "gameView.players.*.hasEnduringStory", "gameView.players.*.ringLevel", "gameView.players.*.speed",
                "gameView.zones.*.cards.*.ownerId", "gameView.zones.*.cards.*.keywords",
                "gameView.zones.command", "gameView.stack.*.controllerId", "gameView.stack.*.ownerId",
                "gameView.stack.*.isDoubleFaced", "gameView.stack.*.faceIndex",
                "gameView.zones.*.cards.*.basePower", "gameView.zones.*.cards.*.baseToughness",
                "gameView.zones.*.cards.*.finalChapter", "gameView.zones.*.cards.*.classLevel",
                "gameView.zones.*.cards.*.classLevels", "gameView.zones.*.cards.*.sagaChapters",
                "gameView.zones.*.cards.*.isCrewed", "gameView.zones.*.cards.*.isBestowed",
                "gameView.zones.*.cards.*.exerted", "gameView.zones.*.cards.*.isRingBearer",
                "gameView.zones.*.cards.*.mergedCardIds", "gameView.zones.*.cards.*.flashbackCost",
                "gameView.zones.*.cards.*.kickerCost", "gameView.zones.*.cards.*.effectiveManaCost",
                "gameView.zones.*.cards.*.madnessCost", "gameView.zones.*.cards.*.isMadnessExiled",
                "gameView.zones.*.cards.*.isPlotted", "gameView.zones.*.cards.*.isWarpExiled",
                "gameView.zones.*.cards.*.foil", "gameView.zones.*.cards.*.wouldDieInCombat",
                "gameView.zones.*.cards.*.identity.tokenScript", "gameView.players.*.status")));
        return update;
    }

    static JsonObject target(GameView view, UUID id) {
        JsonObject target = object("id", id.toString());
        boolean player = view.getPlayers().stream().anyMatch(p -> p.getPlayerId().equals(id));
        target.addProperty("kind", player ? "player" : view.getStack().containsKey(id) ? "spell" : "card");
        return target;
    }

    private static JsonObject zone(String kind, String owner, Collection<? extends CardView> cards, int count,
                                   Map<String, String> names, GameView view) {
        JsonObject zone = object("zone", kind);
        zone.addProperty("ownerId", owner);
        zone.addProperty("count", count);
        JsonArray list = new JsonArray();
        for (CardView card : cards) {
            if (card.hideInfo()) {
                JsonObject hidden = object("visibility", "hidden");
                hidden.addProperty("id", card.getId().toString());
                list.add(hidden);
            } else {
                JsonObject visible = card(card, owner, names, view);
                visible.addProperty("visibility", "visible");
                list.add(visible);
            }
        }
        zone.add("cards", list);
        return zone;
    }

    static JsonObject card(CardView card, String controller, Map<String, String> names, GameView view) {
        JsonObject out = object("id", card.getId().toString());
        out.add("identity", identity(card));
        out.addProperty("controllerId", controller);
        out.addProperty("color", card.getColor().toString());
        out.addProperty("manaCost", card.getManaCostStr());
        out.addProperty("cmc", card.getManaValue());
        out.addProperty("text", NativeText.plain(String.join("<br>", card.getRules())));
        out.add("types", JSON.toJsonTree(card.getCardTypes().stream().map(Object::toString).toList()));
        out.add("subtypes", JSON.toJsonTree(card.getSubTypes().stream().map(Object::toString).toList()));
        out.add("supertypes", JSON.toJsonTree(card.getSuperTypes().stream().map(Object::toString).toList()));
        out.addProperty("power", card.getPower()); out.addProperty("toughness", card.getToughness());
        out.addProperty("isDoubleFaced", card.canTransform()); out.addProperty("isTransformed", card.isTransformed());
        out.addProperty("isFaceDown", card.isFaceDown());
        JsonObject counters = new JsonObject();
        for (CounterView counter : card.getCounters() == null ? List.<CounterView>of() : card.getCounters()) {
            String name = switch (counter.getName()) { case "+1/+1" -> "P1P1"; case "-1/-1" -> "M1M1"; default -> counter.getName(); };
            counters.addProperty(name, counter.getCount());
        }
        out.add("counters", counters);
        if (card instanceof PermanentView) {
            PermanentView permanent = (PermanentView) card;
            out.addProperty("controllerId", names.get(permanent.getNameController()));
            out.addProperty("ownerId", names.get(permanent.getNameOwner()));
            out.addProperty("tapped", permanent.isTapped()); out.addProperty("damage", permanent.getDamage());
            out.addProperty("summoningSick", permanent.hasSummoningSickness()); out.addProperty("phasedOut", !permanent.isPhasedIn());
            out.addProperty("isCopy", permanent.isCopy());
            out.add("attachmentIds", JSON.toJsonTree(permanent.getAttachments()));
            if (permanent.getAttachedTo() != null) out.addProperty("attachedTo", permanent.getAttachedTo().toString());
            for (CombatGroupView group : view.getCombat()) {
                if (group.getAttackers().containsKey(card.getId())) {
                    out.addProperty("isAttacking", true);
                    out.addProperty("attackTargetId", group.getDefenderId().toString());
                    if (view.getPlayers().stream().anyMatch(player -> player.getPlayerId().equals(group.getDefenderId()))) {
                        out.addProperty("attackingPlayerId", group.getDefenderId().toString());
                    }
                }
            }
        }
        return out;
    }

    private static JsonObject identity(CardView card) {
        JsonObject identity = object("name", card.getName());
        identity.addProperty("setCode", card.getExpansionSetCode());
        identity.addProperty("cardNumber", card.getCardNumber());
        identity.addProperty("isToken", card.isToken());
        return identity;
    }
}
