# SFboardgames · 6 Nimmt!

Real-time multiplayer **6 Nimmt!** (Take 6!) for you and friends in the browser.

Built on **Cloudflare Pages + Workers** with **PartyServer** (Durable Objects + WebSockets).

## Stack

| Layer | Tech |
| --- | --- |
| Frontend | React + Vite + Tailwind |
| Realtime | [partyserver](https://github.com/cloudflare/partykit) + [partysocket](https://www.npmjs.com/package/partysocket) |
| Hosting | Cloudflare Workers (assets + Durable Object rooms) |
| Rules | Adapted from [boardgamers/take6-engine](https://github.com/boardgamers/take6-engine) (MIT) |

Template pattern from [threepointone/partyvite](https://github.com/threepointone/partyvite).

## Games

| Path | Game |
|------|------|
| `/` | **6 Nimmt!** multiplayer |
| `/mrjack` | **Mr. Jack** — 2-player deduction (local / vs AI). Unofficial fan adaptation. |

## Play (6 Nimmt!)

1. Open the site, enter a name.
2. **Create room** (or enter a friend’s code) and share the code / invite link.
3. Host clicks **Start game** (2–10 players).
4. Each turn: everyone picks a card face-down → cards reveal low-to-high and place on rows.
5. Taking a 6th card (or choosing a row when your card is too low) scores bull heads. When someone reaches **66** (or more), **finish the current deal** (play out remaining cards), then stop. **Lowest** bull-head total wins; highest loses the race.

### Solo vs AI

- Home → **Play solo vs AI (3 bots)**, or in lobby use **+ AI bot**.
- With `GEMINI_API_KEY`, bots call **Gemini** (`gemini-2.5-flash`) for card/row choices.
- Without a key, bots fall back to a local heuristic (still fully playable).

## Develop

```bash
npm install
cp .dev.vars.example .dev.vars   # paste GEMINI_API_KEY=
npm run dev
```

Then open the local URL Vite prints (usually `http://localhost:5173`).

## Deploy

**Play URL (Pages):** https://nimmt6.pages.dev  

(`6nimmt` as a project name gets a ugly `*.pages.dev` suffix because it starts with a digit — `nimmt6` is the clean short name.)

```bash
npx wrangler login   # once
npx wrangler secret put GEMINI_API_KEY   # on Worker sfboardgames
npm run deploy:all   # Worker (rooms) + Pages (short URL)
```

Architecture:

| Piece | Where |
| --- | --- |
| UI + short domain | Cloudflare **Pages** `nimmt6` → https://nimmt6.pages.dev |
| Game rooms (WebSockets + Durable Objects) | Cloudflare **Worker** `sfboardgames` |
| Pages → Worker | Service binding `GAME` proxies `/parties/*` |

Also available: https://sfboardgames.dalrae-jin-work.workers.dev  

Custom domain (optional): Pages project → Custom domains in the dashboard.

## Project layout

```
src/
  client.tsx          # React UI
  server.ts           # PartyServer GameRoom (authoritative)
  game/               # Rules (take6-engine port)
  components/         # Lobby, board, cards
```

## License

MIT. Game rules © their respective owners; this is an unofficial fan project.
