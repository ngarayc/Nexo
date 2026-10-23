FROM postgres:18.6-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873
# El proceso ya comienza como postgres: no necesita el helper Go para abandonar
# root. El volumen nuevo hereda el propietario del directorio de la imagen.
RUN apk add --no-cache --upgrade musl=1.2.6-r3 musl-utils=1.2.6-r3 brotli-libs=1.2.1-r0 \
    && rm /usr/local/bin/gosu \
    && chown -R postgres:postgres /var/lib/postgresql
USER postgres
