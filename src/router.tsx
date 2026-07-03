import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const CardMockGallery = import.meta.env.DEV ? lazy(() => import("@/views/CardMockGallery")) : null;
import Lobby from "@/views/Lobby";
import DeckEditor from "@/views/DeckEditor";

import Game from "@/views/Game";
import Play from "@/views/Play";
import Tabletop from "@/views/Tabletop";
import Draft from "@/views/Draft";
import MultiplayerDraft from "@/views/MultiplayerDraft";
import MultiplayerSealed from "@/views/MultiplayerSealed";
import Limited from "@/views/Limited";
import Companion from "@/views/Companion";
import Sealed from "@/views/Sealed";
import Winston from "@/views/Winston";
import Gauntlet from "@/views/Gauntlet";
import Settings from "@/views/Settings";
import About from "@/views/About";
import Search from "@/views/Search";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    errorElement: (
      <div className="flex items-center justify-center h-[100dvh] text-destructive">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Page Not Found</h1>
          <p className="mt-2 text-muted-foreground">The page you're looking for doesn't exist.</p>
          <a href="/" className="mt-4 inline-block text-primary hover:underline">
            Go Home
          </a>
        </div>
      </div>
    ),
    children: [
      {
        index: true,
        element: <Navigate to="/lobby" replace />,
      },
      {
        path: "play",
        element: (
          <ErrorBoundary context="Play">
            <Play />
          </ErrorBoundary>
        ),
      },
      {
        path: "tabletop",
        element: (
          <ErrorBoundary context="Tabletop">
            <Tabletop />
          </ErrorBoundary>
        ),
      },
      {
        path: "lobby",
        element: (
          <ErrorBoundary context="Lobby">
            <Lobby />
          </ErrorBoundary>
        ),
      },
      {
        path: "search",
        element: (
          <ErrorBoundary context="Search">
            <Search />
          </ErrorBoundary>
        ),
      },
      {
        path: "deck-editor",
        element: (
          <ErrorBoundary context="Deck Editor">
            <DeckEditor />
          </ErrorBoundary>
        ),
      },
      {
        path: "game/:gameId",
        element: (
          <ErrorBoundary context="Game">
            <Game />
          </ErrorBoundary>
        ),
      },
      {
        path: "draft/multiplayer",
        element: (
          <ErrorBoundary context="MultiplayerDraft">
            <MultiplayerDraft />
          </ErrorBoundary>
        ),
      },
      {
        path: "sealed/multiplayer",
        element: (
          <ErrorBoundary context="MultiplayerSealed">
            <MultiplayerSealed />
          </ErrorBoundary>
        ),
      },
      {
        path: "draft/:draftId",
        element: (
          <ErrorBoundary context="Draft">
            <Draft />
          </ErrorBoundary>
        ),
      },
      {
        path: "limited",
        element: (
          <ErrorBoundary context="Limited">
            <Limited />
          </ErrorBoundary>
        ),
      },
      {
        path: "companion",
        element: (
          <ErrorBoundary context="Companion">
            <Companion />
          </ErrorBoundary>
        ),
      },
      {
        path: "sealed/:id",
        element: (
          <ErrorBoundary context="Sealed">
            <Sealed />
          </ErrorBoundary>
        ),
      },
      {
        path: "winston/:winstonId",
        element: (
          <ErrorBoundary context="Winston">
            <Winston />
          </ErrorBoundary>
        ),
      },
      {
        path: "gauntlet/:gauntletId",
        element: (
          <ErrorBoundary context="Gauntlet">
            <Gauntlet />
          </ErrorBoundary>
        ),
      },
      {
        path: "matches",
        element: (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3">
            <div className="text-4xl opacity-20">🚧</div>
            <h2 className="text-lg font-semibold">Active Matches</h2>
            <p className="text-sm text-muted-foreground">
              This feature is currently under development.
            </p>
          </div>
        ),
      },
      {
        path: "settings",
        element: (
          <ErrorBoundary context="Settings">
            <Settings />
          </ErrorBoundary>
        ),
      },
      {
        path: "about",
        element: (
          <ErrorBoundary context="About">
            <About />
          </ErrorBoundary>
        ),
      },
      ...(CardMockGallery
        ? [
            {
              path: "card-mock",
              element: (
                <ErrorBoundary context="Card Mock">
                  <Suspense fallback={null}>
                    <CardMockGallery />
                  </Suspense>
                </ErrorBoundary>
              ),
            },
          ]
        : []),
    ],
  },
]);
