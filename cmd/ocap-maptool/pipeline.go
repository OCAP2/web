package main

import "github.com/OCAP2/web/internal/maptool"

func buildGradMehPipeline(tools maptool.ToolSet) *maptool.Pipeline {
	stages := []maptool.Stage{
		maptool.NewParseGradMehStage(),           // 1. parse_gradmeh
		maptool.NewPrepareDEMStage(tools),        // 2. prepare_dem
		maptool.NewGradMehSatelliteStage(),       // 3. process_satellite
		maptool.NewGenerateSatellitePMTilesStage(tools), // 4. generate_satellite_tiles
		maptool.NewGenerateHeightmapStage(tools), // 5. generate_heightmap
		maptool.NewGenerateHillshadeStage(tools),     // 6. generate_hillshade
		maptool.NewGenerateHillshadeFullStage(tools), // 7. generate_hillshade_full
		maptool.NewGenerateColorReliefStage(tools), // 8. generate_colorrelief
		maptool.NewGenerateContoursStage(tools),  // 9. generate_contours
		maptool.NewProcessGeoJSONStage(),         // 10. process_geojson
		maptool.NewGradMehVectorTilesStage(tools), // 11. generate_vector_tiles
		maptool.NewGenerateStylesStage(),         // 12. generate_styles
		maptool.NewGenerateGradMehMetadataStage(), // 13. generate_metadata
	}
	return maptool.NewPipeline(stages)
}
