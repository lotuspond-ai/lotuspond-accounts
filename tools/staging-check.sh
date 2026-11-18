#!/bin/sh
# Checks a deployed LotusPond Accounts from the outside, as anyone on the internet sees it:
#   tools/staging-check.sh staging.accounts.lotuspond.ai
# TLS, the issuer, keys, health, security headers, the HTTP redirect, no development outbox, and every internal port
# closed. Run it after each staging (or production) deploy, and record the result in docs/validation/.
set -eu
HOST=${1:?Usage: tools/staging-check.sh <host>}
BASE="https://$HOST"
failures=0
pass() { echo "  ok    $1"; }
fail() { echo "  FAIL  $1"; failures=$((failures + 1)); }
check() { if eval "$2" >/dev/null 2>&1; then pass "$1"; else fail "$1"; fi; }
refused() { if eval "$2" >/dev/null 2>&1; then fail "$1"; else pass "$1"; fi; }

echo "HTTPS"
check "a valid certificate (no -k)" "curl -sf --max-time 10 $BASE/api/health"
check "health is ok" "curl -sf --max-time 10 $BASE/api/health | grep -q '\"status\":\"ok\"'"
check "plain HTTP redirects to HTTPS" "curl -s --max-time 10 -o /dev/null -w '%{http_code} %{redirect_url}' http://$HOST/ | grep -q '^30[18] https://$HOST/'"
check "Strict-Transport-Security is sent" "curl -sI --max-time 10 $BASE/login | grep -qi '^strict-transport-security: max-age=63072000'"
check "the content security policy has no unsafe-inline" "curl -sI --max-time 10 $BASE/login | grep -i '^content-security-policy:' | grep -q \"default-src 'none'\" && ! curl -sI --max-time 10 $BASE/login | grep -i '^content-security-policy:' | grep -q unsafe-inline"

echo "OpenID Connect"
check "the issuer is $BASE" "curl -sf --max-time 10 $BASE/.well-known/openid-configuration | grep -q '\"issuer\":\"$BASE\"'"
check "the JWKS has a signing key" "curl -sf --max-time 10 $BASE/.well-known/jwks.json | grep -q '\"use\":\"sig\"'"
check "the token endpoint is on HTTPS" "curl -sf --max-time 10 $BASE/.well-known/openid-configuration | grep -q '\"token_endpoint\":\"$BASE/oauth2/token\"'"

echo "Nothing internal is reachable"
refused "no development outbox" "curl -sf --max-time 10 $BASE/dev/outbox.json"
refused "no Hydra admin paths" "curl -sf --max-time 10 $BASE/admin/clients"
for port in 4444 4445 5432 8790 2019; do
  refused "port $port is closed" "curl -s --connect-timeout 4 --max-time 6 -o /dev/null http://$HOST:$port/"
done

if [ "$failures" -gt 0 ]; then echo "$failures check(s) failed."; exit 1; fi
echo "All checks passed for $HOST."
