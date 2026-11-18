#!/bin/sh
# Restore LotusPond Accounts from a backup: onto a new server after a loss, or for the restore drill. Run from deploy/,
# with the stack stopped and its volumes empty (a new server, or after `docker compose down -v`):
#   ./restore.sh <folder> <stamp>
# <folder> holds the decrypted files of one backup: accounts_directory-<stamp>.dump, accounts_in-<stamp>.dump,
# hydra-<stamp>.dump and env-<stamp>. Decrypt them first with the offline private key:
#   for f in *.age; do age -d -i key.txt -o "${f%.age}" "$f"; done
#
# The backup's .env goes back in place first. Its database passwords create the roles on the empty volume, and its
# Hydra secret is the only one that opens Hydra's restored signing keys. Each database is restored as its own role.
set -eu
cd "$(dirname "$0")"
dir=${1:?Usage: ./restore.sh <folder with the decrypted backup> <stamp>}
stamp=${2:?Usage: ./restore.sh <folder with the decrypted backup> <stamp>}
C="docker compose ${COMPOSE_FILES:-}"
for f in "env-$stamp" "accounts_directory-$stamp.dump" "accounts_in-$stamp.dump" "hydra-$stamp.dump"; do
  [ -s "$dir/$f" ] || { echo "Missing $dir/$f." >&2; exit 1; }
done
if $C ps --services --status running 2>/dev/null | grep -q .; then
  echo "The stack is running. Stop it, and start from empty volumes (docker compose down -v), first." >&2
  exit 1
fi
if [ -f .env ] && ! cmp -s .env "$dir/env-$stamp"; then
  mv .env ".env.before-restore-$(date -u +%Y%m%d-%H%M%S)"
  echo "Kept the current .env as .env.before-restore-*."
fi
umask 077
cp "$dir/env-$stamp" .env

# The database alone first: on an empty volume it makes the three roles and databases from this .env.
$C up -d --wait db
if [ "$($C exec -T db psql -U postgres_admin -d accounts_in -tAc 'select count(*) from information_schema.tables where table_schema in ($$public$$, $$drizzle$$)')" != "0" ]; then
  echo "accounts_in is not empty: restore only onto empty volumes." >&2
  exit 1
fi
for db in accounts_directory accounts_in hydra; do
  $C exec -T db pg_restore -U postgres_admin -d "$db" --no-owner --role="$db" --exit-on-error < "$dir/$db-$stamp.dump"
  echo "Restored $db."
done
$C up -d --wait
echo "LotusPond Accounts is back from the $stamp backup. Check it: tools/staging-check.sh <host>, or tools/smoke.sh locally."
