-- Provider Usage Tracking Schema
-- Version: 006
-- Description: Track daily usage for providers with free tier limits

-- Usage tracking table
CREATE TABLE IF NOT EXISTS provider_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  
  -- Date of usage (YYYY-MM-DD format, UTC)
  usage_date TEXT NOT NULL,
  
  -- Usage metrics
  request_count INTEGER NOT NULL DEFAULT 0,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  neurons_used INTEGER NOT NULL DEFAULT 0,  -- Cloudflare-specific
  
  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  UNIQUE(provider_id, usage_date)
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_provider_usage_date ON provider_usage(provider_id, usage_date);

-- Provider limits configuration
CREATE TABLE IF NOT EXISTS provider_limits (
  provider_id TEXT PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
  
  -- Daily limits (0 = unlimited)
  daily_request_limit INTEGER NOT NULL DEFAULT 0,
  daily_token_limit INTEGER NOT NULL DEFAULT 0,
  daily_neuron_limit INTEGER NOT NULL DEFAULT 0,
  
  -- Whether to enforce limits (lock when exceeded)
  enforce_limits INTEGER NOT NULL DEFAULT 1,
  
  -- Reset time (hour in UTC, 0-23)
  reset_hour_utc INTEGER NOT NULL DEFAULT 0,
  
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Insert default limits for Cloudflare (10k Neurons/day)
INSERT OR IGNORE INTO provider_limits (provider_id, daily_neuron_limit, enforce_limits) 
VALUES ('cloudflare', 10000, 1);

