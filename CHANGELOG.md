# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-01-07

### Added

- **15 LLM Providers**: Added support for Cloudflare Workers AI, OpenRouter, OpenAI, Anthropic, Perplexity, Together AI, DeepSeek, xAI, and Ollama (local models)
- **Conversation Memory**: Automatic summarization and key fact extraction for long conversations
- **Global Facts**: Persistent user preferences remembered across all conversations
- **System Prompt**: Customizable global system prompt for all conversations
- **Theme Support**: Dark, Light, and System theme options
- **Router Health Panel**: Real-time visualization of provider health and status
- **API Key Encryption**: Keys encrypted with OS-level security (Electron safeStorage)
- **Auto-Update**: Automatic update mechanism with electron-updater
- **Ollama Integration**: UI for managing local models with Ollama
- **Enhanced Router**: Improved provider diversity with anti-repeat logic and weighted random selection
- **Provider Usage Tracking**: Track daily usage for providers with free tier limits

### Changed

- Improved error handling for rate limit (429) vs authentication errors
- Router Health panel now shows only providers with actual activity
- Better API key validation feedback in Settings UI
- Port changed from 5175 to 5190 for development

### Fixed

- Migration errors with provider_health table columns
- Rate limit errors incorrectly shown as "API key invalid"
- Provider diversity - no longer repeatedly selects same 3 providers

### Security

- API keys now encrypted at rest using electron-safeStorage
- Keys are decrypted only when needed for API calls

## [0.1.0] - 2024-12-29

### Added

- Initial MVP release
- Electron + React + TypeScript desktop application
- SQLite local storage with migrations
- Provider adapters for Google AI, Mistral, Groq, Cohere, NVIDIA NIM, Cerebras
- Intelligent router with health scoring and circuit breaker
- Streaming responses with markdown rendering
- Syntax-highlighted code blocks with copy button
- Conversation management (create, rename, delete)
- Export conversations as Markdown or JSON
- Settings page for API key management
- Keyboard shortcuts (Cmd+N, Cmd+K, Escape)
- Dark theme UI

### Security

- API keys stored locally only (base64 encoded)
- Content Security Policy enabled
- No telemetry or analytics
