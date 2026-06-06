"use client";

import { createContext, useContext, useEffect, useMemo, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";

import { getBrowserSupabase } from "@/lib/supabase/browser";

type SessionContextValue = {
  session: Session;
  token: string;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => getBrowserSupabase(), []);
  const [session, setSession] = useState<Session | null>(null);
  // When Supabase isn't configured there's nothing to wait for, so start ready.
  const [ready, setReady] = useState(() => getBrowserSupabase() == null);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

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
      options: { emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined },
    });
    setLoading(false);
    setMessage(
      error ? error.message : "Check your email for a magic sign-in link.",
    );
  }

  async function signOut() {
    await supabase?.auth.signOut();
    setSession(null);
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

  return (
    <SessionContext.Provider
      value={{ session, token: session.access_token, signOut }}
    >
      {children}
    </SessionContext.Provider>
  );
}
