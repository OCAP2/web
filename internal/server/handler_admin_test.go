package server

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupAdminTest(t *testing.T) (Handler, *Operation) {
	t.Helper()
	dir := t.TempDir()
	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)
	t.Cleanup(func() { repo.db.Close() })

	op := &Operation{
		WorldName: "altis", MissionName: "Test Mission",
		MissionDuration: 300, Filename: "test_mission",
		Date: "2026-01-01", Tag: "TvT",
		StorageFormat: "protobuf", ConversionStatus: ConversionStatusCompleted,
	}
	require.NoError(t, repo.Store(t.Context(), op))

	hdlr := Handler{
		repoOperation: repo,
		setting:       Setting{Secret: "test-secret", Data: dir},
		sessions:      NewSessionStore(time.Hour),
	}
	return hdlr, op
}

func TestEditOperation(t *testing.T) {
	hdlr, op := setupAdminTest(t)
	token := hdlr.sessions.Create()

	e := echo.New()
	body := `{"missionName":"Renamed","tag":"COOP","date":"2026-02-01"}`
	req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "ocap_session", Value: token})
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(fmt.Sprintf("%d", op.ID))

	err := hdlr.EditOperation(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)

	// Verify DB updated
	updated, err := hdlr.repoOperation.GetByID(t.Context(), fmt.Sprintf("%d", op.ID))
	require.NoError(t, err)
	assert.Equal(t, "Renamed", updated.MissionName)
	assert.Equal(t, "COOP", updated.Tag)
}

func TestEditOperation_Unauthorized(t *testing.T) {
	hdlr, op := setupAdminTest(t)

	e := echo.New()
	body := `{"missionName":"Renamed"}`
	req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(fmt.Sprintf("%d", op.ID))

	// Call middleware + handler
	handler := hdlr.requireAdmin(hdlr.EditOperation)
	err := handler(c)
	assert.Equal(t, echo.ErrUnauthorized, err)
}
