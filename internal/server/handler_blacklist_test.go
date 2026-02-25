package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetMarkerBlacklist_Empty(t *testing.T) {
	hdlr, op := setupAdminTest(t)

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(fmt.Sprintf("%d", op.ID))

	err := hdlr.GetMarkerBlacklist(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)

	var ids []int
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &ids))
	assert.Equal(t, []int{}, ids)
}

func TestAddAndGetBlacklist(t *testing.T) {
	hdlr, op := setupAdminTest(t)
	token, err := hdlr.jwt.Create("")
	require.NoError(t, err)

	e := echo.New()
	opID := fmt.Sprintf("%d", op.ID)

	// PUT to add player 42
	req := httptest.NewRequest(http.MethodPut, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id", "playerId")
	c.SetParamValues(opID, "42")

	err = hdlr.AddMarkerBlacklist(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusNoContent, rec.Code)

	// GET should return [42]
	req = httptest.NewRequest(http.MethodGet, "/", nil)
	rec = httptest.NewRecorder()
	c = e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(opID)

	err = hdlr.GetMarkerBlacklist(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)

	var ids []int
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &ids))
	assert.Equal(t, []int{42}, ids)
}

func TestAddBlacklist_Idempotent(t *testing.T) {
	hdlr, op := setupAdminTest(t)
	token, err := hdlr.jwt.Create("")
	require.NoError(t, err)

	e := echo.New()
	opID := fmt.Sprintf("%d", op.ID)

	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodPut, "/", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("id", "playerId")
		c.SetParamValues(opID, "10")

		err = hdlr.AddMarkerBlacklist(c)
		require.NoError(t, err)
		assert.Equal(t, http.StatusNoContent, rec.Code)
	}

	// GET should return single entry
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(opID)

	err = hdlr.GetMarkerBlacklist(c)
	require.NoError(t, err)

	var ids []int
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &ids))
	assert.Equal(t, []int{10}, ids)
}

func TestRemoveBlacklist(t *testing.T) {
	hdlr, op := setupAdminTest(t)
	token, err := hdlr.jwt.Create("")
	require.NoError(t, err)

	e := echo.New()
	opID := fmt.Sprintf("%d", op.ID)

	// Add player 5
	req := httptest.NewRequest(http.MethodPut, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id", "playerId")
	c.SetParamValues(opID, "5")
	require.NoError(t, hdlr.AddMarkerBlacklist(c))

	// DELETE player 5
	req = httptest.NewRequest(http.MethodDelete, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	c = e.NewContext(req, rec)
	c.SetParamNames("id", "playerId")
	c.SetParamValues(opID, "5")

	err = hdlr.RemoveMarkerBlacklist(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusNoContent, rec.Code)

	// GET should be empty
	req = httptest.NewRequest(http.MethodGet, "/", nil)
	rec = httptest.NewRecorder()
	c = e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(opID)
	require.NoError(t, hdlr.GetMarkerBlacklist(c))

	var ids []int
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &ids))
	assert.Equal(t, []int{}, ids)
}

func TestAddBlacklist_Unauthorized(t *testing.T) {
	hdlr, op := setupAdminTest(t)

	e := echo.New()
	req := httptest.NewRequest(http.MethodPut, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id", "playerId")
	c.SetParamValues(fmt.Sprintf("%d", op.ID), "1")

	handler := hdlr.requireAdmin(hdlr.AddMarkerBlacklist)
	err := handler(c)
	assert.Equal(t, echo.ErrUnauthorized, err)
}

func TestRemoveBlacklist_Unauthorized(t *testing.T) {
	hdlr, op := setupAdminTest(t)

	e := echo.New()
	req := httptest.NewRequest(http.MethodDelete, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id", "playerId")
	c.SetParamValues(fmt.Sprintf("%d", op.ID), "1")

	handler := hdlr.requireAdmin(hdlr.RemoveMarkerBlacklist)
	err := handler(c)
	assert.Equal(t, echo.ErrUnauthorized, err)
}

func TestBlacklist_BadID(t *testing.T) {
	hdlr, _ := setupAdminTest(t)

	e := echo.New()

	// Bad operation ID for GET
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues("abc")

	err := hdlr.GetMarkerBlacklist(c)
	assert.Equal(t, echo.ErrBadRequest, err)

	// Bad operation ID for PUT
	req = httptest.NewRequest(http.MethodPut, "/", nil)
	rec = httptest.NewRecorder()
	c = e.NewContext(req, rec)
	c.SetParamNames("id", "playerId")
	c.SetParamValues("abc", "1")

	err = hdlr.AddMarkerBlacklist(c)
	assert.Equal(t, echo.ErrBadRequest, err)

	// Bad player ID for PUT
	req = httptest.NewRequest(http.MethodPut, "/", nil)
	rec = httptest.NewRecorder()
	c = e.NewContext(req, rec)
	c.SetParamNames("id", "playerId")
	c.SetParamValues("1", "xyz")

	err = hdlr.AddMarkerBlacklist(c)
	assert.Equal(t, echo.ErrBadRequest, err)

	// Bad operation ID for DELETE
	req = httptest.NewRequest(http.MethodDelete, "/", nil)
	rec = httptest.NewRecorder()
	c = e.NewContext(req, rec)
	c.SetParamNames("id", "playerId")
	c.SetParamValues("abc", "1")

	err = hdlr.RemoveMarkerBlacklist(c)
	assert.Equal(t, echo.ErrBadRequest, err)

	// Bad player ID for DELETE
	req = httptest.NewRequest(http.MethodDelete, "/", nil)
	rec = httptest.NewRecorder()
	c = e.NewContext(req, rec)
	c.SetParamNames("id", "playerId")
	c.SetParamValues("1", "xyz")

	err = hdlr.RemoveMarkerBlacklist(c)
	assert.Equal(t, echo.ErrBadRequest, err)
}
