-- Remove OpenAI provider (no free tier available)
-- Version: 004
-- Description: Remove OpenAI from providers as it doesn't offer a free tier

-- Remove OpenAI provider (cascades to provider_keys and provider_health)
DELETE FROM provider_keys WHERE provider_id = 'openai';
DELETE FROM provider_health WHERE provider_id = 'openai';
DELETE FROM providers WHERE id = 'openai';

