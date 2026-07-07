import { useState, useEffect, useCallback } from 'react';
import { AppSettings, loadSettings, saveSettings } from '@/lib/settings';

// React hook for settings management with auto-persistence
export const useSettings = () => {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  // Auto-save whenever settings change
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const updateSettings = useCallback((partial: Partial<AppSettings>) => {
    setSettings(prev => ({ ...prev, ...partial }));
  }, []);

  const resetSettings = useCallback(() => {
    const defaults = loadSettings();
    setSettings(defaults);
  }, []);

  return {
    settings,
    updateSettings,
    resetSettings,
  };
};
