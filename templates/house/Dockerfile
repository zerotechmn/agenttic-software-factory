# Build stage: native deps (better-sqlite3) compile here, then dev deps are pruned.
FROM node:24-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# Runtime stage: no toolchain, just the app.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DATABASE_URL=/app/data/app.db
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json tsconfig.json ./
COPY src ./src
RUN mkdir -p /app/data
EXPOSE 8787
CMD ["node_modules/.bin/tsx", "src/server/index.ts"]
