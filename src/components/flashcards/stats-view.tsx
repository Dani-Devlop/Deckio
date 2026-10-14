"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Brain,
  Download,
  Flame,
  History,
  Layers,
  LineChart,
  Loader2,
  Pencil,
  Play,
  Sparkles,
  Target,
  Trophy,
  Zap,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api } from "@/lib/api";
import { accuracyBg, accuracyColor, dayLabel, formatDuration, timeAgo } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import type { ActivityDay, Deck, SessionSummary, StatsOverview, WeakCard } from "@/lib/types";

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

/** Animated SVG progress ring for the daily goal (emerald when complete). */
function GoalRing({ today, goal }: { today: number; goal: number }) {
  const pct = goal > 0 ? Math.min(1, today / goal) : 0;
  const done = today >= goal && goal > 0;
  const SIZE = 132;
  const STROKE = 11;
  const R = (SIZE - STROKE) / 2;
  const CIRC = 2 * Math.PI * R;

  return (
    <div className="relative" style={{ width: SIZE, height: SIZE }} role="img"
      aria-label={`Daily goal: ${today} of ${goal} reviews (${Math.round(pct * 100)}%)`}>
      <svg width={SIZE} height={SIZE} className="-rotate-90">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" strokeWidth={STROKE}
          className="stroke-muted" />
        <motion.circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          stroke={done ? "#10b981" : "#f59e0b"}
          strokeDasharray={CIRC}
          initial={{ strokeDashoffset: CIRC }}
          animate={{ strokeDashoffset: CIRC * (1 - pct) }}
          transition={{ duration: 0.9, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {done ? (
          <span className="text-3xl" aria-hidden>🎉</span>
        ) : (
          <p className="text-2xl font-bold tabular-nums">{today}<span className="text-sm font-medium text-muted-foreground">/{goal}</span></p>
        )}
        <p className="text-[11px] text-muted-foreground">{done ? "Goal reached!" : "reviews today"}</p>
      </div>
    </div>
  );
}

/** Learning analytics: overview KPIs, 7-day activity, weak cards, deck breakdown. */
export function StatsView() {
  const go = useAppStore((s) => s.go);
  const updateUser = useAppStore((s) => s.updateUser);
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [weak, setWeak] = useState<WeakCard[] | null>(null);
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [goalOpen, setGoalOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const goalToastFired = useRef(false);

  const load = useCallback(async () => {
    try {
      // 182-day window powers both the heatmap and (sliced) the weekly bars.
      const [o, w, d, s] = await Promise.all([
        api.stats.overview(HEATMAP_DAYS),
        api.stats.weakCards(),
        api.decks.list(),
        api.stats.sessions(10),
      ]);
      setOverview(o);
      setWeak(w);
      setDecks(d);
      setSessions(s);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load statistics.");
    }
  }, []);

  useEffect(() => {
    // Initial load on mount — setState happens asynchronously after awaits.
    void load();
  }, [load]);

  // Celebrate hitting the daily goal — at most once per visit to this view.
  useEffect(() => {
    if (
      overview &&
      overview.daily_goal > 0 &&
      overview.today_reviews >= overview.daily_goal &&
      !goalToastFired.current
    ) {
      goalToastFired.current = true;
      toast.success(`Daily goal reached — ${overview.today_reviews} reviews today! 🎉`);
    }
  }, [overview]);

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

  /** Download the full review history as CSV (all decks). */
  async function exportReviews() {
    setExporting(true);
    try {
      await api.exportReviewsCsv();
      toast.success("Review history exported");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  if (!overview || weak === null || decks === null || sessions === null) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-8">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
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
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <LineChart className="h-6 w-6 text-amber-500" /> Learning stats
          </h1>
          {(overview.streak_days > 0 || overview.longest_streak_days > 0) && (
            <motion.span
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              title="Consecutive days with at least one review"
              className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-amber-500/15 to-orange-500/15 px-3 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400"
            >
              <Flame className="h-3.5 w-3.5 fill-current" />
              {overview.streak_days}-day streak
              {overview.streak_days > 0 && overview.longest_streak_days > overview.streak_days && (
                <span className="font-normal opacity-75">· best {overview.longest_streak_days}</span>
              )}
            </motion.span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void exportReviews()}
          disabled={exporting}
          className="shrink-0 gap-1.5"
          aria-label="Export review history as CSV"
        >
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          <span className="hidden sm:inline">Export CSV</span>
        </Button>
      </div>

      {/* ---------- Daily goal ring ---------- */}
      <section className="mt-6 rounded-2xl border bg-card p-6" aria-label="Daily review goal">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:gap-8">
          <GoalRing today={overview.today_reviews} goal={overview.daily_goal} />
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <h2 className="flex items-center gap-2 font-semibold">
                <Target className="h-4.5 w-4.5 text-amber-500" /> Daily goal
              </h2>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                onClick={() => setGoalOpen(true)}
              >
                <Pencil className="h-3 w-3" /> Edit
              </Button>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {overview.today_reviews >= overview.daily_goal ? (
                <>
                  🎉 <span className="font-semibold text-emerald-600">Goal reached!</span>{" "}
                  {overview.today_reviews} reviews today — every extra one is a bonus for
                  tomorrow&apos;s memory.
                </>
              ) : overview.today_reviews > 0 ? (
                <>
                  <span className="font-semibold text-foreground">
                    {overview.daily_goal - overview.today_reviews} more
                  </span>{" "}
                  review{overview.daily_goal - overview.today_reviews === 1 ? "" : "s"} to hit
                  today&apos;s goal — a quick smart review should do it.
                </>
              ) : (
                <>
                  No reviews yet today — {overview.daily_goal} is today&apos;s target. You&apos;ve got
                  this! 💪
                </>
              )}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Current streak: {overview.streak_days} day{overview.streak_days === 1 ? "" : "s"} ·{" "}
              {overview.due_cards} card{overview.due_cards === 1 ? "" : "s"} due right now
            </p>
          </div>
        </div>
      </section>

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

      {/* ---------- Recent sessions ---------- */}
      <section className="mt-6 rounded-2xl border bg-card p-6" aria-label="Recent study sessions">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-semibold">
            <History className="h-4.5 w-4.5 text-teal-600" /> Recent sessions
          </h2>
          <Badge variant="outline" className="text-xs text-muted-foreground">
            last {sessions.length}
          </Badge>
        </div>
        {sessions.length === 0 ? (
          <div className="mt-6 flex flex-col items-center py-8 text-center">
            <span className="text-4xl" aria-hidden>
              🕐
            </span>
            <p className="mt-3 text-sm text-muted-foreground">
              No study sessions yet — open a deck and hit “Study”.
            </p>
          </div>
        ) : (
          <ul className="mt-4 divide-y">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    s.mode === "quiz"
                      ? "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400"
                      : "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400"
                  }`}
                  aria-hidden
                >
                  {s.mode === "quiz" ? <Brain className="h-4.5 w-4.5" /> : <BookOpen className="h-4.5 w-4.5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                    <button
                      className="truncate rounded outline-none transition-colors hover:text-amber-600 focus-visible:ring-2 focus-visible:ring-amber-500"
                      onClick={() => go("deck", s.deck_id)}
                    >
                      {s.deck_title}
                    </button>
                    {s.srs && (
                      <span
                        className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                        title="Spaced-repetition smart review"
                      >
                        <Sparkles className="h-2.5 w-2.5" /> SRS
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {timeAgo(s.started_at)}
                    {s.duration_seconds != null && s.duration_seconds > 1
                      ? ` · ${formatDuration(s.duration_seconds)}`
                      : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`text-sm font-semibold ${accuracyColor(s.accuracy)}`}>
                    {s.accuracy != null ? `${s.accuracy}%` : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {s.reviews} review{s.reviews === 1 ? "" : "s"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------- Edit daily goal ---------- */}
      <GoalEditDialog
        open={goalOpen}
        onOpenChange={setGoalOpen}
        current={overview.daily_goal}
        onSaved={(updated) => {
          updateUser(updated);
          setOverview((o) => (o ? { ...o, daily_goal: updated.daily_goal } : o));
        }}
      />
    </div>
  );
}

/** Edit the daily review goal — slider + presets, saved via PUT /auth/goal. */
function GoalEditDialog({
  open,
  onOpenChange,
  current,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: number;
  onSaved: (user: import("@/lib/types").User) => void;
}) {
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setValue(current);
  }, [current, open]);

  async function save() {
    const goal = Math.max(1, Math.min(500, Math.round(value)));
    setBusy(true);
    try {
      const updated = await api.setGoal(goal);
      onSaved(updated);
      toast.success(`Daily goal set to ${goal} reviews`);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to update the goal.");
    } finally {
      setBusy(false);
    }
  }

  const presets = [10, 20, 30, 50, 100];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="h-4.5 w-4.5 text-amber-500" /> Daily review goal
          </DialogTitle>
          <DialogDescription>
            A small daily target keeps the streak alive. Reviews in study and quiz sessions both
            count.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="flex items-center justify-center gap-2">
            <Input
              type="number"
              min={1}
              max={500}
              value={value}
              onChange={(e) => setValue(Number(e.target.value))}
              className="w-24 text-center text-lg font-bold"
              aria-label="Daily goal in reviews"
            />
            <span className="text-sm text-muted-foreground">reviews / day</span>
          </div>
          <Slider
            value={[Math.min(value, 200)]}
            min={1}
            max={200}
            step={1}
            onValueChange={(v) => setValue(v[0])}
            aria-label="Daily goal slider"
          />
          <div className="flex flex-wrap justify-center gap-1.5">
            {presets.map((p) => (
              <button
                key={p}
                onClick={() => setValue(p)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  value === p
                    ? "border-amber-400 bg-amber-100 text-amber-800 dark:border-amber-500/50 dark:bg-amber-500/15 dark:text-amber-300"
                    : "text-muted-foreground hover:border-amber-300 hover:text-foreground"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            disabled={busy || !Number.isFinite(value) || value < 1 || value > 500}
            className="bg-amber-500 text-white hover:bg-amber-600"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save goal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
