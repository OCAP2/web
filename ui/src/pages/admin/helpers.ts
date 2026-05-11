export const STEAM_ID_RE = /^7656119\d{10}$/;

export function isValidSteamId(id: string): boolean {
  return STEAM_ID_RE.test(id.trim());
}

export function hueFromSteamId(steamId: string): number {
  let hash = 0;
  for (let i = 0; i < steamId.length; i++) {
    hash = (hash * 31 + steamId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

export function initialFromSteamId(steamId: string): string {
  return steamId.slice(-1).toUpperCase();
}
