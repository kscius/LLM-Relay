import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import Sidebar from '../components/layout/Sidebar';
import Header from '../components/layout/Header';
import MessageList from '../components/chat/MessageList';
import ChatInput from '../components/chat/ChatInput';
import MemoryPanel from '../components/chat/MemoryPanel';
import { useChat } from '../hooks/useChat';
import { useConversations } from '../hooks/useConversations';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import type { Conversation } from '../types';

export default function ChatPage() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [memoryPanelOpen, setMemoryPanelOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const conversationId = searchParams.get('id');

  const {
    messages,
    isLoading,
    isStreaming,
    streamingContent,
    error,
    sendMessage,
    regenerateMessage,
    cancelGeneration,
  } = useChat(conversationId);

  const {
    conversations,
    groupedConversations,
    deleteConversation,
    renameConversation,
  } = useConversations();

  // Handle new conversation creation
  useEffect(() => {
    const handleConversationCreated = (e: CustomEvent<Conversation>) => {
      setSearchParams({ id: e.detail.id });
    };

    window.addEventListener('conversation-created', handleConversationCreated as EventListener);
    return () => {
      window.removeEventListener('conversation-created', handleConversationCreated as EventListener);
    };
  }, [setSearchParams]);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onNewChat: () => {
      setSearchParams({});
    },
    onSearch: () => {
      searchInputRef.current?.focus();
    },
    onSettings: () => {
      navigate('/settings');
    },
    onEscape: () => {
      if (isStreaming) {
        cancelGeneration();
      }
    },
  });

  const handleNewChat = () => {
    setSearchParams({});
  };

  const handleSelectConversation = (id: string) => {
    setSearchParams({ id });
  };

  const handleDeleteConversation = async (id: string) => {
    const success = await deleteConversation(id);
    if (success && id === conversationId) {
      setSearchParams({});
    }
  };

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <Sidebar
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        conversations={conversations}
        groupedConversations={groupedConversations}
        currentConversationId={conversationId}
        onNewChat={handleNewChat}
        onSelectConversation={handleSelectConversation}
        onDeleteConversation={handleDeleteConversation}
        onRenameConversation={renameConversation}
        searchInputRef={searchInputRef}
      />

      {/* Main content */}
      <div className="flex flex-1 flex-col min-w-0">
        <Header 
          onMenuClick={() => setSidebarOpen(!sidebarOpen)}
          onMemoryClick={() => setMemoryPanelOpen(true)}
          showMemoryButton={!!conversationId}
        />
        
        <main className="flex-1 flex flex-col overflow-hidden">
          <MessageList
            messages={messages}
            isStreaming={isStreaming}
            streamingContent={streamingContent}
            error={error}
            onRegenerate={regenerateMessage}
          />
          <ChatInput
            onSend={sendMessage}
            onCancel={cancelGeneration}
            isLoading={isLoading || isStreaming}
            disabled={false}
          />
        </main>
      </div>

      {/* Memory Panel */}
      <MemoryPanel
        conversationId={conversationId}
        isOpen={memoryPanelOpen}
        onClose={() => setMemoryPanelOpen(false)}
      />
    </div>
  );
}
