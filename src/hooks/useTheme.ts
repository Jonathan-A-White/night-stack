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
    }
  }, [settings?.darkMode]);

  return settings;
}
