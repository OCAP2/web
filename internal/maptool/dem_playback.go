package maptool

import (
	"compress/gzip"
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"path/filepath"
)

const playbackDEMMagic = "OCAPDEM\x01"
const playbackDEMMaxDim = 1024

// NewWritePlaybackDEMStage writes a compact gzipped height grid the web UI
// samples for TFAR approximate radio range. Optional: skipped when no DEM.
func NewWritePlaybackDEMStage() Stage {
	return Stage{
		Name:     "write_playback_dem",
		Optional: true,
		Run: func(ctx context.Context, job *Job) error {
			if err := ctx.Err(); err != nil {
				return err
			}
			return writePlaybackDEMJob(job)
		},
	}
}

func writePlaybackDEMJob(job *Job) error {
	if job.DEMGrid == nil {
		return fmt.Errorf("DEM not available")
	}
	grid := downsampleDEM(job.DEMGrid, playbackDEMMaxDim)
	outPath := filepath.Join(job.TilesOutputDir(), "dem.bin.gz")
	if err := os.MkdirAll(filepath.Dir(outPath), 0755); err != nil {
		return err
	}
	worldSize := job.WorldSize
	if worldSize <= 0 {
		worldSize = int(math.Round(float64(grid.Cols-1) * grid.CellSize))
	}
	if err := encodePlaybackDEMFile(outPath, grid, worldSize); err != nil {
		return err
	}
	job.HasDem = true
	log.Printf("Wrote playback DEM %s (%dx%d, cell %.1fm)", outPath, grid.Cols, grid.Rows, grid.CellSize)
	return nil
}

func downsampleDEM(src *DEMGrid, maxDim int) *DEMGrid {
	if src.Cols <= maxDim && src.Rows <= maxDim {
		return src
	}
	scale := 1
	if src.Cols > maxDim {
		scale = (src.Cols + maxDim - 1) / maxDim
	}
	if src.Rows > maxDim {
		rowScale := (src.Rows + maxDim - 1) / maxDim
		if rowScale > scale {
			scale = rowScale
		}
	}
	cols := (src.Cols + scale - 1) / scale
	rows := (src.Rows + scale - 1) / scale
	out := &DEMGrid{
		Cols:      cols,
		Rows:      rows,
		XllCorner: src.XllCorner,
		YllCorner: src.YllCorner,
		CellSize:  src.CellSize * float64(scale),
		NoData:    src.NoData,
		Data:      make([]float32, cols*rows),
	}
	for r := 0; r < rows; r++ {
		srcR := r * scale
		if srcR >= src.Rows {
			srcR = src.Rows - 1
		}
		for c := 0; c < cols; c++ {
			srcC := c * scale
			if srcC >= src.Cols {
				srcC = src.Cols - 1
			}
			out.Data[r*cols+c] = src.Data[srcR*src.Cols+srcC]
		}
	}
	return out
}

func encodePlaybackDEMFile(path string, grid *DEMGrid, worldSize int) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	gz := gzip.NewWriter(f)
	defer gz.Close()
	return encodePlaybackDEM(gz, grid, worldSize)
}

func encodePlaybackDEM(w io.Writer, grid *DEMGrid, worldSize int) error {
	if _, err := io.WriteString(w, playbackDEMMagic); err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, float32(worldSize)); err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, float32(grid.XllCorner)); err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, float32(grid.YllCorner)); err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, float32(grid.CellSize)); err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, uint32(grid.Cols)); err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, uint32(grid.Rows)); err != nil {
		return err
	}
	for _, h := range grid.Data {
		dm := int(math.Round(float64(h) * 10))
		if dm < -32767 {
			dm = -32767
		}
		if dm > 32767 {
			dm = 32767
		}
		if err := binary.Write(w, binary.LittleEndian, int16(dm)); err != nil {
			return err
		}
	}
	return nil
}
