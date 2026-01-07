import { useEffect, useRef } from 'react';
import MessageItem from './MessageItem';
import StreamingIndicator from './StreamingIndicator';
import type { Message } from '../../types';

interface MessageListProps {
  messages: Message[];
  isStreaming: boolean;
  streamingContent: string;
  error: string | null;
  onRegenerate: (messageId: string) => void;
}

export default function MessageList({
  messages,
  isStreaming,
  streamingContent,
  error,
  onRegenerate,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <h2 className="text-xl font-semibold text-surface-300 mb-2">
            Start a conversation
          </h2>
          <p className="text-surface-500">
            Type a message below to begin chatting with your configured AI providers.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto py-6 px-4 space-y-6">
        {messages.map((message, index) => (
          <MessageItem
            key={message.id}
            message={message}
            isLast={index === messages.length - 1 && !isStreaming}
            onRegenerate={() => onRegenerate(message.id)}
          />
        ))}

        {/* Streaming message */}
        {isStreaming && streamingContent && (
          <MessageItem
            message={{
              id: 'streaming',
              role: 'assistant',
              content: streamingContent,
              createdAt: Date.now(),
            }}
            isStreaming
          />
        )}

        {/* Streaming indicator */}
        {isStreaming && !streamingContent && (
          <div className="max-w-[85%]">
            <div className="bg-surface-800 rounded-2xl rounded-bl-md px-4 py-3">
              <StreamingIndicator />
            </div>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 text-red-400">
            <p className="font-medium">Error</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
