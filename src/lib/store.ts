"use client";

import { create } from "zustand";
import { api, getAuthToken, setAuthToken } from "@/lib/api";
import { hashToView, pushHash, viewToHash } from "@/lib/hash-nav";
import type { User } from "@/lib/types";

export type ViewName = "auth" | "decks" | "deck" | "study" | "quiz" | "stats";

interface AppState {
  /** True once the stored token (if any) has been validated on page load. */
  booted: boolean;
  user: User | null;
  view: ViewName;
  activeDeckId: number | null;
  /** Whether the study view should open a smart (SM-2) session. */
  studySrs: boolean;
  /** Whether the study view runs in typed (free-recall) mode. Mutually
   * exclusive with studySrs — typing practice always uses regular sessions. */
  studyTyping: boolean;
  boot: () => Promise<void>;
  setAuth: (user: User, token: string) => void;
  /** Replace the cached user row (e.g. after changing the daily goal). */
  updateUser: (user: User) => void;
  logout: () => void;
  go: (view: ViewName, deckId?: number | null) => void;
  /** Navigate into study mode: srs = smart spaced-repetition session,
   * typing = free-recall (type-the-answer) session. Mutually exclusive. */
  goStudy: (deckId: number, srs: boolean, typing?: boolean) => void;
  /** Apply a parsed hash state WITHOUT touching the URL (hashchange listener). */
  applyHashState: (state: {
    view: ViewName;
    deckId: number | null;
    srs: boolean;
    typing: boolean;
  }) => void;
}

/** Global client-side SPA state: auth + which view is on screen.
 * Every navigation also mirrors the view into the URL hash so browser
 * back/forward and refreshes restore it (see lib/hash-nav.ts). */
export const useAppStore = create<AppState>((set, get) => ({
  booted: false,
  user: null,
  view: "auth",
  activeDeckId: null,
  studySrs: false,
  studyTyping: false,

  boot: async () => {
    const token = getAuthToken();
    let user: User | null = null;
    if (token) {
      try {
        user = await api.me();
      } catch {
        setAuthToken(null); // token expired / invalid
      }
    }
    if (user) {
      // Deep link: restore the view encoded in the URL hash (default: decks).
      const parsed = hashToView(window.location.hash);
      if (parsed) {
        set({
          user,
          view: parsed.view,
          activeDeckId: parsed.deckId,
          studySrs: parsed.srs,
          studyTyping: parsed.typing,
        });
      } else {
        set({ user, view: "decks" });
      }
    } else {
      // Not signed in — wipe any stale deep link so the URL stays clean.
      if (window.location.hash) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
      set({ user: null, view: "auth" });
    }
    set({ booted: true });
  },

  setAuth: (user, token) => {
    setAuthToken(token);
    set({ user, view: "decks", activeDeckId: null, studySrs: false, studyTyping: false });
    pushHash(""); // keep the URL clean around auth transitions
  },

  updateUser: (user) => set({ user }),

  logout: () => {
    setAuthToken(null);
    set({ user: null, view: "auth", activeDeckId: null, studySrs: false, studyTyping: false });
    pushHash(""); // keep the URL clean around auth transitions
  },

  go: (view, deckId = null) => {
    // Deep-linking into study from another surface (e.g. stats "Practice")
    // keeps whatever study flavor is currently selected; leaving study resets.
    const srs = view === "study" ? get().studySrs : false;
    const typing = view === "study" ? get().studyTyping : false;
    set({ view, activeDeckId: deckId, studySrs: srs, studyTyping: typing });
    pushHash(viewToHash(view, deckId, srs, typing));
  },

  goStudy: (deckId, srs, typing = false) => {
    set({ view: "study", activeDeckId: deckId, studySrs: srs, studyTyping: typing });
    pushHash(viewToHash("study", deckId, srs, typing));
  },

  applyHashState: ({ view, deckId, srs, typing }) =>
    set({ view, activeDeckId: deckId, studySrs: srs, studyTyping: typing }),
}));
