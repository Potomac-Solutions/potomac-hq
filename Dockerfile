# Potomac HQ's container. Railway builds it from this file (railway.json).
FROM node:26-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
# Git is needed only to fetch the kit, which is pinned to a commit.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && npm ci --omit=dev \
 && apt-get purge -y git \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* /root/.npm

COPY bin ./bin
COPY migrations ./migrations
COPY src ./src
COPY types ./types

USER node
EXPOSE 3000
# Migrations run on every start, before HQ serves anything. They are
# forward-only and recorded, so a start with nothing to apply changes nothing.
CMD ["sh", "-c", "node bin/migrate.ts && exec node bin/serve.ts"]
