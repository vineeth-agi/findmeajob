-- Supports cleanup of expired reservations across UTC days for one user.
CREATE INDEX IF NOT EXISTS ai_chat_quota_reservations_user_expiry
  ON ai_chat_quota_reservations (user_id, expires_at);
