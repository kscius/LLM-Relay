import { Link } from 'react-router-dom';
import { ArrowLeftIcon } from '../components/icons';

export default function AboutPage() {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center gap-4 px-6 py-4 border-b border-surface-700">
        <Link to="/" className="btn-ghost btn-icon">
          <ArrowLeftIcon className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-semibold">About</h1>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-8">
          <section className="text-center py-8">
            <h1 className="text-3xl font-bold text-primary-400 mb-2">LLM Relay</h1>
            <p className="text-surface-400">Version 0.1.0</p>
          </section>

          <section>
            <h2 className="text-lg font-medium mb-4">About</h2>
            <p className="text-surface-300 leading-relaxed">
              LLM Relay is a privacy-first desktop application that provides a ChatGPT-like 
              conversational interface backed by multiple LLM API providers. Your API keys 
              and chat history are stored locally—nothing is sent to any server except the 
              LLM providers you configure.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-medium mb-4">Features</h2>
            <ul className="space-y-2 text-surface-300">
              <li>• Multi-provider routing with automatic fallback</li>
              <li>• Streaming responses with markdown rendering</li>
              <li>• Syntax-highlighted code blocks</li>
              <li>• Local SQLite storage for all data</li>
              <li>• No telemetry or analytics</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-medium mb-4">License</h2>
            <p className="text-surface-300">
              Apache License 2.0 — Free for personal and commercial use.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-medium mb-4">Links</h2>
            <div className="space-y-2">
              <a 
                href="https://github.com/llm-relay/llm-relay"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-primary-400 hover:text-primary-300"
              >
                GitHub Repository →
              </a>
              <a 
                href="https://github.com/llm-relay/llm-relay/issues"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-primary-400 hover:text-primary-300"
              >
                Report an Issue →
              </a>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

