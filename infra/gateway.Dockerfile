FROM golang:1.27.3-alpine@sha256:b8c9b82affbbb82a020bbcf998dad2ba9516944ac7e883524642a481a9505e9c AS build
ENV GOTOOLCHAIN=local CGO_ENABLED=0
WORKDIR /src
COPY infra/gateway/go.mod infra/gateway/go.sum ./
RUN go mod download
COPY infra/gateway/main.go ./
RUN --mount=type=cache,target=/root/.cache/go-build \
    go build -mod=readonly -trimpath -ldflags="-s -w" -o /out/caddy .

FROM caddy:2-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f
# Conservar la base oficial y reemplazar el binario por el mismo Caddy con Go y
# golang.org/x/net corregidos. Versiones y checksums en go.mod/go.sum.
COPY --from=build /out/caddy /usr/bin/caddy
USER 1000:1000
