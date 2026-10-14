# ---- Stage 1: build the Next.js app with Bun ----
FROM oven/bun:1 AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# The API base URL is baked into the client bundle at build time.
# Defaults to the docker-compose API service exposed on localhost:8000.
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN bun run build

# ---- Stage 2: minimal production runner ----
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# `next build` with output:"standalone" + the package.json build script
# already merges .next/static and public/ into .next/standalone.
COPY --from=builder /app/.next/standalone ./

USER node
EXPOSE 3000
CMD ["node", "server.js"]
