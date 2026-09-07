import { useState } from "react";
import { useOwnedDecks } from "@/hooks/useOwnedDecks";
import { useAccountDecks } from "@/hooks/useAccountDecks";
import { useSignInDialog } from "@/stores/useSignInDialogStore";
import { getFormat } from "@/lib/formats";
import { duelDecks } from "@/three/duelDecks";
import type { DuelMatch } from "@/three/duelMatch";
import "@/three/AccountDuelSetup.css";

export function AccountDuelSetup({
  onStart,
  disabled,
}: {
  onStart: (match: DuelMatch) => void;
  disabled: boolean;
}) {
  const owned = useOwnedDecks();
  const account = useAccountDecks();
  const [selected, setSelected] = useState("");
  const [opponent, setOpponent] = useState("mirror");
  const [players, setPlayers] = useState(2);
  const choices = [
    ...owned
      .filter((saved) => !saved.deck.draft && saved.deck.cards.length > 0)
      .map((saved) => ({
        id: saved.id,
        deck: saved.deck,
        colors: [
          ...new Set(
            [...saved.deck.cards, ...(saved.deck.commanders ?? [])].flatMap(
              (card) => card.colorIdentity,
            ),
          ),
        ],
        label: `${saved.deck.name} · ${saved.accountDeckId ? "Account" : "Local"}`,
      })),
    ...duelDecks.map((deck, index) => ({
      id: `starter:${index}`,
      deck,
      colors: deck.colorIdentity,
      label: `${deck.name} · Starter`,
    })),
  ];
  const own = choices.find((choice) => choice.id === selected) ?? choices[0];
  const other = choices.find((choice) => choice.id === opponent) ?? own;
  return (
    <>
      <small>3D BATTLEFIELD · LOCAL MATCH</small>
      <h2>Choose your deck</h2>
      <p>Play against Forge AI with your saved decks.</p>
      {!account.signedIn && (
        <button disabled={disabled} onClick={() => useSignInDialog.getState().show()}>
          Sign in to load account decks
        </button>
      )}
      {account.loading && <p role="status">Loading account decks…</p>}
      {account.error && (
        <div role="alert">
          <p>{account.error}</p>
          <button disabled={disabled} onClick={() => void account.refresh()}>
            Retry loading decks
          </button>
        </div>
      )}
      {account.signedIn && account.resolved && !account.loading && (
        <p>
          {owned.filter((deck) => deck.accountDeckId).length} account decks available{" "}
          <button
            className="arena-deck-refresh"
            disabled={disabled}
            onClick={() => void account.refresh()}
          >
            Refresh
          </button>
        </p>
      )}
      <div className="arena-account-setup">
        <label>
          Your deck
          <select
            disabled={disabled || account.loading}
            value={own.id}
            onChange={(event) => setSelected(event.target.value)}
          >
            {choices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          AI opponent deck
          <select
            disabled={disabled}
            value={opponent}
            onChange={(event) => setOpponent(event.target.value)}
          >
            <option value="mirror">Mirror match · same deck as you</option>
            {choices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Players
          <select
            disabled={disabled}
            value={players}
            onChange={(event) => setPlayers(Number(event.target.value))}
          >
            <option value={2}>You + 1 AI</option>
            <option value={4}>You + 3 AI</option>
          </select>
        </label>
      </div>
      <p>
        {own.deck.cards.reduce((sum, card) => sum + ("count" in card ? (card.count ?? 1) : 1), 0)}{" "}
        cards · {own.deck.format ?? "Constructed"}
        {players === 4 ? " · All three opponents use the selected AI deck" : ""}
      </p>
      <button
        disabled={disabled || account.loading}
        onClick={() =>
          onStart({
            deck: own.deck,
            opponents: Array.from({ length: players - 1 }, () => other.deck),
            colors: [own.colors, ...Array.from({ length: players - 1 }, () => other.colors)],
            startingLife:
              getFormat(own.deck.format?.toLowerCase() ?? "standard")?.deckRules.startingLife ?? 20,
          })
        }
      >
        {disabled ? "Preparing battlefield…" : "Play in 3D"}
      </button>
    </>
  );
}
