import { useState, useEffect } from 'react';

interface ProviderHealthData {
  score: number;
  status: string;
  displayName?: string;
  circuitState?: 'closed' | 'open' | 'half_open';
  avgLatencyMs?: number;
  successCount?: number;
  failureCount?: number;
}

interface ProviderHealth extends ProviderHealthData {
  id: string;
}

export default function RouterMetrics() {
  const [health, setHealth] = useState<Record<string, ProviderHealthData>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    loadHealth();
    // Refresh every 10 seconds
    const interval = setInterval(loadHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  const loadHealth = async () => {
    if (!window.api?.providers) return;

    try {
      const healthData = await window.api.providers.getHealth();
      setHealth(healthData as Record<string, ProviderHealthData>);
    } catch (error) {
      console.error('Failed to load health data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const allProviders: ProviderHealth[] = Object.entries(health).map(([id, data]) => ({
    id,
    ...data,
  }));

  // Filter to only show providers that have been used (have success or failure counts)
  // OR providers that have a non-default health score (not exactly 1.0)
  const usedProviders = allProviders.filter(p => 
    (p.successCount || 0) > 0 || 
    (p.failureCount || 0) > 0 ||
    (p.score !== undefined && p.score < 1.0)
  );

  const getCircuitIcon = (state: string) => {
    switch (state) {
      case 'closed':
        return <span className="text-green-400" title="Circuit Closed">●</span>;
      case 'open':
        return <span className="text-red-400" title="Circuit Open">●</span>;
      case 'half_open':
        return <span className="text-yellow-400" title="Half Open">◐</span>;
      default:
        return <span className="text-surface-500">○</span>;
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 0.8) return 'text-green-400';
    if (score >= 0.5) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getScoreBarColor = (score: number) => {
    if (score >= 0.8) return 'bg-green-500';
    if (score >= 0.5) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  if (isLoading) {
    return (
      <div className="card animate-pulse">
        <div className="h-5 bg-surface-700 rounded w-1/3 mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-8 bg-surface-700 rounded" />
          ))}
        </div>
      </div>
    );
  }

  // Only count providers that have actual activity
  const activeProviders = usedProviders;
  const avgScore = activeProviders.length > 0
    ? activeProviders.reduce((sum, p) => sum + (p.score || 0), 0) / activeProviders.length
    : 0;
  
  const hasActivity = activeProviders.length > 0;

  return (
    <div className="card">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between"
      >
        <div>
          <h3 className="font-medium text-surface-200">Router Health</h3>
          <p className="text-sm text-surface-400">
            {hasActivity 
              ? `${activeProviders.length} provider${activeProviders.length !== 1 ? 's' : ''} used`
              : 'No requests yet'
            }
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            {hasActivity ? (
              <>
                <div className={`text-2xl font-bold ${getScoreColor(avgScore)}`}>
                  {(avgScore * 100).toFixed(0)}%
                </div>
                <div className="text-xs text-surface-500">avg health</div>
              </>
            ) : (
              <>
                <div className="text-2xl font-bold text-primary-400">Ready</div>
                <div className="text-xs text-surface-500">waiting</div>
              </>
            )}
          </div>
          <svg
            className={`h-5 w-5 text-surface-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-surface-700 space-y-3">
          {activeProviders.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-surface-400 text-sm mb-2">
                No provider activity yet
              </p>
              <p className="text-surface-500 text-xs">
                Send a message to see router statistics here
              </p>
            </div>
          ) : (
            <>
              {/* Show only providers that have been used */}
              {activeProviders.map(provider => {
                const hasBeenUsed = (provider.successCount || 0) > 0 || (provider.failureCount || 0) > 0;
                
                return (
                  <div
                    key={provider.id}
                    className="bg-surface-700/30 rounded-lg p-3"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {getCircuitIcon(provider.circuitState || 'closed')}
                        <span className="font-medium text-surface-200">
                          {provider.displayName || provider.id}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className={getScoreColor(provider.score || 0)}>
                          {((provider.score || 0) * 100).toFixed(0)}%
                        </span>
                        {(provider.avgLatencyMs || 0) > 0 && (
                          <span className="text-surface-400">
                            {Math.round(provider.avgLatencyMs || 0)}ms
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Health bar */}
                    <div className="h-1.5 bg-surface-600 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${getScoreBarColor(provider.score || 0)}`}
                        style={{ width: `${(provider.score || 0) * 100}%` }}
                      />
                    </div>

                    {/* Stats row */}
                    {hasBeenUsed && (
                      <div className="flex items-center gap-4 mt-2 text-xs text-surface-500">
                        <span className="text-green-400/70">
                          ✓ {provider.successCount || 0}
                        </span>
                        <span className="text-red-400/70">
                          ✗ {provider.failureCount || 0}
                        </span>
                        {provider.circuitState !== 'closed' && (
                          <span className={
                            provider.circuitState === 'open' 
                              ? 'text-red-400' 
                              : 'text-yellow-400'
                          }>
                            Circuit: {provider.circuitState}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {/* Legend - only show if there's activity */}
          {activeProviders.length > 0 && (
            <div className="flex items-center justify-center gap-6 pt-2 text-xs text-surface-500">
              <span><span className="text-green-400">●</span> Healthy</span>
              <span><span className="text-yellow-400">◐</span> Recovering</span>
              <span><span className="text-red-400">●</span> Unavailable</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

