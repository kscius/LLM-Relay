# LLM Relay

A privacy-first desktop application that provides a ChatGPT-like conversational interface backed by multiple LLM API providers. Your API keys and chat history are stored locally—nothing is sent to any server except the LLM providers you configure.

## Features

- **Multi-Provider Routing**: Automatically routes messages across 14 providers with intelligent fallback
- **Streaming Responses**: Real-time streaming with markdown rendering and syntax-highlighted code blocks
- **Local Storage**: All data stored in SQLite—no external servers, no telemetry
- **Health Monitoring**: Circuit breaker, cooldowns, and health scoring for reliable operation
- **Conversation Memory**: Automatic summarization and key fact extraction for long conversations
- **Global Facts**: Persistent user preferences remembered across all conversations
- **Export**: Export conversations as Markdown or JSON
- **Keyboard Shortcuts**: `Cmd/Ctrl+N` (new chat), `Cmd/Ctrl+K` (search), `Escape` (cancel)

## Prerequisites

- Node.js 20+
- pnpm 8+

## Installation

```bash
# Clone the repository
git clone https://github.com/llm-relay/llm-relay.git
cd llm-relay

# Install dependencies
pnpm install
```

## Development

```bash
# Start development server
pnpm dev

# Run linting
pnpm lint

# Run type checking
pnpm typecheck

# Run tests
pnpm test
```

## Building

```bash
# Build for current platform
pnpm package

# Build for specific platform
pnpm package:win    # Windows (NSIS installer + portable)
pnpm package:mac    # macOS (DMG + ZIP)
pnpm package:linux  # Linux (AppImage, DEB, RPM)
```

Build artifacts are output to `dist-electron/`.

## Configuration

### API Keys

1. Launch the app and go to **Settings**
2. Add your API keys for each provider
3. Test the connection before saving

### Supported Providers (14 total)

**Free Tier Available:**
- **Google AI**: Gemini 2.0 Flash, Gemini Pro
- **Groq**: Llama 3, Mixtral - Ultra fast inference
- **Cerebras**: Llama 3.1/3.3 - Ultra fast inference
- **NVIDIA NIM**: Llama, Mistral, Qwen
- **Mistral AI**: Mistral Large, Codestral
- **Cohere**: Command R+, Command R
- **Cloudflare Workers AI**: GPT-OSS, Llama 4/3.3/3.1, Granite, Mistral (10k Neurons/day)
- **OpenRouter**: Llama 3.1, Gemma 3, Qwen3 `:free` models (50 req/day)

**Paid/API Key Required:**
- **OpenAI**: GPT-4o, GPT-4o-mini
- **Anthropic**: Claude 3.5 Sonnet, Claude 4
- **Perplexity**: Sonar models - Web-connected AI
- **Together AI**: Llama 3.3, Mixtral - Fast inference
- **DeepSeek**: DeepSeek-V3, Coder - Cost effective
- **xAI**: Grok-3 - X/Twitter AI

### Environment Variables (Optional)

Create a `.env` file to auto-import keys on first run:

```env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=AIza...
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Electron Main Process                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
│  │  SQLite  │  │ Provider │  │  Router  │  │   IPC   │  │
│  │          │◄─│ Adapters │◄─│          │◄─│ Handlers│  │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘  │
└────────────────────────┬────────────────────────────────┘
                         │ contextBridge
┌────────────────────────┴────────────────────────────────┐
│                    Renderer (React)                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
│  │  Pages   │  │Components│  │  Stores  │  │  Hooks  │  │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Router Logic

The router automatically selects providers based on:

1. **Eligibility**: Provider enabled, has valid key, not in cooldown
2. **Health Score**: EWMA of latency and success rate
3. **Anti-Repeat**: Avoids last 2 used providers
4. **Circuit Breaker**: Opens after 3 consecutive failures

On failure, the router automatically retries with a different provider (up to 6 attempts).

## Data Storage

All data is stored locally in SQLite:

- **Windows**: `%APPDATA%/llm-relay/llm-relay.sqlite`
- **macOS**: `~/Library/Application Support/llm-relay/llm-relay.sqlite`
- **Linux**: `~/.config/llm-relay/llm-relay.sqlite`

## Security

- API keys are stored locally (base64 encoded in MVP; encryption roadmap planned)
- Keys never leave your machine except to the configured provider
- No telemetry or analytics
- Content Security Policy enabled

## License

Apache License 2.0 - See [LICENSE](LICENSE) for details.

## Non-Goals

This project explicitly does NOT:

- Evade rate limits or Terms of Service
- Scrape private/undocumented endpoints
- Collect telemetry or usage data
- Guarantee "always-on free service"

Users are responsible for their own API keys and usage compliance.

