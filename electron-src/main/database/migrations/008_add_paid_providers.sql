-- Migration 008: Add paid tier providers
-- Adds OpenAI, Anthropic, Perplexity, Together AI, DeepSeek, and xAI

-- Insert paid providers with balanced priorities
-- These providers compete equally with free tier providers based on health score
INSERT OR IGNORE INTO providers (id, display_name, description, is_enabled, priority) VALUES
('openai', 'OpenAI', 'GPT-4o, GPT-4o-mini - Industry standard', 1, 80),
('anthropic', 'Anthropic', 'Claude 4, Claude 3.5 Sonnet - Best for coding', 1, 85),
('perplexity', 'Perplexity', 'Sonar models - Web-connected AI', 1, 70),
('together', 'Together AI', 'Llama 3.3, Mixtral, Qwen - Fast inference', 1, 75),
('deepseek', 'DeepSeek', 'DeepSeek-V3, Reasoner - Cost effective', 1, 70),
('xai', 'xAI', 'Grok-3, Grok-2 - X/Twitter AI', 1, 75);

-- Initialize health records for new providers
INSERT OR IGNORE INTO provider_health (provider_id, health_score) VALUES
('openai', 1.0),
('anthropic', 1.0),
('perplexity', 1.0),
('together', 1.0),
('deepseek', 1.0),
('xai', 1.0);

