package main

import "github.com/OCAP2/web/internal/maptool"

func buildGradMehPipeline(tools maptool.ToolSet) *maptool.Pipeline {
	stages := []maptool.Stage{
		// 1. Parse input metadata
		maptool.NewParseGradMehStage(),

		// 2. Prepare source data (parallel: preview, DEM, satellite scan are independent)
		maptool.ParallelStages("prepare",
			maptool.NewGeneratePreviewStage(),
			maptool.NewPrepareDEMStage(tools),
			maptool.NewGradMehSatelliteStage(),
		),

		// 3. Render all tile layers (parallel: satellite, DEM-derived layers are independent)
		maptool.ParallelStages("render",
			maptool.NewGenerateSatellitePMTilesStage(tools),
			maptool.NewGenerateHeightmapStage(tools),
			maptool.NewGenerateHillshadeStage(tools),
			maptool.NewGenerateBathymetryStage(tools),
			maptool.NewGenerateColorReliefStage(tools),
			maptool.NewGenerateContoursStage(tools),
		),

		// 4-7. Vector pipeline + finalize (sequential: each depends on prior)
		maptool.NewProcessGeoJSONStage(),
		maptool.NewGradMehVectorTilesStage(tools),
		maptool.NewGenerateStylesStage(),
		maptool.NewGenerateGradMehMetadataStage(),
	}
	return maptool.NewPipeline(stages)
}
