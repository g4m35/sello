"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import type { Session } from "@supabase/supabase-js";

import { getBrowserSupabase } from "@/lib/supabase/browser";

type SessionContextValue = {
  session: Session;
  token: string;
  /** The seller's chosen display name (from Supabase user_metadata.display_name). */
  name: string;
  signOut: () => Promise<void>;
  /** Re-open the name editor (used from the sidebar). */
  requestNameEdit: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}

function storedDisplayName(session: Session | null): string {
  const meta = session?.user.user_metadata as Record<string, unknown> | undefined;
  const value = meta?.display_name ?? meta?.full_name;
  return typeof value === "string" ? value.trim() : "";
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => getBrowserSupabase(), []);
  const [session, setSession] = useState<Session | null>(null);
  // When Supabase isn't configured there's nothing to wait for, so start ready.
  const [ready, setReady] = useState(() => getBrowserSupabase() == null);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  // Display name: an override (set right after saving) wins, otherwise read it
  // from the session metadata. Derived in render to avoid effect-based syncing.
  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const name = nameOverride ?? storedDisplayName(session);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => subscription.unsubscribe();
  }, [supabase]);

  async function handleSignIn(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setLoading(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // Land on a real page (not the "/" -> "/dashboard" server redirect, which
        // would drop the auth token/code from the URL before the client reads it).
        emailRedirectTo:
          typeof window !== "undefined"
            ? `${window.location.origin}/dashboard`
            : undefined,
      },
    });
    setLoading(false);
    setMessage(error ? error.message : "Check your email for a magic sign-in link.");
  }

  async function handleSaveName(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    const chosen = nameInput.trim();
    if (!chosen) return;
    setSavingName(true);
    const { error } = await supabase.auth.updateUser({
      data: { display_name: chosen },
    });
    setSavingName(false);
    if (!error) {
      setNameOverride(chosen);
      setEditingName(false);
    } else {
      setMessage(error.message);
    }
  }

  async function signOut() {
    await supabase?.auth.signOut();
    setSession(null);
    setNameOverride(null);
  }

  function requestNameEdit() {
    setNameInput(name);
    setEditingName(true);
  }

  if (!supabase) {
    return (
      <div className="auth-gate">
        <div className="auth-card">
          <div className="sidebar__brand" style={{ padding: 0 }}>
            <span className="sidebar__brand-mark">
              Counter<em>.</em>
            </span>
          </div>
          <div className="banner banner--warn">
            <div>
              <div className="banner__title">Supabase not configured</div>
              <div className="banner__desc">
                Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to
                sign in.
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="auth-gate">
        <div className="skel" style={{ width: 220, height: 14 }} />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="auth-gate">
        <form className="auth-card" onSubmit={handleSignIn}>
          <div className="sidebar__brand" style={{ padding: 0 }}>
            <span className="sidebar__brand-mark">
              Counter<em>.</em>
            </span>
          </div>
          <div>
            <div className="t-h2" style={{ marginBottom: 4 }}>
              Sign in
            </div>
            <div className="t-small">
              Cross-list streetwear, sneakers, and hype fashion in one place.
            </div>
          </div>
          <label className="field">
            <span className="field__label">Email</span>
            <input
              className="input"
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <button className="btn btn--accent btn--lg" type="submit" disabled={loading}>
            {loading ? "Sending…" : "Send magic link"}
          </button>
          {message && <div className="t-small">{message}</div>}
        </form>
      </div>
    );
  }

  // First run (or explicit edit): ask the seller what they want to be called.
  if (!name || editingName) {
    const isFirstRun = !storedDisplayName(session) && !nameOverride;
    return (
      <div className="auth-gate">
        <form className="auth-card" onSubmit={handleSaveName}>
          <div className="sidebar__brand" style={{ padding: 0 }}>
            <span className="sidebar__brand-mark">
              Counter<em>.</em>
            </span>
          </div>
          <div>
            <div className="t-h2" style={{ marginBottom: 4 }}>
              {isFirstRun ? "What should we call you?" : "Edit your name"}
            </div>
            <div className="t-small">
              This is the name shown across your workspace.
            </div>
          </div>
          <label className="field">
            <span className="field__label">Display name</span>
            <input
              className="input"
              type="text"
              required
              maxLength={40}
              autoFocus
              placeholder="e.g. Marlow"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
            />
          </label>
          <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
            {!isFirstRun && (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setEditingName(false)}
              >
                Cancel
              </button>
            )}
            <button
              className="btn btn--accent btn--lg"
              type="submit"
              disabled={savingName || !nameInput.trim()}
            >
              {savingName ? "Saving…" : isFirstRun ? "Continue" : "Save"}
            </button>
          </div>
          {message && <div className="t-small">{message}</div>}
        </form>
      </div>
    );
  }

  return (
    <SessionContext.Provider
      value={{ session, token: session.access_token, name, signOut, requestNameEdit }}
    >
      {children}
    </SessionContext.Provider>
  );
}
