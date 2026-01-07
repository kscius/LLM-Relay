import { useEffect, useCallback, useRef } from 'react';
import { useChatStore } from '../stores/chat.store';
import type { Message, StreamChunk } from '../types';
import { v4 as uuidv4 } from 'uuid';

export function useChat(conversationId: string | null) {
  const {
    messages,
    isLoading,
    isStreaming,
    streamingContent,
    error,
    setMessages,
    addMessage,
    setLoading,
    setStreaming,
    appendStreamContent,
    clearStreamContent,
    setError,
    setCurrentConversation,
  } = useChatStore();
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Load messages when conversation changes
  useEffect(() => {
    setCurrentConversation(conversationId);

    if (!conversationId) {
      setMessages([]);
      return;
    }

    loadMessages(conversationId);
  }, [conversationId]);

  // Subscribe to streaming when conversation is active
  useEffect(() => {
    if (!conversationId || !window.api) return;

    const handleChunk = (chunk: StreamChunk) => {
      if (chunk.type === 'delta' && chunk.delta) {
        appendStreamContent(chunk.delta);
      } else if (chunk.type === 'done') {
        setStreaming(false);
        loadMessages(conversationId);
      } else if (chunk.type === 'error') {
        setError(chunk.error?.message || 'Unknown error');
        setStreaming(false);
      }
    };

    unsubscribeRef.current = window.api.chat.onStream(conversationId, handleChunk);

    return () => {
      unsubscribeRef.current?.();
    };
  }, [conversationId]);

  const loadMessages = async (convId: string) => {
    if (!window.api) return;

    try {
      const msgs = await window.api.conversations.getMessages(convId);
      setMessages(msgs);
    } catch (e) {
      console.error('Failed to load messages:', e);
    }
  };

  const sendMessage = useCallback(async (content: string) => {
    if (!window.api || isLoading || isStreaming) return;

    let activeConversationId = conversationId;

    // Create new conversation if needed
    if (!activeConversationId) {
      try {
        const newConv = await window.api.conversations.create({ title: 'New Chat' });
        activeConversationId = newConv.id;
        setCurrentConversation(activeConversationId);
        // Signal to parent to update URL/state
        window.dispatchEvent(new CustomEvent('conversation-created', { detail: newConv }));
      } catch (e) {
        setError('Failed to create conversation');
        return;
      }
    }

    // Add user message optimistically
    const userMessage: Message = {
      id: uuidv4(),
      role: 'user',
      content,
      createdAt: Date.now(),
    };
    addMessage(userMessage);

    // Prepare messages for API
    const allMessages = [...messages, userMessage].map(m => ({
      role: m.role,
      content: m.content,
    }));

    setLoading(true);
    setStreaming(true);
    clearStreamContent();
    setError(null);

    try {
      const result = await window.api.chat.send({
        conversationId: activeConversationId,
        messages: allMessages,
      });

      if (!result.success) {
        setError(result.error || 'Failed to send message');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send message');
    } finally {
      setLoading(false);
    }
  }, [conversationId, messages, isLoading, isStreaming]);

  const regenerateMessage = useCallback(async (messageId: string) => {
    if (!window.api || !conversationId || isLoading || isStreaming) return;

    setLoading(true);
    setStreaming(true);
    clearStreamContent();
    setError(null);

    try {
      const result = await window.api.chat.regenerate(conversationId, messageId);

      if (!result.success) {
        setError(result.error || 'Failed to regenerate message');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to regenerate message');
    } finally {
      setLoading(false);
    }
  }, [conversationId, isLoading, isStreaming]);

  const cancelGeneration = useCallback(() => {
    if (!window.api || !conversationId) return;

    window.api.chat.cancel(conversationId);
    setStreaming(false);
    setLoading(false);
    clearStreamContent();
  }, [conversationId]);

  return {
    messages,
    isLoading,
    isStreaming,
    streamingContent,
    error,
    sendMessage,
    regenerateMessage,
    cancelGeneration,
  };
}

