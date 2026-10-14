"use client";

import { create } from "zustand";
import { api, getAuthToken, setAuthToken } from "@/lib/api";
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
  boot: () => Promise<void>;
  setAuth: (user: User, token: string) => void;
  /** Replace the cached user row (e.g. after changing the daily goal). */
  updateUser: (user: User) => void;
  logout: () => void;
  go: (view: ViewName, deckId?: number | null) => void;
  /** Navigate into study mode, optionally as a smart spaced-repetition session. */
  goStudy: (deckId: number, srs: boolean) => void;
}

/** Global client-side SPA state: auth + which view is on screen. */
export const useAppStore = create<AppState>((set) => ({
  booted: false,
  user: null,
  view: "auth",
  activeDeckId: null,
  studySrs: false,

  boot: async () => {
    const token = getAuthToken();
    if (token) {
      try {
        const user = await api.me();
        set({ user, view: "decks" });
      } catch {
        setAuthToken(null); // token expired / invalid
      }
    }
    set({ booted: true });
  },

  setAuth: (user, token) => {
    setAuthToken(token);
    set({ user, view: "decks", activeDeckId: null });
  },

  updateUser: (user) => set({ user }),

  logout: () => {
    setAuthToken(null);
    set({ user: null, view: "auth", activeDeckId: null, studySrs: false });
  },

  go: (view, deckId = null) => set({ view, activeDeckId: deckId }),

  goStudy: (deckId, srs) =>
    set({ view: "study", activeDeckId: deckId, studySrs: srs }),
}));
