/** Shared TypeScript types mirroring the FastAPI Pydantic schemas (see backend/app/schemas.py). */

export type ReviewResult = "correct" | "wrong";

// ----------------------------- Auth -----------------------------
export interface User {
  id: number;
  email: string;
  daily_goal: number; // reviews/day — powers the stats goal ring
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

// ----------------------------- Decks -----------------------------
export interface Deck {
  id: number;
  title: string;
  description: string | null;
  color: string;
  icon: string;
  created_at: string;
  card_count: number;
  reviews_count: number;
  accuracy: number | null;
  last_studied_at: string | null;
  due_count: number;
  // Smart-review presets (per-deck):
  new_per_day: number;
  max_reviews: number;
  // Quiz defaults (per-deck):
  quiz_questions: number; // 5–50 — preselected quiz length
  quiz_answer_side: "front" | "back"; // which side is shown as the question
  share_token: string | null; // public read-only link token (null = private)
}

export interface DeckInput {
  title: string;
  description?: string | null;
  color?: string;
  icon?: string;
  new_per_day?: number; // new cards a smart review may introduce per day
  max_reviews?: number; // hard cap on smart-review session size
  quiz_questions?: number; // default quiz length (5–50)
  quiz_answer_side?: "front" | "back"; // which side quizzes show as the question
}

// ----------------------------- Cards -----------------------------
export interface Card {
  id: number;
  deck_id: number;
  front: string;
  back: string;
  tags: string[];
  hint: string | null; // optional memory aid shown before flipping
  image_url: string | null; // optional picture rendered above the text
  created_at: string;
  // Spaced-repetition state (read-only, for UI chips):
  ease: number;
  interval_days: number;
  reps: number;
  lapses: number;
  due_at: string | null; // null → new card → due immediately
}

export interface CardInput {
  front?: string;
  back?: string;
  tags?: string[];
  hint?: string | null; // null clears the hint
  image_url?: string | null; // null clears the image
}

export interface BulkImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

// ----------------------------- Search -----------------------------
export interface SearchCardHit {
  card_id: number;
  deck_id: number;
  deck_title: string;
  front: string;
  back: string;
  tags: string[];
}

export interface SearchResults {
  decks: Deck[];
  cards: SearchCardHit[];
}

// ------------------------- Session history -------------------------
export interface SessionSummary {
  id: number;
  deck_id: number;
  deck_title: string;
  mode: "study" | "quiz" | string;
  srs: boolean;
  started_at: string;
  finished_at: string | null;
  reviews: number;
  correct: number;
  accuracy: number | null;
  duration_seconds: number | null;
}

// --------------------------- Deck bundle ---------------------------
export interface DeckBundle {
  version: number;
  app: string;
  title: string;
  description: string | null;
  color: string;
  icon: string;
  new_per_day?: number;
  max_reviews?: number;
  card_count: number;
  cards: { front: string; back: string; tags: string[]; hint?: string | null; image_url?: string | null }[];
}

// ------------------------- Public share links -------------------------
export interface ShareLink {
  share_token: string | null;
  share_path: string | null; // e.g. "/?share=abc123"
}

export interface PublicCard {
  front: string;
  back: string;
  tags: string[];
  hint: string | null;
  image_url: string | null;
}

/** Read-only deck preview fetched via a share token (no auth). */
export interface PublicDeck {
  title: string;
  description: string | null;
  color: string;
  icon: string;
  card_count: number;
  cards: PublicCard[];
}

// ----------------------------- Study -----------------------------
export interface StudyStart {
  session_id: number;
  deck_id: number;
  mode: string;
  srs: boolean;
  total_cards: number;
  // Smart-review plan shape (0/0 for regular sessions):
  plan_reviews: number;
  plan_new: number;
  note: string | null; // why the plan was trimmed (daily limit / session cap)
}

export interface StudyNext {
  session_id: number;
  card: Card | null;
  reviewed: number;
  total: number;
  finished: boolean;
}

export interface ReviewOut {
  card_id: number;
  result: ReviewResult;
  reviewed: number;
  total: number;
  finished: boolean;
}

/** Response for POST /study/typed — server-side graded free-recall answer.
 * `almost` marks a 1-character-off answer (advisory; result is still "wrong"
 * — the client may offer an "I was right" override via /study/review). */
export interface TypedAnswerOut {
  card_id: number;
  correct: boolean;
  almost: boolean;
  correct_answer: string;
  selected_answer: string;
  reviewed: number;
  total: number;
  finished: boolean;
}

// ----------------------------- Quiz -----------------------------
/** `direction` query param for quiz start: "deck" defers to the deck's preset. */
export type QuizDirection = "front" | "back" | "deck";

export interface QuizQuestion {
  card_id: number;
  front: string;
  options: string[];
  hint: string | null;
  image_url: string | null;
}

export interface QuizStart {
  session_id: number;
  deck_id: number;
  mode: string;
  total_questions: number;
  direction: "front" | "back"; // which card side the question shows
  timed_seconds: number | null; // whole-quiz time budget (null = untimed)
  questions: QuizQuestion[];
}

export interface QuizAnswerOut {
  correct: boolean;
  correct_answer: string;
  selected_answer: string;
  answered: number;
  total: number;
  finished: boolean;
}

export interface QuizResultItem {
  card_id: number;
  front: string;
  correct_answer: string;
  selected_answer: string | null;
  result: ReviewResult;
}

export interface QuizResult {
  session_id: number;
  deck_id: number;
  total: number;
  answered: number;
  correct: number;
  wrong: number;
  accuracy: number;
  duration_seconds: number;
  time_limit_seconds: number | null; // budget the quiz was started with (null = untimed)
  finished_at: string | null;
  details: QuizResultItem[];
}

// ----------------------------- Stats -----------------------------
export interface ActivityDay {
  date: string;
  reviews: number;
  correct: number;
}

export interface StatsOverview {
  total_decks: number;
  total_cards: number;
  total_sessions: number;
  total_reviews: number;
  correct_reviews: number;
  accuracy: number | null;
  streak_days: number;
  longest_streak_days: number; // best streak ever (0 when there are no reviews)
  mastered_cards: number;
  due_cards: number;
  today_reviews: number; // reviews completed today (UTC) — goal ring progress
  daily_goal: number; // user's configured daily review goal
  activity: ActivityDay[]; // ascending, window = `days` query param (7 default)
}

export interface DeckSessionOut {
  id: number;
  mode: string;
  started_at: string;
  finished_at: string | null;
  reviews: number;
  accuracy: number | null;
}

export interface DeckStats {
  deck_id: number;
  title: string;
  total_cards: number;
  total_reviews: number;
  correct_reviews: number;
  accuracy: number | null;
  sessions_count: number;
  weak_cards_count: number;
  last_studied_at: string | null;
  recent_sessions: DeckSessionOut[];
}

export interface WeakCard {
  card_id: number;
  deck_id: number;
  deck_title: string;
  front: string;
  back: string;
  times_reviewed: number;
  times_wrong: number;
  accuracy: number;
}
