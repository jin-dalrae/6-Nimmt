import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { AI_STYLES, type AiStyle } from "../game/ai";
import type { LobbyPlayer } from "../game/protocol";

type Props = {
  roomId: string;
  players: LobbyPlayer[];
  hostId: string | null;
  youId: string;
  maxPlayers: number;
  hasAiKey: boolean;
  aiStyle: AiStyle;
  onStart: () => void;
  onAddBots: (count: number) => void;
  onRemoveBot: () => void;
  onSetAiStyle: (style: AiStyle) => void;
  onLeave: () => void;
};

export function Lobby({
  roomId,
  players,
  hostId,
  youId,
  maxPlayers,
  hasAiKey,
  aiStyle,
  onStart,
  onAddBots,
  onRemoveBot,
  onSetAiStyle,
  onLeave,
}: Props) {
  const isHost = youId === hostId;
  const botCount = players.filter((p) => p.isBot).length;
  const canStart = isHost && players.length >= 2;
  const canAddBot = isHost && players.length < maxPlayers;
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
      <div className="mb-6 text-center">
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
            <span
              className={`text-xs ${
                p.isBot
                  ? "text-sky-400"
                  : p.connected
                    ? "text-emerald-400"
                    : "text-slate-400"
              }`}
            >
              {p.isBot
                ? hasAiKey
                  ? `Gemini · ${styleMeta.label}`
                  : `heuristic · ${styleMeta.label}`
                : p.connected
                  ? "online"
                  : "away"}
            </span>
          </li>
        ))}
      </ul>

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
          How well should Gemini play?
        </h2>
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
          <p className="mt-2 text-xs text-emerald-100/45">Host picks AI style for the table.</p>
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
    </div>
  );
}
