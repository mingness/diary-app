#!/bin/sh
# Dumps the database to deploy/backups/diary-<UTC time>.sql.gz and keeps the newest 14.
#   sh deploy/backup.sh
# The dump holds encrypted diaries; it is useless without the keyrings in deploy/.env, so store the two
# apart. Copy backups off the server too (see docs/DEPLOY-EC2.md).
set -eu

dir="$(dirname "$0")"
mkdir -p "$dir/backups"
file="$dir/backups/diary-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"

umask 077
# A failed dump leaves no half-written file behind.
trap 'rm -f "${file%.gz}"' EXIT
# Dump first, compress after: in a pipe, a failed pg_dump would still leave a (broken) backup behind.
docker compose -f "$dir/compose.yaml" exec -T db pg_dump -U diary --clean --if-exists diary >"${file%.gz}"
gzip "${file%.gz}"
echo "Wrote $file"

ls -1t "$dir"/backups/diary-*.sql.gz | tail -n +15 | xargs -r rm --
