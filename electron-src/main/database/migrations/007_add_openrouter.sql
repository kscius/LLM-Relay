-- Add OpenRouter provider
-- Version: 007
-- Description: Add OpenRouter with :free models (50 req/day free tier)

-- Insert OpenRouter provider
INSERT OR IGNORE INTO providers (id, display_name, description, priority) VALUES
  ('openrouter', 'OpenRouter', 'Llama 3.1, Gemma 3, Qwen3 :free models (50 req/day free)', 90);

-- Insert health record for OpenRouter
INSERT OR IGNORE INTO provider_health (provider_id) VALUES ('openrouter');

-- Insert usage limits for OpenRouter (50 requests per day for free tier)
INSERT OR IGNORE INTO provider_limits (provider_id, daily_request_limit, enforce_limits) 
VALUES ('openrouter', 50, 1);

