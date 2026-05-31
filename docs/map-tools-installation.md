# Map Toolchain — Manual Installation

The OCAP2 Web **Map Manager** (and the `ocap-webserver maptool` CLI) turns raw Arma 3
map exports ([grad_meh](https://github.com/gruppe-adler/grad_meh)) into PMTiles +
MapLibre styles. That conversion relies on three external toolchains: **GDAL**,
**tippecanoe**, and **pmtiles**.

We ship two Docker images so you don't *have* to install these yourself:

| Variant | Tag | Map toolchain | Use for |
|---|---|---|---|
| **Slim** | `latest`, `slim` | ❌ | Replaying missions; maps prepared elsewhere |
| **Full** | `full` | ✅ | Importing/processing grad_meh map exports |

**You only need this guide if** you run the standalone binary (not the Full image)
*and* you want to import/process maps on that machine. For everyday mission playback
none of these tools are required — the slim binary is enough.

> The Full Docker image exists precisely because GDAL + tippecanoe pull in a large
> build/runtime footprint. Installing them by hand gives you the same capability
> without the extra image.

---

## What gets installed

| Tool | Binaries the pipeline looks for | Required? | Provides |
|---|---|---|---|
| **pmtiles** ([go-pmtiles](https://github.com/protomaps/go-pmtiles)) | `pmtiles` | **Yes** | Packs tiles into single-file PMTiles archives |
| **tippecanoe** ([felt/tippecanoe](https://github.com/felt/tippecanoe)) | `tippecanoe`, `tile-join` | **Yes** | Builds vector tiles from GeoJSON layers |
| **GDAL** ([gdal.org](https://gdal.org/)) | `gdal_translate`, `gdaldem`, `gdal_contour`, `gdaladdo`, `gdalbuildvrt`, `gdal_calc.py`, `gdal_fillnodata.py` | Recommended | Satellite imagery, DEM/terrain, hillshade, contours |

Notes:

- **pmtiles** and **tippecanoe** are *required* — without them the pipeline cannot run.
- **GDAL** is technically optional (the binaries are reported as not-required by
  `maptool tools`), but without it you lose satellite imagery, hillshade, color-relief,
  and contour layers — i.e. most of the visual output. Install it unless you have a
  reason not to.
- `gdal_calc.py` and `gdal_fillnodata.py` are **Python** utility scripts. They need
  GDAL's Python bindings, which on many distros are a *separate package* from the
  C++ command-line tools (see per-platform notes below).
- `tile-join` ships *inside* tippecanoe — installing tippecanoe gives you both.

### Versions we build against

The Full image pins these versions, so they're the known-good targets:

| Tool | Pinned version |
|---|---|
| tippecanoe | `2.79.0` |
| go-pmtiles | `1.30.0` |
| GDAL | whatever Alpine 3.23 ships (GDAL 3.x) |

Newer releases generally work; these are simply what CI tests. tippecanoe `2.x` and
GDAL `3.x` are the supported major versions.

---

## Verifying your install

There's no standalone "check tools" command — tool detection happens at the point of
use. Two ways to confirm everything is wired up:

**CLI — run a render.** The `maptool render` command runs a *preflight* before doing any
work. If a **required** tool is missing it stops immediately and tells you which:

```bash
./ocap-webserver maptool render path/to/map-export.zip
# → "missing required tools: [tippecanoe] ..." if something isn't on PATH
```

A clean preflight (no required tools missing) means the install worked.

**Web UI — the Map Manager page.** When the server starts it detects the toolchain
once and the admin **Map Manager** page shows per-tool availability (served by the
admin-only `GET /api/v1/maptool/tools` endpoint). If a tool is missing, install it and
restart the server so it re-detects.

> Tools are resolved from `PATH` via a plain lookup, so they must be visible to the
> **user/process that runs OCAP** — not just your interactive shell.

---

## Platform install guides

Pick your platform. Each section installs all three toolchains.

### Debian / Ubuntu

```bash
# 1. GDAL (command-line tools + Python bindings for gdal_calc.py / gdal_fillnodata.py)
sudo apt-get update
sudo apt-get install gdal-bin python3-gdal

# 2. tippecanoe — not in apt, build from source (needs a C++17 compiler)
sudo apt-get install build-essential libsqlite3-dev zlib1g-dev git
git clone https://github.com/felt/tippecanoe.git
cd tippecanoe
make -j"$(nproc)"
sudo make install          # installs tippecanoe, tile-join, … into /usr/local/bin
cd .. && rm -rf tippecanoe

# 3. pmtiles — download the release binary (already named `pmtiles`)
#    Replace the URL with the latest from https://github.com/protomaps/go-pmtiles/releases
curl -L -o pmtiles.tar.gz \
  https://github.com/protomaps/go-pmtiles/releases/download/v1.30.0/go-pmtiles_1.30.0_Linux_x86_64.tar.gz
tar -xzf pmtiles.tar.gz pmtiles
sudo install pmtiles /usr/local/bin/pmtiles
rm pmtiles pmtiles.tar.gz
```

> **Want a newer GDAL?** The default Ubuntu repos can lag. Add the UbuntuGIS PPA first:
> ```bash
> sudo add-apt-repository ppa:ubuntugis/ppa && sudo apt-get update
> ```

### Fedora / RHEL / Rocky / Alma

```bash
# 1. GDAL — gdal (tools) + gdal-python-tools (gdal_calc.py, gdal_fillnodata.py)
sudo dnf install gdal gdal-python-tools     # RHEL-family: enable EPEL first

# 2. tippecanoe — build from source
sudo dnf install gcc-c++ make sqlite-devel zlib-devel git
git clone https://github.com/felt/tippecanoe.git
cd tippecanoe && make -j"$(nproc)" && sudo make install && cd .. && rm -rf tippecanoe

# 3. pmtiles — see the Debian/Ubuntu step 3 (same Linux release binary)
```

### Alpine

This mirrors exactly what the Full Docker image does.

```bash
# 1. GDAL — tools + drivers + Python bindings
apk add --no-cache gdal-tools gdal-driver-jpeg gdal-driver-png py3-gdal sqlite-libs zlib

# 2. tippecanoe — build from source, then drop the build deps
apk add --no-cache --virtual .build-deps build-base bash git sqlite-dev zlib-dev
git clone https://github.com/felt/tippecanoe.git
cd tippecanoe && make -j"$(nproc)" && make install && cd .. && rm -rf tippecanoe
apk del .build-deps

# 3. pmtiles — grab the musl/Linux release binary from
#    https://github.com/protomaps/go-pmtiles/releases and place it at /usr/local/bin/pmtiles
```

### macOS (Homebrew)

All three are available via Homebrew — by far the easiest path:

```bash
brew install gdal tippecanoe pmtiles
```

`brew install pmtiles` installs go-pmtiles with the binary correctly named `pmtiles`.

### Windows

The map pipeline runs the external tools as subprocesses, so they just need to be on
your `PATH`.

1. **GDAL** — install via [OSGeo4W](https://trac.osgeo.org/osgeo4w/) (the standard
   Windows GIS installer; select the GDAL package, which includes the Python tools),
   or via conda (below). Add the GDAL `bin` directory to your `PATH`.
2. **tippecanoe** — there is no official native Windows build. Use one of:
   - **WSL2** (recommended): run OCAP and follow the Debian/Ubuntu steps inside WSL.
   - **conda** (cross-platform package below).
3. **pmtiles** — download `…_Windows_x86_64.zip` from the
   [releases page](https://github.com/protomaps/go-pmtiles/releases), extract
   `pmtiles.exe`, and put it on your `PATH`.

### Cross-platform: conda / micromamba

conda-forge is GDAL's officially recommended cross-platform distribution and also
carries tippecanoe and pmtiles. This works identically on Linux, macOS, and Windows
and avoids compiling anything:

```bash
conda install -c conda-forge gdal tippecanoe pmtiles
```

(The `gdal` conda package bundles the Python utility scripts.)

---

## Per-tool reference

### pmtiles — mind the binary name

The pipeline looks for a binary literally named **`pmtiles`**.

- **Release binaries** ([releases page](https://github.com/protomaps/go-pmtiles/releases))
  and **Homebrew** already name it `pmtiles` — prefer these.
- Installing with Go names it **`go-pmtiles`** instead, which the pipeline will *not*
  find:
  ```bash
  go install github.com/protomaps/go-pmtiles@latest   # produces $GOPATH/bin/go-pmtiles
  ```
  If you go this route, rename/symlink it onto your `PATH`:
  ```bash
  ln -s "$(go env GOPATH)/bin/go-pmtiles" /usr/local/bin/pmtiles
  ```

### tippecanoe — built from source, gives you `tile-join`

tippecanoe is distributed as source (no apt/dnf package). `make install` puts both
`tippecanoe` and `tile-join` — both of which the pipeline uses — on your `PATH`.
It needs a **C++17** compiler plus the SQLite and zlib development headers (covered in
each platform's steps above). Use `PREFIX` to control the install location:

```bash
make install PREFIX=/usr/local
```

### GDAL — don't forget the Python bindings

The plain GDAL package gives you the C++ tools (`gdal_translate`, `gdaldem`,
`gdal_contour`, `gdaladdo`, `gdalbuildvrt`). The `.py` utilities the pipeline also
calls (`gdal_calc.py`, `gdal_fillnodata.py`) live in a **separate** package on most
distros:

| Distro | Python-tools package |
|---|---|
| Debian/Ubuntu | `python3-gdal` |
| Fedora/RHEL | `gdal-python-tools` |
| Alpine | `py3-gdal` |
| conda / Homebrew | included in `gdal` |

If `maptool tools` shows the `gdal_*.py` scripts missing while the other GDAL tools are
found, you've installed the C++ tools but not the Python bindings — add the package above.

---

## Troubleshooting

- **Preflight / Map Manager says a required tool is missing** → that binary isn't on the
  `PATH` of the user running OCAP. Confirm with `which pmtiles tippecanoe` (or `where` on
  Windows) as that same user, then restart the server so it re-detects.
- **`gdal_calc.py` / `gdal_fillnodata.py` not found** → install the GDAL Python-tools
  package (table above). The C++ tools alone aren't enough.
- **`tile-join` not found but `tippecanoe` is** → your tippecanoe install is partial;
  re-run `make install`. They build together.
- **Maps process but have no satellite/hillshade/contours** → GDAL is missing or
  incomplete; these layers are GDAL-driven.
