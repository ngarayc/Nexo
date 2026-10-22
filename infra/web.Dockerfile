FROM node:24.22.0-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS build
WORKDIR /app
RUN apk add --no-cache --upgrade musl=1.2.6-r3 musl-utils=1.2.6-r3 \
    && npm install --global npm@12.2.0
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci --no-audit
COPY tsconfig.base.json ./
COPY apps/web apps/web
COPY packages/contracts packages/contracts
RUN npm run build --workspace @nexo/web

FROM nginx:1.30.6-alpine@sha256:970364228b1e4f932abc22d321932816782cca8a20b85a77552a7cfe9acfb3b5 AS runtime
RUN apk add --no-cache --upgrade libexpat=2.9.0-r0 libx11=1.8.14-r0 musl=1.2.6-r3 musl-utils=1.2.6-r3
COPY --from=build /app/apps/web/dist/web/browser /usr/share/nginx/html
COPY infra/nginx.conf /etc/nginx/nginx.conf
USER nginx
EXPOSE 8080
ENTRYPOINT ["nginx", "-g", "daemon off;"]
