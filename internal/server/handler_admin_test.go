package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
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
		jwt:           NewJWTManager("test-secret", time.Hour),
	}
	return hdlr, op
}

func TestEditOperation(t *testing.T) {
	hdlr, op := setupAdminTest(t)
	token, err := hdlr.jwt.Create("")
	require.NoError(t, err)

	e := echo.New()
	body := `{"missionName":"Renamed","tag":"COOP","date":"2026-02-01"}`
	req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(fmt.Sprintf("%d", op.ID))

	err = hdlr.EditOperation(c)
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

func TestDeleteOperation_Handler(t *testing.T) {
	hdlr, op := setupAdminTest(t)
	token, err := hdlr.jwt.Create("")
	require.NoError(t, err)

	// Create fake data files on disk
	dataDir := hdlr.setting.Data
	jsonGzPath := filepath.Join(dataDir, op.Filename+".json.gz")
	require.NoError(t, os.WriteFile(jsonGzPath, []byte("fake"), 0644))
	pbDir := filepath.Join(dataDir, op.Filename)
	require.NoError(t, os.MkdirAll(filepath.Join(pbDir, "chunks"), 0755))
	require.NoError(t, os.WriteFile(filepath.Join(pbDir, "manifest.pb"), []byte("fake"), 0644))

	e := echo.New()
	req := httptest.NewRequest(http.MethodDelete, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(fmt.Sprintf("%d", op.ID))

	err = hdlr.DeleteOperation(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusNoContent, rec.Code)

	// DB record gone
	_, err = hdlr.repoOperation.GetByID(t.Context(), fmt.Sprintf("%d", op.ID))
	assert.Error(t, err)

	// Files gone
	assert.NoFileExists(t, jsonGzPath)
	assert.NoDirExists(t, pbDir)
}

func TestRetryConversion(t *testing.T) {
	hdlr, op := setupAdminTest(t)
	token, err := hdlr.jwt.Create("")
	require.NoError(t, err)

	// Set op to failed status
	ctx := t.Context()
	require.NoError(t, hdlr.repoOperation.UpdateConversionStatus(ctx, op.ID, ConversionStatusFailed))

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(fmt.Sprintf("%d", op.ID))

	err = hdlr.RetryConversion(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)

	// Status should be pending
	updated, err := hdlr.repoOperation.GetByID(ctx, fmt.Sprintf("%d", op.ID))
	require.NoError(t, err)
	assert.Equal(t, ConversionStatusPending, updated.ConversionStatus)
}

func TestEditOperation_BadID(t *testing.T) {
	hdlr, _ := setupAdminTest(t)

	e := echo.New()
	req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(`{"missionName":"X"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues("notanumber")

	err := hdlr.EditOperation(c)
	assert.Equal(t, echo.ErrBadRequest, err)
}

func TestEditOperation_NotFound(t *testing.T) {
	hdlr, _ := setupAdminTest(t)

	e := echo.New()
	req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(`{"missionName":"X"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues("99999")

	err := hdlr.EditOperation(c)
	assert.Equal(t, echo.ErrNotFound, err)
}

func TestDeleteOperation_BadID(t *testing.T) {
	hdlr, _ := setupAdminTest(t)

	e := echo.New()
	req := httptest.NewRequest(http.MethodDelete, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues("abc")

	err := hdlr.DeleteOperation(c)
	assert.Equal(t, echo.ErrBadRequest, err)
}

func TestDeleteOperation_Handler_NotFound(t *testing.T) {
	hdlr, _ := setupAdminTest(t)

	e := echo.New()
	req := httptest.NewRequest(http.MethodDelete, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues("99999")

	err := hdlr.DeleteOperation(c)
	assert.Equal(t, echo.ErrNotFound, err)
}

func TestRetryConversion_BadID(t *testing.T) {
	hdlr, _ := setupAdminTest(t)

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues("xyz")

	err := hdlr.RetryConversion(c)
	assert.Equal(t, echo.ErrBadRequest, err)
}

func TestRetryConversion_NotFound(t *testing.T) {
	hdlr, _ := setupAdminTest(t)

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues("99999")

	err := hdlr.RetryConversion(c)
	assert.Equal(t, echo.ErrNotFound, err)
}

func TestRetryConversion_NotFailed(t *testing.T) {
	hdlr, op := setupAdminTest(t)

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(fmt.Sprintf("%d", op.ID))

	// op has ConversionStatus "completed", not "failed"
	err := hdlr.RetryConversion(c)
	he, ok := err.(*echo.HTTPError)
	require.True(t, ok)
	assert.Equal(t, http.StatusConflict, he.Code)
}

// TestAdminFlow_LoginEditDelete is an end-to-end integration test that exercises
// the full admin flow through real HTTP calls on a live test server, verifying
// login, auth check, edit, delete, logout, and post-logout 401.
func TestAdminFlow_LoginEditDelete(t *testing.T) {
	dir := t.TempDir()

	// Create test DB and insert an operation
	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)
	t.Cleanup(func() { repo.db.Close() })

	op := &Operation{
		WorldName: "altis", MissionName: "Original",
		MissionDuration: 300, Filename: "test_op",
		Date: "2026-01-01", Tag: "TvT",
		StorageFormat: "protobuf", ConversionStatus: ConversionStatusCompleted,
	}
	require.NoError(t, repo.Store(t.Context(), op))

	// Create fake data files so delete has something to clean up
	jsonGzPath := filepath.Join(dir, "test_op.json.gz")
	require.NoError(t, os.WriteFile(jsonGzPath, []byte("fake"), 0644))
	pbDir := filepath.Join(dir, "test_op")
	require.NoError(t, os.MkdirAll(filepath.Join(pbDir, "chunks"), 0755))
	require.NoError(t, os.WriteFile(filepath.Join(pbDir, "manifest.pb"), []byte("fake"), 0644))

	// Build Echo app with all admin routes
	setting := Setting{
		Secret: "test-secret",
		Data:   dir,
		Admin:  Admin{SessionTTL: time.Hour},
	}
	jwtMgr := NewJWTManager("test-secret", time.Hour)

	e := echo.New()
	hdlr := Handler{
		repoOperation: repo,
		setting:       setting,
		jwt:           jwtMgr,
	}

	e.Use(hdlr.errorHandler)
	e.GET("/api/v1/auth/me", hdlr.GetMe)
	e.POST("/api/v1/auth/logout", hdlr.Logout)
	admin := e.Group("", hdlr.requireAdmin)
	admin.PATCH("/api/v1/operations/:id", hdlr.EditOperation)
	admin.DELETE("/api/v1/operations/:id", hdlr.DeleteOperation)
	admin.POST("/api/v1/operations/:id/retry", hdlr.RetryConversion)

	// Start real test server
	ts := httptest.NewServer(e)
	defer ts.Close()

	client := &http.Client{}
	opID := fmt.Sprintf("%d", op.ID)

	// Create a JWT directly (simulates successful Steam login)
	authToken, err := jwtMgr.Create("76561198012345678")
	require.NoError(t, err)

	// Step 1: Check auth status — verify authenticated:true
	t.Run("CheckAuth", func(t *testing.T) {
		req, err := http.NewRequest(http.MethodGet, ts.URL+"/api/v1/auth/me", nil)
		require.NoError(t, err)
		req.Header.Set("Authorization", "Bearer "+authToken)

		resp, err := client.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)

		var body map[string]any
		require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
		assert.Equal(t, true, body["authenticated"])
	})

	// Step 3: Edit operation — PATCH with new name and tag
	t.Run("EditOperation", func(t *testing.T) {
		req, err := http.NewRequest(
			http.MethodPatch,
			ts.URL+"/api/v1/operations/"+opID,
			strings.NewReader(`{"missionName":"Renamed","tag":"COOP"}`),
		)
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+authToken)

		resp, err := client.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)

		var result Operation
		require.NoError(t, json.NewDecoder(resp.Body).Decode(&result))
		assert.Equal(t, "Renamed", result.MissionName)
		assert.Equal(t, "COOP", result.Tag)
	})

	// Step 4: Verify edit persisted in DB
	t.Run("VerifyEditInDB", func(t *testing.T) {
		updated, err := repo.GetByID(t.Context(), opID)
		require.NoError(t, err)
		assert.Equal(t, "Renamed", updated.MissionName)
		assert.Equal(t, "COOP", updated.Tag)
	})

	// Step 5: Delete operation — verify 204
	t.Run("DeleteOperation", func(t *testing.T) {
		req, err := http.NewRequest(
			http.MethodDelete,
			ts.URL+"/api/v1/operations/"+opID,
			nil,
		)
		require.NoError(t, err)
		req.Header.Set("Authorization", "Bearer "+authToken)

		resp, err := client.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusNoContent, resp.StatusCode)
	})

	// Step 6: Verify delete — DB record gone, files removed
	t.Run("VerifyDeletedFromDB", func(t *testing.T) {
		_, err := repo.GetByID(t.Context(), opID)
		assert.Error(t, err)
	})

	t.Run("VerifyFilesRemoved", func(t *testing.T) {
		assert.NoFileExists(t, jsonGzPath)
		assert.NoDirExists(t, pbDir)
	})

	// Step 7: Logout — verify 204
	t.Run("Logout", func(t *testing.T) {
		req, err := http.NewRequest(http.MethodPost, ts.URL+"/api/v1/auth/logout", nil)
		require.NoError(t, err)

		resp, err := client.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusNoContent, resp.StatusCode)
	})

	// Step 8: After logout (token discarded), admin endpoints should return 401
	t.Run("UnauthorizedAfterLogout", func(t *testing.T) {
		req, err := http.NewRequest(
			http.MethodPatch,
			ts.URL+"/api/v1/operations/999",
			strings.NewReader(`{"missionName":"Should Fail"}`),
		)
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		// No Authorization header — simulates discarded token

		resp, err := client.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()
		io.Copy(io.Discard, resp.Body)

		assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	})
}
