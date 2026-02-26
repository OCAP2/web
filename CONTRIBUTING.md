# Contributing

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| [Go](https://golang.org/dl/) | 1.26+ | Backend |
| [Node.js](https://nodejs.org/) | 24+ | Frontend build |
| [protoc](https://grpc.io/docs/protoc-installation/) | 3+ | Only if editing `.proto` files |

## Development Setup

```bash
git clone https://github.com/OCAP2/web.git
cd web

# Install frontend dependencies
npm ci --prefix ui

# Copy the example config (requires a valid secret to start the server)
cp setting.json.example setting.json
# Edit setting.json — at minimum change "secret" from "change-me"
```

### Frontend development (SolidJS/TypeScript)

Use the Vite dev server for hot module replacement. API requests are proxied to the Go server, so no frontend build is needed — Vite serves the frontend directly from source.

```bash
# Terminal 1 — start the Go server (serves only the API)
go run ./cmd/ocap-webserver

# Terminal 2 — start the Vite dev server (localhost:5173)
cd ui && npm run dev
```

Edit files in `ui/` — changes appear instantly in the browser via HMR.

### Backend development (Go)

Build the frontend once, then iterate on Go code:

```bash
cd ui && npm run build && cd ..
go run ./cmd/ocap-webserver
```

The frontend is embedded into the binary via `//go:embed`, so you only need to rebuild it when frontend code changes. At runtime, setting `OCAP_STATIC` to a directory path overrides the embedded files.

## Project Structure

```
cmd/
  ocap-webserver/       # Server entry point and CLI commands
internal/
  server/               # HTTP handlers, repositories, configuration
  frontend/             # Embedded SPA (go:embed)
  conversion/           # Background format conversion worker
  storage/              # Storage engines (JSON, Protobuf)
  maptool/              # Map tile pipeline
pkg/schemas/
  protobuf/             # Protobuf schema and generated code
ui/            # SolidJS + Vite + TypeScript frontend source
assets/                 # Marker SVGs, ammo icons, fonts
```

## Running Tests

```bash
# Go tests
go test ./...

# Frontend tests
cd ui
npm test
```

## Making Changes

1. Create a branch from `main`
2. Make your changes
3. Run `go test ./...` and `cd ui && npm test` to verify
4. Commit using [conventional commit](https://www.conventionalcommits.org/) messages:
   - `feat:` new functionality
   - `fix:` bug fixes
   - `refactor:` code restructuring without behavior change
   - `docs:` documentation only
   - `test:` adding or updating tests
5. Open a pull request against `main`

## Protobuf Schema Changes

If you modify `pkg/schemas/protobuf/v1/ocap.proto`:

```bash
go generate ./pkg/schemas/...
```

This regenerates the Go code. The frontend uses `ts-proto` — regenerate TypeScript types with:

```bash
cd ui
npx protoc --ts_proto_out=./src/generated --ts_proto_opt=esModuleInterop=true ../pkg/schemas/protobuf/v1/ocap.proto
```

## Docker Build

The Dockerfile handles both the frontend and backend build:

```bash
docker build -t ocap-webserver .
```

This runs a multi-stage build: Node builds the frontend, then Go compiles the binary with the frontend embedded.
