-- Add system_prompt setting (no migration needed, settings table uses key-value)
-- This migration is a placeholder to document that systemPrompt is now stored in settings

-- Ensure settings table exists (should already exist from 001_initial.sql)
-- INSERT OR IGNORE INTO settings (key, value) VALUES ('systemPrompt', '');

