import { useState, useEffect } from 'react';

interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modifiedAt: string;
}

interface OllamaStatus {
  available: boolean;
  version?: string;
  models: OllamaModel[];
  error?: string;
}

export default function OllamaSettings() {
  const [status, setStatus] = useState<OllamaStatus>({
    available: false,
    models: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [isPulling, setIsPulling] = useState(false);
  const [pullModel, setPullModel] = useState('');
  const [pullProgress, setPullProgress] = useState<string | null>(null);

  useEffect(() => {
    checkOllamaStatus();
  }, []);

  const checkOllamaStatus = async () => {
    setIsLoading(true);
    try {
      // Check if Ollama is running by testing the API
      const response = await fetch('http://localhost:11434/api/version');
      
      if (response.ok) {
        const versionData = await response.json();
        
        // Fetch available models
        const modelsResponse = await fetch('http://localhost:11434/api/tags');
        const modelsData = await modelsResponse.json();
        
        setStatus({
          available: true,
          version: versionData.version,
          models: modelsData.models || [],
        });
        
        // Set default selected model if available
        if (modelsData.models?.length > 0 && !selectedModel) {
          setSelectedModel(modelsData.models[0].name);
        }
      } else {
        setStatus({
          available: false,
          models: [],
          error: 'Ollama server returned an error',
        });
      }
    } catch {
      setStatus({
        available: false,
        models: [],
        error: 'Ollama is not running. Start the Ollama app to use local models.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const handlePullModel = async () => {
    if (!pullModel.trim()) return;
    
    setIsPulling(true);
    setPullProgress('Starting download...');
    
    try {
      const response = await fetch('http://localhost:11434/api/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: pullModel, stream: false }),
      });
      
      if (response.ok) {
        setPullProgress('Download complete!');
        setPullModel('');
        // Refresh the model list
        await checkOllamaStatus();
      } else {
        const error = await response.text();
        setPullProgress(`Error: ${error}`);
      }
    } catch (error) {
      setPullProgress(`Failed to pull model: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsPulling(false);
      setTimeout(() => setPullProgress(null), 5000);
    }
  };

  const handleDeleteModel = async (modelName: string) => {
    if (!confirm(`Delete model "${modelName}"? This cannot be undone.`)) {
      return;
    }
    
    try {
      const response = await fetch('http://localhost:11434/api/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName }),
      });
      
      if (response.ok) {
        await checkOllamaStatus();
      } else {
        alert('Failed to delete model');
      }
    } catch (error) {
      alert(`Error deleting model: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  if (isLoading) {
    return (
      <div className="card animate-pulse">
        <div className="h-6 bg-surface-700 rounded w-1/3 mb-2" />
        <div className="h-4 bg-surface-700 rounded w-2/3" />
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${status.available ? 'bg-green-500' : 'bg-red-500'}`} />
          <div>
            <h3 className="font-medium">Ollama</h3>
            <p className="text-sm text-surface-400">
              {status.available 
                ? `v${status.version} • ${status.models.length} model${status.models.length !== 1 ? 's' : ''} available`
                : 'Local inference with open-source models'
              }
            </p>
          </div>
        </div>
        <button
          onClick={checkOllamaStatus}
          className="btn-ghost btn-icon"
          title="Refresh status"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {!status.available ? (
        <div className="bg-surface-700/50 rounded-lg p-4">
          <p className="text-surface-300 text-sm mb-3">{status.error}</p>
          <div className="space-y-2 text-sm text-surface-400">
            <p className="font-medium text-surface-300">To use local models:</p>
            <ol className="list-decimal list-inside space-y-1 ml-2">
              <li>Download Ollama from <a href="https://ollama.ai" target="_blank" rel="noopener noreferrer" className="text-primary-400 hover:underline">ollama.ai</a></li>
              <li>Install and run the Ollama application</li>
              <li>Pull a model: <code className="bg-surface-600 px-1.5 py-0.5 rounded">ollama pull llama3.2</code></li>
              <li>Click refresh to detect available models</li>
            </ol>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Available Models */}
          {status.models.length > 0 && (
            <div>
              <label className="text-sm text-surface-400 mb-2 block">Installed Models</label>
              <div className="space-y-2">
                {status.models.map((model) => (
                  <div
                    key={model.name}
                    className="flex items-center justify-between bg-surface-700/50 rounded-lg px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <div>
                        <span className="font-medium text-surface-200">{model.name}</span>
                        <p className="text-xs text-surface-500">{formatBytes(model.size)}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteModel(model.name)}
                      className="text-red-400 hover:text-red-300 p-1"
                      title="Delete model"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pull New Model */}
          <div>
            <label className="text-sm text-surface-400 mb-2 block">Download New Model</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={pullModel}
                onChange={(e) => setPullModel(e.target.value)}
                placeholder="e.g., llama3.2, mistral, gemma2"
                className="input flex-1"
                disabled={isPulling}
              />
              <button
                onClick={handlePullModel}
                disabled={isPulling || !pullModel.trim()}
                className="btn-primary"
              >
                {isPulling ? (
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : 'Pull'}
              </button>
            </div>
            {pullProgress && (
              <p className={`text-sm mt-2 ${pullProgress.startsWith('Error') ? 'text-red-400' : 'text-surface-400'}`}>
                {pullProgress}
              </p>
            )}
            <p className="text-xs text-surface-500 mt-2">
              Browse models at <a href="https://ollama.ai/library" target="_blank" rel="noopener noreferrer" className="text-primary-400 hover:underline">ollama.ai/library</a>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

