-- nimmt6 analytics: who / when / what room / what game

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  event TEXT NOT NULL,
  room_id TEXT NOT NULL,
  player_name TEXT,
  player_id TEXT,
  role TEXT,
  game TEXT NOT NULL DEFAULT '6nimmt',
  meta_json TEXT,
  game_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_event ON events(event);
CREATE INDEX IF NOT EXISTS idx_events_room ON events(room_id);
CREATE INDEX IF NOT EXISTS idx_events_player ON events(player_name);
CREATE INDEX IF NOT EXISTS idx_events_game_id ON events(game_id);

CREATE TABLE IF NOT EXISTS games (
  game_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL DEFAULT 'playing',
  human_count INTEGER NOT NULL DEFAULT 0,
  bot_count INTEGER NOT NULL DEFAULT 0,
  player_count INTEGER NOT NULL DEFAULT 0,
  tight_deck INTEGER NOT NULL DEFAULT 1,
  ai_style TEXT,
  host_name TEXT,
  player_names_json TEXT,
  winner_names_json TEXT,
  loser_names_json TEXT,
  scores_json TEXT,
  deals INTEGER,
  duration_ms INTEGER,
  meta_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_games_started ON games(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_room ON games(room_id);
