#!/bin/sh
# The restore drill on the local stack (build plan M6: "a restore from backup has been done once"). Run from the
# repository root on a machine with Docker and age. It destroys and recreates the local stack's volumes.
#   tools/restore-drill.sh
# 1. Start from empty volumes; register a product client; a person signs up through it (facts written down).
# 2. Back up with deploy/backup.sh, encrypted to a fresh age key.
# 3. Destroy everything: docker compose down -v, and deploy/.env.
# 4. Decrypt the encrypted copies with the private key, and restore with deploy/restore.sh.
# 5. The same person signs in with the same password: same subject, same signing key, email still confirmed.
set -eu
root=$(pwd)
export ACME_EMAIL="${ACME_EMAIL:-local@localhost}"
export COMPOSE_FILES="-f docker-compose.yml -f docker-compose.local.yml"
C="docker compose $COMPOSE_FILES"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
command -v age-keygen >/dev/null || { echo "age is not installed." >&2; exit 1; }

cd deploy
echo "1. A fresh stack, a client, a person."
$C down -v >/dev/null 2>&1 || true
rm -f .env && ./make-secrets.sh >/dev/null
$C up -d --no-build --wait --wait-timeout 180 >/dev/null 2>&1
client="drill-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
$C exec -T app node dist/clients-cli.js register --product health --client-id "$client" --public --redirect-uri http://localhost:9999/callback >/dev/null
(cd "$root" && DRILL_PHASE=before DRILL_FACTS="$work/facts.json" E2E_CLIENT_ID="$client" node --import tsx --test --test-reporter=dot test-e2e/restore.test.ts)

echo "2. Back up, encrypted."
age-keygen -o "$work/key.txt" 2>/dev/null
recipient=$(age-keygen -y "$work/key.txt")
BACKUP_AGE_RECIPIENT="$recipient" ./backup.sh
stamp=$(ls backups/encrypted | sed -n 's/^env-\(.*\)\.age$/\1/p' | sort | tail -1)
mkdir "$work/restore"
cp backups/encrypted/*-"$stamp"*.age "$work/restore/"

echo "3. Destroy the stack, its volumes, its secrets and the plain backups."
$C down -v >/dev/null 2>&1
rm -f .env backups/*-"$stamp"* backups/encrypted/*-"$stamp"*
[ -z "$(docker volume ls -q --filter name=lotuspond-accounts_pgdata)" ] || { echo "The database volume is still there." >&2; exit 1; }

echo "4. Decrypt with the private key, and restore."
for f in "$work"/restore/*.age; do age -d -i "$work/key.txt" -o "${f%.age}" "$f"; done
./restore.sh "$work/restore" "$stamp"

echo "5. The same person signs in."
cd "$root"
DRILL_PHASE=after DRILL_FACTS="$work/facts.json" E2E_CLIENT_ID="$client" node --import tsx --test --test-reporter=spec test-e2e/restore.test.ts
