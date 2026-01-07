import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CopyIcon, CheckIcon, RefreshIcon } from '../icons';
import CodeBlock from './CodeBlock';
import type { Message } from '../../types';
import { useSettingsStore } from '../../stores/settings.store';

interface MessageItemProps {
  message: Message;
  isLast?: boolean;
  isStreaming?: boolean;
  onRegenerate?: () => void;
}

export default function MessageItem({ message, isLast, isStreaming, onRegenerate }: MessageItemProps) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';
  const { settings } = useSettingsStore();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`group ${isUser ? 'flex justify-end' : ''}`}>
      <div
        className={`
          relative max-w-[85%] rounded-2xl px-4 py-3
          ${isUser 
            ? 'bg-primary-600 text-white rounded-br-md' 
            : 'bg-surface-800 text-surface-100 rounded-bl-md'
          }
          ${isStreaming ? 'animate-pulse' : ''}
        `}
      >
        {/* Message content */}
        <div className="prose prose-invert prose-sm max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                const isInline = !match && !String(children).includes('\n');
                
                if (isInline) {
                  return (
                    <code className="px-1.5 py-0.5 bg-surface-700 rounded text-primary-300 text-sm" {...props}>
                      {children}
                    </code>
                  );
                }

                return (
                  <CodeBlock language={match?.[1]}>
                    {String(children).replace(/\n$/, '')}
                  </CodeBlock>
                );
              },
              p({ children }) {
                return <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>;
              },
              ul({ children }) {
                return <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>;
              },
              ol({ children }) {
                return <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>;
              },
              li({ children }) {
                return <li className="leading-relaxed">{children}</li>;
              },
              a({ href, children }) {
                return (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary-400 hover:underline"
                  >
                    {children}
                  </a>
                );
              },
              blockquote({ children }) {
                return (
                  <blockquote className="border-l-4 border-surface-600 pl-4 italic text-surface-300">
                    {children}
                  </blockquote>
                );
              },
              strong({ children }) {
                return <strong className="font-semibold text-surface-100">{children}</strong>;
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>

        {/* Streaming cursor */}
        {isStreaming && (
          <span className="inline-block w-2 h-4 bg-primary-400 animate-pulse ml-0.5" />
        )}

        {/* Actions */}
        {!isStreaming && (
          <div
            className={`
              absolute -bottom-8 flex items-center gap-1
              opacity-0 group-hover:opacity-100 transition-opacity
              ${isUser ? 'right-0' : 'left-0'}
            `}
          >
            <button
              onClick={handleCopy}
              className="btn-ghost btn-icon h-7 w-7"
              title="Copy message"
            >
              {copied ? (
                <CheckIcon className="h-3.5 w-3.5 text-green-400" />
              ) : (
                <CopyIcon className="h-3.5 w-3.5" />
              )}
            </button>

            {!isUser && isLast && onRegenerate && (
              <button
                onClick={onRegenerate}
                className="btn-ghost btn-icon h-7 w-7"
                title="Regenerate response"
              >
                <RefreshIcon className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Provider badge */}
        {!isUser && message.providerId && settings.showProviderBadge && !isStreaming && (
          <div className="mt-2 pt-2 border-t border-surface-700 flex items-center gap-2 text-xs text-surface-500">
            <span>via {message.providerId}</span>
            {message.model && <span>• {message.model}</span>}
            {message.latencyMs && <span>• {(message.latencyMs / 1000).toFixed(1)}s</span>}
          </div>
        )}
      </div>
    </div>
  );
}
