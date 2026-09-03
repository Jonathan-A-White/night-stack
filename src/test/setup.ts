import '@testing-library/jest-dom/vitest';

// Mock IndexedDB for Dexie
import 'fake-indexeddb/auto';

// jsdom lacks matchMedia (used by useInstallPrompt) and ResizeObserver
// (used by recharts' ResponsiveContainer). Minimal stubs so full-app
// component tests can mount every route.
if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
  }
  if (!('ResizeObserver' in window)) {
    class RO {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (window as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
  }
}
