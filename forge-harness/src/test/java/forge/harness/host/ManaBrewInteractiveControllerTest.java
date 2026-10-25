package forge.harness.host;

import forge.StaticData;
import forge.ai.LobbyPlayerAi;
import forge.deck.Deck;
import forge.game.Game;
import forge.game.GameRules;
import forge.game.GameStage;
import forge.game.GameType;
import forge.game.Match;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.player.Player;
import forge.game.player.RegisteredPlayer;
import forge.game.zone.ZoneType;
import forge.gui.GuiBase;
import forge.harness.common.HeadlessGuiBase;
import forge.item.IPaperCard;
import forge.localinstance.properties.ForgePreferences.FPref;
import forge.model.FModel;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class ManaBrewInteractiveControllerTest {
    private ManaBrewInteractiveControllerTest() {}

    public static void main(final String[] args) {
        GuiBase.setInterface(new HeadlessGuiBase("forge/forge-gui/"));
        FModel.initialize(null, prefs -> {
            prefs.setPref(FPref.LOAD_CARD_SCRIPTS_LAZILY, true);
            prefs.setPref(FPref.UI_LANGUAGE, "en-US");
            return null;
        });

        trampleAssignsPastBlockerByToughness("Kor Firewalker", 2);
        trampleAssignsPastBlockerByToughness("Darksteel Myr", 1);
        System.exit(0);
    }

    private static void trampleAssignsPastBlockerByToughness(final String blockerName, final int toughness) {
        final Game game = newGame();
        final Card attacker = add("Ball Lightning", game.getPlayers().get(0));
        final Card blocker = add(blockerName, game.getPlayers().get(1));
        final CardCollection blockers = new CardCollection(blocker);

        ManaBrewInteractiveController.validateCombatDamageAssignment(
                assignment(blocker, toughness, 6 - toughness), attacker, blockers, 6, false, false);

        try {
            ManaBrewInteractiveController.validateCombatDamageAssignment(
                    assignment(blocker, toughness - 1, 7 - toughness), attacker, blockers, 6, false, false);
        } catch (final IllegalArgumentException expected) {
            return;
        }
        throw new AssertionError("trample damage reached the player past a " + blockerName
                + " without lethal damage assigned");
    }

    private static Map<Card, Integer> assignment(final Card blocker, final int toBlocker, final int toPlayer) {
        final Map<Card, Integer> map = new LinkedHashMap<>();
        map.put(blocker, toBlocker);
        map.put(null, toPlayer);
        return map;
    }

    private static Game newGame() {
        final List<RegisteredPlayer> players = new ArrayList<>();
        final Deck deck = new Deck();
        players.add(new RegisteredPlayer(deck).setPlayer(new LobbyPlayerAi("p1", null)));
        players.add(new RegisteredPlayer(deck).setPlayer(new LobbyPlayerAi("p2", null)));
        final GameRules rules = new GameRules(GameType.Constructed);
        final Game game = new Game(players, rules, new Match(rules, players, "ManaBrewInteractiveControllerTest"));
        game.setAge(GameStage.Play);
        return game;
    }

    private static Card add(final String name, final Player p) {
        IPaperCard paper = FModel.getMagicDb().getCommonCards().getCard(name);
        if (paper == null) {
            StaticData.instance().attemptToLoadCard(name);
            paper = FModel.getMagicDb().getCommonCards().getCard(name);
        }
        final Card card = Card.fromPaperCard(paper, p);
        card.setGameTimestamp(p.getGame().getNextTimestamp());
        p.getZone(ZoneType.Battlefield).add(card);
        return card;
    }
}
