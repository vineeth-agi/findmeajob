-- Apply to the D1 database bound as AUTH_DB. Counts are keyed by Better Auth's stable user ID and
-- an ISO UTC calendar day. No prompt or response content is stored.

CREATE TABLE IF NOT EXISTS ai_chat_daily_usage (
  user_id TEXT NOT NULL,
  day_utc TEXT NOT NULL,
  successful_count INTEGER NOT NULL DEFAULT 0 CHECK (successful_count >= 0 AND successful_count <= 200),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, day_utc),
  CHECK (length(day_utc) = 10),
  FOREIGN KEY (user_id) REFERENCES auth_user (id) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS ai_chat_quota_reservations (
  reservation_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  day_utc TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  CHECK (length(day_utc) = 10),
  CHECK (expires_at > created_at),
  FOREIGN KEY (user_id) REFERENCES auth_user (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ai_chat_quota_reservations_user_day_expiry
  ON ai_chat_quota_reservations (user_id, day_utc, expires_at);
