package server

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestOpenAPIUIHandler(t *testing.T) {
	specURL := "/swagger/openapi.json"
	handler := OpenAPIUIHandler(specURL)

	req := httptest.NewRequest(http.MethodGet, "/swagger", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "text/html; charset=utf-8", rec.Header().Get("Content-Type"))

	body := rec.Body.String()
	assert.Contains(t, body, specURL, "should embed the spec URL")
	assert.Contains(t, body, `"darkMode":true`, "should enable dark mode")
	assert.Contains(t, body, "OCAP2 Web API", "should have the page title")
	assert.Contains(t, body, "api-reference", "should include the Scalar script tag")
}
