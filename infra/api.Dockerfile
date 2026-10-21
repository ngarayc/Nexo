FROM node:24.22.0-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS toolchain
WORKDIR /app
RUN npm install --global npm@12.2.0
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

FROM toolchain AS build
RUN npm ci
COPY tsconfig.base.json ./
COPY apps/api apps/api
RUN npm run build --workspace @nexo/api

FROM toolchain AS production-dependencies
RUN npm ci --omit=dev --workspace @nexo/api --include-workspace-root=false

FROM node:24.22.0-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS runtime
ENV NODE_ENV=production
RUN rm -rf /usr/local/lib/node_modules/npm /opt/yarn* /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/migrations ./apps/api/migrations
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --chown=node:node infra/api-entrypoint.sh ./api-entrypoint.sh
USER node
EXPOSE 3000
ENTRYPOINT ["sh", "/app/api-entrypoint.sh"]
