FROM golang:1.24-alpine AS builder
WORKDIR /go/pkg/ocap
COPY . .
ARG build_version
ARG build_commit
RUN apk add --no-cache alpine-sdk && go build -ldflags "-X github.com/OCAP2/web/internal/server.BuildVersion=$build_version -X github.com/OCAP2/web/internal/server.BuildDate=`date -u +'%Y-%m-%dT%H:%M:%SZ'` -X github.com/OCAP2/web/internal/server.BuildCommit=$build_commit" -a -o app ./cmd/ocap-webserver

FROM alpine:3.23
WORKDIR /usr/local/ocap
RUN mkdir -p /etc/ocap /usr/local/ocap/data /var/lib/ocap/db /var/lib/ocap/maps /var/lib/ocap/data && \
    echo '{}' > /etc/ocap/setting.json

ENV OCAP_MARKERS=/usr/local/ocap/markers \
    OCAP_AMMO=/usr/local/ocap/ammo \
    OCAP_STATIC=/usr/local/ocap/static \
    OCAP_DB=/var/lib/ocap/db/data.db \
    OCAP_MAPS=/var/lib/ocap/maps \
    OCAP_DATA=/var/lib/ocap/data \
    OCAP_LISTEN=0.0.0.0:5000
EXPOSE 5000/tcp

COPY assets/markers /usr/local/ocap/markers
COPY assets/ammo /usr/local/ocap/ammo
COPY static /usr/local/ocap/static
COPY --from=builder /go/pkg/ocap/app /usr/local/ocap/app

CMD ["/usr/local/ocap/app"]
