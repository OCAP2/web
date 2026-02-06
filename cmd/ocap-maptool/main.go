package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/OCAP2/web/internal/maptool"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "import" {
		if err := runImport(os.Args[2:]); err != nil {
			log.Fatalf("import: %v", err)
		}
		return
	}

	if err := serve(); err != nil {
		log.Fatalf("fatal: %v", err)
	}
}

func serve() error {
	listen := os.Getenv("OCAP_MAPTOOL_LISTEN")
	if listen == "" {
		listen = ":5001"
	}
	mapsDir := os.Getenv("OCAP_MAPS")
	if mapsDir == "" {
		mapsDir = "maps"
	}

	tools := maptool.DetectTools()
	log.Println("Detected tools:")
	for _, t := range tools {
		status := "not found"
		if t.Found {
			status = t.Path
		}
		req := ""
		if !t.Required {
			req = " (optional)"
		}
		log.Printf("  %s: %s%s", t.Name, status, req)
	}

	newPipeline := func() *maptool.Pipeline { return buildGradMehPipeline(tools) }
	jm := maptool.NewJobManager(mapsDir, newPipeline)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go jm.Start(ctx)

	e := echo.New()
	e.HideBanner = true
	e.Use(middleware.BodyLimit("2G"))
	newHandler(e, tools, jm, mapsDir)

	go func() {
		quit := make(chan os.Signal, 1)
		signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
		<-quit
		cancel()
		e.Shutdown(context.Background())
	}()

	fmt.Printf("OCAP2 Map Tool listening on %s\n", listen)
	if err := e.Start(listen); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("start server: %w", err)
	}
	return nil
}
