#!/bin/sh
set -eu

CONFIG_DIR=/etc/pdns-zonix
ZONES_DIR=/etc/pdns-zones

for _ in $(seq 1 60); do
  if pdnsutil --config-dir="$CONFIG_DIR" list-all-zones >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if [ -z "$(pdnsutil --config-dir="$CONFIG_DIR" list-all-zones 2>/dev/null | head -n 1)" ]; then
  for zone_file in "$ZONES_DIR"/*.zone; do
    [ -f "$zone_file" ] || continue
    zone_name=$(basename "$zone_file" .zone)
    pdnsutil --config-dir="$CONFIG_DIR" load-zone "$zone_name" "$zone_file"
  done
fi

exec /usr/local/sbin/pdns_server \
  --config-dir="$CONFIG_DIR" \
  --daemon=no \
  --disable-syslog=yes \
  --api=yes \
  --api-key=zonix-dev-powerdns-key \
  --webserver=yes \
  --webserver-address=0.0.0.0 \
  --webserver-port=8081 \
  --local-address=0.0.0.0 \
  --local-port=5300
