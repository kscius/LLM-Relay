-- Add Ollama local provider
INSERT OR IGNORE INTO providers (id, display_name, description, is_enabled, priority) VALUES
  ('ollama', 'Ollama (Local)', 'Run models locally - No API key needed, enter Ollama URL or leave empty for localhost', 1, 100);

-- Initialize health record for Ollama
INSERT OR IGNORE INTO provider_health (provider_id, health_score, latency_ewma_ms, circuit_state) VALUES
  ('ollama', 1.0, 0, 'closed');

