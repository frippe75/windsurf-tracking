// Centralized settings management with localStorage persistence
//
// This module provides a structured way to persist app settings across sessions.
// All settings are stored in localStorage under a single versioned key.
//
// Usage:
//   - Direct: loadSettings(), saveSettings(), updateSettings()
//   - React Hook: useSettings() (auto-persists on change)
//   - Specific helpers: getToolPreferences(), saveBackendSettings(), etc.
//
// To add new settings:
//   1. Add to AppSettings interface
//   2. Add to DEFAULT_SETTINGS
//   3. Use in components via loadSettings() or useSettings() hook
//
// Settings are automatically merged with defaults on load to handle updates.

export interface AppSettings {
  // Backend settings
  selectedBackendId: string | null;
  selectedBackendSnapshot: {
    id: string;
    name: string;
    url: string;
  } | null;
  customBackends: Array<{
    id: string;
    name: string;
    url: string;
    enableProbe?: boolean;
  }>;

  // Tool preferences
  autoTrack: boolean;
  autoDetect: boolean;
  useSAM2: boolean;
  showLabels: boolean;

  // Overlay toggles
  overlays: {
    segments: boolean;
    bboxes: boolean;
    points: boolean;
  };

  // UI preferences
  maximizeVideo: boolean;

  // Keyboard shortcuts (extensible for future)
  shortcuts: Record<string, string>;
}

const DEFAULT_SETTINGS: AppSettings = {
  selectedBackendId: null,
  selectedBackendSnapshot: null,
  customBackends: [],
  autoTrack: true,
  autoDetect: true,
  useSAM2: true,
  showLabels: true,
  overlays: {
    segments: true,
    bboxes: true,
    points: true,
  },
  maximizeVideo: false,
  shortcuts: {
    // Future: user-remappable shortcuts
    togglePlay: 'Space',
    nextFrame: 'ArrowRight',
    prevFrame: 'ArrowLeft',
  },
};

const SETTINGS_KEY = 'app-settings-v1';

// Load settings from localStorage
export const loadSettings = (): AppSettings => {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to handle new settings added in updates
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
  return DEFAULT_SETTINGS;
};

// Save settings to localStorage
export const saveSettings = (settings: AppSettings): void => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
};

// Update partial settings
export const updateSettings = (partial: Partial<AppSettings>): AppSettings => {
  const current = loadSettings();
  const updated = { ...current, ...partial };
  saveSettings(updated);
  return updated;
};

// Reset to defaults
export const resetSettings = (): AppSettings => {
  saveSettings(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
};

// Specific helpers for common operations
export const getBackendSettings = () => {
  const settings = loadSettings();
  return {
    selectedBackendId: settings.selectedBackendId,
    selectedBackendSnapshot: settings.selectedBackendSnapshot,
    customBackends: settings.customBackends,
  };
};

export const saveBackendSettings = (backendSettings: {
  selectedBackendId?: string;
  selectedBackendSnapshot?: AppSettings['selectedBackendSnapshot'];
  customBackends?: AppSettings['customBackends'];
}) => {
  updateSettings(backendSettings);
};

export const getToolPreferences = () => {
  const settings = loadSettings();
  return {
    autoTrack: settings.autoTrack,
    autoDetect: settings.autoDetect,
    useSAM2: settings.useSAM2,
    showLabels: settings.showLabels,
    overlays: settings.overlays,
    maximizeVideo: settings.maximizeVideo,
  };
};

export const saveToolPreferences = (prefs: Partial<ReturnType<typeof getToolPreferences>>) => {
  updateSettings(prefs);
};
