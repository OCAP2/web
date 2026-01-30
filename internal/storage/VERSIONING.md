# JSON Format Versioning

## Adding a New Version

When the OCAP JSON format changes, follow these steps:

### 1. Increment the Version Constant

In `version.go`:

```go
const (
    JSONVersionV1 JSONVersion = 1
    JSONVersionV2 JSONVersion = 2  // Add new version
    CurrentJSONVersion = JSONVersionV2  // Update current
)
```

### 2. Update Version Detection

In `version.go`, add detection logic for the new format:

```go
func DetectJSONVersion(data map[string]interface{}) JSONVersion {
    // Check for V2-specific fields first (newest versions first)
    if _, ok := data["newV2Field"]; ok {
        return JSONVersionV2
    }
    // ... existing V1 detection ...
}
```

### 3. Create Parser for New Version

Create `parser_v2.go`:

```go
func init() {
    RegisterParser(&ParserV2{})
}

type ParserV2 struct{}

func (p *ParserV2) Version() JSONVersion { return JSONVersionV2 }

func (p *ParserV2) Parse(data map[string]interface{}, chunkSize uint32) (*ParseResult, error) {
    // Handle new format, output same ParseResult structure
}
```

### 4. Handle Field Renames/Migrations

If a field was renamed, handle both old and new names:

```go
func getFieldWithFallback(data map[string]interface{}, newName, oldName string) interface{} {
    if v, ok := data[newName]; ok {
        return v
    }
    return data[oldName]
}
```

## Version History

| Version | Date | Changes |
|---------|------|---------|
| V1 | Original | Initial OCAP format |
