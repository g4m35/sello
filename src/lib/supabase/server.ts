import { createClient, type User } from "@supabase/supabase-js";

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

export async function requireSupabaseUser(request: Request): Promise<User> {
  const token = getBearerToken(request);

  if (!token) {
    throw new AppError("Sign in before creating a listing draft.", 401);
  }

  const supabase = createSupabaseAuthClient();
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    throw new AppError("Your session is invalid or expired.", 401);
  }

  return data.user;
}
