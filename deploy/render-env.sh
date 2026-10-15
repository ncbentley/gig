#!/usr/bin/env bash
# Render deploy/.env from Infisical on the VPS.
# The machine identity lives in ~/.infisical/auth.env on that host.
# Usage:
#   deploy/render-env.sh
#   deploy/render-env.sh set APP_URL https://example.trycloudflare.com
set -euo pipefail
cd "$(dirname "$0")"

# shellcheck disable=SC1090
source "${HOME}/.infisical/auth.env"

: "${INFISICAL_DOMAIN:?missing INFISICAL_DOMAIN}"
: "${INFISICAL_PROJECT_ID:?missing INFISICAL_PROJECT_ID}"
: "${INFISICAL_CLIENT_ID:?missing INFISICAL_CLIENT_ID}"
: "${INFISICAL_CLIENT_SECRET:?missing INFISICAL_CLIENT_SECRET}"
INFISICAL_ENV="${INFISICAL_ENV:-prod}"

token="$(infisical login \
  --method=universal-auth \
  --client-id="${INFISICAL_CLIENT_ID}" \
  --client-secret="${INFISICAL_CLIENT_SECRET}" \
  --domain="${INFISICAL_DOMAIN}" \
  --silent --plain 2>/dev/null | tail -n 1)"

if [ "${1:-}" = "set" ]; then
  key="${2:?missing secret name}"
  value="${3:?missing secret value}"
  infisical secrets set "${key}=${value}" \
    --token="${token}" \
    --domain="${INFISICAL_DOMAIN}" \
    --projectId="${INFISICAL_PROJECT_ID}" \
    --env="${INFISICAL_ENV}" \
    --silent >/dev/null
  exit 0
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
infisical export \
  --token="${token}" \
  --domain="${INFISICAL_DOMAIN}" \
  --projectId="${INFISICAL_PROJECT_ID}" \
  --env="${INFISICAL_ENV}" \
  --format=dotenv \
  --silent > "$tmp"

# Infisical key names must be shell identifiers. A stray character otherwise
# stops Compose from reading the file. STRIPE_WEBHOOK_)SECRET becomes STRIPE_WEBHOOK_SECRET.
normalized="$(mktemp)"
trap 'rm -f "$tmp" "$normalized"' EXIT
while IFS= read -r line || [ -n "$line" ]; do
  if [ -z "$line" ] || [[ "$line" == \#* ]] || [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
    printf '%s\n' "$line" >> "$normalized"
    continue
  fi
  if [[ "$line" != *=* ]]; then
    echo "Dropping Infisical secret with an unusable name" >&2
    continue
  fi
  key="${line%%=*}"
  value="${line#*=}"
  clean="$(printf '%s' "$key" | tr -cd 'A-Za-z0-9_')"
  if [ -z "$clean" ] || [[ ! "$clean" =~ ^[A-Za-z_] ]]; then
    echo "Dropping Infisical secret with an unusable name" >&2
    continue
  fi
  echo "Renamed Infisical secret to ${clean}" >&2
  printf '%s=%s\n' "$clean" "$value" >> "$normalized"
done < "$tmp"
mv "$normalized" "$tmp"

if ! grep -q '^APP_SECRET=.' "$tmp" || ! grep -q '^POSTGRES_PASSWORD=.' "$tmp"; then
  echo "Infisical export is missing APP_SECRET or POSTGRES_PASSWORD" >&2
  exit 1
fi
chmod 600 "$tmp"
mv "$tmp" .env
trap - EXIT
