"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { BarChart3, Layers, LogOut, Moon, Settings, Sun } from "lucide-react";
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
import { useAppStore } from "@/lib/store";

import { AccountSettingsDialog } from "./account-settings-dialog";
import { AuthView } from "./auth-view";
import { DashboardView } from "./dashboard-view";
import { DeckDetailView } from "./deck-detail-view";
import { QuizView } from "./quiz-view";
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

function SiteHeader() {
  const { user, view, go, logout } = useAppStore();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4">
        <BrandLogo onClick={() => go("decks")} />

        <nav className="flex items-center gap-1.5" aria-label="Main navigation">
          <Button
            variant={view === "stats" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => go("stats")}
            className="gap-1.5"
          >
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">Stats</span>
          </Button>
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
        <p className="flex items-center gap-1.5">
          <span>FastAPI · PostgreSQL · Next.js</span>
          <span aria-hidden>·</span>
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

/** Root client component: boots the session and switches between SPA views. */
export function DeckioApp() {
  const { booted, user, view, activeDeckId, boot } = useAppStore();

  useEffect(() => {
    boot().catch(() => toast.error("Failed to initialize the app"));
  }, [boot]);

  if (!booted) return <BootSplash />;

  // key on view+deck so switching views replays the entrance animation
  const viewKey = user ? `${view}-${activeDeckId ?? 0}` : "auth";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {user && <SiteHeader />}
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
