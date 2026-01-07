import { useState } from 'react';
import { exportConversation } from '../../lib/export';
import type { Message, Conversation } from '../../types';

interface ExportMenuProps {
  conversation: Conversation | null;
  messages: Message[];
}

export default function ExportMenu({ conversation, messages }: ExportMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!conversation || messages.length === 0) {
    return null;
  }

  const handleExport = (format: 'markdown' | 'json') => {
    exportConversation(conversation, messages, format);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="btn-ghost text-sm"
      >
        Export
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 top-full mt-1 z-20 bg-surface-800 border border-surface-700 rounded-lg shadow-lg py-1 min-w-[150px]">
            <button
              onClick={() => handleExport('markdown')}
              className="w-full text-left px-4 py-2 text-sm hover:bg-surface-700 transition-colors"
            >
              Export as Markdown
            </button>
            <button
              onClick={() => handleExport('json')}
              className="w-full text-left px-4 py-2 text-sm hover:bg-surface-700 transition-colors"
            >
              Export as JSON
            </button>
          </div>
        </>
      )}
    </div>
  );
}

