package forge.harness.common;

import forge.StaticData;
import forge.ai.AiController;
import forge.ai.LobbyPlayerAi;
import forge.ai.PlayerControllerAi;
import forge.card.mana.ManaAtom;
import forge.card.mana.ManaCost;
import forge.deck.Deck;
import forge.game.Game;
import forge.game.GameRules;
import forge.game.GameStage;
import forge.game.GameType;
import forge.game.Match;
import forge.game.ability.AbilityFactory;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.card.CardCollectionView;
import forge.game.card.CounterEnumType;
import forge.game.combat.Combat;
import forge.game.combat.CombatUtil;
import forge.game.cost.CostPartMana;
import forge.game.mana.ManaConversionMatrix;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.player.RegisteredPlayer;
import forge.game.spellability.SpellAbility;
import forge.game.trigger.Trigger;
import forge.game.trigger.TriggerHandler;
import forge.game.trigger.WrappedAbility;
import forge.game.zone.ZoneType;
import forge.gui.GuiBase;
import forge.item.IPaperCard;
import forge.localinstance.properties.ForgePreferences.FPref;
import forge.model.FModel;
import forge.util.MyRandom;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

public final class HarnessPlayPlumbingTest {
    private HarnessPlayPlumbingTest() {}

    public static void main(final String[] args) {
        GuiBase.setInterface(new HeadlessGuiBase("forge/forge-gui/"));
        FModel.initialize(null, prefs -> {
            prefs.setPref(FPref.LOAD_CARD_SCRIPTS_LAZILY, true);
            prefs.setPref(FPref.UI_LANGUAGE, "en-US");
            return null;
        });

        triggerFiringsDoNotShareTargets();
        stashedCardIsPaidWithManaOfAnyType();
        handCastIsPaidWithItsOwnColors();
        priorityPassesWhenWorkRunsOut();
        exhaustedAttackStillMeetsRequirements();
        exhaustedBlockStillMeetsRequirements();
        exhaustedBlockCompletesRequiredMenaceGroup();
        System.exit(0);
    }

    private static void triggerFiringsDoNotShareTargets() {
        final Card host = new Card(1, null);
        final Trigger trigger = TriggerHandler.parseTrigger("Mode$ Always", host, true);
        final SpellAbility template = AbilityFactory.getAbility("DB$ Destroy | ValidTgts$ Artifact", host);
        trigger.setOverridingAbility(template);
        final WrappedAbility firstFiring = new WrappedAbility(trigger, template, null);

        HarnessPlayPlumbing.detachTriggerTemplate(firstFiring);

        if (firstFiring.getWrappedAbility() != template) {
            throw new AssertionError("live wrapped ability changed");
        }
        final Card firstTarget = new Card(2, null);
        firstFiring.getTargets().add(firstTarget);

        final SpellAbility secondAbility = trigger.getOverridingAbility().copy(host, null, false, true);
        final WrappedAbility secondFiring = new WrappedAbility(trigger, secondAbility, null);
        if (!secondFiring.getTargets().isEmpty()) {
            throw new AssertionError("second firing inherited the first firing's target");
        }

        final Card secondTarget = new Card(3, null);
        secondFiring.getTargets().add(secondTarget);
        if (firstFiring.getTargets().getFirstTargetedCard() != firstTarget) {
            throw new AssertionError("first firing target changed");
        }
        if (secondFiring.getTargets().getFirstTargetedCard() != secondTarget) {
            throw new AssertionError("second firing target was not independent");
        }
    }

    private static void stashedCardIsPaidWithManaOfAnyType() {
        final Game game = newGame();
        final Player p = game.getPlayers().get(1);
        add("Tinybones, Bauble Burglar", p, ZoneType.Battlefield);
        final Card stashed = add("Llanowar Elves", game.getPlayers().get(0), ZoneType.Exile);
        stashed.addCounterInternal(CounterEnumType.STASH, 1, p, false, null, null);
        game.getAction().checkStaticAbilities();

        SpellAbility mayPlay = null;
        for (final SpellAbility sa : stashed.getAllPossibleAbilities(p, true)) {
            if (sa.getMayPlay() != null) {
                mayPlay = sa;
            }
        }
        if (mayPlay == null) {
            throw new AssertionError("Tinybones did not let its controller cast the stashed Llanowar Elves");
        }

        if (!blackPaysGreen(paymentMatrix(p, mayPlay))) {
            throw new AssertionError("Llanowar Elves cast through Tinybones could not be paid with black mana");
        }
    }

    private static void handCastIsPaidWithItsOwnColors() {
        final Game game = newGame();
        final Player p = game.getPlayers().get(1);
        add("Tinybones, Bauble Burglar", p, ZoneType.Battlefield);
        final Card inHand = add("Llanowar Elves", p, ZoneType.Hand);
        game.getAction().checkStaticAbilities();

        if (blackPaysGreen(paymentMatrix(p, inHand.getFirstSpellAbility()))) {
            throw new AssertionError("Llanowar Elves cast from hand could be paid with black mana");
        }
    }

    private static boolean blackPaysGreen(final ManaConversionMatrix matrix) {
        return (matrix.getPossibleColorUses((byte) ManaAtom.BLACK) & ManaAtom.GREEN) != 0;
    }

    private static ManaConversionMatrix paymentMatrix(final Player p, final SpellAbility sa) {
        final PaymentProbe probe = new PaymentProbe(p.getGame(), p);
        p.dangerouslySetController(probe);
        final HarnessPlayHooks hooks = new HarnessPlayHooks() {
            @Override
            public void markFailedPaymentCard(final Card card) {}

            @Override
            public CardCollectionView chooseTapTypeForCost(
                    final CardCollection valid, final SpellAbility ability, final int totalPowerRequired) {
                return null;
            }
        };
        final HarnessPlayPlumbing plumbing = new HarnessPlayPlumbing(
                hooks, p, new HarnessCostPlumbing(probe, hooks, p, true), true);
        sa.setActivatingPlayer(p);
        plumbing.handlePlayingSpellAbility(p, sa, p.getGame());
        if (probe.matrix == null) {
            throw new AssertionError(sa.getHostCard().getName() + " never reached mana payment");
        }
        return probe.matrix;
    }

    private static void priorityPassesWhenWorkRunsOut() {
        final Game game = newGame();
        final Player player = game.getPhaseHandler().getPlayerTurn();
        final AiController ai = ((PlayerControllerAi) player.getController()).getAi();
        final Card spell = add("Memnite", player, ZoneType.Hand);
        game.getRules().setAiWorkLimit(1);
        MyRandom.setRandom(new Random(123));
        final List<SpellAbility> exhausted = ai.chooseSpellAbilityToPlay();
        if (exhausted != null && !exhausted.isEmpty()) {
            throw new AssertionError("exhausted priority chose a spell: " + exhausted);
        }
        game.getRules().setAiWorkLimit(20000);
        MyRandom.setRandom(new Random(123));
        final List<SpellAbility> chosen = ai.chooseSpellAbilityToPlay();
        if (chosen == null || chosen.size() != 1 || chosen.get(0).getHostCard() != spell) {
            throw new AssertionError("priority with work remaining did not choose Memnite: " + chosen);
        }
    }

    private static void exhaustedAttackStillMeetsRequirements() {
        final Game game = newGame();
        game.getRules().setAiWorkLimit(1);
        final Player attacker = game.getPhaseHandler().getPlayerTurn();
        final Card first = add("Juggernaut", attacker, ZoneType.Battlefield);
        final Card second = add("Juggernaut", attacker, ZoneType.Battlefield);
        first.setSickness(false);
        second.setSickness(false);
        game.getPhaseHandler().devAdvanceToPhase(PhaseType.COMBAT_DECLARE_ATTACKERS, null);
        final Combat combat = game.getCombat();
        if (!combat.isAttacking(first) || !combat.isAttacking(second) || !CombatUtil.validateAttackers(combat)) {
            throw new AssertionError("exhausted attack failed to declare both mandatory attackers: " + combat.getAttackers());
        }
    }

    private static void exhaustedBlockStillMeetsRequirements() {
        final Game game = newGame();
        game.getRules().setAiWorkLimit(1);
        final Player attacker = game.getPhaseHandler().getPlayerTurn();
        final Player defender = game.getNextPlayerAfter(attacker);
        final Card large = add("Juggernaut", attacker, ZoneType.Battlefield);
        final Card small = add("Memnite", attacker, ZoneType.Battlefield);
        final Card required = add("Memnite", defender, ZoneType.Battlefield);
        add("Juggernaut", defender, ZoneType.Battlefield);
        required.addMustBlockCard(game.getNextTimestamp(), large);
        game.getPhaseHandler().devModeSet(PhaseType.COMBAT_DECLARE_BLOCKERS, attacker);
        final Combat combat = new Combat(attacker);
        combat.addAttacker(large, defender);
        combat.addAttacker(small, defender);
        ((PlayerControllerAi) defender.getController()).getAi().declareBlockersFor(defender, combat);
        final String invalid = CombatUtil.validateBlocks(combat, defender);
        if (invalid != null || !combat.getBlockers(large).contains(required) || !combat.getBlockers(small).isEmpty()) {
            throw new AssertionError("exhausted block did not leave only the required block: " + invalid);
        }
    }

    private static void exhaustedBlockCompletesRequiredMenaceGroup() {
        final Game game = newGame();
        game.getRules().setAiWorkLimit(1);
        final Player attacker = game.getPhaseHandler().getPlayerTurn();
        final Player defender = game.getNextPlayerAfter(attacker);
        final Card menace = add("Maulfist Squad", attacker, ZoneType.Battlefield);
        final Card required = add("Razorgrass Screen", defender, ZoneType.Battlefield);
        add("Okk", defender, ZoneType.Battlefield);
        final Card helper = add("Memnite", defender, ZoneType.Battlefield);
        game.getPhaseHandler().devModeSet(PhaseType.COMBAT_DECLARE_BLOCKERS, attacker);
        final Combat combat = new Combat(attacker);
        combat.addAttacker(menace, defender);
        ((PlayerControllerAi) defender.getController()).getAi().declareBlockersFor(defender, combat);
        final CardCollection blockers = combat.getBlockers(menace);
        final String invalid = CombatUtil.validateBlocks(combat, defender);
        if (invalid != null || blockers.size() != 2 || !blockers.contains(required) || !blockers.contains(helper)) {
            throw new AssertionError("exhausted block did not complete the required menace block: " + blockers + "; " + invalid);
        }
    }

    private static final class PaymentProbe extends PlayerControllerAi {
        private ManaConversionMatrix matrix;

        PaymentProbe(final Game game, final Player p) {
            super(game, p, p.getLobbyPlayer());
        }

        @Override
        public boolean payManaCost(
                final ManaCost toPay,
                final CostPartMana costPartMana,
                final SpellAbility sa,
                final String prompt,
                final ManaConversionMatrix matrix,
                final boolean effect) {
            this.matrix = matrix;
            return false;
        }
    }

    private static Game newGame() {
        final List<RegisteredPlayer> players = new ArrayList<>();
        final Deck deck = new Deck();
        players.add(new RegisteredPlayer(deck).setPlayer(new LobbyPlayerAi("p2", null)));
        players.add(new RegisteredPlayer(deck).setPlayer(new LobbyPlayerAi("p1", null)));
        final GameRules rules = new GameRules(GameType.Constructed);
        final Game game = new Game(players, rules, new Match(rules, players, "HarnessPlayPlumbingTest"));
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
