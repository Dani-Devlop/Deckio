/** Small formatting helpers shared across views. */

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "never";
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function accuracyColor(acc: number | null | undefined): string {
  if (acc == null) return "text-muted-foreground";
  if (acc >= 80) return "text-emerald-600";
  if (acc >= 60) return "text-amber-600";
  return "text-rose-600";
}

export function accuracyBg(acc: number | null | undefined): string {
  if (acc == null) return "bg-muted text-muted-foreground";
  if (acc >= 80) return "bg-emerald-100 text-emerald-700";
  if (acc >= 60) return "bg-amber-100 text-amber-700";
  return "bg-rose-100 text-rose-700";
}

/** Day-of-week label from a YYYY-MM-DD string. */
export function dayLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

/** Human label for a card's SRS state from its due_at timestamp.
 * null → "new" (due immediately); past → "due"; future → "in 3d" / "in 12h". */
export function dueLabel(dueAt: string | null): string {
  if (!dueAt) return "new";
  const due = new Date(dueAt).getTime();
  if (Number.isNaN(due)) return "new";
  const diff = due - Date.now();
  if (diff <= 0) return "due";
  const hours = Math.ceil(diff / 3_600_000);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(diff / 86_400_000);
  return `in ${days}d`;
}
