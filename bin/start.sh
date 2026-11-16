#!/bin/sh
# Starts Potomac HQ in its container: migrations first, then the server.
#
# Railway mounts a volume owned by root, and says to set RAILWAY_RUN_UID=0
# so the container starts as root and can write to it. HQ should not run as
# root. So when this starts as root it gives the database's folder to the
# unprivileged `node` user, then drops to that user for good. Started as any
# other user (locally, in CI) it runs as that user and changes nothing.
set -eu

run() {
  node bin/migrate.ts
  exec node bin/serve.ts
}

if [ "$(id -u)" != "0" ]; then
  run
fi

data_dir="$(dirname "${HQ_DATABASE_PATH:?Set HQ_DATABASE_PATH.}")"
mkdir -p "$data_dir"
chown -R node:node "$data_dir"
# The same script again, as `node`, with root's extra groups dropped.
exec setpriv --reuid=node --regid=node --init-groups -- "$0"
