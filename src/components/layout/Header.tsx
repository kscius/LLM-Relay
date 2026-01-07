import { Link, useSearchParams } from 'react-router-dom';
import { MenuIcon, SettingsIcon } from '../icons';
import ExportMenu from '../chat/ExportMenu';
import { useChatStore } from '../../stores/chat.store';
import { useConversationsStore } from '../../stores/conversations.store';
import { ThemeToggleCompact } from '../settings/ThemeToggle';

interface HeaderProps {
  onMenuClick: () => void;
  onMemoryClick?: () => void;
  showMemoryButton?: boolean;
}

export default function Header({ onMenuClick, onMemoryClick, showMemoryButton }: HeaderProps) {
  const [searchParams] = useSearchParams();
  const conversationId = searchParams.get('id');
  const { messages } = useChatStore();
  const { conversations } = useConversationsStore();

  const currentConversation = conversationId
    ? conversations.find(c => c.id === conversationId) || null
    : null;

  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-surface-700 bg-surface-800/50 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="btn-ghost btn-icon lg:hidden"
          aria-label="Toggle sidebar"
        >
          <MenuIcon className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-semibold text-primary-400">LLM Relay</h1>
      </div>

      <div className="flex items-center gap-2">
        {showMemoryButton && onMemoryClick && (
          <button
            onClick={onMemoryClick}
            className="btn-ghost text-sm flex items-center gap-1.5"
            title="View conversation memory"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            Memory
          </button>
        )}
        <ExportMenu
          conversation={currentConversation}
          messages={messages}
        />
        <ThemeToggleCompact />
        <Link to="/settings" className="btn-ghost btn-icon" aria-label="Settings">
          <SettingsIcon className="h-5 w-5" />
        </Link>
      </div>
    </header>
  );
}
