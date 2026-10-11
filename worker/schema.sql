PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY, value TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, value TEXT NOT NULL,
  revision TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS episodes_expiry ON episodes(expires_at);
CREATE TABLE IF NOT EXISTS deliveries (
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  revision TEXT NOT NULL,
  PRIMARY KEY(subscription_id, episode_id)
);
CREATE TABLE IF NOT EXISTS source_status (
  source TEXT PRIMARY KEY, checked_at TEXT NOT NULL,
  last_success TEXT, error TEXT
);
CREATE TABLE IF NOT EXISTS checks (hour TEXT PRIMARY KEY, started_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS test_requests (
  subscription_id TEXT PRIMARY KEY REFERENCES subscriptions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
