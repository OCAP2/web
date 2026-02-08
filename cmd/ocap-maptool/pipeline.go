package main

import "github.com/OCAP2/web/internal/maptool"

func buildGradMehPipeline(tools maptool.ToolSet) *maptool.Pipeline {
	stages := []maptool.Stage{
		maptool.NewParseGradMehStage(),           // 1. parse_gradmeh
		maptool.NewGeneratePreviewStage(),        // 2. generate_preview
		maptool.NewPrepareDEMStage(tools),        // 3. prepare_dem
		maptool.NewGradMehSatelliteStage(),       // 4. process_satellite
		maptool.NewGenerateSatellitePMTilesStage(tools), // 5. generate_satellite_tiles
		maptool.NewGenerateHeightmapStage(tools), // 6. generate_heightmap
		maptool.NewGenerateHillshadeStage(tools),     // 7. generate_hillshade
		maptool.NewGenerateBathymetryStage(tools), // 8. generate_bathymetry
		maptool.NewGenerateColorReliefStage(tools), // 9. generate_colorrelief
		maptool.NewGenerateContoursStage(tools),  // 10. generate_contours
		maptool.NewProcessGeoJSONStage(),         // 11. process_geojson
		maptool.NewGradMehVectorTilesStage(tools), // 12. generate_vector_tiles
		maptool.NewGenerateStylesStage(),         // 13. generate_styles
		maptool.NewGenerateGradMehMetadataStage(), // 14. generate_metadata
	}
	return maptool.NewPipeline(stages)
}
