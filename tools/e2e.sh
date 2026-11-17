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
E2E_CLIENT_ID="$product" E2E_OUTSIDE_CLIENT_ID="$outsider" node --import tsx --test --test-reporter=spec test-e2e/*.test.ts
