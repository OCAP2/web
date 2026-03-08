# Access Control Design

## Overview

Site-wide access control for OCAP2-Web instances. Allows community operators to restrict who can view recordings via a single config mode. Builds on the existing role-based auth foundation (PR #311).

## Mode System

Single `auth.mode` config value. Default `public` (current behavior).

| Mode | Description |
|------|-------------|
| `public` | No restrictions. Current behavior. |
| `password` | Shared viewer password. |
| `steam` | Any Steam account can view. |
| `steamAllowlist` | Steam login + admin-managed allowlist of Steam IDs. |

All non-public modes issue a JWT with `viewer` role on successful authentication.

## Gate Behavior

### Protected Endpoints
- `/api/v1/operations*` — recording list, metadata, marker blacklist
- `/api/v1/worlds` — installed world metadata
- `/data/*` — recording data files

### Always Public
- Static assets (`/static/*`)
- Map tiles (`/images/maps/*`)
- `/api/healthcheck`
- `/api/version`
- `/api/v1/customize`
- `/api/v1/auth/*` — login/callback/me endpoints
- `/api/v1/operations/add` — upload endpoint (has own `secret` auth)

### Unauthenticated Flow
1. User hits protected endpoint → 401
2. Frontend intercepts 401, saves current path to `sessionStorage` (`ocap_return_to`)
3. Redirect to login page
4. User authenticates via mode-appropriate method
5. JWT issued, redirect back to saved path

## Per-Mode Auth Flow

### `public`
No gate. Optional Steam login for admin access.

### `password`
1. User enters shared password on login page
2. Backend validates password against `auth.password` config (timing-safe comparison)
3. JWT issued with `viewer` role, subject `password`

### `steam`
1. User clicks Steam login button
2. Standard Steam OpenID flow
3. JWT issued with `viewer` role (or `admin` if in `adminSteamIds`)

### `steamAllowlist`
1. User clicks Steam login button
2. Steam OpenID flow completes, Steam ID obtained
3. Backend checks if Steam ID is in `steam_allowlist` SQLite table
4. **Admins bypass** — users in `adminSteamIds` always get `admin` role regardless of allowlist
5. **On allowlist** → JWT issued with `viewer` role
6. **Not on allowlist** → no token issued, redirect with `auth_error=not_allowed`

Admins manage the allowlist via API:
- `GET /api/v1/auth/allowlist` — list all allowed Steam IDs
- `PUT /api/v1/auth/allowlist/{steamId}` — add (idempotent)
- `DELETE /api/v1/auth/allowlist/{steamId}` — remove

## Admin Bypass

Users whose Steam ID is in `adminSteamIds` always pass the gate regardless of mode. This prevents admin lockout.

## Login UI

| Mode | Primary Action | Secondary Action |
|------|---------------|-----------------|
| `public` | — | Steam button (admin) |
| `password` | Password field + submit | Steam button (admin) |
| `steam` | Steam button | — |
| `steamAllowlist` | Steam button | — |

## Configuration

```json
"auth": {
  "mode": "public",
  "sessionTTL": "24h",
  "adminSteamIds": ["76561198000074241"],
  "steamApiKey": "",
  "password": ""
}
```

Fields only relevant to the active mode are ignored.

## Startup Validation

Server validates on start that required config values for the active mode are present.

| Mode | Required |
|------|----------|
| `public` | — |
| `password` | `password` |
| `steam` | — |
| `steamAllowlist` | — |

## Storage

The `steam_allowlist` table (migration v11) stores allowed Steam IDs:

```sql
CREATE TABLE steam_allowlist (
    steam_id TEXT NOT NULL PRIMARY KEY
);
```

## Future Compatibility

Per-recording visibility (public/restricted/private per recording) is a separate layer that can be added later. Site-wide gate is middleware-level; per-recording is endpoint-level logic. No conflicts.
