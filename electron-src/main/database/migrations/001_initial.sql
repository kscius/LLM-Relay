-- LLM Relay Initial Schema
-- Version: 001
-- Description: Create core tables for conversations, messages, providers, and settings

-- Conversations table
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New Chat',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  message_count INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_conversations_updated_at ON conversations(updated_at DESC);
CREATE INDEX idx_conversations_archived ON conversations(is_archived);

-- Messages table
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  provider_id TEXT,
  model TEXT,
  tokens INTEGER,
  latency_ms INTEGER,
  error_type TEXT,
  is_regenerated INTEGER NOT NULL DEFAULT 0,
  parent_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX idx_messages_provider ON messages(provider_id);

-- Providers table (metadata, not keys)
CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Provider keys table (stores encrypted keys)
CREATE TABLE provider_keys (
  provider_id TEXT PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
  api_key_encrypted TEXT NOT NULL,
  key_hint TEXT, -- Last 4 chars for display
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Provider health table
CREATE TABLE provider_health (
  provider_id TEXT PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
  health_score REAL NOT NULL DEFAULT 1.0,
  latency_ewma_ms REAL NOT NULL DEFAULT 500.0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_success_at TEXT,
  last_failure_at TEXT,
  last_error_type TEXT,
  circuit_state TEXT NOT NULL DEFAULT 'closed' CHECK (circuit_state IN ('closed', 'open', 'half_open')),
  circuit_opened_at TEXT,
  cooldown_until TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Router events table (for debugging and analytics)
CREATE TABLE router_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('attempt', 'success', 'failure', 'fallback', 'exhaust')),
  provider_id TEXT,
  attempt_number INTEGER,
  latency_ms INTEGER,
  error_type TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_router_events_created ON router_events(created_at DESC);
CREATE INDEX idx_router_events_provider ON router_events(provider_id, created_at DESC);

-- Settings table (key-value store)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Models cache table (for dynamic model lists)
CREATE TABLE models_cache (
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  display_name TEXT,
  context_length INTEGER,
  is_available INTEGER NOT NULL DEFAULT 1,
  cached_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  PRIMARY KEY (provider_id, model_id)
);

CREATE INDEX idx_models_cache_provider ON models_cache(provider_id);
CREATE INDEX idx_models_cache_expires ON models_cache(expires_at);

-- Insert default providers (only free tier providers)
INSERT INTO providers (id, display_name, description, priority) VALUES
  ('google', 'Google AI', 'Gemini 2.0 Flash, Gemini Pro (Free tier)', 100),
  ('mistral', 'Mistral AI', 'Mistral Large, Medium, Codestral', 95),
  ('groq', 'Groq', 'Llama 3, Mixtral - Ultra fast (Free tier)', 95),
  ('cohere', 'Cohere', 'Command R+, Command R (Free trial)', 85),
  ('nvidia', 'NVIDIA NIM', 'Llama, Mistral, Qwen (Free tier)', 90),
  ('cerebras', 'Cerebras', 'Llama 3.1/3.3 - Ultra fast (Free tier)', 90),
  ('cloudflare', 'Cloudflare Workers AI', 'GPT-OSS, Llama 4/3.3/3.1, Granite, Mistral - Edge inference (10k Neurons/day free)', 85),
  ('openrouter', 'OpenRouter', 'Llama 3.1, Gemma 3, Qwen3 :free models (50 req/day free)', 90);

-- Insert default health records
INSERT INTO provider_health (provider_id) 
SELECT id FROM providers;

-- Insert default settings
INSERT INTO settings (key, value) VALUES
  ('showProviderBadge', 'true'),
  ('theme', 'dark');

-- Trigger to update conversation updated_at and message_count
CREATE TRIGGER update_conversation_on_message_insert
AFTER INSERT ON messages
BEGIN
  UPDATE conversations 
  SET 
    updated_at = datetime('now'),
    message_count = message_count + 1,
    total_tokens = total_tokens + COALESCE(NEW.tokens, 0)
  WHERE id = NEW.conversation_id;
END;

-- Trigger to update conversation on message delete
CREATE TRIGGER update_conversation_on_message_delete
AFTER DELETE ON messages
BEGIN
  UPDATE conversations 
  SET 
    updated_at = datetime('now'),
    message_count = message_count - 1,
    total_tokens = total_tokens - COALESCE(OLD.tokens, 0)
  WHERE id = OLD.conversation_id;
END;

