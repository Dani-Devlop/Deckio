"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Brain,
  Clock,
  CopyPlus,
  Download,
  FileDown,
  FileUp,
  Globe,
  ImagePlus,
  Lightbulb,
  Loader2,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Tag,
  Target,
  Trash2,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { motion } from "framer-motion";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import { accuracyColor, dueLabel, formatDate, timeAgo } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import type { BulkImportResult, Card, Deck, DeckBundle } from "@/lib/types";

import { DeckFormDialog } from "./dashboard-view";
import { isValidImageUrl, CardImage } from "./card-image";
import { ImageLightbox } from "./image-lightbox";
import { ShareDialog } from "./share-dialog";
import { TagEditor } from "./tag-editor";

/** Add / edit a single card. */
function CardFormDialog({
  open,
  onOpenChange,
  deckId,
  card,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deckId: number;
  card: Card | null;
  onSaved: () => void;
}) {
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [hint, setHint] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imgBroken, setImgBroken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFront(card?.front ?? "");
      setBack(card?.back ?? "");
      setTags(card?.tags ?? []);
      setHint(card?.hint ?? "");
      setImageUrl(card?.image_url ?? "");
      setImgBroken(false);
      setError(null);
    }
  }, [card, open]);

  const trimmedUrl = imageUrl.trim();
  const urlValid = trimmedUrl === "" || isValidImageUrl(trimmedUrl);

  async function save() {
    if (!front.trim() || !back.trim()) {
      setError("Both the front and the back are required.");
      return;
    }
    if (!urlValid) {
      setError("The image URL must start with http://, https://, data:image/ or /.");
      return;
    }
    setBusy(true);
    try {
      if (card) {
        await api.cards.update(card.id, {
          front: front.trim(),
          back: back.trim(),
          tags,
          hint: hint.trim() || null, // null clears the hint
          image_url: trimmedUrl || null, // null clears the image
        });
        toast.success("Card updated");
      } else {
        await api.cards.create(deckId, {
          front: front.trim(),
          back: back.trim(),
          tags,
          hint: hint.trim() || null,
          image_url: trimmedUrl || null,
        });
        toast.success("Card added");
      }
      onOpenChange(false);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save the card.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{card ? "Edit card" : "Add a card"}</DialogTitle>
          <DialogDescription>
            The <strong>front</strong> is the prompt (question); the <strong>back</strong> is the
            answer shown after flipping.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="card-front">Front (question)</Label>
            <Textarea
              id="card-front"
              rows={2}
              maxLength={1000}
              placeholder="e.g. How do you say “hello” in Spanish?"
              value={front}
              onChange={(e) => setFront(e.target.value)}
            />
            <p className="text-right text-xs text-muted-foreground">{front.length}/1000</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="card-back">Back (answer)</Label>
            <Textarea
              id="card-back"
              rows={2}
              maxLength={2000}
              placeholder="e.g. hola"
              value={back}
              onChange={(e) => setBack(e.target.value)}
            />
            <p className="text-right text-xs text-muted-foreground">{back.length}/2000</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="card-tags">Tags (optional)</Label>
            <TagEditor id="card-tags" tags={tags} onChange={setTags} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="card-hint" className="flex items-center gap-1">
              <Lightbulb className="h-3.5 w-3.5 text-amber-500" /> Hint (optional)
            </Label>
            <Textarea
              id="card-hint"
              rows={2}
              maxLength={300}
              placeholder="A nudge shown before flipping — e.g. “sounds like mare-see”"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
            />
            <p className="text-right text-xs text-muted-foreground">{hint.length}/300</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="card-image" className="flex items-center gap-1">
              <ImagePlus className="h-3.5 w-3.5 text-sky-600" /> Image (optional)
            </Label>
            <div className="flex gap-2">
              <Input
                id="card-image"
                type="text"
                inputMode="url"
                maxLength={500}
                placeholder="https://example.com/picture.jpg"
                value={imageUrl}
                onChange={(e) => {
                  setImageUrl(e.target.value);
                  setImgBroken(false);
                }}
                aria-invalid={trimmedUrl !== "" && !urlValid}
                className={trimmedUrl !== "" && !urlValid ? "border-rose-400 focus-visible:ring-rose-300" : ""}
              />
              {trimmedUrl !== "" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 text-muted-foreground"
                  aria-label="Remove image"
                  onClick={() => {
                    setImageUrl("");
                    setImgBroken(false);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            {trimmedUrl !== "" && (
              <div
                className={`flex items-center justify-center overflow-hidden rounded-xl border bg-muted/40 p-2 ${
                  urlValid ? "" : "opacity-50"
                }`}
              >
                {urlValid && !imgBroken ? (
                  <img
                    src={trimmedUrl}
                    alt="Card image preview"
                    referrerPolicy="no-referrer"
                    onError={() => setImgBroken(true)}
                    className="max-h-24 w-auto max-w-full rounded-lg object-contain"
                  />
                ) : (
                  <p className="flex items-center gap-1.5 py-2 text-xs text-muted-foreground">
                    <ImagePlus className="h-3.5 w-3.5" />
                    {urlValid
                      ? "Preview unavailable — the URL may be broken, but you can still save."
                      : "URL must start with http://, https://, data:image/ or /"}
                  </p>
                )}
              </div>
            )}
            <p className="text-right text-xs text-muted-foreground">{imageUrl.length}/500</p>
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy} className="bg-amber-500 text-white hover:bg-amber-600">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {card ? "Save changes" : "Add card"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** CSV bulk import dialog — paste raw CSV or upload a .csv file. */
function ImportCsvDialog({
  open,
  onOpenChange,
  deckId,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deckId: number;
  onImported: () => void;
}) {
  const [tab, setTab] = useState<"paste" | "upload">("paste");
  const [csvText, setCsvText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BulkImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setCsvText("");
      setFile(null);
      setResult(null);
      setError(null);
      setTab("paste");
    }
  }, [open]);

  async function doImport() {
    setError(null);
    if (tab === "paste" && !csvText.trim()) {
      setError("Paste some CSV content first.");
      return;
    }
    if (tab === "upload" && !file) {
      setError("Choose a .csv file first.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.cards.bulkImport(deckId, tab === "paste" ? csvText : file!);
      setResult(res);
      onImported();
      if (res.imported > 0) {
        toast.success(`Imported ${res.imported} card${res.imported === 1 ? "" : "s"}`);
      } else {
        toast.warning("No cards were imported — check the errors below.");
      }
      if (res.errors.length === 0 && res.imported > 0) {
        onOpenChange(false);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import cards from CSV</DialogTitle>
          <DialogDescription>
            Two columns: <code className="rounded bg-muted px-1">front,back</code>. Delimiters
            (comma, semicolon, tab) are auto-detected; a header row is optional. With a header,
            columns are mapped by name — extras like{" "}
            <code className="rounded bg-muted px-1">tags,hint,image_url</code> are picked up in any
            order; without one, 3rd/4th/5th columns are tags / hint / image.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="paste">Paste CSV</TabsTrigger>
            <TabsTrigger value="upload">Upload file</TabsTrigger>
          </TabsList>

          <TabsContent value="paste" className="mt-3">
            <Textarea
              rows={8}
              className="font-mono text-xs"
              placeholder={"front,back,hint,image_url\nhola,hello,sounds like oh-la,https://…/hola.jpg\ngracias,thank you"}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              aria-label="CSV content"
            />
          </TabsContent>

          <TabsContent value="upload" className="mt-3">
            <label
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-8 text-center transition hover:border-amber-400 hover:bg-amber-50/50 dark:hover:bg-amber-500/5"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp className="h-8 w-8 text-amber-500" />
              {file ? (
                <span className="text-sm font-medium">{file.name}</span>
              ) : (
                <>
                  <span className="text-sm font-medium">Click to choose a .csv or .txt file</span>
                  <span className="text-xs text-muted-foreground">Max 1 MB · up to 1000 rows</span>
                </>
              )}
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="sr-only"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </TabsContent>
        </Tabs>

        {result && (
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <p>
              <span className="font-semibold text-emerald-600">{result.imported} imported</span>
              {" · "}
              <span className="text-muted-foreground">{result.skipped} row(s) with problems</span>
            </p>
            {result.errors.length > 0 && (
              <ul className="nice-scrollbar mt-2 max-h-28 space-y-1 overflow-y-auto text-xs text-rose-600">
                {result.errors.map((err, i) => (
                  <li key={i}>• {err}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {error && <p className="text-sm text-rose-600">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {result && result.imported > 0 ? "Done" : "Cancel"}
          </Button>
          <Button onClick={doImport} disabled={busy} className="gap-1.5 bg-amber-500 text-white hover:bg-amber-600">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Deck detail: header with stats + actions, and the card list. */
export function DeckDetailView({ deckId }: { deckId: number }) {
  const go = useAppStore((s) => s.go);
  const goStudy = useAppStore((s) => s.goStudy);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [cardFormOpen, setCardFormOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [editDeckOpen, setEditDeckOpen] = useState(false);
  const [deletingCard, setDeletingCard] = useState<Card | null>(null);
  const [deleteDeckOpen, setDeleteDeckOpen] = useState(false);
  const [busyDelete, setBusyDelete] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; front: string; back: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, c] = await Promise.all([api.decks.get(deckId), api.cards.list(deckId)]);
      setDeck(d);
      setCards(c);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Failed to load the deck.");
    }
  }, [deckId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Reset the tag filter when switching to another deck.
  useEffect(() => {
    setTagFilter(null);
  }, [deckId]);

  /** Distinct tags across the deck's cards, alphabetically. */
  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of cards ?? []) {
      for (const t of c.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [cards]);

  const visibleCards = useMemo(() => {
    if (!cards) return [];
    if (!tagFilter) return cards;
    return cards.filter((c) => c.tags.some((t) => t.toLowerCase() === tagFilter.toLowerCase()));
  }, [cards, tagFilter]);

  async function confirmDeleteCard() {
    if (!deletingCard) return;
    setBusyDelete(true);
    try {
      await api.cards.remove(deletingCard.id);
      toast.success("Card deleted");
      setDeletingCard(null);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to delete card");
    } finally {
      setBusyDelete(false);
    }
  }

  async function confirmDeleteDeck() {
    if (!deck) return;
    setBusyDelete(true);
    try {
      await api.decks.remove(deck.id);
      toast.success(`Deleted “${deck.title}”`);
      go("decks");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to delete deck");
      setBusyDelete(false);
    }
  }

  /** Download the deck as CSV via the API export endpoint. */
  async function exportCsv() {
    if (!deck) return;
    try {
      const csv = await api.cards.exportCsv(deck.id);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${deck.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "deck"}-cards.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Deck exported as CSV");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Export failed");
    }
  }

  /** Duplicate the deck (SRS progress reset) and open the fresh copy. */
  async function duplicateDeck() {
    if (!deck) return;
    try {
      const copy = await api.decks.duplicate(deck.id);
      toast.success(`Duplicated “${deck.title}” — ${copy.card_count} cards ready to study`);
      go("deck", copy.id); // open the copy so the user lands where the action happened
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to duplicate the deck.");
    }
  }

  /** Download the deck as a portable JSON bundle (cards + tags). */
  async function exportBundle() {
    if (!deck) return;
    try {
      const bundle = await api.decks.exportBundle(deck.id);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${deck.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "deck"}-deckio.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Deck bundle exported — share it with anyone!");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Bundle export failed");
    }
  }

  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-10">
        <Button variant="ghost" onClick={() => go("decks")} className="mb-4 gap-1.5">
          <ArrowLeft className="h-4 w-4" /> All decks
        </Button>
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {loadError}{" "}
          <button className="font-semibold underline" onClick={() => void load()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!deck || cards === null) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-8">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const empty = cards.length === 0;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <Button variant="ghost" onClick={() => go("decks")} className="mb-4 gap-1.5">
        <ArrowLeft className="h-4 w-4" /> All decks
      </Button>

      {/* ---------- Deck hero ---------- */}
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <span className="block h-2 w-full" style={{ backgroundColor: deck.color }} aria-hidden />
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
                <h1 className="truncate text-2xl font-bold tracking-tight">{deck.title}</h1>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {deck.description || "No description"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                className="gap-1.5 bg-amber-500 text-white hover:bg-amber-600"
                onClick={() => goStudy(deck.id, false)}
                disabled={empty}
              >
                <Play className="h-4 w-4" /> Study
              </Button>
              <Button
                variant="outline"
                className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:border-amber-500/40 dark:text-amber-400 dark:hover:bg-amber-500/10"
                onClick={() => goStudy(deck.id, true)}
                disabled={empty || deck.due_count === 0}
                title={deck.due_count === 0 ? "Nothing due right now" : `Review ${deck.due_count} due card(s)`}
              >
                <Sparkles className="h-4 w-4" /> Smart review
                {deck.due_count > 0 && (
                  <span className="rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                    {deck.due_count}
                  </span>
                )}
              </Button>
              <Button
                variant="outline"
                className="gap-1.5"
                onClick={() => go("quiz", deck.id)}
                disabled={empty}
              >
                <Brain className="h-4 w-4" /> Quiz
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Deck options">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => {
                      setEditDeckOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" /> Edit deck
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShareOpen(true)}>
                    <Globe className="h-4 w-4" /> Share link
                    {deck.share_token && (
                      <span className="ml-auto rounded-full bg-emerald-100 px-1.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                        on
                      </span>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setImportOpen(true)}>
                    <FileUp className="h-4 w-4" /> Import CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void exportCsv()}>
                    <Download className="h-4 w-4" /> Export CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void exportBundle()} disabled={empty}>
                    <FileDown className="h-4 w-4" /> Export bundle (JSON)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => void duplicateDeck()}
                    disabled={empty}
                  >
                    <CopyPlus className="h-4 w-4" /> Duplicate deck
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setDeleteDeckOpen(true)}
                    className="text-rose-600 focus:text-rose-600"
                  >
                    <Trash2 className="h-4 w-4" /> Delete deck
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary" className="gap-1.5 py-1.5">
              <BookOpen className="h-3.5 w-3.5" /> {deck.card_count} cards
            </Badge>
            <Badge variant="secondary" className={`gap-1.5 py-1.5 ${accuracyColor(deck.accuracy)}`}>
              <Target className="h-3.5 w-3.5" />
              {deck.accuracy != null ? `${deck.accuracy}% accuracy` : "no reviews yet"}
            </Badge>
            <Badge variant="secondary" className="gap-1.5 py-1.5">
              <Clock className="h-3.5 w-3.5" /> studied {timeAgo(deck.last_studied_at)}
            </Badge>
            {deck.due_count > 0 && (
              <Badge className="gap-1.5 bg-amber-500 py-1.5 text-white hover:bg-amber-500">
                <Sparkles className="h-3.5 w-3.5" /> {deck.due_count} due for review
              </Badge>
            )}
            <button
              type="button"
              onClick={() => setEditDeckOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-amber-400/60 bg-amber-50/60 px-2.5 py-1.5 text-xs font-medium text-amber-800 transition hover:border-amber-500 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20"
              title="Smart review limits — click to edit"
              aria-label={`Smart review limits: ${deck.new_per_day} new cards per day, session cap ${deck.max_reviews}. Edit`}
            >
              <Zap className="h-3.5 w-3.5" />
              {deck.new_per_day}/day · cap {deck.max_reviews}
            </button>
            {deck.share_token && (
              <Badge
                variant="secondary"
                className="gap-1.5 py-1.5 text-emerald-700 dark:text-emerald-400"
                title="This deck has a public read-only share link"
              >
                <Globe className="h-3.5 w-3.5" /> shared
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* ---------- Cards ---------- */}
      <div className="mt-6 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          Cards
          <Badge variant="secondary">
            {tagFilter ? `${visibleCards.length}/${cards.length}` : cards.length}
          </Badge>
          {tagFilter && (
            <button
              onClick={() => setTagFilter(null)}
              className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-400"
              aria-label={`Clear tag filter ${tagFilter}`}
            >
              <Tag className="h-3 w-3" /> {tagFilter}
              <X className="h-3 w-3" />
            </button>
          )}
        </h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void exportCsv()} className="gap-1.5">
            <Download className="h-4 w-4" /> Export
          </Button>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} className="gap-1.5">
            <FileUp className="h-4 w-4" /> Import CSV
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditingCard(null);
              setCardFormOpen(true);
            }}
            className="gap-1.5 bg-amber-500 text-white hover:bg-amber-600"
          >
            <Plus className="h-4 w-4" /> Add card
          </Button>
        </div>
      </div>

      {/* ---------- Tag filter row ---------- */}
      {allTags.length > 0 && (
        <div className="nice-scrollbar mt-3 flex items-center gap-1.5 overflow-x-auto pb-1">
          <span className="shrink-0 text-xs font-medium text-muted-foreground">Filter by tag:</span>
          {allTags.map(([tag, count]) => {
            const active = tagFilter?.toLowerCase() === tag.toLowerCase();
            return (
              <button
                key={tag}
                onClick={() => setTagFilter(active ? null : tag)}
                aria-pressed={active}
                className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                  active
                    ? "border-amber-400 bg-amber-100 text-amber-800 dark:border-amber-500/50 dark:bg-amber-500/15 dark:text-amber-300"
                    : "bg-card text-muted-foreground hover:border-amber-300 hover:text-foreground"
                }`}
              >
                {tag} <span className="ml-0.5 text-[10px] opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {empty ? (
        <div className="mt-4 flex flex-col items-center rounded-2xl border border-dashed py-14 text-center">
          <span className="text-4xl" aria-hidden>
            🃏
          </span>
          <h3 className="mt-3 font-semibold">No cards in this deck yet</h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Add cards one by one, or import a whole list from a CSV file.
          </p>
          <div className="mt-4 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setImportOpen(true)}
              className="gap-1.5"
            >
              <FileUp className="h-4 w-4" /> Import CSV
            </Button>
            <Button
              size="sm"
              className="gap-1.5 bg-amber-500 text-white hover:bg-amber-600"
              onClick={() => {
                setEditingCard(null);
                setCardFormOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> Add card
            </Button>
          </div>
        </div>
      ) : visibleCards.length === 0 ? (
        <div className="mt-4 flex flex-col items-center rounded-2xl border border-dashed py-12 text-center">
          <Tag className="h-8 w-8 text-muted-foreground" aria-hidden />
          <h3 className="mt-3 font-semibold">No cards tagged “{tagFilter}”</h3>
          <p className="mt-1 text-sm text-muted-foreground">Try a different tag or clear the filter.</p>
          <Button size="sm" variant="outline" className="mt-4" onClick={() => setTagFilter(null)}>
            Clear filter
          </Button>
        </div>
      ) : (
        <ul className="nice-scrollbar mt-4 max-h-[520px] divide-y overflow-y-auto rounded-xl border bg-card">
          {visibleCards.map((card) => {
            const label = dueLabel(card.due_at); // new | due | in 3d …
            return (
              <li key={card.id} className="group flex items-start justify-between gap-3 px-4 py-3">
                <button
                  className="min-w-0 flex-1 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                  onClick={() => {
                    setEditingCard(card);
                    setCardFormOpen(true);
                  }}
                  aria-label={`Edit card: ${card.front}`}
                >
                  <div className="flex items-start gap-2.5">
                    {card.image_url && (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`View image for: ${card.front}`}
                        className="shrink-0 rounded-lg ring-offset-2 transition hover:ring-2 hover:ring-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLightbox({ src: card.image_url!, front: card.front, back: card.back });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            setLightbox({ src: card.image_url!, front: card.front, back: card.back });
                          }
                        }}
                      >
                        <CardImage src={card.image_url} alt={`Image for: ${card.front}`} variant="thumb" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{card.front}</p>
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">{card.back}</p>
                      {card.hint && (
                        <p
                          className="mt-1 flex max-w-lg items-start gap-1 truncate text-xs italic text-muted-foreground"
                          title={`Hint: ${card.hint}`}
                        >
                          <Lightbulb className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                          <span className="truncate">{card.hint}</span>
                        </p>
                      )}
                      {card.tags.length > 0 && (
                        <span className="mt-1.5 flex flex-wrap gap-1">
                          {card.tags.slice(0, 3).map((t) => (
                            <span
                              key={t}
                              className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                            >
                              <Tag className="h-2.5 w-2.5" />
                              {t}
                            </span>
                          ))}
                          {card.tags.length > 3 && (
                            <span className="text-[10px] text-muted-foreground">
                              +{card.tags.length - 3}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
                <div className="flex shrink-0 items-center gap-2 pt-0.5">
                  {/* SRS state chip: new / due / scheduled */}
                  <span
                    className={`hidden rounded-full px-2 py-0.5 text-[11px] font-semibold sm:inline ${
                      label === "new"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                        : label === "due"
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                          : "bg-muted text-muted-foreground"
                    }`}
                    title={
                      card.reps > 0
                        ? `${card.reps} correct rep${card.reps === 1 ? "" : "s"} · ${card.lapses} lapse${card.lapses === 1 ? "" : "s"} · ease ${card.ease.toFixed(2)}`
                        : "Not studied yet"
                    }
                  >
                    {label}
                  </span>
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    {formatDate(card.created_at)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground"
                    aria-label={`Delete card: ${card.front}`}
                    onClick={() => setDeletingCard(card)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* ---------- Dialogs ---------- */}
      <ImageLightbox
        src={lightbox?.src ?? null}
        title={lightbox?.front ?? ""}
        subtitle={lightbox?.back}
        onOpenChange={(open) => {
          if (!open) setLightbox(null);
        }}
      />
      <CardFormDialog
        open={cardFormOpen}
        onOpenChange={setCardFormOpen}
        deckId={deck.id}
        card={editingCard}
        onSaved={() => void load()}
      />
      <ImportCsvDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        deckId={deck.id}
        onImported={() => void load()}
      />
      <DeckFormDialog open={editDeckOpen} onOpenChange={setEditDeckOpen} deck={deck} onSaved={() => void load()} />
      <ShareDialog
        deck={deck}
        open={shareOpen}
        onOpenChange={setShareOpen}
        onUpdated={(updated) => setDeck(updated)}
      />

      {/* delete card */}
      <AlertDialog open={deletingCard !== null} onOpenChange={(o) => !o && setDeletingCard(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this card?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deletingCard?.front}” will be removed along with its review history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyDelete}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDeleteCard();
              }}
              className="bg-rose-600 text-white hover:bg-rose-700"
              disabled={busyDelete}
            >
              {busyDelete && <Loader2 className="h-4 w-4 animate-spin" />} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* delete deck */}
      <AlertDialog open={deleteDeckOpen} onOpenChange={setDeleteDeckOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deck.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the deck with {deck.card_count} cards and all study
              history. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyDelete}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDeleteDeck();
              }}
              className="bg-rose-600 text-white hover:bg-rose-700"
              disabled={busyDelete}
            >
              {busyDelete && <Loader2 className="h-4 w-4 animate-spin" />} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
