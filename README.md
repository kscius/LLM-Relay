# LLM Relay

A desktop app that talks to AI using multiple providers through your own API keys.

## What it does

Routes your messages to 15 different LLM providers. If one fails, it tries another. All data stays on your machine.

**Why use this:**
- Connect your own API keys for each provider
- Smart routing picks the best available provider
- Encrypted key storage (OS keychain)
- Auto-fallback when providers fail

## Providers (15)

**Free tier:**
| Provider | What you get |
|----------|--------------|
| Google AI | Gemini 2.0 Flash |
| Groq | Llama 3, Mixtral (fast) |
| Cerebras | Llama 3.1/3.3 (fast) |
| NVIDIA NIM | Various models |
| Cohere | Command R+ |
| Cloudflare | 10k neurons/day |
| OpenRouter | 50 req/day `:free` models |

**Paid:**
OpenAI, Anthropic, Mistral, Perplexity, Together, DeepSeek, xAI

**Local:**
Ollama (run models on your machine)

## Quick start

```bash
git clone https://github.com/your-username/llm-relay.git
cd llm-relay
npm install
npm run dev
```

Opens on port 5190.

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Dev mode |
| `npm run build` | Production build |
| `npm run package` | Package for current OS |
| `npm run package:win` | Windows installer |
| `npm run package:mac` | macOS DMG |
| `npm run package:linux` | AppImage/DEB/RPM |
| `npm run lint` | Lint check |
| `npm run typecheck` | Type check |
| `npm run test` | Run tests |

## Adding keys

1. Open Settings (gear icon)
2. Enter your API key
3. Click "Validate & Save"

**Cloudflare format:** `account_id:api_token`

## How routing works

1. Filters: has key, not in cooldown, circuit closed
2. Scores by health (latency + success rate)
3. Weighted random selection
4. Up to 6 retries on failure

## Data location

| OS | Path |
|----|------|
| Windows | `%APPDATA%/llm-relay/llm-relay.sqlite` |
| macOS | `~/Library/Application Support/llm-relay/` |
| Linux | `~/.config/llm-relay/` |

All data local. Keys encrypted. No telemetry.

## Structure

```
llm-relay/
├── electron-src/     # Main process (TS)
│   ├── database/     # SQLite
│   ├── providers/    # LLM adapters
│   ├── router/       # Routing logic
│   └── services/     # Memory, facts
├── src/              # React frontend
└── tests/            # Vitest
```

## Keyboard shortcuts

- `Cmd/Ctrl+N` - New chat
- `Cmd/Ctrl+K` - Search
- `Cmd/Ctrl+,` - Settings
- `Escape` - Cancel

## Troubleshooting

**Port in use?** Change it in `vite.config.ts`, `package.json`, and `electron-src/main/index.ts`.

**429 error?** Rate limited - key is valid, just wait.

**Reset data?** Delete the sqlite file.

## License

Apache 2.0

---

*You manage your keys. You're responsible for each provider's ToS.*
