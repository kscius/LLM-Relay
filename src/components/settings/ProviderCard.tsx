import { useState } from 'react';
import ApiKeyInput from './ApiKeyInput';
import { CheckIcon, RefreshIcon } from '../icons';

interface ProviderCardProps {
  id: string;
  displayName: string;
  description: string;
  hasKey: boolean;
  keyHint?: string;
  isHealthy: boolean;
  healthScore?: number;
  healthStatus?: string;
  circuitState?: string;
  onSaveKey: (apiKey: string) => Promise<{ success: boolean; error?: string; latencyMs?: number }>;
  onRemoveKey: () => Promise<boolean>;
  onTestKey: (apiKey: string) => Promise<{ success: boolean; error?: string; latencyMs?: number }>;
  onTestExistingKey: () => Promise<{ success: boolean; error?: string; latencyMs?: number }>;
}

export default function ProviderCard({
  displayName,
  description,
  hasKey,
  keyHint,
  isHealthy,
  healthStatus,
  circuitState,
  onSaveKey,
  onRemoveKey,
  onTestKey,
  onTestExistingKey,
}: ProviderCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isTestingExisting, setIsTestingExisting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; latencyMs?: number } | null>(null);
  const [existingKeyResult, setExistingKeyResult] = useState<{ success: boolean; message: string; latencyMs?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!apiKey.trim()) return;

    setIsSaving(true);
    setError(null);
    setTestResult(null);

    try {
      // onSaveKey now validates the connection before saving
      const result = await onSaveKey(apiKey.trim());
      
      if (result.success) {
        setTestResult({
          success: true,
          message: '✓ Connection verified and key saved!',
          latencyMs: (result as any).latencyMs,
        });
        // Small delay to show success before closing
        setTimeout(() => {
          setIsEditing(false);
          setApiKey('');
          setTestResult(null);
        }, 1500);
      } else {
        // Show validation error
        setTestResult({
          success: false,
          message: result.error || 'Connection test failed',
        });
        setError('API key validation failed. Please check your key and try again.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save key');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    if (!apiKey.trim()) return;

    setIsTesting(true);
    setTestResult(null);
    setError(null);

    try {
      const result = await onTestKey(apiKey.trim());
      setTestResult({
        success: result.success,
        message: result.success ? 'Connection successful!' : (result.error || 'Test failed'),
        latencyMs: result.latencyMs,
      });
    } catch (e) {
      setTestResult({
        success: false,
        message: e instanceof Error ? e.message : 'Test failed',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleRemove = async () => {
    if (!window.confirm(`Remove API key for ${displayName}?`)) return;

    try {
      await onRemoveKey();
      setApiKey('');
      setTestResult(null);
      setExistingKeyResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove key');
    }
  };

  const handleTestExisting = async () => {
    setIsTestingExisting(true);
    setExistingKeyResult(null);

    try {
      const result = await onTestExistingKey();
      setExistingKeyResult({
        success: result.success,
        message: result.success 
          ? `✓ Connected (${result.latencyMs}ms)` 
          : (result.error || 'Connection failed'),
        latencyMs: result.latencyMs,
      });
      
      // Clear result after 5 seconds
      if (result.success) {
        setTimeout(() => setExistingKeyResult(null), 5000);
      }
    } catch (e) {
      setExistingKeyResult({
        success: false,
        message: e instanceof Error ? e.message : 'Test failed',
      });
    } finally {
      setIsTestingExisting(false);
    }
  };

  const getStatusColor = () => {
    if (!hasKey) return 'text-surface-500';
    if (circuitState === 'open') return 'text-red-400';
    if (!isHealthy) return 'text-yellow-400';
    return 'text-green-400';
  };

  const getStatusText = () => {
    if (!hasKey) return 'Not configured';
    if (circuitState === 'open') return 'Circuit open';
    if (!isHealthy) return healthStatus || 'Degraded';
    return 'Active';
  };

  return (
    <div className="card">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-medium text-surface-100">{displayName}</h3>
          <p className="text-sm text-surface-400">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium ${getStatusColor()}`}>
            {getStatusText()}
          </span>
          {hasKey && isHealthy && (
            <span className="w-2 h-2 bg-green-400 rounded-full" />
          )}
        </div>
      </div>

      {hasKey && !isEditing ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm text-surface-400">
              API Key: ••••••••{keyHint}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleTestExisting}
                disabled={isTestingExisting}
                className="btn-ghost text-sm py-1 text-primary-400 hover:text-primary-300"
              >
                {isTestingExisting ? (
                  <>
                    <RefreshIcon className="h-3 w-3 animate-spin inline mr-1" />
                    Testing...
                  </>
                ) : (
                  'Test'
                )}
              </button>
              <button
                onClick={() => setIsEditing(true)}
                className="btn-secondary text-sm py-1"
              >
                Change
              </button>
              <button
                onClick={handleRemove}
                className="btn-ghost text-sm py-1 text-red-400 hover:text-red-300"
              >
                Remove
              </button>
            </div>
          </div>
          {existingKeyResult && (
            <div className={`text-sm ${existingKeyResult.success ? 'text-green-400' : 'text-red-400'}`}>
              {existingKeyResult.message}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <ApiKeyInput
            value={apiKey}
            onChange={setApiKey}
            placeholder={`Enter ${displayName} API key`}
            disabled={isSaving || isTesting}
          />

          {testResult && (
            <div className={`text-sm ${testResult.success ? 'text-green-400' : 'text-red-400'}`}>
              {testResult.message}
              {testResult.latencyMs && ` (${testResult.latencyMs}ms)`}
            </div>
          )}

          {error && (
            <div className="text-sm text-red-400">{error}</div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={handleTest}
              disabled={!apiKey.trim() || isTesting || isSaving}
              className="btn-secondary text-sm py-1"
            >
              {isTesting ? (
                <>
                  <RefreshIcon className="h-4 w-4 animate-spin" />
                  Testing...
                </>
              ) : (
                'Test Connection'
              )}
            </button>

            <button
              onClick={handleSave}
              disabled={!apiKey.trim() || isSaving || isTesting}
              className="btn-primary text-sm py-1"
            >
              {isSaving ? (
                <>
                  <RefreshIcon className="h-4 w-4 animate-spin" />
                  Validating...
                </>
              ) : (
                <>
                  <CheckIcon className="h-4 w-4" />
                  Validate & Save
                </>
              )}
            </button>

            {hasKey && (
              <button
                onClick={() => {
                  setIsEditing(false);
                  setApiKey('');
                  setTestResult(null);
                  setError(null);
                }}
                className="btn-ghost text-sm py-1"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

