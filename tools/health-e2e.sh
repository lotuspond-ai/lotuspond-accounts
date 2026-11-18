#!/bin/sh
# LotusPond Health signing in with the real LotusPond Accounts (build plan M3). Run from the repository root, with the
# local stack up including deploy/docker-compose.health.yml, and a lotuspond-health checkout with dependencies
# installed:
#   HEALTH_DIR=../lotuspond-health tools/health-e2e.sh
# Registers a fresh confidential Health client at Accounts (back-channel logout to this machine), starts Health's
# server against Accounts on port 8787 with a throwaway database, runs test-e2e/health.test.ts, then stops Health.
set -eu
: "${HEALTH_DIR:?Set HEALTH_DIR to a lotuspond-health checkout with dependencies installed}"
HEALTH_DIR=$(cd "$HEALTH_DIR" && pwd)
root=$(pwd)
export ACME_EMAIL="${ACME_EMAIL:-local@localhost}"
C="docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml -f deploy/docker-compose.health.yml"
client="lotuspond-health-e2e-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
port=8787

out=$($C exec -T app node dist/clients-cli.js register --product health --client-id "$client" \
  --redirect-uri "http://localhost:$port/api/auth/accounts/callback" \
  --post-logout-uri "http://localhost:$port/login" --post-logout-uri "http://localhost:$port/api/auth/accounts/signed-out" \
  --backchannel-logout-uri "http://host.docker.internal:$port/api/auth/accounts/backchannel-logout")
secret=$(printf '%s\n' "$out" | sed -n "s/.*store it in the product's secrets): //p")
[ -n "$secret" ] || { echo "Registering the Health client gave no secret." >&2; exit 1; }

if curl -s --noproxy '*' -o /dev/null "http://localhost:$port/"; then
  echo "Something already listens on port $port. Stop it first: the tests must reach the Health server started here." >&2
  exit 1
fi

data=$(mktemp -d)
log="$data/health.log"
# Health runs in its own process group, so stopping it stops npx, tsx and the server under them.
# Stop Health's whole process group and wait until it has gone: its embedded database writes files while it shuts
# down, and deleting its folder before then fails ("Directory not empty").
cleanup() {
  if [ -n "${pid:-}" ]; then
    kill -- "-$pid" 2>/dev/null || true
    for _ in $(seq 1 100); do kill -0 -- "-$pid" 2>/dev/null || break; sleep 0.1; done
  fi
  rm -rf "$data"
}
trap cleanup EXIT INT TERM
cd "$HEALTH_DIR/server"
NODE_ENV=development PORT=$port DATA_DIR="$data/db" PUBLIC_URL="http://localhost:$port" RECORD_AGENT=off \
  ACCOUNTS_ISSUER=http://localhost:8080 ACCOUNTS_CLIENT_ID="$client" ACCOUNTS_CLIENT_SECRET="$secret" \
  setsid npx tsx src/index.ts >"$log" 2>&1 &
pid=$!
ready=no
for _ in $(seq 1 60); do
  if curl -sf --noproxy '*' "http://localhost:$port/api/health" >/dev/null; then ready=yes; break; fi
  kill -0 "$pid" 2>/dev/null || break
  sleep 1
done
[ "$ready" = yes ] || { echo "Health did not start:" >&2; tail -20 "$log" >&2; exit 1; }
# The server answering must be this one, configured with this run's client.
grep -q "LotusPond Accounts sign-in: http://localhost:8080" "$log" || { echo "The server on port $port is not the one started here." >&2; exit 1; }

cd "$root"
status=0
HEALTH_URL="http://localhost:$port" node --import tsx --test --test-reporter=spec test-e2e/health.test.ts || status=$?
if [ "$status" -ne 0 ]; then echo "--- Health's log"; tail -40 "$log"; fi
exit "$status"
