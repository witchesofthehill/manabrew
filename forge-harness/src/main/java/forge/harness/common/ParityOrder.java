package forge.harness.common;

import forge.card.ColorSet;
import forge.card.MagicColor.Color;
import forge.card.mana.ManaCostShard;
import forge.game.GameEntity;
import forge.game.card.Card;
import forge.game.replacement.ReplacementEffect;
import forge.game.spellability.AlternativeCost;
import forge.game.spellability.OptionalCost;
import forge.game.spellability.SpellAbility;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** Centralized canonical ordering for parity choice spaces. */
public final class ParityOrder {
    private ParityOrder() {}

    public static List<Card> sortCardsByNameThenId(final List<Card> cards) {
        final List<Card> out = new ArrayList<>(cards);
        out.sort(cardComparator());
        return out;
    }

    public static Comparator<Card> cardComparator() {
        return Comparator.comparing((Card c) -> c.getName())
                .thenComparingInt(ParityCardMap::parityId);
    }

    public static List<SpellAbility> sortActions(final List<SpellAbility> actions) {
        final List<SpellAbility> out = new ArrayList<>(actions);
        out.sort(actionComparator());
        return out;
    }

    public static Comparator<SpellAbility> actionComparator() {
        return Comparator.comparing(ParityOrder::actionSortKey);
    }

    private static String actionSortKey(final SpellAbility sa) {
        final String label = actionBaseLabel(sa);
        final String bucket = (sa.isSpell() || sa.isLandAbility()) ? "0" : "1";
        final int hostParity = ParityCardMap.parityId(sa.getHostCard());
        final String variant = (sa.isSpell() || sa.isLandAbility())
                ? cardModeSortKey(sa)
                : String.format("%05d", abilityDeclarationIndex(sa));
        final String fallback = sa.toUnsuppressedString() == null ? "" : sa.toUnsuppressedString();
        final String key = label + "|" + bucket + "|" + hostParity + "|" + variant + "|" + fallback;
        if (Boolean.getBoolean("forge.parity.sort.trace")) {
            System.err.printf("[sort-java] %s%n", key);
        }
        return key;
    }

    private static String actionBaseLabel(final SpellAbility sa) {
        final String kind = sa.isLandAbility() ? "LAND"
                : (sa.isSpell() ? "SPELL" : (sa.isManaAbility() ? "MANA" : "AB"));
        final String host = sa.getHostCard() == null ? "" : sa.getHostCard().getName();
        final String fbTag = sa.isFlashback() ? "[FB]" : "";
        return kind + ":" + host + fbTag;
    }

    private static String cardModeSortKey(final SpellAbility sa) {
        if (sa.isOptionalCostPaid(OptionalCost.AltCost)) return "StaticAlternative";
        if (sa.isAlternativeCost(AlternativeCost.Flashback)) return "Flashback";
        if (sa.isAlternativeCost(AlternativeCost.Spectacle)) return "Spectacle";
        if (sa.isAlternativeCost(AlternativeCost.Evoke)) return "Evoke";
        if (sa.isAlternativeCost(AlternativeCost.Dash)) return "Dash";
        if (sa.isAlternativeCost(AlternativeCost.Blitz)) return "Blitz";
        if (sa.isAlternativeCost(AlternativeCost.Escape)) return "Escape";
        if (sa.isAlternativeCost(AlternativeCost.Overload)) return "Overload";
        if (sa.isAlternativeCost(AlternativeCost.Madness)) return "Madness";
        if (sa.isAlternativeCost(AlternativeCost.Foretold)) return "Foretell";
        if (sa.isAlternativeCost(AlternativeCost.Emerge)) return "Emerge";
        if (sa.isCastFaceDown()) return "Morph";
        if (sa.isAlternativeCost(AlternativeCost.Bestow)) return "Bestow";
        return "0";
    }

    private static int abilityDeclarationIndex(final SpellAbility sa) {
        final Card host = sa.getHostCard();
        if (host == null) {
            return Integer.MAX_VALUE;
        }
        int idx = 0;
        for (final SpellAbility base : host.getSpellAbilities()) {
            if (base == sa) {
                return idx;
            }
            idx++;
        }
        final String text = sa.toUnsuppressedString();
        idx = 0;
        for (final SpellAbility base : host.getSpellAbilities()) {
            final String bt = base.toUnsuppressedString();
            if (text != null && text.equals(bt)) {
                return idx;
            }
            idx++;
        }
        return Integer.MAX_VALUE;
    }

    /**
     * Sort key for target candidates (GameEntity: Player or Card).
     * Players sort first (by index), cards sort second (by name + parityId).
     */
    public static String targetSortKey(final GameEntity e) {
        if (e instanceof Card c) {
            final int ownerId = c.getOwner() == null ? Integer.MAX_VALUE : c.getOwner().getId();
            final int controllerId = c.getController() == null ? Integer.MAX_VALUE : c.getController().getId();
            return "1|"
                + c.getName()
                + "|O" + String.format("%05d", ownerId)
                + "|C" + String.format("%05d", controllerId)
                + "|I" + String.format("%05d", ParityCardMap.parityId(c));
        }
        // Player — sort by index (name or ID)
        return "0|" + e.getName();
    }

    public static List<GameEntity> sortDefenders(final List<GameEntity> defenders) {
        final List<GameEntity> out = new ArrayList<>(defenders);
        out.sort(Comparator.comparing(ParityOrder::defenderKey));
        return out;
    }

    public static List<ReplacementEffect> sortReplacementEffects(final List<ReplacementEffect> effects) {
        final List<ReplacementEffect> out = new ArrayList<>(effects);
        out.sort(Comparator.comparing(ParityOrder::replacementSortKey));
        return out;
    }

    public static List<Byte> sortColors(final ColorSet colors) {
        final List<Byte> out = new ArrayList<>();
        if (colors == null || colors.isColorless()) {
            return out;
        }
        for (final Color color : colors) {
            out.add(color.getColorMask());
        }
        return out;
    }

    public static int colorShardRank(final ManaCostShard shard) {
        final List<Byte> shardColors = sortColors(shard.getColor());
        if (shardColors.isEmpty()) {
            return 5;
        }
        final List<Byte> allColors = sortColors(ColorSet.WUBRG);
        final byte primary = shardColors.get(0);
        for (int i = 0; i < allColors.size(); i++) {
            if (allColors.get(i) == primary) {
                return i;
            }
        }
        return 5;
    }

    private static String defenderKey(final GameEntity e) {
        return e.getName() + "|" + e.getId();
    }

    private static String replacementSortKey(final ReplacementEffect effect) {
        final String host = effect.getHostCard() == null ? "" : effect.getHostCard().getName();
        final String desc = effect.getDescription() == null ? "" : effect.getDescription();
        return host + ": " + desc;
    }
}
