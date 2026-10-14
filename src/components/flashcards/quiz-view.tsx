"use client";

import { useCallback, useRef, useState } from "react";
import { ArrowLeft, Brain, Check, Loader2, RotateCcw, Settings2, Trophy, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import type { QuizResult, QuizStart } from "@/lib/types";

const QUIZ_LENGTHS = [5, 10, 15] as const;

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
  const advancing = useRef(false);

  const fetchQuiz = useCallback(
    async (count: number | null) => {
      // Fetches questions; all setState calls run after the await resolves.
      try {
        const q = await api.quiz.start(deckId, count ?? undefined);
        setQuiz(q);
        setPhase("playing");
      } catch (e) {
        setMessage(e instanceof ApiError ? e.message : "Failed to start the quiz.");
        setPhase("error");
      }
    },
    [deckId]
  );

  /** Full reset + restart with the current length (Retry button — an event handler). */
  const startQuiz = useCallback(() => {
    setResult(null);
    setIndex(0);
    setSelected(null);
    setCorrectAnswer(null);
    setAnsweredCount(0);
    setCorrectCount(0);
    advancing.current = false;
    setPhase("loading");
    void fetchQuiz(limit);
  }, [fetchQuiz, limit]);

  /** Back to the length picker. */
  const backToSetup = useCallback(() => {
    setResult(null);
    setQuiz(null);
    setIndex(0);
    setSelected(null);
    setCorrectAnswer(null);
    setAnsweredCount(0);
    setCorrectCount(0);
    setPhase("setup");
  }, []);

  // ---- Answer the current question, show feedback, then advance ----
  async function choose(option: string) {
    if (!quiz || selected !== null || advancing.current) return;
    const q = quiz.questions[index];
    if (!q) return;

    setSelected(option);
    try {
      const res = await api.quiz.answer(quiz.session_id, q.card_id, option);
      setCorrectAnswer(res.correct_answer);
      setAnsweredCount(res.answered);
      if (res.correct) setCorrectCount((c) => c + 1);

      advancing.current = true;
      setTimeout(async () => {
        advancing.current = false;
        if (index + 1 >= quiz.questions.length) {
          // All questions answered — fetch the full result breakdown.
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
        }
      }, res.correct ? 750 : 1300);
    } catch (e) {
      setSelected(null);
      toast.error(e instanceof ApiError ? e.message : "Failed to submit the answer");
    }
  }

  // ---- Setup screen: pick how many questions ----
  if (phase === "setup") {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-10">
        <Button variant="ghost" onClick={() => go("deck", deckId)} className="mb-4 gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Back to deck
        </Button>

        <div className="rounded-2xl border bg-card p-8 text-center shadow-sm">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md">
            <Brain className="h-8 w-8" />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Quiz time!</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Multiple choice · 4 options per question · instant feedback
          </p>

          <div
            className="mt-6 flex items-center justify-center gap-2"
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

          <Button
            onClick={() => {
              setPhase("loading");
              void fetchQuiz(limit);
            }}
            className="mt-6 h-11 w-full gap-2 bg-amber-500 text-base text-white hover:bg-amber-600"
          >
            <Brain className="h-5 w-5" /> Start quiz
          </Button>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Settings2 className="h-3 w-3" /> You can retry or change the length after the quiz
          </p>
        </div>
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
          <span
            className={`flex h-20 w-20 items-center justify-center rounded-full ${
              scorePct >= 80
                ? "bg-emerald-100 text-emerald-600"
                : scorePct >= 50
                  ? "bg-amber-100 text-amber-600"
                  : "bg-rose-100 text-rose-600"
            }`}
          >
            <Trophy className="h-10 w-10" />
          </span>
          <h1 className="mt-5 text-2xl font-bold">
            {result.correct}/{result.answered} correct
          </h1>
          <p className="mt-1 text-muted-foreground">
            {scorePct}% accuracy · finished in {formatDuration(result.duration_seconds)}
          </p>
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
      </div>
    );
  }

  const q = quiz?.questions[index];
  const total = quiz?.total_questions ?? 0;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <Button variant="ghost" onClick={() => go("deck", deckId)} className="mb-3 gap-1.5">
        <ArrowLeft className="h-4 w-4" /> Quit quiz
      </Button>

      <div className="flex items-center gap-3">
        <Progress
          value={total ? (answeredCount / total) * 100 : 0}
          className="h-2 flex-1"
          aria-label="Quiz progress"
        />
        <span className="shrink-0 text-sm font-medium text-muted-foreground">
          {Math.min(index + 1, total)}/{total}
        </span>
      </div>

      {/* ---------- Question ---------- */}
      <div className="mt-6 rounded-2xl border bg-card p-8 text-center shadow-sm">
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Which answer is correct?
        </span>
        <p className="mt-3 text-xl font-medium leading-relaxed sm:text-2xl">{q?.front}</p>
      </div>

      {/* ---------- Options ---------- */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(q?.options ?? []).map((option) => {
          const isChosen = selected === option;
          const isCorrect = correctAnswer === option;
          const showCorrect = selected !== null && isCorrect;
          const showWrong = isChosen && correctAnswer !== null && !isCorrect;

          return (
            <button
              key={option}
              onClick={() => void choose(option)}
              disabled={selected !== null}
              className={`flex min-h-14 items-center justify-between gap-2 rounded-xl border p-4 text-left text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                showCorrect
                  ? "border-emerald-400 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300"
                  : showWrong
                    ? "border-rose-400 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300"
                    : selected !== null
                      ? "border-border bg-card opacity-50"
                      : "border-border bg-card hover:border-amber-300 hover:bg-amber-50/50 dark:hover:bg-amber-500/5"
              }`}
            >
              <span>{option}</span>
              {showCorrect && <Check className="h-5 w-5 shrink-0 text-emerald-600" />}
              {showWrong && <X className="h-5 w-5 shrink-0 text-rose-500" />}
            </button>
          );
        })}
      </div>

      <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <Loader2 className={`h-3 w-3 ${selected !== null ? "animate-spin" : "invisible"}`} />
        {selected !== null ? "Checking…" : "Pick the answer you think is correct"}
      </p>
    </div>
  );
}
