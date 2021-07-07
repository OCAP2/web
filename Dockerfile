FROM golang:1.16-alpine as builder
WORKDIR /go/pkg/ocap-web
COPY . .
RUN apk add --no-cache alpine-sdk && go build -a -o app ./src/web

FROM alpine:3.14
WORKDIR /usr/local/ocap-web
COPY --from=builder /go/pkg/ocap-web/app /usr/local/ocap-web/app
COPY static /usr/local/ocap-web/static
COPY template /usr/local/ocap-web/template

CMD ["/usr/local/ocap-web/app"]
