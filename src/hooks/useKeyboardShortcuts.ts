import { useEffect } from 'react';

interface KeyboardShortcut {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  handler: () => void;
  description: string;
}

const shortcuts: KeyboardShortcut[] = [];

export function registerShortcut(shortcut: KeyboardShortcut): () => void {
  shortcuts.push(shortcut);
  return () => {
    const index = shortcuts.indexOf(shortcut);
    if (index > -1) {
      shortcuts.splice(index, 1);
    }
  };
}

export function useKeyboardShortcuts(
  handlers: {
    onNewChat?: () => void;
    onSearch?: () => void;
    onEscape?: () => void;
    onSettings?: () => void;
  }
) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;

      // Cmd/Ctrl + N: New chat
      if (isMod && e.key === 'n') {
        e.preventDefault();
        handlers.onNewChat?.();
        return;
      }

      // Cmd/Ctrl + K: Search
      if (isMod && e.key === 'k') {
        e.preventDefault();
        handlers.onSearch?.();
        return;
      }

      // Cmd/Ctrl + ,: Settings
      if (isMod && e.key === ',') {
        e.preventDefault();
        handlers.onSettings?.();
        return;
      }

      // Escape: Cancel/close
      if (e.key === 'Escape') {
        handlers.onEscape?.();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlers]);
}

export function getShortcutsList(): Array<{ keys: string; description: string }> {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modKey = isMac ? '⌘' : 'Ctrl';

  return [
    { keys: `${modKey}+N`, description: 'New chat' },
    { keys: `${modKey}+K`, description: 'Search conversations' },
    { keys: `${modKey}+,`, description: 'Open settings' },
    { keys: 'Escape', description: 'Cancel/close' },
    { keys: 'Enter', description: 'Send message' },
    { keys: 'Shift+Enter', description: 'New line' },
  ];
}

