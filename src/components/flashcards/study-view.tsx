"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Keyboard,
  Lightbulb,
  Loader2,
  RotateCcw,
  Sparkles,
  Trophy,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { ApiError, api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type { StudyNext, StudyStart, TypedAnswerOut } from "@/lib/types";
import type { ReviewResult } from "@/lib/types";

import { CardImage } from "./card-image";
import { ShortcutsDialog, shortcutBlocked } from "./shortcuts-dialog";

/** Self-paced study: flip card → self-grade, or typed (free-recall) mode →
 * type the answer and let the server grade it. */
export function StudyView({ deckId }: { deckId: number }) {
  const go = useAppStore((s) => s.go);
  const initialSrs = useAppStore((s) => s.studySrs);
  const initialTyping = useAppStore((s) => s.studyTyping);
  const [session, setSession] = useState<StudyStart | null>(null);
  const [isSrs, setIsSrs] = useState(initialSrs);
  const [isTyping] = useState(initialTyping); // fixed per mount; hash drives re-entry
  const [planNote, setPlanNote] = useState<string | null>(null); // limit reason from start
  const [current, setCurrent] = useState<StudyNext | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [results, setResults] = useState<ReviewResult[]>([]);
  const [phase, setPhase] = useState<"loading" | "playing" | "done" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hintShown, setHintShown] = useState(false); // per-card, reset on next
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // ---- Typed mode state ----
  const [typedAnswer, setTypedAnswer] = useState("");
  const [graded, setGraded] = useState<TypedAnswerOut | null>(null);
  const [shakeKey, setShakeKey] = useState(0); // bump → replay the shake animation
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  // Synchronous busy guard: window keydown + a focused button's native click
  // can BOTH fire for one Enter/Space press — state alone is too late.
  const busyRef = useRef(false);

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

  const claimBusy = useCallback(() => {
    if (busyRef.current) return false;
    busyRef.current = true;
    return true;
  }, []);

  // ---- Submit a review and move to the next card ----
  const review = useCallback(
    async (result: ReviewResult) => {
      if (!session || !current?.card || phaseRef.current !== "playing") return;
      if (!claimBusy()) return;
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
        busyRef.current = false;
        setBusy(false);
      }
    },
    [claimBusy, current, deckId, session]
  );

  // ---- Typed mode: submit the answer for server-side grading ----
  const checkTyped = useCallback(async () => {
    if (!session || !current?.card || graded || phaseRef.current !== "playing") return;
    const answer = typedAnswer.trim();
    if (!answer) {
      setShakeKey((k) => k + 1); // empty submit → shake, no API call
      return;
    }
    if (!claimBusy()) return;
    setBusy(true);
    try {
      const res = await api.study.typed(session.session_id, current.card.id, answer);
      setGraded(res);
      setResults((r) => [...r, res.correct ? "correct" : "wrong"]);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to check the answer");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [claimBusy, current, graded, session, typedAnswer]);

  /** "I was right" override for a wrong/almost grade — upserts the review as
   * correct (last grade wins) and fixes the local tally. */
  const overrideTyped = useCallback(async () => {
    if (!session || !current?.card || !graded || graded.correct) return;
    if (!claimBusy()) return;
    setBusy(true);
    try {
      await api.study.review(session.session_id, current.card.id, "correct");
      setGraded({ ...graded, correct: true });
      setResults((r) => {
        const copy = [...r];
        copy[copy.length - 1] = "correct";
        return copy;
      });
      toast.success("Marked as correct");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to update the review");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [claimBusy, current, graded, session]);

  /** Advance after a graded typed answer (Enter or the Next button). */
  const nextTyped = useCallback(async () => {
    if (!session || !graded || phaseRef.current !== "playing") return;
    if (!claimBusy()) return;
    setBusy(true);
    try {
      if (graded.finished) {
        setPhase("done");
      } else {
        const nc = await api.study.next(deckId, session.session_id);
        setCurrent(nc);
        setTypedAnswer("");
        setGraded(null);
        setHintShown(false);
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to load the next card");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [claimBusy, deckId, graded, session]);

  // ---- Keyboard shortcuts ----
  // Flip mode: Space/Enter = flip (question side) or "Got it" (answer side),
  // 1 = again, 2 = got it, "?" = cheat sheet.
  // Typed mode: Enter on the input checks (its own handler); Enter anywhere
  // after grading advances; "?" = cheat sheet. The guard ignores keystrokes
  // aimed at the input while it's focused.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (phaseRef.current !== "playing") return;
      if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen((o) => !o);
        return;
      }
      if (shortcutBlocked(e)) return;
      if (isTyping) {
        if (e.key === "Enter") {
          if (graded) {
            e.preventDefault();
            void nextTyped();
          } else if (document.activeElement?.tagName !== "INPUT") {
            e.preventDefault();
            void checkTyped();
          }
        }
        return;
      }
      if (e.code === "Space" || e.key === "Enter") {
        e.preventDefault(); // keep Space from scrolling the page
        if (flipped) void review("correct");
        else setFlipped(true);
      } else if (e.key === "1" || e.key === "ArrowLeft") {
        if (flipped) void review("wrong");
      } else if (e.key === "2" || e.key === "ArrowRight") {
        if (flipped) void review("correct");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [checkTyped, flipped, graded, isTyping, nextTyped, review]);

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
            <RotateCcw className="h-4 w-4" /> {isSrs ? "Review again" : isTyping ? "Practice again" : "Study again"}
          </Button>
          <Button variant="outline" onClick={() => go("deck", deckId)}>
            Back to deck
          </Button>
          <Button variant="ghost" onClick={() => go("stats")}>
            View stats
          </Button>
        </div>
        <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} mode="study" />
      </div>
    );
  }

  const card = current?.card;
  // Typed mode grades in place (current stays the same card until Next), so
  // prefer the graded response's counters to keep the progress bar honest.
  const reviewed = graded ? graded.reviewed : (current?.reviewed ?? 0);
  const total = current?.total ?? 0;
  const pct = total > 0 ? Math.round((reviewed / total) * 100) : 0;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={() => go("deck", deckId)} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> End session
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

      {isTyping ? (
        <>
          {/* ---------- Typed mode: question card (static) ---------- */}
          <div className="mt-6 flex min-h-64 flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border bg-card p-6 text-center shadow-sm">
            <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Type the answer
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
          </div>

          {/* ---------- Hint (until graded) ---------- */}
          {card?.hint && !graded && (
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

          {/* ---------- Answer input ---------- */}
          {!graded ? (
            <motion.div
              key={shakeKey}
              animate={shakeKey > 0 ? { x: [0, -7, 7, -5, 5, 0] } : { x: 0 }}
              transition={{ duration: 0.3 }}
              className="mt-5 flex flex-col gap-2 sm:flex-row"
            >
              <Input
                autoFocus
                value={typedAnswer}
                onChange={(e) => setTypedAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void checkTyped();
                  }
                }}
                disabled={busy}
                placeholder="Type the answer…"
                aria-label="Type the answer"
                autoComplete="off"
                className="h-12 rounded-xl text-lg focus-visible:ring-amber-400"
              />
              <Button
                onClick={() => void checkTyped()}
                disabled={busy}
                className="h-12 shrink-0 gap-1.5 rounded-xl bg-amber-500 px-6 text-white hover:bg-amber-600"
              >
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />} Check
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  void review("wrong");
                  setTypedAnswer("");
                  setGraded(null);
                }}
                className="h-12 shrink-0 rounded-xl text-muted-foreground"
              >
                Don't know
              </Button>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="mt-5 space-y-3"
            >
              {/* result banner */}
              <div
                className={`flex flex-wrap items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium ${
                  graded.correct
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : graded.almost
                      ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                      : "bg-rose-500/10 text-rose-700 dark:text-rose-300"
                }`}
                role="status"
              >
                {graded.correct ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                ) : graded.almost ? (
                  <Lightbulb className="h-5 w-5 shrink-0 text-amber-500" />
                ) : (
                  <XCircle className="h-5 w-5 shrink-0 text-rose-500" />
                )}
                {graded.correct
                  ? "Correct!"
                  : graded.almost
                    ? `So close — you typed “${graded.selected_answer}”, counted as wrong.`
                    : `Not quite — you typed “${graded.selected_answer}”.`}
                {!graded.correct && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto h-8 shrink-0 gap-1 border-amber-300 text-xs text-amber-700 hover:bg-amber-50 dark:border-amber-500/40 dark:text-amber-400 dark:hover:bg-amber-500/10"
                    disabled={busy}
                    onClick={() => void overrideTyped()}
                  >
                    <Check className="h-3.5 w-3.5" /> I was right
                  </Button>
                )}
              </div>
              {/* answer reveal */}
              <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border bg-amber-50 p-6 text-center shadow-sm dark:bg-amber-500/10">
                <span className="text-xs font-medium uppercase tracking-widest text-amber-600">Answer</span>
                {card?.image_url && (
                  <CardImage src={card.image_url} alt={`Image for: ${card.back}`} className="mt-1" />
                )}
                <p className="text-xl font-medium leading-relaxed sm:text-2xl">{graded.correct_answer}</p>
              </div>
              <Button
                onClick={() => void nextTyped()}
                disabled={busy}
                autoFocus
                className="h-12 w-full gap-1.5 rounded-xl bg-amber-500 text-base text-white hover:bg-amber-600"
              >
                {busy ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <ArrowRight className="h-5 w-5" />
                )}
                {graded.finished ? "See results" : "Next card"}
                <kbd className="ml-1 hidden rounded border border-white/40 bg-white/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white/90 sm:inline">
                  ⏎
                </kbd>
              </Button>
            </motion.div>
          )}
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Grading ignores case, spacing and punctuation · accents count ·{" "}
            <kbd className="rounded border bg-muted px-1">?</kbd> all shortcuts
          </p>
        </>
      ) : (
        <>
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

      {/* ---------- Grade buttons (keyboard: 1 = again, 2 = got it) ---------- */}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <Button
          variant="outline"
          size="lg"
          disabled={!flipped || busy}
          onClick={() => void review("wrong")}
          className="h-11 gap-2 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-500/10"
        >
          <X className="h-5 w-5" /> Again
          <kbd className="ml-1 hidden rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground sm:inline">
            1
          </kbd>
        </Button>
        <Button
          size="lg"
          disabled={!flipped || busy}
          onClick={() => void review("correct")}
          className="h-11 gap-2 bg-emerald-500 text-white hover:bg-emerald-600"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />} Got it
          <kbd className="ml-1 hidden rounded border border-white/40 bg-white/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white/90 sm:inline">
            2
          </kbd>
        </Button>
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        Reviews save automatically · Keyboard: <kbd className="rounded border bg-muted px-1">Space</kbd> flip,{" "}
        <kbd className="rounded border bg-muted px-1">1</kbd> again,{" "}
        <kbd className="rounded border bg-muted px-1">2</kbd> got it,{" "}
        <kbd className="rounded border bg-muted px-1">?</kbd> all shortcuts
      </p>
        </>
      )}

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} mode="study" typed={isTyping} />
    </div>
  );
}
