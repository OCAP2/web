# Access Control Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add site-wide access control with five modes (public, password, steam, steamGroup, squadXml) to restrict who can view recordings.

**Architecture:** New `requireViewer` middleware gates recording endpoints (`/api/v1/operations*`, `/data/*`). A new `auth.mode` config field controls which authentication method is required. Password mode adds a new backend endpoint; steamGroup/squadXml add membership checks in the Steam callback. The frontend `/api/v1/customize` response is extended with `authMode` so the UI can show the appropriate login controls.

**Tech Stack:** Go (backend, fuego framework), SolidJS + TypeScript (frontend), Vitest (frontend tests), Go testing (backend tests)

**Design doc:** `docs/plans/2026-03-08-access-control-design.md`

---

### Task 1: Config — Add auth mode fields to Setting struct

**Files:**
- Modify: `internal/server/setting.go:50-54` (Auth struct)
- Modify: `internal/server/setting.go:96-99` (viper defaults)
- Modify: `internal/server/setting.go:103` (env var bindings)
- Modify: `setting.json.example:35-39` (example config)

**Step 1: Add fields to Auth struct**

In `setting.go`, extend the `Auth` struct:

```go
type Auth struct {
	Mode            string        `json:"mode" yaml:"mode"`
	SessionTTL      time.Duration `json:"sessionTTL" yaml:"sessionTTL"`
	AdminSteamIDs   []string      `json:"adminSteamIds" yaml:"adminSteamIds"`
	SteamAPIKey     string        `json:"steamApiKey" yaml:"steamApiKey"`
	Password        string        `json:"password" yaml:"password"`
	SteamGroupID    string        `json:"steamGroupId" yaml:"steamGroupId"`
	SquadXmlURL     string        `json:"squadXmlUrl" yaml:"squadXmlUrl"`
	SquadXmlCacheTTL time.Duration `json:"squadXmlCacheTTL" yaml:"squadXmlCacheTTL"`
}
```

**Step 2: Add viper defaults**

After line 99 (`viper.SetDefault("auth.steamApiKey", "")`), add:

```go
viper.SetDefault("auth.mode", "public")
viper.SetDefault("auth.password", "")
viper.SetDefault("auth.steamGroupId", "")
viper.SetDefault("auth.squadXmlUrl", "")
viper.SetDefault("auth.squadXmlCacheTTL", "5m")
```

**Step 3: Add env var bindings**

Add to the `envKeys` slice in line 103:

```
"auth.mode", "auth.password", "auth.steamGroupId", "auth.squadXmlUrl", "auth.squadXmlCacheTTL"
```

**Step 4: Add startup validation**

Add a `validateAuthConfig` function and call it from `NewSetting()` after unmarshal (after line 124):

```go
func validateAuthConfig(auth Auth) error {
	validModes := []string{"public", "password", "steam", "steamGroup", "squadXml"}
	if !slices.Contains(validModes, auth.Mode) {
		return fmt.Errorf("auth.mode %q is not valid, must be one of: %s", auth.Mode, strings.Join(validModes, ", "))
	}
	switch auth.Mode {
	case "password":
		if auth.Password == "" {
			return fmt.Errorf("auth.mode %q requires auth.password to be set", auth.Mode)
		}
	case "steamGroup":
		if auth.SteamAPIKey == "" {
			return fmt.Errorf("auth.mode %q requires auth.steamApiKey to be set", auth.Mode)
		}
		if auth.SteamGroupID == "" {
			return fmt.Errorf("auth.mode %q requires auth.steamGroupId to be set", auth.Mode)
		}
	case "squadXml":
		if auth.SteamAPIKey == "" {
			return fmt.Errorf("auth.mode %q requires auth.steamApiKey to be set", auth.Mode)
		}
		if auth.SquadXmlURL == "" {
			return fmt.Errorf("auth.mode %q requires auth.squadXmlUrl to be set", auth.Mode)
		}
		if auth.SquadXmlCacheTTL == 0 {
			log.Printf("WARN: auth.squadXmlCacheTTL is 0, squad XML will be fetched on every login")
		}
	}
	return nil
}
```

Call it in `NewSetting()`:
```go
if err = validateAuthConfig(setting.Auth); err != nil {
	return
}
```

**Step 5: Update setting.json.example**

```json
"auth": {
	"mode": "public",
	"sessionTTL": "24h",
	"adminSteamIds": [],
	"steamApiKey": "",
	"password": "",
	"steamGroupId": "",
	"squadXmlUrl": "",
	"squadXmlCacheTTL": "5m"
}
```

**Step 6: Run tests**

Run: `go test ./internal/server/ -run TestNew -v`

**Step 7: Commit**

```
feat(auth): add access control mode config fields

Adds mode, password, steamGroupId, squadXmlUrl, squadXmlCacheTTL
to auth config with startup validation.
```

---

### Task 2: Backend — requireViewer middleware

**Files:**
- Modify: `internal/server/handler_auth.go` (add `requireViewer` middleware)
- Modify: `internal/server/handler.go:144-155` (apply middleware to recording/data routes)

**Step 1: Write test for requireViewer**

Add to `handler_auth_test.go`:

```go
func TestRequireViewer(t *testing.T) {
	okHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	t.Run("public mode allows unauthenticated", func(t *testing.T) {
		hdlr := Handler{
			setting: Setting{Auth: Auth{Mode: "public"}},
		}
		rr := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/api/v1/operations", nil)
		hdlr.requireViewer(okHandler).ServeHTTP(rr, req)
		assert.Equal(t, http.StatusOK, rr.Code)
	})

	t.Run("non-public mode rejects unauthenticated", func(t *testing.T) {
		hdlr := Handler{
			setting: Setting{Auth: Auth{Mode: "steam"}, Secret: "test-secret"},
			jwt:     NewJWTManager("test-secret", time.Hour),
		}
		rr := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/api/v1/operations", nil)
		hdlr.requireViewer(okHandler).ServeHTTP(rr, req)
		assert.Equal(t, http.StatusUnauthorized, rr.Code)
	})

	t.Run("non-public mode allows viewer", func(t *testing.T) {
		jwtMgr := NewJWTManager("test-secret", time.Hour)
		token, _ := jwtMgr.Create("steam123", WithRole("viewer"))
		hdlr := Handler{
			setting: Setting{Auth: Auth{Mode: "steam"}, Secret: "test-secret"},
			jwt:     jwtMgr,
		}
		rr := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/api/v1/operations", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		hdlr.requireViewer(okHandler).ServeHTTP(rr, req)
		assert.Equal(t, http.StatusOK, rr.Code)
	})

	t.Run("non-public mode allows admin", func(t *testing.T) {
		jwtMgr := NewJWTManager("test-secret", time.Hour)
		token, _ := jwtMgr.Create("steam123", WithRole("admin"))
		hdlr := Handler{
			setting: Setting{Auth: Auth{Mode: "steam"}, Secret: "test-secret"},
			jwt:     jwtMgr,
		}
		rr := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/api/v1/operations", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		hdlr.requireViewer(okHandler).ServeHTTP(rr, req)
		assert.Equal(t, http.StatusOK, rr.Code)
	})
}
```

**Step 2: Run test to verify it fails**

Run: `go test ./internal/server/ -run TestRequireViewer -v`
Expected: FAIL — `requireViewer` not defined

**Step 3: Implement requireViewer**

Add to `handler_auth.go` after the `requireAdmin` middleware:

```go
// requireViewer is middleware that enforces site-wide access control.
// In "public" mode it passes all requests through. In all other modes
// it requires a valid JWT with any role (viewer or admin).
func (h *Handler) requireViewer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if h.setting.Auth.Mode == "public" {
			next.ServeHTTP(w, r)
			return
		}
		token := bearerToken(r)
		if token == "" || h.jwt.Validate(token) != nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}
```

**Step 4: Run test to verify it passes**

Run: `go test ./internal/server/ -run TestRequireViewer -v`
Expected: PASS

**Step 5: Apply middleware to routes**

In `handler.go`, create a viewer-gated group for recording and data endpoints. Replace the current route registrations (lines 144-160) with:

```go
// Viewer-gated routes (public in "public" mode, auth required in other modes)
viewer := fuego.Group(g, "")
fuego.Use(viewer, hdlr.requireViewer)

// Recordings (viewer-gated)
fuego.Get(viewer, "/api/v1/operations", hdlr.GetOperations, fuego.OptionTags("Recordings"))
fuego.Get(viewer, "/api/v1/operations/{id}", hdlr.GetOperation, fuego.OptionTags("Recordings"))
fuego.Get(viewer, "/api/v1/operations/{id}/marker-blacklist", hdlr.GetMarkerBlacklist, fuego.OptionTags("Recordings"))
fuego.Get(viewer, "/api/v1/worlds", hdlr.GetWorlds, fuego.OptionTags("Recordings"))

// Upload — stays on prefix group (has its own secret/JWT auth)
fuego.PostStd(g, "/api/v1/operations/add", hdlr.StoreOperation, fuego.OptionTags("Recordings"))

// Customize — stays on prefix group (public, frontend needs it before auth)
fuego.Get(g, "/api/v1/customize", hdlr.GetCustomize, fuego.OptionTags("Recordings"))

// Stream — stays on prefix group (has its own secret auth)
fuego.GetStd(g, "/api/v1/stream", hdlr.HandleStream, fuego.OptionTags("Recordings"))

// Assets (viewer-gated for data, public for everything else)
cacheMiddleware := hdlr.cacheControl(CacheDuration)
fuego.GetStd(viewer, "/data/{path...}", hdlr.GetData, fuego.OptionTags("Assets"), fuego.OptionMiddleware(cacheMiddleware))
fuego.GetStd(g, "/images/markers/{name}/{color}", hdlr.GetMarker, fuego.OptionTags("Assets"), fuego.OptionMiddleware(cacheMiddleware))
fuego.GetStd(g, "/images/markers/magicons/{name}", hdlr.GetAmmo, fuego.OptionTags("Assets"), fuego.OptionMiddleware(cacheMiddleware))
fuego.GetStd(g, "/images/maps/fonts/{fontstack}/{range}", hdlr.GetFont, fuego.OptionTags("Assets"), fuego.OptionMiddleware(cacheMiddleware))
fuego.GetStd(g, "/images/maps/sprites/{name}", hdlr.GetSprite, fuego.OptionTags("Assets"), fuego.OptionMiddleware(cacheMiddleware))
fuego.GetStd(g, "/images/maps/{path...}", hdlr.GetMapTile, fuego.OptionTags("Assets"), fuego.OptionMiddleware(cacheMiddleware))
```

**Step 6: Run all tests**

Run: `go test ./internal/server/ -v`
Expected: PASS

**Step 7: Commit**

```
feat(auth): add requireViewer middleware and gate recording/data endpoints

In public mode all requests pass through. In other modes a valid JWT
is required to access recording list, metadata, and data files.
```

---

### Task 3: Backend — Password login endpoint

**Files:**
- Modify: `internal/server/handler_auth.go` (add `PasswordLogin` handler)
- Modify: `internal/server/handler.go` (register route)

**Step 1: Write test for password login**

Add to `handler_auth_test.go`:

```go
func TestPasswordLogin(t *testing.T) {
	t.Run("correct password issues viewer JWT", func(t *testing.T) {
		jwtMgr := NewJWTManager("test-secret", time.Hour)
		hdlr := Handler{
			setting: Setting{
				Auth:   Auth{Mode: "password", Password: "secret123"},
				Secret: "test-secret",
			},
			jwt: jwtMgr,
		}

		body := `{"password":"secret123"}`
		req := httptest.NewRequest("POST", "/api/v1/auth/password", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		hdlr.PasswordLogin(rr, req)

		assert.Equal(t, http.StatusOK, rr.Code)

		var resp map[string]string
		json.NewDecoder(rr.Body).Decode(&resp)
		assert.NotEmpty(t, resp["token"])

		claims := jwtMgr.Claims(resp["token"])
		assert.Equal(t, "viewer", claims.Role)
		assert.Equal(t, "password", claims.Subject)
	})

	t.Run("wrong password returns 401", func(t *testing.T) {
		hdlr := Handler{
			setting: Setting{
				Auth:   Auth{Mode: "password", Password: "secret123"},
				Secret: "test-secret",
			},
			jwt: NewJWTManager("test-secret", time.Hour),
		}

		body := `{"password":"wrong"}`
		req := httptest.NewRequest("POST", "/api/v1/auth/password", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		hdlr.PasswordLogin(rr, req)

		assert.Equal(t, http.StatusUnauthorized, rr.Code)
	})

	t.Run("empty password returns 401", func(t *testing.T) {
		hdlr := Handler{
			setting: Setting{
				Auth:   Auth{Mode: "password", Password: "secret123"},
				Secret: "test-secret",
			},
			jwt: NewJWTManager("test-secret", time.Hour),
		}

		body := `{"password":""}`
		req := httptest.NewRequest("POST", "/api/v1/auth/password", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		hdlr.PasswordLogin(rr, req)

		assert.Equal(t, http.StatusUnauthorized, rr.Code)
	})
}
```

**Step 2: Run test to verify it fails**

Run: `go test ./internal/server/ -run TestPasswordLogin -v`

**Step 3: Implement PasswordLogin**

Add to `handler_auth.go`:

```go
// PasswordLogin validates a shared password and issues a viewer JWT.
func (h *Handler) PasswordLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	if req.Password == "" || req.Password != h.setting.Auth.Password {
		http.Error(w, "invalid password", http.StatusUnauthorized)
		return
	}

	token, err := h.jwt.Create("password", WithRole("viewer"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"token": token})
}
```

**Step 4: Register route**

In `handler.go`, add in the Auth section (after line 166):

```go
fuego.PostStd(g, "/api/v1/auth/password", hdlr.PasswordLogin, fuego.OptionTags("Auth"))
```

**Step 5: Run tests**

Run: `go test ./internal/server/ -run TestPasswordLogin -v`
Expected: PASS

**Step 6: Commit**

```
feat(auth): add password login endpoint

POST /api/v1/auth/password accepts {"password":"..."} and issues a
viewer JWT when the password matches auth.password config.
```

---

### Task 4: Backend — Steam group membership check

**Files:**
- Modify: `internal/server/handler_auth.go` (add group check in SteamCallback)

**Step 1: Write test for Steam group membership check**

Add to `handler_auth_test.go`:

```go
func TestSteamGroupMembershipCheck(t *testing.T) {
	t.Run("member gets viewer token", func(t *testing.T) {
		// Mock Steam group members API
		groupServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			json.NewEncoder(w).Encode(map[string]any{
				"response": map[string]any{
					"success": 1,
					"members": []map[string]string{
						{"steamid": "76561198012345678"},
						{"steamid": "76561198099999999"},
					},
				},
			})
		}))
		defer groupServer.Close()

		result, err := checkSteamGroupMembership(groupServer.URL, "76561198012345678", "test-api-key", "103582791460000000")
		assert.NoError(t, err)
		assert.True(t, result)
	})

	t.Run("non-member is rejected", func(t *testing.T) {
		groupServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			json.NewEncoder(w).Encode(map[string]any{
				"response": map[string]any{
					"success": 1,
					"members": []map[string]string{
						{"steamid": "76561198099999999"},
					},
				},
			})
		}))
		defer groupServer.Close()

		result, err := checkSteamGroupMembership(groupServer.URL, "76561198012345678", "test-api-key", "103582791460000000")
		assert.NoError(t, err)
		assert.False(t, result)
	})

	t.Run("API error returns error", func(t *testing.T) {
		groupServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusForbidden)
		}))
		defer groupServer.Close()

		_, err := checkSteamGroupMembership(groupServer.URL, "76561198012345678", "test-api-key", "103582791460000000")
		assert.Error(t, err)
	})
}
```

**Step 2: Run test to verify it fails**

Run: `go test ./internal/server/ -run TestSteamGroupMembership -v`

**Step 3: Implement checkSteamGroupMembership**

Add to `handler_auth.go`:

```go
// steamGroupMembersResponse models the Steam Web API GetGroupMembers response.
type steamGroupMembersResponse struct {
	Response struct {
		Success int `json:"success"`
		Members []struct {
			SteamID string `json:"steamid"`
		} `json:"members"`
	} `json:"response"`
}

// checkSteamGroupMembership checks if a Steam ID is a member of a Steam group
// using the Steam Web API (ISteamUser/GetUserGroupList is per-user; we use
// ISteamUser/GetGroupMembers which is the group-level API).
func checkSteamGroupMembership(baseURL, steamID, apiKey, groupID string) (bool, error) {
	u := baseURL + "?key=" + url.QueryEscape(apiKey) + "&groupid=" + url.QueryEscape(groupID)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(u)
	if err != nil {
		return false, fmt.Errorf("steam group API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("steam group API error: status %d", resp.StatusCode)
	}

	var data steamGroupMembersResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return false, fmt.Errorf("steam group API decode error: %w", err)
	}

	for _, m := range data.Response.Members {
		if m.SteamID == steamID {
			return true, nil
		}
	}
	return false, nil
}
```

**Step 4: Integrate into SteamCallback**

In `SteamCallback` (handler_auth.go), after the role determination (after line 117), add the membership check before issuing the token:

```go
	// In steamGroup mode, check group membership (admins bypass)
	if h.setting.Auth.Mode == "steamGroup" && role != "admin" {
		baseURL := steamGroupAPIBaseURL
		if h.steamAPIBaseURL != "" {
			baseURL = h.steamAPIBaseURL + "/GetGroupMembers"
		}
		isMember, err := checkSteamGroupMembership(baseURL, steamID, h.setting.Auth.SteamAPIKey, h.setting.Auth.SteamGroupID)
		if err != nil {
			log.Printf("WARN: steam group membership check failed for %s: %v", steamID, err)
			h.authRedirect(w, r, "auth_error=membership_check_failed")
			return
		}
		if !isMember {
			h.authRedirect(w, r, "auth_error=not_a_member")
			return
		}
	}
```

Add the constant:
```go
const steamGroupAPIBaseURL = "https://api.steampowered.com/ISteamUser/GetUserGroupList/v1/"
```

Note: The actual Steam Web API endpoint for checking group membership may need adjustment based on Steam's API. The `GetUserGroupList` endpoint returns groups a user belongs to (keyed by user), which may be more practical than fetching all group members. Verify the correct endpoint during implementation.

**Step 5: Run tests**

Run: `go test ./internal/server/ -run TestSteamGroup -v`
Expected: PASS

**Step 6: Commit**

```
feat(auth): add Steam group membership check

In steamGroup mode, non-admin users must be a member of the configured
Steam group. Admins bypass the check to prevent lockout.
```

---

### Task 5: Backend — Squad XML membership check

**Files:**
- Modify: `internal/server/handler_auth.go` (add squad XML fetcher + cache + check in SteamCallback)

**Step 1: Write test for squad XML parsing and membership check**

Add to `handler_auth_test.go`:

```go
func TestSquadXmlMembershipCheck(t *testing.T) {
	squadXml := `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE squad SYSTEM "squad.dtd">
<squad nick="TestGroup">
  <name>Test Group</name>
  <member id="76561198012345678" nick="Player1"></member>
  <member id="76561198099999999" nick="Player2"></member>
</squad>`

	t.Run("member found in squad XML", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/xml")
			w.Write([]byte(squadXml))
		}))
		defer srv.Close()

		checker := newSquadXmlChecker(srv.URL, 0)
		result, err := checker.isMember("76561198012345678")
		assert.NoError(t, err)
		assert.True(t, result)
	})

	t.Run("non-member not found in squad XML", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/xml")
			w.Write([]byte(squadXml))
		}))
		defer srv.Close()

		checker := newSquadXmlChecker(srv.URL, 0)
		result, err := checker.isMember("76561198000000000")
		assert.NoError(t, err)
		assert.False(t, result)
	})

	t.Run("caching avoids refetch", func(t *testing.T) {
		fetchCount := 0
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			fetchCount++
			w.Write([]byte(squadXml))
		}))
		defer srv.Close()

		checker := newSquadXmlChecker(srv.URL, 5*time.Minute)
		checker.isMember("76561198012345678")
		checker.isMember("76561198012345678")
		assert.Equal(t, 1, fetchCount)
	})

	t.Run("zero TTL refetches every time", func(t *testing.T) {
		fetchCount := 0
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			fetchCount++
			w.Write([]byte(squadXml))
		}))
		defer srv.Close()

		checker := newSquadXmlChecker(srv.URL, 0)
		checker.isMember("76561198012345678")
		checker.isMember("76561198012345678")
		assert.Equal(t, 2, fetchCount)
	})

	t.Run("HTTP error returns error", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusNotFound)
		}))
		defer srv.Close()

		checker := newSquadXmlChecker(srv.URL, 0)
		_, err := checker.isMember("76561198012345678")
		assert.Error(t, err)
	})
}
```

**Step 2: Run test to verify it fails**

Run: `go test ./internal/server/ -run TestSquadXml -v`

**Step 3: Implement squadXmlChecker**

Add to `handler_auth.go`:

```go
// squadXmlChecker fetches and caches a remote Arma 3 squad XML,
// then checks membership by Steam ID.
type squadXmlChecker struct {
	url      string
	cacheTTL time.Duration

	mu        sync.Mutex
	members   map[string]bool
	fetchedAt time.Time
}

func newSquadXmlChecker(url string, cacheTTL time.Duration) *squadXmlChecker {
	return &squadXmlChecker{
		url:      url,
		cacheTTL: cacheTTL,
	}
}

// squadXml models the Arma 3 squad.xml format.
type squadXml struct {
	Members []squadXmlMember `xml:"member"`
}

type squadXmlMember struct {
	ID string `xml:"id,attr"`
}

func (c *squadXmlChecker) isMember(steamID string) (bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.members != nil && c.cacheTTL > 0 && time.Since(c.fetchedAt) < c.cacheTTL {
		return c.members[steamID], nil
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(c.url)
	if err != nil {
		return false, fmt.Errorf("squad XML fetch failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("squad XML fetch error: status %d", resp.StatusCode)
	}

	var squad squadXml
	if err := xml.NewDecoder(resp.Body).Decode(&squad); err != nil {
		return false, fmt.Errorf("squad XML parse error: %w", err)
	}

	c.members = make(map[string]bool, len(squad.Members))
	for _, m := range squad.Members {
		c.members[m.ID] = true
	}
	c.fetchedAt = time.Now()

	return c.members[steamID], nil
}
```

Add `"encoding/xml"` and `"sync"` to the imports.

**Step 4: Add squadXmlChecker to Handler and integrate into SteamCallback**

Add field to Handler struct in `handler.go`:
```go
squadXml *squadXmlChecker
```

Initialize in `NewHandler` (after JWT setup, around line 133):
```go
if hdlr.setting.Auth.Mode == "squadXml" {
	hdlr.squadXml = newSquadXmlChecker(hdlr.setting.Auth.SquadXmlURL, hdlr.setting.Auth.SquadXmlCacheTTL)
}
```

Add check in `SteamCallback` (after the steamGroup check):
```go
	// In squadXml mode, check squad XML membership (admins bypass)
	if h.setting.Auth.Mode == "squadXml" && role != "admin" {
		isMember, err := h.squadXml.isMember(steamID)
		if err != nil {
			log.Printf("WARN: squad XML membership check failed for %s: %v", steamID, err)
			h.authRedirect(w, r, "auth_error=membership_check_failed")
			return
		}
		if !isMember {
			h.authRedirect(w, r, "auth_error=not_a_member")
			return
		}
	}
```

**Step 5: Run tests**

Run: `go test ./internal/server/ -run TestSquadXml -v`
Expected: PASS

**Step 6: Commit**

```
feat(auth): add squad XML membership check with caching

In squadXml mode, fetches the remote squad.xml and checks if the
user's Steam ID is listed. Cache TTL is configurable; 0 disables.
```

---

### Task 6: Backend — Expose auth mode via /api/v1/customize

**Files:**
- Modify: `internal/server/handler.go` (extend GetCustomize response)

**Step 1: Write test**

Add to `handler_test.go`:

```go
func TestGetCustomize_IncludesAuthMode(t *testing.T) {
	hdlr := Handler{
		setting: Setting{
			Auth:      Auth{Mode: "steamGroup"},
			Customize: Customize{Enabled: true},
		},
	}
	mockCtx := newMockContext("GET", "/api/v1/customize")
	result, err := hdlr.GetCustomize(mockCtx)
	assert.NoError(t, err)
	assert.Equal(t, "steamGroup", result.AuthMode)
}

func TestGetCustomize_PublicModeDefault(t *testing.T) {
	hdlr := Handler{
		setting: Setting{
			Auth:      Auth{Mode: "public"},
			Customize: Customize{Enabled: true},
		},
	}
	mockCtx := newMockContext("GET", "/api/v1/customize")
	result, err := hdlr.GetCustomize(mockCtx)
	assert.NoError(t, err)
	assert.Equal(t, "public", result.AuthMode)
}
```

**Step 2: Run test to verify it fails**

Run: `go test ./internal/server/ -run TestGetCustomize_IncludesAuthMode -v`

**Step 3: Implement**

The current `GetCustomize` returns `*Customize` directly. We need a response wrapper that includes auth mode. Change the response type:

```go
type CustomizeResponse struct {
	Customize
	AuthMode string `json:"authMode"`
}

func (h *Handler) GetCustomize(c ContextNoBody) (*CustomizeResponse, error) {
	resp := &CustomizeResponse{
		AuthMode: h.setting.Auth.Mode,
	}
	if h.setting.Customize.Enabled {
		resp.Customize = h.setting.Customize
	} else {
		c.SetStatus(http.StatusNoContent)
		return nil, nil
	}
	return resp, nil
}
```

Wait — the current behavior returns 204 No Content when customize is disabled. But we always need the auth mode. Rethink: always return a response, but only populate customize fields when enabled:

```go
type CustomizeResponse struct {
	*Customize `json:"customize,omitempty"`
	AuthMode   string `json:"authMode"`
}

func (h *Handler) GetCustomize(c ContextNoBody) (CustomizeResponse, error) {
	resp := CustomizeResponse{
		AuthMode: h.setting.Auth.Mode,
	}
	if h.setting.Customize.Enabled {
		resp.Customize = &h.setting.Customize
	}
	return resp, nil
}
```

This is a **breaking change** — the endpoint previously returned the `Customize` struct directly (or 204). Now it wraps it. The frontend `useCustomize.tsx` and `apiClient.ts` will need updating in the frontend task. The fuego route type signature also needs updating.

Note: Evaluate whether it's cleaner to add a separate `/api/v1/auth/config` endpoint that returns just `{"mode":"steamGroup"}` instead of modifying `/api/v1/customize`. This avoids the breaking change. **Decision to make during implementation** — either approach works, but a separate endpoint is lower risk.

**Step 4: Run tests and fix any broken customize tests**

Run: `go test ./internal/server/ -run TestGetCustomize -v`
Fix any tests that relied on the old response shape.

**Step 5: Commit**

```
feat(auth): expose auth mode to frontend

Adds authMode field to the customize response (or a new /api/v1/auth/config
endpoint) so the frontend knows which login controls to show.
```

---

### Task 7: Frontend — Add auth mode to API client and useCustomize

**Files:**
- Modify: `ui/src/data/apiClient.ts` (add password login method, update customize types)
- Modify: `ui/src/hooks/useCustomize.tsx` (expose auth mode)

**Step 1: Update API client**

In `apiClient.ts`, add the password login method:

```typescript
async passwordLogin(password: string): Promise<{ token: string }> {
  const resp = await fetch(`${this.base}/api/v1/auth/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!resp.ok) {
    throw new Error(resp.status === 401 ? "Invalid password" : "Login failed");
  }
  return resp.json();
}
```

Update the `CustomizeConfig` type to include `authMode`:

```typescript
export interface CustomizeConfig {
  // ... existing fields ...
  authMode?: string;
}
```

Or if using a separate endpoint:
```typescript
export interface AuthConfig {
  mode: string;
}

async getAuthConfig(): Promise<AuthConfig> {
  const resp = await fetch(`${this.base}/api/v1/auth/config`);
  return resp.json();
}
```

**Step 2: Add auth error messages**

In `useAuth.tsx`, add new error message mappings:

```typescript
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  steam_error: "Steam login failed. Please try again.",
  not_a_member: "You are not a member of this community. Contact an admin for access.",
  membership_check_failed: "Could not verify membership. Please try again later.",
};
```

**Step 3: Commit**

```
feat(auth): add password login and auth mode to frontend API client
```

---

### Task 8: Frontend — Auth-gated UI with login page

**Files:**
- Modify: `ui/src/hooks/useAuth.tsx` (add password login, auth mode awareness)
- Modify: `ui/src/components/AuthBadge.tsx` (show password field in password mode)
- Modify: `ui/src/App.tsx` or `ui/src/main.tsx` (intercept 401 and show login)

**Step 1: Add auth mode to AuthProvider**

In `useAuth.tsx`, fetch auth mode on mount and expose it:

```typescript
const [authMode, setAuthMode] = createSignal<string>("public");

onMount(async () => {
  // Fetch auth config first
  try {
    const config = await api.getAuthConfig();
    setAuthMode(config.mode);
  } catch {
    // Default to public if endpoint fails
  }
  // ... existing token consumption logic ...
});
```

Add `authMode` and `loginWithPassword` to the context:

```typescript
loginWithPassword: async (password: string) => {
  try {
    const resp = await api.passwordLogin(password);
    setAuthToken(resp.token);
    const me = await api.getMe();
    if (me.authenticated) {
      setAuthenticated(true);
      setRole(me.role ?? null);
      // ... set other fields ...
    }
  } catch (err) {
    setAuthError(err instanceof Error ? err.message : "Login failed");
  }
},
```

**Step 2: Update AuthBadge for password mode**

In `AuthBadge.tsx`, when not authenticated and `authMode() === "password"`:

```tsx
<Show when={!auth.authenticated()}>
  <Show when={auth.authMode() === "password"}>
    <form onSubmit={handlePasswordSubmit} class={styles.passwordForm}>
      <input
        type="password"
        placeholder="Enter password"
        value={password()}
        onInput={(e) => setPassword(e.currentTarget.value)}
      />
      <button type="submit">Unlock</button>
    </form>
  </Show>
  <Show when={auth.authMode() !== "password" || true}>
    <button onClick={() => auth.loginWithSteam()} class={styles.signIn}>
      <SteamIcon /> Sign in
    </button>
  </Show>
</Show>
```

In password mode: show password field as primary + Steam button as secondary.
In steam/steamGroup/squadXml modes: show only Steam button.
In public mode: show only Steam button (for admin access).

**Step 3: Handle 401 redirect for direct links**

In `apiClient.ts`, add a global 401 handler for recording endpoints. When a fetch to `/api/v1/operations` or `/data/` returns 401:

```typescript
if (resp.status === 401) {
  sessionStorage.setItem("ocap_return_to", window.location.pathname);
  window.location.href = basePath + "/";
  throw new Error("Authentication required");
}
```

This triggers the existing `ocap_return_to` → login → redirect-back flow.

**Step 4: Write tests**

Add tests to `AuthBadge.test.tsx`:
- Password mode shows password field
- Password mode shows Steam button as secondary
- Steam mode shows only Steam button
- Public mode shows only Steam button

Add tests to `useAuth.test.tsx`:
- `loginWithPassword` success flow
- `loginWithPassword` wrong password shows error
- Auth mode is exposed from provider

**Step 5: Run tests**

Run: `cd ui && npm test`
Expected: PASS

**Step 6: Commit**

```
feat(auth): add auth-gated login UI with password and Steam modes

Shows appropriate login controls based on auth.mode config.
Handles 401 redirect for direct recording links.
```

---

### Task 9: Integration testing and cleanup

**Step 1: Manual integration test matrix**

Test each mode with the dev server:

| Mode | Test |
|------|------|
| `public` | All recordings accessible without login |
| `password` | Recordings blocked → enter password → access granted |
| `steam` | Recordings blocked → Steam login → access granted |
| `steamGroup` | Steam login → member gets access, non-member gets error |
| `squadXml` | Steam login → member gets access, non-member gets error |

For each mode also test:
- Direct link redirect flow (copy recording URL, open in incognito, verify redirect to login then back)
- Admin bypass (admin can access in all modes)
- Upload endpoint still works with secret (not gated)

**Step 2: Run full test suite**

```bash
go test ./...
cd ui && npm test
```

**Step 3: Final commit if any cleanup needed**

```
chore: clean up access control implementation
```

---

## Notes for implementer

- **Steam Group API**: Verify which Steam Web API endpoint is correct for group membership. Options:
  - `ISteamUser/GetUserGroupList/v1/?key=X&steamid=Y` — returns groups a user belongs to (simpler, no pagination)
  - Custom group members endpoint — may require pagination for large groups
  - The user-centric approach (check if user is in group) is likely better than fetching all group members
- **Squad XML format**: Standard Arma 3 format with `<member id="steamid64" nick="name"/>` elements
- **Error codes**: `auth_error=not_a_member` and `auth_error=membership_check_failed` are new values the frontend needs to handle
- **Breaking change**: If `/api/v1/customize` response shape changes, existing frontend code needs updating. Consider a separate `/api/v1/auth/config` endpoint to avoid this.
- **Thread safety**: `squadXmlChecker` uses a mutex for cache access since multiple requests may hit it concurrently.
