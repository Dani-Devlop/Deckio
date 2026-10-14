"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Lightbulb, Loader2, RotateCcw, Sparkles, Trophy, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { ApiError, api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type { StudyNext, StudyStart } from "@/lib/types";
import type { ReviewResult } from "@/lib/types";

import { CardImage } from "./card-image";

/** Self-paced study mode: flip card → self-grade (Again / Got it). */
export function StudyView({ deckId }: { deckId: number }) {
  const go = useAppStore((s) => s.go);
  const initialSrs = useAppStore((s) => s.studySrs);
  const [session, setSession] = useState<StudyStart | null>(null);
  const [isSrs, setIsSrs] = useState(initialSrs);
  const [planNote, setPlanNote] = useState<string | null>(null); // limit reason from start
  const [current, setCurrent] = useState<StudyNext | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [results, setResults] = useState<ReviewResult[]>([]);
  const [phase, setPhase] = useState<"loading" | "playing" | "done" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hintShown, setHintShown] = useState(false); // per-card, reset on next
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // ---- Boot: open a session and fetch the first card ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const start = await api.study.start(deckId, initialSrs);
        if (cancelled) return;
        setSession(start);
        setIsSrs(start.srs);
        setPlanNote(start.note ?? null);
        const next = await api.study.next(deckId, start.session_id);
        if (cancelled) return;
        setCurrent(next);
        setPhase("playing");
      } catch (e) {
        if (cancelled) return;
        setMessage(e instanceof ApiError ? e.message : "Failed to start the session.");
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deckId, initialSrs]);

  // ---- Submit a review and move to the next card ----
  const review = useCallback(
    async (result: ReviewResult) => {
      if (!session || !current?.card || busy || phaseRef.current !== "playing") return;
      setBusy(true);
      const cardId = current.card.id;
      try {
        setResults((r) => [...r, result]);
        const next = await api.study.review(session.session_id, cardId, result);
        if (next.finished) {
          setPhase("done");
        } else {
          const nc = await api.study.next(deckId, session.session_id);
          setFlipped(false);
          setHintShown(false); // fresh card → hint hidden again
          setCurrent(nc);
        }
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : "Failed to save the review");
        setResults((r) => r.slice(0, -1)); // roll back optimistic append
      } finally {
        setBusy(false);
      }
    },
    [busy, current, deckId, session]
  );

  // ---- Keyboard shortcuts: Space = flip, 1 = again, 2 = got it ----
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (phaseRef.current !== "playing") return;
      if (e.code === "Space" || e.key === "Enter") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === "1" || e.key === "ArrowLeft") {
        if (flipped) void review("wrong");
      } else if (e.key === "2" || e.key === "ArrowRight") {
        if (flipped) void review("correct");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flipped, review]);

  if (phase === "loading") {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-10">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-72 rounded-2xl" />
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

  // ---- Session summary ----
  if (phase === "done") {
    const correct = results.filter((r) => r === "correct").length;
    const acc = results.length ? Math.round((correct / results.length) * 100) : 0;
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-4 py-16 text-center">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <Trophy className="h-10 w-10" />
        </span>
        <h1 className="mt-5 text-2xl font-bold">Session complete!</h1>
        <p className="mt-1 text-muted-foreground">
          You reviewed {results.length} card{results.length === 1 ? "" : "s"}.
        </p>

        <div className="mt-6 flex gap-3">
          {[
            { value: correct, label: "Got it", cls: "text-emerald-600" },
            { value: results.length - correct, label: "Again", cls: "text-rose-500" },
            { value: `${acc}%`, label: "Accuracy", cls: "" },
          ].map((tile, i) => (
            <motion.div
              key={tile.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.08, duration: 0.3, ease: "easeOut" }}
              className="rounded-xl border bg-card px-6 py-4"
            >
              <p className={`text-2xl font-bold ${tile.cls}`}>{tile.value}</p>
              <p className="text-xs text-muted-foreground">{tile.label}</p>
            </motion.div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-2">
          <Button
            className="gap-1.5 bg-amber-500 text-white hover:bg-amber-600"
            onClick={() => {
              setPhase("loading");
              setResults([]);
              api.study
                .start(deckId, isSrs)
                .then((s) => api.study.next(deckId, s.session_id))
                .then((n) => {
                  setSession((prev) => prev && { ...prev, session_id: n.session_id });
                  setCurrent(n);
                  setFlipped(false);
                  setHintShown(false);
                  setPlanNote(null);
                  setPhase("playing");
                })
                .catch(() => {
                  setPhase("error");
                  setMessage("Could not restart the session.");
                });
            }}
          >
            <RotateCcw className="h-4 w-4" /> {isSrs ? "Review again" : "Study again"}
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

  const card = current?.card;
  const reviewed = current?.reviewed ?? 0;
  const total = current?.total ?? 0;
  const pct = total > 0 ? Math.round((reviewed / total) * 100) : 0;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <Button variant="ghost" onClick={() => go("deck", deckId)} className="mb-3 gap-1.5">
        <ArrowLeft className="h-4 w-4" /> End session
      </Button>

      {/* ---------- Progress ---------- */}
      <div className="flex items-center gap-3">
        <Progress value={pct} className="h-2 flex-1" aria-label="Session progress" />
        <span className="shrink-0 text-sm font-medium text-muted-foreground">
          {reviewed}/{total}
        </span>
      </div>
      {isSrs && (
        <motion.p
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-medium text-amber-600"
        >
          <Sparkles className="h-3.5 w-3.5" /> Smart review
          {session && (session.plan_reviews > 0 || session.plan_new > 0) && (
            <span className="font-normal text-muted-foreground">
              — {session.plan_reviews > 0 && `${session.plan_reviews} review${session.plan_reviews === 1 ? "" : "s"}`}
              {session.plan_reviews > 0 && session.plan_new > 0 && " + "}
              {session.plan_new > 0 && `${session.plan_new} new`}
            </span>
          )}
          {planNote && <span className="font-normal text-amber-500/90">· {planNote}</span>}
        </motion.p>
      )}

      {/* ---------- Flashcard ---------- */}
      <div className="mt-6" style={{ perspective: "1400px" }}>
        <button
          className={`relative block w-full text-left transition-transform duration-500 ${
            card?.image_url ? "h-[22rem] sm:h-[24rem]" : "h-72 sm:h-80"
          } ${flipped ? "[transform:rotateY(180deg)]" : ""}`}
          style={{ transformStyle: "preserve-3d" }}
          onClick={() => setFlipped((f) => !f)}
          aria-live="polite"
          aria-label={flipped ? "Answer side. Click to see the question." : "Question side. Click to flip."}
        >
          {/* front (question) */}
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border bg-card p-6 text-center shadow-sm"
            style={{ backfaceVisibility: "hidden" }}
          >
            <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Question
            </span>
            {card?.image_url && (
              <CardImage src={card.image_url} alt={`Image for: ${card.front}`} className="mt-1" />
            )}
            <p className="text-xl font-medium leading-relaxed sm:text-2xl">{card?.front}</p>
            {card?.hint && hintShown && (
              <motion.p
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex max-w-md items-start justify-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-sm italic text-amber-800 dark:bg-amber-500/10 dark:text-amber-300"
              >
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                {card.hint}
              </motion.p>
            )}
            <span className="absolute bottom-5 text-xs text-muted-foreground">
              Click card or press <kbd className="rounded border bg-muted px-1.5 py-0.5">Space</kbd> to flip
            </span>
          </div>
          {/* back (answer) */}
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border bg-amber-50 p-6 text-center shadow-sm dark:bg-amber-500/10"
            style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
          >
            <span className="text-xs font-medium uppercase tracking-widest text-amber-600">
              Answer
            </span>
            {card?.image_url && (
              <CardImage src={card.image_url} alt={`Image for: ${card.back}`} className="mt-1" />
            )}
            <p className="text-xl font-medium leading-relaxed sm:text-2xl">{card?.back}</p>
            <span className="absolute bottom-5 text-xs text-muted-foreground">
              How well did you know it?
            </span>
          </div>
        </button>
      </div>

      {/* ---------- Hint (question side only) ---------- */}
      {card?.hint && !flipped && (
        <div className="mt-3 flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            className={`h-8 gap-1.5 text-xs ${
              hintShown
                ? "text-amber-700 dark:text-amber-400"
                : "text-muted-foreground hover:text-amber-600"
            }`}
            onClick={() => setHintShown((h) => !h)}
            aria-pressed={hintShown}
          >
            <Lightbulb className="h-3.5 w-3.5" />
            {hintShown ? "Hide hint" : "Need a hint?"}
          </Button>
        </div>
      )}

      {/* ---------- Grade buttons ---------- */}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <Button
          variant="outline"
          size="lg"
          disabled={!flipped || busy}
          onClick={() => void review("wrong")}
          className="gap-2 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-500/10"
        >
          <X className="h-5 w-5" /> Again
          <kbd className="ml-1 hidden rounded border bg-muted px-1.5 text-xs sm:inline">1</kbd>
        </Button>
        <Button
          size="lg"
          disabled={!flipped || busy}
          onClick={() => void review("correct")}
          className="gap-2 bg-emerald-500 text-white hover:bg-emerald-600"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />} Got it
          <kbd className="ml-1 hidden rounded bg-white/20 px-1.5 text-xs sm:inline">2</kbd>
        </Button>
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        Reviews save automatically · Keyboard: <kbd className="rounded border bg-muted px-1">Space</kbd> flip,{" "}
        <kbd className="rounded border bg-muted px-1">1</kbd> again,{" "}
        <kbd className="rounded border bg-muted px-1">2</kbd> got it
      </p>
    </div>
  );
}
