-- Add Cloudflare Workers AI provider
-- Version: 005
-- Description: Add Cloudflare Workers AI with 10k Neurons/day free tier

-- Insert Cloudflare provider
INSERT OR IGNORE INTO providers (id, display_name, description, priority) VALUES
  ('cloudflare', 'Cloudflare Workers AI', 'GPT-OSS, Llama 4/3.3/3.1, Granite, Mistral - Edge inference (10k Neurons/day free)', 85);

-- Insert health record for Cloudflare
INSERT OR IGNORE INTO provider_health (provider_id) VALUES ('cloudflare');

