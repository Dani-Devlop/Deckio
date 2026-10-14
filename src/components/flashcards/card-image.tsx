"use client";

import { useState } from "react";
import { ImageIcon } from "lucide-react";

/**
 * Shared card-image renderer.
 *
 * - `full`  → large picture above card text (study / quiz / forms / lightbox).
 * - `thumb` → small square thumbnail (deck-detail card rows).
 *
 * Broken or slow URLs degrade gracefully: a neutral placeholder is shown
 * instead of the browser's broken-image icon. Plain <img> is used on purpose
 * (user-provided external URLs + data: URIs — Next/Image would need an
 * allow-list for every remote host).
 */

export const IMAGE_PREFIXES = ["http://", "https://", "data:image/", "//", "/"];

/** Data URIs get their own (much larger) budget — the backend accepts inline
 * images up to 700,000 chars, other URLs stay capped at 500. */
export const MAX_DATA_URI_LENGTH = 700_000;
const DATA_URI_RE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=\s]+$/i;

/** Client-side mirror of the backend's `clean_image_url` scheme check. */
export function isValidImageUrl(url: string): boolean {
  const u = url.trim();
  if (u.toLowerCase().startsWith("data:image/")) {
    return u.length <= MAX_DATA_URI_LENGTH && DATA_URI_RE.test(u);
  }
  const lower = u.toLowerCase();
  return lower.length > 0 && lower.length <= 500 && IMAGE_PREFIXES.some((p) => lower.startsWith(p));
}

export function CardImage({
  src,
  alt,
  variant = "full",
  className = "",
}: {
  src: string;
  alt: string;
  variant?: "full" | "thumb";
  className?: string;
}) {
  const [broken, setBroken] = useState(false);

  if (broken) {
    return (
      <span
        aria-hidden
        className={`flex items-center justify-center rounded-lg bg-muted text-muted-foreground/50 ${
          variant === "thumb" ? "h-10 w-10" : "h-24 w-full max-w-xs"
        } ${className}`}
      >
        <ImageIcon className={variant === "thumb" ? "h-4 w-4" : "h-6 w-6"} />
      </span>
    );
  }

  if (variant === "thumb") {
    return (
      <img
        src={src}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className={`h-10 w-10 shrink-0 rounded-lg border object-cover ${className}`}
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      className={`max-h-28 w-auto max-w-full rounded-xl border bg-muted/40 object-contain shadow-sm sm:max-h-32 ${className}`}
    />
  );
}
