package forge.harness.common;

import forge.StaticData;
import forge.ai.LobbyPlayerAi;
import forge.ai.PlayerControllerAi;
import forge.card.GamePieceType;
import forge.card.mana.ManaCost;
import forge.deck.Deck;
import forge.game.Game;
import forge.game.GameEntity;
import forge.game.GameRules;
import forge.game.GameStage;
import forge.game.GameType;
import forge.game.Match;
import forge.game.ability.AbilityFactory;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.card.CardCollectionView;
import forge.game.card.CounterEnumType;
import forge.game.card.CounterType;
import forge.game.cost.CostPart;
import forge.game.cost.CostPartMana;
import forge.game.mana.ManaConversionMatrix;
import forge.game.phase.PhaseType;
import forge.game.player.DelayedReveal;
import forge.game.player.Player;
import forge.game.player.RegisteredPlayer;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;
import forge.gui.GuiBase;
import forge.item.IPaperCard;
import forge.localinstance.properties.ForgePreferences.FPref;
import forge.model.FModel;
import forge.util.collect.FCollectionView;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;

public final class HarnessCostPlumbingTest {
    private HarnessCostPlumbingTest() {}

    public static void main(final String[] args) {
        GuiBase.setInterface(new HeadlessGuiBase("forge/forge-gui/"));
        FModel.initialize(null, prefs -> {
            prefs.setPref(FPref.LOAD_CARD_SCRIPTS_LAZILY, true);
            prefs.setPref(FPref.UI_LANGUAGE, "en-US");
            return null;
        });

        final List<String> failures = new ArrayList<>();
        run("sacrificeWithDifferentNamesAsksOnePickAtATime", HarnessCostPlumbingTest::sacrificeWithDifferentNamesAsksOnePickAtATime, failures);
        run("exileWithTotalManaSymbolsPromptsAndExiles", HarnessCostPlumbingTest::exileWithTotalManaSymbolsPromptsAndExiles, failures);
        run("exileWithTotalManaSymbolsRejectsTooFewSymbols", HarnessCostPlumbingTest::exileWithTotalManaSymbolsRejectsTooFewSymbols, failures);
        run("exileWithTotalCmcPromptsAndExiles", HarnessCostPlumbingTest::exileWithTotalCmcPromptsAndExiles, failures);
        run("exileSharedCardTypeFiltersSecondPick", HarnessCostPlumbingTest::exileSharedCardTypeFiltersSecondPick, failures);
        run("exileSameGraveAsksWhoseGraveyard", HarnessCostPlumbingTest::exileSameGraveAsksWhoseGraveyard, failures);
        run("exileFromTopGraveTakesTopCardsWithoutPrompt", HarnessCostPlumbingTest::exileFromTopGraveTakesTopCardsWithoutPrompt, failures);
        run("exileFromStackOffersOnlySpells", HarnessCostPlumbingTest::exileFromStackOffersOnlySpells, failures);
        run("discardRandomDoesNotPrompt", HarnessCostPlumbingTest::discardRandomDoesNotPrompt, failures);
        run("discardWithSameNameConstrainsSecondPick", HarnessCostPlumbingTest::discardWithSameNameConstrainsSecondPick, failures);
        run("removeCounterLetsPlayerChooseThePermanent", HarnessCostPlumbingTest::removeCounterLetsPlayerChooseThePermanent, failures);
        run("removeAnyCounterOnSourceAsksForTheType", HarnessCostPlumbingTest::removeAnyCounterOnSourceAsksForTheType, failures);
        run("gainLifeChoosesOneOpponent", HarnessCostPlumbingTest::gainLifeChoosesOneOpponent, failures);
        run("putCardToLibFromSameGraveAsksWhoseGraveyard", HarnessCostPlumbingTest::putCardToLibFromSameGraveAsksWhoseGraveyard, failures);
        run("revealSameColorFiltersCandidates", HarnessCostPlumbingTest::revealSameColorFiltersCandidates, failures);
        run("revealExactHandIsAutoPaid", HarnessCostPlumbingTest::revealExactHandIsAutoPaid, failures);
        run("tapSharesCreatureTypeFiltersCandidates", HarnessCostPlumbingTest::tapSharesCreatureTypeFiltersCandidates, failures);

        if (!failures.isEmpty()) {
            System.err.println("HarnessCostPlumbingTest: " + failures.size() + " failed: " + failures);
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

    private static void sacrificeWithDifferentNamesAsksOnePickAtATime() {
        final Fixture f = new Fixture(2);
        final Card host = f.add("Transmutation Font", f.p, ZoneType.Battlefield);
        f.token("Sol Ring", f.p);
        f.token("Sol Ring", f.p);
        f.token("Mind Stone", f.p);
        f.token("Howling Mine", f.p);
        f.controller.cardPicks.add(List.of("Sol Ring"));
        f.controller.cardPicks.add(List.of("Mind Stone"));
        f.controller.cardPicks.add(List.of("Howling Mine"));

        final boolean paid = f.pay("Sac<3/Artifact.token+WithDifferentNames/artifact tokens with different names>", host);

        assertTrue(paid, "payment failed");
        final List<Prompt> picks = f.controller.prompts("sacrifice");
        assertEquals(3, picks.size(), "sacrifice prompts");
        assertEquals(4, picks.get(0).options.size(), "first pick offered all tokens");
        assertEquals(List.of("Mind Stone", "Howling Mine"), picks.get(1).options, "second pick");
        assertEquals(List.of("Howling Mine"), picks.get(2).options, "third pick");
        assertEquals(1, f.p.getCardsIn(ZoneType.Battlefield).size() - 1, "tokens left on the battlefield");
    }

    private static void exileWithTotalManaSymbolsPromptsAndExiles() {
        final Fixture f = new Fixture(2);
        final Card host = f.add("Baron Helmut Zemo", f.p, ZoneType.Battlefield);
        for (int i = 0; i < 4; i++) {
            f.add("Phyrexian Obliterator", f.p, ZoneType.Graveyard);
        }
        f.add("Grizzly Bears", f.p, ZoneType.Graveyard);
        f.controller.cardPicks.add(List.of(
                "Phyrexian Obliterator", "Phyrexian Obliterator", "Phyrexian Obliterator", "Phyrexian Obliterator"));

        final boolean paid = f.pay("ExileFromGrave<1+/Card.Black+withTotalManaSymbols_Black_GE15>", host);

        assertTrue(paid, "payment failed");
        final List<Prompt> picks = f.controller.prompts("cards");
        assertEquals(1, picks.size(), "card prompts");
        assertEquals(1, picks.get(0).min, "min");
        assertEquals(4, picks.get(0).max, "max");
        assertEquals(4, picks.get(0).options.size(), "only black cards offered");
        assertEquals(4, f.p.getCardsIn(ZoneType.Exile).size(), "cards exiled");
    }

    private static void exileWithTotalManaSymbolsRejectsTooFewSymbols() {
        final Fixture f = new Fixture(2);
        final Card host = f.add("Baron Helmut Zemo", f.p, ZoneType.Battlefield);
        for (int i = 0; i < 4; i++) {
            f.add("Phyrexian Obliterator", f.p, ZoneType.Graveyard);
        }
        f.controller.cardPicks.add(List.of(
                "Phyrexian Obliterator", "Phyrexian Obliterator", "Phyrexian Obliterator"));

        final boolean paid = f.pay("ExileFromGrave<1+/Card.Black+withTotalManaSymbols_Black_GE15>", host);

        assertTrue(!paid, "12 black symbols paid a 15-symbol cost");
        assertEquals(4, f.p.getCardsIn(ZoneType.Graveyard).size(), "graveyard changed");
    }

    private static void exileWithTotalCmcPromptsAndExiles() {
        final Fixture f = new Fixture(2);
        final Card host = f.add("Grizzly Bears", f.p, ZoneType.Battlefield);
        f.add("Sol Ring", f.p, ZoneType.Graveyard);
        f.add("Mind Stone", f.p, ZoneType.Graveyard);
        f.add("Howling Mine", f.p, ZoneType.Graveyard);
        f.controller.cardPicks.add(List.of("Mind Stone", "Howling Mine"));

        final boolean paid = f.pay("ExileFromGrave<1+/Card.Historic+withTotalCMCGE4>", host);

        assertTrue(paid, "payment failed");
        assertEquals(1, f.controller.prompts("cards").size(), "card prompts");
        assertEquals(2, f.p.getCardsIn(ZoneType.Exile).size(), "cards exiled");
    }

    private static void exileSharedCardTypeFiltersSecondPick() {
        final Fixture f = new Fixture(2);
        final Card host = f.add("Grizzly Bears", f.p, ZoneType.Battlefield);
        f.add("Sol Ring", f.p, ZoneType.Graveyard);
        f.add("Mind Stone", f.p, ZoneType.Graveyard);
        f.add("Hill Giant", f.p, ZoneType.Graveyard);
        f.controller.cardPicks.add(List.of("Sol Ring"));

        final boolean paid = f.pay("ExileCtrlOrGrave<2/Permanent.Other+withSharedCardType/permanent>", host);

        assertTrue(paid, "payment failed");
        final List<Prompt> picks = f.controller.prompts("cards");
        assertEquals(2, picks.size(), "card prompts");
        assertEquals(List.of("Mind Stone"), picks.get(1).options, "second pick");
        assertEquals(2, f.p.getCardsIn(ZoneType.Exile).size(), "cards exiled");
    }

    private static void exileSameGraveAsksWhoseGraveyard() {
        final Fixture f = new Fixture(3);
        final Card host = f.add("Grizzly Bears", f.p, ZoneType.Battlefield);
        f.add("Grizzly Bears", f.p, ZoneType.Graveyard);
        f.add("Grizzly Bears", f.opp1, ZoneType.Graveyard);
        f.add("Hill Giant", f.opp1, ZoneType.Graveyard);
        f.add("Grizzly Bears", f.opp2, ZoneType.Graveyard);
        f.add("Hill Giant", f.opp2, ZoneType.Graveyard);
        f.controller.playerPicks.add(f.opp2.getName());

        final boolean paid = f.pay("ExileSameGrave<2/Creature>", host);

        assertTrue(paid, "payment failed");
        assertEquals(2, f.controller.prompts("player").get(0).options.size(), "graveyards offered");
        final CardCollectionView exiled = f.game.getCardsIn(ZoneType.Exile);
        assertEquals(2, exiled.size(), "cards exiled");
        for (final Card c : exiled) {
            assertTrue(c.getOwner() == f.opp2, c.getName() + " exiled from " + c.getOwner().getName());
        }
    }

    private static void exileFromTopGraveTakesTopCardsWithoutPrompt() {
        final Fixture f = new Fixture(2);
        final Card host = f.add("Grizzly Bears", f.p, ZoneType.Battlefield);
        final Card bottom = f.add("Phyrexian Obliterator", f.p, ZoneType.Graveyard);
        f.add("Grizzly Bears", f.p, ZoneType.Graveyard);
        final Card middle = f.add("Dark Ritual", f.p, ZoneType.Graveyard);
        final Card top = f.add("Phyrexian Obliterator", f.p, ZoneType.Graveyard);

        final boolean paid = f.pay("ExileFromGrave<2/Card.Black+FromTopGrave>", host);

        assertTrue(paid, "payment failed");
        assertTrue(f.controller.prompts("cards").isEmpty(), "top-of-graveyard exile prompted");
        final CardCollectionView exiled = f.p.getCardsIn(ZoneType.Exile);
        assertTrue(exiled.contains(top) && exiled.contains(middle), "exiled " + exiled);
        assertTrue(!exiled.contains(bottom), "exiled the bottom black card");
    }

    private static void exileFromStackOffersOnlySpells() {
        final Fixture f = new Fixture(2);
        final Card host = f.add("Grizzly Bears", f.p, ZoneType.Battlefield);
        final Card shock = f.add("Shock", f.opp1, ZoneType.Hand);
        final SpellAbility shockSa = shock.getFirstSpellAbility();
        shockSa.setActivatingPlayer(f.opp1);
        shockSa.getTargets().add(f.p);
        f.game.getAction().moveToStack(shock, shockSa);
        f.game.getStack().add(shockSa);
        final SpellAbility pump = AbilityFactory.getAbility("AB$ Pump | Cost$ 0 | Defined$ Self | NumAtt$ +1", host);
        pump.setActivatingPlayer(f.p);
        f.game.getStack().add(pump);

        final boolean paid = f.pay("ExileFromStack<1/Card>", host);

        assertTrue(paid, "payment failed");
        final List<Prompt> picks = f.controller.prompts("spells");
        assertEquals(1, picks.size(), "spell prompts");
        assertEquals(1, picks.get(0).options.size(), "offered " + picks.get(0).options);
    }

    private static void discardRandomDoesNotPrompt() {
        final Fixture f = new Fixture(2);
        final Card host = f.add("Grizzly Bears", f.p, ZoneType.Battlefield);
        f.add("Shock", f.p, ZoneType.Hand);
        f.add("Forest", f.p, ZoneType.Hand);
        f.add("Hill Giant", f.p, ZoneType.Hand);

        final boolean paid = f.pay("Discard<1/Random>", host);

        assertTrue(paid, "payment failed");
        assertTrue(f.controller.prompts("cards").isEmpty(), "random discard let the player choose");
        assertEquals(2, f.p.getCardsIn(ZoneType.Hand).size(), "hand size");
    }

    private static void discardWithSameNameConstrainsSecondPick() {
        final Fixture f = new Fixture(2);
        final Card host = f.add("Grizzly Bears", f.p, ZoneType.Battlefield);
        f.add("Grizzly Bears", f.p, ZoneType.Hand);
        f.add("Sol Ring", f.p, ZoneType.Hand);
        f.add("Grizzly Bears", f.p, ZoneType.Hand);
        f.add("Sol Ring", f.p, ZoneType.Hand);
        f.add("Forest", f.p, ZoneType.Hand);
        f.controller.cardPicks.add(List.of("Grizzly Bears"));

        final boolean paid = f.pay("Discard<2/Card.nonLand+WithSameName/nonland cards with the same name>", host);

        assertTrue(paid, "payment failed");
        final List<Prompt> picks = f.controller.prompts("cards");
        assertEquals(2, picks.size(), "card prompts");
        assertEquals(List.of("Grizzly Bears"), picks.get(1).options, "second pick");
        final CardCollectionView graveyard = f.p.getCardsIn(ZoneType.Graveyard);
        assertEquals(2, graveyard.size(), "discarded");
        for (final Card c : graveyard) {
            assertEquals("Grizzly Bears", c.getName(), "discarded card");
        }
    }

    private static void removeCounterLetsPlayerChooseThePermanent() {
        final Fixture f = new Fixture(2);
        final Card bears = f.add("Grizzly Bears", f.p, ZoneType.Battlefield);
        final Card giant = f.add("Hill Giant", f.p, ZoneType.Battlefield);
        bears.addCounterInternal(CounterEnumType.P1P1, 1, f.p, false, null, null);
        giant.addCounterInternal(CounterEnumType.P1P1, 1, f.p, false, null, null);
        f.controller.cardPicks.add(List.of("Hill Giant"));

        final boolean paid = f.pay("SubCounter<1/P1P1/Creature.YouCtrl/creature you control>", bears);

        assertTrue(paid, "payment failed");
        assertEquals(1, f.controller.prompts("cards").size(), "card prompts");
        assertEquals(0, giant.getCounters(CounterEnumType.P1P1), "Hill Giant counters");
        assertEquals(1, bears.getCounters(CounterEnumType.P1P1), "Grizzly Bears counters");
    }

    private static void removeAnyCounterOnSourceAsksForTheType() {
        final Fixture f = new Fixture(2);
        final Card bears = f.add("Grizzly Bears", f.p, ZoneType.Battlefield);
        bears.addCounterInternal(CounterEnumType.P1P1, 1, f.p, false, null, null);
        bears.addCounterInternal(CounterEnumType.SHIELD, 1, f.p, false, null, null);
        final CounterType first = bears.getCounters().entrySet().iterator().next().getElement();
        final CounterType wanted = first.is(CounterEnumType.P1P1) ? CounterEnumType.SHIELD : CounterEnumType.P1P1;
        f.controller.counterPicks.add(wanted);
        f.controller.numberPicks.add(1);

        final boolean paid = f.pay("SubCounter<1/Any>", bears);

        assertTrue(paid, "payment failed");
        assertEquals(1, f.controller.prompts("counterType").size(), "counter type prompts");
        assertEquals(0, bears.getCounters(wanted), wanted.getName() + " counters");
        assertEquals(1, bears.getCounters(first), first.getName() + " counters");
    }

    private static void gainLifeChoosesOneOpponent() {
        final Fixture f = new Fixture(3);
        final Card host = f.add("Grizzly Bears", f.p, ZoneType.Battlefield);
        final int life1 = f.opp1.getLife();
        final int life2 = f.opp2.getLife();
        f.controller.playerPicks.add(f.opp2.getName());

        final boolean paid = f.pay("GainLife<5/Player.Opponent>", host);

        assertTrue(paid, "payment failed");
        assertEquals(1, f.controller.prompts("player").size(), "player prompts");
        assertEquals(life2 + 5, f.opp2.getLife(), "chosen opponent life");
        assertEquals(life1, f.opp1.getLife(), "other opponent life");
    }

    private static void putCardToLibFromSameGraveAsksWhoseGraveyard() {
        final Fixture f = new Fixture(3);
        final Card host = f.add("Grizzly Bears", f.p, ZoneType.Battlefield);
        f.add("Grizzly Bears", f.opp1, ZoneType.Graveyard);
        f.add("Hill Giant", f.opp1, ZoneType.Graveyard);
        f.add("Grizzly Bears", f.opp2, ZoneType.Graveyard);
        f.add("Hill Giant", f.opp2, ZoneType.Graveyard);
        f.controller.playerPicks.add(f.opp2.getName());

        final boolean paid = f.pay("PutCardToLibFromSameGrave<2/-1/Card>", host);

        assertTrue(paid, "payment failed");
        assertEquals(1, f.controller.prompts("player").size(), "player prompts");
        assertEquals(2, f.opp2.getCardsIn(ZoneType.Library).size(), "chosen owner's library");
        assertEquals(2, f.opp1.getCardsIn(ZoneType.Graveyard).size(), "other graveyard");
    }

    private static void revealSameColorFiltersCandidates() {
        final Fixture f = new Fixture(2);
        final Card host = f.add("Grizzly Bears", f.p, ZoneType.Battlefield);
        f.add("Shock", f.p, ZoneType.Hand);
        f.add("Lightning Bolt", f.p, ZoneType.Hand);
        f.add("Grizzly Bears", f.p, ZoneType.Hand);
        f.controller.cardPicks.add(List.of("Shock"));

        final boolean paid = f.pay("Reveal<2/SameColor>", host);

        assertTrue(paid, "payment failed");
        final List<Prompt> picks = f.controller.prompts("cards");
        assertEquals(2, picks.size(), "card prompts");
        assertEquals(2, picks.get(0).options.size(), "first pick offered " + picks.get(0).options);
        assertEquals(List.of("Lightning Bolt"), picks.get(1).options, "second pick");
    }

    private static void revealExactHandIsAutoPaid() {
        final Fixture f = new Fixture(2);
        final Card host = f.add("Grizzly Bears", f.p, ZoneType.Battlefield);
        f.add("Hill Giant", f.p, ZoneType.Hand);
        f.add("Forest", f.p, ZoneType.Hand);

        final boolean paid = f.pay("Reveal<1/Creature>", host);

        assertTrue(paid, "payment failed");
        assertTrue(f.controller.prompts("cards").isEmpty(), "prompted for the only legal card");
    }

    private static void tapSharesCreatureTypeFiltersCandidates() {
        final Fixture f = new Fixture(2);
        final Card host = f.add("Grizzly Bears", f.p, ZoneType.Battlefield);
        final Card elves = f.add("Llanowar Elves", f.p, ZoneType.Battlefield);
        final Card mystic = f.add("Elvish Mystic", f.p, ZoneType.Battlefield);
        f.controller.cardPicks.add(List.of("Llanowar Elves"));

        final boolean paid = f.pay(
                "tapXType<2/Creature.sharesCreatureTypeWith/creatures that share a creature type>", host);

        assertTrue(paid, "payment failed");
        final List<Prompt> picks = f.controller.prompts("cards");
        assertEquals(2, picks.size(), "card prompts");
        assertEquals(2, picks.get(0).options.size(), "first pick offered " + picks.get(0).options);
        assertEquals(List.of("Elvish Mystic"), picks.get(1).options, "second pick");
        assertTrue(elves.isTapped() && mystic.isTapped(), "elves not tapped");
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

    private record Prompt(String kind, List<String> options, int min, int max) {}

    private static final class ScriptedController extends PlayerControllerAi {
        final List<Prompt> prompts = new ArrayList<>();
        final Deque<List<String>> cardPicks = new ArrayDeque<>();
        final Deque<String> playerPicks = new ArrayDeque<>();
        final Deque<CounterType> counterPicks = new ArrayDeque<>();
        final Deque<Integer> numberPicks = new ArrayDeque<>();

        ScriptedController(final Game game, final Player p) {
            super(game, p, p.getLobbyPlayer());
        }

        List<Prompt> prompts(final String kind) {
            final List<Prompt> out = new ArrayList<>();
            for (final Prompt prompt : prompts) {
                if (prompt.kind.equals(kind)) {
                    out.add(prompt);
                }
            }
            return out;
        }

        private CardCollection pickCards(final String kind, final CardCollectionView pool, final int min, final int max) {
            final List<String> names = new ArrayList<>();
            for (final Card c : pool) {
                names.add(c.getName());
            }
            prompts.add(new Prompt(kind, names, min, max));
            final CardCollection picked = new CardCollection();
            final List<String> wanted = cardPicks.poll();
            if (wanted == null) {
                for (final Card c : pool) {
                    if (picked.size() >= min) {
                        break;
                    }
                    picked.add(c);
                }
                return picked;
            }
            for (final String name : wanted) {
                for (final Card c : pool) {
                    if (c.getName().equals(name) && !picked.contains(c)) {
                        picked.add(c);
                        break;
                    }
                }
            }
            return picked;
        }

        @Override
        public CardCollectionView chooseCardsForEffect(
                final CardCollectionView sourceList, final SpellAbility sa, final String title,
                final int min, final int max, final boolean isOptional, final Map<String, Object> params) {
            return pickCards("cards", sourceList, min, max);
        }

        @Override
        public CardCollectionView choosePermanentsToSacrifice(
                final SpellAbility sa, final int min, final int max, final CardCollectionView validTargets, final String message) {
            return pickCards("sacrifice", validTargets, min, max);
        }

        @Override
        public <T extends GameEntity> T chooseSingleEntityForEffect(
                final FCollectionView<T> optionList, final DelayedReveal delayedReveal, final SpellAbility sa,
                final String title, final boolean isOptional, final Player targetedPlayer, final Map<String, Object> params) {
            final List<String> names = new ArrayList<>();
            for (final T option : optionList) {
                names.add(option.getName());
            }
            prompts.add(new Prompt("player", names, 1, 1));
            final String wanted = playerPicks.poll();
            for (final T option : optionList) {
                if (wanted == null || option.getName().equals(wanted)) {
                    return option;
                }
            }
            return null;
        }

        @Override
        public List<SpellAbility> chooseSpellAbilitiesForEffect(
                final List<SpellAbility> spells, final SpellAbility sa, final String title, final int num,
                final Map<String, Object> params) {
            final List<String> names = new ArrayList<>();
            for (final SpellAbility spell : spells) {
                names.add(spell.getHostCard().getName());
            }
            prompts.add(new Prompt("spells", names, num, num));
            return new ArrayList<>(spells.subList(0, Math.min(num, spells.size())));
        }

        @Override
        public CounterType chooseCounterType(
                final List<CounterType> options, final SpellAbility sa, final String prompt, final Map<String, Object> params) {
            final List<String> names = new ArrayList<>();
            for (final CounterType option : options) {
                names.add(option.getName());
            }
            prompts.add(new Prompt("counterType", names, 1, 1));
            final CounterType wanted = counterPicks.poll();
            return wanted != null && options.contains(wanted) ? wanted : options.get(0);
        }

        @Override
        public int chooseNumber(final SpellAbility sa, final String title, final int min, final int max) {
            prompts.add(new Prompt("number", List.of(), min, max));
            final Integer wanted = numberPicks.poll();
            return wanted == null ? max : wanted;
        }

        @Override
        public boolean confirmPayment(final CostPart costPart, final String prompt, final SpellAbility sa) {
            prompts.add(new Prompt("confirm", List.of(prompt), 0, 0));
            return true;
        }

        @Override
        public boolean payManaCost(
                final ManaCost toPay, final CostPartMana costPartMana, final SpellAbility sa, final String prompt,
                final ManaConversionMatrix matrix, final boolean effect) {
            return true;
        }
    }

    private static final class Fixture {
        final Game game;
        final Player p;
        final Player opp1;
        final Player opp2;
        final ScriptedController controller;
        final HarnessCostPlumbing plumbing;

        Fixture(final int playerCount) {
            final List<RegisteredPlayer> players = new ArrayList<>();
            final Deck deck = new Deck();
            for (int i = 0; i < playerCount; i++) {
                players.add(new RegisteredPlayer(deck).setPlayer(new LobbyPlayerAi("p" + (i + 1), null)));
            }
            final GameRules rules = new GameRules(GameType.Constructed);
            game = new Game(players, rules, new Match(rules, players, "HarnessCostPlumbingTest"));
            game.setAge(GameStage.Play);
            p = game.getPlayers().get(0);
            opp1 = game.getPlayers().get(1);
            opp2 = playerCount > 2 ? game.getPlayers().get(2) : null;
            game.getPhaseHandler().devModeSet(PhaseType.MAIN1, p);
            game.getPhaseHandler().onStackResolved();
            controller = new ScriptedController(game, p);
            p.dangerouslySetController(controller);
            final HarnessPlayHooks hooks = new HarnessPlayHooks() {
                @Override
                public void markFailedPaymentCard(final Card card) {}

                @Override
                public CardCollectionView chooseTapTypeForCost(
                        final CardCollection valid, final SpellAbility ability, final int totalPowerRequired) {
                    return null;
                }
            };
            plumbing = new HarnessCostPlumbing(controller, hooks, p, true);
        }

        boolean pay(final String cost, final Card host) {
            final SpellAbility sa = AbilityFactory.getAbility(
                    "AB$ Pump | Cost$ " + cost + " | Defined$ Self | NumAtt$ +1", host);
            sa.setActivatingPlayer(p);
            return plumbing.payWithControllerDecision(sa.getPayCosts(), sa, false);
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

        Card token(final String name, final Player owner) {
            final Card card = add(name, owner, ZoneType.Battlefield);
            card.setGamePieceType(GamePieceType.TOKEN);
            return card;
        }
    }
}
