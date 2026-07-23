/** Per-room seat tokens — reclaim the same player/spectator after reconnect. */

const PREFIX = "sfbg-session:";

function key(room: string): string {
  const code = room.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  return `${PREFIX}${code}`;
}

export function loadSessionToken(room: string): string | undefined {
  try {
    const t = localStorage.getItem(key(room));
    return t && t.length >= 8 ? t : undefined;
  } catch {
    return undefined;
  }
}

export function saveSessionToken(room: string, token: string): void {
  try {
    localStorage.setItem(key(room), token);
  } catch {
    // ignore quota / private mode
  }
}

export function clearSessionToken(room: string): void {
  try {
    localStorage.removeItem(key(room));
  } catch {
    // ignore
  }
}
