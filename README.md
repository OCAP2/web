# OCAP Web component

![Go Coverage](https://raw.githubusercontent.com/OCAP2/web/badges/.badges/main/coverage.svg)
![UI Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/OCAP2/web/badges/ui-coverage.json)

OCAP Web serves and plays back Arma 3 mission recordings. It supports both legacy JSON recordings and chunked Protobuf format for efficient streaming of large recordings.

## Installation

### Pre-built binaries

Download the latest release from [GitHub Releases](https://github.com/OCAP2/web/releases):

| Platform | Archive |
|----------|---------|
| Windows x64 | `ocap-webserver-windows-amd64.zip` |
| Linux x64 | `ocap-webserver-linux-amd64.tar.gz` |
| Linux ARM64 | `ocap-webserver-linux-arm64.tar.gz` |

Each archive contains the binary and required assets (markers, ammo icons).

### Build from source

Requires [Go 1.26+](https://golang.org/dl/) and [Node.js 24+](https://nodejs.org/).

```bash
# Build the frontend
cd ui && npm ci && npm run build && cd ..

# Build the server (frontend is embedded into the binary)
go build -o ocap-webserver ./cmd/ocap-webserver

# Or build everything via Docker
docker build -t ocap-webserver .
```

For development setup and workflow details, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Docker

Docker images are available for `linux/amd64` and `linux/arm64` architectures in two variants:

| Variant | Tag | Description |
|---------|-----|-------------|
| **Slim** (default) | `latest`, `v1.2.3` | Web server only |
| **Full** | `full`, `v1.2.3-full` | Web server + integrated Map Manager (GDAL, tippecanoe, pmtiles) |

The **full** variant includes all tools needed for the Map Manager — an admin page that processes Arma 3 map data (grad_meh exports) into PMTiles and MapLibre styles directly from the web UI. The server auto-detects the available tools at startup; no extra configuration is needed.

```bash
# Slim — just the web server
docker run --name ocap-web -d \
  -p 5000:5000/tcp \
  -e OCAP_SECRET="same-secret" \
  -e OCAP_CONVERSION_ENABLED="true" \
  -v ocap-records:/var/lib/ocap/data \
  -v ocap-maps:/var/lib/ocap/maps \
  -v ocap-database:/var/lib/ocap/db \
  ghcr.io/ocap2/web:latest

# Full — web server with integrated Map Manager
docker run --name ocap-web -d \
  -p 5000:5000/tcp \
  -e OCAP_SECRET="same-secret" \
  -e OCAP_CONVERSION_ENABLED="true" \
  -v ocap-records:/var/lib/ocap/data \
  -v ocap-maps:/var/lib/ocap/maps \
  -v ocap-database:/var/lib/ocap/db \
  ghcr.io/ocap2/web:full
```

### Volumes

| Path | Description |
|------|-------------|
| `/var/lib/ocap/data` | Recording storage (JSON and chunked formats) |
| `/var/lib/ocap/maps` | Map tiles ([download here](https://drive.google.com/drive/folders/1qtT0Fr4Dfwd48ihZNc8YN-xgxHchKoiu)) |
| `/var/lib/ocap/db` | SQLite database |

## Pelican Panel

A [Pelican Panel](https://pelican.dev/) egg is provided for deploying OCAP2 Web as a managed server instance. Import `egg-ocap2-web.json` in the Pelican admin panel under **Eggs → Import Egg**.

The egg uses the project's Docker image (`ghcr.io/ocap2/web`) directly. Persistent data (database, recordings, maps) is stored under `/home/container/` via Pelican's volume mount.

## Configuration

The configuration file is called `setting.json`. All settings can also be set via environment variables with the `OCAP_` prefix. Nested keys use underscores: `auth.sessionTTL` → `OCAP_AUTH_SESSIONTTL`.

```json
{
  "listen": "127.0.0.1:5000",
  "secret": "your-secret",
  "logger": true,
  "auth": {
    "sessionTTL": "24h",
    "adminSteamIds": ["76561198012345678"],
    "steamApiKey": ""
  },
  "customize": {
    "enabled": true,
    "websiteURL": "https://example.com",
    "websiteLogo": "https://example.com/logo.png"
  },
  "conversion": {
    "enabled": true,
    "interval": "5m"
  },
  "streaming": {
    "enabled": true
  },
  "cors": {
    "allowedOrigins": []
  }
}
```

### Server

| Setting | Env Var | Description | Default |
|---------|---------|-------------|---------|
| `listen` | `OCAP_LISTEN` | Server address | `127.0.0.1:5000` |
| `prefixURL` | `OCAP_PREFIXURL` | URL prefix for all routes | `""` |
| `secret` | `OCAP_SECRET` | Shared secret — authenticates record uploads and signs admin session JWTs | *required* |
| `logger` | `OCAP_LOGGER` | Enable request logging to STDOUT | `false` |

### Paths

| Setting | Env Var | Description | Default |
|---------|---------|-------------|---------|
| `db` | `OCAP_DB` | Path to SQLite database | `data.db` |
| `data` | `OCAP_DATA` | Path to recording storage | `data` |
| `maps` | `OCAP_MAPS` | Path to map tiles | `maps` |
| `markers` | `OCAP_MARKERS` | Path to marker icons | `assets/markers` |
| `ammo` | `OCAP_AMMO` | Path to ammo icons | `assets/ammo` |
| `fonts` | `OCAP_FONTS` | Path to fonts | `assets/fonts` |
| `static` | `OCAP_STATIC` | Serve frontend from this directory instead of the embedded build | *embedded* |

> **Docker note:** The Docker image overrides path defaults to `/var/lib/ocap/...` and `/usr/local/ocap/...`. See [Volumes](#volumes) for the Docker-specific paths.

### Admin Authentication

Admin access uses Steam OpenID — no passwords. Admins authenticate via their Steam account and are authorized against an allowlist of Steam64 IDs.

| Setting | Env Var | Description | Default |
|---------|---------|-------------|---------|
| `auth.sessionTTL` | `OCAP_AUTH_SESSIONTTL` | How long admin sessions last | `24h` |
| `auth.adminSteamIds` | `OCAP_AUTH_ADMINSTEAMIDS` | Steam64 IDs authorized for admin access (comma-separated, no brackets, in env var) | `[]` |
| `auth.steamApiKey` | `OCAP_AUTH_STEAMAPIKEY` | Steam Web API key for fetching display names and avatars ([get one here](https://steamcommunity.com/dev/apikey)) | `""` |

The Steam API key is optional. Without it, the admin badge shows the raw Steam64 ID. With it, the admin's Steam profile picture and display name are shown.

### Customization

For a full theming guide with example themes and an AI prompt to generate your own, see [Customization Docs](docs/customization.md).

| Setting | Env Var | Description | Default |
|---------|---------|-------------|---------|
| `customize.enabled` | `OCAP_CUSTOMIZE_ENABLED` | Enable the customize endpoint | `false` |
| `customize.websiteURL` | `OCAP_CUSTOMIZE_WEBSITEURL` | Link on the logo to your website | `""` |
| `customize.websiteLogo` | `OCAP_CUSTOMIZE_WEBSITELOGO` | URL to your website logo | `""` |
| `customize.websiteLogoSize` | `OCAP_CUSTOMIZE_WEBSITELOGOSIZE` | Logo size | `32px` |
| `customize.disableKillCount` | `OCAP_CUSTOMIZE_DISABLEKILLCOUNT` | Hide kill counts in the UI | `false` |
| `customize.hideMapFilters` | `OCAP_CUSTOMIZE_HIDEMAPFILTERS` | Hide the map filter dropdown on the recording list | `false` |
| `customize.headerTitle` | `OCAP_CUSTOMIZE_HEADERTITLE` | Custom header title | `""` |
| `customize.headerSubtitle` | `OCAP_CUSTOMIZE_HEADERSUBTITLE` | Custom header subtitle | `""` |
| `customize.cssOverrides` | `OCAP_CUSTOMIZE_CSSOVERRIDES` | CSS variable overrides (JSON object, see below) | `{}` |

#### CSS Overrides

Override any CSS custom property to theme the UI without rebuilding. In `setting.json`:

```json
"cssOverrides": {
  "--accent-primary": "#fcb00d",
  "--bg-dark": "#1a2a1a",
  "--text-on-accent": "#1a2a1a"
}
```

Via environment variable (for Docker), pass a JSON string:

```bash
OCAP_CUSTOMIZE_CSSOVERRIDES='{"--accent-primary":"#fcb00d","--bg-dark":"#1a2a1a","--text-on-accent":"#1a2a1a"}'
```

Common variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `--accent-primary` | Primary accent color (buttons, links, highlights) | `#4A9EFF` |
| `--accent-primary-dark` | Darker variant for gradients | `#3585dd` |
| `--accent-danger` | Danger/error color | `#FF4A4A` |
| `--accent-success` | Success color | `#2DD4A0` |
| `--accent-warning` | Warning color | `#FFB84A` |
| `--text-on-accent` | Text color on accent-colored buttons | `#fff` |
| `--bg-dark` | Main background | `#0a0f14` |
| `--bg-surface` | Card/panel background | `#151e2b` |
| `--text-primary` | Primary text color | `#e5ebf1` |
| `--side-blufor` | BLUFOR faction color (map markers) | `#00a8ff` |
| `--side-opfor` | OPFOR faction color | `#ff0000` |
| `--side-ind` | Independent faction color | `#00cc00` |
| `--side-civ` | Civilian faction color | `#c900ff` |

### Conversion

Large recordings can be automatically converted to chunked binary format for better performance.

| Setting | Env Var | Description | Default |
|---------|---------|-------------|---------|
| `conversion.enabled` | `OCAP_CONVERSION_ENABLED` | Enable automatic background conversion | `false` |
| `conversion.interval` | `OCAP_CONVERSION_INTERVAL` | How often to check for pending conversions | `5m` |
| `conversion.batchSize` | `OCAP_CONVERSION_BATCHSIZE` | Max recordings to convert per interval | `1` |
| `conversion.chunkSize` | `OCAP_CONVERSION_CHUNKSIZE` | Frames per chunk (~5 min at 1 fps) | `300` |
| `conversion.retryFailed` | `OCAP_CONVERSION_RETRYFAILED` | Retry previously failed conversions | `false` |

### Streaming

Live mission data can be streamed to the server via WebSocket.

| Setting | Env Var | Description | Default |
|---------|---------|-------------|---------|
| `streaming.enabled` | `OCAP_STREAMING_ENABLED` | Enable the WebSocket streaming endpoint | `false` |
| `streaming.pingInterval` | `OCAP_STREAMING_PINGINTERVAL` | Interval between WebSocket keepalive pings | `30s` |
| `streaming.pingTimeout` | `OCAP_STREAMING_PINGTIMEOUT` | Timeout waiting for pong response | `10s` |

### CORS

All responses include CORS headers so external services and web apps can fetch from the API.

| Setting | Env Var | Description | Default |
|---------|---------|-------------|---------|
| `cors.allowedOrigins` | `OCAP_CORS_ALLOWEDORIGINS` | Origins allowed to make cross-origin requests. Empty list permits all origins (`*`). Comma-separated in env var. | `[]` (all origins) |

When `allowedOrigins` is empty the server responds with `Access-Control-Allow-Origin: *`, which is appropriate for public read APIs. Restrict to specific origins if you want to limit which external sites can call admin endpoints:

```json
"cors": {
  "allowedOrigins": ["https://admin.example.com", "https://replay.example.com"]
}
```

## Large Recording Support

### Overview

Traditional JSON recordings load entirely into browser memory, which causes crashes with large missions (500MB+). The chunked streaming system solves this by:

1. Converting recordings to binary format (Protobuf)
2. Splitting into chunks (~5 minutes each)
3. Loading only needed chunks during playback
4. Caching chunks in browser storage (OPFS/IndexedDB)

### Storage Formats

| Format | Extension | Use Case | Streaming | Performance |
|--------|-----------|----------|-----------|-------------|
| JSON | `.gz` | Legacy, small recordings | No | Baseline |
| Protobuf | `.pb` | Default chunked format | Yes | Good |

### Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                         UPLOAD                                  │
│  Mission ends → JSON.gz uploaded → Stored in data/ directory    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       CONVERSION                                │
│  Background worker (or CLI) converts to chunked binary format   │
│                                                                 │
│  data/mission.gz  →  data/mission/                              │
│                         ├── manifest.pb (metadata + entities)   │
│                         └── chunks/                             │
│                               ├── 0000.pb (frames 0-299)        │
│                               ├── 0001.pb (frames 300-599)      │
│                               └── ...                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        PLAYBACK                                 │
│  1. Load manifest (entities, events, metadata)                  │
│  2. Load chunks on-demand as playback progresses                │
│  3. Cache chunks in browser (OPFS) for future playback          │
│  4. Evict old chunks from memory (max 3 in RAM)                 │
└─────────────────────────────────────────────────────────────────┘
```

For detailed flowcharts of playback and conversion, see [Streaming Architecture](docs/streaming-architecture.md).

### CLI Commands

Convert recordings manually using the CLI:

```bash
# Convert a single file
./ocap-webserver convert --input data/mission.json.gz

# Convert all pending recordings
./ocap-webserver convert --all

# Show conversion status of all recordings
./ocap-webserver convert --status

# Change storage format for an existing operation
./ocap-webserver convert --set-format protobuf --id 1
```

Add compressed sidecars to recordings converted by an older build (see [Compression](#compression)):

```bash
# Show what is missing, without writing anything
./ocap-webserver precompress --dry-run

# Write the missing sidecars
./ocap-webserver precompress
```

### File Structure After Conversion

```
data/
├── mission_name.gz              # Original JSON (preserved)
└── mission_name/                # Chunked binary format
    ├── manifest.pb              # Metadata, entities, events
    ├── manifest.pb.zst          # Precompressed copies, served when the
    ├── manifest.pb.gz           #   client accepts the encoding
    ├── chunks/
    │   ├── 0000.pb              # Frames 0-299
    │   ├── 0000.pb.zst
    │   ├── 0000.pb.gz
    │   ├── 0001.pb              # Frames 300-599
    │   └── ...
    └── snapshots/               # Per-player detail, fetched on demand
        ├── 7.pb                 # Every snapshot recorded for unit 7
        ├── 7.pb.zst
        └── ...
```

The `.zst` and `.gz` files are optional: the server falls back to the raw `.pb` whenever one is
missing. See [Compression](#compression).

### Compression

A converted recording never changes, so its artifacts are compressed once during conversion rather
than on every request. Each `.pb` gets `.zst` and `.gz` copies written beside it:

| File | Size (3h45m mission, ~950 entities) |
|------|------|
| `manifest.pb` | 2.5 MB |
| `manifest.pb.zst` | 378 KB |
| `chunks/0000.pb` | 2.4 MB |
| `chunks/0000.pb.zst` | 33 KB |
| `chunks/0000.pb.gz` | 55 KB |

The server picks the best sidecar the client accepts — `zstd` first, then `gzip` — and serves it
with the matching `Content-Encoding`. A client that accepts neither, and any recording that has no
sidecars, gets the raw `.pb`. Nothing depends on the sidecars existing.

Compressing offline makes a much higher compression level affordable than a proxy can use on a live
response (roughly 30% smaller chunks), and the server spends no CPU re-compressing bytes that never
change.

Sidecars are written only for artifacts over 1 KB, and only when the result is actually smaller than
the original. Writes go through a temporary file and a rename, so a request either sees a complete
sidecar or none at all.

#### Reverse proxies

If a proxy sits in front of the server, make sure it compresses **`application/x-protobuf`** — the
type `.pb` files are served as. Most proxies only compress a default list of text types and skip
protobuf, which leaves the largest responses on the page uncompressed for any recording without
sidecars.

**Caddy** — the type has to be added to `encode`, because naming `match` replaces the default list:

```caddy
encode {
	zstd
	gzip
	match {
		header Content-Type text/*
		header Content-Type application/json*
		header Content-Type application/javascript*
		header Content-Type image/svg+xml*
		header Content-Type application/x-protobuf*
	}
}
```

**nginx** — `gzip` is `off` by default, and when enabled `gzip_types` still covers only
`text/html`, so protobuf has to be listed explicitly:

```nginx
server {
    server_name ocap.example.com;

    gzip on;
    gzip_vary on;            # adds Vary: Accept-Encoding
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_proxied any;        # only needed if nginx itself sits behind another proxy or CDN
                             # (nginx keys this off the request's Via header)
    gzip_types
        text/plain
        text/css
        application/json
        application/javascript
        image/svg+xml
        application/x-protobuf;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Do **not** add `proxy_set_header Accept-Encoding "";`. It is a common recipe for making nginx do the
compressing itself, but it hides the client's supported encodings from the server, so the
precompressed sidecars are never used and every response is compressed from scratch instead.

Stock nginx has no zstd support (it needs a third-party module), but that only limits what nginx can
compress *itself*. Sidecars are passed straight through, so a client that accepts zstd still gets
the `.zst` copy — which is a good reason to run `precompress` on an nginx deployment.

Responses served from a sidecar already carry `Content-Encoding`, and both proxies skip those, so
there is no double compression.

Static frontend assets under `/assets/` are content-hashed and are sent with
`Cache-Control: public, max-age=31536000, immutable` plus an `ETag`. Do not override that with
`no-cache` in a proxy — the bundle is around 900 KB raw (~300 KB compressed) and would otherwise be
re-downloaded on every page load.

#### Backfilling existing recordings

Precompression happens during conversion, so recordings converted by an older build have no
sidecars. They still play — the server falls back to the raw file — but their transfers stay larger.
`precompress` adds the sidecars without re-converting anything:

```bash
# Show what is missing, without writing
./ocap-webserver precompress --dry-run

# Write the missing sidecars
./ocap-webserver precompress

# Point at a specific data directory
./ocap-webserver precompress --data /srv/ocap/data

# Rebuild every sidecar, including up-to-date ones
./ocap-webserver precompress --force
```

Notes:

- It reads each `.pb` and writes sidecars beside it. **The artifacts themselves are never rewritten.**
- `.json.gz` recordings are skipped. Their compression is inside the file already and the server
  serves them with `Content-Encoding: gzip`, so there is nothing to add.
- It is idempotent — a second run reports everything as current. A sidecar older than its artifact
  is treated as stale and rebuilt.
- Safe to run against a live server, and no restart is needed afterwards: the server looks for
  sidecars per request.
- It compresses every artifact at a high level, so it is CPU- and I/O-heavy on a large library.
  Use `--dry-run` first to see the scale, and prefer off-peak.

Run it once after upgrading. Recordings converted from then on get their sidecars automatically.

### Player detail snapshots

Per-player detail (inventory, medical, stamina, radio) is kept in `snapshots/<unitId>.pb` instead
of the manifest, and fetched only when that player's profile is opened.

JSON recordings are unaffected. Chunked recordings converted before this keep their snapshots in
the manifest and still play; re-run `convert --input` to move them out.
