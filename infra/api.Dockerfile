FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS toolchain
WORKDIR /app
RUN apk add --no-cache --upgrade musl=1.2.6-r3 musl-utils=1.2.6-r3 \
    && npm install --global npm@12.2.0
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json

FROM toolchain AS build
RUN npm ci --no-audit
COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY packages/contracts packages/contracts
RUN npm run build --workspace @nexo/api

FROM toolchain AS production-dependencies
RUN npm ci --no-audit --omit=dev --workspace @nexo/api --include-workspace-root=false

FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS runtime
ENV NODE_ENV=production
RUN apk add --no-cache --upgrade musl=1.2.6-r3 musl-utils=1.2.6-r3 \
    && rm -rf /usr/local/lib/node_modules/npm /opt/yarn* /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/migrations ./apps/api/migrations
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build --chown=node:node /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=toolchain --chown=node:node /app/package-lock.json ./package-lock.json
COPY --chown=node:node fixtures/events.jsonl fixtures/expected_sample.json fixtures/expected_detailed.json ./fixtures/
COPY --chown=node:node infra/api-entrypoint.sh ./api-entrypoint.sh
USER node
EXPOSE 3000
ENTRYPOINT ["sh", "/app/api-entrypoint.sh"]
