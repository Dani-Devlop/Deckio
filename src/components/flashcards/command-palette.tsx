"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarChart3,
  BookOpen,
  CornerDownLeft,
  Layers,
  Moon,
  Plus,
  Search,
  Sparkles,
  Sun,
  Tag,
} from "lucide-react";
import { useTheme } from "next-themes";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type { SearchResults } from "@/lib/types";

/** Tiny dedicated store so any component can open the palette. */
interface PaletteState {
  open: boolean;
  setOpen: (open: boolean) => void;
}
let setPaletteOpenExternal: ((open: boolean) => void) | null = null;
export function openCommandPalette() {
  setPaletteOpenExternal?.(true);
}

const EMPTY: SearchResults = { decks: [], cards: [] };

/** ⌘K / Ctrl+K global search: decks, cards and quick actions. */
export function CommandPalette() {
  const go = useAppStore((s) => s.go);
  const user = useAppStore((s) => s.user);
  const { resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Expose the imperative opener for the header button.
  useEffect(() => {
    setPaletteOpenExternal = setOpen;
    return () => {
      setPaletteOpenExternal = null;
    };
  }, []);

  // Global hotkey: ⌘K / Ctrl+K toggles the palette.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Reset local state whenever the dialog opens/closes.
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults(EMPTY);
      setSearching(false);
    }
  }, [open]);

  // Debounced global search — skips the API until 2+ characters.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults(EMPTY);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await api.search(q);
        setResults(r);
      } catch {
        setResults(EMPTY);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const close = useCallback(() => setOpen(false), []);

  const runAction = useCallback(
    (action: () => void) => {
      close();
      action();
    },
    [close]
  );

  if (!user) return null;

  const hasResults = results.decks.length > 0 || results.cards.length > 0;

  return (
    <CommandDialog open={open} onOpenChange={setOpen} className="sm:max-w-xl">
      <CommandInput
        placeholder="Search decks and cards…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="nice-scrollbar min-h-72">
        {/* ---------------- Quick actions (always available) ---------------- */}
        <CommandGroup heading="Quick actions">
          <CommandItem onSelect={() => runAction(() => go("decks"))}>
            <Plus className="h-4 w-4 text-amber-500" />
            Go to my decks
          </CommandItem>
          <CommandItem onSelect={() => runAction(() => go("stats"))}>
            <BarChart3 className="h-4 w-4 text-emerald-500" />
            Open learning stats
          </CommandItem>
          <CommandItem
            onSelect={() =>
              runAction(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))
            }
          >
            {resolvedTheme === "dark" ? (
              <Sun className="h-4 w-4 text-orange-400" />
            ) : (
              <Moon className="h-4 w-4 text-slate-500" />
            )}
            Switch to {resolvedTheme === "dark" ? "light" : "dark"} mode
          </CommandItem>
        </CommandGroup>

        {(query.trim().length >= 2 || hasResults) && <CommandSeparator />}

        {/* ---------------- Matching decks ---------------- */}
        {results.decks.length > 0 && (
          <CommandGroup heading="Decks">
            {results.decks.map((d) => (
              <CommandItem
                key={`deck-${d.id}`}
                value={`deck ${d.id} ${d.title}`}
                onSelect={() => runAction(() => go("deck", d.id))}
              >
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-md text-sm"
                  style={{ backgroundColor: `${d.color}22` }}
                  aria-hidden
                >
                  {d.icon}
                </span>
                <span className="flex-1 truncate">{d.title}</span>
                <span className="text-xs text-muted-foreground">{d.card_count} cards</span>
                {d.due_count > 0 && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                    <Sparkles className="h-2.5 w-2.5" /> {d.due_count}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* ---------------- Matching cards ---------------- */}
        {results.cards.length > 0 && (
          <CommandGroup heading="Cards">
            {results.cards.map((c) => (
              <CommandItem
                key={`card-${c.card_id}`}
                value={`card ${c.card_id} ${c.front} ${c.back}`}
                onSelect={() => runAction(() => go("deck", c.deck_id))}
              >
                <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{c.front}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {c.back} · {c.deck_title}
                  </span>
                </span>
                {c.tags.slice(0, 2).map((t) => (
                  <span
                    key={t}
                    className="ml-auto hidden items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline-flex"
                  >
                    <Tag className="h-2.5 w-2.5" />
                    {t}
                  </span>
                ))}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {query.trim().length >= 2 && !searching && !hasResults && (
          <CommandEmpty>No matches for “{query.trim()}”.</CommandEmpty>
        )}
        {query.trim().length >= 2 && searching && hasResults && (
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">Updating results…</p>
        )}
      </CommandList>

      {/* Footer hint */}
      <div className="flex items-center gap-3 border-t px-4 py-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <CornerDownLeft className="h-3 w-3" /> select
        </span>
        <span className="inline-flex items-center gap-1">
          <Layers className="h-3 w-3" /> esc to close
        </span>
        <span className="ml-auto hidden sm:inline">Search covers decks, card text and tags</span>
      </div>
    </CommandDialog>
  );
}
