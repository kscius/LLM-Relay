-- Global Facts Schema
-- Version: 003
-- Description: Add global facts table for persistent user information across conversations

-- Global facts table for cross-conversation memory
CREATE TABLE global_facts (
  id TEXT PRIMARY KEY,
  
  -- The fact content
  fact TEXT NOT NULL,
  
  -- Category for organization
  -- preference: user preferences (language, style, tools)
  -- personal: personal info (name, role, location)
  -- project: current project context
  -- technical: technical preferences/constraints
  -- temporary: time-limited facts
  category TEXT NOT NULL DEFAULT 'preference' 
    CHECK (category IN ('preference', 'personal', 'project', 'technical', 'temporary')),
  
  -- Scope: global (all conversations) or conversation-specific
  scope TEXT NOT NULL DEFAULT 'global'
    CHECK (scope IN ('global', 'conversation')),
  
  -- Optional: link to specific conversation (for conversation-scoped facts)
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  
  -- Confidence score (0.0 to 1.0) - how certain we are about this fact
  confidence REAL NOT NULL DEFAULT 0.8,
  
  -- Source tracking
  source_message_id TEXT,  -- message where this fact was extracted
  source_conversation_id TEXT,  -- conversation where this was learned
  
  -- For temporary facts
  expires_at TEXT,
  
  -- Tracking
  is_active INTEGER NOT NULL DEFAULT 1,  -- soft delete / disable
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for efficient queries
CREATE INDEX idx_global_facts_category ON global_facts(category);
CREATE INDEX idx_global_facts_scope ON global_facts(scope);
CREATE INDEX idx_global_facts_conversation ON global_facts(conversation_id);
CREATE INDEX idx_global_facts_active ON global_facts(is_active);
CREATE INDEX idx_global_facts_expires ON global_facts(expires_at);

-- Add some example categories as initial facts (user can delete)
-- These are just placeholders to show the structure

