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
| `steamGroup` | Steam login + Steam group membership required. |
| `squadXml` | Steam login + UID present in remote squad XML required. |

All non-public modes issue a JWT with `viewer` role on successful authentication.

## Gate Behavior

### Protected Endpoints
- `/api/v1/operations*` — recording list, metadata, marker blacklist
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
2. Backend validates password against `auth.password` config
3. JWT issued with `viewer` role

### `steam`
1. User clicks Steam login button
2. Standard Steam OpenID flow
3. JWT issued with `viewer` role (or `admin` if in `adminSteamIds`)

### `steamGroup`
1. User clicks Steam login button
2. Steam OpenID flow completes, Steam ID obtained
3. Backend checks group membership via Steam Web API (`steamApiKey` + `steamGroupId`)
4. **Member** → JWT issued with `viewer` role
5. **Not a member** → no token issued, error message, redirect to login

### `squadXml`
1. User clicks Steam login button
2. Steam OpenID flow completes, Steam ID obtained
3. Backend fetches squad XML from `squadXmlUrl` (cached per `squadXmlCacheTTL`)
4. Checks if Steam UID is present in the XML
5. **Found** → JWT issued with `viewer` role
6. **Not found** → no token issued, error message, redirect to login

## Admin Bypass

Users whose Steam ID is in `adminSteamIds` always pass the gate regardless of mode. This prevents admin lockout (e.g. admin not in Steam group or squad XML).

## Login UI

| Mode | Primary Action | Secondary Action |
|------|---------------|-----------------|
| `public` | — | Steam button (admin) |
| `password` | Password field + submit | Steam button (admin) |
| `steam` | Steam button | — |
| `steamGroup` | Steam button | — |
| `squadXml` | Steam button | — |

Visual lock icon or indicator when instance is restricted (non-public mode).

## Configuration

```json
"auth": {
  "mode": "public",
  "sessionTTL": "24h",
  "adminSteamIds": ["76561198000074241"],
  "steamApiKey": "...",
  "password": "viewer-password-here",
  "steamGroupId": "103582791460XXXXX",
  "squadXmlUrl": "https://example.com/squad.xml",
  "squadXmlCacheTTL": "5m"
}
```

Fields only relevant to the active mode are ignored.

## Startup Validation

Server validates on start that required config values for the active mode are present. Missing required values are fatal errors. Optional warnings for edge cases.

| Mode | Required | Warnings |
|------|----------|----------|
| `public` | — | — |
| `password` | `password` | — |
| `steam` | — | — |
| `steamGroup` | `steamApiKey`, `steamGroupId` | — |
| `squadXml` | `steamApiKey`, `squadXmlUrl` | `squadXmlCacheTTL=0` → "caching disabled, fetching on every login" |

## Future Compatibility

Per-recording visibility (public/restricted/private per recording) is a separate layer that can be added later. Site-wide gate is middleware-level; per-recording is endpoint-level logic. No conflicts.
