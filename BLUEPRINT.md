# LLM Relay – Project Blueprint

> **Version:** 0.1.0-draft  
> **License:** Apache-2.0  
> **Status:** Design Phase  

---

## 1. Product Definition

**LLM Relay** is a privacy-first, cross-platform desktop application that provides a ChatGPT-like conversational interface backed by multiple LLM API providers. Users supply their own API keys; the application automatically routes messages across configured providers for reliability, with intelligent fallback, health scoring, and circuit breakers—while strictly respecting each provider's rate limits and terms of service. All data (chat history, keys, metrics) is stored locally in SQLite; no telemetry is sent anywhere.

### Non-Goals

| What LLM Relay is **NOT** | Reason |
|---------------------------|--------|
| A free/unlimited AI service | Users pay for their own API usage |
| A rate-limit bypass tool | Respects 429s with proper backoff |
| A key-sharing or pooling platform | Single-user, single-machine |
| A web or cloud service | Desktop-only, no server component |
| A model fine-tuning/training tool | Inference only |

---

## 2. Architecture Overview

### 2.1 Process Model

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              Electron Main Process                        │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌──────────────┐  │
│  │   SQLite    │   │  Provider   │   │   Router    │   │ IPC Handlers │  │
│  │ (better-    │◄──│  Adapters   │◄──│  (health,   │◄──│ (chat, conv, │  │
│  │  sqlite3)   │   │ (OpenAI,    │   │  circuit,   │   │  providers,  │  │
│  │             │   │  Anthropic, │   │  cooldown)  │   │  settings)   │  │
│  │             │   │  Google...) │   │             │   │              │  │
│  └─────────────┘   └─────────────┘   └─────────────┘   └──────┬───────┘  │
│        ▲                                                      │          │
│        │                  API Keys in memory only             │          │
└────────┼──────────────────────────────────────────────────────┼──────────┘
         │                                                      │
         │  contextBridge                                       │ IPC
         │                                                      │
┌────────┴──────────────────────────────────────────────────────┴──────────┐
│                              Preload Script                              │
│                    Exposes typed IPC API via window.api                  │
└────────────────────────────────────────────────────────────────┬─────────┘
                                                                 │
                                                                 │ invoke / on
                                                                 │
┌────────────────────────────────────────────────────────────────┴─────────┐
│                           Renderer Process (React)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  ChatPage    │  │SettingsPage  │  │  AboutPage   │  │  Components  │  │
│  │              │  │              │  │              │  │  (Sidebar,   │  │
│  │              │  │              │  │              │  │   Messages)  │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                                          │
│  Vite + React + Tailwind + React Router + Zustand                        │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.2 IPC Channel Specification

| Channel | Direction | Payload (Request) | Payload (Response) |
|---------|-----------|-------------------|-------------------|
| `chat:send` | Renderer→Main | `{ conversationId: string, content: string }` | Stream of `StreamChunk` \| `GenerateResponse` via callback |
| `chat:regenerate` | Renderer→Main | `{ conversationId: string, messageId: string }` | Stream (same as above) |
| `chat:cancel` | Renderer→Main | `{ conversationId: string }` | `{ success: boolean }` |
| `conversation:list` | Renderer→Main | `{ limit?: number, offset?: number }` | `Conversation[]` |
| `conversation:create` | Renderer→Main | `{ title?: string }` | `Conversation` |
| `conversation:get` | Renderer→Main | `{ id: string }` | `Conversation & { messages: Message[] }` |
| `conversation:update` | Renderer→Main | `{ id: string, title?: string }` | `Conversation` |
| `conversation:delete` | Renderer→Main | `{ id: string }` | `{ success: boolean }` |
| `conversation:export` | Renderer→Main | `{ id: string, format: 'json'\|'md', redactKeys?: boolean }` | `string` (file content) |
| `provider:list` | Renderer→Main | `{}` | `ProviderInfo[]` (no raw keys) |
| `provider:add` | Renderer→Main | `{ providerId: string, apiKey: string }` | `{ success: boolean, keyHint: string }` |
| `provider:update` | Renderer→Main | `{ providerId: string, enabled?: boolean, priority?: number }` | `ProviderInfo` |
| `provider:remove` | Renderer→Main | `{ providerId: string }` | `{ success: boolean }` |
| `provider:test` | Renderer→Main | `{ providerId: string }` | `{ success: boolean, error?: string, latencyMs?: number }` |
| `provider:health` | Renderer→Main | `{}` | `ProviderHealth[]` (stats, circuit state) |
| `settings:get` | Renderer→Main | `{ keys?: string[] }` | `Record<string, unknown>` |
| `settings:set` | Renderer→Main | `{ key: string, value: unknown }` | `{ success: boolean }` |
| `app:import-env` | Renderer→Main | `{ path: string }` | `{ imported: string[], skipped: string[] }` |

**Streaming Protocol:** For `chat:send` and `chat:regenerate`, the main process sends incremental updates via `ipcMain.handle` returning an `AsyncGenerator`, or via `webContents.send` on a dedicated response channel (`chat:stream:{conversationId}`).

### 2.3 Secret Handling Model

1. **API keys never reach the renderer process.** The preload script exposes only safe methods.
2. **Keys stored in SQLite** with a `key_hint` (last 4 chars) for display.
3. **In-memory decryption** (future): Use `electron-safeStorage` to encrypt at rest.
4. **Logs never include keys**—only provider IDs and masked hints.

---

## 3. Repository Structure

```
llm-relay/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                    # Lint, typecheck, test
│   │   ├── build.yml                 # Build matrix (win/mac/linux)
│   │   └── security.yml              # Secret scanning, dependency audit
│   ├── ISSUE_TEMPLATE/
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── CONTRIBUTING.md
├── electron/
│   ├── main/
│   │   ├── index.ts                  # Main entry: createWindow, app lifecycle
│   │   ├── ipc/
│   │   │   ├── index.ts              # Register all handlers
│   │   │   ├── chat.ipc.ts           # chat:* handlers
│   │   │   ├── conversations.ipc.ts  # conversation:* handlers
│   │   │   ├── providers.ipc.ts      # provider:* handlers
│   │   │   └── settings.ipc.ts       # settings:* handlers
│   │   ├── database/
│   │   │   ├── sqlite.ts             # better-sqlite3 singleton
│   │   │   ├── migrator.ts           # Run versioned migrations
│   │   │   ├── migrations/
│   │   │   │   ├── 001_initial.sql
│   │   │   │   ├── 002_provider_health.sql
│   │   │   │   └── ...
│   │   │   └── repositories/
│   │   │       ├── conversation.repo.ts
│   │   │       ├── message.repo.ts
│   │   │       ├── provider.repo.ts
│   │   │       └── settings.repo.ts
│   │   ├── providers/
│   │   │   ├── registry.ts           # Provider registry singleton
│   │   │   ├── base.ts               # ProviderAdapter interface
│   │   │   ├── openai.adapter.ts
│   │   │   ├── anthropic.adapter.ts
│   │   │   ├── google.adapter.ts
│   │   │   ├── mistral.adapter.ts
│   │   │   └── ... (more adapters)
│   │   └── router/
│   │       ├── index.ts              # Main router: select, fallback, retry
│   │       ├── health.ts             # Health scoring (EWMA, success rate)
│   │       ├── circuit-breaker.ts    # Circuit breaker state machine
│   │       └── candidate-pool.ts     # Candidate filtering + weighted selection
│   └── preload/
│       └── index.ts                  # contextBridge: exposes window.api
├── src/                              # React renderer
│   ├── main.tsx                      # ReactDOM entry
│   ├── App.tsx                       # Router + layout
│   ├── pages/
│   │   ├── ChatPage.tsx
│   │   ├── SettingsPage.tsx
│   │   └── AboutPage.tsx
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx
│   │   │   └── Header.tsx
│   │   ├── chat/
│   │   │   ├── MessageList.tsx
│   │   │   ├── MessageItem.tsx
│   │   │   ├── ChatInput.tsx
│   │   │   ├── StreamingIndicator.tsx
│   │   │   └── CodeBlock.tsx
│   │   └── settings/
│   │       ├── ProviderCard.tsx
│   │       ├── ApiKeyInput.tsx
│   │       └── HealthMetrics.tsx
│   ├── hooks/
│   │   ├── useChat.ts
│   │   ├── useConversations.ts
│   │   └── useProviders.ts
│   ├── stores/
│   │   ├── chat.store.ts
│   │   └── settings.store.ts
│   ├── lib/
│   │   ├── api.ts                    # Typed wrapper for window.api
│   │   └── markdown.ts               # Markdown + Shiki config
│   └── styles/
│       └── globals.css               # Tailwind + custom vars
├── tests/
│   ├── unit/
│   │   ├── router.test.ts
│   │   ├── health.test.ts
│   │   └── adapters/
│   └── integration/
│       └── chat-flow.test.ts
├── scripts/
│   ├── dev.ts                        # Dev server orchestration
│   └── postbuild.ts                  # Post-build cleanup
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── electron-builder.yml
├── .env.example
├── .gitignore
├── .eslintrc.cjs
├── .prettierrc
├── README.md
├── BLUEPRINT.md                      # This document
├── CHANGELOG.md
└── LICENSE
```

### How to Add a Provider

1. **Create adapter file:** `electron/main/providers/{provider}.adapter.ts`
2. **Implement `ProviderAdapter` interface** (see Section 5)
3. **Register in `registry.ts`:**
   ```typescript
   import { myProviderAdapter } from './{provider}.adapter';
   registry.register(myProviderAdapter);
   ```
4. **Add provider ID to `ProviderId` union** in `electron/main/providers/base.ts`
5. **(Optional)** Add provider-specific config schema if needed
6. **Write tests** in `tests/unit/adapters/{provider}.test.ts`
7. **Document** in README.md under Supported Providers

---

## 4. SQLite Schema & Migrations

### 4.1 Tables

#### `conversations`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | UUID v4 |
| `title` | TEXT | NOT NULL | Auto-generated or user-set |
| `created_at` | INTEGER | NOT NULL | Unix timestamp (ms) |
| `updated_at` | INTEGER | NOT NULL | Unix timestamp (ms) |
| `last_message_at` | INTEGER | | Timestamp of last message |
| `message_count` | INTEGER | DEFAULT 0 | Denormalized count |
| `metadata` | TEXT | | JSON for future extensibility |

#### `messages`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | UUID v4 |
| `conversation_id` | TEXT | NOT NULL, FK → conversations(id) ON DELETE CASCADE | |
| `role` | TEXT | NOT NULL, CHECK IN ('user', 'assistant', 'system') | |
| `content` | TEXT | NOT NULL | Message text |
| `created_at` | INTEGER | NOT NULL | Unix timestamp (ms) |
| `provider_id` | TEXT | | Null for user messages |
| `model` | TEXT | | Model used (e.g., 'gpt-4o') |
| `latency_ms` | INTEGER | | Request latency |
| `input_tokens` | INTEGER | | Token usage |
| `output_tokens` | INTEGER | | Token usage |
| `error` | TEXT | | JSON: NormalizedError if failed |
| `parent_message_id` | TEXT | | For regeneration branching |
| `is_active` | INTEGER | DEFAULT 1 | 1 = shown, 0 = hidden branch |

#### `providers`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | Provider ID (e.g., 'openai') |
| `display_name` | TEXT | NOT NULL | Human-readable name |
| `enabled` | INTEGER | DEFAULT 1 | 1 = active, 0 = disabled |
| `priority` | INTEGER | DEFAULT 0 | Higher = preferred in ties |
| `config` | TEXT | | JSON: provider-specific settings |
| `created_at` | INTEGER | NOT NULL | |
| `updated_at` | INTEGER | NOT NULL | |

#### `provider_keys`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | UUID v4 |
| `provider_id` | TEXT | NOT NULL, FK → providers(id) ON DELETE CASCADE | |
| `encrypted_key` | TEXT | NOT NULL | Key (plaintext for now, encrypted later) |
| `key_hint` | TEXT | | Last 4 chars for display |
| `is_valid` | INTEGER | DEFAULT 1 | 0 = marked invalid by 401/403 |
| `invalidated_reason` | TEXT | | Why key was invalidated |
| `last_used_at` | INTEGER | | |
| `created_at` | INTEGER | NOT NULL | |
| `updated_at` | INTEGER | NOT NULL | |

#### `provider_health`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `provider_id` | TEXT | PRIMARY KEY, FK → providers(id) ON DELETE CASCADE | |
| `success_count` | INTEGER | DEFAULT 0 | Lifetime successes |
| `failure_count` | INTEGER | DEFAULT 0 | Lifetime failures |
| `consecutive_failures` | INTEGER | DEFAULT 0 | For circuit breaker |
| `circuit_state` | TEXT | DEFAULT 'closed', CHECK IN ('closed', 'open', 'half_open') | |
| `cooldown_until` | INTEGER | | Timestamp when cooldown expires |
| `last_success_at` | INTEGER | | |
| `last_failure_at` | INTEGER | | |
| `avg_latency_ewma` | REAL | | Exponentially weighted moving average |
| `health_score` | REAL | DEFAULT 1.0 | Computed score [0.1, 1.0] |

#### `router_events`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | UUID v4 |
| `message_id` | TEXT | FK → messages(id) ON DELETE SET NULL | |
| `provider_id` | TEXT | NOT NULL | |
| `event_type` | TEXT | NOT NULL, CHECK IN ('attempt', 'success', 'failure', 'cooldown', 'circuit_open', 'circuit_close') | |
| `status_code` | INTEGER | | HTTP status if applicable |
| `error_type` | TEXT | | NormalizedError.type |
| `latency_ms` | INTEGER | | |
| `timestamp` | INTEGER | NOT NULL | |

#### `settings`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `key` | TEXT | PRIMARY KEY | Setting key |
| `value` | TEXT | NOT NULL | JSON-serialized value |
| `updated_at` | INTEGER | NOT NULL | |

#### `schema_migrations`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `version` | INTEGER | PRIMARY KEY | Migration version number |
| `name` | TEXT | NOT NULL | Migration file name |
| `applied_at` | INTEGER | NOT NULL | When migration was run |

### 4.2 Indexes

```sql
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX idx_messages_provider ON messages(provider_id);
CREATE INDEX idx_router_events_provider ON router_events(provider_id, timestamp);
CREATE INDEX idx_router_events_message ON router_events(message_id);
CREATE INDEX idx_provider_health_cooldown ON provider_health(cooldown_until);
CREATE INDEX idx_conversations_updated ON conversations(updated_at DESC);
```

### 4.3 Migration Strategy

- Migrations are `.sql` files in `electron/main/database/migrations/`
- Named with incrementing version prefix: `001_initial.sql`, `002_provider_health.sql`
- `migrator.ts` reads `schema_migrations` table, runs pending migrations in order
- All migrations run inside a transaction; rollback on failure
- On app start: run migrations before any DB access

### 4.4 Export/Import Strategy

**Export:**
- Format: JSON or Markdown
- Default: Redact all API keys (replace with `[REDACTED]`)
- Optional: Include keys (with warning dialog)
- Includes: conversations, messages, provider configs (not health/events)

**Import:**
- Validates JSON schema before import
- Merges or replaces (user choice)
- Skips invalid entries with warning
- Re-validates any included keys via `provider:test`

---

## 5. Provider Adapter Contract

### 5.1 Type Definitions

```typescript
// Provider IDs - extensible union
type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'mistral'
  | 'cohere'
  | 'together'
  | 'groq'
  | 'openrouter'
  | 'fireworks'
  | 'perplexity'
  | 'deepseek'
  | 'xai'
  | 'ollama';

interface ProviderCapabilities {
  streaming: boolean;
  vision: boolean;
  functionCalling: boolean;
  maxContextTokens: number;
  defaultModel: string;
  models: string[];
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface GenerateRequest {
  messages: ChatMessage[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
  providerOptions?: Record<string, unknown>;
}

interface StreamChunk {
  type: 'chunk';
  content: string;
  usage?: Partial<UsageStats>;
}

interface GenerateResponse {
  type: 'complete';
  content: string;
  model: string;
  usage: UsageStats;
  finishReason: 'stop' | 'length' | 'content_filter' | 'error';
}

interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

type NormalizedError =
  | { type: 'auth'; message: string; shouldInvalidateKey: boolean }
  | { type: 'rate_limit'; message: string; retryAfterMs?: number }
  | { type: 'timeout'; message: string }
  | { type: 'server'; message: string; statusCode: number }
  | { type: 'network'; message: string }
  | { type: 'invalid_request'; message: string; details?: string }
  | { type: 'content_filter'; message: string }
  | { type: 'context_length'; message: string; maxTokens: number }
  | { type: 'unknown'; message: string; originalError?: unknown };

interface ProviderAdapter {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;

  generate(
    request: GenerateRequest,
    apiKey: string,
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk, GenerateResponse, undefined>;

  testConnection(apiKey: string): Promise<{
    success: boolean;
    error?: NormalizedError;
    latencyMs?: number;
  }>;

  normalizeError(error: unknown, statusCode?: number): NormalizedError;
}
```

### 5.2 Error Mapping Rules

| HTTP Status | Error Type | Router Action |
|-------------|------------|---------------|
| 401, 403 | `auth` | Mark key invalid (`is_valid=0`), skip provider |
| 429 | `rate_limit` | Apply cooldown (Retry-After or default), try next |
| 408, timeout | `timeout` | Retry with backoff, count as failure |
| 500, 502, 503, 504 | `server` | Retry with backoff, increment consecutive failures |
| ECONNREFUSED, ETIMEDOUT | `network` | Retry with backoff |
| 400 | `invalid_request` | No retry, log, try next provider |
| Content moderation | `content_filter` | No retry, return error to user |
| Context too long | `context_length` | No retry, suggest truncation |

### 5.3 Streaming Normalization

All adapters normalize their streaming format to the `AsyncGenerator` pattern:

1. **SSE-based APIs (OpenAI, Anthropic, Mistral):**
   - Parse `data: {...}` lines from response stream
   - Yield `StreamChunk` for each delta
   - Track accumulated content
   - Return `GenerateResponse` on `[DONE]` or final message

2. **Fetch ReadableStream:**
   - Use `TextDecoderStream` + line splitting
   - Handle chunked responses

3. **Non-streaming fallback:**
   - Yield single chunk with full content
   - Immediately return complete response

**Abort handling:**
- Pass `AbortSignal` to fetch/SDK
- On abort, throw `DOMException` with name `AbortError`
- Router catches and marks request as cancelled (no failure penalty)

---

## 6. Router Policy Specification

### 6.1 Candidate Pool Rules

```typescript
function getCandidatePool(excludeRecent: boolean): ProviderCandidate[] {
  return providers.filter(p =>
    p.enabled &&
    p.hasValidKey &&
    (p.cooldownUntil === null || p.cooldownUntil < Date.now()) &&
    (p.circuitState !== 'open') &&
    (!excludeRecent || !recentProviders.includes(p.id))
  );
}
```

**Eligibility criteria:**
1. `enabled = true` in database
2. Has at least one key with `is_valid = true`
3. Not in cooldown (`cooldown_until < now()` or null)
4. Circuit breaker not open (or in half-open probe window)

### 6.2 Anti-Repeat Window

- **Window size:** Last N providers (default: 2)
- **Scope:** Per-session (resets on app restart)
- **Behavior:** Excluded from candidate pool unless they're the only options
- **Relaxation:** After first 3 failed attempts, anti-repeat is ignored

### 6.3 Weighted Random Selection

```typescript
function selectProvider(candidates: ProviderCandidate[]): ProviderCandidate {
  // Calculate weights
  const weights = candidates.map(c => {
    let weight = c.healthScore * (1 + c.priority * 0.1);
    if (c.circuitState === 'half_open') weight *= 0.5; // Reduce weight for probes
    return weight;
  });

  // Normalize to probabilities
  const total = weights.reduce((a, b) => a + b, 0);
  const probabilities = weights.map(w => w / total);

  // Weighted random selection
  const r = Math.random();
  let cumulative = 0;
  for (let i = 0; i < candidates.length; i++) {
    cumulative += probabilities[i];
    if (r <= cumulative) return candidates[i];
  }
  return candidates[candidates.length - 1];
}
```

### 6.4 Fallback Algorithm

```
MAX_ATTEMPTS = 6
BACKOFF_BASE_MS = 1000
BACKOFF_MAX_MS = 30000

function routeMessage(request):
  attempt = 0
  usedProviders = []
  
  while attempt < MAX_ATTEMPTS:
    // Get candidates, relaxing anti-repeat after 3 failures
    excludeRecent = attempt < 3
    candidates = getCandidatePool(excludeRecent)
    
    // If no candidates, try providers about to exit cooldown
    if candidates.isEmpty():
      candidates = getProvidersExitingCooldownSoon(window: 30s)
    
    if candidates.isEmpty():
      throw AllProvidersUnavailableError(diagnostics: getProviderDiagnostics())
    
    provider = selectProvider(candidates)
    usedProviders.push(provider.id)
    
    try:
      result = await provider.generate(request)
      updateHealth(provider, success: true, latency: result.latency)
      logRouterEvent('success', provider, result)
      return result
      
    catch error:
      normalized = provider.normalizeError(error)
      handleError(provider, normalized)
      logRouterEvent('failure', provider, normalized)
      
      attempt++
      if attempt < MAX_ATTEMPTS:
        backoffMs = min(BACKOFF_BASE_MS * (2 ** attempt), BACKOFF_MAX_MS)
        await sleep(backoffMs)
  
  throw MaxRetriesExceededError(attempts: usedProviders)
```

### 6.5 Cooldown Assignment

**On 429 (rate limit):**
```typescript
function assignCooldown(provider: Provider, error: NormalizedError): void {
  let cooldownMs: number;

  if (error.retryAfterMs) {
    // Respect Retry-After header
    cooldownMs = error.retryAfterMs;
  } else {
    // Exponential backoff: 2min, 4min, 8min, capped at 10min
    const base = 2 * 60 * 1000; // 2 minutes
    const consecutive = provider.health.consecutive429s || 0;
    cooldownMs = Math.min(base * Math.pow(2, consecutive), 10 * 60 * 1000);
  }

  provider.health.cooldownUntil = Date.now() + cooldownMs;
  provider.health.consecutive429s = (provider.health.consecutive429s || 0) + 1;
}
```

### 6.6 Circuit Breaker

| State | Entry Condition | Behavior | Exit Condition |
|-------|-----------------|----------|----------------|
| **closed** | Default / probe success | Normal operation | 3 consecutive failures → open |
| **open** | 3 consecutive failures (non-429) | Skip provider | Cooldown expires → half_open |
| **half_open** | Cooldown expired | Allow 1 probe request | Probe success → closed; Probe fail → open (double cooldown) |

**Thresholds:**
- Open after: 3 consecutive failures
- Initial cooldown: 5 minutes
- Cooldown doubling: on probe failure, up to 30 minutes max
- Reset on: successful request (resets consecutive failures)

### 6.7 Health Score Calculation

```typescript
const EWMA_ALPHA = 0.2;
const LATENCY_PENALTY_THRESHOLD = 10000; // 10s
const MIN_SCORE = 0.1;
const MAX_SCORE = 1.0;

function updateHealthScore(provider: Provider, success: boolean, latencyMs: number): void {
  const health = provider.health;

  // Update counters
  if (success) {
    health.successCount++;
    health.consecutiveFailures = 0;
    health.lastSuccessAt = Date.now();
  } else {
    health.failureCount++;
    health.consecutiveFailures++;
    health.lastFailureAt = Date.now();
  }

  // Calculate success rate (last 100 requests or use lifetime)
  const total = health.successCount + health.failureCount;
  const successRate = total > 0 ? health.successCount / total : 1.0;

  // Update latency EWMA
  if (success && latencyMs > 0) {
    health.avgLatencyEwma = health.avgLatencyEwma
      ? EWMA_ALPHA * latencyMs + (1 - EWMA_ALPHA) * health.avgLatencyEwma
      : latencyMs;
  }

  // Calculate health score
  const latencyPenalty = Math.min(health.avgLatencyEwma / LATENCY_PENALTY_THRESHOLD, 0.5);
  health.healthScore = Math.max(MIN_SCORE, Math.min(MAX_SCORE, successRate * (1 - latencyPenalty)));
}
```

### 6.8 All Providers Fail: UX & Diagnostics

When no providers are available or all attempts exhausted:

1. **Error Display:**
   - Clear heading: "Unable to reach any AI provider"
   - List of attempted providers with failure reasons
   - Show which providers are in cooldown and when they expire

2. **Actions:**
   - "Retry Now" button (ignores cooldowns for one attempt)
   - "Check Settings" link to provider configuration
   - "View Diagnostics" expands detailed error info

3. **Diagnostics include:**
   - Provider states (enabled, key valid, circuit state, cooldown)
   - Last error for each provider
   - Timestamps of last success/failure

---

## 7. Settings & Key Management

### 7.1 Environment Import

**Behavior:**
1. On first run, check for `.env` or `.env.local` in app directory
2. Parse for keys matching known providers:
   ```
   OPENAI_API_KEY=sk-...
   ANTHROPIC_API_KEY=sk-ant-...
   GOOGLE_API_KEY=...
   ```
3. Show import dialog listing found keys (masked)
4. User confirms import; keys stored in SQLite
5. Offer to delete/rename source file
6. After import, `.env` changes are ignored (UI is source of truth)

**Key pattern matching:**
| Provider | Env Variable | Key Prefix |
|----------|--------------|------------|
| OpenAI | `OPENAI_API_KEY` | `sk-` |
| Anthropic | `ANTHROPIC_API_KEY` | `sk-ant-` |
| Google | `GOOGLE_API_KEY` | `AIza` |
| Mistral | `MISTRAL_API_KEY` | — |
| Cohere | `COHERE_API_KEY` | — |
| Together | `TOGETHER_API_KEY` | — |
| Groq | `GROQ_API_KEY` | `gsk_` |
| Perplexity | `PERPLEXITY_API_KEY` | `pplx-` |

### 7.2 Masking Rules

| Context | Display |
|---------|---------|
| Settings UI | `sk-...a4Xz` (last 4 chars) |
| Logs | `[key:openai]` (no key content) |
| Export (default) | `[REDACTED]` |
| Export (explicit include) | Full key with warning |
| IPC responses | Never includes raw key |

### 7.3 Local Encryption Roadmap (v2+)

1. **Use `electron-safeStorage`:**
   - OS-level encryption (Windows DPAPI, macOS Keychain, Linux Secret Service)
   - Encrypt key before SQLite insert
   - Decrypt only in-memory when needed

2. **Key derivation:**
   - Use machine-specific secret from safeStorage
   - Never store encryption key in plaintext

3. **Migration:**
   - On upgrade, re-encrypt existing plaintext keys
   - Show progress dialog for many keys

---

## 8. Chat UX Specification

### 8.1 Pages

| Route | Page | Description |
|-------|------|-------------|
| `/` | ChatPage | Main conversation interface with sidebar |
| `/settings` | SettingsPage | Provider keys, app preferences |
| `/about` | AboutPage | Version, licenses, GitHub link |

### 8.2 ChatPage Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [≡]  LLM Relay                                      [⚙️ Settings]       │
├─────────────┬───────────────────────────────────────────────────────────┤
│ [+ New Chat]│                                                           │
│             │  ┌───────────────────────────────────────────────────┐   │
│ Conversation│  │ User message                            [📋 Copy] │   │
│ List        │  └───────────────────────────────────────────────────┘   │
│             │                                                           │
│ • Today     │  ┌───────────────────────────────────────────────────┐   │
│   - Chat 1  │  │ Assistant response (Markdown rendered)            │   │
│   - Chat 2  │  │ ```python                                         │   │
│             │  │ print("hello")      [📋]                          │   │
│ • Yesterday │  │ ```                                               │   │
│   - Chat 3  │  │                                                    │   │
│             │  │                      [🔄 Regenerate] [📋 Copy]     │   │
│ • Older     │  │                      (via: openai • gpt-4o)       │   │
│   - ...     │  └───────────────────────────────────────────────────┘   │
│             │                                                           │
│ [🔍 Search] │  ┌───────────────────────────────────────────────────┐   │
│             │  │ Type a message...                          [Send] │   │
│             │  └───────────────────────────────────────────────────┘   │
└─────────────┴───────────────────────────────────────────────────────────┘
```

### 8.3 Conversation List Behaviors

- **Grouping:** Today, Yesterday, Last 7 Days, Older
- **Sorting:** By `last_message_at` descending
- **Title:** Auto-generated from first user message (truncated) or user-set
- **Context menu:** Rename, Delete, Export
- **Search:** Filters by title (local, instant)

### 8.4 Message Features

| Feature | Behavior |
|---------|----------|
| **Markdown** | Full CommonMark via `react-markdown` + `remark-gfm` |
| **Code blocks** | Syntax highlighting via Shiki; language detection |
| **Copy button** | Per-message and per-code-block |
| **Regenerate** | On last assistant message; creates new branch |
| **Edit user message** | Creates new branch from that point |
| **Retry on error** | Appears on failed responses |
| **Streaming** | Typing cursor animation; incremental render |
| **Cancel** | Stop button during generation |
| **Provider badge** | Small label showing provider+model (toggleable in settings) |

### 8.5 Streaming UI

1. **Pending state:** Typing indicator appears immediately
2. **Streaming:** Content renders incrementally; scroll follows
3. **Complete:** Typing indicator removed; Regenerate button appears
4. **Error:** Error message with Retry button; no penalty to user

### 8.6 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + N` | New conversation |
| `Cmd/Ctrl + K` | Search conversations |
| `Cmd/Ctrl + ,` | Open settings |
| `Cmd/Ctrl + Enter` | Send message (alternative to button) |
| `Escape` | Cancel current generation |

---

## 9. Packaging & Dev Scripts

### 9.1 pnpm Scripts

```json
{
  "scripts": {
    "dev": "concurrently \"pnpm dev:renderer\" \"pnpm dev:electron\"",
    "dev:renderer": "vite",
    "dev:electron": "wait-on http://localhost:5173 && electron .",
    "build": "tsc && vite build && pnpm build:electron-code",
    "build:electron-code": "tsc -p tsconfig.node.json",
    "package": "pnpm build && electron-builder",
    "package:win": "pnpm package --win",
    "package:mac": "pnpm package --mac",
    "package:linux": "pnpm package --linux",
    "lint": "eslint . --ext ts,tsx --max-warnings 0",
    "lint:fix": "eslint . --ext ts,tsx --fix",
    "typecheck": "tsc --noEmit && tsc -p tsconfig.node.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "clean": "rimraf dist dist-electron"
  }
}
```

### 9.2 electron-builder.yml

```yaml
appId: com.llmrelay.app
productName: LLM Relay
copyright: Copyright © 2024

directories:
  output: dist-electron
  buildResources: build

files:
  - dist/**/*
  - electron/main/**/*.js
  - electron/preload/**/*.js
  - package.json

extraResources:
  - from: electron/main/database/migrations
    to: migrations
    filter:
      - "**/*.sql"

mac:
  target:
    - dmg
    - zip
  category: public.app-category.productivity
  icon: build/icon.icns

win:
  target:
    - nsis
    - portable
  icon: build/icon.ico

linux:
  target:
    - AppImage
    - deb
    - rpm
  category: Utility
  icon: build/icons

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

### 9.3 SQLite Location

| OS | Path |
|----|------|
| Windows | `%APPDATA%/LLM Relay/data.sqlite` |
| macOS | `~/Library/Application Support/LLM Relay/data.sqlite` |
| Linux | `~/.config/LLM Relay/data.sqlite` |

**Access in code:**
```typescript
import { app } from 'electron';
import path from 'path';

const dbPath = path.join(app.getPath('userData'), 'data.sqlite');
```

---

## 10. CI / GitHub Actions

### 10.1 ci.yml (on push/PR)

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint-typecheck-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v2
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test:coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: coverage/lcov.info
```

### 10.2 build.yml (on tag push)

```yaml
name: Build

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    strategy:
      matrix:
        include:
          - os: ubuntu-latest
            target: linux
          - os: windows-latest
            target: win
          - os: macos-latest
            target: mac

    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v2
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - run: pnpm install --frozen-lockfile
      - run: pnpm package:${{ matrix.target }}

      - uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.target }}-build
          path: dist-electron/*

  release:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4

      - uses: softprops/action-gh-release@v1
        with:
          files: |
            linux-build/*
            win-build/*
            mac-build/*
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 10.3 security.yml

```yaml
name: Security

on:
  push:
    branches: [main]
  pull_request:
  schedule:
    - cron: '0 0 * * 1'  # Weekly

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v2
        with:
          version: 9

      - run: pnpm audit --audit-level=high

  dependency-review:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/dependency-review-action@v3
```

### 10.4 Repository Settings

- **Enable:** Secret scanning
- **Enable:** Push protection for secrets
- **Enable:** Dependabot security updates

### 10.5 PR Checklist (PULL_REQUEST_TEMPLATE.md)

```markdown
## Description
<!-- What does this PR do? -->

## Checklist
- [ ] Tests added/updated for changes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] No API keys or secrets in code
- [ ] Documentation updated (if applicable)
- [ ] Tested on desktop (which OS?)

## Related Issues
<!-- Closes #... -->
```

---

## 11. Milestones

### MVP (v0.1.0) — Target: 4-6 weeks

| Feature | Status |
|---------|--------|
| Electron + Vite + React + Tailwind scaffold | ⬜ |
| SQLite with better-sqlite3 + migration system | ⬜ |
| 3 providers: OpenAI, Anthropic, Google | ⬜ |
| Basic router: random selection + fallback | ⬜ |
| Chat UI: sidebar, messages, markdown | ⬜ |
| Code block highlighting (Shiki) | ⬜ |
| Settings: add/remove API keys | ⬜ |
| IPC channels for chat, conversations, providers | ⬜ |
| Streaming support | ⬜ |
| Copy message/code buttons | ⬜ |
| Regenerate response | ⬜ |
| Export conversation as Markdown | ⬜ |

### v1.0.0 — Target: 8-12 weeks from MVP

| Feature | Status |
|---------|--------|
| 10-15 providers (Mistral, Cohere, Groq, Together, etc.) | ⬜ |
| Full router: health scoring, circuit breaker, cooldowns | ⬜ |
| Anti-repeat provider selection | ⬜ |
| Router metrics panel | ⬜ |
| Import/export conversations (JSON, redaction) | ⬜ |
| Stable streaming with abort | ⬜ |
| Dark/light theme toggle | ⬜ |
| Conversation search | ⬜ |
| Keyboard shortcuts | ⬜ |
| System prompt customization | ⬜ |
| Rate limit visual feedback | ⬜ |

### Backlog (v1.x+)

| Feature | Priority |
|---------|----------|
| File attachments (images for vision) | Medium |
| Plugin system for custom providers | Low |
| Auto-update (electron-updater) | High |
| Local encryption for keys | High |
| Multiple profiles/workspaces | Low |
| Token usage analytics | Medium |
| Ollama/local model support | Medium |
| Prompt templates library | Low |
| Chat branching (tree view) | Low |

---

## 12. OSS Safety & Non-Goals

### Explicit Non-Goals

| ❌ NOT a goal | Explanation |
|---------------|-------------|
| Free unlimited AI | Users pay their own API costs |
| Rate limit bypass | Respects 429s with backoff |
| Key pooling/sharing | Single-user, single-machine only |
| Private API scraping | Official APIs only |
| Web/cloud service | Desktop-only |
| Telemetry by default | Zero data sent without opt-in |

### Compliance Commitments

1. **Respect provider ToS:**
   - Router is for reliability, not circumvention
   - Proper backoff on rate limits
   - No key rotation to bypass quotas

2. **User responsibility:**
   - Users provide own API keys
   - Users responsible for usage/costs
   - Users must follow each provider's ToS

3. **Security baseline:**
   - Keys never in renderer process
   - No keys in logs
   - No hardcoded secrets
   - Input validation on all IPC

4. **Privacy:**
   - All data local
   - No telemetry unless opt-in
   - No analytics, no crash reporting by default

### License: Apache-2.0

**Justification:**
- Permissive for commercial and personal use
- Patent grant protects users and contributors
- Compatible with most OSS licenses
- Clear contribution terms
- Widely used in similar projects (LangChain, etc.)
- Allows proprietary forks with attribution

---

## Appendix A: Default Configuration Values

| Parameter | Default | Notes |
|-----------|---------|-------|
| Anti-repeat window | 2 | Last N providers excluded |
| Max attempts per request | 6 | Before giving up |
| Backoff base | 1000ms | Exponential backoff start |
| Backoff max | 30000ms | Cap for backoff |
| Cooldown on 429 (base) | 2 minutes | Doubles on consecutive 429s |
| Cooldown on 429 (max) | 10 minutes | Cap |
| Circuit open threshold | 3 | Consecutive failures to open |
| Circuit cooldown (initial) | 5 minutes | Before half-open probe |
| Circuit cooldown (max) | 30 minutes | After failed probes |
| EWMA alpha | 0.2 | For latency smoothing |
| Health score min | 0.1 | Floor to always give chance |
| Health score max | 1.0 | Ceiling |

---

## Appendix B: Supported Providers (Planned)

| Provider | Streaming | Vision | Priority |
|----------|-----------|--------|----------|
| OpenAI | ✅ | ✅ | MVP |
| Anthropic | ✅ | ✅ | MVP |
| Google (Gemini) | ✅ | ✅ | MVP |
| Mistral | ✅ | ❌ | v1.0 |
| Cohere | ✅ | ❌ | v1.0 |
| Together | ✅ | ✅ | v1.0 |
| Groq | ✅ | ❌ | v1.0 |
| OpenRouter | ✅ | ✅ | v1.0 |
| Fireworks | ✅ | ❌ | v1.0 |
| Perplexity | ✅ | ❌ | v1.0 |
| DeepSeek | ✅ | ❌ | v1.0 |
| xAI (Grok) | ✅ | ❌ | v1.0 |
| Ollama (local) | ✅ | ✅ | Backlog |

---

*End of Blueprint*

