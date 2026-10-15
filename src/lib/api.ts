/** Typed API client for the Deckio FastAPI backend.
 *
 * Sandbox mode (default): relative URLs with `?XTransformPort=8001` so the
 * preview gateway (Caddy :81) forwards to the backend mini-service.
 * Docker mode: set NEXT_PUBLIC_API_URL (e.g. http://localhost:8000).
 */
import type {
  AuthResponse,
  BulkImportResult,
  Card,
  CardInput,
  Deck,
  DeckBundle,
  DeckInput,
  DeckStats,
  PublicDeck,
  QuizAnswerOut,
  QuizDirection,
  QuizResult,
  QuizStart,
  ReviewOut,
  ReviewResult,
  SearchResults,
  SessionSummary,
  ShareLink,
  StatsOverview,
  StudyNext,
  StudyStart,
  TypedAnswerOut,
  User,
  WeakCard,
} from "./types";
import { DEMO_TOKEN, DemoApiError, demoRequest, isDemoMode } from "./demo-backend";

const API_PORT = process.env.NEXT_PUBLIC_API_PORT ?? "8001";
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
const TOKEN_KEY = "deckio_token";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  // Demo mode auto-signs in — the in-browser backend has no real sessions.
  if (isDemoMode()) return window.localStorage.getItem(TOKEN_KEY) ?? DEMO_TOKEN;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

/** Trigger a client-side download of a text payload (CSV exports). */
function downloadTextFile(text: string, filename: string): void {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function buildUrl(path: string): string {
  if (API_BASE) return `${API_BASE}${path}`;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}XTransformPort=${API_PORT}`;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts?: { raw?: BodyInit; contentType?: string }
): Promise<T> {
  // GitHub Pages / `?demo=1`: route the call to the in-browser backend.
  if (isDemoMode()) {
    try {
      return await demoRequest<T>(method, path, body, opts);
    } catch (err) {
      if (err instanceof DemoApiError) throw new ApiError(err.status, err.message);
      throw new ApiError(0, "Demo backend error — try clearing this site's local storage");
    }
  }

  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let payload: BodyInit | undefined;
  if (opts?.raw !== undefined) {
    payload = opts.raw;
    if (opts.contentType) headers["Content-Type"] = opts.contentType;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path), { method, headers, body: payload });
  } catch {
    throw new ApiError(0, "Cannot reach the API server — is the backend running?");
  }

  if (res.status === 204) return undefined as T;

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }

  if (!res.ok) {
    // Expired/invalid session: clear the token and drop back to the auth screen.
    if (res.status === 401 && token) {
      setAuthToken(null);
      if (typeof window !== "undefined") window.location.reload();
    }
    const detail = (data as { detail?: unknown } | null)?.detail;
    let message = `Request failed (${res.status})`;
    if (typeof detail === "string") message = detail;
    else if (Array.isArray(detail)) {
      message = detail
        .map((d) =>
          d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : JSON.stringify(d)
        )
        .join("; ");
    }
    throw new ApiError(res.status, message);
  }
  return data as T;
}

async function requestText(path: string): Promise<string> {
  // CSV exports are plain strings in demo mode too.
  if (isDemoMode()) {
    try {
      return await demoRequest<string>("GET", path);
    } catch (err) {
      if (err instanceof DemoApiError) throw new ApiError(err.status, err.message);
      throw new ApiError(0, "Demo backend error — try clearing this site's local storage");
    }
  }
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(buildUrl(path), { method: "GET", headers });
  } catch {
    throw new ApiError(0, "Cannot reach the API server — is the backend running?");
  }
  if (!res.ok) {
    if (res.status === 401 && token) {
      setAuthToken(null);
      if (typeof window !== "undefined") window.location.reload();
    }
    throw new ApiError(res.status, `Request failed (${res.status})`);
  }
  return res.text();
}

export const api = {
  // ---- Auth ----
  register: (email: string, password: string) =>
    request<AuthResponse>("POST", "/api/auth/register", { email, password }),
  login: (email: string, password: string) =>
    request<AuthResponse>("POST", "/api/auth/login", { email, password }),
  me: () => request<User>("GET", "/api/auth/me"),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>("PUT", "/api/auth/password", {
      current_password: currentPassword,
      new_password: newPassword,
    }),
  deleteAccount: (password: string) =>
    request<void>("POST", "/api/auth/account/delete", { password }),
  setGoal: (dailyGoal: number) =>
    request<User>("PUT", "/api/auth/goal", { daily_goal: dailyGoal }),

  // ---- Decks ----
  decks: {
    list: () => request<Deck[]>("GET", "/api/decks"),
    get: (id: number) => request<Deck>("GET", `/api/decks/${id}`),
    create: (payload: DeckInput) => request<Deck>("POST", "/api/decks", payload),
    update: (id: number, payload: Partial<DeckInput>) =>
      request<Deck>("PUT", `/api/decks/${id}`, payload),
    duplicate: (id: number) => request<Deck>("POST", `/api/decks/${id}/duplicate`),
    importBundle: (bundle: DeckBundle) =>
      request<Deck>("POST", "/api/decks/import", bundle),
    exportBundle: (id: number) => request<DeckBundle>("GET", `/api/decks/${id}/bundle`),
    getShare: (id: number) => request<ShareLink>("GET", `/api/decks/${id}/share`),
    createShare: (id: number, regenerate = false) =>
      request<ShareLink>("POST", `/api/decks/${id}/share${regenerate ? "?regenerate=true" : ""}`),
    revokeShare: (id: number) => request<void>("DELETE", `/api/decks/${id}/share`),
    remove: (id: number) => request<void>("DELETE", `/api/decks/${id}`),
  },

  // ---- Public share previews (no auth) ----
  publicDeck: (token: string) =>
    request<PublicDeck>("GET", `/api/public/decks/${encodeURIComponent(token)}`),

  // ---- Cards ----
  cards: {
    list: (deckId: number, params?: { q?: string; tag?: string }) => {
      const sp = new URLSearchParams();
      if (params?.q) sp.set("q", params.q);
      if (params?.tag) sp.set("tag", params.tag);
      const qs = sp.toString();
      return request<Card[]>("GET", `/api/decks/${deckId}/cards${qs ? `?${qs}` : ""}`);
    },
    create: (deckId: number, payload: Required<CardInput>) =>
      request<Card>("POST", `/api/decks/${deckId}/cards`, payload),
    update: (id: number, payload: CardInput) => request<Card>("PUT", `/api/cards/${id}`, payload),
    remove: (id: number) => request<void>("DELETE", `/api/cards/${id}`),
    bulkImport: (deckId: number, csv: Blob | string, filename = "cards.csv") => {
      if (typeof csv === "string") {
        // Raw text/csv body — simplest path, no FormData needed.
        return request<BulkImportResult>("POST", `/api/decks/${deckId}/cards/bulk`, undefined, {
          raw: csv,
          contentType: "text/csv",
        });
      }
      const form = new FormData();
      form.append("file", csv, filename);
      return request<BulkImportResult>("POST", `/api/decks/${deckId}/cards/bulk`, undefined, {
        raw: form,
      });
    },
    exportCsv: (deckId: number) => requestText(`/api/decks/${deckId}/cards/export`),
  },

  // ---- Study ----
  study: {
    start: (deckId: number, srs = false) =>
      request<StudyStart>("POST", `/api/decks/${deckId}/study/start${srs ? "?srs=true" : ""}`),
    next: (deckId: number, sessionId?: number) =>
      request<StudyNext>(
        "GET",
        `/api/decks/${deckId}/study/next${sessionId ? `?session_id=${sessionId}` : ""}`
      ),
    review: (sessionId: number, cardId: number, result: ReviewResult) =>
      request<ReviewOut>("POST", "/api/study/review", { session_id: sessionId, card_id: cardId, result }),
    // Typed (free-recall) answer — the server grades it (normalizing case,
    // whitespace and punctuation; accents are significant). "almost" marks a
    // 1-char-off miss; the client may override via review(sessionId, cardId, "correct").
    typed: (sessionId: number, cardId: number, answer: string) =>
      request<TypedAnswerOut>("POST", "/api/study/typed", {
        session_id: sessionId,
        card_id: cardId,
        answer,
      }),
  },

  // ---- Quiz ----
  quiz: {
    start: (deckId: number, limit?: number, direction?: QuizDirection, timedSeconds?: number) => {
      const sp = new URLSearchParams();
      if (limit) sp.set("limit", String(limit));
      if (direction) sp.set("direction", direction);
      if (timedSeconds) sp.set("timed_seconds", String(timedSeconds)); // whole-quiz budget (omit = untimed)
      const qs = sp.toString();
      return request<QuizStart>("POST", `/api/decks/${deckId}/quiz/start${qs ? `?${qs}` : ""}`);
    },
    answer: (sessionId: number, cardId: number, answer: string) =>
      request<QuizAnswerOut>("POST", "/api/quiz/answer", {
        session_id: sessionId,
        card_id: cardId,
        answer,
      }),
    /** Fetch the result breakdown. `finish: true` closes an unfinished session
     * server-side (used when a timed quiz hits its deadline). */
    result: (sessionId: number, opts?: { finish?: boolean }) =>
      request<QuizResult>("GET", `/api/quiz/${sessionId}/result${opts?.finish ? "?finish=true" : ""}`),
  },

  // ---- Stats ----
  stats: {
    overview: (days?: number) =>
      request<StatsOverview>("GET", `/api/stats/overview${days ? `?days=${days}` : ""}`),
    deck: (id: number) => request<DeckStats>("GET", `/api/stats/decks/${id}`),
    weakCards: () => request<WeakCard[]>("GET", "/api/stats/weak-cards"),
    sessions: (limit = 15) =>
      request<SessionSummary[]>("GET", `/api/stats/sessions?limit=${limit}`),
  },

  // ---- Search (⌘K palette) ----
  search: (q: string) => request<SearchResults>("GET", `/api/search?q=${encodeURIComponent(q)}`),

  // ---- CSV export (review history) ----
  /** Download the review history as a CSV attachment — every deck, or one deck.
   * Streams the response into a blob download (filename from Content-Disposition). */
  exportReviewsCsv: async (deckId?: number): Promise<void> => {
    const path =
      deckId != null ? `/api/decks/${deckId}/export/reviews.csv` : "/api/stats/export/reviews.csv";

    // Demo mode: requestText routes to the in-browser backend (no headers to
    // read), so build the filename client-side and download the string.
    if (isDemoMode()) {
      const csv = await requestText(path);
      downloadTextFile(csv, deckId != null ? "deckio-deck-reviews.csv" : "deckio-reviews.csv");
      return;
    }

    const headers: Record<string, string> = {};
    const token = getAuthToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;

    let res: Response;
    try {
      res = await fetch(buildUrl(path), { method: "GET", headers });
    } catch {
      throw new ApiError(0, "Cannot reach the API server — is the backend running?");
    }

    if (!res.ok) {
      if (res.status === 401 && token) {
        setAuthToken(null);
        if (typeof window !== "undefined") window.location.reload();
      }
      // Surface the server's detail message when it sent JSON.
      let message = `Request failed (${res.status})`;
      try {
        const data = (await res.json()) as { detail?: unknown } | null;
        if (typeof data?.detail === "string") message = data.detail;
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(res.status, message);
    }

    // Prefer the server's filename (Content-Disposition) with a sane fallback.
    const disposition = res.headers.get("Content-Disposition") ?? "";
    const match = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(disposition);
    const filename =
      (match ? decodeURIComponent(match[1] ?? match[2] ?? "").replace(/[/\\]/g, "") : "") ||
      "deckio-reviews.csv";

    downloadTextFile(await res.text(), filename);
  },
};
