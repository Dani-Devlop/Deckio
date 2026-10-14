/** Shared TypeScript types mirroring the FastAPI Pydantic schemas (see backend/app/schemas.py). */

export type ReviewResult = "correct" | "wrong";

// ----------------------------- Auth -----------------------------
export interface User {
  id: number;
  email: string;
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
}

export interface DeckInput {
  title: string;
  description?: string | null;
  color?: string;
  icon?: string;
}

// ----------------------------- Cards -----------------------------
export interface Card {
  id: number;
  deck_id: number;
  front: string;
  back: string;
  tags: string[];
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
  card_count: number;
  cards: { front: string; back: string; tags: string[] }[];
}

// ----------------------------- Study -----------------------------
export interface StudyStart {
  session_id: number;
  deck_id: number;
  mode: string;
  srs: boolean;
  total_cards: number;
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

// ----------------------------- Quiz -----------------------------
export interface QuizQuestion {
  card_id: number;
  front: string;
  options: string[];
}

export interface QuizStart {
  session_id: number;
  deck_id: number;
  mode: string;
  total_questions: number;
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
  mastered_cards: number;
  due_cards: number;
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
