"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Flame,
  Layers,
  LineChart,
  Play,
  Target,
  Trophy,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api } from "@/lib/api";
import { accuracyBg, accuracyColor, dayLabel, timeAgo } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import type { Deck, StatsOverview, WeakCard } from "@/lib/types";

/** KPI tile. */
function Kpi({
  icon: Icon,
  label,
  value,
  accent,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  accent: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${accent}`}>
          <Icon className="h-4 w-4" />
        </span>
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** Learning analytics: overview KPIs, 7-day activity, weak cards, deck breakdown. */
export function StatsView() {
  const go = useAppStore((s) => s.go);
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [weak, setWeak] = useState<WeakCard[] | null>(null);
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, w, d] = await Promise.all([
        api.stats.overview(),
        api.stats.weakCards(),
        api.decks.list(),
      ]);
      setOverview(o);
      setWeak(w);
      setDecks(d);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load statistics.");
    }
  }, []);

  useEffect(() => {
    // Initial load on mount — setState happens asynchronously after awaits.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-10">
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}{" "}
          <button className="font-semibold underline" onClick={() => void load()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!overview || weak === null || decks === null) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-8">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  const maxActivity = Math.max(1, ...overview.activity.map((a) => a.reviews));
  const decksByAccuracy = [...decks]
    .filter((d) => d.accuracy != null && d.reviews_count > 0)
    .sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0));

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <Button variant="ghost" onClick={() => go("decks")} className="mb-3 gap-1.5">
        <ArrowLeft className="h-4 w-4" /> All decks
      </Button>
      <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
        <LineChart className="h-6 w-6 text-amber-500" /> Learning stats
      </h1>

      {/* ---------- KPI grid ---------- */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi icon={Layers} label="Decks" value={overview.total_decks} accent="bg-amber-100 text-amber-600" />
        <Kpi icon={BookOpen} label="Cards" value={overview.total_cards} accent="bg-orange-100 text-orange-600" />
        <Kpi
          icon={Zap}
          label="Reviews"
          value={overview.total_reviews}
          accent="bg-emerald-100 text-emerald-600"
          sub={`${overview.correct_reviews} correct`}
        />
        <Kpi
          icon={Target}
          label="Accuracy"
          value={overview.accuracy != null ? `${overview.accuracy}%` : "—"}
          accent="bg-rose-100 text-rose-600"
        />
        <Kpi
          icon={Flame}
          label="Streak"
          value={`${overview.streak_days} day${overview.streak_days === 1 ? "" : "s"}`}
          accent="bg-amber-100 text-amber-600"
          sub={overview.streak_days > 0 ? "Keep it going! 🔥" : "Study today to start one"}
        />
        <Kpi
          icon={Trophy}
          label="Mastered"
          value={overview.mastered_cards}
          accent="bg-emerald-100 text-emerald-600"
          sub="≥80% over 3+ reviews"
        />
        <Kpi
          icon={Play}
          label="Sessions"
          value={overview.total_sessions}
          accent="bg-violet-100 text-violet-600"
        />
        <Kpi
          icon={BookOpen}
          label="This week"
          value={overview.activity.reduce((sum, a) => sum + a.reviews, 0)}
          accent="bg-teal-100 text-teal-600"
          sub="reviews in 7 days"
        />
      </div>

      {/* ---------- Activity chart ---------- */}
      <section className="mt-6 rounded-2xl border bg-card p-6" aria-label="Activity last 7 days">
        <h2 className="font-semibold">Activity — last 7 days</h2>
        <div className="mt-5 flex h-40 items-end gap-3">
          {overview.activity.map((day) => {
            const h = Math.round((day.reviews / maxActivity) * 100);
            return (
              <div key={day.date} className="flex flex-1 flex-col items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  {day.reviews > 0 ? day.reviews : ""}
                </span>
                <div
                  className={`w-full rounded-t-md transition-all ${
                    day.reviews > 0
                      ? "bg-gradient-to-t from-emerald-400 to-emerald-300"
                      : "bg-muted"
                  }`}
                  style={{ height: `${Math.max(h, day.reviews > 0 ? 8 : 3)}%` }}
                  title={`${day.date}: ${day.reviews} reviews (${day.correct} correct)`}
                />
                <span className="text-xs text-muted-foreground">{dayLabel(day.date)}</span>
              </div>
            );
          })}
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* ---------- Weak cards ---------- */}
        <section className="rounded-2xl border bg-card p-6" aria-label="Weak cards">
          <h2 className="flex items-center gap-2 font-semibold">
            <Target className="h-4.5 w-4.5 text-rose-500" /> Cards to review again
          </h2>
          {weak.length === 0 ? (
            <div className="mt-6 flex flex-col items-center py-8 text-center">
              <span className="text-4xl" aria-hidden>
                🎉
              </span>
              <p className="mt-3 text-sm text-muted-foreground">
                No weak cards — you&apos;re doing great!
              </p>
              <p className="text-xs text-muted-foreground">Cards you answer wrong will appear here.</p>
            </div>
          ) : (
            <ul className="nice-scrollbar mt-4 max-h-80 space-y-2 overflow-y-auto pr-1">
              {weak.map((w) => (
                <li
                  key={w.card_id}
                  className="rounded-xl border p-3 transition hover:border-rose-200 hover:bg-rose-50/40 dark:hover:bg-rose-500/5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{w.front}</p>
                      <p className="truncate text-xs text-muted-foreground">{w.back}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${accuracyBg(w.accuracy)}`}>
                      {w.accuracy}%
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <Badge variant="outline" className="max-w-40 truncate gap-1">
                      {w.deck_title}
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 px-2 text-xs text-amber-600 hover:text-amber-700"
                      onClick={() => go("study", w.deck_id)}
                    >
                      <Play className="h-3 w-3" /> Practice
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---------- Deck breakdown ---------- */}
        <section className="rounded-2xl border bg-card p-6" aria-label="Deck accuracy">
          <h2 className="flex items-center gap-2 font-semibold">
            <Layers className="h-4.5 w-4.5 text-amber-500" /> Deck accuracy
          </h2>
          {decksByAccuracy.length === 0 ? (
            <div className="mt-6 flex flex-col items-center py-8 text-center">
              <span className="text-4xl" aria-hidden>
                📊
              </span>
              <p className="mt-3 text-sm text-muted-foreground">
                Study a deck to see accuracy breakdowns here.
              </p>
            </div>
          ) : (
            <ul className="mt-4 space-y-3">
              {decksByAccuracy.map((d) => (
                <li key={d.id}>
                  <button
                    className="w-full rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                    onClick={() => go("deck", d.id)}
                  >
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span aria-hidden>{d.icon}</span>
                        <span className="truncate font-medium">{d.title}</span>
                      </span>
                      <span className={`shrink-0 font-semibold ${accuracyColor(d.accuracy)}`}>
                        {d.accuracy}%
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${d.accuracy ?? 0}%`,
                          backgroundColor: d.accuracy != null && d.accuracy >= 80 ? "#10b981" : d.accuracy != null && d.accuracy >= 60 ? "#f59e0b" : "#f43f5e",
                        }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {d.reviews_count} reviews · last studied {timeAgo(d.last_studied_at)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
