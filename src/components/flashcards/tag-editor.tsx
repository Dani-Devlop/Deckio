"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

import { Input } from "@/components/ui/input";

const MAX_TAGS = 8;
const MAX_TAG_LEN = 32;

/** Chip-style tag editor: type + Enter to add, click × to remove. */
export function TagEditor({
  tags,
  onChange,
  id,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  id?: string;
}) {
  const [draft, setDraft] = useState("");

  function addDraft() {
    const t = draft.trim().slice(0, MAX_TAG_LEN);
    if (!t) return;
    // Case-insensitive de-dup, cap at 8 tags (mirrors the API rules).
    if (tags.some((existing) => existing.toLowerCase() === t.toLowerCase())) {
      setDraft("");
      return;
    }
    if (tags.length >= MAX_TAGS) return;
    onChange([...tags, t]);
    setDraft("");
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={draft}
          maxLength={MAX_TAG_LEN}
          placeholder={tags.length >= MAX_TAGS ? "Tag limit reached" : "Add a tag and press Enter…"}
          disabled={tags.length >= MAX_TAGS}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addDraft();
            } else if (e.key === "Backspace" && !draft && tags.length > 0) {
              onChange(tags.slice(0, -1));
            }
          }}
          className="h-9"
          aria-label="New tag name"
        />
        <button
          type="button"
          onClick={addDraft}
          disabled={!draft.trim() || tags.length >= MAX_TAGS}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-40"
          aria-label="Add tag"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      {tags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Current tags">
          {tags.map((tag) => (
            <li
              key={tag.toLowerCase()}
              className="group inline-flex items-center gap-1 rounded-full border bg-muted/60 py-0.5 pl-2.5 pr-1 text-xs font-medium"
            >
              {tag}
              <button
                type="button"
                onClick={() => onChange(tags.filter((t) => t.toLowerCase() !== tag.toLowerCase()))}
                className="flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-500/20"
                aria-label={`Remove tag ${tag}`}
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Up to {MAX_TAGS} tags · {MAX_TAG_LEN} characters each
      </p>
    </div>
  );
}
