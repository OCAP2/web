FROM golang:1.16-alpine as builder
WORKDIR /go/pkg/ocap
COPY . .
RUN apk add --no-cache alpine-sdk && go build -a -o app ./cmd

FROM alpine:3.14
WORKDIR /usr/local/ocap
RUN mkdir -p /etc/ocap /usr/local/ocap/data /usr/local/ocap/map /var/lib/ocap/db /var/lib/ocap/map /var/lib/ocap/data && \
    echo '{}' > /etc/ocap/setting.json

ENV OCAP_MARKER /usr/local/ocap/marker
ENV OCAP_STATIC /var/local/ocap/static

ENV OCAP_DB /var/lib/ocap/db/data.db
ENV OCAP_MAP /var/lib/ocap/map
ENV OCAP_DATA /var/lib/ocap/data

ENV OCAP_LISTEN 0.0.0.0:5000
EXPOSE 5000/tcp

COPY marker /usr/local/ocap/marker
COPY static /usr/local/ocap/static
COPY --from=builder /go/pkg/ocap/app /usr/local/ocap/app

CMD ["/usr/local/ocap/app"]
