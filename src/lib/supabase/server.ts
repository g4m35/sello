import { createServerClient } from "@supabase/ssr";
import { createClient, type User } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { acceptInvite } from "@/lib/billing/membership";

import { AppError, getRequiredEnv } from "../errors";

function createSupabaseAuthClient() {
  return createClient(
    getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

export function createSupabaseServiceClient() {
  return createClient(
    getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

export function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

// Cookie-aware server client. Reads the Supabase session from request cookies
// and writes refreshed tokens back through the same cookie store. setAll is
// guarded because cookies() is read-only in some server contexts (e.g. Server
// Components); route handlers and Server Actions allow writes.
async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Read-only cookie context; token refresh will be handled by the
            // browser client instead.
          }
        },
      },
    },
  );
}

export async function getSupabaseUserFromCookies(): Promise<User | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return null;
    }
    return data.user;
  } catch {
    return null;
  }
}

async function getSupabaseUserFromBearerToken(token: string): Promise<User> {
  const supabase = createSupabaseAuthClient();
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    throw new AppError("Your session is invalid or expired.", 401);
  }

  return data.user;
}

export async function requireSupabaseUser(request: Request): Promise<User> {
  const token = getBearerToken(request);

  if (!token) {
    throw new AppError("Sign in before creating a listing draft.", 401);
  }

  const user = await getSupabaseUserFromBearerToken(token);
  await acceptPendingInvite(user);
  return user;
}

// Resolves the authenticated user for browser-driven routes: cookie session
// first (works on top-level navigations such as the eBay OAuth callback), then
// the existing Authorization: Bearer flow for in-app fetch callers. The user is
// always verified by Supabase via getUser; identity is never taken from request
// bodies, query params, or OAuth state.
export async function requireSupabaseUserFromRequestOrCookies(
  request: Request,
): Promise<User> {
  const token = getBearerToken(request);
  const cookieUser = await getSupabaseUserFromCookies();

  if (cookieUser) {
    if (token) {
      const bearerUser = await getSupabaseUserFromBearerToken(token);
      if (bearerUser.id !== cookieUser.id) {
        throw new AppError(
          "Authentication contexts do not match.",
          403,
          "AUTH_USER_MISMATCH",
        );
      }
    }
    await acceptPendingInvite(cookieUser);
    return cookieUser;
  }

  if (!token) {
    throw new AppError("Sign in before creating a listing draft.", 401);
  }

  const user = await getSupabaseUserFromBearerToken(token);
  await acceptPendingInvite(user);
  return user;
}

async function acceptPendingInvite(user: User): Promise<void> {
  if (!user.email) return;
  await acceptInvite(user.id, user.email);
}
