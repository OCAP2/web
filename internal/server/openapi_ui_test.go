package server

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestOpenAPIUIHandler(t *testing.T) {
	handler := OpenAPIUIHandler("/ignored/absolute/path")

	req := httptest.NewRequest(http.MethodGet, "/swagger", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "text/html; charset=utf-8", rec.Header().Get("Content-Type"))

	body := rec.Body.String()
	assert.Contains(t, body, `data-url="swagger/openapi.json"`, "should use relative spec URL")
	assert.NotContains(t, body, "/ignored/absolute/path", "should not use absolute spec URL")
	assert.Contains(t, body, `"darkMode":true`, "should enable dark mode")
	assert.Contains(t, body, "OCAP2 Web API", "should have the page title")
	assert.Contains(t, body, "api-reference", "should include the Scalar script tag")
}
