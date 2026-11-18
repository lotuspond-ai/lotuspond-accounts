#!/bin/sh
# M1 exit checks against a running local stack (deploy/docker-compose.local.yml). Run from the repository root:
#   tools/smoke.sh
# Checks: discovery and JWKS through Caddy; the health check; Hydra's admin API unreachable from the host and from
# Caddy but reachable from the app; each database role confined to its own database.
set -eu
cd "$(dirname "$0")/../deploy"
set -a; . ./.env; set +a
export ACME_EMAIL="${ACME_EMAIL:-local@localhost}"
C="docker compose -f docker-compose.yml -f docker-compose.local.yml"
BASE=http://localhost:8080
failures=0
pass() { echo "  ok    $1"; }
fail() { echo "  FAIL  $1"; failures=$((failures + 1)); }
check() { if eval "$2" >/dev/null 2>&1; then pass "$1"; else fail "$1"; fi; }
refused() { if eval "$2" >/dev/null 2>&1; then fail "$1"; else pass "$1"; fi; }

echo "Through Caddy"
check "discovery names the issuer" "curl -sf --noproxy '*' $BASE/.well-known/openid-configuration | grep -q '\"issuer\":\"$BASE\"'"
check "JWKS has a signing key" "curl -sf --noproxy '*' $BASE/.well-known/jwks.json | grep -q '\"use\":\"sig\"'"
check "health is ok" "curl -sf --noproxy '*' $BASE/api/health | grep -q '\"status\":\"ok\"'"
refused "Hydra admin paths are not routed" "curl -sf --noproxy '*' $BASE/admin/clients"

echo "Hydra's admin API"
# Positive control first: without it, the "unreachable from Caddy" checks would also pass with Caddy stopped.
check "Caddy reaches Hydra's public port (control)" "$C exec -T caddy wget -q -T 3 -O- http://hydra:4444/health/alive"
refused "unreachable from the host" "curl -sf --noproxy '*' -m 3 http://127.0.0.1:4445/health/ready"
refused "unreachable from Caddy by name" "$C exec -T caddy wget -q -T 3 -O- http://hydra-admin:4445/health/ready"
refused "unreachable from Caddy by address" "$C exec -T caddy wget -q -T 3 -O- http://172.31.250.2:4445/health/ready"
refused "unreachable from Caddy on Hydra's edge address" "$C exec -T caddy wget -q -T 3 -O- http://hydra:4445/health/ready"
check "reachable from the app" "$C exec -T app node -e \"fetch('http://hydra-admin:4445/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))\""

echo "Database roles"
psql_as() { $C exec -T -e PGPASSWORD="$2" db psql -h 127.0.0.1 -U "$1" -d "$3" -tAc 'select 1'; }
check "accounts_in reaches its own database" "psql_as accounts_in $CELL_IN_DB_PASSWORD accounts_in"
check "accounts_directory reaches its own database" "psql_as accounts_directory $DIRECTORY_DB_PASSWORD accounts_directory"
refused "accounts_in cannot reach hydra" "psql_as accounts_in $CELL_IN_DB_PASSWORD hydra"
refused "accounts_in cannot reach the directory" "psql_as accounts_in $CELL_IN_DB_PASSWORD accounts_directory"
refused "accounts_directory cannot reach the cell" "psql_as accounts_directory $DIRECTORY_DB_PASSWORD accounts_in"
refused "hydra cannot reach the cell" "psql_as hydra $HYDRA_DB_PASSWORD accounts_in"

if [ "$failures" -gt 0 ]; then echo "$failures check(s) failed."; exit 1; fi
echo "All checks passed."
