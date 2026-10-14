"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Brain, Check, Keyboard, Lightbulb, Loader2, RotateCcw, Settings2, Timer, Trophy, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { ApiError, api } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import type { QuizResult, QuizStart } from "@/lib/types";

import { CardImage } from "./card-image";
import { ShortcutsDialog, shortcutBlocked } from "./shortcuts-dialog";

const QUIZ_LENGTHS = [5, 10, 15] as const;
const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"] as const;

/** Whole-quiz time budget options (value = `timed_seconds`, null = untimed). */
const TIMER_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "Off" },
  { value: 30, label: "30s" },
  { value: 60, label: "60s" },
  { value: 120, label: "120s" },
  { value: 300, label: "300s" },
];

/** Countdown chip tone by remaining fraction: emerald ≥50%, amber 20–50%, rose <20%. */
function timerTone(frac: number): string {
  if (frac >= 0.5)
    return "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300";
  if (frac >= 0.2)
    return "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300";
  return "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300";
}

function timerBarColor(frac: number): string {
  if (frac >= 0.5) return "bg-emerald-500";
  if (frac >= 0.2) return "bg-amber-500";
  return "bg-rose-500";
}

/** Compact mm:ss countdown chip with a Timer icon; pulses under 10s. */
function TimerChip({ remainingMs, totalMs }: { remainingMs: number; totalMs: number }) {
  const frac = totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
  const secs = Math.max(0, Math.ceil(remainingMs / 1000));
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return (
    <span
      role="timer"
      aria-label={`Time remaining ${mm}:${ss}`}
      title="Time remaining for this quiz"
      className={`flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-bold tabular-nums ${timerTone(frac)} ${
        remainingMs <= 10_000 ? "animate-pulse" : ""
      }`}
    >
      <Timer className="h-3.5 w-3.5" />
      {mm}:{ss}
    </span>
  );
}

/** Animated SVG accuracy ring around the result trophy (emerald ≥80, amber ≥50, rose below). */
function ScoreRing({ pct }: { pct: number }) {
  const SIZE = 104;
  const STROKE = 8;
  const R = (SIZE - STROKE) / 2;
  const CIRC = 2 * Math.PI * R;
  const color = pct >= 80 ? "#10b981" : pct >= 50 ? "#f59e0b" : "#f43f5e";

  return (
    <div className="relative" style={{ width: SIZE, height: SIZE }}>
      <svg width={SIZE} height={SIZE} className="-rotate-90" aria-hidden>
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          strokeWidth={STROKE}
          className="stroke-muted"
        />
        <motion.circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          stroke={color}
          strokeDasharray={CIRC}
          initial={{ strokeDashoffset: CIRC }}
          animate={{ strokeDashoffset: CIRC * (1 - Math.min(100, Math.max(0, pct)) / 100) }}
          transition={{ duration: 0.9, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <Trophy className="h-9 w-9" style={{ color }} />
      </div>
    </div>
  );
}

/** Quiz mode: server-generated multiple choice with instant feedback. */
export function QuizView({ deckId }: { deckId: number }) {
  const go = useAppStore((s) => s.go);
  const [quiz, setQuiz] = useState<QuizStart | null>(null);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [correctAnswer, setCorrectAnswer] = useState<string | null>(null);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [phase, setPhase] = useState<"setup" | "loading" | "playing" | "done" | "error">("setup");
  const [result, setResult] = useState<QuizResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [limit, setLimit] = useState<number | null>(10); // null = every card
  const [hintShown, setHintShown] = useState(false); // per-question, reset on advance
  const advancing = useRef(false);

  // Deck quiz defaults (length preselect + answer direction) — graceful fallback to 10/front.
  const [deckDefault, setDeckDefault] = useState<number | null>(null);
  const [direction, setDirection] = useState<"front" | "back">("front");

  // Timed mode — whole-quiz budget in seconds (null = untimed). Persists on retry.
  const [timedSeconds, setTimedSeconds] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [timeUp, setTimeUp] = useState(false); // deadline hit → "Time's up" result treatment
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const timedOutRef = useRef(false); // blocks interactions once the deadline fired
  const completingRef = useRef(false); // blocks the timeout path once the final result fetch began
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    let cancelled = false;
    api.decks
      .get(deckId)
      .then((d) => {
        if (cancelled) return;
        const preset = typeof d.quiz_questions === "number" ? d.quiz_questions : null;
        setDeckDefault(preset);
        setDirection(d.quiz_answer_side === "back" ? "back" : "front");
        if (preset) setLimit(preset); // preselect the deck's default length
      })
      .catch(() => {
        /* setup stays on the 10/front fallback */
      });
    return () => {
      cancelled = true;
    };
  }, [deckId]);

  const fetchQuiz = useCallback(
    async (count: number | null, dir: "front" | "back", timed: number | null) => {
      // Fetches questions; all setState calls run after the await resolves.
      try {
        const q = await api.quiz.start(deckId, count ?? undefined, dir, timed ?? undefined);
        setQuiz(q);
        setRemainingMs(q.timed_seconds != null ? q.timed_seconds * 1000 : 0); // full budget to start
        setPhase("playing");
      } catch (e) {
        setMessage(e instanceof ApiError ? e.message : "Failed to start the quiz.");
        setPhase("error");
      }
    },
    [deckId]
  );

  /** Full reset + restart with the current options (Retry button — an event handler). */
  const startQuiz = useCallback(() => {
    setResult(null);
    setIndex(0);
    setSelected(null);
    setCorrectAnswer(null);
    setAnsweredCount(0);
    setCorrectCount(0);
    setHintShown(false);
    advancing.current = false;
    timedOutRef.current = false;
    completingRef.current = false;
    setTimeUp(false);
    setPhase("loading");
    void fetchQuiz(limit, direction, timedSeconds); // timer + direction + length all persist on retry
  }, [fetchQuiz, limit, direction, timedSeconds]);

  /** Back to the length picker. */
  const backToSetup = useCallback(() => {
    setResult(null);
    setQuiz(null);
    setIndex(0);
    setSelected(null);
    setCorrectAnswer(null);
    setAnsweredCount(0);
    setCorrectCount(0);
    setTimeUp(false);
    timedOutRef.current = false;
    completingRef.current = false;
    setPhase("setup");
  }, []);

  // ---- Answer the current question, show feedback, then advance ----
  async function choose(option: string) {
    if (!quiz || selected !== null || advancing.current || timedOutRef.current) return;
    const q = quiz.questions[index];
    if (!q) return;

    setSelected(option);
    try {
      const res = await api.quiz.answer(quiz.session_id, q.card_id, option);
      if (timedOutRef.current) return; // deadline hit while the answer was in flight
      setCorrectAnswer(res.correct_answer);
      setAnsweredCount(res.answered);
      if (res.correct) setCorrectCount((c) => c + 1);

      advancing.current = true;
      setTimeout(async () => {
        advancing.current = false;
        if (timedOutRef.current) return; // the timeout path owns the session now
        if (index + 1 >= quiz.questions.length) {
          // All questions answered — fetch the full result breakdown.
          completingRef.current = true; // tell the timeout path to stand down
          try {
            const r = await api.quiz.result(quiz.session_id);
            setResult(r);
            setPhase("done");
          } catch {
            toast.error("Failed to load the quiz result");
            setPhase("error");
          }
        } else {
          setIndex((i) => i + 1);
          setSelected(null);
          setCorrectAnswer(null);
          setHintShown(false); // fresh question → hint hidden again
        }
      }, res.correct ? 750 : 1300);
    } catch (e) {
      if (timedOutRef.current) return;
      setSelected(null);
      toast.error(e instanceof ApiError ? e.message : "Failed to submit the answer");
    }
  }

  /** Deadline hit: close the session server-side (finish=true) and jump to the
   * result screen with the "Time's up" treatment. Safe from any play state —
   * idle, mid-reveal or mid-advance. */
  const finishByTimeout = useCallback(async () => {
    if (!quiz || timedOutRef.current || completingRef.current) return;
    timedOutRef.current = true;
    if (phaseRef.current !== "playing") return;
    setTimeUp(true);
    setSelected(null);
    setCorrectAnswer(null);
    try {
      const r = await api.quiz.result(quiz.session_id, { finish: true });
      setResult(r);
      setPhase("done");
    } catch {
      toast.error("Failed to load the quiz result");
      setPhase("error");
    }
  }, [quiz]);

  // ---- Whole-quiz countdown (timed mode only) ----
  useEffect(() => {
    if (phase !== "playing" || quiz?.timed_seconds == null) return;
    const totalMs = quiz.timed_seconds * 1000;
    const deadline = Date.now() + totalMs;
    const iv = setInterval(() => {
      const left = Math.max(0, deadline - Date.now());
      // Tick state roughly once per second (display granularity) to keep renders cheap.
      setRemainingMs((prev) => (Math.ceil(prev / 1000) !== Math.ceil(left / 1000) ? left : prev));
      if (left <= 0) {
        clearInterval(iv);
        void finishByTimeout();
      }
    }, 250);
    // Cleanup also covers unmount and finish-by-answering (phase leaves "playing").
    return () => clearInterval(iv);
  }, [phase, quiz, finishByTimeout]);

  // ---- Keyboard: 1–4 pick an option, "?" toggles the shortcut cheat sheet ----
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (shortcutBlocked(e)) return;
      if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen((o) => !o);
        return;
      }
      if (phaseRef.current !== "playing") return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > 4) return;
      const option = quiz?.questions[index]?.options[n - 1];
      if (option == null) return;
      e.preventDefault();
      void choose(option); // choose() re-checks the answered/disabled guards
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---- Setup screen: pick how many questions + answer direction ----
  if (phase === "setup") {
    // The deck's own default gets a dedicated chip when it isn't 5/10/15.
    const deckDefaultChip: number[] =
      deckDefault !== null && !(QUIZ_LENGTHS as readonly number[]).includes(deckDefault)
        ? [deckDefault]
        : [];

    return (
      <div className="mx-auto w-full max-w-xl px-4 py-10">
        <div className="mb-4 flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={() => go("deck", deckId)} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Back to deck
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShortcutsOpen(true)}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <Keyboard className="h-4 w-4" />
          </Button>
        </div>

        <div className="rounded-2xl border bg-card p-8 text-center shadow-sm">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md">
            <Brain className="h-8 w-8" />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Quiz time!</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Multiple choice · 4 options per question · instant feedback
          </p>

          <p className="mt-6 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Questions
          </p>
          <div
            className="mt-2 flex flex-wrap items-center justify-center gap-2"
            role="radiogroup"
            aria-label="Number of questions"
          >
            {QUIZ_LENGTHS.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={limit === n}
                onClick={() => setLimit(n)}
                className={`h-11 w-16 rounded-xl border text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                  limit === n
                    ? "border-amber-400 bg-amber-50 text-amber-800 shadow-sm dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-300"
                    : "bg-card text-muted-foreground hover:border-amber-300 hover:text-foreground"
                }`}
              >
                {n}
              </button>
            ))}
            {deckDefaultChip.map((n) => (
              <button
                key={`deck-${n}`}
                type="button"
                role="radio"
                aria-checked={limit === n}
                onClick={() => setLimit(n)}
                title={`${n} — this deck's default quiz length`}
                className={`h-11 rounded-xl border px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                  limit === n
                    ? "border-amber-400 bg-amber-50 text-amber-800 shadow-sm dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-300"
                    : "bg-card text-muted-foreground hover:border-amber-300 hover:text-foreground"
                }`}
              >
                <span className="flex flex-col items-center leading-tight">
                  <span>{n}</span>
                  <span className="text-[9px] font-normal uppercase tracking-wide opacity-75">
                    deck default
                  </span>
                </span>
              </button>
            ))}
            <button
              type="button"
              role="radio"
              aria-checked={limit === null}
              onClick={() => setLimit(null)}
              className={`h-11 rounded-xl border px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                limit === null
                  ? "border-amber-400 bg-amber-50 text-amber-800 shadow-sm dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-300"
                  : "bg-card text-muted-foreground hover:border-amber-300 hover:text-foreground"
              }`}
            >
              All cards
            </button>
          </div>

          <p className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Direction
          </p>
          <div
            className="mt-2 flex items-center justify-center gap-2"
            role="radiogroup"
            aria-label="Answer direction"
          >
            <button
              type="button"
              role="radio"
              aria-checked={direction === "front"}
              onClick={() => setDirection("front")}
              className={`flex h-11 items-center gap-1.5 rounded-xl border px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                direction === "front"
                  ? "border-amber-400 bg-amber-50 text-amber-800 shadow-sm dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-300"
                  : "bg-card text-muted-foreground hover:border-amber-300 hover:text-foreground"
              }`}
            >
              <ArrowRight className="h-4 w-4" /> Front → Back
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={direction === "back"}
              onClick={() => setDirection("back")}
              className={`flex h-11 items-center gap-1.5 rounded-xl border px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                direction === "back"
                  ? "border-amber-400 bg-amber-50 text-amber-800 shadow-sm dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-300"
                  : "bg-card text-muted-foreground hover:border-amber-300 hover:text-foreground"
              }`}
            >
              <ArrowLeft className="h-4 w-4" /> Back → Front
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {direction === "back"
              ? "You'll see the back of each card and pick the matching front"
              : "You'll see the front of each card and pick the matching back"}
          </p>

          <p className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Timer
          </p>
          <div
            className="mt-2 flex flex-wrap items-center justify-center gap-2"
            role="radiogroup"
            aria-label="Quiz timer"
          >
            {TIMER_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                type="button"
                role="radio"
                aria-checked={timedSeconds === opt.value}
                onClick={() => setTimedSeconds(opt.value)}
                className={`flex h-9 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                  timedSeconds === opt.value
                    ? "border-amber-400 bg-amber-50 text-amber-800 shadow-sm dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-300"
                    : "border-border bg-card text-muted-foreground hover:border-amber-300 hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Time budget for the whole quiz — when it hits zero the quiz ends automatically
          </p>

          <Button
            onClick={() => {
              setPhase("loading");
              void fetchQuiz(limit, direction, timedSeconds);
            }}
            className="mt-6 h-11 w-full gap-2 bg-amber-500 text-base text-white hover:bg-amber-600"
          >
            <Brain className="h-5 w-5" /> Start quiz
          </Button>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Settings2 className="h-3 w-3" /> You can retry or change the options after the quiz
          </p>
        </div>
        <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} mode="quiz" />
      </div>
    );
  }

  if (phase === "loading") {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-10">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-56 rounded-2xl" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <Button variant="ghost" onClick={() => go("decks")} className="mb-4 gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {message}
        </div>
      </div>
    );
  }

  // ---- Results screen ----
  if (phase === "done" && result) {
    const scorePct = Math.round(result.accuracy);
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <div className="flex flex-col items-center text-center">
          <ScoreRing pct={scorePct} />
          <h1 className="mt-5 text-2xl font-bold">
            {result.correct}/{result.answered} correct
          </h1>
          <p className="mt-1 text-muted-foreground">
            {scorePct}% accuracy · finished in {formatDuration(result.duration_seconds)}
          </p>
          {result.time_limit_seconds != null && (
            <Badge
              variant="outline"
              className="mt-3 gap-1 border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
            >
              <Timer className="h-3 w-3" /> Timed · {result.time_limit_seconds}s
            </Badge>
          )}
          {timeUp && (
            <p className="mt-2 text-sm font-medium text-rose-600">
              Time&apos;s up — you answered {result.answered} of {result.total}.
            </p>
          )}
        </div>

        {/* Per-question breakdown */}
        <ul className="mt-8 space-y-2">
          {result.details.map((d, i) => (
            <li
              key={d.card_id}
              className={`rounded-xl border p-4 ${
                d.result === "correct"
                  ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/20 dark:bg-emerald-500/5"
                  : "border-rose-200 bg-rose-50/60 dark:border-rose-500/20 dark:bg-rose-500/5"
              }`}
            >
              <div className="flex items-start gap-2.5">
                {d.result === "correct" ? (
                  <Check className="mt-0.5 h-4.5 w-4.5 shrink-0 text-emerald-600" />
                ) : (
                  <X className="mt-0.5 h-4.5 w-4.5 shrink-0 text-rose-500" />
                )}
                <div className="min-w-0">
                  <p className="font-medium">
                    {i + 1}. {d.front}
                  </p>
                  {d.result === "wrong" && (
                    <p className="mt-1 text-sm text-rose-600">
                      Your answer: {d.selected_answer ?? "—"}
                    </p>
                  )}
                  <p className="mt-0.5 text-sm text-emerald-700">
                    Correct: {d.correct_answer}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-8 flex flex-wrap justify-center gap-2">
          <Button onClick={() => void startQuiz()} className="gap-1.5 bg-amber-500 text-white hover:bg-amber-600">
            <RotateCcw className="h-4 w-4" /> Retry quiz
          </Button>
          <Button variant="outline" onClick={backToSetup} className="gap-1.5">
            <Settings2 className="h-4 w-4" /> Change length
          </Button>
          <Button variant="outline" onClick={() => go("deck", deckId)}>
            Back to deck
          </Button>
          <Button variant="ghost" onClick={() => go("stats")}>
            View stats
          </Button>
        </div>
        <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} mode="quiz" />
      </div>
    );
  }

  const q = quiz?.questions[index];
  const total = quiz?.total_questions ?? 0;
  const totalMs = quiz?.timed_seconds != null ? quiz.timed_seconds * 1000 : null;
  const frac = totalMs ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={() => go("deck", deckId)} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Quit quiz
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShortcutsOpen(true)}
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
        >
          <Keyboard className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        {totalMs != null && <TimerChip remainingMs={remainingMs} totalMs={totalMs} />}
        <Progress
          value={total ? (answeredCount / total) * 100 : 0}
          className="h-2 min-w-0 flex-1"
          aria-label="Quiz progress"
        />
        <span className="shrink-0 text-sm font-medium text-muted-foreground">
          {Math.min(index + 1, total)}/{total}
        </span>
      </div>
      {totalMs != null && (
        <div
          className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted"
          aria-hidden
        >
          <div
            className={`h-full rounded-full ${timerBarColor(frac)}`}
            style={{ width: `${(frac * 100).toFixed(2)}%`, transition: "width 300ms linear" }}
          />
        </div>
      )}

      {/* ---------- Question ---------- */}
      <div className="mt-6 rounded-2xl border bg-card p-6 text-center shadow-sm sm:p-8">
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Which answer is correct?
        </span>
        {q?.image_url && (
          <div className="mt-3 flex justify-center">
            <CardImage src={q.image_url} alt={`Image for: ${q.front}`} />
          </div>
        )}
        <p className="mt-3 text-xl font-medium leading-relaxed sm:text-2xl">{q?.front}</p>
        {q?.hint && hintShown && (
          <motion.p
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mx-auto mt-3 flex max-w-md items-start justify-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-sm italic text-amber-800 dark:bg-amber-500/10 dark:text-amber-300"
          >
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            {q.hint}
          </motion.p>
        )}
      </div>

      {/* ---------- Hint reveal (hides itself once used) ---------- */}
      {q?.hint && selected === null && !hintShown && (
        <div className="mt-3 flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-amber-600"
            onClick={() => setHintShown(true)}
          >
            <Lightbulb className="h-3.5 w-3.5" /> Need a hint?
          </Button>
        </div>
      )}

      {/* ---------- Options (stagger in per question) ---------- */}
      <div key={index} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(q?.options ?? []).map((option, i) => {
          const isChosen = selected === option;
          const isCorrect = correctAnswer === option;
          const showCorrect = selected !== null && isCorrect;
          const showWrong = isChosen && correctAnswer !== null && !isCorrect;

          return (
            <motion.button
              key={option}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: i * 0.03, ease: "easeOut" }}
              onClick={() => void choose(option)}
              disabled={selected !== null || timeUp}
              className={`flex min-h-14 items-center gap-3 rounded-xl border p-4 text-left text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                showCorrect
                  ? "border-emerald-400 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300"
                  : showWrong
                    ? "border-rose-400 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300"
                    : selected !== null
                      ? "border-border bg-card opacity-50"
                      : "border-border bg-card hover:border-amber-300 hover:bg-amber-50/50 dark:hover:bg-amber-500/5"
              }`}
            >
              <span
                aria-hidden
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground"
              >
                {OPTION_LETTERS[i] ?? i + 1}
              </span>
              <span className="min-w-0 flex-1">{option}</span>
              {showCorrect && <Check className="h-5 w-5 shrink-0 text-emerald-600" />}
              {showWrong && <X className="h-5 w-5 shrink-0 text-rose-500" />}
            </motion.button>
          );
        })}
      </div>

      <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <Loader2 className={`h-3 w-3 ${selected !== null ? "animate-spin" : "invisible"}`} />
        {selected !== null
          ? "Checking…"
          : timeUp
            ? "Time's up — loading results…"
            : "Pick the answer you think is correct"}
      </p>

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} mode="quiz" />
    </div>
  );
}
