"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Brain,
  Clock,
  CopyPlus,
  Loader2,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  Search,
  Sparkles,
  Target,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import { accuracyColor, timeAgo } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import type { Deck, StatsOverview } from "@/lib/types";

export const DECK_COLORS = ["#f59e0b", "#f97316", "#f43f5e", "#10b981", "#14b8a6", "#8b5cf6"];
export const DECK_ICONS = ["📚", "🧠", "🌱", "⚡", "🎯", "💼", "🗣️", "🧪", "🎨", "🧮", "🌍", "🏰"];

/** Create / edit deck dialog with color + emoji pickers. */
export function DeckFormDialog({
  open,
  onOpenChange,
  deck,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deck: Deck | null;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(DECK_COLORS[0]);
  const [icon, setIcon] = useState(DECK_ICONS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill when (re)opening for edit; reset when creating.
  useEffect(() => {
    if (open) {
      setTitle(deck?.title ?? "");
      setDescription(deck?.description ?? "");
      setColor(deck?.color ?? DECK_COLORS[0]);
      setIcon(deck?.icon ?? DECK_ICONS[0]);
      setError(null);
    }
  }, [deck, open]);

  async function save() {
    if (!title.trim()) {
      setError("Give your deck a title.");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        color,
        icon,
      };
      if (deck) {
        await api.decks.update(deck.id, payload);
        toast.success("Deck updated");
      } else {
        await api.decks.create(payload);
        toast.success("Deck created");
      }
      onOpenChange(false);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save the deck.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{deck ? "Edit deck" : "New deck"}</DialogTitle>
          <DialogDescription>
            {deck ? "Update the deck's details." : "Create a deck to start adding flashcards."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="deck-title">Title</Label>
            <Input
              id="deck-title"
              placeholder="e.g. Spanish Basics"
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deck-desc">Description (optional)</Label>
            <Textarea
              id="deck-desc"
              placeholder="What is this deck about?"
              rows={2}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Color</Label>
            <div className="flex gap-2" role="radiogroup" aria-label="Deck color">
              {DECK_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(c)}
                  className={`h-8 w-8 rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-amber-500 ${
                    color === c ? "ring-2 ring-offset-2 ring-foreground/60" : ""
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Icon</Label>
            <div className="grid grid-cols-6 gap-1.5" role="radiogroup" aria-label="Deck icon">
              {DECK_ICONS.map((i) => (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={icon === i}
                  aria-label={`Icon ${i}`}
                  onClick={() => setIcon(i)}
                  className={`flex h-9 items-center justify-center rounded-lg border text-lg transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                    icon === i ? "border-amber-400 bg-amber-50 dark:bg-amber-500/10" : ""
                  }`}
                >
                  {i}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy} className="bg-amber-500 text-white hover:bg-amber-600">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {deck ? "Save changes" : "Create deck"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One deck card in the dashboard grid. */
function DeckCard({
  deck,
  onOpen,
  onStudy,
  onEdit,
  onDuplicate,
  onDelete,
  duplicating,
}: {
  deck: Deck;
  onOpen: () => void;
  onStudy: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  duplicating: boolean;
}) {
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition hover:shadow-md">
      {/* color accent strip */}
      <span className="h-1.5 w-full" style={{ backgroundColor: deck.color }} aria-hidden />
      {duplicating && (
        <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-background/70 backdrop-blur-[2px]" aria-live="polite">
          <Loader2 className="h-5 w-5 animate-spin text-amber-500" />
          <span className="text-sm font-medium text-muted-foreground">Copying cards…</span>
        </div>
      )}
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-2">
          <button
            onClick={onOpen}
            className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            aria-label={`Open deck ${deck.title}`}
          >
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl"
              style={{ backgroundColor: `${deck.color}1f`, color: deck.color }}
              aria-hidden
            >
              {deck.icon}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-semibold text-foreground">{deck.title}</span>
              <span className="mt-0.5 line-clamp-2 block min-h-[2.4rem] text-sm text-muted-foreground">
                {deck.description || "No description"}
              </span>
            </span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                aria-label={`Deck ${deck.title} options`}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="h-4 w-4" /> Edit deck
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate} disabled={deck.card_count === 0}>
                <CopyPlus className="h-4 w-4" /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onDelete} className="text-rose-600 focus:text-rose-600">
                <Trash2 className="h-4 w-4" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <BookOpen className="h-3.5 w-3.5" /> {deck.card_count} cards
          </span>
          <span className={`inline-flex items-center gap-1 ${accuracyColor(deck.accuracy)}`}>
            <Target className="h-3.5 w-3.5" />
            {deck.accuracy != null ? `${deck.accuracy}%` : "no reviews"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" /> {timeAgo(deck.last_studied_at)}
          </span>
          {deck.due_count > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
              <Sparkles className="h-3 w-3" /> {deck.due_count} due
            </span>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button
            size="sm"
            onClick={onStudy}
            className="gap-1.5 bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
            disabled={deck.card_count === 0}
          >
            <Play className="h-3.5 w-3.5" /> Study
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={deck.card_count === 0}
            onClick={onOpen}
          >
            <Brain className="h-3.5 w-3.5" /> Quiz
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Dashboard: list, search, sort, create / edit / delete decks. */
export function DashboardView() {
  const go = useAppStore((s) => s.go);
  const goStudy = useAppStore((s) => s.goStudy);
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "name" | "cards">("newest");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Deck | null>(null);
  const [deleting, setDeleting] = useState<Deck | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [duplicating, setDuplicating] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setDecks(await api.decks.list());
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Failed to load decks.");
      setDecks([]);
    }
    // Summary strip is secondary — never block the deck grid on it.
    api.stats
      .overview()
      .then(setOverview)
      .catch(() => setOverview(null));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep due counts fresh: poll every 60s and refetch when the tab regains
  // focus (a 10-min relearn card can come due while the user idles here).
  useEffect(() => {
    const interval = window.setInterval(() => void load(), 60_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  async function duplicate(deck: Deck) {
    setDuplicating(deck.id);
    try {
      const copy = await api.decks.duplicate(deck.id);
      toast.success(`Duplicated “${deck.title}” — ${copy.card_count} cards ready to study`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to duplicate the deck.");
    } finally {
      setDuplicating(null);
    }
  }

  const visible = useMemo(() => {
    if (!decks) return [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? decks.filter(
          (d) => d.title.toLowerCase().includes(q) || (d.description ?? "").toLowerCase().includes(q)
        )
      : decks;
    const sorted = [...filtered];
    if (sort === "name") sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === "cards") sorted.sort((a, b) => b.card_count - a.card_count);
    else
      sorted.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    return sorted;
  }, [decks, query, sort]);

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.decks.remove(deleting.id);
      toast.success(`Deleted “${deleting.title}”`);
      setDeleting(null);
      void load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to delete deck");
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      {/* ---------- Toolbar ---------- */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Your decks</h1>
          {decks && (
            <Badge variant="secondary" className="mt-1">
              {decks.length}
            </Badge>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search decks…"
              className="pl-9 sm:w-56"
              aria-label="Search decks"
            />
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
            <SelectTrigger className="sm:w-36" aria-label="Sort decks">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="name">By name</SelectItem>
              <SelectItem value="cards">Most cards</SelectItem>
            </SelectContent>
          </Select>
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="gap-1.5 bg-amber-500 text-white hover:bg-amber-600"
          >
            <Plus className="h-4 w-4" /> New deck
          </Button>
        </div>
      </div>

      {/* ---------- Summary strip ---------- */}
      {overview && (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <button
            onClick={() => go("stats")}
            className="rounded-xl border bg-card px-4 py-3 text-left transition hover:border-amber-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <p className="text-xs text-muted-foreground">Decks</p>
            <p className="mt-0.5 text-xl font-bold">{overview.total_decks}</p>
          </button>
          <div className="rounded-xl border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">Cards</p>
            <p className="mt-0.5 text-xl font-bold">{overview.total_cards}</p>
          </div>
          <button
            onClick={() => go("stats")}
            className="rounded-xl border bg-card px-4 py-3 text-left transition hover:border-amber-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <p className="text-xs text-muted-foreground">Due today</p>
            <p className={`mt-0.5 text-xl font-bold ${overview.due_cards > 0 ? "text-amber-600" : "text-emerald-600"}`}>
              {overview.due_cards}
            </p>
          </button>
          <div className="rounded-xl border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">Accuracy</p>
            <p className="mt-0.5 text-xl font-bold">
              {overview.accuracy != null ? `${overview.accuracy}%` : "—"}
            </p>
          </div>
        </div>
      )}

      {/* ---------- Error banner ---------- */}
      {loadError && (
        <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {loadError}{" "}
          <button className="font-semibold underline" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      {/* ---------- Grid / empty / loading ---------- */}
      {decks === null ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : visible.length === 0 && decks.length === 0 ? (
        <div className="mt-6 flex flex-col items-center rounded-2xl border border-dashed py-16 text-center">
          <span className="text-5xl" aria-hidden>
            📚
          </span>
          <h2 className="mt-4 text-lg font-semibold">No decks yet</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Create your first deck, add flashcards (or import a CSV), and start studying.
          </p>
          <Button
            className="mt-5 gap-1.5 bg-amber-500 text-white hover:bg-amber-600"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Create your first deck
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <p className="mt-10 text-center text-sm text-muted-foreground">
          No decks match “{query}”.
        </p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((deck) => (
            <DeckCard
              key={deck.id}
              deck={deck}
              onOpen={() => go("deck", deck.id)}
              onStudy={() => goStudy(deck.id, deck.due_count > 0)}
              onEdit={() => {
                setEditing(deck);
                setFormOpen(true);
              }}
              onDuplicate={() => void duplicate(deck)}
              duplicating={duplicating === deck.id}
              onDelete={() => setDeleting(deck)}
            />
          ))}
        </div>
      )}

      {/* ---------- Dialogs ---------- */}
      <DeckFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        deck={editing}
        onSaved={() => void load()}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the deck together with its {deleting?.card_count ?? 0}{" "}
              cards, sessions and review history. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              className="bg-rose-600 text-white hover:bg-rose-700"
              disabled={deleteBusy}
            >
              {deleteBusy && <Loader2 className="h-4 w-4 animate-spin" />} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
