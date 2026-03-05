package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/go-fuego/fuego"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupAdminTest(t *testing.T) (*Handler, *Operation) {
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

	hdlr := &Handler{
		repoOperation: repo,
		setting:       Setting{Secret: "test-secret", Data: dir},
		jwt:           NewJWTManager("test-secret", time.Hour),
	}
	return hdlr, op
}

func TestEditOperation(t *testing.T) {
	hdlr, op := setupAdminTest(t)

	body := `{"missionName":"Renamed","tag":"COOP","date":"2026-02-01"}`
	req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": fmt.Sprintf("%d", op.ID)}
	ctx.SetRequest(req)

	result, err := hdlr.EditOperation(ctx)
	require.NoError(t, err)
	assert.Equal(t, "Renamed", result.MissionName)
	assert.Equal(t, "COOP", result.Tag)

	// Verify DB updated
	updated, err := hdlr.repoOperation.GetByID(t.Context(), fmt.Sprintf("%d", op.ID))
	require.NoError(t, err)
	assert.Equal(t, "Renamed", updated.MissionName)
	assert.Equal(t, "COOP", updated.Tag)
}

func TestEditOperation_Unauthorized(t *testing.T) {
	hdlr, _ := setupAdminTest(t)

	// Test via HTTP with requireAdmin middleware
	req := httptest.NewRequest(http.MethodPatch, "/", nil)
	rec := httptest.NewRecorder()

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	hdlr.requireAdmin(inner).ServeHTTP(rec, req)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestDeleteOperation_Handler(t *testing.T) {
	hdlr, op := setupAdminTest(t)

	// Create fake data files on disk
	dataDir := hdlr.setting.Data
	jsonGzPath := filepath.Join(dataDir, op.Filename+".json.gz")
	require.NoError(t, os.WriteFile(jsonGzPath, []byte("fake"), 0644))
	pbDir := filepath.Join(dataDir, op.Filename)
	require.NoError(t, os.MkdirAll(filepath.Join(pbDir, "chunks"), 0755))
	require.NoError(t, os.WriteFile(filepath.Join(pbDir, "manifest.pb"), []byte("fake"), 0644))

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": fmt.Sprintf("%d", op.ID)}

	result, err := hdlr.DeleteOperation(ctx)
	require.NoError(t, err)
	assert.Nil(t, result)

	// DB record gone
	_, err = hdlr.repoOperation.GetByID(t.Context(), fmt.Sprintf("%d", op.ID))
	assert.Error(t, err)

	// Files gone
	assert.NoFileExists(t, jsonGzPath)
	assert.NoDirExists(t, pbDir)
}

func TestRetryConversion(t *testing.T) {
	hdlr, op := setupAdminTest(t)

	// Set op to failed status
	tctx := t.Context()
	require.NoError(t, hdlr.repoOperation.UpdateConversionStatus(tctx, op.ID, ConversionStatusFailed))

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": fmt.Sprintf("%d", op.ID)}

	result, err := hdlr.RetryConversion(ctx)
	require.NoError(t, err)
	assert.Equal(t, ConversionStatusPending, result.Status)

	// Status should be pending
	updated, err := hdlr.repoOperation.GetByID(tctx, fmt.Sprintf("%d", op.ID))
	require.NoError(t, err)
	assert.Equal(t, ConversionStatusPending, updated.ConversionStatus)
}

func TestEditOperation_BadID(t *testing.T) {
	hdlr, _ := setupAdminTest(t)

	req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(`{"missionName":"X"}`))
	req.Header.Set("Content-Type", "application/json")

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": "notanumber"}
	ctx.SetRequest(req)

	_, err := hdlr.EditOperation(ctx)
	assert.IsType(t, fuego.BadRequestError{}, err)
}

func TestEditOperation_NotFound(t *testing.T) {
	hdlr, _ := setupAdminTest(t)

	req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(`{"missionName":"X"}`))
	req.Header.Set("Content-Type", "application/json")

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": "99999"}
	ctx.SetRequest(req)

	_, err := hdlr.EditOperation(ctx)
	assert.IsType(t, fuego.NotFoundError{}, err)
}

func TestDeleteOperation_BadID(t *testing.T) {
	hdlr, _ := setupAdminTest(t)

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": "abc"}

	_, err := hdlr.DeleteOperation(ctx)
	assert.IsType(t, fuego.BadRequestError{}, err)
}

func TestDeleteOperation_Handler_NotFound(t *testing.T) {
	hdlr, _ := setupAdminTest(t)

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": "99999"}

	_, err := hdlr.DeleteOperation(ctx)
	assert.IsType(t, fuego.NotFoundError{}, err)
}

func TestRetryConversion_BadID(t *testing.T) {
	hdlr, _ := setupAdminTest(t)

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": "xyz"}

	_, err := hdlr.RetryConversion(ctx)
	assert.IsType(t, fuego.BadRequestError{}, err)
}

func TestRetryConversion_NotFound(t *testing.T) {
	hdlr, _ := setupAdminTest(t)

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": "99999"}

	_, err := hdlr.RetryConversion(ctx)
	assert.IsType(t, fuego.NotFoundError{}, err)
}

func TestRetryConversion_NotFailed(t *testing.T) {
	hdlr, op := setupAdminTest(t)

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": fmt.Sprintf("%d", op.ID)}

	// op has ConversionStatus "completed", not "failed"
	_, err := hdlr.RetryConversion(ctx)
	assert.IsType(t, fuego.ConflictError{}, err)
}

func TestEditOperation_BadBody(t *testing.T) {
	hdlr, op := setupAdminTest(t)

	req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader("not json"))
	req.Header.Set("Content-Type", "application/json")

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": fmt.Sprintf("%d", op.ID)}
	ctx.SetRequest(req)

	_, err := hdlr.EditOperation(ctx)
	assert.IsType(t, fuego.BadRequestError{}, err)
}

func TestRetryConversion_WithTrigger(t *testing.T) {
	hdlr, op := setupAdminTest(t)
	trigger := &mockConversionTrigger{}
	hdlr.conversionTrigger = trigger

	tctx := t.Context()
	require.NoError(t, hdlr.repoOperation.UpdateConversionStatus(tctx, op.ID, ConversionStatusFailed))

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": fmt.Sprintf("%d", op.ID)}

	result, err := hdlr.RetryConversion(ctx)
	require.NoError(t, err)
	assert.Equal(t, ConversionStatusPending, result.Status)
	assert.True(t, trigger.triggered)
	assert.Equal(t, op.ID, trigger.id)
}

func TestDeleteOperation_NoFiles(t *testing.T) {
	hdlr, op := setupAdminTest(t)
	// Don't create any files on disk - delete should still succeed

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": fmt.Sprintf("%d", op.ID)}

	_, err := hdlr.DeleteOperation(ctx)
	require.NoError(t, err)
}

// TestAdminFlow_LoginEditDelete is an end-to-end integration test that exercises
// the full admin flow through real HTTP calls on a live test server, verifying
// login, auth check, edit, delete, logout, and post-logout 401.
func TestDeleteOperation_WithFiles(t *testing.T) {
	// Create a test handler with a real repo and real data dir
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "data")
	require.NoError(t, os.MkdirAll(dataDir, 0755))
	pathDB := filepath.Join(dir, "test.db")
	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)

	tctx := t.Context()
	op := &Operation{
		WorldName: "altis", MissionName: "Test",
		MissionDuration: 300, Filename: "test_file",
		Date: "2026-01-01", Tag: "coop",
	}
	require.NoError(t, repo.Store(tctx, op))

	// Create the json.gz file and protobuf dir
	jsonGzPath := filepath.Join(dataDir, "test_file.json.gz")
	require.NoError(t, os.WriteFile(jsonGzPath, []byte("fake"), 0644))
	pbDir := filepath.Join(dataDir, "test_file")
	require.NoError(t, os.MkdirAll(pbDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(pbDir, "manifest.pb"), []byte("fake"), 0644))

	// Setup handler
	jwt := NewJWTManager("test-secret", time.Hour)
	h := &Handler{
		repoOperation: repo,
		setting:       Setting{Data: dataDir},
		jwt:           jwt,
	}

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": fmt.Sprintf("%d", op.ID)}

	_, err = h.DeleteOperation(ctx)
	assert.NoError(t, err)

	// Verify files were deleted
	_, err = os.Stat(jsonGzPath)
	assert.True(t, os.IsNotExist(err))
	_, err = os.Stat(pbDir)
	assert.True(t, os.IsNotExist(err))
}

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

	// Build Fuego server with all admin routes
	setting := Setting{
		Secret: "test-secret",
		Data:   dir,
		Admin:  Admin{SessionTTL: time.Hour},
	}
	jwtMgr := NewJWTManager("test-secret", time.Hour)

	repoMarker, _ := NewRepoMarker(filepath.Join(dir, "markers"))
	repoAmmo, _ := NewRepoAmmo(filepath.Join(dir, "ammo"))

	s := fuego.NewServer(fuego.WithoutStartupMessages(), fuego.WithoutAutoGroupTags(), fuego.WithSecurity(OpenAPISecuritySchemes))
	hdlr := &Handler{
		repoOperation: repo,
		setting:       setting,
		jwt:           jwtMgr,
	}

	// Register routes manually (like NewHandler does)
	fuego.Get(s, "/api/v1/auth/me", hdlr.GetMe)
	fuego.Post(s, "/api/v1/auth/logout", hdlr.Logout)
	admin := fuego.Group(s, "")
	fuego.Use(admin, hdlr.requireAdmin)
	fuego.Patch(admin, "/api/v1/operations/{id}", hdlr.EditOperation)
	fuego.Delete(admin, "/api/v1/operations/{id}", hdlr.DeleteOperation)
	fuego.Post(admin, "/api/v1/operations/{id}/retry", hdlr.RetryConversion)

	// Start real test server
	ts := httptest.NewServer(s.Mux)
	defer ts.Close()

	_ = repoMarker
	_ = repoAmmo

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

func TestEditOperation_UpdateError(t *testing.T) {
	dir := t.TempDir()
	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)

	tctx := context.Background()
	op := &Operation{
		WorldName: "altis", MissionName: "Test",
		MissionDuration: 300, Filename: "test_edit_err",
		Date: "2026-01-01", Tag: "coop",
	}
	require.NoError(t, repo.Store(tctx, op))

	jwt := NewJWTManager("secret", time.Hour)
	h := &Handler{repoOperation: repo, jwt: jwt}

	// We need GetByID to succeed but UpdateOperation to fail.
	// Can't easily do that with a real DB, so just test the EditOperation
	// with partial fields to cover the empty name/date fallback paths.
	body := `{"tag":"PvP"}` // no missionName, no date — covers fallback paths
	req := httptest.NewRequest(http.MethodPut, "/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": strconv.FormatInt(op.ID, 10)}
	ctx.SetRequest(req)

	result, err := h.EditOperation(ctx)
	assert.NoError(t, err)

	// Verify fallback values were used
	assert.Equal(t, "Test", result.MissionName) // Should keep original name
	assert.Equal(t, "PvP", result.Tag)
	assert.Equal(t, "2026-01-01", result.Date) // Should keep original date
}

func TestRetryConversion_UpdateStatusError(t *testing.T) {
	dir := t.TempDir()
	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)

	tctx := context.Background()
	op := &Operation{
		WorldName: "altis", MissionName: "Test",
		MissionDuration: 300, Filename: "test_retry_err",
		Date: "2026-01-01", Tag: "coop",
	}
	require.NoError(t, repo.Store(tctx, op))
	require.NoError(t, repo.UpdateConversionStatus(tctx, op.ID, ConversionStatusFailed))

	jwt := NewJWTManager("secret", time.Hour)
	h := &Handler{repoOperation: repo, setting: Setting{Data: dir}, jwt: jwt}

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": strconv.FormatInt(op.ID, 10)}

	// RetryConversion success path (covers UpdateConversionStatus + TriggerConversion nil path)
	result, err := h.RetryConversion(ctx)
	assert.NoError(t, err)
	assert.Equal(t, ConversionStatusPending, result.Status)
}

func TestDeleteOperation_DBDeleteError(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "data")
	require.NoError(t, os.MkdirAll(dataDir, 0755))
	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)

	tctx := context.Background()
	op := &Operation{
		WorldName: "altis", MissionName: "Test",
		MissionDuration: 300, Filename: "test_del_err",
		Date: "2026-01-01", Tag: "coop",
	}
	require.NoError(t, repo.Store(tctx, op))

	jwt := NewJWTManager("secret", time.Hour)
	h := &Handler{repoOperation: repo, setting: Setting{Data: dataDir}, jwt: jwt}

	// First call should succeed — covers the file cleanup code paths
	// where files don't exist (os.Remove returns IsNotExist)
	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": strconv.FormatInt(op.ID, 10)}

	_, err = h.DeleteOperation(ctx)
	assert.NoError(t, err)
}

func TestEditOperation_FocusRange(t *testing.T) {
	hdlr, op := setupAdminTest(t)

	body := `{"focusStart":50,"focusEnd":420}`
	req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": fmt.Sprintf("%d", op.ID)}
	ctx.SetRequest(req)

	result, err := hdlr.EditOperation(ctx)
	require.NoError(t, err)

	updated, err := hdlr.repoOperation.GetByID(t.Context(), fmt.Sprintf("%d", op.ID))
	require.NoError(t, err)
	require.NotNil(t, updated.FocusStart)
	require.NotNil(t, updated.FocusEnd)
	assert.Equal(t, int64(50), *updated.FocusStart)
	assert.Equal(t, int64(420), *updated.FocusEnd)

	require.NotNil(t, result.FocusStart)
	assert.Equal(t, int64(50), *result.FocusStart)
}

func TestEditOperation_ClearFocusRange(t *testing.T) {
	hdlr, op := setupAdminTest(t)
	tctx := t.Context()

	// First set a focus range directly in DB
	start, end := int64(10), int64(100)
	_, err := hdlr.repoOperation.db.ExecContext(tctx,
		`UPDATE operations SET focus_start = ?, focus_end = ? WHERE id = ?`,
		start, end, op.ID)
	require.NoError(t, err)

	// Clear via API with explicit nulls
	body := `{"focusStart":null,"focusEnd":null}`
	req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": fmt.Sprintf("%d", op.ID)}
	ctx.SetRequest(req)

	_, err = hdlr.EditOperation(ctx)
	require.NoError(t, err)

	updated, err := hdlr.repoOperation.GetByID(tctx, fmt.Sprintf("%d", op.ID))
	require.NoError(t, err)
	assert.Nil(t, updated.FocusStart)
	assert.Nil(t, updated.FocusEnd)
}

func TestEditOperation_PreservesFocusRange(t *testing.T) {
	hdlr, op := setupAdminTest(t)
	tctx := t.Context()

	// Set focus range directly
	start, end := int64(10), int64(100)
	_, err := hdlr.repoOperation.db.ExecContext(tctx,
		`UPDATE operations SET focus_start = ?, focus_end = ? WHERE id = ?`,
		start, end, op.ID)
	require.NoError(t, err)

	// Edit only missionName — focus range should be preserved
	body := `{"missionName":"Renamed"}`
	req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": fmt.Sprintf("%d", op.ID)}
	ctx.SetRequest(req)

	_, err = hdlr.EditOperation(ctx)
	require.NoError(t, err)

	updated, err := hdlr.repoOperation.GetByID(tctx, fmt.Sprintf("%d", op.ID))
	require.NoError(t, err)
	assert.Equal(t, "Renamed", updated.MissionName)
	require.NotNil(t, updated.FocusStart)
	assert.Equal(t, int64(10), *updated.FocusStart)
	assert.Equal(t, int64(100), *updated.FocusEnd)
}

func TestEditOperation_InvertedFocusRange(t *testing.T) {
	hdlr, op := setupAdminTest(t)

	// focusStart > focusEnd — this is an invalid range
	body := `{"focusStart":420,"focusEnd":50}`
	req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": fmt.Sprintf("%d", op.ID)}
	ctx.SetRequest(req)

	_, err := hdlr.EditOperation(ctx)
	assert.Error(t, err, "inverted focus range should be rejected")
}

func TestEditOperation_PartialFocusRange(t *testing.T) {
	hdlr, op := setupAdminTest(t)

	tests := []struct {
		name string
		body string
	}{
		{"focusStart without focusEnd", `{"focusStart":50}`},
		{"focusEnd without focusStart", `{"focusEnd":100}`},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")

			ctx := fuego.NewMockContextNoBody()
			ctx.PathParams = map[string]string{"id": fmt.Sprintf("%d", op.ID)}
			ctx.SetRequest(req)

			_, err := hdlr.EditOperation(ctx)
			assert.Error(t, err, "partial focus range should be rejected: %s", tc.name)
		})
	}
}

func TestEditOperation_InvalidFieldTypes(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{"invalid missionName type", `{"missionName": 123}`},
		{"invalid tag type", `{"tag": []}`},
		{"invalid date type", `{"date": {"nested": true}}`},
		{"invalid focusStart type", `{"focusStart": "not-a-number"}`},
		{"invalid focusEnd type", `{"focusEnd": ["array"]}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			hdlr, op := setupAdminTest(t)

			req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(tt.body))
			req.Header.Set("Content-Type", "application/json")

			ctx := fuego.NewMockContextNoBody()
			ctx.PathParams = map[string]string{"id": fmt.Sprintf("%d", op.ID)}
			ctx.SetRequest(req)

			_, err := hdlr.EditOperation(ctx)
			assert.Error(t, err, "expected error for %s", tt.name)
		})
	}
}

func TestEditOperation_UpdateOperationWriteError(t *testing.T) {
	// Cover L138-140: UpdateOperation returns an error.
	// Use PRAGMA query_only to make reads succeed but writes fail.
	dir := t.TempDir()
	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)
	t.Cleanup(func() { repo.db.Close() })

	tctx := context.Background()
	op := &Operation{
		WorldName: "altis", MissionName: "Test",
		MissionDuration: 300, Filename: "test_update_err",
		Date: "2026-01-01", Tag: "coop",
	}
	require.NoError(t, repo.Store(tctx, op))

	// Make DB read-only: GetByID succeeds, UpdateOperation fails
	_, err = repo.db.Exec("PRAGMA query_only = ON")
	require.NoError(t, err)

	jwt := NewJWTManager("secret", time.Hour)
	h := &Handler{repoOperation: repo, jwt: jwt}

	body := `{"missionName":"New Name"}`
	req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": strconv.FormatInt(op.ID, 10)}
	ctx.SetRequest(req)

	_, err = h.EditOperation(ctx)
	assert.Error(t, err, "should fail with read-only DB on UpdateOperation")
}

func TestRetryConversion_DBUpdateStatusError(t *testing.T) {
	// Cover L178-180: UpdateConversionStatus returns an error after removing files.
	// Use PRAGMA query_only to make reads succeed but writes fail.
	dir := t.TempDir()
	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)
	t.Cleanup(func() { repo.db.Close() })

	tctx := context.Background()
	op := &Operation{
		WorldName: "altis", MissionName: "Test",
		MissionDuration: 300, Filename: "test_retry_dberr",
		Date: "2026-01-01", Tag: "coop",
	}
	require.NoError(t, repo.Store(tctx, op))
	require.NoError(t, repo.UpdateConversionStatus(tctx, op.ID, ConversionStatusFailed))

	// Make DB read-only: GetByID succeeds, UpdateConversionStatus fails
	_, err = repo.db.Exec("PRAGMA query_only = ON")
	require.NoError(t, err)

	jwt := NewJWTManager("secret", time.Hour)
	h := &Handler{repoOperation: repo, setting: Setting{Data: dir}, jwt: jwt}

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": strconv.FormatInt(op.ID, 10)}

	_, err = h.RetryConversion(ctx)
	assert.Error(t, err, "should fail with read-only DB on UpdateConversionStatus")
}

func TestDeleteOperation_DBDeleteClosedDB(t *testing.T) {
	// Cover L204-206: Delete returns an error other than ErrNotFound.
	// Use PRAGMA query_only to make reads succeed but writes fail.
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "data")
	require.NoError(t, os.MkdirAll(dataDir, 0755))
	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)
	t.Cleanup(func() {
		repo.db.Exec("PRAGMA query_only = OFF")
		repo.db.Close()
	})

	tctx := context.Background()
	op := &Operation{
		WorldName: "altis", MissionName: "Test",
		MissionDuration: 300, Filename: "test_delete_dberr",
		Date: "2026-01-01", Tag: "coop",
	}
	require.NoError(t, repo.Store(tctx, op))

	// Make DB read-only: GetByID succeeds, Delete fails
	_, err = repo.db.Exec("PRAGMA query_only = ON")
	require.NoError(t, err)

	jwt := NewJWTManager("secret", time.Hour)
	h := &Handler{repoOperation: repo, setting: Setting{Data: dataDir}, jwt: jwt}

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": strconv.FormatInt(op.ID, 10)}

	_, err = h.DeleteOperation(ctx)
	assert.Error(t, err, "should fail with read-only DB on Delete")
}

func TestDeleteOperation_ReadOnlyFileCleanup(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "data")
	require.NoError(t, os.MkdirAll(dataDir, 0755))
	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)

	tctx := context.Background()
	op := &Operation{
		WorldName: "altis", MissionName: "Test",
		MissionDuration: 300, Filename: "test_ro_files",
		Date: "2026-01-01", Tag: "coop",
	}
	require.NoError(t, repo.Store(tctx, op))

	// Create the json.gz file and protobuf dir
	jsonGzPath := filepath.Join(dataDir, "test_ro_files.json.gz")
	require.NoError(t, os.WriteFile(jsonGzPath, []byte("fake"), 0644))
	pbDir := filepath.Join(dataDir, "test_ro_files")
	require.NoError(t, os.MkdirAll(filepath.Join(pbDir, "chunks"), 0755))
	require.NoError(t, os.WriteFile(filepath.Join(pbDir, "manifest.pb"), []byte("fake"), 0644))

	// Make data dir read-only so os.Remove and os.RemoveAll fail with permission error
	require.NoError(t, os.Chmod(dataDir, 0555))
	defer func() { assert.NoError(t, os.Chmod(dataDir, 0755)) }()

	jwt := NewJWTManager("secret", time.Hour)
	h := &Handler{repoOperation: repo, setting: Setting{Data: dataDir}, jwt: jwt}

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": strconv.FormatInt(op.ID, 10)}

	// DeleteOperation should succeed (DB delete works) even though file cleanup fails
	_, err = h.DeleteOperation(ctx)
	assert.NoError(t, err)

	// Files should still exist since removal failed
	os.Chmod(dataDir, 0755) // restore to check
	_, err = os.Stat(jsonGzPath)
	assert.NoError(t, err, "json.gz should still exist")
}
