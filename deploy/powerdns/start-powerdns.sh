#!/bin/sh
set -eu

DB_PATH=/var/lib/powerdns/pdns.sqlite3

mkdir -p "$(dirname "$DB_PATH")"

if [ ! -f "$DB_PATH" ]; then
  sqlite3 "$DB_PATH" < /etc/pdns-init/schema.sql
  sqlite3 "$DB_PATH" < /etc/pdns-init/seed.sql
fi

exec /usr/local/sbin/pdns_server \
  --config-dir=/etc/pdns-zonix \
  --daemon=no \
  --disable-syslog=yes \
  --api=yes \
  --api-key=zonix-dev-powerdns-key \
  --webserver=yes \
  --webserver-address=0.0.0.0 \
  --webserver-port=8081 \
  --local-address=0.0.0.0 \
  --local-port=5300
