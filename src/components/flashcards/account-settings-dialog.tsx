"use client";

import { useState } from "react";
import { AlertTriangle, KeyRound, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/api";
import { useAppStore } from "@/lib/store";

/** Modal (open → visible). */
type OpenState = { open: true } | { open: false };

/** Password change form: verifies the current password server-side. */
function PasswordPanel({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (next.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (next !== confirm) {
      setError("New passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(current, next);
      toast.success("Password updated — use it on your next sign-in.");
      setCurrent("");
      setNext("");
      setConfirm("");
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to change password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="space-y-1.5">
        <label htmlFor="pw-current" className="text-sm font-medium">
          Current password
        </label>
        <input
          id="pw-current"
          type="password"
          autoComplete="current-password"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
      </div>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="pw-new" className="text-sm font-medium">
            New password
          </label>
          <input
            id="pw-new"
            type="password"
            autoComplete="new-password"
            minLength={8}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="pw-confirm" className="text-sm font-medium">
            Confirm new password
          </label>
          <input
            id="pw-confirm"
            type="password"
            autoComplete="new-password"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>
      </div>

      {error && (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-400">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="submit"
          disabled={busy || !current || !next || !confirm}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-amber-500 px-4 text-sm font-medium text-white transition-colors hover:bg-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          Update password
        </button>
      </div>
    </form>
  );
}

/** Danger zone: delete the account permanently (type-to-confirm the email). */
function DangerPanel({ onDeleted }: { onDeleted: () => void }) {
  const user = useAppStore((s) => s.user);
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const email = user?.email ?? "";
  const typedOk = confirmText.trim().toLowerCase() === email.toLowerCase();

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount(password);
      toast.success("Account deleted. Goodbye 👋");
      onDeleted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to delete the account.");
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (typedOk && password) void submit();
      }}
    >
      <div className="flex gap-2.5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          This permanently deletes your account, all decks, cards and review history. There is no
          undo.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="acc-pw" className="text-sm font-medium">
          Your password
        </label>
        <input
          id="acc-pw"
          type="password"
          autoComplete="current-password"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-rose-500"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="acc-confirm" className="text-sm font-medium">
          Type <span className="font-mono text-rose-600 dark:text-rose-400">{email}</span> to
          confirm
        </label>
        <input
          id="acc-confirm"
          type="text"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-rose-500"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={email}
        />
      </div>

      {error && (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-400">
          {error}
        </p>
      )}

      <div className="flex justify-end pt-1">
        <button
          type="submit"
          disabled={busy || !typedOk || !password}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-rose-600 px-4 text-sm font-medium text-white transition-colors hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ShieldAlert className="h-4 w-4" />
          )}
          Delete account forever
        </button>
      </div>
    </form>
  );
}

/** Account settings modal — password management + danger zone. */
export function AccountSettingsDialog({ state, onOpenChange }: {
  state: OpenState;
  onOpenChange: (open: boolean) => void;
}) {
  const user = useAppStore((s) => s.user);
  const logout = useAppStore((s) => s.logout);

  return (
    <Dialog open={state.open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Account settings</DialogTitle>
          <DialogDescription className="truncate">
            Signed in as {user?.email}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="password">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="password">Password</TabsTrigger>
            <TabsTrigger value="danger" className="text-rose-600 data-[state=active]:text-rose-600">
              Danger zone
            </TabsTrigger>
          </TabsList>
          <Separator className="mb-4 mt-3" />
          <TabsContent value="password">
            <PasswordPanel onDone={() => onOpenChange(false)} />
          </TabsContent>
          <TabsContent value="danger">
            <DangerPanel onDone={() => {}} onDeleted={() => { onOpenChange(false); logout(); }} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
