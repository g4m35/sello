// Cooldown for user-triggered comp refreshes, so spam-clicking "Refresh comps"
// cannot fire repeated paid provider calls. The auto run after draft generation
// is not subject to this; it is a one-shot per item.

type Env = Record<string, string | undefined>;

export const DEFAULT_COMPS_REFRESH_COOLDOWN_MS = 60_000;

// Owners/alpha testers iterate fast; cap their manual refresh cooldown at 60s
// regardless of the (possibly long) seller cooldown configured in the env. This
// is a code-side override keyed off the admin allowlist, never an env change.
export const OWNER_COMPS_REFRESH_COOLDOWN_MS = 60_000;

export function compsRefreshCooldownMs(
  env: Env = process.env,
  opts: { isOwner?: boolean } = {},
): number {
  const raw = env.COMPS_REFRESH_COOLDOWN_SECONDS;
  const seconds = raw != null ? Number.parseInt(raw, 10) : NaN;
  const base =
    Number.isFinite(seconds) && seconds >= 0
      ? seconds * 1000
      : DEFAULT_COMPS_REFRESH_COOLDOWN_MS;
  // Never raise a shorter seller cooldown; only ever cap a longer one.
  return opts.isOwner ? Math.min(base, OWNER_COMPS_REFRESH_COOLDOWN_MS) : base;
}

export function evaluateRefreshCooldown(args: {
  lastRunAt: Date | null;
  now: Date;
  cooldownMs: number;
}): { allowed: boolean; retryAfterSeconds: number } {
  if (!args.lastRunAt || args.cooldownMs <= 0) {
    return { allowed: true, retryAfterSeconds: 0 };
  }
  const elapsed = args.now.getTime() - args.lastRunAt.getTime();
  if (elapsed >= args.cooldownMs) {
    return { allowed: true, retryAfterSeconds: 0 };
  }
  return {
    allowed: false,
    retryAfterSeconds: Math.ceil((args.cooldownMs - elapsed) / 1000),
  };
}
