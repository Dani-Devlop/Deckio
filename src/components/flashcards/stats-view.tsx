"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
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

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api } from "@/lib/api";
import { accuracyBg, accuracyColor, dayLabel, timeAgo } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import type { ActivityDay, Deck, StatsOverview, WeakCard } from "@/lib/types";

/** Days fetched for the heatmap — 26 full weeks (fills the card nicely). */
const HEATMAP_DAYS = 182;

/** Emerald color scale for the heatmap (index 1..4, 0 = empty). */
const HEAT_COLORS = ["", "#a7f3d0", "#6ee7b7", "#34d399", "#059669"];

/** GitHub-style review heatmap: weeks × 7 days, oldest → newest, column per week. */
function Heatmap({ activity }: { activity: ActivityDay[] }) {
  const { weeks, monthLabels, total } = useMemo(() => {
    const byDate = new Map(activity.map((a) => [a.date, a]));
    // The activity array is exactly `HEATMAP_DAYS` long and ends today (UTC).
    const last = activity.length ? activity[activity.length - 1] : null;
    const end = last ? new Date(`${last.date}T00:00:00`) : new Date();
    // Pad the start so each column is a full Sun→Sat week.
    const startOffsetDays = HEATMAP_DAYS - 1;
    const start = new Date(end);
    start.setDate(start.getDate() - startOffsetDays);
    while (start.getDay() !== 0) start.setDate(start.getDate() - 1); // back to Sunday

    const cols: ActivityDay[][] = [];
    const labels: { text: string; col: number }[] = [];
    let cursor = new Date(start);
    let lastMonth = -1;
    while (cursor <= end) {
      const col: ActivityDay[] = [];
      for (let dow = 0; dow < 7; dow++) {
        if (cursor > end) break;
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
        col.push(
          byDate.get(key) ?? { date: key, reviews: 0, correct: 0 }
        );
        if (dow === 0 && cursor.getMonth() !== lastMonth) {
          labels.push({
            text: cursor.toLocaleDateString(undefined, { month: "short" }),
            col: cols.length,
          });
          lastMonth = cursor.getMonth();
        }
        cursor.setDate(cursor.getDate() + 1);
      }
      cols.push(col);
    }
    const sum = activity.reduce((acc, a) => acc + a.reviews, 0);
    return { weeks: cols, monthLabels: labels, total: sum };
  }, [activity]);

  const max = Math.max(1, ...activity.map((a) => a.reviews));

  return (
    <div>
      <div className="nice-scrollbar overflow-x-auto pb-1">
        {/* Fixed-size cells, centered like GitHub's contribution graph; the
            inner width keeps cells square and scrolls on narrow screens. */}
        <div className="mx-auto w-fit min-w-max">
          {/* Month labels row */}
          <div className="flex gap-[3px] pl-7">
            {weeks.map((_, i) => (
              <div key={i} className="relative w-3 shrink-0 text-[10px] text-muted-foreground">
                {monthLabels.find((m) => m.col === i) && (
                  <span className="absolute left-0 top-0 whitespace-nowrap">
                    {monthLabels.find((m) => m.col === i)!.text}
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-[3px]">
            {/* Weekday labels column */}
            <div className="flex w-7 shrink-0 flex-col gap-[3px] text-[10px] leading-3 text-muted-foreground">
              {["Sun", "", "Tue", "", "Thu", "", "Sat"].map((d, i) => (
                <span key={i} className="h-3">
                  {d}
                </span>
              ))}
            </div>
            {weeks.map((col, ci) => (
              <div key={ci} className="flex w-3 shrink-0 flex-col gap-[3px]">
                {col.map((day) => {
                  const level =
                    day.reviews === 0 ? 0 : Math.min(4, Math.ceil((day.reviews / max) * 4));
                  return (
                    <span
                      key={day.date}
                      className={`h-3 w-3 rounded-[3px] transition-transform hover:scale-125 hover:ring-2 hover:ring-amber-500/60 ${
                        level === 0 ? "bg-muted" : ""
                      }`}
                      style={{ backgroundColor: level ? HEAT_COLORS[level] : undefined }}
                      title={`${day.date}: ${day.reviews} review${day.reviews === 1 ? "" : "s"} (${day.correct} correct)`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {total} review{total === 1 ? "" : "s"} in 26 weeks
        </span>
        <span className="flex items-center gap-1">
          Less
          {[0, 1, 2, 3, 4].map((lvl) => (
            <span
              key={lvl}
              className={`h-3 w-3 rounded-[3px] ${lvl === 0 ? "bg-muted" : ""}`}
              style={lvl ? { backgroundColor: HEAT_COLORS[lvl] } : undefined}
              aria-hidden
            />
          ))}
          More
        </span>
      </div>
    </div>
  );
}

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
      // 91-day window powers both the heatmap and (sliced) the weekly bars.
      const [o, w, d] = await Promise.all([
        api.stats.overview(HEATMAP_DAYS),
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
  const last7 = overview.activity.slice(-7); // weekly bars + "This week" KPI
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
          icon={AlertCircle}
          label="Due today"
          value={overview.due_cards}
          accent="bg-amber-100 text-amber-600"
          sub={overview.due_cards > 0 ? "smart review ready" : "all caught up 🎉"}
        />
        <Kpi
          icon={BookOpen}
          label="This week"
          value={last7.reduce((sum, a) => sum + a.reviews, 0)}
          accent="bg-teal-100 text-teal-600"
          sub="reviews in 7 days"
        />
      </div>

      {/* ---------- Review heatmap (26 weeks) ---------- */}
      <section className="mt-6 rounded-2xl border bg-card p-6" aria-label="Review heatmap, last 26 weeks">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Review heatmap</h2>
          <Badge variant="outline" className="gap-1 text-xs text-muted-foreground">
            last 26 weeks
          </Badge>
        </div>
        <div className="mt-5">
          <Heatmap activity={overview.activity} />
        </div>
      </section>

      {/* ---------- Activity chart ---------- */}
      <section className="mt-6 rounded-2xl border bg-card p-6" aria-label="Activity last 7 days">
        <h2 className="font-semibold">Activity — last 7 days</h2>
        {/* Columns are h-full so the bar's percentage height resolves against a
            definite height — `items-end` on the row alone collapses it to 0. */}
        <div className="mt-5 flex h-40 gap-3">
          {last7.map((day) => {
            const h = Math.round((day.reviews / maxActivity) * 100);
            return (
              <div key={day.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  {day.reviews > 0 ? day.reviews : ""}
                </span>
                <div
                  className={`w-full rounded-t-md transition-all ${
                    day.reviews > 0
                      ? "bg-gradient-to-t from-emerald-500 to-emerald-300"
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
