# Builds the API or the worker from the monorepo. Usage:
#   docker build -f infrastructure/deployment/Dockerfile --build-arg APP=api -t commerce-os-api .
#   docker build -f infrastructure/deployment/Dockerfile --build-arg APP=worker -t commerce-os-worker .
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages ./packages
RUN npm ci --workspaces --include-workspace-root --ignore-scripts && npx prisma generate --schema packages/database/prisma/schema.prisma

FROM deps AS runtime
ARG APP=api
ENV NODE_ENV=production APP=${APP}
COPY apps/${APP} apps/${APP}
COPY packages ./packages
RUN npx prisma generate --schema packages/database/prisma/schema.prisma
USER node
WORKDIR /app/apps/${APP}
# Migrations run as a separate release step: `npm run migrate:deploy -w @commerce-os/database`
CMD ["npx", "tsx", "src/main.ts"]
