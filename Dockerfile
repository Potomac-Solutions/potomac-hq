# Potomac HQ's container. Railway builds it from this file (railway.json).

# The kit is a private repository, so fetching it needs a token. Railway's
# Dockerfile builds take build arguments, not secret mounts, and a build
# argument is kept in the history of the stage that uses it. So the
# dependencies are installed in this throwaway stage, and only node_modules
# is copied on: the image that ships has no token in its history.
FROM node:26-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
# Railway passes the service variable of the same name; CI passes its secret.
ARG KIT_READ_TOKEN
# Git is needed only to fetch the kit, which is pinned to a commit. The
# lockfile asks for it over SSH; this sends it over HTTPS instead, with the
# token when there is one. The rewrite lives only in this command's
# environment, never in a git config file.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && if [ -n "$KIT_READ_TOKEN" ]; then base="https://x-access-token:${KIT_READ_TOKEN}@github.com/"; else base="https://github.com/"; fi \
 && GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.${base}.insteadOf" GIT_CONFIG_VALUE_0="ssh://git@github.com/" npm ci --omit=dev

FROM node:26-slim

ENV NODE_ENV=production
# The router writes compiled pages here. It must be inside /app, because the
# compiled pages import packages from /app/node_modules. Everything else in
# /app stays read-only to the user HQ runs as.
ENV HQ_CACHE_DIR=/app/.cache/zubra-router
WORKDIR /app

COPY package.json package-lock.json ./
COPY --from=dependencies /app/node_modules ./node_modules
COPY bin ./bin
# HQ's own documents, put into the knowledge base when it starts.
COPY docs ./docs
COPY migrations ./migrations
COPY src ./src
COPY types ./types
RUN mkdir -p /app/.cache && chown node:node /app/.cache

USER node
EXPOSE 3000
# Migrations run on every start, before HQ serves anything. They are
# forward-only and recorded, so a start with nothing to apply changes nothing.
# bin/start.sh also handles Railway's root-owned volume: started as root, it
# hands the database's folder to `node` and drops to that user.
CMD ["sh", "bin/start.sh"]
