package storage

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSchemaVersion_String(t *testing.T) {
	tests := []struct {
		name    string
		version SchemaVersion
		want    string
	}{
		{
			name:    "unknown version",
			version: SchemaVersionUnknown,
			want:    "unknown",
		},
		{
			name:    "version 1",
			version: SchemaVersionV1,
			want:    "v1",
		},
		{
			name:    "current version",
			version: CurrentSchemaVersion,
			want:    "v1",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, tt.version.String())
		})
	}
}

func TestJSONInputVersion_String(t *testing.T) {
	tests := []struct {
		name    string
		version JSONInputVersion
		want    string
	}{
		{
			name:    "unknown version",
			version: JSONInputVersionUnknown,
			want:    "unknown",
		},
		{
			name:    "version 1",
			version: JSONInputVersionV1,
			want:    "v1",
		},
		{
			name:    "current version",
			version: CurrentJSONInputVersion,
			want:    "v1",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, tt.version.String())
		})
	}
}

func TestDetectJSONInputVersion(t *testing.T) {
	tests := []struct {
		name string
		data map[string]interface{}
		want JSONInputVersion
	}{
		{
			name: "valid v1 data with all required fields",
			data: map[string]interface{}{
				"worldName":    "Altis",
				"missionName":  "Test Mission",
				"endFrame":     1000,
				"captureDelay": 1.0,
				"entities":     []interface{}{},
			},
			want: JSONInputVersionV1,
		},
		{
			name: "missing worldName",
			data: map[string]interface{}{
				"missionName":  "Test Mission",
				"endFrame":     1000,
				"captureDelay": 1.0,
				"entities":     []interface{}{},
			},
			want: JSONInputVersionUnknown,
		},
		{
			name: "missing missionName",
			data: map[string]interface{}{
				"worldName":    "Altis",
				"endFrame":     1000,
				"captureDelay": 1.0,
				"entities":     []interface{}{},
			},
			want: JSONInputVersionUnknown,
		},
		{
			name: "missing endFrame",
			data: map[string]interface{}{
				"worldName":    "Altis",
				"missionName":  "Test Mission",
				"captureDelay": 1.0,
				"entities":     []interface{}{},
			},
			want: JSONInputVersionUnknown,
		},
		{
			name: "missing captureDelay",
			data: map[string]interface{}{
				"worldName":   "Altis",
				"missionName": "Test Mission",
				"endFrame":    1000,
				"entities":    []interface{}{},
			},
			want: JSONInputVersionUnknown,
		},
		{
			name: "missing entities",
			data: map[string]interface{}{
				"worldName":    "Altis",
				"missionName":  "Test Mission",
				"endFrame":     1000,
				"captureDelay": 1.0,
			},
			want: JSONInputVersionUnknown,
		},
		{
			name: "empty data",
			data: map[string]interface{}{},
			want: JSONInputVersionUnknown,
		},
		{
			name: "nil data",
			data: nil,
			want: JSONInputVersionUnknown,
		},
		{
			name: "v1 with extra fields",
			data: map[string]interface{}{
				"worldName":    "Altis",
				"missionName":  "Test Mission",
				"endFrame":     1000,
				"captureDelay": 1.0,
				"entities":     []interface{}{},
				"extraField":   "should be ignored",
			},
			want: JSONInputVersionV1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, DetectJSONInputVersion(tt.data))
		})
	}
}

func TestMapInputToSchema(t *testing.T) {
	tests := []struct {
		name  string
		input JSONInputVersion
		want  SchemaVersion
	}{
		{
			name:  "v1 input maps to v1 schema",
			input: JSONInputVersionV1,
			want:  SchemaVersionV1,
		},
		{
			name:  "unknown input maps to current schema",
			input: JSONInputVersionUnknown,
			want:  CurrentSchemaVersion,
		},
		{
			name:  "future version maps to current schema",
			input: JSONInputVersion(99),
			want:  CurrentSchemaVersion,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, MapInputToSchema(tt.input))
		})
	}
}
