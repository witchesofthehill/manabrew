package forge.harness.host;

import forge.card.CardStateName;
import forge.game.card.Card;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;

public final class ReplayOrderingTest {
    public static void main(final String[] args) {
        for (int i = 0; i < Integer.parseInt(args[0]); i++) System.identityHashCode(new Object());
        final Card room = new Card(1, null);
        if (!new ArrayList<>(room.getLockedRooms()).equals(List.of(CardStateName.LeftSplit, CardStateName.RightSplit))) {
            throw new AssertionError("room choice order depends on JVM identity hashes: " + room.getLockedRooms());
        }
        room.setUnlockedRooms(EnumSet.of(CardStateName.LeftSplit));
        if (!new ArrayList<>(room.getLockedRooms()).equals(List.of(CardStateName.RightSplit))) {
            throw new AssertionError("unlocked room was offered again");
        }
    }
}
