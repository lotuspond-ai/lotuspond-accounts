#!/bin/sh
# End-to-end sign-in tests against a running local stack (deploy/docker-compose.local.yml). Run from the repository
# root after the stack is up: tools/e2e.sh
# Registers two test clients: a LotusPond product (public, PKCE) and an outside application consent must refuse.
set -eu
cd "$(dirname "$0")/../deploy"
export ACME_EMAIL="${ACME_EMAIL:-local@localhost}"
C="docker compose -f docker-compose.yml -f docker-compose.local.yml"
suffix=$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')
product="e2e-health-$suffix"
outsider="e2e-outsider-$suffix"
$C exec -T app node dist/clients-cli.js register --product health --client-id "$product" --public \
  --redirect-uri http://localhost:9999/callback --post-logout-uri http://localhost:9999/signed-out >/dev/null
$C exec -T hydra hydra create oauth2-client --endpoint http://172.31.250.2:4445 --id "$outsider" --name outsider \
  --grant-type authorization_code --response-type code --scope openid,email --redirect-uri http://localhost:9999/callback \
  --token-endpoint-auth-method none --format json >/dev/null
cd ..

# The import rehearsal, with synthetic accounts only: generate a Health export, import it in the app container with the
# real accounts-cli, and bring the answer back.
C="docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
password="synthetic test passphrase $suffix"
npx tsx tools/synthetic-health-export.ts 3 "$work/export.jsonl" "$password" >/dev/null
# Streamed in and out through the app container, so the files belong to its own unprivileged user.
$C exec -T app sh -c "umask 077 && cat > /tmp/export-$suffix.jsonl" < "$work/export.jsonl"
$C exec -T app node dist/accounts-cli.js import /tmp/export-$suffix.jsonl /tmp/answer-$suffix.jsonl
$C exec -T app cat /tmp/answer-$suffix.jsonl > "$work/answer.jsonl"
$C exec -T app rm -f /tmp/export-$suffix.jsonl /tmp/answer-$suffix.jsonl
first_id=$(head -1 "$work/export.jsonl" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).health_user_id))")
imported_email=$(head -1 "$work/export.jsonl" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).email))")
imported_sub=$(node -e "const l=require('fs').readFileSync('$work/answer.jsonl','utf8').trim().split('\n').map(JSON.parse);console.log(l.find(a=>a.health_user_id==='$first_id').sub)")

E2E_CLIENT_ID="$product" E2E_OUTSIDE_CLIENT_ID="$outsider" \
E2E_IMPORTED_EMAIL="$imported_email" E2E_IMPORTED_PASSWORD="$password" E2E_IMPORTED_SUB="$imported_sub" \
  node --import tsx --test --test-reporter=spec test-e2e/oidc.test.ts test-e2e/import.test.ts
