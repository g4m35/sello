import { ConfigurationError } from "@/lib/errors";

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  priceIds: Record<"pro" | "kingpin", string>;
  publishableKey: string | null;
}

type Env = Record<string, string | undefined>;

// A var counts as present only when non-empty and not bracket-masked. The
// codebase's getRequiredEnv uses the same "[" convention for masked/unset
// secrets (e.g. Vercel pulls), so we mirror it here.
function present(value: string | undefined): value is string {
  return !!value && !value.includes("[");
}

const REQUIRED = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_PRO",
  "STRIPE_PRICE_KINGPIN",
] as const;

// True only when every required Stripe var is set. Lets the app keep billing
// dormant (like comps) when keys are absent, instead of crashing at import.
export function isBillingConfigured(env: Env = process.env): boolean {
  return REQUIRED.every((key) => present(env[key]));
}

function requireVar(env: Env, key: string): string {
  const value = env[key];
  if (!present(value)) throw new ConfigurationError(key);
  return value;
}

export function loadStripeConfig(env: Env = process.env): StripeConfig {
  return {
    secretKey: requireVar(env, "STRIPE_SECRET_KEY"),
    webhookSecret: requireVar(env, "STRIPE_WEBHOOK_SECRET"),
    priceIds: {
      pro: requireVar(env, "STRIPE_PRICE_PRO"),
      kingpin: requireVar(env, "STRIPE_PRICE_KINGPIN"),
    },
    publishableKey: present(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
      ? env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
      : null,
  };
}
