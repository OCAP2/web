package server

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/go-fuego/fuego"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetMarkerBlacklist_Empty(t *testing.T) {
	hdlr, op := setupAdminTest(t)

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": fmt.Sprintf("%d", op.ID)}

	ids, err := hdlr.GetMarkerBlacklist(ctx)
	require.NoError(t, err)
	assert.Equal(t, []int{}, ids)
}

func TestAddAndGetBlacklist(t *testing.T) {
	hdlr, op := setupAdminTest(t)
	opID := fmt.Sprintf("%d", op.ID)

	// PUT to add player 42
	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": opID, "playerId": "42"}
	_, err := hdlr.AddMarkerBlacklist(ctx)
	require.NoError(t, err)

	// GET should return [42]
	ctx2 := fuego.NewMockContextNoBody()
	ctx2.PathParams = map[string]string{"id": opID}
	ids, err := hdlr.GetMarkerBlacklist(ctx2)
	require.NoError(t, err)
	assert.Equal(t, []int{42}, ids)
}

func TestAddBlacklist_Idempotent(t *testing.T) {
	hdlr, op := setupAdminTest(t)
	opID := fmt.Sprintf("%d", op.ID)

	for i := 0; i < 2; i++ {
		ctx := fuego.NewMockContextNoBody()
		ctx.PathParams = map[string]string{"id": opID, "playerId": "10"}
		_, err := hdlr.AddMarkerBlacklist(ctx)
		require.NoError(t, err)
	}

	// GET should return single entry
	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": opID}
	ids, err := hdlr.GetMarkerBlacklist(ctx)
	require.NoError(t, err)
	assert.Equal(t, []int{10}, ids)
}

func TestRemoveBlacklist(t *testing.T) {
	hdlr, op := setupAdminTest(t)
	opID := fmt.Sprintf("%d", op.ID)

	// Add player 5
	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": opID, "playerId": "5"}
	_, err := hdlr.AddMarkerBlacklist(ctx)
	require.NoError(t, err)

	// DELETE player 5
	ctx2 := fuego.NewMockContextNoBody()
	ctx2.PathParams = map[string]string{"id": opID, "playerId": "5"}
	_, err = hdlr.RemoveMarkerBlacklist(ctx2)
	require.NoError(t, err)

	// GET should be empty
	ctx3 := fuego.NewMockContextNoBody()
	ctx3.PathParams = map[string]string{"id": opID}
	ids, err := hdlr.GetMarkerBlacklist(ctx3)
	require.NoError(t, err)
	assert.Equal(t, []int{}, ids)
}

func TestAddBlacklist_Unauthorized(t *testing.T) {
	hdlr, op := setupAdminTest(t)

	// Test via HTTP with requireAdmin middleware
	req := httptest.NewRequest(http.MethodPut, "/", nil)
	rec := httptest.NewRecorder()

	// Wrap a dummy handler with requireAdmin
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	hdlr.requireAdmin(inner).ServeHTTP(rec, req)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	_ = op // use op to avoid unused warning
}

func TestRemoveBlacklist_Unauthorized(t *testing.T) {
	hdlr, op := setupAdminTest(t)

	req := httptest.NewRequest(http.MethodDelete, "/", nil)
	rec := httptest.NewRecorder()

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	hdlr.requireAdmin(inner).ServeHTTP(rec, req)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	_ = op
}

func TestBlacklist_MultipleEntries(t *testing.T) {
	hdlr, op := setupAdminTest(t)
	opID := fmt.Sprintf("%d", op.ID)

	// Add players 1, 2, 3
	for _, pid := range []string{"1", "2", "3"} {
		ctx := fuego.NewMockContextNoBody()
		ctx.PathParams = map[string]string{"id": opID, "playerId": pid}
		_, err := hdlr.AddMarkerBlacklist(ctx)
		require.NoError(t, err)
	}

	// GET should return [1, 2, 3]
	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": opID}
	ids, err := hdlr.GetMarkerBlacklist(ctx)
	require.NoError(t, err)
	assert.Equal(t, []int{1, 2, 3}, ids)

	// Remove player 2
	ctx2 := fuego.NewMockContextNoBody()
	ctx2.PathParams = map[string]string{"id": opID, "playerId": "2"}
	_, err = hdlr.RemoveMarkerBlacklist(ctx2)
	require.NoError(t, err)

	// GET should return [1, 3]
	ctx3 := fuego.NewMockContextNoBody()
	ctx3.PathParams = map[string]string{"id": opID}
	ids, err = hdlr.GetMarkerBlacklist(ctx3)
	require.NoError(t, err)
	assert.Equal(t, []int{1, 3}, ids)
}

func TestBlacklist_BadID(t *testing.T) {
	hdlr, _ := setupAdminTest(t)

	// Bad operation ID for GET
	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": "abc"}
	_, err := hdlr.GetMarkerBlacklist(ctx)
	assert.IsType(t, fuego.BadRequestError{}, err)

	// Bad operation ID for PUT
	ctx2 := fuego.NewMockContextNoBody()
	ctx2.PathParams = map[string]string{"id": "abc", "playerId": "1"}
	_, err = hdlr.AddMarkerBlacklist(ctx2)
	assert.IsType(t, fuego.BadRequestError{}, err)

	// Bad player ID for PUT
	ctx3 := fuego.NewMockContextNoBody()
	ctx3.PathParams = map[string]string{"id": "1", "playerId": "xyz"}
	_, err = hdlr.AddMarkerBlacklist(ctx3)
	assert.IsType(t, fuego.BadRequestError{}, err)

	// Bad operation ID for DELETE
	ctx4 := fuego.NewMockContextNoBody()
	ctx4.PathParams = map[string]string{"id": "abc", "playerId": "1"}
	_, err = hdlr.RemoveMarkerBlacklist(ctx4)
	assert.IsType(t, fuego.BadRequestError{}, err)

	// Bad player ID for DELETE
	ctx5 := fuego.NewMockContextNoBody()
	ctx5.PathParams = map[string]string{"id": "1", "playerId": "xyz"}
	_, err = hdlr.RemoveMarkerBlacklist(ctx5)
	assert.IsType(t, fuego.BadRequestError{}, err)
}

func TestGetMarkerBlacklist_DBError(t *testing.T) {
	dir := t.TempDir()
	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)
	repo.db.Close() // Force DB errors

	jwt := NewJWTManager("secret", time.Hour)
	h := &Handler{repoOperation: repo, jwt: jwt}

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": "1"}

	_, err = h.GetMarkerBlacklist(ctx)
	assert.Error(t, err)
}

func TestAddMarkerBlacklist_DBError(t *testing.T) {
	dir := t.TempDir()
	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)
	repo.db.Close()

	jwt := NewJWTManager("secret", time.Hour)
	h := &Handler{repoOperation: repo, jwt: jwt}

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": "1", "playerId": "5"}

	_, err = h.AddMarkerBlacklist(ctx)
	assert.Error(t, err)
}

func TestRemoveMarkerBlacklist_DBError(t *testing.T) {
	dir := t.TempDir()
	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)
	repo.db.Close()

	jwt := NewJWTManager("secret", time.Hour)
	h := &Handler{repoOperation: repo, jwt: jwt}

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": "1", "playerId": "5"}

	_, err = h.RemoveMarkerBlacklist(ctx)
	assert.Error(t, err)
}
