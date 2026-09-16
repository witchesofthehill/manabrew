package forge.harness.common;

import forge.StaticData;
import forge.ai.LobbyPlayerAi;
import forge.deck.Deck;
import forge.game.Game;
import forge.game.GameRules;
import forge.game.GameStage;
import forge.game.GameType;
import forge.game.Match;
import forge.game.card.Card;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.player.RegisteredPlayer;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;
import forge.gui.GuiBase;
import forge.item.IPaperCard;
import forge.localinstance.properties.ForgePreferences.FPref;
import forge.model.FModel;

import java.util.ArrayList;
import java.util.List;

public final class ActionSpaceTest {
    private ActionSpaceTest() {}

    public static void main(final String[] args) {
        GuiBase.setInterface(new HeadlessGuiBase("forge/forge-gui/"));
        FModel.initialize(null, prefs -> {
            prefs.setPref(FPref.LOAD_CARD_SCRIPTS_LAZILY, true);
            prefs.setPref(FPref.UI_LANGUAGE, "en-US");
            return null;
        });

        stackGrantedAffinityIsOffered();
        stackGrantedAffinityNeedsTheGrant();
        stackGrantedAffinityLeavesNoResidue();
        System.exit(0);
    }

    private static void stackGrantedAffinityIsOffered() {
        final Game game = newGame();
        final Player p = game.getPlayers().get(1);
        add("Forest", p, ZoneType.Battlefield);
        add("Grizzly Bears", p, ZoneType.Battlefield);
        add("Witherbloom, the Balancer", p, ZoneType.Battlefield);
        add("Rampant Growth", p, ZoneType.Hand);
        game.getAction().checkStaticAbilities();

        for (final boolean lifePaymentFallback : new boolean[] {false, true}) {
            if (!offered(p, lifePaymentFallback).contains("Rampant Growth")) {
                throw new AssertionError(
                        "Rampant Growth castable through Witherbloom's affinity for creatures was not offered"
                                + " (lifePaymentFallback=" + lifePaymentFallback + ")");
            }
        }
    }

    private static void stackGrantedAffinityNeedsTheGrant() {
        final Game game = newGame();
        final Player p = game.getPlayers().get(1);
        add("Forest", p, ZoneType.Battlefield);
        add("Grizzly Bears", p, ZoneType.Battlefield);
        add("Rampant Growth", p, ZoneType.Hand);
        game.getAction().checkStaticAbilities();

        if (offered(p, false).contains("Rampant Growth")) {
            throw new AssertionError("Rampant Growth offered with one Forest and no affinity");
        }
    }

    private static void stackGrantedAffinityLeavesNoResidue() {
        final Game game = newGame();
        final Player p = game.getPlayers().get(1);
        add("Forest", p, ZoneType.Battlefield);
        add("Grizzly Bears", p, ZoneType.Battlefield);
        add("Witherbloom, the Balancer", p, ZoneType.Battlefield);
        final Card inHand = add("Rampant Growth", p, ZoneType.Hand);
        game.getAction().checkStaticAbilities();

        offered(p, false);
        if (inHand.hasKeyword("Affinity:Creature")) {
            throw new AssertionError("stack-only affinity grant leaked onto the card in hand");
        }
        if (inHand.getCastSA() != null || inHand.getCastFrom() != null) {
            throw new AssertionError("cast bookkeeping leaked onto the card in hand");
        }
    }

    private static List<String> offered(final Player p, final boolean lifePaymentFallback) {
        final List<String> names = new ArrayList<>();
        for (final SpellAbility sa : ActionSpace.getPossibleActions(p, false, lifePaymentFallback)) {
            names.add(sa.getHostCard().getName());
        }
        return names;
    }

    private static Game newGame() {
        final List<RegisteredPlayer> players = new ArrayList<>();
        final Deck deck = new Deck();
        players.add(new RegisteredPlayer(deck).setPlayer(new LobbyPlayerAi("p2", null)));
        players.add(new RegisteredPlayer(deck).setPlayer(new LobbyPlayerAi("p1", null)));
        final GameRules rules = new GameRules(GameType.Constructed);
        final Game game = new Game(players, rules, new Match(rules, players, "ActionSpaceTest"));
        game.setAge(GameStage.Play);
        game.getPhaseHandler().devModeSet(PhaseType.MAIN1, game.getPlayers().get(1));
        game.getPhaseHandler().onStackResolved();
        return game;
    }

    private static Card add(final String name, final Player p, final ZoneType zone) {
        IPaperCard paper = FModel.getMagicDb().getCommonCards().getCard(name);
        if (paper == null) {
            StaticData.instance().attemptToLoadCard(name);
            paper = FModel.getMagicDb().getCommonCards().getCard(name);
        }
        final Card card = Card.fromPaperCard(paper, p);
        card.setGameTimestamp(p.getGame().getNextTimestamp());
        p.getZone(zone).add(card);
        return card;
    }
}
