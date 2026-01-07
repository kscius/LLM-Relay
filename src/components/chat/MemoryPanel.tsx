import { useState, useEffect } from 'react';

interface MemoryPanelProps {
  conversationId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

interface ConversationMemory {
  summary: string | null;
  keyFacts: string[];
}

export default function MemoryPanel({ conversationId, isOpen, onClose }: MemoryPanelProps) {
  const [memory, setMemory] = useState<ConversationMemory>({ summary: null, keyFacts: [] });
  const [isLoading, setIsLoading] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [newFact, setNewFact] = useState('');

  useEffect(() => {
    if (conversationId && isOpen) {
      loadMemory();
    }
  }, [conversationId, isOpen]);

  const loadMemory = async () => {
    if (!conversationId || !window.api?.memory) return;
    
    setIsLoading(true);
    try {
      const result = await window.api.memory.get(conversationId);
      if (result) {
        setMemory({ summary: result.summary, keyFacts: result.keyFacts });
      } else {
        setMemory({ summary: null, keyFacts: [] });
      }
    } catch (error) {
      console.error('Failed to load memory:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSummarize = async () => {
    if (!conversationId || !window.api?.memory) return;
    
    setIsSummarizing(true);
    try {
      const result = await window.api.memory.summarize(conversationId);
      if (result.success) {
        // Reload memory after summarization
        await loadMemory();
      }
    } catch (error) {
      console.error('Failed to summarize:', error);
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleAddFact = async () => {
    if (!conversationId || !newFact.trim() || !window.api?.memory) return;
    
    try {
      await window.api.memory.addFact(conversationId, newFact.trim());
      setMemory(prev => ({
        ...prev,
        keyFacts: [...prev.keyFacts, newFact.trim()],
      }));
      setNewFact('');
    } catch (error) {
      console.error('Failed to add fact:', error);
    }
  };

  const handleRemoveFact = async (fact: string) => {
    if (!conversationId || !window.api?.memory) return;
    
    try {
      await window.api.memory.removeFact(conversationId, fact);
      setMemory(prev => ({
        ...prev,
        keyFacts: prev.keyFacts.filter(f => f !== fact),
      }));
    } catch (error) {
      console.error('Failed to remove fact:', error);
    }
  };

  const handleClearMemory = async () => {
    if (!conversationId || !window.api?.memory) return;
    
    if (confirm('Clear all memory for this conversation?')) {
      try {
        await window.api.memory.clearMemory(conversationId);
        setMemory({ summary: null, keyFacts: [] });
      } catch (error) {
        console.error('Failed to clear memory:', error);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-surface-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-700">
          <h2 className="text-lg font-semibold">Conversation Memory</h2>
          <button
            onClick={onClose}
            className="btn-ghost btn-icon h-8 w-8"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[60vh] space-y-6">
          {!conversationId ? (
            <p className="text-surface-400 text-center py-8">
              Select a conversation to view its memory
            </p>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin h-8 w-8 border-2 border-primary-500 border-t-transparent rounded-full" />
            </div>
          ) : (
            <>
              {/* Summary Section */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium text-surface-200">Summary</h3>
                  <button
                    onClick={handleSummarize}
                    disabled={isSummarizing}
                    className="btn-secondary text-sm"
                  >
                    {isSummarizing ? 'Generating...' : 'Generate Summary'}
                  </button>
                </div>
                
                {memory.summary ? (
                  <div className="bg-surface-700/50 rounded-lg p-4 text-surface-300 text-sm leading-relaxed">
                    {memory.summary}
                  </div>
                ) : (
                  <p className="text-surface-500 text-sm italic">
                    No summary yet. Click "Generate Summary" to create one based on the conversation history.
                  </p>
                )}
              </section>

              {/* Key Facts Section */}
              <section>
                <h3 className="font-medium text-surface-200 mb-3">Key Facts</h3>
                
                {memory.keyFacts.length > 0 ? (
                  <div className="space-y-2 mb-4">
                    {memory.keyFacts.map((fact, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between bg-surface-700/50 rounded-lg px-4 py-2"
                      >
                        <span className="text-surface-300 text-sm">{fact}</span>
                        <button
                          onClick={() => handleRemoveFact(fact)}
                          className="text-surface-500 hover:text-red-400 text-sm"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-surface-500 text-sm italic mb-4">
                    No key facts saved. Add facts that should be remembered across conversations.
                  </p>
                )}

                {/* Add new fact */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newFact}
                    onChange={(e) => setNewFact(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddFact()}
                    placeholder="Add a new fact..."
                    className="input flex-1"
                  />
                  <button
                    onClick={handleAddFact}
                    disabled={!newFact.trim()}
                    className="btn-primary"
                  >
                    Add
                  </button>
                </div>
              </section>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-surface-700">
          <button
            onClick={handleClearMemory}
            disabled={!conversationId}
            className="text-red-400 hover:text-red-300 text-sm"
          >
            Clear All Memory
          </button>
          <button onClick={onClose} className="btn-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

