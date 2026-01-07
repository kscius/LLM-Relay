import { RefObject } from 'react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PlusIcon, ChatBubbleIcon, SearchIcon, TrashIcon } from '../icons';
import type { Conversation } from '../../types';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  conversations: Conversation[];
  groupedConversations: Record<string, Conversation[]>;
  currentConversationId: string | null;
  onNewChat: () => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  searchInputRef?: RefObject<HTMLInputElement>;
}

export default function Sidebar({
  isOpen,
  onToggle,
  groupedConversations,
  currentConversationId,
  onNewChat,
  onSelectConversation,
  onDeleteConversation,
  searchInputRef,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Filter conversations by search query
  const filteredGroups = Object.entries(groupedConversations).reduce(
    (acc, [date, convs]) => {
      const filtered = convs.filter(conv =>
        conv.title.toLowerCase().includes(searchQuery.toLowerCase())
      );
      if (filtered.length > 0) {
        acc[date] = filtered;
      }
      return acc;
    },
    {} as Record<string, Conversation[]>
  );

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={onToggle}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:relative inset-y-0 left-0 z-30
          w-72 bg-surface-800 border-r border-surface-700
          flex flex-col
          transform transition-transform duration-200 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0 lg:w-0 lg:overflow-hidden'}
        `}
      >
        {/* New Chat Button */}
        <div className="p-3">
          <button
            onClick={onNewChat}
            className="btn-primary w-full justify-start gap-2"
          >
            <PlusIcon className="h-4 w-4" />
            New Chat
            <span className="ml-auto text-xs opacity-70">⌘N</span>
          </button>
        </div>

        {/* Search */}
        <div className="px-3 pb-2">
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-500" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="input pl-9 pr-12 h-9 text-sm"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-surface-500">
              ⌘K
            </span>
          </div>
        </div>

        {/* Conversation List */}
        <nav className="flex-1 overflow-y-auto px-2 py-2">
          {Object.keys(filteredGroups).length === 0 ? (
            <div className="text-center py-8 text-surface-500 text-sm">
              {searchQuery ? 'No matching conversations' : 'No conversations yet'}
            </div>
          ) : (
            Object.entries(filteredGroups).map(([date, convs]) => (
              <div key={date} className="mb-4">
                <h3 className="px-2 py-1 text-xs font-medium text-surface-500 uppercase">
                  {date}
                </h3>
                <ul className="space-y-1">
                  {convs.map(conv => (
                    <li key={conv.id} className="group relative">
                      <button
                        onClick={() => onSelectConversation(conv.id)}
                        className={`
                          w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-left
                          transition-colors
                          ${conv.id === currentConversationId
                            ? 'bg-surface-700 text-surface-100'
                            : 'text-surface-300 hover:bg-surface-700 hover:text-surface-100'
                          }
                        `}
                      >
                        <ChatBubbleIcon className="h-4 w-4 flex-shrink-0" />
                        <span className="truncate flex-1">{conv.title}</span>
                      </button>
                      
                      {/* Delete button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm('Delete this conversation?')) {
                            onDeleteConversation(conv.id);
                          }
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 opacity-0 group-hover:opacity-100 text-surface-400 hover:text-red-400 transition-all"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-surface-700">
          <Link
            to="/about"
            className="text-xs text-surface-500 hover:text-surface-300 transition-colors"
          >
            LLM Relay v0.1.0
          </Link>
        </div>
      </aside>
    </>
  );
}
