import { useState, useRef, useEffect } from 'react';
import { SendIcon, StopIcon } from '../icons';

interface ChatInputProps {
  onSend?: (content: string) => void;
  onCancel?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
}

export default function ChatInput({ onSend, onCancel, isLoading, disabled }: ChatInputProps) {
  const [content, setContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [content]);

  const handleSubmit = () => {
    const trimmed = content.trim();
    if (trimmed && !isLoading && !disabled && onSend) {
      onSend(trimmed);
      setContent('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="border-t border-surface-700 bg-surface-800/50 backdrop-blur-sm p-4">
      <div className="max-w-3xl mx-auto">
        <div className="relative flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={e => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            disabled={disabled}
            rows={1}
            className="textarea flex-1 min-h-[44px] max-h-[200px] py-3 pr-12"
          />

          <div className="absolute right-2 bottom-2">
            {isLoading ? (
              <button
                onClick={onCancel}
                className="btn-ghost btn-icon h-8 w-8 text-red-400 hover:text-red-300"
                title="Stop generating"
              >
                <StopIcon className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!content.trim() || disabled}
                className="btn-primary btn-icon h-8 w-8 disabled:opacity-50"
                title="Send message"
              >
                <SendIcon className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <p className="text-xs text-surface-500 mt-2 text-center">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}

