#!/bin/sh
# The switch-over rehearsal (build plan M7), with synthetic people only. Run from the repository root, with the local
# stack up including deploy/docker-compose.health.yml, and a lotuspond-health checkout with dependencies installed:
#   HEALTH_DIR=../lotuspond-health tools/cutover-rehearsal.sh
# It runs the production sequence of docs/cutover.md against throwaway servers:
#   1. Health as it is today (no ACCOUNTS_ISSUER): three people register with Health passwords.
#   2. Health stopped; Health's accounts:export; Accounts' import; Health's accounts:link.
#   3. Health with ACCOUNTS_ISSUER, passwords still on (the plan's "both" stage), and the checks.
#   4. Rollback: Health with ACCOUNTS_ISSUER unset again, and what each kind of person can do.
#   5. The watch report.
set -eu
: "${HEALTH_DIR:?Set HEALTH_DIR to a lotuspond-health checkout with dependencies installed}"
HEALTH_DIR=$(cd "$HEALTH_DIR" && pwd)
root=$(pwd)
export ACME_EMAIL="${ACME_EMAIL:-local@localhost}"
C="docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml -f deploy/docker-compose.health.yml"
port=8787
work=$(mktemp -d)
pid=
stop_health() { [ -n "$pid" ] && { kill -- "-$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; pid=; }; sleep 1; }
trap 'stop_health; rm -rf "$work"' EXIT INT TERM

if curl -s --noproxy '*' -o /dev/null "http://localhost:$port/"; then echo "Port $port is taken; stop what runs there." >&2; exit 1; fi

client="lotuspond-health-cutover-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
out=$($C exec -T app node dist/clients-cli.js register --product health --client-id "$client" \
  --redirect-uri "http://localhost:$port/api/auth/accounts/callback" \
  --post-logout-uri "http://localhost:$port/login" --post-logout-uri "http://localhost:$port/api/auth/accounts/signed-out" \
  --backchannel-logout-uri "http://host.docker.internal:$port/api/auth/accounts/backchannel-logout")
secret=$(printf '%s\n' "$out" | sed -n "s/.*store it in the product's secrets): //p")

health_env() {
  echo "NODE_ENV=development PORT=$port DATA_DIR=$work/db PUBLIC_URL=http://localhost:$port RECORD_AGENT=off"
}
start_health() {
  # $1: "accounts" to set ACCOUNTS_ISSUER (the switch-over), anything else for Health as it is today.
  extra=
  [ "$1" = accounts ] && extra="ACCOUNTS_ISSUER=http://localhost:8080 ACCOUNTS_CLIENT_ID=$client ACCOUNTS_CLIENT_SECRET=$secret"
  (cd "$HEALTH_DIR/server" && env $(health_env) $extra setsid npx tsx src/index.ts) >"$work/health-$1.log" 2>&1 &
  pid=$!
  for _ in $(seq 1 60); do
    curl -sf --noproxy '*' "http://localhost:$port/api/health" >/dev/null && return 0
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  echo "Health did not start:" >&2; tail -20 "$work/health-$1.log" >&2; exit 1
}
health_cli() { (cd "$HEALTH_DIR/server" && env $(health_env) npx tsx src/index.ts "$@"); }
phase() {
  status=0
  (cd "$root" && CUTOVER_PHASE=$1 CUTOVER_FACTS="$work/facts.json" HEALTH_URL="http://localhost:$port" node --import tsx --test --test-reporter=spec test-e2e/cutover.test.ts) >"$work/phase-$1.txt" 2>&1 || status=$?
  if [ "$status" -eq 0 ]; then grep -E '^✔' "$work/phase-$1.txt"; return 0; fi
  sed -n '/failing tests:/,$p' "$work/phase-$1.txt" >&2
  echo "--- Health's log" >&2; tail -20 "$work"/health-*.log >&2
  exit "$status"
}

echo "1. Health today: three people register with Health passwords."
start_health today
phase before
stop_health

echo "2. Health's export, Accounts' import, Health's link."
health_cli accounts:export "$work/export.jsonl"
$C exec -T app sh -c "umask 077 && cat > /tmp/cutover-export.jsonl" < "$work/export.jsonl"
$C exec -T app node dist/accounts-cli.js import /tmp/cutover-export.jsonl /tmp/cutover-answer.jsonl
$C exec -T app cat /tmp/cutover-answer.jsonl > "$work/answer.jsonl"
$C exec -T app rm -f /tmp/cutover-export.jsonl /tmp/cutover-answer.jsonl
health_cli accounts:link "$work/answer.jsonl"

echo "3. Health with ACCOUNTS_ISSUER, passwords still on."
start_health accounts
phase after
stop_health

echo "4. Rollback: ACCOUNTS_ISSUER unset."
start_health today
phase rollback
stop_health

echo "5. The watch report."
$C exec -T app node dist/accounts-cli.js report 1
