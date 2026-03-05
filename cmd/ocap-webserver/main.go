package main

import (
	"context"
	"fmt"
	"io"
	"io/fs"
	"log"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/OCAP2/web/internal/conversion"
	"github.com/OCAP2/web/internal/frontend"
	"github.com/OCAP2/web/internal/maptool"
	"github.com/OCAP2/web/internal/server"
	"github.com/getkin/kin-openapi/openapi3"
	"github.com/go-fuego/fuego"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "convert" {
		if err := runConvert(os.Args[2:]); err != nil {
			log.Fatalf("convert: %v", err)
		}
		return
	}

	if err := app(); err != nil {
		log.Fatalf("fatal: %v", err)
	}
}

func app() error {
	setting, err := server.NewSetting()
	if err != nil {
		return fmt.Errorf("setting: %w", err)
	}

	// Configure structured JSON logging
	var logOutput io.Writer = os.Stdout
	var flog *os.File
	if setting.Logger {
		flog, err = os.OpenFile("ocap.log", os.O_RDWR|os.O_CREATE|os.O_APPEND, 0666)
		if err != nil {
			return fmt.Errorf("open logger file: %w", err)
		}
		defer flog.Close()
		logOutput = io.MultiWriter(os.Stdout, flog)
	}

	// Set up slog with JSON handler for consistent logging
	logHandler := slog.NewJSONHandler(logOutput, nil)
	slog.SetDefault(slog.New(logHandler))

	operation, err := server.NewRepoOperation(setting.DB)
	if err != nil {
		return fmt.Errorf("operation: %w", err)
	}

	marker, err := server.NewRepoMarker(setting.Markers)
	if err != nil {
		return fmt.Errorf("marker: %w", err)
	}

	ammo, err := server.NewRepoAmmo(setting.Ammo)
	if err != nil {
		return fmt.Errorf("ammo: %w", err)
	}

	s := fuego.NewServer(
		fuego.WithAddr(setting.Listen),
		fuego.WithLogHandler(logHandler),
		fuego.WithoutAutoGroupTags(),
		fuego.WithSecurity(server.OpenAPISecuritySchemes),
		fuego.WithEngineOptions(
			fuego.WithOpenAPIConfig(fuego.OpenAPIConfig{
				SwaggerURL:       "/swagger",
				SpecURL:          "/swagger/openapi.json",
				PrettyFormatJSON: true,
				DisableLocalSave: true,
				UIHandler:        server.OpenAPIUIHandler,
				Info: &openapi3.Info{
					Title:       "OCAP2 Web API",
					Description: "Operation Capture And Playback — mission recording and replay API",
					Version:     server.BuildVersion,
				},
			}),
		),
	)

	// Create conversion worker if enabled (before handler so we can pass it)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Resolve static frontend filesystem
	var staticFS fs.FS
	if setting.Static != "" {
		staticFS = os.DirFS(setting.Static)
	} else {
		staticFS, err = fs.Sub(frontend.DistFS, "dist")
		if err != nil {
			return fmt.Errorf("embedded frontend: %w", err)
		}
	}

	var handlerOpts []server.HandlerOption
	handlerOpts = append(handlerOpts, server.WithStaticFS(staticFS))
	if setting.Conversion.Enabled {
		interval, err := time.ParseDuration(setting.Conversion.Interval)
		if err != nil {
			log.Printf("Invalid conversion interval %q, using default 5m", setting.Conversion.Interval)
			interval = 5 * time.Minute
		}

		worker := conversion.NewWorker(
			operation,
			conversion.Config{
				DataDir:     setting.Data,
				Interval:    interval,
				BatchSize:   setting.Conversion.BatchSize,
				ChunkSize:   setting.Conversion.ChunkSize,
				RetryFailed: setting.Conversion.RetryFailed,
			},
		)

		// Pass worker to handler for event-driven conversion on upload
		handlerOpts = append(handlerOpts, server.WithConversionTrigger(worker))

		// Start background worker for retries and batch processing
		go worker.Start(ctx)
	}

	// Auto-detect maptool: enable if all required tools are available.
	tools := maptool.DetectTools()
	if missing := tools.MissingRequired(); len(missing) > 0 {
		names := make([]string, len(missing))
		for i, t := range missing {
			names[i] = t.Name
		}
		slog.Warn("maptool: disabled (missing required tools)", "missing", names)
	} else {
		for _, t := range tools {
			found := "not found"
			if t.Found {
				found = t.Path
			}
			slog.Info("maptool", "tool", t.Name, "status", found, "required", t.Required)
		}
		newPipeline := func() *maptool.Pipeline { return maptool.BuildGradMehPipeline(tools) }
		jm := maptool.NewJobManager(setting.Maps, newPipeline)
		go jm.Start(ctx)
		handlerOpts = append(handlerOpts, server.WithMapTool(jm, tools, setting.Maps))
	}

	server.NewHandler(s, operation, marker, ammo, setting, handlerOpts...)

	// Handle graceful shutdown
	go func() {
		quit := make(chan os.Signal, 1)
		signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
		<-quit
		cancel()
		s.Shutdown(context.Background())
	}()

	return s.Run()
}
