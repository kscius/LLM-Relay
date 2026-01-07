import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftIcon } from '../components/icons';
import ProviderCard from '../components/settings/ProviderCard';
import GlobalFactsPanel from '../components/settings/GlobalFactsPanel';
import ThemeToggle from '../components/settings/ThemeToggle';
import RouterMetrics from '../components/settings/RouterMetrics';
import OllamaSettings from '../components/settings/OllamaSettings';
import { useSettingsStore } from '../stores/settings.store';

interface Provider {
  id: string;
  displayName: string;
  description: string;
  enabled: boolean;
  hasKey: boolean;
  keyHint?: string;
  isHealthy: boolean;
  healthScore?: number;
  healthStatus?: string;
  circuitState?: string;
}

export default function SettingsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { settings, updateSettings } = useSettingsStore();

  useEffect(() => {
    loadProviders();
  }, []);

  const loadProviders = async () => {
    try {
      console.log('[SettingsPage] Loading providers... window.api:', !!window.api);
      if (window.api) {
        const providerList = await window.api.providers.list();
        console.log('[SettingsPage] Got providers:', providerList);
        setProviders(providerList);
      } else {
        console.error('[SettingsPage] window.api is not available');
      }
    } catch (error) {
      console.error('Failed to load providers:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveKey = async (providerId: string, apiKey: string) => {
    if (!window.api) return { success: false, error: 'API not available' };

    const result = await window.api.providers.addKey({ providerId, apiKey });
    if (result.success) {
      await loadProviders();
    }
    return result;
  };

  const handleRemoveKey = async (providerId: string) => {
    if (!window.api) return false;

    const result = await window.api.providers.removeKey(providerId);
    if (result) {
      await loadProviders();
    }
    return result;
  };

  const handleTestKey = async (providerId: string, apiKey: string) => {
    if (!window.api) return { success: false, error: 'API not available' };

    return window.api.providers.testKey({ providerId, apiKey });
  };

  const handleTestExistingKey = async (providerId: string) => {
    if (!window.api) return { success: false, error: 'API not available' };

    return window.api.providers.testExistingKey(providerId);
  };

  const toggleProviderBadge = async () => {
    if (!window.api) return;

    const newValue = !settings.showProviderBadge;
    updateSettings({ showProviderBadge: newValue });
    await window.api.settings.set({ showProviderBadge: newValue });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center gap-4 px-6 py-4 border-b border-surface-700">
        <Link to="/" className="btn-ghost btn-icon">
          <ArrowLeftIcon className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-semibold">Settings</h1>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-8">
          {/* Provider Keys Section */}
          <section>
            <h2 className="text-lg font-medium mb-4">API Keys</h2>
            <p className="text-surface-400 text-sm mb-4">
              Add your API keys for each provider. Keys are stored locally and never sent anywhere except to the provider.
            </p>

            {isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="card animate-pulse">
                    <div className="h-5 bg-surface-700 rounded w-1/4 mb-2" />
                    <div className="h-4 bg-surface-700 rounded w-1/2" />
                  </div>
                ))}
              </div>
            ) : providers.length === 0 ? (
              <div className="card bg-yellow-900/20 border-yellow-600/30">
                <p className="text-yellow-400">
                  No providers found. {!window.api ? 'API bridge not available (running outside Electron?)' : 'Database may be empty.'}
                </p>
                <p className="text-sm text-surface-400 mt-2">
                  window.api: {window.api ? 'available' : 'NOT available'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {providers.map(provider => (
                  <ProviderCard
                    key={provider.id}
                    id={provider.id}
                    displayName={provider.displayName}
                    description={provider.description}
                    hasKey={provider.hasKey}
                    keyHint={provider.keyHint}
                    isHealthy={provider.isHealthy}
                    healthScore={provider.healthScore}
                    healthStatus={provider.healthStatus}
                    circuitState={provider.circuitState}
                    onSaveKey={(apiKey) => handleSaveKey(provider.id, apiKey)}
                    onRemoveKey={() => handleRemoveKey(provider.id)}
                    onTestKey={(apiKey) => handleTestKey(provider.id, apiKey)}
                    onTestExistingKey={() => handleTestExistingKey(provider.id)}
                  />
                ))}
              </div>
            )}

            {/* Router Metrics */}
            <div className="mt-6">
              <RouterMetrics />
            </div>
          </section>

          {/* Local Models Section */}
          <section>
            <h2 className="text-lg font-medium mb-4">Local Models</h2>
            <p className="text-surface-400 text-sm mb-4">
              Run AI models locally with Ollama. No API key required, complete privacy.
            </p>
            <OllamaSettings />
          </section>

          {/* App Settings Section */}
          <section>
            <h2 className="text-lg font-medium mb-4">Preferences</h2>

            <div className="space-y-4">
              {/* Theme Selection */}
              <div className="card">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Theme</h3>
                    <p className="text-sm text-surface-400">Choose your preferred color scheme</p>
                  </div>
                  <ThemeToggle />
                </div>
              </div>

              <div className="card flex items-center justify-between">
                <div>
                  <h3 className="font-medium">Show provider badge</h3>
                  <p className="text-sm text-surface-400">Display which provider answered each message</p>
                </div>
                <button
                  onClick={toggleProviderBadge}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    settings.showProviderBadge ? 'bg-primary-600' : 'bg-surface-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      settings.showProviderBadge ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Context Window Size */}
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-medium">Context window size</h3>
                    <p className="text-sm text-surface-400">
                      Number of recent messages sent to AI providers (reduces token usage)
                    </p>
                  </div>
                  <span className="text-primary-400 font-mono text-lg">
                    {settings.contextWindowSize || 20}
                  </span>
                </div>
                <input
                  type="range"
                  min="4"
                  max="50"
                  step="2"
                  value={settings.contextWindowSize || 20}
                  onChange={(e) => {
                    const value = parseInt(e.target.value, 10);
                    updateSettings({ contextWindowSize: value });
                    window.api?.settings.set({ contextWindowSize: value });
                  }}
                  className="w-full h-2 bg-surface-600 rounded-lg appearance-none cursor-pointer accent-primary-500"
                />
                <div className="flex justify-between text-xs text-surface-500 mt-1">
                  <span>4 msgs</span>
                  <span>20 (default)</span>
                  <span>50 msgs</span>
                </div>
              </div>

              {/* System Prompt */}
              <div className="card">
                <div className="mb-3">
                  <h3 className="font-medium">System prompt</h3>
                  <p className="text-sm text-surface-400">
                    Custom instructions sent to AI at the start of every conversation
                  </p>
                </div>
                <textarea
                  value={settings.systemPrompt || ''}
                  onChange={(e) => {
                    updateSettings({ systemPrompt: e.target.value });
                  }}
                  onBlur={() => {
                    window.api?.settings.set({ systemPrompt: settings.systemPrompt });
                  }}
                  placeholder="e.g., You are a helpful assistant. Always respond concisely and in a friendly tone."
                  className="textarea min-h-[120px]"
                />
                <p className="text-xs text-surface-500 mt-2">
                  Leave empty for default behavior. Changes are saved automatically.
                </p>
              </div>
            </div>
          </section>

          {/* Global Memory Section */}
          <section>
            <GlobalFactsPanel />
          </section>

          {/* About Section */}
          <section>
            <h2 className="text-lg font-medium mb-4">About</h2>
            <div className="card">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-primary-400">LLM Relay</h3>
                  <p className="text-sm text-surface-400">Version 0.1.0</p>
                </div>
                <Link to="/about" className="btn-secondary text-sm">
                  Learn More
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
