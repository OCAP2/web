package main

import "github.com/OCAP2/web/internal/maptool"

func buildGradMehPipeline(tools maptool.ToolSet) *maptool.Pipeline {
	stages := []maptool.Stage{
		maptool.NewParseGradMehStage(),           // 1. parse_gradmeh
		maptool.NewPrepareDEMStage(tools),        // 2. prepare_dem
		maptool.NewGradMehSatelliteStage(),       // 3. process_satellite
		maptool.NewGenerateSatellitePMTilesStage(tools), // 4. generate_satellite_tiles
		maptool.NewGenerateHeightmapStage(tools), // 5. generate_heightmap
		maptool.NewGenerateHillshadeStage(tools), // 6. generate_hillshade
		maptool.NewGenerateColorReliefStage(tools), // 7. generate_colorrelief
		maptool.NewGenerateContoursStage(tools),  // 8. generate_contours
		maptool.NewProcessGeoJSONStage(),         // 9. process_geojson
		maptool.NewGradMehVectorTilesStage(tools), // 10. generate_vector_tiles
		maptool.NewGenerateStylesStage(),         // 11. generate_styles
		maptool.NewGenerateGradMehMetadataStage(), // 12. generate_metadata
	}
	return maptool.NewPipeline(stages)
}
