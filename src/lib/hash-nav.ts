/** Hash-based deep links for the SPA views.
 *
 * Maps between zustand view state and the URL hash so the browser's
 * back/forward buttons and page refreshes restore the on-screen view:
 *   #/decks · #/deck/3 · #/study/3 · #/study/3/srs · #/quiz/3 · #/stats
 * The auth view has no hash (empty string — the URL stays clean), and the
 * `/?share=<token>` flow is orthogonal (query string, never a hash).
 */
import type { ViewName } from "./store";

/** View state encoded in / decoded from the URL hash. */
export interface HashViewState {
  view: ViewName;
  deckId: number | null;
  srs: boolean;
}

/** Build the URL hash for a view (with the leading "#"; "" for auth). */
export function viewToHash(view: ViewName, deckId: number | null, srs: boolean): string {
  switch (view) {
    case "decks":
      return "#/decks";
    case "deck":
      return deckId != null ? `#/deck/${deckId}` : "#/decks";
    case "study":
      return deckId != null ? `#/study/${deckId}${srs ? "/srs" : ""}` : "#/decks";
    case "quiz":
      return deckId != null ? `#/quiz/${deckId}` : "#/decks";
    case "stats":
      return "#/stats";
    case "auth":
      return "";
    default:
      return "";
  }
}

/** Parse a `location.hash`-style string into view state; null when empty/unknown. */
export function hashToView(hash: string): HashViewState | null {
  if (typeof hash !== "string") return null;
  const segments = hash.replace(/^#+/, "").split("/").filter(Boolean); // tolerate #, extra slashes
  if (segments.length === 0) return null;
  const idAt = (i: number) => segments[i] !== undefined && /^\d+$/.test(segments[i]);

  switch (segments[0]) {
    case "decks":
      return segments.length === 1 ? { view: "decks", deckId: null, srs: false } : null;
    case "stats":
      return segments.length === 1 ? { view: "stats", deckId: null, srs: false } : null;
    case "deck":
      return segments.length === 2 && idAt(1)
        ? { view: "deck", deckId: Number(segments[1]), srs: false }
        : null;
    case "quiz":
      return segments.length === 2 && idAt(1)
        ? { view: "quiz", deckId: Number(segments[1]), srs: false }
        : null;
    case "study": {
      if (!idAt(1)) return null;
      if (segments.length === 2) return { view: "study", deckId: Number(segments[1]), srs: false };
      if (segments.length === 3 && segments[2] === "srs")
        return { view: "study", deckId: Number(segments[1]), srs: true };
      return null;
    }
    default:
      return null;
  }
}

/** Sync the address bar to `hash`.
 *
 * Assigning `window.location.hash` pushes a history entry (so Back works) and
 * fires `hashchange`; the guard prevents duplicate entries for no-op changes.
 * An empty hash is removed via history.replaceState so no bare "#" is left.
 */
export function pushHash(hash: string): void {
  if (typeof window === "undefined") return;
  if (hash === "") {
    if (window.location.hash !== "") {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    return;
  }
  if (window.location.hash !== hash) {
    window.location.hash = hash;
  }
}
