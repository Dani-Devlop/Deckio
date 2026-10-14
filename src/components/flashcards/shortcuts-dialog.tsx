"use client";

/** Keyboard-shortcut cheat sheet (shared by the study + quiz views) plus the
 * shared hotkey guard both views use to avoid stealing keystrokes. */

import { Keyboard } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Shared guard for global study/quiz hotkeys. Ignores keystrokes aimed at
 * form fields, chords with ctrl/meta/alt held, and any open Radix
 * dialog/popover/menu — except the shortcuts cheat sheet itself, so "?" can
 * always toggle it. */
export function shortcutBlocked(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return true;
  const t = e.target as HTMLElement | null;
  if (t) {
    const tag = t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable) return true;
  }
  const open = document.querySelector(
    '[data-state="open"][role="dialog"],[data-state="open"][role="menu"],[data-state="open"][role="listbox"]'
  );
  if (open) {
    const isCheatSheet = open instanceof HTMLElement && open.hasAttribute("data-shortcuts-dialog");
    if (!isCheatSheet) return true;
    if (e.key !== "?") return true; // cheat sheet is up → only "?" passes through
  }
  return false;
}

function ShortcutRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        {keys.map((k) => (
          <kbd
            key={k}
            className="min-w-7 rounded border bg-muted px-1.5 py-0.5 text-center font-mono text-[10px] font-semibold text-muted-foreground"
          >
            {k}
          </kbd>
        ))}
      </span>
    </div>
  );
}

const STUDY_ROWS: { keys: string[]; label: string }[] = [
  { keys: ["Space", "Enter"], label: "Flip the card (question side)" },
  { keys: ["Space", "Enter"], label: "“Got it” (answer side)" },
  { keys: ["1"], label: "“Again” (answer side)" },
  { keys: ["2"], label: "“Got it” (answer side)" },
  { keys: ["?"], label: "Open / close this cheat sheet" },
];

const QUIZ_ROWS: { keys: string[]; label: string }[] = [
  { keys: ["1", "2", "3", "4"], label: "Pick option 1–4" },
  { keys: ["?"], label: "Open / close this cheat sheet" },
];

/** Small "Keyboard shortcuts" dialog. The content carries
 * `data-shortcuts-dialog` so `shortcutBlocked` can exempt it. */
export function ShortcutsDialog({
  open,
  onOpenChange,
  mode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "study" | "quiz";
}) {
  const rows = mode === "study" ? STUDY_ROWS : QUIZ_ROWS;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-shortcuts-dialog="" className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5 text-amber-500" /> Keyboard shortcuts
          </DialogTitle>
          <DialogDescription>
            {mode === "study"
              ? "Hands-on-deck studying — no mouse needed."
              : "Answer quizzes at speed — no mouse needed."}
          </DialogDescription>
        </DialogHeader>
        <div className="divide-y">
          {rows.map((row, i) => (
            <ShortcutRow key={`${row.label}-${i}`} keys={row.keys} label={row.label} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
