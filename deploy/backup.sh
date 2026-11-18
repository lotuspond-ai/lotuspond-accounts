#!/bin/sh
# Back up LotusPond Accounts: the three databases (directory, the India account cell, and Hydra's, which holds the
# client registrations and the signing keys) and deploy/.env (its secrets unlock Hydra's keys and the directory's
# HMAC). Written to deploy/backups/, kept 14 days. Run nightly by lotuspond-accounts-backup.timer
# (deploy/install-backup.sh), or by hand from deploy/: ./backup.sh
#
# Encrypted copies: with BACKUP_AGE_RECIPIENT set (an age public key), each file is also encrypted to it, in
# deploy/backups/encrypted/. With BACKUP_S3_URI set too, those copies are uploaded to S3 with a key that may only add
# objects. Nothing leaves the server unencrypted. The private key stays offline, with whoever restores
# (docs/production.md, "Restoring").
set -eu
cd "$(dirname "$0")"

setting() {
  eval "v=\${$1:-}"
  if [ -z "$v" ] && [ -f .env ]; then v=$(sed -n "s/^$1=//p" .env | tail -n 1); fi
  v=${v#\"}; v=${v%\"}; v=${v#\'}; v=${v%\'}
  printf '%s' "$v"
}
s3_uri=$(setting BACKUP_S3_URI)
recipient=$(setting BACKUP_AGE_RECIPIENT)
if [ -n "$s3_uri" ] || [ -n "$recipient" ]; then
  case "$recipient" in
    age1*) ;;
    *) echo "BACKUP_AGE_RECIPIENT is not an age public key (age1...): nothing is copied off the server unencrypted." >&2; exit 1 ;;
  esac
  command -v age >/dev/null || { echo "age is not installed (sudo apt-get install -y age)." >&2; exit 1; }
fi

C="docker compose ${COMPOSE_FILES:-}"
stamp=$(date -u +%Y%m%d-%H%M%S)
umask 077
mkdir -p backups
for db in accounts_directory accounts_in hydra; do
  $C exec -T db pg_dump -U postgres_admin -Fc "$db" > "backups/$db-$stamp.dump"
done
cp .env "backups/env-$stamp"
find backups -maxdepth 1 -type f -mtime +14 -delete
echo "Backed up to deploy/backups/ ($stamp): accounts_directory, accounts_in, hydra, env."

if [ -n "$recipient" ]; then
  mkdir -p backups/encrypted
  for f in "backups/accounts_directory-$stamp.dump" "backups/accounts_in-$stamp.dump" "backups/hydra-$stamp.dump" "backups/env-$stamp"; do
    age -r "$recipient" -o "backups/encrypted/$(basename "$f").age" "$f"
  done
  find backups/encrypted -maxdepth 1 -type f -mtime +14 -delete
  echo "Encrypted copies in deploy/backups/encrypted/."
fi

if [ -n "$s3_uri" ]; then
  # Only this run's files, one by one: the server's key may add objects, never list, read or delete them.
  for f in backups/encrypted/*-"$stamp"*.age; do
    docker run --rm -v "$HOME/.aws:/root/.aws:ro" -v "$PWD/backups/encrypted:/out:ro" \
      amazon/aws-cli:2.40.1@sha256:4ade0fe3e60e0b9e1fb0910f86c6d992baf4e12d3172c25a3c8c11f6c81cee08 \
      s3 cp "/out/$(basename "$f")" "${s3_uri%/}/$(basename "$f")" --only-show-errors --region ap-south-1
  done
  echo "Uploaded to ${s3_uri%/}/."
fi
