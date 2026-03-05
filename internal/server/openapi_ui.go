package server

import (
	"fmt"
	"net/http"
)

// OpenAPIUIHandler returns an http.Handler that serves Scalar API reference
// with native dark mode. The specURL from fuego is absolute (e.g. "/swagger/openapi.json")
// but we use a relative URL so it resolves correctly behind a reverse proxy path prefix.
func OpenAPIUIHandler(_ string) http.Handler {
	const page = `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>OCAP2 Web API</title>
</head>
<body>
	<script id="api-reference" data-url="openapi.json" data-configuration='{"darkMode":true,"showDeveloperTools":"never"}'></script>
	<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>`

	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, page)
	})
}
