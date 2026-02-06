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

// FindTool returns the tool with the given name and whether it was found.
func (ts ToolSet) FindTool(name string) (Tool, bool) {
	for _, t := range ts {
		if t.Name == name {
			return t, t.Found
		}
	}
	return Tool{}, false
}

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
	{"pmtiles", []string{"pmtiles"}, true},
	{"tippecanoe", []string{"tippecanoe"}, true},
	{"gdal_translate", []string{"gdal_translate"}, false},
	{"gdaldem", []string{"gdaldem"}, false},
	{"gdal_contour", []string{"gdal_contour"}, false},
	{"gdal_calc.py", []string{"gdal_calc.py", "gdal_calc"}, false},
	{"gdaladdo", []string{"gdaladdo"}, false},
	{"gdalbuildvrt", []string{"gdalbuildvrt"}, false},
	{"tile-join", []string{"tile-join"}, false},
	{"gdal_fillnodata.py", []string{"gdal_fillnodata.py", "gdal_fillnodata"}, false},
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
