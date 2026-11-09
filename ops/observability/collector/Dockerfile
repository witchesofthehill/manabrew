FROM node:24-alpine AS build
WORKDIR /app
COPY ops/observability/collector/package*.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY src/lib/errorReportingPrivacy.ts src/lib/errorReportingDiagnostics.ts src/lib/errorReportingRedaction.ts src/lib/
COPY ops/observability/collector/*.mjs ops/observability/collector/
RUN node_modules/.bin/esbuild ops/observability/collector/server.mjs --bundle --platform=node --format=esm --alias:@=./src --outfile=/out/server.mjs

FROM node:24-alpine
ENV NODE_OPTIONS=--max-old-space-size=384
WORKDIR /app
COPY --from=build /out/ ./
RUN mkdir -p /var/lib/faro/state && chown node:node /var/lib/faro/state
USER node
EXPOSE 12347
CMD ["node", "server.mjs"]
