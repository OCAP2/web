# Maptool CLI — Design

**Date:** 2026-05-11
**Status:** Approved (design phase)

## Motivation

The grad_meh → tile rendering pipeline today is only reachable through the admin
UI. Community feedback (Discord, 30 Apr — 3 May 2026) consistently asks for a
CLI:

- jonpas wants to render many maps without clicking through the UI per map.
- Smith wants to render on a beefier workstation and ship the result to a web
  server, because the rendered output is ~6× smaller than the grad_meh input.
- FyWolf has pre-rendered maps and would benefit from a drop-in path.

The pipeline code already lives in `internal/maptool/` and is fully reusable.
The CLI is a thin driver around that package, not new rendering logic.

## Non-goals

- No new pipeline stages or rendering changes. Output is byte-equivalent to the
  UI's output.
- No "install" or DB registration step. The server discovers worlds by scanning
  `OCAP_MAPS/` at request time (`internal/server/world.go`), so writing the
  output directory is sufficient.
- No bundle/zip output format for the rendered result. The UI only ingests raw
  grad_meh ZIPs; there is no import endpoint for rendered tiles, so emitting
  one would produce an artifact nothing can consume.
- No partial / per-stage execution. Full pipeline only.
- No Docker re-exec. If external tools are missing, fail with a hint pointing
  at the `full` image; let the user decide how to fix it.

## Command shape

New subcommand added next to the existing `convert` subcommand in
`cmd/ocap-webserver/`:

```
ocap-webserver maptool render <input.zip> [flags]
ocap-webserver maptool render --batch <dir>  [flags]
```

`maptool` is the subcommand group; `render` is the only verb in v1. The group
leaves room for future verbs (e.g. `maptool health`, `maptool inspect`)
without renaming.

### Flags

| Flag | Default | Purpose |
|------|---------|---------|
| `-o, --out <dir>` | `OCAP_MAPS` from config/env | Output directory. Override for off-host renders. |
| `--batch <dir>` | — | Render every `*.zip` in the directory. Mutually exclusive with positional input. |
| `-j, --jobs <N>` | `1` | Concurrent maps in batch mode. Default 1 because each pipeline is already CPU-heavy internally. |
| `--log-format <json\|text\|auto>` | `auto` | `auto` = text on TTY, JSON otherwise. |
| `--force` | off | Overwrite an existing `<world>/` directory. Default: skip with a warning. |

## Execution flow

### Preflight (once, at startup)

Run the existing `maptool.ToolSet` health check (same code path as
`getMapToolHealth` in `internal/server/handler_maptool.go`). If any required
external tool is missing (gdal binaries, tippecanoe, pmtiles CLI), abort the
entire run with:

```
maptool: missing required tools: tippecanoe, pmtiles
Install them locally, or run inside the OCAP full Docker image:
  ghcr.io/ocap2/web:full
```

Exit code `2`. Refusing 40 maps at minute 0 beats refusing map 17 after two
hours.

### Per-input pipeline

For each input ZIP:

1. **Validate** the ZIP exists, is readable, and matches the expected grad_meh
   layout (reuses `internal/maptool/zip.go`).
2. **Determine world name** from grad_meh metadata, same logic as
   `internal/maptool/gradmeh_pipeline.go`.
3. **Resolve target** = `<out>/<world>/`. If it already exists and `--force` is
   not set, log "skip" and move on.
4. **Render into a partial dir** `<out>/.<world>.partial/` by calling the
   existing pipeline entry point (`RunGradMehPipeline` or equivalent) the web
   handler already uses. Stage events route through the chosen log formatter.
5. **Atomic publish:** on success, rename the partial dir to `<out>/<world>/`.
   Prevents the running server from picking up a half-rendered world if the
   CLI is interrupted mid-stage.
6. **Same-host pickup:** because `ScanWorlds` reads `OCAP_MAPS/` at request
   time, no server restart is needed when `-o` points at the running server's
   maps dir.

### Batch mode

With `--batch <dir>`, glob `*.zip` and run a worker pool of `-j` goroutines,
each executing the per-input pipeline above. Aggregate a final summary.

## Output formatting

Two formatters share the same event stream emitted by the pipeline.

- **Text** (interactive default): stage names, elapsed times, colored when
  stdout is a TTY, final summary table.
- **JSON** (default off-TTY, force with `--log-format=json`): one structured
  record per stage start/end, one per map result, one final summary record.
  Consistent with the existing server `slog` JSON handler.

Final summary example (text):

```
Rendered: altis, stratis, malden
Skipped:  chernarus (already exists; use --force to re-render)
Failed:   livonia (gdalwarp exited 1 in stage satellite — see ./out/.livonia.partial/)

3 ok / 1 skipped / 1 failed
```

## Errors and exit codes

| Code | Meaning |
|------|---------|
| `0` | All inputs rendered (or cleanly skipped). |
| `1` | At least one input failed during rendering. |
| `2` | Preflight failure (missing tools, bad flags, unreadable input). |

Failed maps leave their `.partial/` directory on disk for inspection — no
auto-cleanup. The user can re-run with `--force` to retry, or `rm -rf` the
partial dir manually.

## Signal handling

SIGINT / SIGTERM cancels the root context. In-flight pipelines abort at the
next stage boundary. Partial dirs are left behind. Worker pool drains, summary
is printed, exit code is `1` if anything was in flight (treated as failure).

## Code touch points

- **New:** `cmd/ocap-webserver/maptool.go` — flag parsing, batch loop, formatter
  selection, top-level orchestration. Modeled on `cmd/ocap-webserver/convert.go`.
- **New:** small log-formatter shim (text + JSON) over pipeline stage events.
- **Modified:** `cmd/ocap-webserver/main.go` — dispatch `os.Args[1] == "maptool"`
  the same way `convert` is dispatched today.
- **Reused unchanged:** all of `internal/maptool/`. Anything currently called
  by `internal/server/handler_maptool.go` is called the same way by the CLI.
  If the existing pipeline entry point isn't conveniently callable from a
  non-HTTP context, the minimal refactor is to extract its body into a
  function that takes a context and an input/output path pair — no behavioral
  change.

## Out of scope (deferred)

- `--zip` bundle output — no import endpoint consumes it.
- `--only <stages>` selective re-render — YAGNI; users can `rm -rf` and rerun.
- `--docker` re-exec — explicit failure message is enough; user decides.
- Resume / per-map completion state — pipeline is deterministic and the output
  directory already signals completion.
