package maptool

// BuildGradMehPipeline creates the standard pipeline for processing grad_meh exports.
func BuildGradMehPipeline(tools ToolSet) *Pipeline {
	stages := []Stage{
		// 1. Parse input metadata
		NewParseGradMehStage(),

		// 2. Prepare source data (parallel: preview, DEM, satellite scan are independent)
		ParallelStages("prepare",
			NewGeneratePreviewStage(),
			NewPrepareDEMStage(tools),
			NewGradMehSatelliteStage(),
		),

		// 3. Render all tile layers (parallel: satellite, DEM-derived layers are independent)
		ParallelStages("render",
			NewGenerateSatellitePMTilesStage(tools),
			NewGenerateHeightmapStage(tools),
			NewGenerateHillshadeStage(tools),
			NewGenerateBathymetryStage(tools),
			NewGenerateColorReliefStage(tools),
			NewGenerateContoursStage(tools),
		),

		// 4-7. Vector pipeline + finalize (sequential: each depends on prior)
		NewProcessGeoJSONStage(),
		NewGradMehVectorTilesStage(tools),
		NewGenerateStylesStage(),
		NewGenerateGradMehMetadataStage(),
	}
	return NewPipeline(stages)
}
