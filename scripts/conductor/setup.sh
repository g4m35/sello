#!/usr/bin/env bash
# Conductor workspace setup for Sello.
# Runs when Conductor creates a local workspace. Never migrates, deploys, or prints secrets.
set -euo pipefail

workspace="${CONDUCTOR_WORKSPACE_PATH:-$(pwd)}"
root="${CONDUCTOR_ROOT_PATH:-}"
cd "$workspace"

fail() {
  echo "Conductor setup failed: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command '$1'. Install it, then recreate the workspace."
}

require_cmd node
require_cmd npm
require_cmd git

node_major="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$node_major" -lt 20 ]]; then
  fail "Node.js 20+ is required (found $(node -v))."
fi

if [[ ! -f package.json ]]; then
  fail "package.json not found in workspace '$workspace'."
fi

if [[ ! -f package-lock.json ]]; then
  fail "package-lock.json is required for reproducible installs."
fi

echo "Installing npm dependencies with npm ci..."
npm ci

echo "Generating Prisma client..."
npx prisma generate

# Copy approved local env files from the Conductor repo root when present and still missing.
# Never print file contents. Never copy production-only credential stores beyond gitignored .env*.
if [[ -n "$root" && -d "$root" && "$root" != "$workspace" ]]; then
  for candidate in .env.local .env.development.local .env.test.local; do
    if [[ -f "$root/$candidate" && ! -e "$workspace/$candidate" ]]; then
      if git -C "$root" check-ignore -q "$candidate"; then
        cp "$root/$candidate" "$workspace/$candidate"
        chmod 600 "$workspace/$candidate" 2>/dev/null || true
        echo "Copied ignored local file '$candidate' from Conductor root checkout."
      fi
    fi
  done
fi

if [[ ! -f .env.local && ! -f .env ]]; then
  echo "Warning: no .env.local found. Conductor copies gitignored .env* by default when present in the main checkout."
  echo "Create .env.local in the main Sello checkout (never commit it), then recreate the workspace if needed."
fi

if [[ -n "${CONDUCTOR_PORT:-}" ]]; then
  echo "Workspace port range starts at CONDUCTOR_PORT=${CONDUCTOR_PORT}."
fi

echo "Conductor workspace setup complete."
echo "Use Run → Start Sello. Do not run database migrations, live marketplace actions, or deploys from setup."
