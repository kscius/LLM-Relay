import { useEffect } from 'react';
import { useSettingsStore } from '../../stores/settings.store';

const themes = [
  { id: 'light', label: 'Light', icon: '☀️' },
  { id: 'dark', label: 'Dark', icon: '🌙' },
  { id: 'system', label: 'System', icon: '💻' },
] as const;

export default function ThemeToggle() {
  const { settings, updateSettings } = useSettingsStore();
  const currentTheme = settings.theme || 'dark';

  useEffect(() => {
    applyTheme(currentTheme);
  }, [currentTheme]);

  const applyTheme = (theme: 'light' | 'dark' | 'system') => {
    const root = document.documentElement;
    
    if (theme === 'system') {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.toggle('light', !isDark);
    } else {
      root.classList.toggle('light', theme === 'light');
    }
  };

  const handleThemeChange = async (theme: 'light' | 'dark' | 'system') => {
    updateSettings({ theme });
    applyTheme(theme);
    
    // Persist to backend
    if (window.api?.settings) {
      await window.api.settings.set({ theme });
    }
  };

  return (
    <div className="flex items-center gap-1 p-1 rounded-lg bg-surface-700/50">
      {themes.map((theme) => (
        <button
          key={theme.id}
          onClick={() => handleThemeChange(theme.id)}
          className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
            currentTheme === theme.id
              ? 'bg-primary-600 text-white'
              : 'text-surface-300 hover:text-surface-100 hover:bg-surface-600'
          }`}
          title={theme.label}
        >
          <span className="mr-1.5">{theme.icon}</span>
          {theme.label}
        </button>
      ))}
    </div>
  );
}

// Compact version for header
export function ThemeToggleCompact() {
  const { settings, updateSettings } = useSettingsStore();
  const currentTheme = settings.theme || 'dark';

  useEffect(() => {
    applyTheme(currentTheme);
  }, [currentTheme]);

  const applyTheme = (theme: 'light' | 'dark' | 'system') => {
    const root = document.documentElement;
    
    if (theme === 'system') {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.toggle('light', !isDark);
    } else {
      root.classList.toggle('light', theme === 'light');
    }
  };

  const cycleTheme = async () => {
    const order: Array<'light' | 'dark' | 'system'> = ['dark', 'light', 'system'];
    const currentIndex = order.indexOf(currentTheme);
    const nextTheme = order[(currentIndex + 1) % order.length];
    
    updateSettings({ theme: nextTheme });
    applyTheme(nextTheme);
    
    if (window.api?.settings) {
      await window.api.settings.set({ theme: nextTheme });
    }
  };

  const getIcon = () => {
    switch (currentTheme) {
      case 'light':
        return (
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        );
      case 'dark':
        return (
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
          </svg>
        );
      case 'system':
        return (
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        );
    }
  };

  return (
    <button
      onClick={cycleTheme}
      className="btn-ghost btn-icon"
      title={`Theme: ${currentTheme}`}
    >
      {getIcon()}
    </button>
  );
}

