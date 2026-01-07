import { create } from 'zustand';
import type { AppSettings, Provider } from '../types';

interface SettingsState {
  settings: AppSettings;
  providers: Provider[];
  isLoading: boolean;

  // Actions
  setSettings: (settings: AppSettings) => void;
  updateSettings: (updates: Partial<AppSettings>) => void;
  setProviders: (providers: Provider[]) => void;
  updateProvider: (id: string, updates: Partial<Provider>) => void;
  setLoading: (loading: boolean) => void;
}

const defaultSettings: AppSettings = {
  showProviderBadge: true,
  theme: 'dark',
  contextWindowSize: 20,
  systemPrompt: '',
};

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: defaultSettings,
  providers: [],
  isLoading: false,

  setSettings: (settings) => set({ settings }),

  updateSettings: (updates) =>
    set((state) => ({
      settings: { ...state.settings, ...updates },
    })),

  setProviders: (providers) => set({ providers }),

  updateProvider: (id, updates) =>
    set((state) => ({
      providers: state.providers.map((p) =>
        p.id === id ? { ...p, ...updates } : p
      ),
    })),

  setLoading: (isLoading) => set({ isLoading }),
}));

