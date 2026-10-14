"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { CardImage } from "./card-image";

/** Full-size image viewer — click a card image/thumbnail to open. */
export function ImageLightbox({
  src,
  title,
  subtitle,
  onOpenChange,
}: {
  src: string | null;
  title: string;
  subtitle?: string;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={src !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-left leading-snug">{title}</DialogTitle>
          {subtitle && <DialogDescription className="text-left">{subtitle}</DialogDescription>}
        </DialogHeader>
        {src && (
          <div className="flex max-h-[65vh] items-center justify-center overflow-hidden rounded-xl border bg-muted/30 p-3">
            <img
              src={src}
              alt={title}
              referrerPolicy="no-referrer"
              className="max-h-[58vh] w-auto max-w-full rounded-lg object-contain"
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Re-exported so views can share one import site.
export { CardImage } from "./card-image";
