# End-to-End Format Versioning

> **Status:** ✅ IMPLEMENTED (2026-01-31)

> **For Claude:** This plan has been implemented. Use it as reference documentation.

**Goal:** Implement comprehensive versioning so that format changes (JSON input, protobuf/flatbuffers schema, API, UI) can evolve independently while maintaining backwards compatibility.

**Architecture:** Each recording carries a version number that flows through the entire pipeline. The version determines which parser, writer, reader, and UI loader to use.

**Tech Stack:** Go, Protocol Buffers, FlatBuffers, JavaScript

---

## Version Flow

```
┌─────────────┐    ┌──────────┐    ┌─────────────┐    ┌─────────┐    ┌───────────┐
│ JSON Input  │───▶│  Parser  │───▶│   Writer    │───▶│  .pb    │───▶│  Reader   │
│   (v1/v2)   │    │ (v1/v2)  │    │  (v1/v2)    │    │ (v1/v2) │    │  (v1/v2)  │
└─────────────┘    └──────────┘    └─────────────┘    └─────────┘    └───────────┘
                                                                           │
                                                                           ▼
                                                      ┌─────────┐    ┌───────────┐
                                                      │   UI    │◀───│    API    │
                                                      │ (v1/v2) │    │ (version) │
                                                      └─────────┘    └───────────┘
```

**Key principle:** The `version` field in the Manifest is the **schema version**. It tells every component downstream how to interpret the data.

---

## File Format

Files have a 4-byte version prefix before the protobuf/flatbuffers data:

```
[4 bytes: version uint32 little-endian][protobuf/flatbuffers data...]
```

This allows reading the version before deserializing.

---

## Directory Structure

```
pkg/schemas/
├── protobuf/
│   ├── v1/
│   │   ├── ocap.proto
│   │   └── ocap.pb.go (generated)
│   └── v2/  (future)
│       ├── ocap.proto
│       └── ocap.pb.go
└── flatbuffers/
    ├── v1/
    │   ├── ocap.fbs
    │   └── generated/
    └── v2/  (future)
```

---

## Implementation Tasks

### Phase 1: Version Types and Constants

#### Task 1.1: Create unified version types

**Files:**
- Create: `internal/storage/version.go`
- Test: `internal/storage/version_test.go`

```go
// internal/storage/version.go
package storage

import "fmt"

// SchemaVersion represents the protobuf/flatbuffers schema version
type SchemaVersion uint32

const (
    SchemaVersionUnknown SchemaVersion = 0
    SchemaVersionV1      SchemaVersion = 1
    CurrentSchemaVersion               = SchemaVersionV1
)

func (v SchemaVersion) String() string {
    if v == SchemaVersionUnknown {
        return "unknown"
    }
    return fmt.Sprintf("v%d", v)
}

// JSONInputVersion represents the input JSON format version
type JSONInputVersion uint32

const (
    JSONInputVersionUnknown JSONInputVersion = 0
    JSONInputVersionV1      JSONInputVersion = 1
    CurrentJSONInputVersion                  = JSONInputVersionV1
)

func (v JSONInputVersion) String() string {
    if v == JSONInputVersionUnknown {
        return "unknown"
    }
    return fmt.Sprintf("v%d", v)
}

// DetectJSONInputVersion analyzes JSON data to determine its format version
func DetectJSONInputVersion(data map[string]interface{}) JSONInputVersion {
    requiredV1 := []string{"worldName", "missionName", "endFrame", "captureDelay", "entities"}
    for _, key := range requiredV1 {
        if _, ok := data[key]; !ok {
            return JSONInputVersionUnknown
        }
    }
    return JSONInputVersionV1
}

// MapInputToSchema returns the schema version to use for a given input version
func MapInputToSchema(input JSONInputVersion) SchemaVersion {
    switch input {
    case JSONInputVersionV1:
        return SchemaVersionV1
    default:
        return CurrentSchemaVersion
    }
}
```

---

### Phase 2: Reorganize Schema Files

#### Task 2.1: Move protobuf schema to v1 directory

**Files:**
- Create: `pkg/schemas/protobuf/v1/ocap.proto`
- Delete: `pkg/schemas/protobuf/ocap.proto` (after migration)
- Regenerate: `pkg/schemas/protobuf/v1/*.pb.go`

**New proto file header:**
```protobuf
syntax = "proto3";
package ocap.v1;
option go_package = "github.com/OCAP2/web/pkg/schemas/protobuf/v1";
```

**Commands:**
```bash
mkdir -p pkg/schemas/protobuf/v1
mv pkg/schemas/protobuf/ocap.proto pkg/schemas/protobuf/v1/
# Update package name in file
protoc --go_out=. --go_opt=paths=source_relative pkg/schemas/protobuf/v1/ocap.proto
```

#### Task 2.2: Move flatbuffers schema to v1 directory

**Files:**
- Create: `pkg/schemas/flatbuffers/v1/ocap.fbs`
- Move generated code to `pkg/schemas/flatbuffers/v1/generated/`

**New fbs namespace:**
```
namespace ocap.v1.fb;
```

#### Task 2.3: Update all Go imports

Update all files importing protobuf/flatbuffers:

```go
// Old:
import pb "github.com/OCAP2/web/pkg/schemas/protobuf"
// New:
import pbv1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
```

Files to update:
- `internal/storage/converter.go`
- `internal/storage/protobuf.go`
- `internal/storage/flatbuffers.go`
- `internal/storage/parser.go` (when created)

---

### Phase 3: Parser Interface and V1 Parser

#### Task 3.1: Create Parser interface

**Files:**
- Create: `internal/storage/parser.go`
- Test: `internal/storage/parser_test.go`

```go
package storage

// ParseResult contains parsed data in a schema-agnostic format
type ParseResult struct {
    // Manifest data
    WorldName      string
    MissionName    string
    FrameCount     uint32
    ChunkSize      uint32
    CaptureDelayMs uint32

    // Entity definitions
    Entities []EntityDef

    // Events, markers, times
    Events  []EventDef
    Markers []MarkerDef
    Times   []TimeSample

    // Position data for chunk writing
    EntityPositions []EntityPositionData
}

// EntityDef is schema-agnostic entity definition
type EntityDef struct {
    ID           uint32
    Type         string // "unit" or "vehicle"
    Name         string
    Side         string
    GroupName    string
    Role         string
    StartFrame   uint32
    EndFrame     uint32
    IsPlayer     bool
    VehicleClass string
}

// ... other type definitions ...

// Parser converts JSON input to ParseResult
type Parser interface {
    Version() JSONInputVersion
    Parse(data map[string]interface{}, chunkSize uint32) (*ParseResult, error)
}

var parsers = make(map[JSONInputVersion]Parser)

func RegisterParser(p Parser) {
    parsers[p.Version()] = p
}

func GetParser(v JSONInputVersion) (Parser, error) {
    if p, ok := parsers[v]; ok {
        return p, nil
    }
    return nil, fmt.Errorf("no parser for JSON version %s", v.String())
}
```

#### Task 3.2: Create ParserV1

**Files:**
- Create: `internal/storage/parser_v1.go`
- Test: `internal/storage/parser_test.go` (add tests)

Extract parsing logic from current `converter.go` into `ParserV1`.

---

### Phase 4: Writer Interface and V1 Writer

#### Task 4.1: Create Writer interface

**Files:**
- Create: `internal/storage/writer.go`
- Test: `internal/storage/writer_test.go`

```go
package storage

import (
    "context"
    "encoding/binary"
    "os"
)

// Writer writes ParseResult to a specific schema version
type Writer interface {
    Version() SchemaVersion
    Format() string // "protobuf" or "flatbuffers"
    WriteManifest(ctx context.Context, outputPath string, result *ParseResult) error
    WriteChunks(ctx context.Context, outputPath string, result *ParseResult) error
}

var writers = make(map[string]Writer) // key: "protobuf_v1", "flatbuffers_v1"

func RegisterWriter(w Writer) {
    key := fmt.Sprintf("%s_v%d", w.Format(), w.Version())
    writers[key] = w
}

func GetWriter(format string, version SchemaVersion) (Writer, error) {
    key := fmt.Sprintf("%s_v%d", format, version)
    if w, ok := writers[key]; ok {
        return w, nil
    }
    return nil, fmt.Errorf("no writer for %s version %d", format, version)
}

// WriteVersionPrefix writes the version as a 4-byte little-endian prefix
func WriteVersionPrefix(f *os.File, version SchemaVersion) error {
    return binary.Write(f, binary.LittleEndian, uint32(version))
}

// ReadVersionPrefix reads the version prefix from a file
func ReadVersionPrefix(f *os.File) (SchemaVersion, error) {
    var version uint32
    err := binary.Read(f, binary.LittleEndian, &version)
    return SchemaVersion(version), err
}
```

#### Task 4.2: Create ProtobufWriterV1

**Files:**
- Create: `internal/storage/writer_protobuf_v1.go`
- Test: `internal/storage/writer_test.go` (add tests)

```go
package storage

import (
    "context"
    pbv1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
)

func init() {
    RegisterWriter(&ProtobufWriterV1{})
}

type ProtobufWriterV1 struct{}

func (w *ProtobufWriterV1) Version() SchemaVersion { return SchemaVersionV1 }
func (w *ProtobufWriterV1) Format() string         { return "protobuf" }

func (w *ProtobufWriterV1) WriteManifest(ctx context.Context, outputPath string, result *ParseResult) error {
    // Convert ParseResult to pbv1.Manifest
    manifest := w.toProtoManifest(result)

    // Create file
    f, _ := os.Create(filepath.Join(outputPath, "manifest.pb"))
    defer f.Close()

    // Write version prefix
    WriteVersionPrefix(f, SchemaVersionV1)

    // Write protobuf data
    data, _ := proto.Marshal(manifest)
    f.Write(data)

    return nil
}

func (w *ProtobufWriterV1) WriteChunks(ctx context.Context, outputPath string, result *ParseResult) error {
    // Similar: write version prefix + protobuf for each chunk
}

func (w *ProtobufWriterV1) toProtoManifest(result *ParseResult) *pbv1.Manifest {
    // Convert schema-agnostic ParseResult to v1 protobuf types
}
```

#### Task 4.3: Create FlatBuffersWriterV1

**Files:**
- Create: `internal/storage/writer_flatbuffers_v1.go`

Similar structure to ProtobufWriterV1.

---

### Phase 5: Versioned Storage Engines

#### Task 5.1: Create ProtobufEngineV1

**Files:**
- Create: `internal/storage/engine_protobuf_v1.go`
- Rename: `internal/storage/protobuf.go` → delete after extraction

```go
package storage

import (
    pbv1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
)

func init() {
    RegisterEngine(&ProtobufEngineV1{})
}

type ProtobufEngineV1 struct {
    dataDir string
}

func NewProtobufEngineV1(dataDir string) *ProtobufEngineV1 {
    return &ProtobufEngineV1{dataDir: dataDir}
}

func (e *ProtobufEngineV1) Name() string            { return "protobuf_v1" }
func (e *ProtobufEngineV1) Version() SchemaVersion  { return SchemaVersionV1 }
func (e *ProtobufEngineV1) SupportsStreaming() bool { return true }

func (e *ProtobufEngineV1) GetManifest(ctx context.Context, filename string) (*Manifest, error) {
    path := filepath.Join(e.dataDir, filename, "manifest.pb")
    f, _ := os.Open(path)
    defer f.Close()

    // Read and verify version prefix
    version, _ := ReadVersionPrefix(f)
    if version != SchemaVersionV1 {
        return nil, fmt.Errorf("version mismatch: expected v1, got v%d", version)
    }

    // Read protobuf data
    data, _ := io.ReadAll(f)
    var manifest pbv1.Manifest
    proto.Unmarshal(data, &manifest)

    // Convert to storage.Manifest
    return e.toStorageManifest(&manifest), nil
}
```

#### Task 5.2: Update Engine interface

**Files:**
- Modify: `internal/storage/engine.go`

```go
type Engine interface {
    Name() string
    Version() SchemaVersion  // ADD THIS
    SupportsStreaming() bool
    GetManifest(ctx context.Context, filename string) (*Manifest, error)
    GetManifestReader(ctx context.Context, filename string) (io.ReadCloser, error)
    GetChunk(ctx context.Context, filename string, chunkIndex int) (*Chunk, error)
    GetChunkReader(ctx context.Context, filename string, chunkIndex int) (io.ReadCloser, error)
    ChunkCount(ctx context.Context, filename string) (int, error)
}

// GetEngineForVersion returns engine for specific format and version
func GetEngineForVersion(format string, version SchemaVersion) (Engine, error) {
    name := fmt.Sprintf("%s_v%d", format, version)
    return GetEngine(name)
}

// DetectFileVersion reads version prefix from a file
func DetectFileVersion(path string) (SchemaVersion, error) {
    f, err := os.Open(path)
    if err != nil {
        return SchemaVersionUnknown, err
    }
    defer f.Close()
    return ReadVersionPrefix(f)
}
```

#### Task 5.3: Create FlatBuffersEngineV1

**Files:**
- Create: `internal/storage/engine_flatbuffers_v1.go`

Similar to ProtobufEngineV1.

---

### Phase 6: Refactor Converter

#### Task 6.1: Update Converter to use versioned components

**Files:**
- Modify: `internal/storage/converter.go`

```go
type Converter struct {
    ChunkSize    uint32
    TargetFormat string // "protobuf" or "flatbuffers"
}

func (c *Converter) Convert(ctx context.Context, jsonPath, outputPath string) error {
    // 1. Load JSON
    data, err := c.loadJSON(jsonPath)
    if err != nil {
        return err
    }

    // 2. Detect input version and get parser
    inputVersion := DetectJSONInputVersion(data)
    if inputVersion == JSONInputVersionUnknown {
        inputVersion = JSONInputVersionV1 // fallback
    }

    parser, err := GetParser(inputVersion)
    if err != nil {
        return err
    }

    // 3. Parse to intermediate format
    result, err := parser.Parse(data, c.ChunkSize)
    if err != nil {
        return err
    }

    // 4. Determine output schema version
    schemaVersion := MapInputToSchema(inputVersion)

    // 5. Get writer and write output
    writer, err := GetWriter(c.TargetFormat, schemaVersion)
    if err != nil {
        return err
    }

    if err := writer.WriteManifest(ctx, outputPath, result); err != nil {
        return err
    }

    if err := writer.WriteChunks(ctx, outputPath, result); err != nil {
        return err
    }

    return nil
}
```

---

### Phase 7: Database Updates

#### Task 7.1: Add schema_version column

**Files:**
- Modify: `internal/server/operation.go`

Add migration v4:
```go
if version < 4 {
    _, err = r.db.Exec(`ALTER TABLE operations ADD COLUMN schema_version INTEGER DEFAULT 1`)
    if err != nil {
        return fmt.Errorf("migration v4 failed: %w", err)
    }
    _, err = r.db.Exec(`INSERT INTO version (db) VALUES (4)`)
    if err != nil {
        return fmt.Errorf("failed to set version 4: %w", err)
    }
}
```

Update Operation struct:
```go
type Operation struct {
    ID               int64   `json:"id"`
    WorldName        string  `json:"world_name"`
    MissionName      string  `json:"mission_name"`
    MissionDuration  float64 `json:"mission_duration"`
    Filename         string  `json:"filename"`
    Date             string  `json:"date"`
    Tag              string  `json:"tag"`
    StorageFormat    string  `json:"storageFormat"`
    ConversionStatus string  `json:"conversionStatus"`
    SchemaVersion    int     `json:"schemaVersion"`  // ADD THIS
}
```

Update all queries to include `schema_version`.

---

### Phase 8: API Updates

#### Task 8.1: Update FormatInfo response

**Files:**
- Modify: `internal/server/handler.go`

```go
type FormatInfo struct {
    Format            string `json:"format"`
    ChunkCount        int    `json:"chunkCount"`
    SupportsStreaming bool   `json:"supportsStreaming"`
    SchemaVersion     int    `json:"schemaVersion"`
}
```

Update `GetOperationFormat`:
```go
func (h *Handler) GetOperationFormat(c echo.Context) error {
    // ... get operation ...

    return c.JSON(http.StatusOK, FormatInfo{
        Format:            format,
        ChunkCount:        chunkCount,
        SupportsStreaming: engine.SupportsStreaming(),
        SchemaVersion:     op.SchemaVersion,
    })
}
```

---

### Phase 9: Frontend Updates

#### Task 9.1: Create loader directory structure

**Files:**
- Create: `static/scripts/loaders/loader-v1.js`
- Modify: `static/scripts/ocap.js`

#### Task 9.2: Extract LoaderV1

Move current entity/event/marker loading logic from `ocap.js` into `LoaderV1` class.

```javascript
// static/scripts/loaders/loader-v1.js
class LoaderV1 {
    async loadManifest(baseUrl, operationId) {
        const response = await fetch(`${baseUrl}/api/v1/operations/${operationId}/manifest`);
        return await response.json();
    }

    async loadChunk(baseUrl, operationId, chunkIndex) {
        const response = await fetch(`${baseUrl}/api/v1/operations/${operationId}/chunk/${chunkIndex}`);
        return await response.json();
    }

    parseEntities(manifest) {
        // Current entity parsing logic
    }

    parseEvents(manifest) {
        // Current event parsing logic
    }
}
```

#### Task 9.3: Add version-aware loading to ocap.js

```javascript
// static/scripts/ocap.js
const loaders = {
    1: new LoaderV1(),
    // 2: new LoaderV2(), // future
};

async function loadRecording(operationId) {
    // Get format info to determine version
    const formatInfo = await fetch(`${apiBase}/operations/${operationId}/format`).then(r => r.json());

    const loader = loaders[formatInfo.schemaVersion];
    if (!loader) {
        throw new Error(`Unsupported schema version: ${formatInfo.schemaVersion}`);
    }

    // Load with versioned loader
    const manifest = await loader.loadManifest(apiBase, operationId);
    // ... continue with loader-specific parsing
}
```

---

### Phase 10: Documentation

#### Task 10.1: Create VERSIONING.md

**Files:**
- Create: `internal/storage/VERSIONING.md`

Document:
1. Version flow through pipeline
2. File format (version prefix)
3. How to add a new version
4. Version mapping (input → schema)

---

## Adding a New Version (V2 Checklist)

When breaking changes are needed:

1. **Schema:** Create `pkg/schemas/protobuf/v2/ocap.proto`
2. **Parser:** Create `internal/storage/parser_v2.go` (if JSON changes)
3. **Writer:** Create `internal/storage/writer_protobuf_v2.go`
4. **Reader:** Create `internal/storage/engine_protobuf_v2.go`
5. **Constants:** Update `version.go` with `SchemaVersionV2`
6. **Mapping:** Update `MapInputToSchema()` if needed
7. **Frontend:** Create `static/scripts/loaders/loader-v2.js`
8. **Register:** Add to loader map in `ocap.js`

**Existing V1 recordings continue to work unchanged.**

---

## Summary

| Component | V1 Implementation |
|-----------|-------------------|
| Schema | `pkg/schemas/protobuf/v1/ocap.proto` |
| Parser | `internal/storage/parser_v1.go` |
| Writer | `internal/storage/writer_protobuf_v1.go` |
| Reader | `internal/storage/engine_protobuf_v1.go` |
| File Format | 4-byte version prefix + protobuf |
| Database | `schema_version` column |
| API | `schemaVersion` in FormatInfo |
| Frontend | `static/scripts/loaders/loader-v1.js` |
