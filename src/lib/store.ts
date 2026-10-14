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
  boot: () => Promise<void>;
  setAuth: (user: User, token: string) => void;
  logout: () => void;
  go: (view: ViewName, deckId?: number | null) => void;
}

/** Global client-side SPA state: auth + which view is on screen. */
export const useAppStore = create<AppState>((set) => ({
  booted: false,
  user: null,
  view: "auth",
  activeDeckId: null,

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

  logout: () => {
    setAuthToken(null);
    set({ user: null, view: "auth", activeDeckId: null });
  },

  go: (view, deckId = null) => set({ view, activeDeckId: deckId }),
}));
