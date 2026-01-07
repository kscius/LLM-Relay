# LLM Relay

<div align="center">

**A desktop application for chatting with AI using multiple LLM providers through your own API keys.**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)
[![Electron](https://img.shields.io/badge/electron-33.x-blue.svg)](https://www.electronjs.org/)

</div>

## What is LLM Relay?

LLM Relay is a ChatGPT-style desktop app that connects to **15 different AI providers** using your own API keys. Instead of being locked into one provider, the app automatically routes your messages to available providers and handles failures gracefully with automatic fallback.

**Key Benefits:**
- 🔄 **Smart Routing**: Automatically selects the best available provider
- 💾 **Local Storage**: All data stored on your machine in SQLite
- 🔑 **Your Keys**: Use your own API keys - no middleman
- 🛡️ **Encrypted Keys**: API keys encrypted with OS-level security (Electron safeStorage)
- 🔁 **Auto-Fallback**: If one provider fails, automatically tries another

## Features

| Feature | Description |
|---------|-------------|
| **Multi-Provider** | 15 LLM providers (Google, OpenAI, Anthropic, Groq, Mistral, etc.) |
| **Streaming** | Real-time streaming responses with markdown rendering |
| **Code Highlighting** | Syntax highlighting for 100+ languages |
| **Conversation Memory** | Automatic summarization for long conversations |
| **Global Facts** | Remember user preferences across all chats |
| **Smart Router** | Health scoring, circuit breakers, cooldowns |
| **Theme Support** | Dark, Light, and System themes |
| **Local Models** | Ollama integration for running models locally |
| **Export** | Export conversations as Markdown or JSON |
| **Keyboard Shortcuts** | `Cmd/Ctrl+N` new chat, `Cmd/Ctrl+K` search, `Escape` cancel |

## Supported Providers (15)

### Free Tier Available
| Provider | Models | Free Limit |
|----------|--------|------------|
| **Google AI** | Gemini 2.0 Flash, Gemini Pro | Generous free tier |
| **Groq** | Llama 3, Mixtral | Free tier available |
| **Cerebras** | Llama 3.1/3.3 | Free tier available |
| **NVIDIA NIM** | Llama, Mistral, Qwen | Free tier available |
| **Cohere** | Command R+, Command R | Free trial |
| **Cloudflare Workers AI** | Llama 4/3.3/3.1, Mistral | 10k Neurons/day |
| **OpenRouter** | Various `:free` models | 50 requests/day |

### Paid (API Key Required)
| Provider | Models |
|----------|--------|
| **OpenAI** | GPT-4o, GPT-4o-mini |
| **Anthropic** | Claude 4, Claude 3.5 Sonnet |
| **Mistral AI** | Mistral Large, Codestral |
| **Perplexity** | Sonar (web-connected) |
| **Together AI** | Llama 3.3, Mixtral, Qwen |
| **DeepSeek** | DeepSeek-V3, Reasoner |
| **xAI** | Grok-3, Grok-2 |

### Local
| Provider | Description |
|----------|-------------|
| **Ollama** | Run models locally (requires Ollama app) |

## Quick Start

### Prerequisites

- **Node.js** 20.x or higher
- **npm** (comes with Node.js)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/llm-relay.git
cd llm-relay

# Install dependencies
npm install
```

### Development

```bash
# Start the app in development mode
npm run dev
```

This will:
1. Compile the Electron main process (TypeScript)
2. Start the Vite dev server (React frontend)
3. Launch the Electron app

The app runs on port **5190** by default.

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development mode |
| `npm run build` | Build for production |
| `npm run package` | Build + package for current OS |
| `npm run package:win` | Package for Windows (NSIS + portable) |
| `npm run package:mac` | Package for macOS (DMG + ZIP) |
| `npm run package:linux` | Package for Linux (AppImage, DEB, RPM) |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run test` | Run tests with Vitest |
| `npm run clean` | Remove build artifacts |

### Building for Production

```bash
# Build for your current platform
npm run package

# Build for specific platforms
npm run package:win    # Windows
npm run package:mac    # macOS
npm run package:linux  # Linux
```

Build artifacts are output to `dist-electron/`.

## Configuration

### Adding API Keys

1. Launch the app
2. Go to **Settings** (gear icon or `Cmd/Ctrl+,`)
3. Enter your API key for each provider
4. Click **Validate & Save** to test and save the key
5. Use the **Test** button to verify existing keys

Keys are encrypted using your operating system's secure storage (Electron safeStorage).

### Key Formats

Most providers use standard API keys. Some have special formats:

| Provider | Format | Example |
|----------|--------|---------|
| Cloudflare | `account_id:api_token` | `abc123:xyz789` |
| Others | Standard API key | `sk-...`, `AIza...` |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Electron Main Process                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
│  │  SQLite  │  │ Provider │  │  Router  │  │   IPC   │  │
│  │ Database │◄─│ Adapters │◄─│ + Pool   │◄─│ Handlers│  │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘  │
└────────────────────────┬────────────────────────────────┘
                         │ contextBridge (secure IPC)
┌────────────────────────┴────────────────────────────────┐
│                    Renderer (React + Vite)               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
│  │  Pages   │  │Components│  │  Zustand │  │  Hooks  │  │
│  │          │  │          │  │  Stores  │  │         │  │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Router Logic

The smart router selects providers based on:

1. **Eligibility**: Has API key, not in cooldown, circuit not open
2. **Health Score**: Exponentially weighted moving average of latency and success rate
3. **Anti-Repeat**: Avoids recently used providers for diversity
4. **Weighted Random**: Randomized selection weighted by health score

**Failure Handling:**
- Up to 6 automatic retries with different providers
- Circuit breaker opens after 3 consecutive failures
- Cooldown period after rate limit errors

## Data Storage

All data is stored locally in SQLite:

| OS | Location |
|----|----------|
| **Windows** | `%APPDATA%/llm-relay/llm-relay.sqlite` |
| **macOS** | `~/Library/Application Support/llm-relay/llm-relay.sqlite` |
| **Linux** | `~/.config/llm-relay/llm-relay.sqlite` |

### What's Stored

- Conversations and messages
- Provider API keys (encrypted)
- Provider health metrics
- User settings and preferences
- Conversation memory and global facts

## Project Structure

```
llm-relay/
├── electron-src/          # Electron main process (TypeScript)
│   ├── main/
│   │   ├── database/      # SQLite + migrations
│   │   ├── providers/     # LLM provider adapters
│   │   ├── router/        # Smart routing logic
│   │   ├── services/      # Memory, context, facts
│   │   └── ipc/           # IPC handlers
│   └── preload/           # Secure bridge to renderer
├── src/                   # React frontend
│   ├── components/        # UI components
│   ├── pages/             # Route pages
│   ├── stores/            # Zustand state
│   └── hooks/             # Custom hooks
├── tests/                 # Vitest tests
└── electron/              # Compiled Electron code
```

## Security

| Aspect | Implementation |
|--------|----------------|
| **API Key Storage** | Encrypted with OS keychain (safeStorage) |
| **Key Transmission** | Only sent to the provider you configure |
| **Telemetry** | None - no data sent to us |
| **CSP** | Content Security Policy enabled |
| **IPC** | contextBridge with explicit API exposure |

## Troubleshooting

### Port Already in Use

If port 5190 is in use, edit `vite.config.ts`:

```typescript
server: {
  port: 5191,  // Change to available port
  strictPort: true,
}
```

Also update `package.json` and `electron-src/main/index.ts` with the new port.

### API Key Validation Fails

- **429 errors**: Rate limit - key is valid but quota exceeded
- **401/403 errors**: Invalid or expired key
- **Network errors**: Check your internet connection

### Database Issues

Delete the SQLite file to reset (you'll lose saved conversations):

```bash
# Windows
del %APPDATA%\llm-relay\llm-relay.sqlite

# macOS/Linux
rm ~/Library/Application\ Support/llm-relay/llm-relay.sqlite
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## License

Apache License 2.0 - See [LICENSE](LICENSE) for details.

## Disclaimer

This project:
- ❌ Does NOT evade rate limits or Terms of Service
- ❌ Does NOT scrape private/undocumented endpoints
- ❌ Does NOT collect telemetry or usage data
- ❌ Does NOT guarantee "always-on free service"

Users are responsible for their own API keys and compliance with each provider's terms of service.
