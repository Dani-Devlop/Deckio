"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellRing, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";

/** localStorage state for the reminder feature. */
type ReminderState = {
  enabled: boolean;
  lastNotified: { date: string; due: number } | null;
};

const STORAGE_KEY = "deckio_reminders";

function loadState(): ReminderState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as ReminderState;
  } catch {
    // corrupted state → start fresh
  }
  return { enabled: false, lastNotified: null };
}

function saveState(s: ReminderState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // private mode etc. — reminders just won't persist
  }
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Header bell for review reminders.
 *
 * Tracks the user's total due-card count (60 s poll + window focus) and —
 * once the user opts in — fires a browser Notification when due cards are
 * waiting (at most once per due-count change per day, so it never nags).
 */
export function ReminderBell({ onDueChange }: { onDueChange?: (due: number) => void }) {
  const [open, setOpen] = useState(false);
  const [due, setDue] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const stateRef = useRef<ReminderState>({ enabled: false, lastNotified: null });

  // Hydrate persisted state + current permission once on mount.
  useEffect(() => {
    const s = loadState();
    stateRef.current = s;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnabled(s.enabled);
    setPermission(
      typeof window.Notification === "undefined" ? "unsupported" : Notification.permission,
    );
  }, []);

  const maybeNotify = useCallback((dueCount: number) => {
    const s = stateRef.current;
    if (!s.enabled || dueCount <= 0) return;
    if (typeof window.Notification === "undefined" || Notification.permission !== "granted") return;
    const today = todayISO();
    const last = s.lastNotified;
    // Notify once per day per due-count (re-notify when the count GROWS).
    if (last && last.date === today && last.due >= dueCount) return;
    try {
      new Notification(`Deckio — ${dueCount} card${dueCount === 1 ? "" : "s"} due`, {
        body: "Your review is waiting. A quick smart review keeps your streak alive!",
        tag: "deckio-due", // replace rather than stack duplicates
      });
    } catch {
      return; // some browsers throw on missing SW — ignore
    }
    stateRef.current = { ...s, lastNotified: { date: today, due: dueCount } };
    saveState(stateRef.current);
  }, []);

  // Poll the due count (60 s) and refresh on focus.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const o = await api.stats.overview();
        if (cancelled) return;
        setDue(o.due_cards);
        onDueChange?.(o.due_cards);
        maybeNotify(o.due_cards);
      } catch {
        // offline / logged out — silent, retried on the next tick
      }
    };
    void tick();
    const id = window.setInterval(tick, 60_000);
    const onFocus = () => void tick();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [maybeNotify, onDueChange]);

  async function toggle(next: boolean) {
    if (next) {
      if (typeof window.Notification === "undefined") {
        toast.error("This browser doesn't support notifications.");
        return;
      }
      let perm = Notification.permission;
      if (perm === "default") {
        perm = await Notification.requestPermission();
      }
      setPermission(perm);
      if (perm !== "granted") {
        toast.error("Notification permission was not granted.");
        return;
      }
      toast.success("Review reminders enabled 🔔");
    } else {
      toast("Review reminders turned off");
    }
    stateRef.current = { ...stateRef.current, enabled: next };
    setEnabled(next);
    saveState(stateRef.current);
  }

  const dueLabel =
    due === null ? "Checking due cards…" : due > 0 ? `${due} card${due === 1 ? "" : "s"} due right now` : "Nothing due — you're all caught up 🎉";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={`Review reminders. ${dueLabel}`}
        >
          {enabled ? <BellRing className="h-5 w-5 text-amber-500" /> : <Bell className="h-5 w-5" />}
          {/* amber dot whenever cards are waiting */}
          {due !== null && due > 0 && (
            <span
              aria-hidden
              className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-background"
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <BellRing className="h-4 w-4 text-amber-500" /> Review reminders
            </p>
            <Switch
              checked={enabled}
              onCheckedChange={(v) => void toggle(v)}
              aria-label="Enable browser notifications for due cards"
              disabled={permission === "unsupported"}
            />
          </div>
          <p
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium ${
              due !== null && due > 0
                ? "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300"
                : "bg-muted text-muted-foreground"
            }`}
            aria-live="polite"
          >
            {due !== null && due > 0 ? <RefreshCw className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
            {dueLabel}
          </p>
          <Separator />
          <p className="text-[11px] leading-snug text-muted-foreground">
            When enabled, Deckio sends a browser notification while cards are waiting — checked
            every minute and when you return to this tab. Only one notification per day per
            due-count, never a barrage.
          </p>
          {permission === "denied" && (
            <p className="text-[11px] font-medium text-rose-600">
              Notifications are blocked for this site — enable them in your browser settings.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
