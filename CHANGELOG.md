# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2024-12-29

### Added

- Initial MVP release
- Electron + React + TypeScript desktop application
- SQLite local storage with migrations
- Provider adapters for OpenAI, Anthropic, and Google AI
- Intelligent router with health scoring and circuit breaker
- Streaming responses with markdown rendering
- Syntax-highlighted code blocks with copy button
- Conversation management (create, rename, delete)
- Export conversations as Markdown or JSON
- Settings page for API key management
- Keyboard shortcuts (Cmd+N, Cmd+K, Escape)
- Dark theme UI

### Security

- API keys stored locally only
- Content Security Policy enabled
- No telemetry or analytics

