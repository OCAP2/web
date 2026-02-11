# OCAP Web component

![Coverage](https://raw.githubusercontent.com/OCAP2/web/badges/.badges/main/coverage.svg)

OCAP Web serves and plays back Arma 3 mission recordings. It supports both legacy JSON recordings and chunked Protobuf format for efficient streaming of large recordings.

## Configuration

The configuration file is called `setting.json`

### Basic Settings

| Setting | Description |
|---------|-------------|
| `listen` | Server address, e.g. `"0.0.0.0:5000"` to listen on all interfaces |
| `secret` | Secret for authenticating record uploads |
| `logger` | Enable request logging to STDOUT |

### Conversion Settings

Large recordings can be automatically converted to chunked binary format for better performance.

| Setting | Description | Default |
|---------|-------------|---------|
| `conversion.enabled` | Enable automatic background conversion | `false` |
| `conversion.interval` | How often to check for pending conversions | `"5m"` |
| `conversion.batchSize` | Max recordings to convert per interval | `10` |
| `conversion.chunkSize` | Frames per chunk (~5 min at 1 fps) | `300` |

Example `setting.json`:
```json
{
  "listen": "127.0.0.1:5000",
  "secret": "your-secret",
  "logger": true,
  "conversion": {
    "enabled": true,
    "interval": "5m"
  }
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

### File Structure After Conversion

```
data/
├── mission_name.gz              # Original JSON (preserved)
└── mission_name/                # Chunked binary format
    ├── manifest.pb              # Metadata, entities, events
    └── chunks/
        ├── 0000.pb              # Frames 0-299
        ├── 0001.pb              # Frames 300-599
        └── ...
```

## Docker

Docker images are available for `linux/amd64` and `linux/arm64` architectures.

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OCAP_SECRET` | Secret for authorizing record uploads | *required* |
| `OCAP_CUSTOMIZE_WEBSITEURL` | Link on the logo to your website | |
| `OCAP_CUSTOMIZE_WEBSITELOGO` | URL to your website logo | |
| `OCAP_CUSTOMIZE_WEBSITELOGOSIZE` | Logo size | `32px` |
| `OCAP_STATIC` | Serve frontend from this directory instead of the embedded build | *embedded* |
| `OCAP_CONVERSION_ENABLED` | Enable automatic conversion | `false` |
| `OCAP_CONVERSION_INTERVAL` | Conversion check interval | `5m` |

### Volumes

| Path | Description |
|------|-------------|
| `/var/lib/ocap/data` | Recording storage (JSON and chunked formats) |
| `/var/lib/ocap/maps` | Map tiles ([download here](https://drive.google.com/drive/folders/1qtT0Fr4Dfwd48ihZNc8YN-xgxHchKoiu)) |
| `/var/lib/ocap/db` | SQLite database |

### Start an OCAP webserver instance

```bash
docker run --name ocap-web -d \
  -p 5000:5000/tcp \
  -e OCAP_SECRET="same-secret" \
  -e OCAP_CONVERSION_ENABLED="true" \
  -v ocap-records:/var/lib/ocap/data \
  -v ocap-maps:/var/lib/ocap/maps \
  -v ocap-database:/var/lib/ocap/db \
  ghcr.io/ocap2/web:latest
```

### Map Tool

The map tool processes Arma 3 map data (grad_meh exports) into PMTiles and MapLibre styles. It provides a web UI for uploading and managing maps, and CLI commands for scripted workflows.

The image bundles all required tools (gdal2tiles, pmtiles, tippecanoe).

```bash
docker pull ghcr.io/ocap2/maptool:latest
```

**Environment Variables:**

| Variable | Description | Default |
|----------|-------------|---------|
| `OCAP_MAPTOOL_LISTEN` | Server address | `0.0.0.0:5001` |
| `OCAP_MAPS` | Maps output directory | `/var/lib/ocap/maps` |

**Start the maptool web UI alongside the webserver:**

```bash
docker run --name ocap-maptool -d \
  -p 5001:5001/tcp \
  -v ocap-maps:/var/lib/ocap/maps \
  ghcr.io/ocap2/maptool:latest
```

The shared `ocap-maps` volume lets the maptool write processed map tiles that the webserver serves directly.

**CLI usage (import a grad_meh export):**

```bash
docker run --rm \
  -v ocap-maps:/var/lib/ocap/maps \
  -v /path/to/exports:/input:ro \
  ghcr.io/ocap2/maptool:latest \
  ./ocap-maptool import -maps /var/lib/ocap/maps /input/altis
```

**Restyle all existing maps:**

```bash
docker run --rm \
  -v ocap-maps:/var/lib/ocap/maps \
  ghcr.io/ocap2/maptool:latest \
  ./ocap-maptool restyle -maps /var/lib/ocap/maps
```

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
