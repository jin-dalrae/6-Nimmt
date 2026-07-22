/**
 * Cloudflare Pages advanced-mode worker.
 * Proxies realtime PartyServer routes to the sfboardgames Worker
 * (Durable Objects + game logic). Serves the SPA from Pages assets.
 */
type Env = {
  GAME: Fetcher;
  ASSETS: Fetcher;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Realtime rooms + presence API live on the Worker that owns GameRoom DOs
    if (url.pathname.startsWith("/parties/") || url.pathname.startsWith("/api/")) {
      // Preserve path/query; service binding handles WebSocket upgrades
      return env.GAME.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
