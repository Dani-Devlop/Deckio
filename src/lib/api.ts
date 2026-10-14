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
  DeckInput,
  DeckStats,
  QuizAnswerOut,
  QuizResult,
  QuizStart,
  ReviewOut,
  ReviewResult,
  StatsOverview,
  StudyNext,
  StudyStart,
  User,
  WeakCard,
} from "./types";

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
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
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

  // ---- Decks ----
  decks: {
    list: () => request<Deck[]>("GET", "/api/decks"),
    get: (id: number) => request<Deck>("GET", `/api/decks/${id}`),
    create: (payload: DeckInput) => request<Deck>("POST", "/api/decks", payload),
    update: (id: number, payload: Partial<DeckInput>) =>
      request<Deck>("PUT", `/api/decks/${id}`, payload),
    duplicate: (id: number) => request<Deck>("POST", `/api/decks/${id}/duplicate`),
    remove: (id: number) => request<void>("DELETE", `/api/decks/${id}`),
  },

  // ---- Cards ----
  cards: {
    list: (deckId: number) => request<Card[]>("GET", `/api/decks/${deckId}/cards`),
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
  },

  // ---- Quiz ----
  quiz: {
    start: (deckId: number, limit?: number) =>
      request<QuizStart>("POST", `/api/decks/${deckId}/quiz/start${limit ? `?limit=${limit}` : ""}`),
    answer: (sessionId: number, cardId: number, answer: string) =>
      request<QuizAnswerOut>("POST", "/api/quiz/answer", {
        session_id: sessionId,
        card_id: cardId,
        answer,
      }),
    result: (sessionId: number) => request<QuizResult>("GET", `/api/quiz/${sessionId}/result`),
  },

  // ---- Stats ----
  stats: {
    overview: (days?: number) =>
      request<StatsOverview>("GET", `/api/stats/overview${days ? `?days=${days}` : ""}`),
    deck: (id: number) => request<DeckStats>("GET", `/api/stats/decks/${id}`),
    weakCards: () => request<WeakCard[]>("GET", "/api/stats/weak-cards"),
  },
};
