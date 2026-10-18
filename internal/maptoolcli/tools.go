package maptoolcli

import (
	"fmt"
	"io"
	"sort"

	"github.com/OCAP2/web/internal/maptool"
)

// runTools prints a compact status table of all detected tools and exits.
func runTools(args []string, d deps) int {
	_ = args // tools takes no flags currently.

	tools := d.detectTools()
	printToolsTable(d.stdout, tools)

	missing := tools.MissingRequired()
	if len(missing) > 0 {
		return 1
	}
	return 0
}

// printToolsTable writes a compact tool status table to w.
func printToolsTable(w io.Writer, tools maptool.ToolSet) {
	fmt.Fprintln(w, "Tool               Status    Path")
	fmt.Fprintln(w, "──────────────────────────────────────────────")

	// Sort: required first, then alphabetical.
	sorted := make(maptool.ToolSet, len(tools))
	copy(sorted, tools)
	sort.Slice(sorted, func(i, j int) bool {
		if sorted[i].Required != sorted[j].Required {
			return sorted[i].Required // required first
		}
		return sorted[i].Name < sorted[j].Name
	})

	var found, missing int
	for _, t := range sorted {
		status := "missing"
		path := "-"
		if t.Found {
			status = "ok"
			found++
			path = t.Path
		} else {
			missing++
		}
		req := ""
		if t.Required {
			req = " [required]"
		}
		fmt.Fprintf(w, "%-20s %-8s %s%s\n", t.Name, status, path, req)
	}

	fmt.Fprintln(w)
	fmt.Fprintf(w, "%d found, %d missing", found, missing)
	if missing > 0 {
		fmt.Fprintf(w, " (exit 1)")
	}
	fmt.Fprintln(w)
}
