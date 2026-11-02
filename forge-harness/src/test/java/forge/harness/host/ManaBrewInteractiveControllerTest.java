package forge.harness.host;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import forge.StaticData;
import forge.ai.LobbyPlayerAi;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.Game;
import forge.game.GameRules;
import forge.game.GameStage;
import forge.game.GameType;
import forge.game.Match;
import forge.game.ability.AbilityFactory;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.player.RegisteredPlayer;
import forge.game.spellability.SpellAbility;
import forge.game.trigger.Trigger;
import forge.game.trigger.TriggerHandler;
import forge.game.trigger.WrappedAbility;
import forge.game.zone.ZoneType;
import forge.gui.GuiBase;
import forge.harness.common.HeadlessGuiBase;
import forge.item.IPaperCard;
import forge.localinstance.properties.ForgePreferences.FPref;
import forge.model.FModel;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

public final class ManaBrewInteractiveControllerTest {
    private ManaBrewInteractiveControllerTest() {}

    public static void main(final String[] args) {
        GuiBase.setInterface(new HeadlessGuiBase("forge/forge-gui/"));
        FModel.initialize(null, prefs -> {
            prefs.setPref(FPref.LOAD_CARD_SCRIPTS_LAZILY, true);
            prefs.setPref(FPref.UI_LANGUAGE, "en-US");
            return null;
        });

        final List<String> failures = new ArrayList<>();
        run("trampleAssignsPastKorFirewalker", () -> trampleAssignsPastBlockerByToughness("Kor Firewalker", 2), failures);
        run("trampleAssignsPastDarksteelMyr", () -> trampleAssignsPastBlockerByToughness("Darksteel Myr", 1), failures);
        run("costedTriggerIsNotConfirmedUpFront", ManaBrewInteractiveControllerTest::costedTriggerIsNotConfirmedUpFront, failures);
        run("sacrificeCostCanBeCancelled", ManaBrewInteractiveControllerTest::sacrificeCostCanBeCancelled, failures);
        run("announcedXCountsImprovise", ManaBrewInteractiveControllerTest::announcedXCountsImprovise, failures);
        run("flavorNamedCommanderIsFoundInTheDeck", ManaBrewInteractiveControllerTest::flavorNamedCommanderIsFoundInTheDeck, failures);

        if (!failures.isEmpty()) {
            System.err.println("ManaBrewInteractiveControllerTest: " + failures.size() + " failed: " + failures);
            System.exit(1);
        }
        System.exit(0);
    }

    private static void run(final String name, final Runnable test, final List<String> failures) {
        try {
            test.run();
            System.out.println("PASS " + name);
        } catch (final AssertionError | RuntimeException e) {
            System.out.println("FAIL " + name + ": " + e);
            failures.add(name);
        }
    }

    private static void trampleAssignsPastBlockerByToughness(final String blockerName, final int toughness) {
        final Fixture f = new Fixture();
        final Card attacker = f.add("Ball Lightning", f.p, ZoneType.Battlefield);
        final Card blocker = f.add(blockerName, f.game.getPlayers().get(1), ZoneType.Battlefield);
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

    private static void costedTriggerIsNotConfirmedUpFront() {
        final Fixture f = new Fixture();
        final Card host = f.add("Artist's Talent", f.p, ZoneType.Battlefield);
        f.add("Grizzly Bears", f.p, ZoneType.Hand);
        final Trigger trigger = TriggerHandler.parseTrigger(
                "Mode$ SpellCast | ValidCard$ Card.nonCreature | ValidActivatingPlayer$ You | TriggerZones$ Battlefield | Execute$ TrigDiscard",
                host, true);
        final SpellAbility ability = AbilityFactory.getAbility("AB$ Draw | Cost$ Discard<1/Card>", host);
        ability.setActivatingPlayer(f.p);
        ability.setOptionalTrigger(true);
        trigger.setOverridingAbility(ability);

        final boolean accepted = f.controller.confirmTrigger(new WrappedAbility(trigger, ability, f.p));

        assertTrue(accepted, "a costed optional trigger was declined before its cost was offered");
        assertTrue(f.bridge.prompts.isEmpty(), "a costed optional trigger asked for confirmation: " + f.bridge.prompts);
    }

    private static void sacrificeCostCanBeCancelled() {
        final Fixture f = new Fixture();
        final Card host = f.add("Grizzly Bears", f.p, ZoneType.Battlefield);
        f.add("Hill Giant", f.p, ZoneType.Battlefield);
        final SpellAbility sa = AbilityFactory.getAbility(
                "AB$ Pump | Cost$ Sac<1/Creature> | Defined$ Self | NumAtt$ +1", host);
        sa.setActivatingPlayer(f.p);
        f.bridge.answers.add(input -> "{\"type\":\"chooseBoardTargets\",\"output\":{\"type\":\"cancel\"}}");

        f.controller.playSpellAbilityNoStack(sa, false);

        assertEquals(1, f.bridge.prompts.size(), "prompts");
        final JsonObject prompt = f.bridge.prompts.get(0);
        assertEquals("chooseBoardTargets", prompt.get("type").getAsString(), "prompt type");
        assertTrue(prompt.get("cancellable").getAsBoolean(), "sacrifice cost prompt was not cancellable");
        assertEquals(2, f.p.getCardsIn(ZoneType.Battlefield).size(), "creatures on the battlefield after cancel");
    }

    private static void announcedXCountsImprovise() {
        final Fixture f = new Fixture();
        final Card whir = f.add("Whir of Invention", f.p, ZoneType.Hand);
        for (int i = 0; i < 4; i++) {
            f.add("Island", f.p, ZoneType.Battlefield);
        }
        for (int i = 0; i < 6; i++) {
            f.add("Howling Mine", f.p, ZoneType.Battlefield);
        }
        f.game.getAction().checkStaticAbilities();
        final SpellAbility sa = whir.getFirstSpellAbility();
        sa.setActivatingPlayer(f.p);
        f.bridge.answers.add(input ->
                "{\"type\":\"chooseNumber\",\"output\":{\"chosenNumber\":" + input.get("max").getAsInt() + "}}");

        f.controller.announceRequirements(sa, 0, Integer.MAX_VALUE, "X");

        assertEquals(1, f.bridge.prompts.size(), "prompts");
        final int max = f.bridge.prompts.get(0).get("max").getAsInt();
        assertTrue(max > 1, "X cap ignored improvise: max " + max + " with 4 Islands and 6 artifacts");
    }

    private static void flavorNamedCommanderIsFoundInTheDeck() {
        for (final ManaBrewEngineAdapter.CardIdentity commander : List.of(
                new ManaBrewEngineAdapter.CardIdentity("The Howling Abomination", "SLX", "13", false),
                new ManaBrewEngineAdapter.CardIdentity("The Howling Abomination", "SLD", "431", false),
                new ManaBrewEngineAdapter.CardIdentity("The Howling Abomination", null, null, false))) {
            final ManaBrewEngineAdapter.PlayerConfig config = new ManaBrewEngineAdapter.PlayerConfig(
                    "p",
                    List.of(commander, new ManaBrewEngineAdapter.CardIdentity("Forest", "EOE", "266", false)),
                    null,
                    null,
                    List.of("The Howling Abomination"),
                    false,
                    false);

            final Deck deck = ManaBrewEngineAdapter.buildDeck(config, new ArrayList<>());

            final String printing = commander.getSetCode() + "/" + commander.getCollectorNumber();
            assertEquals(1, deck.get(DeckSection.Commander).countAll(), "commander section for " + printing);
            assertEquals(1, deck.get(DeckSection.Main).countAll(), "main deck for " + printing);
        }
    }

    private static void assertTrue(final boolean condition, final String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }

    private static void assertEquals(final Object expected, final Object actual, final String what) {
        if (!expected.equals(actual)) {
            throw new AssertionError(what + ": expected " + expected + " but was " + actual);
        }
    }

    private static final class ScriptedBridge implements InteractiveBridge {
        final List<JsonObject> prompts = new ArrayList<>();
        final Deque<Function<JsonObject, String>> answers = new ArrayDeque<>();

        @Override
        public String exchange(final String promptJson) {
            final JsonObject input = JsonParser.parseString(promptJson).getAsJsonObject().getAsJsonObject("input");
            prompts.add(input);
            final Function<JsonObject, String> answer = answers.poll();
            if (answer == null) {
                throw new AssertionError("unexpected prompt: " + input);
            }
            return answer.apply(input);
        }

        @Override
        public void publishState() {}

        @Override
        public void publishDirective(final int playerIndex, final String directiveJson) {}
    }

    private static final class Fixture {
        final Game game;
        final Player p;
        final ScriptedBridge bridge = new ScriptedBridge();
        final ManaBrewInteractiveController controller;

        Fixture() {
            final List<RegisteredPlayer> players = new ArrayList<>();
            final Deck deck = new Deck();
            players.add(new RegisteredPlayer(deck).setPlayer(new LobbyPlayerAi("p1", null)));
            players.add(new RegisteredPlayer(deck).setPlayer(new LobbyPlayerAi("p2", null)));
            final GameRules rules = new GameRules(GameType.Constructed);
            final Match match = new Match(rules, players, "ManaBrewInteractiveControllerTest");
            game = new Game(players, rules, match);
            game.setAge(GameStage.Play);
            p = game.getPlayers().get(0);
            game.getPhaseHandler().devModeSet(PhaseType.MAIN1, p);
            game.getPhaseHandler().onStackResolved();
            ManaBrewInteractiveSession.setBridge(bridge);
            final ManaBrewInteractiveSession session = new ManaBrewInteractiveSession("test");
            session.attach(match, game, Set.of(), false);
            controller = new ManaBrewInteractiveController(game, p, p.getLobbyPlayer(), session);
            p.dangerouslySetController(controller);
        }

        Card add(final String name, final Player owner, final ZoneType zone) {
            IPaperCard paper = FModel.getMagicDb().getCommonCards().getCard(name);
            if (paper == null) {
                StaticData.instance().attemptToLoadCard(name);
                paper = FModel.getMagicDb().getCommonCards().getCard(name);
            }
            final Card card = Card.fromPaperCard(paper, owner);
            card.setGameTimestamp(game.getNextTimestamp());
            owner.getZone(zone).add(card);
            return card;
        }
    }
}
