FROM node:24-alpine AS frontend
WORKDIR /app
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
COPY ui/ ./
RUN npx vite build --outDir /frontend-dist

FROM golang:1.26-alpine AS builder
RUN apk add --no-cache alpine-sdk
WORKDIR /go/pkg/ocap
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=frontend /frontend-dist ./internal/frontend/dist
ARG build_version
ARG build_commit
RUN go build -ldflags "-X github.com/OCAP2/web/internal/server.BuildVersion=$build_version -X github.com/OCAP2/web/internal/server.BuildDate=`date -u +'%Y-%m-%dT%H:%M:%SZ'` -X github.com/OCAP2/web/internal/server.BuildCommit=$build_commit" -o app ./cmd/ocap-webserver

FROM alpine:3.23
ARG VARIANT=slim
ARG TARGETARCH
WORKDIR /usr/local/ocap
RUN adduser -D -h /home/container container && \
    mkdir -p /usr/local/ocap/data /var/lib/ocap/db /var/lib/ocap/maps /var/lib/ocap/data

# Full variant: install maptool dependencies (GDAL, tippecanoe, pmtiles)
ARG TIPPECANOE_VERSION=2.79.0
ARG PMTILES_VERSION=1.30.0
RUN if [ "$VARIANT" = "full" ]; then \
      apk add --no-cache gdal-tools gdal-driver-jpeg gdal-driver-png py3-gdal sqlite-libs zlib && \
      apk add --no-cache --virtual .build-deps build-base bash git sqlite-dev zlib-dev && \
      wget -qO /tmp/tippecanoe.tar.gz "https://github.com/felt/tippecanoe/archive/refs/tags/${TIPPECANOE_VERSION}.tar.gz" && \
      tar -xzf /tmp/tippecanoe.tar.gz -C /tmp && \
      cd /tmp/tippecanoe-${TIPPECANOE_VERSION} && make -j$(nproc) && make install && \
      rm -rf /tmp/tippecanoe* && \
      apk del .build-deps && \
      case "$TARGETARCH" in \
        amd64) ARCH="x86_64" ;; \
        arm64) ARCH="arm64" ;; \
        *) echo "unsupported arch: $TARGETARCH" && exit 1 ;; \
      esac && \
      wget -qO /tmp/pmtiles.tar.gz "https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}/go-pmtiles_${PMTILES_VERSION}_Linux_${ARCH}.tar.gz" && \
      tar -xzf /tmp/pmtiles.tar.gz -C /usr/local/bin pmtiles && \
      chmod +x /usr/local/bin/pmtiles && \
      rm /tmp/pmtiles.tar.gz; \
    fi

ENV OCAP_AMMO=/usr/local/ocap/ammo \
    OCAP_DATA=/var/lib/ocap/data \
    OCAP_DB=/var/lib/ocap/db/data.db \
    OCAP_FONTS=/usr/local/ocap/fonts \
    OCAP_LISTEN=0.0.0.0:5000 \
    OCAP_MAPS=/var/lib/ocap/maps \
    OCAP_MARKERS=/usr/local/ocap/markers
EXPOSE 5000/tcp
VOLUME /var/lib/ocap/db /var/lib/ocap/maps /var/lib/ocap/data

COPY assets/ammo /usr/local/ocap/ammo
COPY assets/fonts /usr/local/ocap/fonts
COPY assets/markers /usr/local/ocap/markers
COPY --from=builder /go/pkg/ocap/app /usr/local/ocap/app
COPY --chmod=755 docker/entrypoint.sh /entrypoint.sh

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://localhost:${OCAP_LISTEN##*:}/api/healthcheck || exit 1

ENTRYPOINT ["/entrypoint.sh"]
