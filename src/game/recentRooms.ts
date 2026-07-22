/** Browser history of rooms this device has joined. */

export type RecentRoom = {
  code: string;
  lastJoinedAt: number;
};

const KEY = "sfbg-recent-rooms";
const MAX = 12;

export function loadRecentRooms(): RecentRoom[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => {
        if (!x || typeof x !== "object") return null;
        const code = String((x as RecentRoom).code || "")
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "")
          .slice(0, 5);
        const lastJoinedAt = Number((x as RecentRoom).lastJoinedAt) || 0;
        if (code.length < 4) return null;
        return { code, lastJoinedAt };
      })
      .filter((x): x is RecentRoom => x !== null)
      .sort((a, b) => b.lastJoinedAt - a.lastJoinedAt)
      .slice(0, MAX);
  } catch {
    return [];
  }
}

export function rememberRoom(code: string): RecentRoom[] {
  const room = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  if (room.length < 4) return loadRecentRooms();
  const next = [
    { code: room, lastJoinedAt: Date.now() },
    ...loadRecentRooms().filter((r) => r.code !== room),
  ].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore quota
  }
  return next;
}

export function forgetRoom(code: string): RecentRoom[] {
  const room = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  const next = loadRecentRooms().filter((r) => r.code !== room);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export type RoomPresenceInfo = {
  roomId: string;
  status: "lobby" | "playing" | "ended";
  humans: Array<{ name: string; watching?: boolean }>;
  humanCount: number;
};

export async function fetchRoomsPresence(
  codes: string[],
): Promise<Record<string, RoomPresenceInfo>> {
  const unique = [
    ...new Set(
      codes
        .map((c) => c.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5))
        .filter((c) => c.length >= 4),
    ),
  ];
  if (unique.length === 0) return {};

  try {
    const res = await fetch(`/api/rooms?codes=${encodeURIComponent(unique.join(","))}`);
    if (!res.ok) return {};
    const data = (await res.json()) as { rooms?: RoomPresenceInfo[] };
    const map: Record<string, RoomPresenceInfo> = {};
    for (const r of data.rooms ?? []) {
      map[r.roomId] = r;
    }
    return map;
  } catch {
    return {};
  }
}
