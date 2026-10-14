"use client";

import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  Globe,
  Link2,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

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
import { ApiError, api } from "@/lib/api";
import type { Deck } from "@/lib/types";

/** Create / copy / rotate / revoke a deck's public read-only link. */
export function ShareDialog({
  deck,
  open,
  onOpenChange,
  onUpdated,
}: {
  deck: Deck | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (deck: Deck) => void;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setToken(deck?.share_token ?? null);
      setCopied(false);
    }
  }, [deck, open]);

  if (!deck) return null;

  const url = token
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/?share=${token}`
    : null;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const create = () =>
    run(async () => {
      const res = await api.decks.createShare(deck.id);
      setToken(res.share_token);
      // Refresh the row so callers can persist share_token in their lists.
      onUpdated(await api.decks.get(deck.id));
      toast.success("Public link created — anyone with it can preview the deck");
    });

  const regenerate = () =>
    run(async () => {
      const res = await api.decks.createShare(deck.id, true);
      setToken(res.share_token);
      setCopied(false);
      onUpdated(await api.decks.get(deck.id));
      toast.success("New link generated — the old one no longer works");
    });

  const revoke = () =>
    run(async () => {
      await api.decks.revokeShare(deck.id);
      setToken(null);
      setCopied(false);
      onUpdated(await api.decks.get(deck.id));
      toast.success("Link revoked — the deck is private again");
    });

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied to clipboard");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't access the clipboard — copy the link manually.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-4.5 w-4.5 text-amber-500" /> Share “{deck.title}”
          </DialogTitle>
          <DialogDescription>
            A public link shows a <strong>read-only preview</strong> of the deck — anyone with it can
            flip through the cards and import a copy. Your review history stays private.
          </DialogDescription>
        </DialogHeader>

        {token && url ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Public share link"
                className="font-mono text-xs"
              />
              <Button size="icon" variant="outline" onClick={() => void copy()} aria-label="Copy link" className="h-9 w-9 shrink-0">
                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Link2 className="mt-0.5 h-3 w-3 shrink-0" />
              Rotating the link invalidates the old one instantly; revoking makes the deck private
              again. Cards added later appear on the preview automatically.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed p-6 text-center">
            <span className="text-3xl" aria-hidden>
              🔗
            </span>
            <p className="mt-2 text-sm font-medium">This deck is private</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
              Create a public link to let classmates or friends preview and import this deck — no
              account needed on their side.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {token ? (
            <>
              <Button variant="outline" onClick={() => void regenerate()} disabled={busy} className="gap-1.5">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Rotate link
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  onClick={() => void revoke()}
                  disabled={busy}
                  className="gap-1.5 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-500/10"
                >
                  <Trash2 className="h-4 w-4" /> Revoke
                </Button>
                <Button onClick={() => onOpenChange(false)} disabled={busy}>
                  Done
                </Button>
              </div>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={() => void create()} disabled={busy} className="gap-1.5 bg-amber-500 text-white hover:bg-amber-600">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
                Create public link
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
