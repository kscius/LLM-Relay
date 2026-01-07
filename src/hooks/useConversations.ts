import { useEffect, useCallback } from 'react';
import { useConversationsStore, groupConversationsByDate } from '../stores/conversations.store';
import type { Conversation } from '../types';

export function useConversations() {
  const {
    conversations,
    isLoading,
    error,
    setConversations,
    addConversation,
    updateConversation,
    removeConversation,
    setLoading,
    setError,
  } = useConversationsStore();

  // Load conversations on mount
  useEffect(() => {
    loadConversations();

    // Listen for new conversation creation
    const handleNewConversation = (e: CustomEvent<Conversation>) => {
      addConversation(e.detail);
    };

    window.addEventListener('conversation-created', handleNewConversation as EventListener);
    return () => {
      window.removeEventListener('conversation-created', handleNewConversation as EventListener);
    };
  }, []);

  const loadConversations = async () => {
    if (!window.api) return;

    setLoading(true);
    try {
      const convs = await window.api.conversations.list();
      setConversations(convs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load conversations');
    } finally {
      setLoading(false);
    }
  };

  const createConversation = useCallback(async (title?: string): Promise<Conversation | null> => {
    if (!window.api) return null;

    try {
      const conv = await window.api.conversations.create({ title });
      addConversation(conv);
      return conv;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create conversation');
      return null;
    }
  }, []);

  const deleteConversation = useCallback(async (id: string): Promise<boolean> => {
    if (!window.api) return false;

    try {
      const result = await window.api.conversations.delete(id);
      if (result) {
        removeConversation(id);
      }
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete conversation');
      return false;
    }
  }, []);

  const renameConversation = useCallback(async (id: string, title: string): Promise<boolean> => {
    if (!window.api) return false;

    try {
      const updated = await window.api.conversations.update(id, { title });
      if (updated) {
        updateConversation(id, { title: updated.title });
      }
      return !!updated;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename conversation');
      return false;
    }
  }, []);

  const groupedConversations = groupConversationsByDate(conversations);

  return {
    conversations,
    groupedConversations,
    isLoading,
    error,
    loadConversations,
    createConversation,
    deleteConversation,
    renameConversation,
  };
}

