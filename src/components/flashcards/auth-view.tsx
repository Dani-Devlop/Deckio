"use client";

import { useState } from "react";
import { Brain, Layers, LineChart, Loader2, Play, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/api";
import { useAppStore } from "@/lib/store";

const FEATURES = [
  { icon: Layers, title: "Organize decks", text: "Group cards by topic with colors & icons." },
  { icon: Play, title: "Study mode", text: "Flip cards, self-grade, session tracking." },
  { icon: Brain, title: "Quiz mode", text: "Auto-generated multiple-choice questions." },
  { icon: LineChart, title: "Progress analytics", text: "Streaks, accuracy and weak-card insights." },
];

/** Landing + sign-in / sign-up screen. */
export function AuthView() {
  const setAuth = useAppStore((s) => s.setAuth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(mode: "login" | "register") {
    setError(null);
    if (!email.trim() || !password) {
      setError("Please fill in both email and password.");
      return;
    }
    if (mode === "register" && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      const res =
        mode === "login"
          ? await api.login(email.trim(), password)
          : await api.register(email.trim(), password);
      setAuth(res.user, res.access_token);
      toast.success(mode === "login" ? "Welcome back!" : "Account created — happy studying!");
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Something went wrong. Try again.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 lg:grid-cols-2 lg:items-center lg:py-16">
      {/* ---------- Brand panel ---------- */}
      <section className="hidden flex-col gap-8 lg:flex" aria-hidden="true">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
            <Sparkles className="h-3.5 w-3.5" /> FastAPI + Next.js full-stack demo
          </span>
          <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight xl:text-5xl">
            Learn faster with{" "}
            <span className="bg-gradient-to-r from-amber-500 to-orange-600 bg-clip-text text-transparent">
              smart flashcards
            </span>
          </h1>
          <p className="mt-4 max-w-md text-lg text-muted-foreground">
            Deckio turns any topic into interactive decks — study with flip cards, challenge
            yourself with generated quizzes, and watch your accuracy climb.
          </p>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <li key={f.title} className="rounded-xl border bg-card p-4 shadow-sm">
              <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                <f.icon className="h-5 w-5" />
              </span>
              <p className="font-semibold">{f.title}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{f.text}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ---------- Auth card ---------- */}
      <section className="mx-auto w-full max-w-md">
        <div className="rounded-2xl border bg-card p-6 shadow-lg shadow-amber-500/5 sm:p-8">
          <div className="mb-6 text-center lg:hidden">
            <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white">
              <Layers className="h-6 w-6" />
            </span>
            <h1 className="text-2xl font-bold">Deckio</h1>
          </div>
          <h2 className="text-xl font-semibold">Sign in to Deckio</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a free account or log in to continue.
          </p>

          <Tabs defaultValue="login" className="mt-6">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Sign in</TabsTrigger>
              <TabsTrigger value="register">Create account</TabsTrigger>
            </TabsList>

            {(["login", "register"] as const).map((mode) => (
              <TabsContent key={mode} value={mode} className="mt-4">
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit(mode);
                  }}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor={`${mode}-email`}>Email</Label>
                    <Input
                      id={`${mode}-email`}
                      type="email"
                      autoComplete="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${mode}-password`}>Password</Label>
                    <Input
                      id={`${mode}-password`}
                      type="password"
                      autoComplete={mode === "login" ? "current-password" : "new-password"}
                      placeholder={mode === "register" ? "At least 8 characters" : "••••••••"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>

                  {error && (
                    <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-600">
                      {error}
                    </p>
                  )}

                  <Button
                    type="submit"
                    disabled={busy}
                    className="w-full bg-amber-500 text-white hover:bg-amber-600"
                  >
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                    {mode === "login" ? "Sign in" : "Create account"}
                  </Button>
                </form>
              </TabsContent>
            ))}
          </Tabs>
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Passwords are hashed with bcrypt · Sessions secured with JWT
        </p>
      </section>
    </div>
  );
}
