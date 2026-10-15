"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { BarChart3, FlaskConical, Layers, LogOut, Moon, Search, Settings, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { hashToView } from "@/lib/hash-nav";
import { isDemoMode } from "@/lib/demo-backend";
import { useAppStore } from "@/lib/store";

import { AccountSettingsDialog } from "./account-settings-dialog";
import { AuthView } from "./auth-view";
import { CommandPalette, openCommandPalette } from "./command-palette";
import { DashboardView } from "./dashboard-view";
import { DeckDetailView } from "./deck-detail-view";
import { PublicDeckView } from "./public-deck-view";
import { QuizView } from "./quiz-view";
import { ReminderBell } from "./reminder-bell";
import { StatsView } from "./stats-view";
import { StudyView } from "./study-view";

/** Brand logo — gradient tile + wordmark. Clicking returns to the dashboard. */
export function BrandLogo({ onClick }: { onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
      aria-label="Deckio home"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-sm">
        <Layers className="h-5 w-5" />
      </span>
      <span className="text-lg font-bold tracking-tight">Deckio</span>
    </button>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle dark mode"
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </Button>
  );
}

/** Small "Demo" pill shown when the app runs on the in-browser backend
 * (GitHub Pages static demo / `?demo=1`). Hydration-safe: only rendered
 * after mount, so the SSR pass (no window) never disagrees with the client. */
function DemoBadge() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShow(isDemoMode());
  }, []);
  if (!show) return null;
  return (
    <span
      title="Static demo — everything you do is stored only in this browser"
      className="hidden items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400 sm:inline-flex"
    >
      <FlaskConical className="h-3.5 w-3.5" aria-hidden />
      Demo
    </span>
  );
}

function SiteHeader() {
  const { user, view, go, logout } = useAppStore();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-3">
          <BrandLogo onClick={() => go("decks")} />
          <DemoBadge />
        </div>

        <nav className="flex items-center gap-1.5" aria-label="Main navigation">
          <Button
            variant="outline"
            size="sm"
            onClick={openCommandPalette}
            className="h-9 gap-2 border-dashed text-muted-foreground hover:text-foreground"
            aria-label="Open search (Command palette)"
          >
            <Search className="h-4 w-4" />
            <span className="hidden md:inline">Search…</span>
            <kbd className="hidden rounded border bg-muted px-1.5 font-mono text-[10px] font-semibold text-muted-foreground md:inline">
              ⌘K
            </kbd>
          </Button>
          <Button
            variant={view === "stats" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => go("stats")}
            className="gap-1.5"
          >
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">Stats</span>
          </Button>
          <ReminderBell />
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                aria-label="Account menu"
              >
                <Avatar className="h-9 w-9 border">
                  <AvatarFallback className="bg-amber-100 text-sm font-semibold text-amber-700">
                    {user?.email?.slice(0, 2).toUpperCase() ?? "?"}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="truncate">{user?.email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                <Settings className="h-4 w-4" /> Account settings
              </DropdownMenuItem>
              <DropdownMenuItem onClick={logout} className="text-rose-600 focus:text-rose-600">
                <LogOut className="h-4 w-4" /> Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>
      </div>

      <AccountSettingsDialog
        state={settingsOpen ? { open: true } : { open: false }}
        onOpenChange={setSettingsOpen}
      />
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="mt-auto border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-4 py-5 text-sm text-muted-foreground sm:flex-row">
        <p>
          <span className="font-semibold text-foreground">Deckio</span> — smart flashcards for
          faster learning.
        </p>
        <p className="flex flex-wrap items-center justify-center gap-1.5">
          <span>FastAPI · PostgreSQL · Next.js</span>
          <span aria-hidden>·</span>
          <span className="hidden items-center gap-1 sm:inline-flex">
            Press
            <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">
              ⌘K
            </kbd>
            to search
          </span>
          <span aria-hidden className="hidden sm:inline">·</span>
          <a
            href="https://github.com/Dani-Devlop/Deckio"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
          >
            GitHub
          </a>
        </p>
      </div>
    </footer>
  );
}

function BootSplash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <span className="flex h-14 w-14 animate-pulse items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white">
        <Layers className="h-7 w-7" />
      </span>
      <p className="text-sm text-muted-foreground">Loading Deckio…</p>
    </div>
  );
}

/** sessionStorage key preserving a share link through the sign-in round-trip. */
const SHARE_PENDING_KEY = "deckio_pending_share";

/** Root client component: boots the session and switches between SPA views. */
export function DeckioApp() {
  const { booted, user, view, activeDeckId, boot } = useAppStore();
  // `/?share=<token>` — public read-only deck preview (works logged-in or not).
  const [shareToken, setShareToken] = useState<string | null>(null);

  useEffect(() => {
    boot().catch(() => toast.error("Failed to initialize the app"));
    const param = new URLSearchParams(window.location.search).get("share");
    if (param) {
      // Read-once URL parse — safe to set synchronously here (client-only SPA).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShareToken(param);
      window.sessionStorage.setItem(SHARE_PENDING_KEY, param);
    }
  }, [boot]);

  // Hash routing: browser back/forward + deep links (#/stats, #/deck/3 …).
  // `go`/`goStudy` already sync the hash, so when the change originates here the
  // parsed state equals the store state and this is a no-op (loop guard).
  useEffect(() => {
    const onHashChange = () => {
      const parsed = hashToView(window.location.hash);
      if (!parsed) return;
      const s = useAppStore.getState();
      if (!s.user) return; // deep links only apply to signed-in views
      if (
        s.view !== parsed.view ||
        s.activeDeckId !== parsed.deckId ||
        s.studySrs !== parsed.srs ||
        s.studyTyping !== parsed.typing
      ) {
        s.applyHashState(parsed);
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  /** Leave the share preview for good (clears state, URL and pending marker). */
  const closeShare = () => {
    setShareToken(null);
    window.sessionStorage.removeItem(SHARE_PENDING_KEY);
    window.history.replaceState(null, "", window.location.pathname);
  };

  /** Anonymous visitor heading to sign-in: park the token so the preview can
   * be restored right after login ("Sign in to import" flow). */
  const shareSignIn = () => {
    if (shareToken) window.sessionStorage.setItem(SHARE_PENDING_KEY, shareToken);
    setShareToken(null);
    window.history.replaceState(null, "", window.location.pathname);
  };

  // Restore a parked share preview once the user is signed in again — unless
  // the URL carries an explicit in-app deep link (#/stats, #/deck/3 …), which
  // always wins over a stale parked token from an earlier visit.
  useEffect(() => {
    if (!user || shareToken) return;
    if (hashToView(window.location.hash)) return;
    const pending = window.sessionStorage.getItem(SHARE_PENDING_KEY);
    if (pending) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShareToken(pending);
      window.history.replaceState(null, "", `/?share=${pending}`);
    }
  }, [user, shareToken]);

  if (!booted) return <BootSplash />;

  // Share previews take over the whole page (own header, no nav chrome).
  if (shareToken) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <main className="flex-1">
          <PublicDeckView token={shareToken} onClose={closeShare} onSignIn={shareSignIn} />
        </main>
        <SiteFooter />
      </div>
    );
  }

  // key on view+deck so switching views replays the entrance animation
  const viewKey = user ? `${view}-${activeDeckId ?? 0}` : "auth";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {user && (
        <>
          <SiteHeader />
          <CommandPalette />
        </>
      )}
      <main className="flex-1">
        <motion.div
          key={viewKey}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
        >
          {!user ? (
            <AuthView />
          ) : view === "deck" && activeDeckId != null ? (
            <DeckDetailView key={`deck-${activeDeckId}`} deckId={activeDeckId} />
          ) : view === "study" && activeDeckId != null ? (
            <StudyView key={`study-${activeDeckId}`} deckId={activeDeckId} />
          ) : view === "quiz" && activeDeckId != null ? (
            <QuizView key={`quiz-${activeDeckId}`} deckId={activeDeckId} />
          ) : view === "stats" ? (
            <StatsView />
          ) : (
            <DashboardView />
          )}
        </motion.div>
      </main>
      <SiteFooter />
    </div>
  );
}
