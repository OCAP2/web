# Large Recording Playback - Design Document

**Status:** Draft
**Author:** OCAP2 Team
**Created:** 2026-01-29
**Last Updated:** 2026-01-29

---

## 1. Problem Statement

OCAP2 users frequently report browser crashes and freezes when attempting to play back large mission recordings (500MB+ uncompressed, often exceeding 1GB). The current architecture requires the entire recording to be downloaded and parsed into browser memory before playback can begin, which:

1. **Exceeds browser memory limits** (typically 1-4GB available)
2. **Blocks the UI** during JSON parsing (10-50+ seconds for large files)
3. **Prevents playback** of long missions entirely
4. **Provides no progress feedback** during loading

This issue has been reported multiple times and attempted fixes (PR #51) were abandoned due to complexity.

---

## 2. Goals and Non-Goals

### Goals

- **G1:** Enable playback of recordings of any size (1GB+) without browser memory issues
- **G2:** Provide immediate playback start (stream-first approach)
- **G3:** Support seeking/scrubbing without loading entire recording
- **G4:** Maintain backward compatibility with existing JSON recordings
- **G5:** Minimize server-side resource usage
- **G6:** Support offline playback of cached recordings

### Non-Goals

- Real-time streaming of live missions (out of scope)
- Modifying the Arma 3 capture extension
- Supporting browsers older than 2 years

---

## 3. Architecture Overview

### 3.1 High-Level Design

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              UPLOAD FLOW                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Arma 3 Extension ──► JSON Upload ──► Store JSON ──► Queue Conversion   │
│                                              │                           │
│                                              ▼                           │
│                                       ┌─────────────┐                   │
│                                       │  Database   │                   │
│                                       │ (metadata + │                   │
│                                       │  format)    │                   │
│                                       └─────────────┘                   │
│                                              │                           │
│                              Conversion Worker (background)              │
│                                              │                           │
│                                              ▼                           │
│                                    Chunked Binary Format                 │
│                                    (Protobuf/FlatBuffers)                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                             PLAYBACK FLOW                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Browser ◄──────────────────────────────────────────────── Server       │
│     │                                                          │         │
│     │  1. Request manifest (small, immediate)                  │         │
│     │◄─────────────────────────────────────────────────────────│         │
│     │                                                          │         │
│     │  2. Request chunks on-demand (as playback progresses)    │         │
│     │◄─────────────────────────────────────────────────────────│         │
│     │                                                          │         │
│     ▼                                                                    │
│  ┌──────────────────────────────────────────────────────────┐           │
│  │                     BROWSER STORAGE                       │           │
│  ├──────────────────────────────────────────────────────────┤           │
│  │  Primary: OPFS (Origin Private File System)              │           │
│  │  Fallback: IndexedDB (older browsers)                    │           │
│  │  Metadata: IndexedDB (mission list, settings)            │           │
│  └──────────────────────────────────────────────────────────┘           │
│     │                                                                    │
│     │  3. Chunk Manager (max 3 chunks in memory)                        │
│     ▼                                                                    │
│  ┌──────────────────────────────────────────────────────────┐           │
│  │              PLAYBACK ENGINE                              │           │
│  │  - Renders only current frame entities                    │           │
│  │  - Prefetches next chunk at 80% progress                  │           │
│  │  - LRU eviction of old chunks                             │           │
│  └──────────────────────────────────────────────────────────┘           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Memory Budget (Guaranteed Maximum)

| Component | Max Memory | Notes |
|-----------|------------|-------|
| Manifest + Entity metadata | ~1 MB | Always loaded |
| Active chunks (3 max) | ~15 MB | LRU eviction |
| Decoded frame buffer | ~1 MB | Current frame only |
| Leaflet markers | ~5 MB | Visible entities only |
| **Total Maximum** | **~22 MB** | Regardless of recording size |

---

## 4. Storage Engine Abstraction

### 4.1 Supported Storage Engines

The system supports multiple storage engines, selectable via configuration:

| Engine | Status | Use Case |
|--------|--------|----------|
| `json` | Legacy (read-only) | Backward compatibility |
| `protobuf` | **Default** | Balance of performance and tooling |
| `flatbuffers` | Optional | Maximum read performance (zero-copy) |

### 4.2 Configuration

```json
// setting.json
{
  "storageEngine": "protobuf",
  "conversion": {
    "enabled": true,
    "workers": 2,
    "deleteOriginal": false
  }
}
```

Environment variables:
- `OCAP_STORAGE_ENGINE` - Default storage engine for new conversions
- `OCAP_CONVERSION_ENABLED` - Enable/disable background conversion
- `OCAP_CONVERSION_WORKERS` - Number of concurrent conversion workers

### 4.3 Database Schema Changes

The `operations` table gains a new `storage_format` column:

```sql
ALTER TABLE operations ADD COLUMN storage_format TEXT DEFAULT 'json';
ALTER TABLE operations ADD COLUMN conversion_status TEXT DEFAULT 'pending';
-- conversion_status: 'pending', 'processing', 'completed', 'failed'
```

| Column | Type | Description |
|--------|------|-------------|
| `storage_format` | TEXT | `json`, `protobuf`, or `flatbuffers` |
| `conversion_status` | TEXT | Status of format conversion |

### 4.4 Storage Engine Interface (Go)

```go
// server/storage/engine.go
package storage

type Engine interface {
    // Name returns the engine identifier
    Name() string

    // SupportsStreaming indicates if chunked loading is supported
    SupportsStreaming() bool

    // GetManifest returns mission metadata and entity definitions
    GetManifest(ctx context.Context, filename string) (*Manifest, error)

    // GetChunk returns position/event data for a frame range
    GetChunk(ctx context.Context, filename string, chunkIndex int) (*Chunk, error)

    // ChunkCount returns the total number of chunks
    ChunkCount(ctx context.Context, filename string) (int, error)

    // Convert transforms from JSON to this engine's format
    Convert(ctx context.Context, jsonPath, outputPath string) error
}

// Registry of available engines
var engines = map[string]Engine{
    "json":        &JSONEngine{},
    "protobuf":    &ProtobufEngine{},
    "flatbuffers": &FlatBuffersEngine{},
}

func GetEngine(name string) (Engine, error) {
    if e, ok := engines[name]; ok {
        return e, nil
    }
    return nil, fmt.Errorf("unknown storage engine: %s", name)
}
```

---

## 5. Data Format Specification

### 5.1 Directory Structure

```
data/
├── mission_abc.gz              # Legacy JSON (kept for compatibility)
└── mission_abc/                # New chunked format
    ├── manifest.pb             # Mission metadata + entity definitions
    ├── events.pb               # All events (streamed on demand)
    └── chunks/
        ├── 0000.pb             # Frames 0-299
        ├── 0001.pb             # Frames 300-599
        └── ...
```

### 5.2 Protobuf Schema

```protobuf
// proto/ocap.proto
syntax = "proto3";
package ocap;
option go_package = "github.com/OCAP2/web/proto";

// Manifest - loaded once at playback start (~10-100KB)
message Manifest {
  uint32 version = 1;
  string world_name = 2;
  string mission_name = 3;
  uint32 frame_count = 4;
  uint32 chunk_size = 5;        // Frames per chunk (default: 300 = 5 min)
  uint32 capture_delay_ms = 6;  // Time between frames
  uint32 chunk_count = 7;
  repeated EntityDef entities = 8;
  repeated TimeSample times = 9;
}

message EntityDef {
  uint32 id = 1;
  EntityType type = 2;
  string name = 3;
  Side side = 4;
  string group = 5;
  string role = 6;
  uint32 start_frame = 7;
  uint32 end_frame = 8;
  bool is_player = 9;
  string vehicle_class = 10;    // For vehicles only
}

enum EntityType {
  ENTITY_TYPE_UNKNOWN = 0;
  ENTITY_TYPE_UNIT = 1;
  ENTITY_TYPE_VEHICLE = 2;
}

enum Side {
  SIDE_UNKNOWN = 0;
  SIDE_WEST = 1;
  SIDE_EAST = 2;
  SIDE_GUER = 3;
  SIDE_CIV = 4;
}

message TimeSample {
  uint32 frame_num = 1;
  int64 system_time_utc = 2;
  string date = 3;
  float time_multiplier = 4;
  float time = 5;
}

// Chunk - loaded on demand (~100KB-1MB each)
message Chunk {
  uint32 index = 1;
  uint32 start_frame = 2;
  uint32 frame_count = 3;
  repeated Frame frames = 4;
}

message Frame {
  uint32 frame_num = 1;
  repeated EntityState entities = 2;
}

message EntityState {
  uint32 entity_id = 1;
  Position position = 2;
  uint32 direction = 3;         // 0-360 degrees
  uint32 flags = 4;             // Bitfield: alive, in_vehicle, is_player

  // Vehicle-specific
  repeated uint32 crew_ids = 5;

  // Unit-specific
  uint32 vehicle_id = 6;        // If in vehicle
}

message Position {
  float x = 1;
  float y = 2;
}

// Events - can be loaded separately or embedded in chunks
message Events {
  repeated Event events = 1;
}

message Event {
  uint32 frame_num = 1;
  EventType type = 2;
  uint32 source_id = 3;
  uint32 target_id = 4;
  string message = 5;
  float distance = 6;
  string weapon = 7;
}

enum EventType {
  EVENT_TYPE_UNKNOWN = 0;
  EVENT_TYPE_KILLED = 1;
  EVENT_TYPE_HIT = 2;
  EVENT_TYPE_FIRED = 3;
  EVENT_TYPE_CONNECTED = 4;
  EVENT_TYPE_DISCONNECTED = 5;
}

// Markers
message Markers {
  repeated Marker markers = 1;
}

message Marker {
  uint32 id = 1;
  MarkerType type = 2;
  string text = 3;
  uint32 start_frame = 4;
  uint32 end_frame = 5;
  uint32 player_id = 6;
  string color = 7;
  Side side = 8;
  repeated MarkerPosition positions = 9;
}

message MarkerPosition {
  uint32 frame_num = 1;
  Position position = 2;
}

enum MarkerType {
  MARKER_TYPE_UNKNOWN = 0;
  MARKER_TYPE_ICON = 1;
  MARKER_TYPE_BRUSH = 2;
  MARKER_TYPE_LINE = 3;
}
```

### 5.3 Chunk Size Rationale

| Chunk Size | File Size (typical) | Load Time (100Mbps) | Memory |
|------------|---------------------|---------------------|--------|
| 100 frames (1.6 min) | ~50KB | 4ms | Low |
| 300 frames (5 min) | ~150KB | 12ms | Medium |
| 600 frames (10 min) | ~300KB | 24ms | Higher |

**Recommended: 300 frames (5 minutes)** - balances load latency with seek granularity.

---

## 6. API Changes

### 6.1 New Endpoints

```
GET /api/v1/operations/:id/manifest
    Returns: Manifest protobuf (or JSON for legacy)
    Headers: Content-Type: application/x-protobuf

GET /api/v1/operations/:id/chunk/:index
    Returns: Chunk protobuf
    Headers: Content-Type: application/x-protobuf
    Supports: HTTP Range requests for partial loads

GET /api/v1/operations/:id/events
    Returns: Events protobuf
    Headers: Content-Type: application/x-protobuf

GET /api/v1/operations/:id/format
    Returns: { "format": "protobuf", "chunkCount": 42, "legacy": false }
```

### 6.2 Operations List Response Change

```json
{
  "id": 123,
  "worldName": "altis",
  "missionName": "Operation Thunder",
  "filename": "mission_abc",
  "date": "2026-01-29",
  "missionDuration": 7200,
  "tag": "coop",
  "storageFormat": "protobuf",
  "conversionStatus": "completed"
}
```

### 6.3 Legacy Endpoint (Unchanged)

```
GET /data/:name
    Behavior:
    - If storageFormat == "json": Return gzipped JSON (current behavior)
    - If storageFormat != "json": Return 301 redirect to /api/v1/operations/:id/manifest
```

---

## 7. Conversion System

### 7.1 Upload Flow

```
1. Client uploads JSON recording (existing flow)
2. Server stores JSON in data/{filename}.gz
3. Server inserts DB record with:
   - storage_format = "json"
   - conversion_status = "pending"
4. Conversion queue picks up pending records
5. Worker converts JSON → Protobuf chunks
6. Worker updates DB record:
   - storage_format = "protobuf"
   - conversion_status = "completed"
7. (Optional) Delete original JSON if configured
```

### 7.2 Conversion Worker

```go
// server/conversion/worker.go
package conversion

type Worker struct {
    repo      *RepoOperation
    engine    storage.Engine
    batchSize int
    interval  time.Duration
}

func (w *Worker) Run(ctx context.Context) {
    ticker := time.NewTicker(w.interval)
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            w.processBatch(ctx)
        }
    }
}

func (w *Worker) processBatch(ctx context.Context) {
    // Get pending conversions
    ops, _ := w.repo.SelectPending(ctx, w.batchSize)

    for _, op := range ops {
        w.repo.UpdateStatus(ctx, op.ID, "processing")

        err := w.engine.Convert(ctx,
            filepath.Join(dataDir, op.Filename+".gz"),
            filepath.Join(dataDir, op.Filename),
        )

        if err != nil {
            w.repo.UpdateStatus(ctx, op.ID, "failed")
            continue
        }

        w.repo.UpdateFormat(ctx, op.ID, w.engine.Name(), "completed")
    }
}
```

### 7.3 Manual Conversion CLI

```bash
# Convert single recording
./ocap-webserver convert --input data/mission.gz --output data/mission/ --format protobuf

# Convert all pending
./ocap-webserver convert --all --format protobuf

# Check conversion status
./ocap-webserver convert --status
```

---

## 8. Frontend Changes

### 8.1 Storage Layer

```typescript
// static/scripts/storage/StorageManager.ts
interface StorageManager {
  hasManifest(missionId: string): Promise<boolean>;
  getManifest(missionId: string): Promise<Manifest>;
  saveManifest(missionId: string, data: ArrayBuffer): Promise<void>;

  hasChunk(missionId: string, index: number): Promise<boolean>;
  getChunk(missionId: string, index: number): Promise<Chunk>;
  saveChunk(missionId: string, index: number, data: ArrayBuffer): Promise<void>;

  evictOldChunks(missionId: string, keepIndices: number[]): Promise<void>;
  clearMission(missionId: string): Promise<void>;
  getStorageUsage(): Promise<StorageEstimate>;
}

// Primary implementation using OPFS
class OPFSStorageManager implements StorageManager { ... }

// Fallback for older browsers
class IndexedDBStorageManager implements StorageManager { ... }

// Factory with feature detection
function createStorageManager(): StorageManager {
  if ('storage' in navigator && 'getDirectory' in navigator.storage) {
    return new OPFSStorageManager();
  }
  return new IndexedDBStorageManager();
}
```

### 8.2 Chunk Manager

```typescript
// static/scripts/playback/ChunkManager.ts
class ChunkManager {
  private loaded: Map<number, Chunk> = new Map();
  private loading: Set<number> = new Set();
  private storage: StorageManager;
  private maxChunks = 3;

  async ensureLoaded(chunkIndex: number): Promise<Chunk> {
    // Return if already loaded
    if (this.loaded.has(chunkIndex)) {
      return this.loaded.get(chunkIndex)!;
    }

    // Wait if currently loading
    if (this.loading.has(chunkIndex)) {
      return this.waitForChunk(chunkIndex);
    }

    // Check local storage first
    if (await this.storage.hasChunk(this.missionId, chunkIndex)) {
      const chunk = await this.storage.getChunk(this.missionId, chunkIndex);
      this.addToCache(chunkIndex, chunk);
      return chunk;
    }

    // Fetch from server
    return this.fetchChunk(chunkIndex);
  }

  private addToCache(index: number, chunk: Chunk): void {
    this.loaded.set(index, chunk);

    // Evict oldest if over limit
    if (this.loaded.size > this.maxChunks) {
      const oldest = this.findOldestChunk(index);
      this.loaded.delete(oldest);
    }
  }

  prefetch(currentFrame: number): void {
    const currentChunk = this.frameToChunk(currentFrame);
    const progress = (currentFrame % this.chunkSize) / this.chunkSize;

    // Prefetch next chunk at 80% progress
    if (progress > 0.8) {
      this.ensureLoaded(currentChunk + 1);
    }
  }
}
```

### 8.3 Updated Playback Engine

```typescript
// static/scripts/ocap.ts (modified)
class PlaybackEngine {
  private chunkManager: ChunkManager;
  private manifest: Manifest;
  private currentFrame: number = 0;

  async loadMission(missionId: string): Promise<void> {
    // 1. Check format from API
    const info = await fetch(`api/v1/operations/${missionId}/format`).then(r => r.json());

    if (info.format === 'json') {
      // Legacy path - use existing loader with warning
      console.warn('Loading legacy JSON format - may cause memory issues for large recordings');
      return this.loadLegacyJSON(missionId);
    }

    // 2. Load manifest (small, immediate)
    this.manifest = await this.chunkManager.loadManifest(missionId);

    // 3. Initialize entities from manifest (no position data yet)
    this.initializeEntities(this.manifest.entities);

    // 4. Load first chunk
    await this.chunkManager.ensureLoaded(0);

    // 5. Ready to play!
    this.emit('ready', { frameCount: this.manifest.frameCount });
  }

  async setFrame(frame: number): Promise<void> {
    const chunkIndex = Math.floor(frame / this.manifest.chunkSize);

    // Ensure chunk is loaded
    const chunk = await this.chunkManager.ensureLoaded(chunkIndex);

    // Update entity positions from chunk data
    const frameData = chunk.frames[frame % this.manifest.chunkSize];
    this.updateEntities(frameData);

    // Trigger prefetch
    this.chunkManager.prefetch(frame);

    this.currentFrame = frame;
    this.render();
  }
}
```

### 8.4 Format Detection and UI

```typescript
// Show format and conversion status in mission list
interface MissionListItem {
  id: number;
  name: string;
  format: 'json' | 'protobuf' | 'flatbuffers';
  conversionStatus: 'pending' | 'processing' | 'completed' | 'failed';
}

// UI indicators
function renderMissionItem(mission: MissionListItem): HTMLElement {
  const el = document.createElement('div');
  el.className = 'mission-item';

  // Add format badge
  if (mission.format === 'json' && mission.conversionStatus === 'pending') {
    el.innerHTML += '<span class="badge warning">Converting...</span>';
  } else if (mission.format === 'json') {
    el.innerHTML += '<span class="badge legacy">Legacy</span>';
  }

  return el;
}
```

---

## 9. Browser Storage Considerations

### 9.1 Storage Limits

| Browser | Limit | Eviction Policy |
|---------|-------|-----------------|
| Chrome/Edge | ~6% of free disk | LRU when low on space |
| Firefox | 10% or 10GB max | LRU when low on space |
| Safari | 20-80% of disk | **7-day deletion without interaction** |

### 9.2 Safari ITP Mitigation

```typescript
// Detect Safari and warn user
function checkStoragePersistence(): void {
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

  if (isSafari) {
    showNotification({
      type: 'warning',
      message: 'Safari may delete cached recordings after 7 days. ' +
               'Add this site to your home screen for persistent storage.',
      persistent: true
    });
  }

  // Request persistent storage
  navigator.storage.persist().then(granted => {
    if (!granted) {
      console.warn('Persistent storage not granted - data may be evicted');
    }
  });
}
```

### 9.3 Storage Quota Management

```typescript
async function checkStorageQuota(): Promise<void> {
  const estimate = await navigator.storage.estimate();
  const usagePercent = (estimate.usage! / estimate.quota!) * 100;

  if (usagePercent > 80) {
    // Evict oldest missions
    const missions = await storage.getMissionsByLastAccess();
    for (const mission of missions.slice(10)) { // Keep 10 most recent
      await storage.clearMission(mission.id);
    }
  }
}
```

---

## 10. Migration Strategy

### 10.1 Phase 1: Infrastructure (Week 1-2)

- [ ] Add `storage_format` and `conversion_status` columns to database
- [ ] Implement storage engine interface
- [ ] Implement protobuf encoder/decoder in Go
- [ ] Add new API endpoints
- [ ] Create conversion worker

### 10.2 Phase 2: Frontend (Week 3-4)

- [ ] Implement OPFS storage manager
- [ ] Implement IndexedDB fallback
- [ ] Create chunk manager
- [ ] Update playback engine for chunked loading
- [ ] Add format detection and legacy fallback

### 10.3 Phase 3: Testing & Migration (Week 5-6)

- [ ] Test with various recording sizes (100MB, 500MB, 1GB, 5GB)
- [ ] Test cross-browser (Chrome, Firefox, Safari, Edge)
- [ ] Enable conversion worker in production
- [ ] Monitor conversion queue
- [ ] Performance benchmarks

### 10.4 Phase 4: Cleanup (Week 7+)

- [ ] Optional: Delete converted JSON files
- [ ] Optional: Remove legacy JSON loading code
- [ ] Documentation updates

---

## 11. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Protobuf parsing slower than expected | Low | Medium | Benchmark early; FlatBuffers as backup |
| OPFS not supported in target browsers | Low | High | IndexedDB fallback implemented |
| Safari deletes cached data | High | Medium | User warning; graceful re-download |
| Conversion fails for some recordings | Medium | Low | Keep original JSON; manual retry |
| Seek latency too high | Medium | Medium | Smaller chunks; aggressive prefetch |

---

## 12. Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Max playable recording size | ~500MB | **Unlimited** |
| Time to first frame (1GB recording) | 30-60s | **<3s** |
| Memory usage during playback | 500MB-4GB | **<50MB** |
| Seek latency | N/A (must reload) | **<500ms** |

---

## 13. Open Questions

1. **Chunk size tuning** - Should chunk size be configurable per-recording based on entity count?
2. **Event loading strategy** - Load all events upfront or stream with chunks?
3. **Compression** - Apply gzip to individual chunks or rely on HTTP compression?
4. **Backward seek** - How many backward chunks to keep in cache?

---

## 14. References

- [PR #51 - Original attempt](https://github.com/OCAP2/web/pull/51)
- [IndexedDB Storage Limits](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- [OPFS Documentation](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)
- [Protocol Buffers](https://protobuf.dev/)
- [Safari ITP Policy](https://webkit.org/blog/14403/updates-to-storage-policy/)
