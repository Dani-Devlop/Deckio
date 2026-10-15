/** In-browser demo backend — lets the FULL Deckio UI run on GitHub Pages.
 *
 * The real app talks to a FastAPI server; that is impossible on static
 * hosting. This module implements a faithful client-side mirror of the API:
 * same routes, same JSON shapes (src/lib/types.ts), same SM-2 scheduling
 * (backend/app/utils/srs.py), same typed-answer grading and CSV round-trips —
 * but the "database" is a seeded JSON document in localStorage.
 *
 * Activation (src/lib/api.ts routes every request here when true):
 *   - build time: NEXT_PUBLIC_DEMO_MODE=1 (the `bun run build:demo` script /
 *     .github/workflows/pages.yml GitHub Pages deploy)
 *   - dev time:   open the app with `?demo=1` in the URL
 *
 * The demo auto-signs-in as a seeded user with four decks and ~35 days of
 * review history so every surface (dashboard due counts, stats heatmap,
 * streaks, weak cards) is alive on first visit. Everything the visitor does —
 * creating decks, studying, quizzes, CSV imports — persists locally in their
 * browser and never leaves it.
 */

// ---------------------------------------------------------------------------
// Mode switch + error type (api.ts converts these into ApiError)
// ---------------------------------------------------------------------------

/** True when the app should run fully client-side (GitHub Pages demo). */
export function isDemoMode(): boolean {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "1") return true;
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).has("demo");
  } catch {
    return false;
  }
}

/** Mirrors FastAPI's HTTPException — api.ts maps it onto its own ApiError. */
export class DemoApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Database model (localStorage document)
// ---------------------------------------------------------------------------

interface DemoUser {
  id: number;
  email: string;
  daily_goal: number;
  created_at: string;
}

interface DemoDeck {
  id: number;
  title: string;
  description: string | null;
  color: string;
  icon: string;
  created_at: string;
  new_per_day: number;
  max_reviews: number;
  quiz_questions: number;
  quiz_answer_side: "front" | "back";
  share_token: string | null;
}

interface DemoCard {
  id: number;
  deck_id: number;
  front: string;
  back: string;
  tags: string[];
  hint: string | null;
  image_url: string | null;
  created_at: string;
  ease: number;
  interval_days: number;
  reps: number;
  lapses: number;
  due_at: string | null;
}

interface DemoSession {
  id: number;
  deck_id: number;
  mode: "study" | "quiz";
  srs: boolean;
  started_at: string;
  finished_at: string | null;
  total_planned: number;
  /** Ordered card ids for study sessions. */
  plan: number[];
  /** Quiz snapshot — question side text + graded answer, kept out of API output. */
  questions: { card_id: number; front: string; options: string[]; answer: string }[];
  direction: "front" | "back";
  time_limit_seconds: number | null;
  plan_note: string | null;
  plan_reviews: number;
  plan_new: number;
}

interface DemoReview {
  id: number;
  session_id: number;
  card_id: number;
  result: "correct" | "wrong";
  selected_answer: string | null;
  reviewed_at: string;
}

interface DemoDB {
  version: number;
  user: DemoUser;
  decks: DemoDeck[];
  cards: DemoCard[];
  sessions: DemoSession[];
  reviews: DemoReview[];
  seq: { deck: number; card: number; session: number; review: number };
}

const DB_KEY = "deckio_demo_db_v1";
const DB_VERSION = 1;
export const DEMO_TOKEN = "demo-session-token";

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

let cache: DemoDB | null = null;

function loadDb(): DemoDB {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(DB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DemoDB;
      if (parsed.version === DB_VERSION) {
        cache = parsed;
        return cache;
      }
    }
  } catch {
    /* corrupt document — reseed below */
  }
  cache = buildSeed();
  saveDb();
  return cache;
}

function saveDb(): void {
  if (!cache) return;
  try {
    window.localStorage.setItem(DB_KEY, JSON.stringify(cache));
  } catch {
    /* storage full / private mode — demo keeps working in memory */
  }
}

function resetDb(): void {
  cache = buildSeed();
  saveDb();
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function todayKey(): string {
  return dayKey(nowIso());
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Deterministic PRNG so the seeded history looks the same on every visit. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], rnd: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function pick<T>(items: T[], rnd: () => number): T {
  return items[Math.floor(rnd() * items.length)];
}

function randomToken(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// SM-2 scheduling — ported 1:1 from backend/app/utils/srs.py
// ---------------------------------------------------------------------------

const EASE_MAX = 3.0;
const EASE_MIN = 1.3;
const EASE_DELTA = 0.1;
const RELEARN_MINUTES = 10;

function applySm2(card: DemoCard, correct: boolean, at: Date = new Date()): void {
  if (correct) {
    if (card.reps === 0) card.interval_days = 1;
    else if (card.reps === 1) card.interval_days = 3;
    else card.interval_days = Math.max(1, Math.round(card.interval_days * card.ease));
    card.reps += 1;
    card.ease = Math.min(EASE_MAX, card.ease + EASE_DELTA);
    card.due_at = addDays(at, card.interval_days).toISOString();
  } else {
    card.lapses += 1;
    card.reps = 0;
    card.interval_days = 0;
    card.ease = Math.max(EASE_MIN, card.ease - EASE_DELTA);
    card.due_at = new Date(at.getTime() + RELEARN_MINUTES * 60_000).toISOString();
  }
}

// ---------------------------------------------------------------------------
// Typed-answer grading — ported from backend/app/routers/study.py
// ---------------------------------------------------------------------------

const ANSWER_PUNCT = ".,!?;:…\"'“”«»()[]{}~*_-—–";

function normalizeAnswer(s: string): string {
  const folded = s.normalize("NFKC").toLowerCase();
  const collapsed = folded.split(/\s+/).join(" ").trim();
  // Strip leading/trailing punctuation (accented letters stay significant).
  let start = 0;
  let end = collapsed.length;
  while (start < end && ANSWER_PUNCT.includes(collapsed[start])) start++;
  while (end > start && ANSWER_PUNCT.includes(collapsed[end - 1])) end--;
  return collapsed.slice(start, end);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// ---------------------------------------------------------------------------
// CSV — quote-aware parsing (bulk import) + writers (exports)
// ---------------------------------------------------------------------------

function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 5).join("\n");
  const counts: Array<[string, number]> = [
    [",", (sample.match(/,/g) ?? []).length],
    [";", (sample.match(/;/g) ?? []).length],
    ["\t", (sample.match(/\t/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

/** Quote-aware single-line splitter (RFC-4180 style: "" escapes a quote). */
function splitCsvLine(line: string, delim: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

function parseCsvRows(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line, idx, all) => line.length > 0 || idx === all.length - 1)
    .filter((line) => line.trim().length > 0)
    .map((line) => splitCsvLine(line, detectDelimiter(text)));
}

function csvField(value: string | number | null): string {
  const s = value == null ? "" : String(value);
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(header: string[], rows: Array<Array<string | number | null>>): string {
  const lines = [header.map(csvField).join(",")];
  for (const row of rows) lines.push(row.map(csvField).join(","));
  return "\ufeff" + lines.join("\n") + "\n";
}

const FRONT_HEADERS = ["front", "question", "term", "word"];
const BACK_HEADERS = ["back", "answer", "definition", "translation"];
const TAG_HEADERS = ["tags", "tag"];
const HINT_HEADERS = ["hint"];
const IMAGE_HEADERS = ["image", "image_url", "picture"];

function importCsv(db: DemoDB, deckId: number, text: string): {
  imported: number;
  skipped: number;
  errors: string[];
} {
  const errors: string[] = [];
  const now = nowIso();
  const rows = parseCsvRows(text);
  if (rows.length === 0) return { imported: 0, skipped: 0, errors: ["The file is empty"] };

  // Header detection: the first row maps columns by name when it looks like one.
  let map: { front: number; back: number; tags: number; hint: number; image: number } = {
    front: 0,
    back: 1,
    tags: 2,
    hint: 3,
    image: 4,
  };
  const first = rows[0].map((c) => c.trim().toLowerCase());
  const looksLikeHeader =
    first.some((c) => FRONT_HEADERS.includes(c)) && first.some((c) => BACK_HEADERS.includes(c));
  let startRow = 0;
  if (looksLikeHeader) {
    const find = (names: string[]) => first.findIndex((c) => names.includes(c));
    map = {
      front: find(FRONT_HEADERS),
      back: find(BACK_HEADERS),
      tags: find(TAG_HEADERS),
      hint: find(HINT_HEADERS),
      image: find(IMAGE_HEADERS),
    };
    startRow = 1;
  }

  const seen = new Set<string>();
  let imported = 0;
  let skipped = 0;
  const maxRows = Math.min(rows.length, 1001);
  for (let r = startRow; r < maxRows; r++) {
    const cells = rows[r];
    const front = (cells[map.front] ?? "").trim();
    const back = (cells[map.back] ?? "").trim();
    if (!front || !back) {
      if (front || back) errors.push(`Row ${r + 1}: both a front and a back are required`);
      continue;
    }
    const key = `${front}\u0000${back}`;
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    const tags = (cells[map.tags] ?? "")
      .split("|")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 8);
    const hint = (cells[map.hint] ?? "").trim() || null;
    const image = (cells[map.image] ?? "").trim() || null;
    db.cards.push({
      id: db.seq.card++,
      deck_id: deckId,
      front: front.slice(0, 500),
      back: back.slice(0, 500),
      tags,
      hint: hint ? hint.slice(0, 300) : null,
      image_url: image ? image.slice(0, 500) : null,
      created_at: now,
      ease: 2.5,
      interval_days: 0,
      reps: 0,
      lapses: 0,
      due_at: null,
    });
    imported++;
  }
  return { imported, skipped, errors };
}

// ---------------------------------------------------------------------------
// Seed — demo user, four decks, 35 days of plausible history
// ---------------------------------------------------------------------------

const CELL_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 120'><rect width='200' height='120' rx='10' fill='%23f5f3ff'/><ellipse cx='100' cy='60' rx='70' ry='46' fill='%23ddd6fe' stroke='%237c3aed' stroke-width='2.5'/><circle cx='100' cy='60' r='18' fill='%237c3aed'/><circle cx='100' cy='60' r='7' fill='%23ede9fe'/><circle cx='62' cy='44' r='9' fill='%23a78bfa'/><circle cx='138' cy='52' r='11' fill='%23a78bfa'/><circle cx='130' cy='84' r='8' fill='%23a78bfa'/><circle cx='70' cy='80' r='7' fill='%23a78bfa'/></svg>`
  );

function buildSeed(): DemoDB {
  const rnd = mulberry32(0xdec10);
  const now = new Date();
  const daysAgoIso = (days: number, hour = 12) => {
    const d = addDays(now, -days);
    d.setUTCHours(hour, Math.floor(rnd() * 60), 0, 0);
    return d.toISOString();
  };

  const db: DemoDB = {
    version: DB_VERSION,
    user: {
      id: 1,
      email: "demo@deckio.app",
      daily_goal: 20,
      created_at: daysAgoIso(40, 9),
    },
    decks: [],
    cards: [],
    sessions: [],
    reviews: [],
    seq: { deck: 1, card: 1, session: 1, review: 1 },
  };

  const deckDefs: Array<{
    title: string;
    description: string;
    color: string;
    icon: string;
    cards: Array<[string, string, string[], string?, string?]>;
  }> = [
    {
      title: "Spanish Essentials",
      description: "Everyday vocabulary — greetings, food, travel.",
      color: "#f59e0b",
      icon: "🇪🇸",
      cards: [
        ["hola", "hello", ["basics", "greetings"], "The very first word everyone learns"],
        ["gracias", "thank you", ["basics", "courtesy"], null, null],
        ["por favor", "please", ["courtesy"], "Literally “for favor”"],
        ["la biblioteca", "the library", ["places"], "Think: bibliography → books"],
        ["el desayuno", "breakfast", ["food"], "des- + ayunar (to fast) → breaking the fast"],
        ["la manzana", "the apple", ["food"], null, null],
        ["¿cuánto cuesta?", "how much does it cost?", ["travel", "questions"], null, null],
        ["la estación", "the station / the season", ["travel"], "Context decides the meaning"],
        ["mañana", "tomorrow / morning", ["basics", "time"], "Two meanings — context again!"],
        ["el aguacate", "the avocado", ["food"], null, null],
        ["tener sueños", "to be sleepy", ["phrases"], "sueños = dreams — sleepy “dreams”"],
        ["la llave", "the key", ["travel", "objects"], null, null],
        ["apurar", "to hurry / to finish off", ["verbs"], null, null],
        ["¡salud!", "cheers! / bless you", ["phrases"], "Also said after a sneeze"],
      ],
    },
    {
      title: "World Capitals",
      description: "Geography pop quiz fuel — 10 capitals to start.",
      color: "#10b981",
      icon: "🌍",
      cards: [
        ["Australia", "Canberra", ["oceania"], "Not Sydney! Purpose-built capital"],
        ["Canada", "Ottawa", ["americas"], "Not Toronto — it sits on the Ontario/Québec border"],
        ["Brazil", "Brasília", ["americas"], "Modernist planned city, inaugurated 1960"],
        ["Turkey", "Ankara", ["asia", "europe"], "Not Istanbul"],
        ["New Zealand", "Wellington", ["oceania"], "At the south end of the North Island"],
        ["Morocco", "Rabat", ["africa"], "Casablanca is the biggest city, not the capital"],
        ["Switzerland", "Bern", ["europe"], "de facto capital — “federal city”"],
        ["Kazakhstan", "Astana", ["asia"], "Renamed back from Nur-Sultan in 2022"],
        ["Nigeria", "Abuja", ["africa"], "Planned capital, replaced Lagos in 1991"],
        ["Bolivia", "Sucre", ["americas"], "Constitutional capital; La Paz is the seat of government"],
      ],
    },
    {
      title: "Cell Biology",
      description: "Organelles, processes and the vocabulary of life.",
      color: "#8b5cf6",
      icon: "🧬",
      cards: [
        ["Mitochondrion", "Produces ATP through cellular respiration", ["organelles"], "“Powerhouse of the cell”", CELL_SVG],
        ["Ribosome", "Synthesizes proteins from mRNA", ["organelles"], null, null],
        ["Nucleus", "Stores DNA and coordinates gene expression", ["organelles"], null, null],
        ["Golgi apparatus", "Modifies, sorts and packages proteins for secretion", ["organelles"], "The cell's post office"],
        ["Lysosome", "Digests waste and worn-out organelles", ["organelles"], null, null],
        ["Osmosis", "Diffusion of water across a semi-permeable membrane", ["processes"], null, null],
        ["Mitosis", "Cell division producing two identical diploid cells", ["processes"], null, null],
        ["Meiosis", "Cell division producing four haploid gametes", ["processes"], "Crossing over happens here"],
        ["Chloroplast", "Site of photosynthesis in plant cells", ["organelles", "plants"], null, null],
        ["Apoptosis", "Programmed cell death", ["processes"], "From Greek “falling off”"],
      ],
    },
    {
      title: "JavaScript Fundamentals",
      description: "Interview-ready recall of the core language.",
      color: "#0ea5e9",
      icon: "💻",
      cards: [
        ["What does `===` check?", "Strict equality — value AND type, no coercion", ["operators"], null, null],
        ["What is a closure?", "A function that remembers the scope where it was created", ["functions"], null, null],
        ["What does `Array.prototype.map` return?", "A new array with each element transformed by the callback", ["arrays"], null, null],
        ["What is hoisting?", "Declarations are moved to the top of their scope before execution", ["fundamentals"], "var, function — not let/const values"],
        ["What does `Promise.all` do?", "Resolves when every promise resolves; rejects on the first rejection", ["async"], null, null],
        ["What is the event loop?", "The mechanism that pulls callbacks from queues onto the call stack when it empties", ["async"], null, null],
        ["What does `Object.freeze` do?", "Makes an object immutable — no adds, deletes or writes", ["objects"], "Shallow only!"],
        ["What is a Set?", "A collection of unique values — no duplicates", ["collections"], null, null],
        ["What does `??` (nullish coalescing) do?", "Returns the right operand only when the left is null or undefined", ["operators"], "Unlike ||, 0 and \"\" pass through"],
        ["What is destructuring?", "Unpacking values from arrays or objects into distinct variables", ["fundamentals"], null, null],
      ],
    },
  ];

  const deckIds: number[] = [];
  for (const def of deckDefs) {
    const id = db.seq.deck++;
    deckIds.push(id);
    db.decks.push({
      id,
      title: def.title,
      description: def.description,
      color: def.color,
      icon: def.icon,
      created_at: daysAgoIso(38, 10),
      new_per_day: 20,
      max_reviews: 200,
      quiz_questions: 10,
      quiz_answer_side: "front",
      share_token: id === 1 ? "a1b2c3d4e5f60718293a4b5c" : null,
    });
    for (const [front, back, tags, hint, image] of def.cards) {
      db.cards.push({
        id: db.seq.card++,
        deck_id: id,
        front,
        back,
        tags,
        hint: hint ?? null,
        image_url: image ?? null,
        created_at: daysAgoIso(37, 11),
        ease: 2.5,
        interval_days: 0,
        reps: 0,
        lapses: 0,
        due_at: null,
      });
    }
  }

  // ~35 days of history: study sessions most days, quizzes now and then.
  for (let day = 35; day >= 1; day--) {
    if (rnd() > 0.72) continue; // rest days — the streak has gaps, like real life
    const mode: "study" | "quiz" = rnd() < 0.72 ? "study" : "quiz";
    const started = daysAgoIso(day, 7 + Math.floor(rnd() * 14));
    const deckId = pick(deckIds.slice(0, 3), rnd); // deck 4 added later, less history
    const session: DemoSession = {
      id: db.seq.session++,
      deck_id: deckId,
      mode,
      srs: mode === "study" && rnd() < 0.55,
      started_at: started,
      finished_at: null,
      total_planned: 0,
      plan: [],
      questions: [],
      direction: "front",
      time_limit_seconds: mode === "quiz" && rnd() < 0.4 ? pick([60, 120, 300], rnd) : null,
      plan_note: null,
      plan_reviews: 0,
      plan_new: 0,
    };
    const deckCards = db.cards.filter((c) => c.deck_id === deckId);
    const n = 6 + Math.floor(rnd() * 9);
    const finished = new Date(new Date(started).getTime() + (2 + rnd() * 6) * 60_000);
    session.finished_at = finished.toISOString();
    session.total_planned = n;

    for (let i = 0; i < n; i++) {
      const card = pick(deckCards, rnd);
      const correct = rnd() < 0.8;
      let selected: string | null = null;
      if (mode === "quiz") {
        const others = deckCards.filter((c) => c.id !== card.id);
        selected = correct ? card.back : pick(others, rnd).back;
      }
      db.reviews.push({
        id: db.seq.review++,
        session_id: session.id,
        card_id: card.id,
        result: correct ? "correct" : "wrong",
        selected_answer: selected,
        reviewed_at: started,
      });
      // Study-mode reviews drive SM-2 (quiz answers are practice-only).
      if (mode === "study") applySm2(card, correct, new Date(started));
    }
    db.sessions.push(session);
  }

  // A short session today keeps the streak + daily-goal ring alive.
  const todayStart = new Date(now);
  todayStart.setUTCHours(Math.max(1, now.getUTCHours() - 2), 12, 0, 0);
  const todaySession: DemoSession = {
    id: db.seq.session++,
    deck_id: deckIds[0],
    mode: "study",
    srs: true,
    started_at: todayStart.toISOString(),
    finished_at: new Date(todayStart.getTime() + 4 * 60_000).toISOString(),
    total_planned: 5,
    plan: [],
    questions: [],
    direction: "front",
    time_limit_seconds: null,
    plan_note: null,
    plan_reviews: 5,
    plan_new: 1,
  };
  const spanishCards = db.cards.filter((c) => c.deck_id === deckIds[0]);
  for (let i = 0; i < 5; i++) {
    const card = spanishCards[(i * 3) % spanishCards.length];
    const correct = i !== 2;
    db.reviews.push({
      id: db.seq.review++,
      session_id: todaySession.id,
      card_id: card.id,
      result: correct ? "correct" : "wrong",
      selected_answer: null,
      reviewed_at: todayStart.toISOString(),
    });
    applySm2(card, correct, todayStart);
  }
  db.sessions.push(todaySession);

  return db;
}

// ---------------------------------------------------------------------------
// Serializers (JSON shapes = src/lib/types.ts)
// ---------------------------------------------------------------------------

function isDue(card: DemoCard): boolean {
  return card.due_at === null || new Date(card.due_at) <= new Date();
}

function cardOut(c: DemoCard) {
  return {
    id: c.id,
    deck_id: c.deck_id,
    front: c.front,
    back: c.back,
    tags: [...c.tags],
    hint: c.hint,
    image_url: c.image_url,
    created_at: c.created_at,
    ease: c.ease,
    interval_days: c.interval_days,
    reps: c.reps,
    lapses: c.lapses,
    due_at: c.due_at,
  };
}

function deckStats(db: DemoDB, deckId: number) {
  const cardIds = new Set(db.cards.filter((c) => c.deck_id === deckId).map((c) => c.id));
  const reviews = db.reviews.filter((r) => cardIds.has(r.card_id));
  const sessions = db.sessions.filter((s) => s.deck_id === deckId);
  const lastStudied = sessions.reduce<string | null>(
    (acc, s) => (acc == null || s.started_at > acc ? s.started_at : acc),
    null
  );
  const accuracy =
    reviews.length > 0 ? round1((reviews.filter((r) => r.result === "correct").length / reviews.length) * 100) : null;
  return {
    card_count: cardIds.size,
    reviews_count: reviews.length,
    accuracy,
    last_studied_at: lastStudied,
    due_count: db.cards.filter((c) => c.deck_id === deckId && isDue(c)).length,
  };
}

function deckOut(db: DemoDB, d: DemoDeck) {
  return {
    id: d.id,
    title: d.title,
    description: d.description,
    color: d.color,
    icon: d.icon,
    created_at: d.created_at,
    ...deckStats(db, d.id),
    new_per_day: d.new_per_day,
    max_reviews: d.max_reviews,
    quiz_questions: d.quiz_questions,
    quiz_answer_side: d.quiz_answer_side,
    share_token: d.share_token,
  };
}

function requireDeck(db: DemoDB, id: number): DemoDeck {
  const deck = db.decks.find((d) => d.id === id);
  if (!deck) throw new DemoApiError(404, "Deck not found");
  return deck;
}

function requireSession(db: DemoDB, id: number, mode?: "study" | "quiz"): DemoSession {
  const session = db.sessions.find((s) => s.id === id);
  if (!session) throw new DemoApiError(404, "Session not found");
  if (mode && session.mode !== mode)
    throw new DemoApiError(400, `This session is not a ${mode} session`);
  return session;
}

function sessionProgress(db: DemoDB, session: DemoSession) {
  const reviews = db.reviews.filter((r) => r.session_id === session.id);
  const total = session.mode === "quiz" ? session.questions.length : session.plan.length;
  return {
    reviews,
    reviewed: reviews.length,
    total,
    finished: reviews.length >= total,
  };
}

function upsertReview(
  db: DemoDB,
  session: DemoSession,
  cardId: number,
  result: "correct" | "wrong",
  selected: string | null
): void {
  const existing = db.reviews.find((r) => r.session_id === session.id && r.card_id === cardId);
  if (existing) {
    existing.result = result;
    existing.selected_answer = selected;
    existing.reviewed_at = nowIso();
  } else {
    db.reviews.push({
      id: db.seq.review++,
      session_id: session.id,
      card_id: cardId,
      result,
      selected_answer: selected,
      reviewed_at: nowIso(),
    });
  }
}

/** Streak ending today (with yesterday-grace), like stats.py. */
function currentStreak(dates: Set<string>): number {
  if (dates.size === 0) return 0;
  const cursor = new Date();
  if (!dates.has(dayKey(cursor.toISOString()))) cursor.setTime(addDays(cursor, -1).getTime());
  let streak = 0;
  while (dates.has(dayKey(cursor.toISOString()))) {
    streak++;
    cursor.setTime(addDays(cursor, -1).getTime());
  }
  return streak;
}

function longestStreak(dates: Set<string>): number {
  const sorted = [...dates].sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const day of sorted) {
    const consecutive =
      prev !== null && (new Date(day).getTime() - new Date(prev).getTime()) === 86_400_000;
    run = consecutive ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = day;
  }
  return longest;
}

const MASTERED_MIN_REVIEWS = 3;
const MASTERED_MIN_ACCURACY = 0.8;

// ---------------------------------------------------------------------------
// Request router
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function sanitizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const tag = asString(raw).trim().slice(0, 32);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 8) break;
  }
  return out;
}

function validateCardText(front: string, back: string): void {
  if (!front.trim()) throw new DemoApiError(422, "The question (front) cannot be empty");
  if (!back.trim()) throw new DemoApiError(422, "The answer (back) cannot be empty");
}

/** Route one API call against the in-browser database. */
export async function demoRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  raw?: { raw?: BodyInit; contentType?: string }
): Promise<T> {
  const db = loadDb();
  const [pathname, search] = path.split("?");
  const q = new URLSearchParams(search ?? "");
  const parts = pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const seg = (i: number) => parts[i] ?? "";
  const idAt = (i: number) => {
    const n = Number(parts[i]);
    if (!Number.isInteger(n)) throw new DemoApiError(404, "Not found");
    return n;
  };
  const m = method.toUpperCase();
  let payload: Json = {};
  if (body && typeof body === "object") payload = body as Json;

  // Raw bodies: CSV text or a FormData file upload (bulk import).
  let rawText: string | null = null;
  if (raw?.raw != null) {
    if (typeof raw.raw === "string") rawText = raw.raw;
    else if (typeof FormData !== "undefined" && raw.raw instanceof FormData) {
      const file = raw.raw.get("file");
      if (file instanceof Blob) rawText = await file.text();
    }
  }

  // ------------------------------ Auth ------------------------------
  if (seg(0) === "auth") {
    if (m === "POST" && seg(1) === "register") {
      const email = asString(payload.email).trim().toLowerCase() || "demo@deckio.app";
      db.user.email = email;
      saveDb();
      return { access_token: DEMO_TOKEN, token_type: "bearer", user: { ...db.user } } as T;
    }
    if (m === "POST" && seg(1) === "login") {
      const email = asString(payload.email).trim().toLowerCase();
      if (email) db.user.email = email;
      saveDb();
      return { access_token: DEMO_TOKEN, token_type: "bearer", user: { ...db.user } } as T;
    }
    if (m === "GET" && seg(1) === "me") return { ...db.user } as T;
    if (m === "PUT" && seg(1) === "password") return undefined as T;
    if (m === "POST" && seg(1) === "account" && seg(2) === "delete") {
      cache = null;
      try {
        window.localStorage.removeItem(DB_KEY);
      } catch {
        /* ignore */
      }
      return undefined as T;
    }
    if (m === "PUT" && seg(1) === "goal") {
      db.user.daily_goal = clamp(Math.round(asNumber(payload.daily_goal, db.user.daily_goal)), 1, 500);
      saveDb();
      return { ...db.user } as T;
    }
  }

  // ------------------------------ Decks ------------------------------
  if (seg(0) === "decks" && parts.length === 1) {
    if (m === "GET") return db.decks.map((d) => deckOut(db, d)) as T;
    if (m === "POST") {
      const title = asString(payload.title).trim();
      if (!title) throw new DemoApiError(422, "Title is required");
      const deck: DemoDeck = {
        id: db.seq.deck++,
        title: title.slice(0, 120),
        description: asString(payload.description ?? "").trim() || null,
        color: asString(payload.color ?? "") || "#f59e0b",
        icon: asString(payload.icon ?? "") || "📚",
        created_at: nowIso(),
        new_per_day: clamp(Math.round(asNumber(payload.new_per_day, 20)), 0, 1000),
        max_reviews: clamp(Math.round(asNumber(payload.max_reviews, 200)), 1, 1000),
        quiz_questions: clamp(Math.round(asNumber(payload.quiz_questions, 10)), 5, 50),
        quiz_answer_side: payload.quiz_answer_side === "back" ? "back" : "front",
        share_token: null,
      };
      db.decks.push(deck);
      saveDb();
      return deckOut(db, deck) as T;
    }
  }

  if (seg(0) === "decks" && seg(1) === "import" && m === "POST") {
    const title = asString(payload.title).trim();
    if (!title) throw new DemoApiError(422, "The bundle has no title");
    const deck: DemoDeck = {
      id: db.seq.deck++,
      title: title.slice(0, 120),
      description: asString(payload.description ?? "").trim() || null,
      color: asString(payload.color ?? "") || "#f59e0b",
      icon: asString(payload.icon ?? "") || "📚",
      created_at: nowIso(),
      new_per_day: clamp(Math.round(asNumber(payload.new_per_day, 20)), 0, 1000),
      max_reviews: clamp(Math.round(asNumber(payload.max_reviews, 200)), 1, 1000),
      quiz_questions: clamp(Math.round(asNumber(payload.quiz_questions, 10)), 5, 50),
      quiz_answer_side: payload.quiz_answer_side === "back" ? "back" : "front",
      share_token: null,
    };
    db.decks.push(deck);
    const cards = Array.isArray(payload.cards) ? (payload.cards as Json[]) : [];
    for (const c of cards.slice(0, 1000)) {
      const front = asString(c.front).trim();
      const back = asString(c.back).trim();
      if (!front || !back) continue;
      db.cards.push({
        id: db.seq.card++,
        deck_id: deck.id,
        front: front.slice(0, 500),
        back: back.slice(0, 500),
        tags: sanitizeTags(c.tags),
        hint: asString(c.hint ?? "").trim() || null,
        image_url: asString(c.image_url ?? "").trim() || null,
        created_at: nowIso(),
        ease: 2.5,
        interval_days: 0,
        reps: 0,
        lapses: 0,
        due_at: null,
      });
    }
    saveDb();
    return deckOut(db, deck) as T;
  }

  if (seg(0) === "decks" && idAt(1) && seg(2) === "duplicate" && m === "POST") {
    const src = requireDeck(db, idAt(1));
    const copy: DemoDeck = {
      ...src,
      id: db.seq.deck++,
      title: `${src.title} (copy)`.slice(0, 120),
      created_at: nowIso(),
      share_token: null,
    };
    db.decks.push(copy);
    for (const c of db.cards.filter((c) => c.deck_id === src.id)) {
      db.cards.push({
        ...c,
        id: db.seq.card++,
        deck_id: copy.id,
        created_at: nowIso(),
        ease: 2.5,
        interval_days: 0,
        reps: 0,
        lapses: 0,
        due_at: null, // SRS progress resets on duplication
      });
    }
    saveDb();
    return deckOut(db, copy) as T;
  }

  if (seg(0) === "decks" && idAt(1) && seg(2) === "share") {
    const deck = requireDeck(db, idAt(1));
    if (m === "GET")
      return {
        share_token: deck.share_token,
        share_path: deck.share_token ? `/?share=${deck.share_token}` : null,
      } as T;
    if (m === "POST") {
      if (!deck.share_token || q.get("regenerate") === "true") deck.share_token = randomToken();
      saveDb();
      return {
        share_token: deck.share_token,
        share_path: `/?share=${deck.share_token}`,
      } as T;
    }
    if (m === "DELETE") {
      deck.share_token = null;
      saveDb();
      return undefined as T;
    }
  }

  if (seg(0) === "decks" && idAt(1) && seg(2) === "bundle" && m === "GET") {
    const deck = requireDeck(db, idAt(1));
    const cards = db.cards.filter((c) => c.deck_id === deck.id);
    return {
      version: 1,
      app: "deckio",
      title: deck.title,
      description: deck.description,
      color: deck.color,
      icon: deck.icon,
      new_per_day: deck.new_per_day,
      max_reviews: deck.max_reviews,
      card_count: cards.length,
      cards: cards.map((c) => ({
        front: c.front,
        back: c.back,
        tags: [...c.tags],
        hint: c.hint,
        image_url: c.image_url,
      })),
    } as T;
  }

  if (seg(0) === "decks" && idAt(1) && seg(2) === "cards" && parts.length === 3) {
    const deck = requireDeck(db, idAt(1));
    if (m === "GET") {
      const search = (q.get("q") ?? "").trim().toLowerCase();
      const tag = (q.get("tag") ?? "").trim().toLowerCase();
      let cards = db.cards.filter((c) => c.deck_id === deck.id);
      if (search)
        cards = cards.filter(
          (c) =>
            c.front.toLowerCase().includes(search) ||
            c.back.toLowerCase().includes(search) ||
            c.tags.some((t) => t.toLowerCase().includes(search))
        );
      if (tag) cards = cards.filter((c) => c.tags.some((t) => t.toLowerCase() === tag));
      return cards.map(cardOut) as T;
    }
    if (m === "POST") {
      const front = asString(payload.front).trim();
      const back = asString(payload.back).trim();
      validateCardText(front, back);
      const card: DemoCard = {
        id: db.seq.card++,
        deck_id: deck.id,
        front: front.slice(0, 500),
        back: back.slice(0, 500),
        tags: sanitizeTags(payload.tags),
        hint: asString(payload.hint ?? "").trim() || null,
        image_url: asString(payload.image_url ?? "").trim() || null,
        created_at: nowIso(),
        ease: 2.5,
        interval_days: 0,
        reps: 0,
        lapses: 0,
        due_at: null,
      };
      db.cards.push(card);
      saveDb();
      return cardOut(card) as T;
    }
  }

  if (seg(0) === "decks" && idAt(1) && seg(2) === "cards" && seg(3) === "bulk" && m === "POST") {
    const deck = requireDeck(db, idAt(1));
    if (rawText == null) throw new DemoApiError(400, "Send the CSV as text or a file upload");
    if (rawText.length > 1_000_000) throw new DemoApiError(413, "CSV uploads are capped at 1 MB");
    const result = importCsv(db, deck.id, rawText);
    saveDb();
    return result as T;
  }

  if (seg(0) === "decks" && idAt(1) && seg(2) === "cards" && seg(3) === "export" && m === "GET") {
    const deck = requireDeck(db, idAt(1));
    const cards = db.cards.filter((c) => c.deck_id === deck.id);
    const hasTags = cards.some((c) => c.tags.length > 0);
    const hasHint = cards.some((c) => c.hint);
    const hasImage = cards.some((c) => c.image_url);
    const header = ["front", "back", ...(hasTags ? ["tags"] : []), ...(hasHint ? ["hint"] : []), ...(hasImage ? ["image_url"] : [])];
    const rows = cards.map((c) => [
      c.front,
      c.back,
      ...(hasTags ? [c.tags.join("|")] : []),
      ...(hasHint ? [c.hint ?? ""] : []),
      ...(hasImage ? [c.image_url ?? ""] : []),
    ]);
    return toCsv(header, rows) as unknown as T;
  }

  if (seg(0) === "decks" && idAt(1) && seg(2) === "export" && seg(3) === "reviews.csv" && m === "GET") {
    const deck = requireDeck(db, idAt(1));
    return reviewsCsv(db, deck.id) as unknown as T;
  }

  if (seg(0) === "decks" && idAt(1) && parts.length === 2) {
    const deck = requireDeck(db, idAt(1));
    if (m === "GET") return deckOut(db, deck) as T;
    if (m === "PUT") {
      if (payload.title !== undefined) {
        const title = asString(payload.title).trim();
        if (!title) throw new DemoApiError(422, "Title cannot be empty");
        deck.title = title.slice(0, 120);
      }
      if (payload.description !== undefined)
        deck.description = asString(payload.description ?? "").trim() || null;
      if (payload.color !== undefined && asString(payload.color)) deck.color = asString(payload.color);
      if (payload.icon !== undefined && asString(payload.icon)) deck.icon = asString(payload.icon);
      if (payload.new_per_day !== undefined)
        deck.new_per_day = clamp(Math.round(asNumber(payload.new_per_day, deck.new_per_day)), 0, 1000);
      if (payload.max_reviews !== undefined)
        deck.max_reviews = clamp(Math.round(asNumber(payload.max_reviews, deck.max_reviews)), 1, 1000);
      if (payload.quiz_questions !== undefined)
        deck.quiz_questions = clamp(Math.round(asNumber(payload.quiz_questions, deck.quiz_questions)), 5, 50);
      if (payload.quiz_answer_side !== undefined)
        deck.quiz_answer_side = payload.quiz_answer_side === "back" ? "back" : "front";
      saveDb();
      return deckOut(db, deck) as T;
    }
    if (m === "DELETE") {
      const cardIds = new Set(db.cards.filter((c) => c.deck_id === deck.id).map((c) => c.id));
      db.cards = db.cards.filter((c) => c.deck_id !== deck.id);
      db.reviews = db.reviews.filter((r) => !cardIds.has(r.card_id));
      db.sessions = db.sessions.filter((s) => s.deck_id !== deck.id);
      db.decks = db.decks.filter((d) => d.id !== deck.id);
      saveDb();
      return undefined as T;
    }
  }

  // ------------------------------ Public share ------------------------------
  if (seg(0) === "public" && seg(1) === "decks" && m === "GET") {
    const token = decodeURIComponent(seg(2));
    const deck = db.decks.find((d) => d.share_token === token);
    if (!deck) throw new DemoApiError(404, "This share link is invalid or has been revoked");
    const cards = db.cards.filter((c) => c.deck_id === deck.id);
    return {
      title: deck.title,
      description: deck.description,
      color: deck.color,
      icon: deck.icon,
      card_count: cards.length,
      cards: cards.map((c) => ({
        front: c.front,
        back: c.back,
        tags: [...c.tags],
        hint: c.hint,
        image_url: c.image_url,
      })),
    } as T;
  }

  // ------------------------------ Cards (by id) ------------------------------
  if (seg(0) === "cards" && idAt(1) && parts.length === 2) {
    const card = db.cards.find((c) => c.id === idAt(1));
    if (!card) throw new DemoApiError(404, "Card not found");
    requireDeck(db, card.deck_id); // ownership
    if (m === "PUT") {
      if (payload.front !== undefined) {
        const front = asString(payload.front).trim();
        if (!front) throw new DemoApiError(422, "The question (front) cannot be empty");
        card.front = front.slice(0, 500);
      }
      if (payload.back !== undefined) {
        const back = asString(payload.back).trim();
        if (!back) throw new DemoApiError(422, "The answer (back) cannot be empty");
        card.back = back.slice(0, 500);
      }
      if (payload.tags !== undefined) card.tags = sanitizeTags(payload.tags);
      if (payload.hint !== undefined)
        card.hint = asString(payload.hint ?? "").trim() || null;
      if (payload.image_url !== undefined)
        card.image_url = asString(payload.image_url ?? "").trim() || null;
      saveDb();
      return cardOut(card) as T;
    }
    if (m === "DELETE") {
      db.cards = db.cards.filter((c) => c.id !== card.id);
      db.reviews = db.reviews.filter((r) => r.card_id !== card.id);
      saveDb();
      return undefined as T;
    }
  }

  // ------------------------------ Study ------------------------------
  if (seg(0) === "decks" && idAt(1) && seg(2) === "study" && seg(3) === "start" && m === "POST") {
    const deck = requireDeck(db, idAt(1));
    const srs = q.get("srs") === "true";
    const cards = db.cards.filter((c) => c.deck_id === deck.id);
    if (cards.length === 0)
      throw new DemoApiError(400, "This deck has no cards yet — add some first");

    let plan: number[] = [];
    let note: string | null = null;
    let planReviews = 0;
    let planNew = 0;

    if (srs) {
      const due = cards.filter((c) => c.due_at !== null && new Date(c.due_at) <= new Date());
      const fresh = cards.filter((c) => c.due_at === null);
      const newToday = db.reviews.filter((r) => {
        if (dayKey(r.reviewed_at) !== todayKey()) return false;
        const card = db.cards.find((c) => c.id === r.card_id);
        return card != null && card.due_at === null;
      }).length;
      const newBudget = Math.max(0, deck.new_per_day - newToday);
      const ordered = [
        ...due.sort((a, b) => (a.due_at! < b.due_at! ? -1 : 1)).map((c) => c.id),
        ...fresh.slice(0, newBudget).map((c) => c.id),
      ];
      plan = ordered;
      if (ordered.length === 0)
        throw new DemoApiError(400, "All caught up — nothing is due right now ✨");
      if (deck.max_reviews < plan.length) {
        plan = plan.slice(0, deck.max_reviews);
        note = `Session capped at ${deck.max_reviews} reviews (deck preset)`;
      }
      if (fresh.length > newBudget && plan.includes(fresh[0]?.id ?? -1)) {
        note = `Daily new-card limit — ${fresh.length - newBudget} new cards deferred to tomorrow`;
      }
      planReviews = due.filter((c) => plan.includes(c.id)).length;
      planNew = plan.length - planReviews;
    } else {
      plan = shuffled(cards).map((c) => c.id);
    }

    const session: DemoSession = {
      id: db.seq.session++,
      deck_id: deck.id,
      mode: "study",
      srs,
      started_at: nowIso(),
      finished_at: null,
      total_planned: plan.length,
      plan,
      questions: [],
      direction: "front",
      time_limit_seconds: null,
      plan_note: note,
      plan_reviews: planReviews,
      plan_new: planNew,
    };
    db.sessions.push(session);
    saveDb();
    return {
      session_id: session.id,
      deck_id: deck.id,
      mode: "study",
      srs,
      total_cards: plan.length,
      plan_reviews: planReviews,
      plan_new: planNew,
      note,
    } as T;
  }

  if (seg(0) === "decks" && idAt(1) && seg(2) === "study" && seg(3) === "next" && m === "GET") {
    const deck = requireDeck(db, idAt(1));
    const sessionId = Number(q.get("session_id"));
    const session = db.sessions.find((s) => s.id === sessionId && s.deck_id === deck.id);
    if (!session || session.mode !== "study") throw new DemoApiError(404, "Session not found");
    const { reviewed, total, finished } = sessionProgress(db, session);
    // Next card = first card in the plan without a review row in this session.
    const nextId = session.plan.find(
      (cid) => !db.reviews.some((r) => r.session_id === session.id && r.card_id === cid)
    );
    const card = finished ? null : db.cards.find((c) => c.id === nextId) ?? null;
    return {
      session_id: session.id,
      card: card ? cardOut(card) : null,
      reviewed,
      total,
      finished,
    } as T;
  }

  if (seg(0) === "study" && seg(1) === "review" && m === "POST") {
    const session = requireSession(db, asNumber(payload.session_id, 0), "study");
    const card = db.cards.find((c) => c.id === asNumber(payload.card_id, 0));
    if (!card || card.deck_id !== session.deck_id)
      throw new DemoApiError(400, "Card does not belong to this session's deck");
    const result = payload.result === "correct" ? "correct" : "wrong";
    upsertReview(db, session, card.id, result, null);
    // Study-mode reviews drive SM-2 (regular and smart alike).
    applySm2(card, result === "correct");
    saveDb();
    const { reviewed, total, finished } = sessionProgress(db, session);
    return { card_id: card.id, result, reviewed, total, finished } as T;
  }

  if (seg(0) === "study" && seg(1) === "typed" && m === "POST") {
    const session = requireSession(db, asNumber(payload.session_id, 0), "study");
    const card = db.cards.find((c) => c.id === asNumber(payload.card_id, 0));
    if (!card || card.deck_id !== session.deck_id)
      throw new DemoApiError(400, "Card does not belong to this session's deck");
    const answer = asString(payload.answer);
    const typed = normalizeAnswer(answer);
    const expected = normalizeAnswer(card.back);
    const correct = typed === expected;
    const almost =
      !correct && levenshtein(typed, expected) === 1 && Math.min(typed.length, expected.length) >= 3;
    upsertReview(db, session, card.id, correct ? "correct" : "wrong", answer);
    applySm2(card, correct);
    saveDb();
    const { reviewed, total, finished } = sessionProgress(db, session);
    return {
      card_id: card.id,
      correct,
      almost,
      correct_answer: card.back,
      selected_answer: answer,
      reviewed,
      total,
      finished,
    } as T;
  }

  // ------------------------------ Quiz ------------------------------
  if (seg(0) === "decks" && idAt(1) && seg(2) === "quiz" && seg(3) === "start" && m === "POST") {
    const deck = requireDeck(db, idAt(1));
    const cards = db.cards.filter((c) => c.deck_id === deck.id);
    if (cards.length < 4)
      throw new DemoApiError(400, "Quizzes need at least 4 cards in the deck");
    const direction = q.get("direction") ?? "deck";
    const resolved: "front" | "back" =
      direction === "front" || direction === "back"
        ? direction
        : deck.quiz_answer_side;
    const limit = clamp(Number(q.get("limit") ?? deck.quiz_questions) || deck.quiz_questions, 1, 50);
    const timedRaw = Number(q.get("timed_seconds") ?? "");
    const timedSeconds = Number.isFinite(timedRaw) && timedRaw > 0 ? clamp(timedRaw, 10, 1800) : null;

    const chosen = shuffled(cards).slice(0, Math.min(limit, cards.length));
    const answers = cards.map((c) => (resolved === "front" ? c.back : c.front));
    const session: DemoSession = {
      id: db.seq.session++,
      deck_id: deck.id,
      mode: "quiz",
      srs: false,
      started_at: nowIso(),
      finished_at: null,
      total_planned: chosen.length,
      plan: [],
      questions: chosen.map((card) => {
        const answer = resolved === "front" ? card.back : card.front;
        const wrongPool = shuffled(
          answers.filter((a) => a !== answer && a !== (resolved === "front" ? card.front : card.back))
        ).slice(0, 3);
        const options = shuffled([answer, ...wrongPool]);
        return {
          card_id: card.id,
          front: resolved === "front" ? card.front : card.back,
          options,
          answer,
        };
      }),
      direction: resolved,
      time_limit_seconds: timedSeconds,
      plan_note: null,
      plan_reviews: 0,
      plan_new: 0,
    };
    db.sessions.push(session);
    saveDb();
    return {
      session_id: session.id,
      deck_id: deck.id,
      mode: "quiz",
      total_questions: session.questions.length,
      direction: resolved,
      timed_seconds: timedSeconds,
      questions: session.questions.map((question) => {
        const card = db.cards.find((c) => c.id === question.card_id);
        return {
          card_id: question.card_id,
          front: question.front,
          options: question.options,
          hint: card?.hint ?? null,
          image_url: card?.image_url ?? null,
        };
      }),
    } as T;
  }

  if (seg(0) === "quiz" && seg(1) === "answer" && m === "POST") {
    const session = requireSession(db, asNumber(payload.session_id, 0), "quiz");
    const cardId = asNumber(payload.card_id, 0);
    const question = session.questions.find((question2) => question2.card_id === cardId);
    if (!question) throw new DemoApiError(400, "This question is not part of the quiz");
    const answer = asString(payload.answer);
    const correct = answer === question.answer;
    upsertReview(db, session, cardId, correct ? "correct" : "wrong", answer);
    saveDb();
    const { reviewed, total, finished } = sessionProgress(db, session);
    return {
      correct,
      correct_answer: question.answer,
      selected_answer: answer,
      answered: reviewed,
      total,
      finished,
    } as T;
  }

  if (seg(0) === "quiz" && idAt(1) && seg(2) === "result" && m === "GET") {
    const session = requireSession(db, idAt(1), "quiz");
    if (q.get("finish") === "true" && session.finished_at == null) session.finished_at = nowIso();
    saveDb();
    const reviews = db.reviews.filter((r) => r.session_id === session.id);
    const total = session.questions.length;
    const correct = reviews.filter((r) => r.result === "correct").length;
    const details = session.questions.map((question) => {
      const review = reviews.find((r) => r.card_id === question.card_id);
      return {
        card_id: question.card_id,
        front: question.front,
        correct_answer: question.answer,
        selected_answer: review?.selected_answer ?? null,
        result: review?.result ?? "wrong",
      };
    });
    const duration =
      session.finished_at != null
        ? Math.max(
            0,
            Math.round((new Date(session.finished_at).getTime() - new Date(session.started_at).getTime()) / 1000)
          )
        : 0;
    return {
      session_id: session.id,
      deck_id: session.deck_id,
      total,
      answered: reviews.length,
      correct,
      wrong: reviews.length - correct,
      accuracy: reviews.length > 0 ? round1((correct / reviews.length) * 100) : 0,
      duration_seconds: duration,
      time_limit_seconds: session.time_limit_seconds,
      finished_at: session.finished_at,
      details,
    } as T;
  }

  // ------------------------------ Stats ------------------------------
  if (seg(0) === "stats" && seg(1) === "overview" && m === "GET") {
    const days = clamp(Number(q.get("days") ?? 7) || 7, 7, 366);
    const counts = new Map<string, { reviews: number; correct: number }>();
    for (const r of db.reviews) {
      const key = dayKey(r.reviewed_at);
      const entry = counts.get(key) ?? { reviews: 0, correct: 0 };
      entry.reviews += 1;
      if (r.result === "correct") entry.correct += 1;
      counts.set(key, entry);
    }
    const totalReviews = db.reviews.length;
    const correctReviews = db.reviews.filter((r) => r.result === "correct").length;

    // Mastered = ≥3 reviews with ≥80% accuracy (mirrors stats.py).
    const perCard = new Map<number, { n: number; c: number }>();
    for (const r of db.reviews) {
      const entry = perCard.get(r.card_id) ?? { n: 0, c: 0 };
      entry.n += 1;
      if (r.result === "correct") entry.c += 1;
      perCard.set(r.card_id, entry);
    }
    let mastered = 0;
    for (const { n, c } of perCard.values())
      if (n >= MASTERED_MIN_REVIEWS && c / n >= MASTERED_MIN_ACCURACY) mastered++;

    // Activity window: today-(days-1) … today, ascending.
    const activity: Array<{ date: string; reviews: number; correct: number }> = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const key = dayKey(addDays(today, -i).toISOString());
      const entry = counts.get(key);
      activity.push({ date: key, reviews: entry?.reviews ?? 0, correct: entry?.correct ?? 0 });
    }

    const dateKeys = new Set(counts.keys());
    return {
      total_decks: db.decks.length,
      total_cards: db.cards.length,
      total_sessions: db.sessions.length,
      total_reviews: totalReviews,
      correct_reviews: correctReviews,
      accuracy: totalReviews > 0 ? round1((correctReviews / totalReviews) * 100) : null,
      streak_days: currentStreak(dateKeys),
      longest_streak_days: longestStreak(dateKeys),
      mastered_cards: mastered,
      due_cards: db.cards.filter(isDue).length,
      today_reviews: counts.get(todayKey())?.reviews ?? 0,
      daily_goal: db.user.daily_goal,
      activity,
    } as T;
  }

  if (seg(0) === "stats" && seg(1) === "decks" && idAt(2) && m === "GET") {
    const deck = requireDeck(db, idAt(2));
    const cardIds = new Set(db.cards.filter((c) => c.deck_id === deck.id).map((c) => c.id));
    const reviews = db.reviews.filter((r) => cardIds.has(r.card_id));
    const correct = reviews.filter((r) => r.result === "correct").length;
    const sessions = db.sessions
      .filter((s) => s.deck_id === deck.id)
      .sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
    const weakCount = new Set(
      reviews.filter((r) => r.result === "wrong").map((r) => r.card_id)
    ).size;
    const stats = deckStats(db, deck.id);
    return {
      deck_id: deck.id,
      title: deck.title,
      total_cards: stats.card_count,
      total_reviews: reviews.length,
      correct_reviews: correct,
      accuracy: reviews.length > 0 ? round1((correct / reviews.length) * 100) : null,
      sessions_count: sessions.length,
      weak_cards_count: weakCount,
      last_studied_at: stats.last_studied_at,
      recent_sessions: sessions.slice(0, 5).map((s) => {
        const sReviews = db.reviews.filter((r) => r.session_id === s.id);
        const sCorrect = sReviews.filter((r) => r.result === "correct").length;
        return {
          id: s.id,
          mode: s.mode,
          started_at: s.started_at,
          finished_at: s.finished_at,
          reviews: sReviews.length,
          accuracy: sReviews.length > 0 ? round1((sCorrect / sReviews.length) * 100) : null,
        };
      }),
    } as T;
  }

  if (seg(0) === "stats" && seg(1) === "weak-cards" && m === "GET") {
    const perCard = new Map<number, { n: number; wrong: number }>();
    for (const r of db.reviews) {
      const entry = perCard.get(r.card_id) ?? { n: 0, wrong: 0 };
      entry.n += 1;
      if (r.result === "wrong") entry.wrong += 1;
      perCard.set(r.card_id, entry);
    }
    const rows = [...perCard.entries()]
      .filter(([, v]) => v.wrong > 0)
      .map(([cardId, v]) => ({ cardId, ...v }))
      .sort((a, b) => b.wrong - a.wrong || b.n - a.n)
      .slice(0, 20);
    return rows.map(({ cardId, n, wrong }) => {
      const card = db.cards.find((c) => c.id === cardId)!;
      const deck = db.decks.find((d) => d.id === card.deck_id)!;
      return {
        card_id: card.id,
        deck_id: card.deck_id,
        deck_title: deck.title,
        front: card.front,
        back: card.back,
        times_reviewed: n,
        times_wrong: wrong,
        accuracy: round1(((n - wrong) / n) * 100),
      };
    }) as T;
  }

  if (seg(0) === "stats" && seg(1) === "sessions" && m === "GET") {
    const limit = clamp(Number(q.get("limit") ?? 15) || 15, 1, 50);
    const sessions = [...db.sessions]
      .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))
      .slice(0, limit);
    return sessions.map((s) => {
      const deck = db.decks.find((d) => d.id === s.deck_id);
      const reviews = db.reviews.filter((r) => r.session_id === s.id);
      const correct = reviews.filter((r) => r.result === "correct").length;
      return {
        id: s.id,
        deck_id: s.deck_id,
        deck_title: deck?.title ?? "Deleted deck",
        mode: s.mode,
        srs: s.srs,
        started_at: s.started_at,
        finished_at: s.finished_at,
        reviews: reviews.length,
        correct,
        accuracy: reviews.length > 0 ? round1((correct / reviews.length) * 100) : null,
        duration_seconds:
          s.finished_at != null
            ? Math.max(0, Math.round((new Date(s.finished_at).getTime() - new Date(s.started_at).getTime()) / 1000))
            : null,
      };
    }) as T;
  }

  if (seg(0) === "stats" && seg(1) === "export" && seg(2) === "reviews.csv" && m === "GET") {
    return reviewsCsv(db, null) as unknown as T;
  }

  // ------------------------------ Search ------------------------------
  if (seg(0) === "search" && m === "GET") {
    const search = (q.get("q") ?? "").trim().toLowerCase();
    if (!search) return { decks: [], cards: [] } as T;
    const decks = db.decks
      .filter(
        (d) =>
          d.title.toLowerCase().includes(search) ||
          (d.description ?? "").toLowerCase().includes(search)
      )
      .map((d) => deckOut(db, d));
    const cards = db.cards
      .filter(
        (c) =>
          c.front.toLowerCase().includes(search) ||
          c.back.toLowerCase().includes(search) ||
          c.tags.some((t) => t.toLowerCase().includes(search))
      )
      .slice(0, 10)
      .map((c) => ({
        card_id: c.id,
        deck_id: c.deck_id,
        deck_title: db.decks.find((d) => d.id === c.deck_id)?.title ?? "",
        front: c.front,
        back: c.back,
        tags: [...c.tags],
      }));
    return { decks, cards } as T;
  }

  throw new DemoApiError(404, `Demo backend has no route for ${method} ${pathname}`);
}

/** Review-history CSV (same columns as the FastAPI export). */
function reviewsCsv(db: DemoDB, deckId: number | null): string {
  const rows: Array<Array<string | number | null>> = [];
  for (const r of [...db.reviews].sort((a, b) => (a.reviewed_at < b.reviewed_at ? -1 : 1))) {
    const card = db.cards.find((c) => c.id === r.card_id);
    if (!card) continue;
    const deck = db.decks.find((d) => d.id === card.deck_id);
    if (deckId != null && deck?.id !== deckId) continue;
    const session = db.sessions.find((s) => s.id === r.session_id);
    rows.push([
      r.reviewed_at,
      deck?.id ?? "",
      deck?.title ?? "",
      card.id,
      card.front,
      card.back,
      r.result,
      r.selected_answer ?? "",
      session?.mode ?? "study",
      r.session_id,
    ]);
  }
  return toCsv(
    ["reviewed_at", "deck_id", "deck_title", "card_id", "front", "back", "result", "selected_answer", "mode", "session_id"],
    rows
  );
}
