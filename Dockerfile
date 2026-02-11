FROM node:22-alpine AS frontend
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
WORKDIR /usr/local/ocap
RUN mkdir -p /etc/ocap /usr/local/ocap/data /var/lib/ocap/db /var/lib/ocap/maps /var/lib/ocap/data && \
    echo '{}' > /etc/ocap/setting.json

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

CMD ["/usr/local/ocap/app"]
