package main

import "github.com/OCAP2/web/internal/maptool"

func buildGradMehPipeline(tools maptool.ToolSet) *maptool.Pipeline {
	return maptool.BuildGradMehPipeline(tools)
}
