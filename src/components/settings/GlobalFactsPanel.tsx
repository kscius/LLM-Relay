import { useState, useEffect } from 'react';

interface GlobalFact {
  id: string;
  fact: string;
  category: 'preference' | 'personal' | 'project' | 'technical' | 'temporary';
  confidence: number;
  createdAt: string;
}

interface FactStats {
  total: number;
  byCategory: Record<string, number>;
  global: number;
  conversation: number;
}

const CATEGORIES = [
  { id: 'personal', label: 'Personal', icon: '👤', color: 'text-blue-400' },
  { id: 'preference', label: 'Preferences', icon: '⚙️', color: 'text-green-400' },
  { id: 'project', label: 'Project', icon: '📁', color: 'text-yellow-400' },
  { id: 'technical', label: 'Technical', icon: '🔧', color: 'text-purple-400' },
  { id: 'temporary', label: 'Temporary', icon: '⏰', color: 'text-orange-400' },
];

export default function GlobalFactsPanel() {
  const [facts, setFacts] = useState<GlobalFact[]>([]);
  const [stats, setStats] = useState<FactStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [newFact, setNewFact] = useState('');
  const [newCategory, setNewCategory] = useState<string>('preference');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  useEffect(() => {
    loadFacts();
    loadStats();
  }, []);

  const loadFacts = async () => {
    if (!window.api?.facts) return;
    
    setIsLoading(true);
    try {
      const result = await window.api.facts.list();
      setFacts(result);
    } catch (error) {
      console.error('Failed to load facts:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadStats = async () => {
    // Stats are computed from the facts list directly
    const total = facts.length;
    const byCategory: Record<string, number> = {};
    for (const fact of facts) {
      byCategory[fact.category] = (byCategory[fact.category] || 0) + 1;
    }
    setStats({ total, byCategory, global: total, conversation: 0 });
  };

  const handleAddFact = async () => {
    if (!newFact.trim() || !window.api?.facts) return;

    try {
      const result = await window.api.facts.add(newFact.trim(), newCategory);
      
      if (result.success && result.id) {
        // Create a new fact object with the returned id
        const newFactObj: GlobalFact = {
          id: result.id,
          fact: newFact.trim(),
          category: newCategory as GlobalFact['category'],
          confidence: 1.0,
          createdAt: new Date().toISOString(),
        };
        setFacts(prev => [newFactObj, ...prev]);
        setNewFact('');
        // Update stats from the new facts list
        setTimeout(loadStats, 0);
      }
    } catch (error) {
      console.error('Failed to add fact:', error);
    }
  };

  const handleUpdateFact = async (id: string) => {
    if (!editText.trim() || !window.api?.facts) return;

    try {
      await window.api.facts.update(id, { fact: editText.trim() });
      setFacts(prev => prev.map(f => f.id === id ? { ...f, fact: editText.trim() } : f));
      setEditingId(null);
      setEditText('');
    } catch (error) {
      console.error('Failed to update fact:', error);
    }
  };

  const handleDeleteFact = async (id: string) => {
    if (!window.api?.facts) return;

    try {
      await window.api.facts.delete(id);
      setFacts(prev => prev.filter(f => f.id !== id));
      loadStats();
    } catch (error) {
      console.error('Failed to delete fact:', error);
    }
  };

  const filteredFacts = selectedCategory
    ? facts.filter(f => f.category === selectedCategory)
    : facts;

  const getCategoryInfo = (categoryId: string) => 
    CATEGORIES.find(c => c.id === categoryId) || CATEGORIES[0];

  return (
    <div className="space-y-6">
      {/* Header with stats */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Global Memory</h3>
          <p className="text-sm text-surface-400">
            Facts that are remembered across all conversations
          </p>
        </div>
        {stats && (
          <div className="text-right">
            <span className="text-2xl font-bold text-primary-400">{stats.total}</span>
            <span className="text-surface-400 text-sm ml-1">facts</span>
          </div>
        )}
      </div>

      {/* Category filters */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSelectedCategory(null)}
          className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
            selectedCategory === null
              ? 'bg-primary-600 text-white'
              : 'bg-surface-700 text-surface-300 hover:bg-surface-600'
          }`}
        >
          All ({facts.length})
        </button>
        {CATEGORIES.map(cat => {
          const count = facts.filter(f => f.category === cat.id).length;
          return (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                selectedCategory === cat.id
                  ? 'bg-primary-600 text-white'
                  : 'bg-surface-700 text-surface-300 hover:bg-surface-600'
              }`}
            >
              {cat.icon} {cat.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Add new fact */}
      <div className="card space-y-3">
        <h4 className="font-medium text-surface-200">Add New Fact</h4>
        <div className="flex gap-2">
          <input
            type="text"
            value={newFact}
            onChange={(e) => setNewFact(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddFact()}
            placeholder="e.g., 'Prefers TypeScript over JavaScript'"
            className="input flex-1"
          />
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            className="input w-40"
          >
            {CATEGORIES.map(cat => (
              <option key={cat.id} value={cat.id}>
                {cat.icon} {cat.label}
              </option>
            ))}
          </select>
          <button
            onClick={handleAddFact}
            disabled={!newFact.trim()}
            className="btn-primary"
          >
            Add
          </button>
        </div>
      </div>

      {/* Facts list */}
      <div className="space-y-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin h-8 w-8 border-2 border-primary-500 border-t-transparent rounded-full" />
          </div>
        ) : filteredFacts.length === 0 ? (
          <div className="card text-center py-8">
            <p className="text-surface-400">
              {selectedCategory 
                ? `No ${getCategoryInfo(selectedCategory).label.toLowerCase()} facts yet`
                : 'No facts saved yet. Add some facts above or they will be extracted automatically from your conversations.'}
            </p>
          </div>
        ) : (
          filteredFacts.map(fact => {
            const catInfo = getCategoryInfo(fact.category);
            const isEditing = editingId === fact.id;
            
            return (
              <div
                key={fact.id}
                className="card flex items-center gap-3 group"
              >
                <span className="text-xl">{catInfo.icon}</span>
                
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <input
                      type="text"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleUpdateFact(fact.id);
                        if (e.key === 'Escape') {
                          setEditingId(null);
                          setEditText('');
                        }
                      }}
                      className="input w-full"
                      autoFocus
                    />
                  ) : (
                    <>
                      <p className="text-surface-200">{fact.fact}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-xs ${catInfo.color}`}>
                          {catInfo.label}
                        </span>
                        <span className="text-xs text-surface-500">
                          {Math.round(fact.confidence * 100)}% confidence
                        </span>
                      </div>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {isEditing ? (
                    <>
                      <button
                        onClick={() => handleUpdateFact(fact.id)}
                        className="btn-ghost btn-icon h-8 w-8 text-green-400"
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => {
                          setEditingId(null);
                          setEditText('');
                        }}
                        className="btn-ghost btn-icon h-8 w-8 text-surface-400"
                      >
                        ✕
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setEditingId(fact.id);
                          setEditText(fact.fact);
                        }}
                        className="btn-ghost btn-icon h-8 w-8 text-surface-400 hover:text-primary-400"
                        title="Edit"
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => handleDeleteFact(fact.id)}
                        className="btn-ghost btn-icon h-8 w-8 text-surface-400 hover:text-red-400"
                        title="Delete"
                      >
                        🗑
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Info box */}
      <div className="bg-surface-700/30 rounded-lg p-4 text-sm text-surface-400">
        <p className="font-medium text-surface-300 mb-2">💡 How Global Memory Works</p>
        <ul className="space-y-1 list-disc list-inside">
          <li>Facts are automatically extracted from your conversations</li>
          <li>They&apos;re included in every new message to provide context</li>
          <li>Higher confidence facts are prioritized</li>
          <li>You can add, edit, or remove facts manually</li>
        </ul>
      </div>
    </div>
  );
}

