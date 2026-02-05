package maptool

import "os/exec"

// Tool represents an external tool used by the pipeline.
type Tool struct {
	Name     string `json:"name"`
	Required bool   `json:"required"`
	Found    bool   `json:"found"`
	Path     string `json:"path,omitempty"`
}

// ToolSet is a list of tools.
type ToolSet []Tool

// MissingRequired returns required tools that are not found.
func (ts ToolSet) MissingRequired() ToolSet {
	var missing ToolSet
	for _, t := range ts {
		if t.Required && !t.Found {
			missing = append(missing, t)
		}
	}
	return missing
}

// knownTools defines the tools the pipeline needs.
var knownTools = []struct {
	name     string
	binaries []string // alternative binary names to search for
	required bool
}{
	{"depbo", []string{"depbo", "extractpbo", "pboproject"}, true},
	{"gdal2tiles.py", []string{"gdal2tiles.py", "gdal2tiles"}, true},
	{"pmtiles", []string{"pmtiles"}, true},
	{"tippecanoe", []string{"tippecanoe"}, false},
}

// DetectTools checks which external tools are available on the system.
func DetectTools() ToolSet {
	var tools ToolSet
	for _, kt := range knownTools {
		tool := Tool{Name: kt.name, Required: kt.required}
		for _, bin := range kt.binaries {
			if path, err := exec.LookPath(bin); err == nil {
				tool.Found = true
				tool.Path = path
				break
			}
		}
		tools = append(tools, tool)
	}
	return tools
}
