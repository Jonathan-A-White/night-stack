import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';

export function useTheme() {
  const settings = useLiveQuery(() => db.appSettings.get('default'));

  useEffect(() => {
    if (settings) {
      document.documentElement.setAttribute(
        'data-theme',
        settings.darkMode ? 'dark' : 'light'
      );
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) {
        meta.setAttribute('content', settings.darkMode ? '#1a1a2e' : '#f5f5f0');
      }
    }
  }, [settings?.darkMode]);

  return settings;
}
