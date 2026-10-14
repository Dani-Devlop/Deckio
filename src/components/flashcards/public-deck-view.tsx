"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  BookOpen,
  Layers,
  Lightbulb,
  Loader2,
  LogIn,
  RotateCw,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type { Deck, PublicCard, PublicDeck } from "@/lib/types";

import { BrandLogo } from "./deckio-app";

/** One flip-to-reveal preview card (local state only, nothing is recorded). */
function PreviewCard({ card, index, accent }: { card: PublicCard; index: number; accent: string }) {
  const [flipped, setFlipped] = useState(false);
  const [hintShown, setHintShown] = useState(false);

  return (
    <motion.button
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.04, 0.35), ease: "easeOut" }}
      onClick={() => setFlipped((f) => !f)}
      className={`relative min-h-36 rounded-xl border bg-card p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
        flipped ? "border-amber-300 dark:border-amber-500/40" : ""
      }`}
      aria-label={flipped ? `Show question: ${card.front}` : `Reveal answer for: ${card.front}`}
    >
      <span
        className="absolute inset-x-0 top-0 h-1 rounded-t-xl"
        style={{ backgroundColor: accent, opacity: flipped ? 1 : 0.45 }}
        aria-hidden
      />
      {flipped ? (
        <>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-amber-600">
            Answer
          </p>
          <p className="mt-2 text-sm font-medium leading-relaxed">{card.back}</p>
          <p className="mt-3 flex items-center gap-1 text-[10px] text-muted-foreground">
            <RotateCw className="h-2.5 w-2.5" /> click to flip back
          </p>
        </>
      ) : (
        <>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Question
          </p>
          <p className="mt-2 text-sm font-medium leading-relaxed">{card.front}</p>
          {card.hint && (
            <p className="mt-1.5 flex items-start gap-1 text-xs italic text-muted-foreground">
              <Lightbulb className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
              {card.hint}
            </p>
          )}
          {card.tags.length > 0 && (
            <span className="mt-2 flex flex-wrap gap-1">
              {card.tags.slice(0, 3).map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                >
                  {t}
                </span>
              ))}
            </span>
          )}
          <p className="mt-3 flex items-center gap-1 text-[10px] text-muted-foreground">
            click to reveal answer
          </p>
        </>
      )}
    </motion.button>
  );
}

/** Read-only deck preview for `/?share=<token>` — works logged-in or not. */
export function PublicDeckView({
  token,
  onClose,
  onSignIn,
}: {
  token: string;
  onClose: () => void;
  onSignIn: () => void;
}) {
  const user = useAppStore((s) => s.user);
  const go = useAppStore((s) => s.go);
  const [deck, setDeck] = useState<PublicDeck | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      setDeck(await api.publicDeck(token));
      setPhase("ready");
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Failed to load this deck.");
      setPhase("error");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Copy the public deck into the current account (bundle import). */
  async function importDeck() {
    if (!deck) return;
    setImporting(true);
    try {
      const bundle: Parameters<typeof api.decks.importBundle>[0] = {
        version: 1,
        app: "deckio",
        title: deck.title,
        description: deck.description,
        color: deck.color,
        icon: deck.icon,
        card_count: deck.card_count,
        cards: deck.cards.map((c) => ({
          front: c.front,
          back: c.back,
          tags: c.tags,
          hint: c.hint,
        })),
      };
      const created: Deck = await api.decks.importBundle(bundle);
      toast.success(`Imported “${created.title}” — ${created.card_count} cards due now`);
      onClose();
      go("deck", created.id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      {/* Minimal header — brand (or back) + auth CTA for anonymous visitors */}
      <div className="mb-6 flex items-center justify-between gap-3">
        {user ? (
          <Button variant="ghost" onClick={onClose} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Exit preview
          </Button>
        ) : (
          <BrandLogo onClick={onClose} />
        )}
        {!user && (
          <Button onClick={onSignIn} className="gap-1.5 bg-amber-500 text-white hover:bg-amber-600">
            <LogIn className="h-4 w-4" /> Sign in to import
          </Button>
        )}
      </div>

      {phase === "loading" && (
        <div className="space-y-4">
          <Skeleton className="h-40 rounded-2xl" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-36 rounded-xl" />
            ))}
          </div>
        </div>
      )}

      {phase === "error" && (
        <div className="mx-auto mt-10 max-w-md rounded-2xl border bg-card p-10 text-center">
          <span className="text-5xl" aria-hidden>
            🔒
          </span>
          <h1 className="mt-4 text-lg font-bold">This deck isn&apos;t available</h1>
          <p className="mt-2 text-sm text-muted-foreground">{message}</p>
          <Button className="mt-6 gap-1.5 bg-amber-500 text-white hover:bg-amber-600" onClick={onClose}>
            <Layers className="h-4 w-4" /> Go to Deckio
          </Button>
        </div>
      )}

      {phase === "ready" && deck && (
        <>
          {/* ---------- Public hero ---------- */}
          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <span
              className="block h-2 w-full"
              style={{ backgroundImage: `linear-gradient(90deg, ${deck.color}, ${deck.color}88)` }}
              aria-hidden
            />
            <div className="p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-4">
                  <span
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-3xl"
                    style={{ backgroundColor: `${deck.color}1f` }}
                    aria-hidden
                  >
                    {deck.icon}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="truncate text-2xl font-bold tracking-tight">{deck.title}</h1>
                      <Badge variant="outline" className="gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        <GlobeIcon /> shared deck
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {deck.description || "No description"}
                    </p>
                  </div>
                </div>
                {user && (
                  <Button
                    onClick={() => void importDeck()}
                    disabled={importing || deck.card_count === 0}
                    className="gap-1.5 bg-amber-500 text-white hover:bg-amber-600"
                  >
                    {importing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    Import this deck
                  </Button>
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <Badge variant="secondary" className="gap-1.5 py-1.5">
                  <BookOpen className="h-3.5 w-3.5" /> {deck.card_count} cards
                </Badge>
                <Badge variant="secondary" className="gap-1.5 py-1.5">
                  <RotateCw className="h-3.5 w-3.5" /> click cards to preview
                </Badge>
              </div>
            </div>
          </div>

          {/* ---------- Read-only cards ---------- */}
          {deck.card_count === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed py-14 text-center">
              <span className="text-4xl" aria-hidden>
                🃏
              </span>
              <p className="mt-3 text-sm text-muted-foreground">This deck has no cards yet.</p>
            </div>
          ) : (
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {deck.cards.map((c, i) => (
                <PreviewCard key={`${i}-${c.front}`} card={c} index={i} accent={deck.color} />
              ))}
            </div>
          )}

          <p className="mt-8 text-center text-xs text-muted-foreground">
            Shared with Deckio — smart flashcards for faster learning.
            {!user && (
              <>
                {" "}
                <button
                  onClick={onSignIn}
                  className="font-semibold text-amber-600 underline decoration-dotted underline-offset-4 hover:text-amber-700"
                >
                  Sign in or create a free account
                </button>{" "}
                to import it and track your progress.
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}

/** Tiny inline globe icon (avoids another lucide import at module top). */
function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  );
}
