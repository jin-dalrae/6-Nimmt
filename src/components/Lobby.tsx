import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { AI_STYLES, type AiStyle } from "../game/ai";
import type { LobbyPlayer, SpectatorInfo } from "../game/protocol";

type Props = {
  roomId: string;
  players: LobbyPlayer[];
  spectators?: SpectatorInfo[];
  hostId: string | null;
  youId: string;
  maxPlayers: number;
  hasAiKey: boolean;
  aiStyle: AiStyle;
  onStart: () => void;
  onAddBots: (count: number) => void;
  onRemoveBot: () => void;
  onSetAiStyle: (style: AiStyle) => void;
  onSetBotAiStyle: (botId: string, style: AiStyle) => void;
  tightDeck: boolean;
  onSetTightDeck: (tight: boolean) => void;
  onLeave: () => void;
};

export function Lobby({
  roomId,
  players,
  spectators = [],
  hostId,
  youId,
  maxPlayers,
  hasAiKey,
  aiStyle,
  onStart,
  onAddBots,
  onRemoveBot,
  onSetAiStyle,
  onSetBotAiStyle,
  tightDeck,
  onSetTightDeck,
  onLeave,
}: Props) {
  const isHost = youId === hostId;
  const botCount = players.filter((p) => p.isBot).length;
  const canStart = isHost && players.length >= 2;
  const canAddBot = isHost && players.length < maxPlayers;
  const deckTop = players.length * 10 + 4;
  const styleMeta = AI_STYLES.find((s) => s.id === aiStyle) ?? AI_STYLES[1];
  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}${window.location.pathname}?room=${roomId}`
      : roomId;
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <div className="felt-panel w-full max-w-lg p-6 sm:p-8">
      <p className="mb-4 text-center text-sm text-emerald-100/60">
        Room{" "}
        <span className="font-mono font-semibold tracking-widest text-amber-300">{roomId}</span>
      </p>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-emerald-100/80">
        Players ({players.length}/{maxPlayers})
      </h2>
      <ul className="mb-4 space-y-2">
        {players.map((p) => (
          <li
            key={p.id}
            className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2"
          >
            <span>
              {p.isBot ? "🤖 " : ""}
              {p.name}
              {p.id === youId ? (
                <span className="ml-2 text-xs text-amber-300">(you)</span>
              ) : null}
              {p.id === hostId ? (
                <span className="ml-2 text-xs text-emerald-300">host</span>
              ) : null}
              {p.isBot ? (
                <span className="ml-2 text-xs text-sky-300">AI</span>
              ) : null}
            </span>
            {p.isBot ? (
              isHost ? (
                <select
                  className="rounded-lg border border-sky-400/30 bg-black/40 px-2 py-1 text-xs text-sky-100 outline-none"
                  value={p.aiStyle ?? aiStyle}
                  onChange={(e) => onSetBotAiStyle(p.id, e.target.value as AiStyle)}
                  aria-label={`${p.name} difficulty`}
                >
                  {AI_STYLES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                      {hasAiKey ? " · Gemini" : " · local"}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-xs text-sky-400">
                  {(AI_STYLES.find((s) => s.id === (p.aiStyle ?? aiStyle)) ?? styleMeta).label}
                  {hasAiKey ? " · Gemini" : " · local"}
                </span>
              )
            ) : (
              <span className={`text-xs ${p.connected ? "text-emerald-400" : "text-slate-400"}`}>
                {p.connected ? "online" : "away"}
              </span>
            )}
          </li>
        ))}
      </ul>

      {spectators.length > 0 ? (
        <div className="mb-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-emerald-100/80">
            Waiting for a seat ({spectators.length})
          </h2>
          <ul className="space-y-1.5">
            {spectators.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between rounded-lg bg-sky-950/30 px-3 py-2 text-sm ring-1 ring-sky-400/20"
              >
                <span>
                  👁 {s.name}
                  {s.id === youId ? (
                    <span className="ml-2 text-xs text-amber-300">(you)</span>
                  ) : null}
                </span>
                <span className="text-xs text-sky-300/80">next game</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-emerald-100/45">
            Room was full after the last game — seats free up if someone leaves.
          </p>
        </div>
      ) : null}

      {isHost ? (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canAddBot}
            onClick={() => onAddBots(1)}
            className="rounded-lg border border-sky-400/40 bg-sky-500/10 px-3 py-1.5 text-sm text-sky-100 hover:bg-sky-500/20 disabled:opacity-40"
          >
            + AI bot
          </button>
          <button
            type="button"
            disabled={!canAddBot || players.length + 3 > maxPlayers}
            onClick={() => onAddBots(3)}
            className="rounded-lg border border-sky-400/40 bg-sky-500/10 px-3 py-1.5 text-sm text-sky-100 hover:bg-sky-500/20 disabled:opacity-40"
          >
            + 3 bots
          </button>
          <button
            type="button"
            disabled={botCount === 0}
            onClick={onRemoveBot}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-emerald-100/80 hover:bg-white/5 disabled:opacity-40"
          >
            − Remove bot
          </button>
        </div>
      ) : null}

      <div className="mb-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-emerald-100/80">
          Deck
        </h2>
        <button
          type="button"
          disabled={!isHost}
          onClick={() => onSetTightDeck(!tightDeck)}
          className={`flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition ${
            tightDeck
              ? "border-amber-300/70 bg-amber-400/15 ring-1 ring-amber-300/40"
              : "border-white/10 bg-black/20 hover:bg-white/5"
          } disabled:opacity-60`}
        >
          <span
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${
              tightDeck
                ? "border-amber-300 bg-amber-400 text-slate-900"
                : "border-white/25 text-transparent"
            }`}
            aria-hidden
          >
            ✓
          </span>
          <span>
            <span className="block text-sm font-semibold text-emerald-50">Tight deck</span>
            <span className="mt-0.5 block text-xs leading-snug text-emerald-100/55">
              {tightDeck
                ? `On — only cards 1–${deckTop} (10×${players.length} players + 4 row starters). Denser, more collisions.`
                : "Off — full official deck 1–104."}
            </span>
          </span>
        </button>
        {!isHost ? (
          <p className="mt-1.5 text-xs text-emerald-100/45">Host chooses deck mode before start.</p>
        ) : null}
      </div>

      <div className="mb-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-emerald-100/80">
          Default bot level
        </h2>
        <p className="mb-2 text-xs text-emerald-100/50">
          Each bot can use a different level in the list above. This sets all bots at once.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {AI_STYLES.map((s) => {
            const selected = aiStyle === s.id;
            return (
              <button
                key={s.id}
                type="button"
                disabled={!isHost}
                onClick={() => onSetAiStyle(s.id)}
                className={`rounded-xl border px-3 py-2.5 text-left transition ${
                  selected
                    ? "border-amber-300/70 bg-amber-400/15 ring-1 ring-amber-300/40"
                    : "border-white/10 bg-black/20 hover:bg-white/5"
                } disabled:opacity-60`}
              >
                <div className="text-sm font-semibold text-emerald-50">{s.label}</div>
                <div className="mt-0.5 text-xs leading-snug text-emerald-100/55">{s.blurb}</div>
              </button>
            );
          })}
        </div>
        {!isHost ? (
          <p className="mt-2 text-xs text-emerald-100/45">Host sets bot levels.</p>
        ) : null}
      </div>

      <p className="mb-2 text-sm leading-relaxed text-emerald-100/70">
        Solo: add AI bots and start with just you. With friends: share the code — mix humans and
        bots freely. Bots pause briefly so you can follow the table.
      </p>
      <p className="mb-4 text-xs text-emerald-100/50">
        {hasAiKey
          ? "Gemini key on — style shapes prompts + temperature."
          : "No GEMINI_API_KEY — style still changes the local heuristic."}
      </p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          disabled={!canStart}
          onClick={onStart}
          className="flex-1 rounded-xl bg-amber-400 px-4 py-3 font-semibold text-slate-900 hover:bg-amber-300 disabled:bg-slate-600 disabled:text-slate-300"
        >
          {isHost
            ? players.length < 2
              ? "Add a bot or wait for a friend…"
              : "Start game"
            : "Waiting for host…"}
        </button>
        <button
          type="button"
          onClick={onLeave}
          className="rounded-xl border border-white/20 px-4 py-3 text-emerald-100 hover:bg-white/5"
        >
          Leave
        </button>
      </div>

      {/* Invite block — below actions so play controls stay first */}
      <div className="mt-6 border-t border-white/10 pt-5 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-emerald-200/70">Room code</p>
        <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row sm:justify-center sm:gap-6">
          <div>
            <p className="font-mono text-4xl font-bold tracking-widest text-amber-300 sm:text-5xl">
              {roomId}
            </p>
            <p className="mt-2 max-w-[14rem] break-all text-[0.7rem] leading-snug text-emerald-100/45">
              Scan to join · or enter the code
            </p>
          </div>
          <div className="rounded-2xl bg-white p-3 shadow-lg ring-1 ring-black/10">
            <QRCodeSVG
              value={shareUrl}
              size={148}
              level="M"
              marginSize={1}
              bgColor="#ffffff"
              fgColor="#0f172a"
              title={`Join room ${roomId}`}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={copyLink}
          className="mt-4 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-sm text-emerald-100 hover:bg-white/10"
        >
          {copied ? "Link copied!" : "Copy invite link"}
        </button>
      </div>
    </div>
  );
}
