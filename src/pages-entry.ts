/**
 * Cloudflare Pages advanced-mode worker.
 * Proxies realtime PartyServer routes to the sfboardgames Worker
 * (Durable Objects + game logic). Serves the SPA from Pages assets.
 */
type Env = {
  GAME: Fetcher;
  ASSETS: Fetcher;
};

function isSpaNavigation(request: Request, pathname: string): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  // Static assets always have a file extension; client routes do not
  const last = pathname.split("/").pop() || "";
  if (last.includes(".")) return false;
  return true;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Realtime rooms + presence API live on the Worker that owns GameRoom DOs
    if (url.pathname.startsWith("/parties/") || url.pathname.startsWith("/api/")) {
      return env.GAME.fetch(request);
    }

    // Try static asset first
    const assetRes = await env.ASSETS.fetch(request);

    // SPA client routes (e.g. /mrjack) — always serve index.html when no file
    if (assetRes.status === 404 && isSpaNavigation(request, url.pathname)) {
      return env.ASSETS.fetch(new URL("/index.html", url.origin));
    }

    return assetRes;
  },
};
